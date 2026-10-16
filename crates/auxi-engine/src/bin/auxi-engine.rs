//! Processus moteur d'AuxiOffice : héberge LibreOffice (via LibreOfficeKit)
//! pour un document et répond aux requêtes reçues sur l'entrée standard.
//!
//! Utilisation : variables `AUXI_ENGINE_PROGRAM_DIR` (dossier program/ de
//! LibreOffice, obligatoire), `AUXI_ENGINE_PROFILE`, `AUXI_ENGINE_LANG`,
//! `AUXI_ENGINE_AUTHOR` ; aucun argument (voir `parse_args`).

use auxi_engine::lok::{Document, Office};
use auxi_engine::protocol::{callback_name, read_frame, write_frame, Frame};
use lok_sys as sys;
use serde_json::{json, Value};
use std::fs::File;
use std::io::{BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

type Out = Arc<Mutex<BufWriter<File>>>;

struct Args {
    program_dir: PathBuf,
    profile: Option<PathBuf>,
    lang: String,
    author: String,
    profile_root: Option<PathBuf>,
}

/// Configuration lue dans l'environnement (`AUXI_ENGINE_PROGRAM_DIR`,
/// `AUXI_ENGINE_PROFILE`, `AUXI_ENGINE_LANG`, `AUXI_ENGINE_AUTHOR`).
///
/// Pas d'arguments de ligne de commande : sous macOS, LibreOffice lit ceux du
/// processus qui l'héberge (via _NSGetArgv), prend les nôtres pour des options
/// inconnues, affiche son aide et arrête sa boucle aussitôt.
fn parse_args() -> Result<Args, String> {
    if std::env::args().nth(1).as_deref() == Some("--version") {
        println!("auxi-engine {}", env!("CARGO_PKG_VERSION"));
        std::process::exit(0);
    }
    if std::env::args().len() > 1 {
        return Err("aucun argument attendu : la configuration passe par les variables AUXI_ENGINE_*".into());
    }
    let var = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
    let a = Args {
        program_dir: var("AUXI_ENGINE_PROGRAM_DIR").map(PathBuf::from).ok_or("AUXI_ENGINE_PROGRAM_DIR est obligatoire")?,
        profile: var("AUXI_ENGINE_PROFILE").map(PathBuf::from),
        lang: var("AUXI_ENGINE_LANG").unwrap_or_else(|| "fr-FR".into()),
        author: var("AUXI_ENGINE_AUTHOR").unwrap_or_default(),
        profile_root: var("AUXI_ENGINE_PROFILE_ROOT").map(PathBuf::from),
    };
    // Ne pas transmettre ces variables aux composants de LibreOffice.
    for k in ["AUXI_ENGINE_PROGRAM_DIR", "AUXI_ENGINE_PROFILE", "AUXI_ENGINE_LANG", "AUXI_ENGINE_AUTHOR", "AUXI_ENGINE_PROFILE_ROOT"] {
        std::env::remove_var(k);
    }
    Ok(a)
}

/// Réserve la sortie standard au protocole : LibreOffice écrit parfois sur
/// stdout, ce qui corromprait les trames. On duplique donc le descripteur
/// d'origine pour le protocole et on redirige stdout vers stderr.
#[cfg(unix)]
fn protocol_output() -> File {
    use std::os::fd::FromRawFd;
    unsafe {
        let fd = libc::dup(1);
        assert!(fd >= 0, "dup(stdout) a échoué");
        libc::dup2(2, 1);
        File::from_raw_fd(fd)
    }
}

#[cfg(windows)]
fn protocol_output() -> File {
    use std::os::windows::io::FromRawHandle;
    unsafe {
        let fd = libc::dup(1);
        assert!(fd >= 0, "dup(stdout) a échoué");
        libc::dup2(2, 1);
        let handle = libc::get_osfhandle(fd);
        // Les écritures Win32 directes de LibreOffice passent par le handle
        // standard : le faire pointer vers stderr lui aussi.
        windows_sys::Win32::System::Console::SetStdHandle(
            windows_sys::Win32::System::Console::STD_OUTPUT_HANDLE,
            windows_sys::Win32::System::Console::GetStdHandle(windows_sys::Win32::System::Console::STD_ERROR_HANDLE),
        );
        File::from_raw_handle(handle as _)
    }
}

fn send(out: &Out, v: &Value, bin: &[u8]) {
    let mut w = out.lock().unwrap_or_else(|e| e.into_inner());
    if write_frame(&mut *w, v, bin).is_err() {
        // L'application a fermé le canal : rien d'autre à faire que quitter.
        std::process::exit(0);
    }
}

fn file_url(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    let abs = if p.is_absolute() { p.to_path_buf() } else { std::env::current_dir().map_err(|e| e.to_string())?.join(p) };
    url::Url::from_file_path(&abs).map(|u| u.to_string()).map_err(|_| format!("chemin invalide : {path}"))
}

/// Verrou LibreOffice/Microsoft Office posé à côté du document
/// (`.~lock.<nom>#`) : « ,utilisateur,machine,date,profil; ».
fn lock_file(path: &str) -> Option<PathBuf> {
    let p = Path::new(path);
    let name = p.file_name()?.to_string_lossy();
    Some(p.with_file_name(format!(".~lock.{name}#")))
}

fn lock_owner(path: &str) -> Option<Value> {
    let text = std::fs::read_to_string(lock_file(path)?).ok()?;
    let f: Vec<&str> = text.trim_end_matches([';', '\n', '\r']).split(',').collect();
    Some(json!({
        "user": f.get(1).copied().unwrap_or(""),
        "host": f.get(2).copied().unwrap_or(""),
        "date": f.get(3).copied().unwrap_or(""),
        "profile": f.get(4).copied().unwrap_or(""),
    }))
}

/// Verrou laissé par AuxiOffice lui-même (son profil, ou l'un des profils
/// de l'application) après un arrêt brutal : l'application n'ouvre jamais
/// deux fois le même fichier, un tel verrou est donc forcément orphelin.
fn is_own_stale_lock(owner: &Value, profile_url: Option<&str>, root_url: Option<&str>) -> bool {
    let norm = |s: &str| s.trim_end_matches('/').to_string();
    let Some(p) = owner["profile"].as_str().filter(|p| !p.is_empty()) else { return false };
    let p = norm(p);
    profile_url.is_some_and(|ours| p == norm(ours)) || root_url.is_some_and(|root| p.starts_with(&(norm(root) + "/")))
}

/// Filtre d'enregistrement LibreOffice selon l'extension.
fn filter_for(path: &str) -> Option<&'static str> {
    let ext = Path::new(path).extension()?.to_string_lossy().to_lowercase();
    Some(match ext.as_str() {
        "docx" => "MS Word 2007 XML",
        "doc" => "MS Word 97",
        "odt" => "writer8",
        "rtf" => "Rich Text Format",
        "txt" => "Text",
        "xlsx" => "Calc MS Excel 2007 XML",
        "xls" => "MS Excel 97",
        "ods" => "calc8",
        "csv" => "Text - txt - csv (StarCalc)",
        "pptx" => "Impress MS PowerPoint 2007 XML",
        "ppt" => "MS PowerPoint 97",
        "odp" => "impress8",
        "odg" => "draw8",
        _ => return None,
    })
}

