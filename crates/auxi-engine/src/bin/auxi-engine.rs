//! Processus moteur d'AuxiOffice : héberge LibreOffice (via LibreOfficeKit)
//! pour un document et répond aux requêtes reçues sur l'entrée standard.
//!
//! Utilisation : variables `AUXI_ENGINE_PROGRAM_DIR` (dossier program/ de
//! LibreOffice, obligatoire), `AUXI_ENGINE_PROFILE`, `AUXI_ENGINE_LANG`,
//! `AUXI_ENGINE_AUTHOR`, `AUXI_ENGINE_PROFILE_ROOT`, `AUXI_ENGINE_DOC_LANG`
//! (langue par défaut des documents, fr-CA), `AUXI_ENGINE_GRAMMAR_URL`
//! (serveur AuxiCorrect) ; aucun argument (voir `parse_args`).

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
    doc_lang: String,
    grammar_url: Option<String>,
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
        doc_lang: var("AUXI_ENGINE_DOC_LANG").unwrap_or_else(|| "fr-CA".into()),
        grammar_url: var("AUXI_ENGINE_GRAMMAR_URL"),
    };
    // Ne pas transmettre ces variables aux composants de LibreOffice.
    for k in ["AUXI_ENGINE_PROGRAM_DIR", "AUXI_ENGINE_PROFILE", "AUXI_ENGINE_LANG", "AUXI_ENGINE_AUTHOR", "AUXI_ENGINE_PROFILE_ROOT", "AUXI_ENGINE_DOC_LANG", "AUXI_ENGINE_GRAMMAR_URL"] {
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
        // Avec macros : le projet VBA (vbaProject.bin) est conservé.
        "docm" => "MS Word 2007 XML VBA",
        "doc" => "MS Word 97",
        "odt" => "writer8",
        "rtf" => "Rich Text Format",
        "txt" => "Text",
        "xlsx" => "Calc MS Excel 2007 XML",
        "xlsm" => "Calc MS Excel 2007 VBA XML",
        "xls" => "MS Excel 97",
        "ods" => "calc8",
        "csv" => "Text - txt - csv (StarCalc)",
        "pptx" => "Impress MS PowerPoint 2007 XML",
        "pptm" => "Impress MS PowerPoint 2007 XML VBA",
        "ppt" => "MS PowerPoint 97",
        "odp" => "impress8",
        "odg" => "draw8",
        "fodg" => "OpenDocument Drawing Flat XML",
        _ => return None,
    })
}

/// Le fichier est-il un CSV (d'après son extension) ?
fn is_csv(path: &str) -> bool {
    Path::new(path).extension().is_some_and(|e| e.eq_ignore_ascii_case("csv"))
}

/// Options d'import d'un CSV pour LibreOffice (jetons de ScAsciiOptions :
/// séparateurs, délimiteur de texte, encodage, première ligne, formats de
/// colonnes, langue, guillemets = texte, nombres spéciaux).
///
/// Sans elles, LibreOffice ouvre la boîte « Import de texte » pendant le
/// chargement : sous LibreOfficeKit, elle n'est jamais affichée et le
/// chargement reste bloqué. Séparateur et encodage sont donc devinés ici.
fn csv_import_options(sample: &[u8]) -> String {
    // Encodage : UTF-16 avec BOM, UTF-8 valide (avec ou sans BOM), sinon Windows-1252.
    let (charset, text) = if sample.starts_with(&[0xFF, 0xFE]) || sample.starts_with(&[0xFE, 0xFF]) {
        let le = sample[0] == 0xFF;
        let units: Vec<u16> = sample[2..].chunks_exact(2).map(|c| if le { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) }).collect();
        ("65535", String::from_utf16_lossy(&units))
    } else {
        let s = sample.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(sample);
        match std::str::from_utf8(s) {
            Ok(t) => ("76", t.to_string()),
            // Échantillon coupé au milieu d'un caractère : encore de l'UTF-8.
            Err(e) if e.error_len().is_none() => ("76", String::from_utf8_lossy(&s[..e.valid_up_to()]).into_owned()),
            Err(_) => ("1", s.iter().map(|&b| b as char).collect()),
        }
    };
    // Séparateur : celui qui revient le même nombre de fois (au moins une)
    // sur le plus de lignes, hors des champs entre guillemets.
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).take(30).collect();
    let count = |line: &str, sep: char| {
        let mut quoted = false;
        line.chars().filter(|&c| {
            if c == '"' {
                quoted = !quoted;
            }
            c == sep && !quoted
        }).count()
    };
    let mut best = (',', 0usize, 0usize);
    for sep in [',', ';', '\t', '|'] {
        let counts: Vec<usize> = lines.iter().map(|l| count(l, sep)).collect();
        let Some(&first) = counts.first().filter(|&&n| n > 0) else { continue };
        let same = counts.iter().filter(|&&n| n == first).count();
        if (same, first) > (best.1, best.2) {
            best = (sep, same, first);
        }
    }
    format!("{},34,{charset},1,,0,false,true", best.0 as u32)
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
    /// LibreOffice a demandé le mot de passe d'ouverture pendant le chargement.
    password_asked: Arc<std::sync::atomic::AtomicBool>,
    /// Mot de passe d'ouverture du document chargé (repris par Enregistrer sous).
    doc_password: Option<String>,
    /// Commandes UNO dont le moteur attend lui-même la fin (rappel
    /// UNO_COMMAND_RESULT), sans réponse à l'application.
    waiters: Arc<Mutex<Vec<(String, std::sync::mpsc::Sender<()>)>>>,
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
                let given = string(req, "password").filter(|p| !p.is_empty());
                *self.password.lock().unwrap() = given.map(str::to_owned);
                self.password_asked.store(false, std::sync::atomic::Ordering::SeqCst);
                let mut opts = format!("Language={}", self.args.lang);
                if is_csv(path) {
                    // Le reste des options devient FilterOptions pour LibreOffice.
                    let mut sample = Vec::new();
                    if let Ok(f) = File::open(path) {
                        use std::io::Read;
                        let _ = f.take(64 * 1024).read_to_end(&mut sample);
                    }
                    opts.push(',');
                    opts.push_str(&csv_import_options(&sample));
                }
                let mut doc = match self.office.load(&url, &opts) {
                    Ok(d) => d,
                    // Document chiffré : message reconnu par l'interface, qui
                    // demande alors le mot de passe (LibreOffice ne dit que
                    // « type detection aborted »).
                    Err(_) if self.password_asked.load(std::sync::atomic::Ordering::SeqCst) => {
                        return Err(if given.is_some() { "mot de passe incorrect" } else { "mot de passe requis" }.into());
                    }
                    Err(e) => return Err(e),
                };
                let out = self.out.clone();
                let deferred = self.deferred.clone();
                let waiters = self.waiters.clone();
                doc.register_callback(Box::new(move |t, payload| {
                    if t == sys::LOK_CALLBACK_UNO_COMMAND_RESULT {
                        if let Ok(r) = serde_json::from_str::<Value>(&payload) {
                            waiters.lock().unwrap().retain(|(c, tx)| {
                                let done = r["commandName"] == c.as_str();
                                if done {
                                    let _ = tx.send(());
                                }
                                !done
                            });
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
                self.doc_password = given.map(str::to_owned);
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
                // Fenêtre inconnue de LibreOffice : il laisse le tampon vide et
                // le signale seulement par getError.
                if let Some(e) = self.office.last_error() {
                    return Err(format!("rendu de la fenêtre {} : {e}", int(req, "window")));
                }
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
                if let Some(e) = self.office.last_error() {
                    return Err(format!("fermeture de la fenêtre {} : {e}", int(req, "window")));
                }
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
                // DontTerminateEdit à faux, comme Fichier > Enregistrer de
                // LibreOffice : la cellule en cours de saisie (Ctrl+S sans
                // Entrée) est validée, sinon elle manquait dans le fichier.
                let d = self.doc()?;
                let args = json!({
                    "DontTerminateEdit": {"type": "boolean", "value": false},
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
                // Destination ouverte ailleurs (verrou d'un autre profil : autre
                // onglet, autre utilisateur) : saveAs attendait indéfiniment la
                // réponse à « Document en cours d'utilisation » et le moteur
                // restait bloqué.
                if let Some(owner) = lock_owner(path) {
                    let norm = |s: &str| s.trim_end_matches('/').to_string();
                    let ours = owner["profile"].as_str().zip(self.profile_url.as_deref()).is_some_and(|(p, o)| norm(p) == norm(o));
                    if !ours {
                        let name = Path::new(path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                        let user = owner["user"].as_str().filter(|u| !u.is_empty()).unwrap_or("un autre utilisateur");
                        return Err(format!("« {name} » est déjà ouvert ({user}) : fermez-le d'abord ou choisissez un autre nom."));
                    }
                }
                // CSV : virgule et UTF-8 sur toutes les plateformes (sinon
                // l'encodage du système, Windows-1252 sous Windows).
                let mut options = if is_csv(path) { "44,34,76,1,TakeOwnership" } else { "TakeOwnership" }.to_string();
                // Document chiffré : la copie l'est aussi, comme dans LibreOffice
                // (sans cela, saveAs l'écrivait en clair).
                if let Some(pw) = self.doc_password.as_deref().filter(|_| !is_csv(path)) {
                    options.push_str(&format!(",Password={pw}PASSWORDEND"));
                    // Avec un mot de passe, saveAs (TakeOwnership) ne revient
                    // jamais si le document est modifié : il est d'abord marqué
                    // « non modifié » (son contenu ne change pas).
                    let (tx, rx) = std::sync::mpsc::channel();
                    self.waiters.lock().unwrap().push((".uno:ModifiedStatus".into(), tx));
                    let unmodified = json!({"ModifiedStatus": {"type": "boolean", "value": false}});
                    d.uno(".uno:ModifiedStatus", Some(&unmodified.to_string()), true);
                    let _ = rx.recv_timeout(std::time::Duration::from_secs(10));
                }
                d.save_as(&file_url(path)?, Some(&ext), Some(&options))?;
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
        // Le document est fermé : on quitte sans détruire LibreOffice ni
        // exécuter ses fonctions de fin de programme (atexit). Sous macOS,
        // celles-ci interrompent le processus (« Unspecified Application
        // Error ») ; ailleurs elles sont seulement longues.
        let _ = std::io::stderr().flush();
        #[cfg(unix)]
        unsafe {
            libc::_exit(0)
        }
        #[cfg(not(unix))]
        std::process::exit(0);
    }
}

/// Réglages écrits dans la couche utilisateur de la configuration de
/// LibreOffice (`user/registrymodifications.xcu`), lue à son démarrage.
///
/// - Nom du produit (« %PRODUCTNAME » des messages et boîtes) : AuxiOffice.
/// - Langue par défaut des documents : `AUXI_ENGINE_DOC_LANG` (fr-CA).
/// - Correcteur AuxiCorrect, si `AUXI_ENGINE_GRAMMAR_URL` est fourni : le
///   correcteur « LanguageTool » de LibreOffice interroge ce serveur local
///   (tenu par AuxiOffice) pour le français, et le dictionnaire de
///   LibreOffice ne souligne plus le français (AuxiCorrect s'en charge).
///   Sans l'adresse, ces réglages sont retirés.
struct Item {
    path: &'static str,
    prop: String,
    /// Valeur XML (`<value>…</value>`) ; None : retirer l'élément.
    value: Option<String>,
    list: bool,
}

const CSV_FILTER: &str = "/org.openoffice.TypeDetection.Filter/Filters/org.openoffice.TypeDetection.Filter:Filter['Text - txt - csv (StarCalc)']";

const FRENCH: [&str; 6] = ["fr-CA", "fr-FR", "fr-BE", "fr-CH", "fr-LU", "fr-MC"];

fn profile_items(doc_lang: &str, grammar_url: Option<&str>) -> Vec<Item> {
    let text = |v: &str| Some(format!("<value>{}</value>", xml_escape(v)));
    let mut items = vec![
        Item { path: "/org.openoffice.Setup/Product", prop: "ooName".into(), value: text("AuxiOffice"), list: false },
        Item { path: "/org.openoffice.Setup/Product", prop: "ooVendor".into(), value: text("Projet AuxiNux"), list: false },
        Item { path: "/org.openoffice.Office.Linguistic/General", prop: "DefaultLocale".into(), value: text(doc_lang), list: false },
        // Sous LibreOfficeKit, LibreOffice ouvre toujours la boîte « Import de
        // texte » d'un CSV pendant le chargement (même avec des options) ; sans
        // vue, elle n'est annoncée nulle part et le chargement reste bloqué.
        // Sans composant d'interface, il prend les options données au
        // chargement (voir csv_import_options).
        Item { path: CSV_FILTER, prop: "UIComponent".into(), value: Some("<value></value>".into()), list: false },
    ];
    const LT: &str = "/org.openoffice.Office.Linguistic/GrammarChecking/LanguageTool";
    const LT_LOCALES: &str = "/org.openoffice.Office.Linguistic/ServiceManager/GrammarCheckers/org.openoffice.lingu.LanguageToolGrammarChecker";
    const SPELL: &str = "/org.openoffice.Office.Linguistic/ServiceManager/SpellCheckerList";
    const SPELL_FOUND: &str = "/org.openoffice.Office.Linguistic/ServiceManager/LastFoundSpellCheckers";
    let on = grammar_url.is_some();
    items.push(Item { path: LT, prop: "IsEnabled".into(), value: Some(format!("<value>{on}</value>")), list: false });
    items.push(Item { path: LT, prop: "BaseURL".into(), value: grammar_url.and_then(text), list: false });
    items.push(Item { path: LT, prop: "SSLCertVerify".into(), value: on.then(|| "<value>false</value>".to_string()), list: false });
    items.push(Item { path: LT_LOCALES, prop: "Locales".into(), value: on.then(|| format!("<value>fr {}</value>", FRENCH.join(" "))), list: false });
    const GRAMMAR: &str = "/org.openoffice.Office.Linguistic/ServiceManager/GrammarCheckerList";
    const GRAMMAR_FOUND: &str = "/org.openoffice.Office.Linguistic/ServiceManager/LastFoundGrammarCheckers";
    let lt = "<value><it>org.openoffice.lingu.LanguageToolGrammarChecker</it></value>".to_string();
    for loc in FRENCH {
        // Correcteur grammatical du français écrit d'avance : sinon LibreOffice
        // ne le choisit qu'après un premier calcul différé, et les paragraphes
        // vérifiés avant ne sont jamais envoyés.
        items.push(Item { path: GRAMMAR, prop: loc.into(), value: on.then(|| lt.clone()), list: true });
        items.push(Item { path: GRAMMAR_FOUND, prop: loc.into(), value: on.then(|| lt.clone()), list: true });
    }
    for loc in FRENCH {
        // Liste vide : pas de dictionnaire LibreOffice pour le français ; le
        // dictionnaire est déclaré « déjà vu » pour ne pas être réactivé.
        items.push(Item { path: SPELL, prop: loc.into(), value: on.then(|| "<value></value>".to_string()), list: true });
        items.push(Item {
            path: SPELL_FOUND,
            prop: loc.into(),
            value: on.then(|| "<value><it>org.openoffice.lingu.MySpellSpellChecker</it></value>".to_string()),
            list: true,
        });
    }
    items
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn configure_profile(profile: &Path, items: &[Item]) -> std::io::Result<()> {
    let user = profile.join("user");
    std::fs::create_dir_all(&user)?;
    let file = user.join("registrymodifications.xcu");
    let before = std::fs::read_to_string(&file).unwrap_or_default();
    let mut xml = before.clone();
    if !xml.contains("</oor:items>") {
        xml = concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n",
            "<oor:items xmlns:oor=\"http://openoffice.org/2001/registry\" xmlns:xs=\"http://www.w3.org/2001/XMLSchema\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">\n",
            "</oor:items>\n"
        )
        .to_string();
    }
    for it in items {
        // Retirer toute valeur existante de cette propriété (la nôtre ou celle
        // écrite par LibreOffice), puis ajouter la nôtre.
        let head = format!("<item oor:path=\"{}\"><prop oor:name=\"{}\"", it.path, it.prop);
        while let Some(start) = xml.find(&head) {
            let Some(len) = xml[start..].find("</item>") else { break };
            let mut end = start + len + "</item>".len();
            if xml[end..].starts_with('\n') {
                end += 1;
            }
            xml.replace_range(start..end, "");
        }
        if let Some(v) = &it.value {
            let ty = if it.list { " oor:type=\"oor:string-list\"" } else { "" };
            let at = xml.rfind("</oor:items>").unwrap_or(xml.len());
            xml.insert_str(at, &format!("{head} oor:op=\"fuse\"{ty}>{v}</prop></item>\n"));
        }
    }
    if xml != before {
        std::fs::write(&file, xml)?;
    }
    Ok(())
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
        let items = profile_items(&args.doc_lang, args.grammar_url.as_deref());
        if let Err(e) = configure_profile(p, &items) {
            eprintln!("auxi-engine : réglages non appliqués au profil : {e}");
        }
        if args.grammar_url.is_some() {
            eprintln!("auxi-engine : correction du français par AuxiCorrect");
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
    let password_asked = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let out = out.clone();
        let password = password.clone();
        let asked = password_asked.clone();
        let kit = office_ptr(&office);
        office.register_callback(Box::new(move |t, payload| {
            if t == sys::LOK_CALLBACK_DOCUMENT_PASSWORD || t == sys::LOK_CALLBACK_DOCUMENT_PASSWORD_TO_MODIFY {
                if t == sys::LOK_CALLBACK_DOCUMENT_PASSWORD {
                    asked.store(true, std::sync::atomic::Ordering::SeqCst);
                }
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
        password_asked,
        doc_password: None,
        waiters: Arc::new(Mutex::new(Vec::new())),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_separator_and_encoding_are_guessed() {
        assert_eq!(csv_import_options(b"a,b,c\n1,2,3\n"), "44,34,76,1,,0,false,true");
        // Point-virgule (tableurs français), virgule décimale et guillemets.
        assert_eq!(csv_import_options("Nom;Montant\nCafé;1 234,56\n\"a;b\";2\n".as_bytes()), "59,34,76,1,,0,false,true");
        assert_eq!(csv_import_options(b"a\tb\n1\t2,5\n"), "9,34,76,1,,0,false,true");
        // Windows-1252 (é = 0xE9), UTF-8 avec BOM, UTF-16.
        assert_eq!(csv_import_options(b"Caf\xe9;cr\xe8me\n1;2\n"), "59,34,1,1,,0,false,true");
        assert_eq!(csv_import_options(b"\xEF\xBB\xBFa;b\n"), "59,34,76,1,,0,false,true");
        let utf16: Vec<u8> = [0xFF, 0xFE].into_iter().chain("x;y\n".encode_utf16().flat_map(u16::to_le_bytes)).collect();
        assert_eq!(csv_import_options(&utf16), "59,34,65535,1,,0,false,true");
        // Échantillon coupé au milieu d'un caractère, fichier vide.
        assert_eq!(csv_import_options(&"é;é\n".as_bytes()[..4]), "59,34,76,1,,0,false,true");
        assert_eq!(csv_import_options(b""), "44,34,76,1,,0,false,true");
    }

    #[test]
    fn macro_formats_can_be_saved() {
        assert_eq!(filter_for("/a/Rapport l'été.DOCM"), Some("MS Word 2007 XML VBA"));
        assert_eq!(filter_for("b.xlsm"), Some("Calc MS Excel 2007 VBA XML"));
        assert_eq!(filter_for("c.pptm"), Some("Impress MS PowerPoint 2007 XML VBA"));
        assert_eq!(filter_for("d.pdf"), None);
    }
}