fn doc_type_name(t: i32) -> &'static str {
    match t {
        sys::LOK_DOCTYPE_TEXT => "text",
        sys::LOK_DOCTYPE_SPREADSHEET => "spreadsheet",
        sys::LOK_DOCTYPE_PRESENTATION => "presentation",
        sys::LOK_DOCTYPE_DRAWING => "drawing",
        _ => "other",
    }
}

fn info(doc: &Document) -> Value {
    let parts = doc.parts();
    let names: Vec<String> = (0..parts).map(|i| doc.part_name(i)).collect();
    let (w, h) = doc.size();
    let t = doc.doc_type();
    let mut v = json!({
        "type": doc_type_name(t),
        "parts": parts,
        "part": doc.part(),
        "part_names": names,
        "width": w,
        "height": h,
    });
    if t == sys::LOK_DOCTYPE_TEXT {
        v["pages"] = json!(doc.page_rectangles().unwrap_or_default());
    }
    if t == sys::LOK_DOCTYPE_PRESENTATION {
        let hashes: Vec<String> = (0..parts).map(|i| doc.part_hash(i)).collect();
        v["part_hashes"] = json!(hashes);
    }
    v
}

fn int(v: &Value, k: &str) -> i32 {
    v.get(k).and_then(Value::as_i64).unwrap_or(0) as i32
}

fn string<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str)
}

struct Engine {
    office: Office,
    doc: Option<Document>,
    out: Out,
    args: Args,
    password: Arc<Mutex<Option<String>>>,
    /// Réponses différées : requêtes qui attendent le résultat d'une commande
    /// UNO (enregistrement). Le rappel de LibreOffice envoie la réponse ; on ne
    /// bloque donc jamais le fil qui fait tourner LibreOffice (indispensable
    /// sous macOS, où il s'agit du fil principal).
    deferred: Arc<Mutex<Vec<(Value, String)>>>,
    /// Identifiant de la requête en cours de traitement.
    current_id: Value,
    profile_url: Option<String>,
}

/// Réponse d'une requête : immédiate, ou envoyée plus tard par un rappel.
enum Reply {
    Now(Value, Vec<u8>),
    Deferred,
}

impl Engine {
    fn doc(&self) -> Result<&Document, String> {
        self.doc.as_ref().ok_or_else(|| "aucun document chargé".to_string())
    }

    fn handle(&mut self, req: &Value, bin: Vec<u8>) -> Result<Reply, String> {
        let cmd = string(req, "cmd").ok_or("champ cmd manquant")?;
        let none = Vec::new();
        let (v, b) = match cmd {
            "hello" => (
                json!({
                    "engine": env!("CARGO_PKG_VERSION"),
                    "libreoffice": self.office.version_info().and_then(|s| serde_json::from_str::<Value>(&s).ok()),
                }),
                none,
            ),
            "load" => {
                if self.doc.is_some() {
                    return Err("un document est déjà chargé dans ce moteur".into());
                }
                let path = string(req, "path").ok_or("champ path manquant")?;
                let url = file_url(path)?;
                // Un verrou existant fait ouvrir LibreOffice en lecture seule
                // sans le dire : on le signale, et on ne le supprime que si
                // l'utilisateur l'a demandé (verrou orphelin après un plantage).
                let mut locked_by = lock_owner(path);
                let root_url = self.args.profile_root.as_ref().and_then(|r| url::Url::from_directory_path(r.canonicalize().unwrap_or(r.clone())).ok()).map(|u| u.to_string());
                let own = locked_by.as_ref().is_some_and(|o| is_own_stale_lock(o, self.profile_url.as_deref(), root_url.as_deref()));
                if locked_by.is_some() && (own || req.get("ignore_lock").and_then(Value::as_bool) == Some(true)) {
                    if let Some(f) = lock_file(path) {
                        let _ = std::fs::remove_file(f);
                    }
                    locked_by = None;
                }
                let read_only_file = std::fs::metadata(path).map(|m| m.permissions().readonly()).unwrap_or(false);
                *self.password.lock().unwrap() = string(req, "password").map(str::to_owned);
                let opts = format!("Language={}", self.args.lang);
                let mut doc = self.office.load(&url, &opts)?;
                let out = self.out.clone();
                let deferred = self.deferred.clone();
                doc.register_callback(Box::new(move |t, payload| {
                    if t == sys::LOK_CALLBACK_UNO_COMMAND_RESULT {
                        if let Ok(r) = serde_json::from_str::<Value>(&payload) {
                            let waiting = {
                                let mut d = deferred.lock().unwrap();
                                d.iter().position(|(_, c)| r["commandName"] == c.as_str()).map(|i| d.remove(i))
                            };
                            if let Some((id, _)) = waiting {
                                let reply = if r["success"] == json!(true) {
                                    json!({"id": id, "ok": true})
                                } else {
                                    json!({"id": id, "ok": false, "error": format!("échec de l'enregistrement : {}", r.get("result").unwrap_or(&Value::Null))})
                                };
                                send(&out, &reply, &[]);
                            }
                        }
                    }
                    send(&out, &json!({"event": "callback", "type": t, "name": callback_name(t), "payload": payload}), &[]);
                }));
                let author = if self.args.author.is_empty() { "AuxiOffice".to_string() } else { self.args.author.clone() };
                doc.initialize_for_rendering(
                    &json!({
                        ".uno:Author": {"type": "string", "value": author},
                        ".uno:HideWhitespace": {"type": "boolean", "value": "false"},
                        ".uno:SpellOnline": {"type": "boolean", "value": "true"},
                    })
                    .to_string(),
                );
                doc.set_view_language(&self.args.lang);
                let mut v = info(&doc);
                v["read_only"] = json!(locked_by.is_some() || read_only_file);
                v["locked_by"] = locked_by.unwrap_or(Value::Null);
                self.doc = Some(doc);
                (v, none)
            }
            "info" => (info(self.doc()?), none),
            "paint" => {
                let d = self.doc()?;
                let (pw, ph) = (int(req, "px_w"), int(req, "px_h"));
                if !(1..=4096).contains(&pw) || !(1..=4096).contains(&ph) {
                    return Err("taille de tuile invalide".into());
                }
                let (x, y, w, h) = (int(req, "x"), int(req, "y"), int(req, "w"), int(req, "h"));
                let px = match req.get("part").and_then(Value::as_i64) {
                    Some(part) => d.paint_part(part as i32, pw, ph, x, y, w, h),
                    None => d.paint(pw, ph, x, y, w, h),
                };
                (json!({"px_w": pw, "px_h": ph}), px)
            }
            "key" => {
                let d = self.doc()?;
                let kind = if string(req, "kind") == Some("up") { sys::LOK_KEYEVENT_KEYUP } else { sys::LOK_KEYEVENT_KEYINPUT };
                d.post_key(kind, int(req, "char"), int(req, "code"));
                (json!({}), none)
            }
            "text" => {
                let d = self.doc()?;
                // Comme Collabora Online : la composition en cours est
                // envoyée en TEXTINPUT ; le texte validé l'est en TEXTINPUT
                // puis TEXTINPUT_END.
                let text = string(req, "text").unwrap_or("");
                d.post_text(sys::LOK_EXT_TEXTINPUT, text);
                if string(req, "kind") != Some("preedit") {
                    d.post_text(sys::LOK_EXT_TEXTINPUT_END, text);
                }
                (json!({}), none)
            }
            "mouse" => {
                let d = self.doc()?;
                let kind = match string(req, "kind") {
                    Some("down") => sys::LOK_MOUSEEVENT_MOUSEBUTTONDOWN,
                    Some("up") => sys::LOK_MOUSEEVENT_MOUSEBUTTONUP,
                    _ => sys::LOK_MOUSEEVENT_MOUSEMOVE,
                };
                let buttons = req.get("buttons").and_then(Value::as_i64).unwrap_or(sys::MOUSE_LEFT as i64) as i32;
                let count = req.get("count").and_then(Value::as_i64).unwrap_or(1) as i32;
                d.post_mouse(kind, int(req, "x"), int(req, "y"), count, buttons, int(req, "mods"));
                (json!({}), none)
            }
            // Fenêtres de LibreOffice (boîtes de dialogue, listes déroulantes)
            // annoncées par les rappels « window » : rendu et saisie.
            "paint_window" => {
                let d = self.doc()?;
                let (w, h) = (int(req, "w"), int(req, "h"));
                if !(1..=4096).contains(&w) || !(1..=4096).contains(&h) {
                    return Err("taille de fenêtre invalide".into());
                }
                let scale = req.get("scale").and_then(Value::as_f64).unwrap_or(1.0).clamp(1.0, 3.0);
                let (px, pw, ph) = d.paint_window(int(req, "window") as u32, int(req, "x"), int(req, "y"), w, h, scale);
                (json!({"px_w": pw, "px_h": ph}), px)
            }
            "window_mouse" => {
                let d = self.doc()?;
                let kind = match string(req, "kind") {
                    Some("down") => sys::LOK_MOUSEEVENT_MOUSEBUTTONDOWN,
                    Some("up") => sys::LOK_MOUSEEVENT_MOUSEBUTTONUP,
                    _ => sys::LOK_MOUSEEVENT_MOUSEMOVE,
                };
                let buttons = req.get("buttons").and_then(Value::as_i64).unwrap_or(sys::MOUSE_LEFT as i64) as i32;
                let count = req.get("count").and_then(Value::as_i64).unwrap_or(1) as i32;
                d.post_window_mouse(int(req, "window") as u32, kind, int(req, "x"), int(req, "y"), count, buttons, int(req, "mods"));
                (json!({}), none)
            }
            "window_key" => {
                let d = self.doc()?;
                let kind = if string(req, "kind") == Some("up") { sys::LOK_KEYEVENT_KEYUP } else { sys::LOK_KEYEVENT_KEYINPUT };
                d.post_window_key(int(req, "window") as u32, kind, int(req, "char"), int(req, "code"));
                (json!({}), none)
            }
            "window_text" => {
                let d = self.doc()?;
                let id = int(req, "window") as u32;
                let text = string(req, "text").unwrap_or("");
                d.post_window_text(id, sys::LOK_EXT_TEXTINPUT, text);
                d.post_window_text(id, sys::LOK_EXT_TEXTINPUT_END, text);
                (json!({}), none)
            }
            "window_close" => {
                self.doc()?.close_window(int(req, "window") as u32);
                (json!({}), none)
            }
            "uno" => {
                let d = self.doc()?;
                let command = string(req, "command").ok_or("champ command manquant")?;
                if !command.starts_with(".uno:") {
                    return Err("seules les commandes .uno: sont acceptées".into());
                }
                let args = req.get("args").filter(|a| !a.is_null()).map(|a| a.to_string());
                d.uno(command, args.as_deref(), req.get("notify").and_then(Value::as_bool).unwrap_or(false));
                (json!({}), none)
            }
            "set_part" => {
                let d = self.doc()?;
                d.set_part(int(req, "part"));
                (info(d), none)
            }
            "set_part_mode" => {
                self.doc()?.set_part_mode(int(req, "mode"));
                (json!({}), none)
            }
            "command_values" => {
                let d = self.doc()?;
                let command = string(req, "command").ok_or("champ command manquant")?;
                let raw = d.command_values(command).unwrap_or_default();
                let parsed = serde_json::from_str::<Value>(&raw).unwrap_or(Value::String(raw));
                (json!({"values": parsed}), none)
            }
            "selection" => {
                let d = self.doc()?;
                let mime = string(req, "mime").unwrap_or("text/plain;charset=utf-8");
                (json!({"type": d.selection_type(), "text": d.text_selection(mime)}), none)
            }
            "paste" => {
                let d = self.doc()?;
                let mime = string(req, "mime").unwrap_or("text/plain;charset=utf-8");
                let data = if bin.is_empty() { string(req, "data").unwrap_or("").as_bytes().to_vec() } else { bin };
                (json!({"pasted": d.paste(mime, &data)}), none)
            }
            "set_text_selection" => {
                let d = self.doc()?;
                let kind = match string(req, "kind") {
                    Some("start") => sys::LOK_SETTEXTSELECTION_START,
                    Some("end") => sys::LOK_SETTEXTSELECTION_END,
                    _ => sys::LOK_SETTEXTSELECTION_RESET,
                };
                d.set_text_selection(kind, int(req, "x"), int(req, "y"));
                (json!({}), none)
            }
            "reset_selection" => {
                self.doc()?.reset_selection();
                (json!({}), none)
            }
            "client_zoom" => {
                self.doc()?.set_client_zoom(int(req, "tile_px_w"), int(req, "tile_px_h"), int(req, "tile_twip_w"), int(req, "tile_twip_h"));
                (json!({}), none)
            }
            "visible_area" => {
                self.doc()?.set_client_visible_area(int(req, "x"), int(req, "y"), int(req, "w"), int(req, "h"));
                (json!({}), none)
            }
            "save_in_place" => {
                // Fichier > Enregistrer, dans le fichier d'origine et son format.
                // La réponse part quand LibreOffice confirme (réponse différée).
                let d = self.doc()?;
                let args = json!({
                    "DontTerminateEdit": {"type": "boolean", "value": true},
                    "DontSaveIfUnmodified": {"type": "boolean", "value": false},
                });
                self.deferred.lock().unwrap().push((self.current_id.clone(), ".uno:Save".into()));
                d.uno(".uno:Save", Some(&args.to_string()), true);
                return Ok(Reply::Deferred);
            }
            "save_as_location" => {
                // Fichier > Enregistrer sous : avec l'option TakeOwnership,
                // saveAs fait un vrai « storeAsURL » et le document prend ce
                // nouvel emplacement (sans elle, c'est une simple exportation).
                let d = self.doc()?;
                let path = string(req, "path").ok_or("champ path manquant")?;
                let ext = Path::new(path).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
                if filter_for(path).is_none() {
                    return Err(format!("format non pris en charge : {path}"));
                }
                d.save_as(&file_url(path)?, Some(&ext), Some("TakeOwnership"))?;
                (json!({"path": path}), none)
            }
            "save" => {
                let d = self.doc()?;
                let path = string(req, "path").ok_or("champ path manquant")?;
                d.save_as(&file_url(path)?, string(req, "format"), string(req, "filter"))?;
                (json!({"path": path}), none)
            }
            "quit" => {
                self.doc = None;
                (json!({"bye": true}), none)
            }
            other => return Err(format!("commande inconnue : {other}")),
        };
        Ok(Reply::Now(v, b))
    }

    /// Traite une trame reçue et envoie la réponse. Retourne vrai pour quitter.
    fn process(&mut self, frame: Frame) -> bool {
        let id = frame.json.get("id").cloned().unwrap_or(Value::Null);
        let quit = string(&frame.json, "cmd") == Some("quit");
        self.current_id = id.clone();
        match self.handle(&frame.json, frame.bin) {
            Ok(Reply::Now(mut v, bin)) => {
                v["id"] = id;
                v["ok"] = json!(true);
                send(&self.out, &v, &bin);
            }
            Ok(Reply::Deferred) => {}
            Err(e) => send(&self.out, &json!({"id": id, "ok": false, "error": e}), &[]),
        }
        quit
    }

    fn shutdown(mut self) -> ! {
        self.doc = None;
        let _ = self.out.lock().map(|mut w| w.flush());
        // La destruction complète de LibreOffice peut être longue ; le
        // document est déjà fermé, on quitte directement.
        std::process::exit(0);
    }
}

fn main() {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("auxi-engine: {e}");
            std::process::exit(2);
        }
    };
    let out: Out = Arc::new(Mutex::new(BufWriter::new(protocol_output())));

    let profile_url = args.profile.as_ref().map(|p| {
        let _ = std::fs::create_dir_all(p);
        // Après un plantage, LibreOffice laisse un rapport (crash/dump.ini) ;
        // au démarrage suivant il prépare une récupération qui, sans écran,
        // bloque ensuite tout enregistrement et toute exportation. Un moteur
        // ne sert qu'un document : rien à récupérer, on retire le rapport.
        let crash = p.join("crash");
        if crash.exists() {
            eprintln!("auxi-engine : rapport de plantage précédent retiré du profil");
            let _ = std::fs::remove_dir_all(&crash);
        }
        url::Url::from_directory_path(p.canonicalize().unwrap_or(p.clone())).map(|u| u.to_string()).unwrap_or_default()
    });

    eprintln!("auxi-engine {} : démarrage de LibreOffice ({})", env!("CARGO_PKG_VERSION"), args.program_dir.display());
    let mut office = match Office::init(&args.program_dir, profile_url.as_deref()) {
        Ok(o) => {
            eprintln!("auxi-engine : LibreOffice initialisé ({})", o.version_info().unwrap_or_default());
            o
        }
        Err(e) => {
            eprintln!("auxi-engine : échec de l'initialisation : {e}");
            send(&out, &json!({"event": "fatal", "error": e}), &[]);
            std::process::exit(1);
        }
    };
    // Ne pas activer LOK_FEATURE_NO_TILED_ANNOTATIONS : avec LibreOffice
    // 26.2 et 26.8, il vide entièrement le rendu des présentations.
    office.set_optional_features(
        sys::LOK_FEATURE_DOCUMENT_PASSWORD
            | sys::LOK_FEATURE_DOCUMENT_PASSWORD_TO_MODIFY
            | sys::LOK_FEATURE_PART_IN_INVALIDATION_CALLBACK,
    );

    // Rappels globaux : mot de passe demandé pendant le chargement, barre de
    // progression. Le mot de passe est fourni (ou refusé) depuis le rappel,
    // comme le prévoit l'API.
    let password: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    {
        let out = out.clone();
        let password = password.clone();
        let kit = office_ptr(&office);
        office.register_callback(Box::new(move |t, payload| {
            if t == sys::LOK_CALLBACK_DOCUMENT_PASSWORD || t == sys::LOK_CALLBACK_DOCUMENT_PASSWORD_TO_MODIFY {
                let pw = password.lock().unwrap().take();
                send(&out, &json!({"event": "password_requested", "provided": pw.is_some()}), &[]);
                unsafe { set_password_raw(kit, &payload, pw.as_deref()) };
                return;
            }
            send(&out, &json!({"event": "callback", "type": t, "name": callback_name(t), "payload": payload}), &[]);
        }));
    }

    let ready = json!({"event": "ready", "libreoffice": office.version_info()});
    let engine = Engine {
        office,
        doc: None,
        out: out.clone(),
        args,
        password,
        deferred: Arc::new(Mutex::new(Vec::new())),
        current_id: Value::Null,
        profile_url,
    };
    run(engine, out, ready);
}

/// LibreOffice fait tourner sa boucle d'événements dans son propre fil
/// (module d'affichage « svp », sans écran, sur toutes les plateformes —
/// sous macOS, LibreOffice est compilé avec --enable-headless, voir
/// scripts/build-engine-macos.sh) ; ce fil-ci lit les requêtes et appelle
/// LibreOfficeKit.
fn run(engine: Engine, out: Out, ready: Value) -> ! {
    run_threaded(engine, out, ready)
}

fn run_threaded(mut engine: Engine, out: Out, ready: Value) -> ! {
    send(&out, &ready, &[]);
    let mut input = BufReader::new(std::io::stdin().lock());
    loop {
        match read_frame(&mut input) {
            Ok(Some(frame)) => {
                if engine.process(frame) {
                    break;
                }
            }
            Ok(None) => break,
            Err(e) => {
                eprintln!("auxi-engine: flux d'entrée invalide : {e}");
                break;
            }
        }
    }
    engine.shutdown()
}

fn office_ptr(o: &Office) -> usize {
    o.raw() as usize
}

unsafe fn set_password_raw(kit: usize, url: &str, password: Option<&str>) {
    let kit = kit as *mut sys::LibreOfficeKit;
    let class = &*(*kit).pClass;
    if let Some(f) = class.setDocumentPassword {
        let u = std::ffi::CString::new(url).unwrap_or_default();
        let p = password.map(|p| std::ffi::CString::new(p).unwrap_or_default());
        f(kit, u.as_ptr(), p.as_ref().map_or(std::ptr::null(), |p| p.as_ptr()));
    }
}
