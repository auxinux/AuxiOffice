//! Coque AuxiOffice : fenêtre Tauri, gestion des moteurs (un processus
//! `auxi-engine` par document ouvert) et pont vers l'interface.

mod apps;
mod print;

use apps::{AppKind, Launch};
use auxi_engine::client::{Engine, EngineConfig};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

/// Application lancée (AuxiOffice, AuxiWriter…) et lancements reçus que
/// l'interface n'a pas encore traités (fichiers à ouvrir, document vierge).
struct AppState {
    kind: AppKind,
    data_dir: PathBuf,
    pending: Mutex<Vec<Launch>>,
}

#[derive(Default)]
struct Engines {
    docs: Mutex<HashMap<u64, Arc<Engine>>>,
    next: AtomicU64,
    /// Moteur démarré d'avance (LibreOffice déjà initialisé) : l'ouverture
    /// d'un document n'attend plus le démarrage de LibreOffice. Son numéro
    /// de document lui est attribué au moment où il est pris.
    spare: Mutex<Option<(Engine, Arc<AtomicU64>, usize)>>,
    /// Profils LibreOffice : un par moteur en marche (deux LibreOffice ne
    /// doivent jamais partager un profil). Réutilisés après fermeture.
    slots: Mutex<Vec<bool>>,
    doc_slots: Mutex<HashMap<u64, usize>>,
}

impl Engines {
    fn alloc_slot(&self) -> usize {
        let mut s = self.slots.lock().unwrap();
        match s.iter().position(|used| !used) {
            Some(i) => {
                s[i] = true;
                i
            }
            None => {
                s.push(true);
                s.len() - 1
            }
        }
    }

    fn free_slot(&self, i: usize) {
        if let Some(used) = self.slots.lock().unwrap().get_mut(i) {
            *used = false;
        }
    }
}

/// Démarre un moteur de réserve en arrière-plan (s'il n'y en a pas déjà un).
fn prepare_spare(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Engines>();
        if state.spare.lock().unwrap().is_some() {
            return;
        }
        let profile = state.alloc_slot();
        let Ok(cfg) = engine_config(&app, profile) else {
            state.free_slot(profile);
            return;
        };
        let slot = Arc::new(AtomicU64::new(0));
        let (emitter, s) = (app.clone(), slot.clone());
        let sink = Box::new(move |mut ev: Value| {
            let id = s.load(Ordering::Relaxed);
            if id != 0 {
                ev["doc"] = json!(id);
                let _ = emitter.emit("engine", ev);
            }
        });
        match Engine::spawn(&cfg, sink) {
            Ok(engine) => {
                let mut spare = state.spare.lock().unwrap();
                if spare.is_none() {
                    *spare = Some((engine, slot, profile));
                } else {
                    drop(spare);
                    engine.shutdown();
                    state.free_slot(profile);
                }
            }
            Err(_) => state.free_slot(profile),
        }
    });
}

/// Moteur pour le document `id` : la réserve si elle est prête, sinon un neuf.
fn take_engine(app: &AppHandle, id: u64) -> Result<(Engine, usize), String> {
    let state = app.state::<Engines>();
    let spare = state.spare.lock().unwrap().take();
    if let Some((engine, slot, profile)) = spare {
        if engine.is_alive() {
            slot.store(id, Ordering::Relaxed);
            return Ok((engine, profile));
        }
        state.free_slot(profile);
    }
    let profile = state.alloc_slot();
    let spawned = engine_config(app, profile).and_then(|cfg| {
        let emitter = app.clone();
        Engine::spawn(&cfg, Box::new(move |mut ev| {
            ev["doc"] = json!(id);
            let _ = emitter.emit("engine", ev);
        }))
    });
    match spawned {
        Ok(engine) => Ok((engine, profile)),
        Err(e) => {
            state.free_slot(profile);
            Err(e)
        }
    }
}

impl Engines {
    fn get(&self, doc: u64) -> Result<Arc<Engine>, String> {
        self.docs.lock().unwrap().get(&doc).cloned().ok_or_else(|| "document fermé".to_string())
    }
}

/// Où chercher `auxi-engine`, LibreOffice et les modèles, dans l'ordre :
/// 1. variables `AUXI_ENGINE_EXE`, `AUXI_LO_PROGRAM`, `AUXI_TEMPLATES` ;
/// 2. l'application elle-même (paquets) : à côté de l'exécutable
///    (`engine/program/`, `templates/`) ou, sous macOS, dans `Contents/Resources`
///    (`engine/*.app`, `templates/`) ;
/// 3. sous macOS, le paquet `AuxiOffice.app` voisin (AuxiWriter.app… n'embarquent
///    pas LibreOffice) ;
/// 4. l'arbre de développement : fichier `dev-root` dans les ressources, ou
///    exécutable dans `target/<profil>/` du dépôt (`.engine/<plateforme>/program-dir`).
struct Locations {
    engine_exe: PathBuf,
    program_dir: PathBuf,
    templates: PathBuf,
}

fn locate() -> Result<Locations, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe.parent().map(Path::to_path_buf).unwrap_or_default();
    let engine_name = if cfg!(windows) { "auxi-engine.exe" } else { "auxi-engine" };
    // Racines candidates : (dossier de l'exécutable, dossier des ressources).
    let mut roots: Vec<(PathBuf, PathBuf)> = vec![];
    let resources = if cfg!(target_os = "macos") { exe_dir.join("../Resources") } else { exe_dir.clone() };
    roots.push((exe_dir.clone(), resources.clone()));
    if cfg!(target_os = "macos") {
        if let Some(apps) = exe_dir.parent().and_then(Path::parent).and_then(Path::parent) {
            let main = apps.join("AuxiOffice.app/Contents");
            roots.push((main.join("MacOS"), main.join("Resources")));
        }
    }
    let mut dev: Vec<PathBuf> = vec![];
    if let Ok(r) = std::fs::read_to_string(resources.join("dev-root")) {
        dev.push(PathBuf::from(r.trim()));
    }
    if let Some(repo) = exe_dir.parent().and_then(Path::parent) {
        dev.push(repo.to_path_buf());
    }
    let program_in = |res: &Path| -> Option<PathBuf> {
        let p = res.join("engine").join("program");
        if p.is_dir() {
            return Some(p);
        }
        // macOS : engine/LibreOffice*.app/Contents/Frameworks
        std::fs::read_dir(res.join("engine")).ok()?.flatten().map(|e| e.path().join("Contents/Frameworks")).find(|p| p.is_dir())
    };
    let mut found: Option<Locations> = None;
    for (bin, res) in &roots {
        if let (true, Some(program_dir)) = (bin.join(engine_name).is_file(), program_in(res)) {
            found = Some(Locations { engine_exe: bin.join(engine_name), program_dir, templates: res.join("templates") });
            break;
        }
    }
    if found.is_none() {
        for repo in &dev {
            let Some(platform) = dev_platform() else { break };
            let Ok(program) = std::fs::read_to_string(repo.join(".engine").join(platform).join("program-dir")) else { continue };
            let profile = if exe_dir.ends_with("debug") { "debug" } else { "release" };
            let engine = [exe_dir.join(engine_name), repo.join("target").join(profile).join(engine_name)].into_iter().find(|p| p.is_file());
            if let Some(engine_exe) = engine {
                found = Some(Locations { engine_exe, program_dir: PathBuf::from(program.trim()), templates: repo.join("app/src-tauri/templates") });
                break;
            }
        }
    }
    let mut loc = found.unwrap_or_else(|| Locations {
        engine_exe: exe_dir.join(engine_name),
        program_dir: exe_dir.join("engine").join("program"),
        templates: resources.join("templates"),
    });
    if let Some(v) = std::env::var_os("AUXI_ENGINE_EXE") {
        loc.engine_exe = v.into();
    }
    if let Some(v) = std::env::var_os("AUXI_LO_PROGRAM") {
        loc.program_dir = v.into();
    }
    if let Some(v) = std::env::var_os("AUXI_TEMPLATES") {
        loc.templates = v.into();
    }
    Ok(loc)
}

fn dev_platform() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => Some("linux-x86_64"),
        ("macos", "aarch64") => Some("macos-aarch64"),
        ("windows", "x86_64") => Some("windows-x86_64"),
        _ => None,
    }
}

fn engine_config(app: &AppHandle, slot: usize) -> Result<EngineConfig, String> {
    let Locations { engine_exe, program_dir, .. } = locate()?;
    if !engine_exe.exists() {
        return Err(format!("moteur introuvable : {}", engine_exe.display()));
    }
    if !program_dir.exists() {
        return Err(format!("LibreOffice introuvable : {}", program_dir.display()));
    }
    // Profils propres à chaque application : AuxiWriter et AuxiSheet tournent
    // dans des processus distincts et ne doivent pas se partager un profil.
    let data_dir = app.path().app_data_dir().ok();
    let kind = app.state::<AppState>().kind;
    let profile_root = data_dir.as_ref().map(|d| d.join("moteur").join(kind.slug()));
    let profile_dir = profile_root.as_ref().map(|d| d.join(format!("profil-{slot}")));
    let log_file = data_dir.as_ref().map(|d| d.join("moteur.log"));
    Ok(EngineConfig {
        engine_exe,
        program_dir,
        profile_dir,
        lang: std::env::var("AUXI_LANG").unwrap_or_else(|_| "fr-FR".into()),
        author: user_name(),
        log_file,
        profile_root,
    })
}

fn user_name() -> String {
    std::env::var("AUXI_AUTHOR")
        .or_else(|_| std::env::var("USERNAME"))
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_default()
}

/// Ouvre un document dans un nouveau moteur. Les rappels du moteur sont
/// relayés à l'interface sous l'événement `engine` avec l'identifiant du document.
#[tauri::command]
async fn doc_open(app: AppHandle, state: State<'_, Engines>, path: String, ignore_lock: Option<bool>) -> Result<Value, String> {
    let id = state.next.fetch_add(1, Ordering::Relaxed) + 1;
    let a = app.clone();
    let (engine, profile) = tauri::async_runtime::spawn_blocking(move || take_engine(&a, id)).await.map_err(|e| e.to_string())??;
    let engine = Arc::new(engine);
    state.doc_slots.lock().unwrap().insert(id, profile);
    // Préparer déjà le moteur du document suivant.
    prepare_spare(&app);
    let e = engine.clone();
    let req = json!({"cmd": "load", "path": path, "ignore_lock": ignore_lock.unwrap_or(false)});
    let loaded = tauri::async_runtime::spawn_blocking(move || e.call(req)).await.map_err(|e| e.to_string())?;
    let mut info = match loaded {
        Ok(info) => info,
        Err(err) => {
            // Ouverture refusée : libérer moteur et profil.
            let e = engine.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || e.shutdown()).await;
            if let Some(p) = state.doc_slots.lock().unwrap().remove(&id) {
                state.free_slot(p);
            }
            return Err(err);
        }
    };
    info["doc"] = json!(id);
    info["path"] = json!(path);
    info["libreoffice"] = json!(engine.libreoffice);
    state.docs.lock().unwrap().insert(id, engine);
    Ok(info)
}

/// Requête générique vers le moteur d'un document (commandes du protocole).
#[tauri::command]
async fn doc_call(state: State<'_, Engines>, doc: u64, req: Value) -> Result<Value, String> {
    let engine = state.get(doc)?;
    tauri::async_runtime::spawn_blocking(move || engine.call(req)).await.map_err(|e| e.to_string())?
}

/// Rendu d'une tuile, ou d'une fenêtre de LibreOffice si `req.window` est
/// présent : retourne directement les octets RGBA.
#[tauri::command]
async fn doc_paint(state: State<'_, Engines>, doc: u64, req: Value) -> Result<tauri::ipc::Response, String> {
    let engine = state.get(doc)?;
    let mut req = req;
    req["cmd"] = json!(if req.get("window").is_some() { "paint_window" } else { "paint" });
    let reply = tauri::async_runtime::spawn_blocking(move || engine.request(req, &[], Duration::from_secs(60)))
        .await
        .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(reply.bin))
}

#[tauri::command]
async fn doc_close(state: State<'_, Engines>, doc: u64) -> Result<(), String> {
    let engine = state.docs.lock().unwrap().remove(&doc);
    if let Some(engine) = engine {
        tauri::async_runtime::spawn_blocking(move || engine.shutdown()).await.map_err(|e| e.to_string())?;
    }
    if let Some(p) = state.doc_slots.lock().unwrap().remove(&doc) {
        state.free_slot(p);
    }
    Ok(())
}

/// Crée un document vierge à partir des modèles livrés, dans un fichier
/// temporaire ; l'interface demandera un emplacement au premier enregistrement.
#[tauri::command]
fn new_document(app: AppHandle, kind: String) -> Result<String, String> {
    let ext = match kind.as_str() {
        "text" => "docx",
        "spreadsheet" => "xlsx",
        "presentation" => "pptx",
        _ => return Err(format!("type inconnu : {kind}")),
    };
    let template = templates_dir(&app)?.join(format!("vierge.{ext}"));
    let dir = std::env::temp_dir().join("AuxiOffice");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let target = dir.join(format!("Sans titre {stamp}.{ext}"));
    std::fs::copy(&template, &target).map_err(|e| format!("{} : {e}", template.display()))?;
    Ok(target.to_string_lossy().into_owned())
}

fn templates_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    locate().map(|l| l.templates)
}

/// Fichiers récents (simple liste JSON dans le dossier de données).
#[tauri::command]
fn recent_files(app: AppHandle, add: Option<String>) -> Result<Vec<String>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let file = dir.join("recents.json");
    let mut list: Vec<String> = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    if let Some(p) = add {
        if !p.contains(&format!("{}AuxiOffice{}", std::path::MAIN_SEPARATOR, std::path::MAIN_SEPARATOR)) {
            list.retain(|x| x != &p);
            list.insert(0, p);
            list.truncate(20);
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            std::fs::write(&file, serde_json::to_vec_pretty(&list).unwrap()).map_err(|e| e.to_string())?;
        }
    }
    list.retain(|p| Path::new(p).exists());
    Ok(list)
}

/// Exporte le document en PDF (pages choisies) dans un fichier temporaire.
fn export_for_print(engine: &Engine, title: &str, pages: &str) -> Result<PathBuf, String> {
    let pages = pages.trim();
    if !pages.chars().all(|c| c.is_ascii_digit() || matches!(c, ',' | '-' | ' ' | ';')) {
        return Err(format!("pages invalides : « {pages} » (exemple : 1-3, 5)"));
    }
    // Le nom du fichier sert de titre à la tâche d'impression.
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let dir = std::env::temp_dir().join("AuxiOffice").join(format!("impression-{stamp}"));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stem = Path::new(title).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let safe: String = stem.chars().map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { '_' } else { c }).collect();
    let pdf = dir.join(format!("{}.pdf", if safe.trim().is_empty() { "Document" } else { safe.trim() }));
    let mut req = json!({"cmd": "save", "path": pdf, "format": "pdf"});
    if !pages.is_empty() {
        req["filter"] = json!(json!({"PageRange": {"type": "string", "value": pages.replace(';', ",")}}).to_string());
    }
    engine.request(req, &[], Duration::from_secs(300))?;
    Ok(pdf)
}

/// Imprimantes du système (CUPS).
#[tauri::command]
async fn printers() -> Result<Vec<print::Printer>, String> {
    tauri::async_runtime::spawn_blocking(print::list_printers).await.map_err(|e| e.to_string())
}

/// Imprime le document : export PDF des pages choisies puis envoi à `lp`.
#[tauri::command]
async fn print_document(state: State<'_, Engines>, doc: u64, title: String, pages: String, options: print::PrintOptions) -> Result<String, String> {
    let engine = state.get(doc)?;
    tauri::async_runtime::spawn_blocking(move || {
        let pdf = export_for_print(&engine, &title, &pages)?;
        print::print_pdf(&pdf, &options)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Ouvre le PDF du document dans l'aperçu du système (sa boîte d'impression).
#[tauri::command]
async fn print_with_system(state: State<'_, Engines>, doc: u64, title: String, pages: String) -> Result<(), String> {
    let engine = state.get(doc)?;
    tauri::async_runtime::spawn_blocking(move || {
        let pdf = export_for_print(&engine, &title, &pages)?;
        print::open_with_system(&pdf)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Démarre le moteur de réserve. Appelé par l'interface une fois affichée :
/// lancé plus tôt, le démarrage de LibreOffice retarde l'affichage de la
/// fenêtre (initialisation concurrente des polices).
#[tauri::command]
fn warm_engine(app: AppHandle) {
    prepare_spare(&app);
}

/// Application lancée.
#[tauri::command]
fn app_info(state: State<'_, AppState>) -> Value {
    json!({"kind": state.kind, "name": state.kind.name()})
}

/// Lancements en attente (ligne de commande, Finder, second lancement) ;
/// l'interface les demande au démarrage et à chaque événement `launch`.
#[tauri::command]
fn take_launches(state: State<'_, AppState>) -> Vec<Launch> {
    std::mem::take(&mut *state.pending.lock().unwrap())
}

/// Ouvre une autre application (AuxiSheet pour un classeur…) : lui transmet
/// les fichiers si elle est déjà ouverte, sinon la démarre.
#[tauri::command]
fn launch_app(state: State<'_, AppState>, kind: AppKind, files: Vec<String>, new_doc: bool) -> Result<(), String> {
    apps::launch(&state.data_dir, kind, &Launch { files, new_doc })
}

/// Répartit des fichiers entre les applications : retourne ceux que celle-ci
/// ouvre et confie les autres à la bonne (un classeur ouvert depuis
/// AuxiWriter part dans AuxiSheet ; AuxiOffice confie tout).
#[tauri::command]
fn route_files(state: State<'_, AppState>, files: Vec<String>) -> Result<Vec<String>, String> {
    let mut mine = Vec::new();
    let mut others: Vec<(AppKind, Vec<String>)> = Vec::new();
    for f in files {
        let k = AppKind::for_path(&f);
        if k == state.kind {
            mine.push(f);
        } else if let Some(o) = others.iter_mut().find(|(o, _)| *o == k) {
            o.1.push(f);
        } else {
            others.push((k, vec![f]));
        }
    }
    for (k, files) in others {
        apps::launch(&state.data_dir, k, &Launch { files, new_doc: false })?;
    }
    Ok(mine)
}

fn queue_launch(app: &AppHandle, l: Launch) {
    app.state::<AppState>().pending.lock().unwrap().push(l);
    let _ = app.emit("launch", ());
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Avant les applications séparées, les profils étaient rangés directement
/// sous `moteur/` (`profil-N`, `user`, `crash`) : on les retire.
fn remove_old_profiles(data_dir: &Path) {
    let Ok(entries) = std::fs::read_dir(data_dir.join("moteur")) else { return };
    for e in entries.flatten() {
        let n = e.file_name().to_string_lossy().into_owned();
        let old = n == "user" || n == "crash" || n.strip_prefix("profil-").is_some_and(|d| d.chars().all(|c| c.is_ascii_digit()));
        if old && e.path().is_dir() {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}

/// Dossier de données (le même pour les quatre applications), calculé avant
/// le démarrage de Tauri pour l'instance unique.
fn data_dir_for(identifier: &str) -> PathBuf {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let base = if cfg!(target_os = "macos") {
        home.join("Library").join("Application Support")
    } else if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| home.join("AppData").join("Roaming"))
    } else {
        std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).filter(|p| p.is_absolute()).unwrap_or_else(|| home.join(".local").join("share"))
    };
    base.join(identifier)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    let data_dir = data_dir_for(&context.config().identifier);
    let args: Vec<String> = std::env::args().skip(1).collect();
    // Nom d'appel d'abord : un lien `auxiwriter` → `auxioffice` (Linux) lance AuxiWriter.
    let argv0 = PathBuf::from(std::env::args().next().unwrap_or_default());
    let exe = if argv0.file_stem().and_then(|s| s.to_str()).and_then(AppKind::parse).is_some() {
        argv0
    } else {
        std::env::current_exe().unwrap_or_default()
    };
    let (kind, launch) = apps::parse_args(&args, &exe, std::env::var("AUXI_APP").ok().as_deref());
    // Application déjà ouverte : lui confier les fichiers et s'arrêter.
    if apps::forward(&data_dir, kind, &launch) {
        eprintln!("{} est déjà ouvert : demande transmise à sa fenêtre. Pour lancer une nouvelle version, fermez-le d'abord.", kind.name());
        return;
    }
    remove_old_profiles(&data_dir);
    let initial = if launch == Launch::default() { vec![] } else { vec![launch] };
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Engines::default())
        .manage(AppState { kind, data_dir: data_dir.clone(), pending: Mutex::new(initial) })
        .setup(move |app| {
            let handle = app.handle().clone();
            if let Err(e) = apps::listen(&data_dir, kind, move |l| queue_launch(&handle, l)) {
                eprintln!("{} : instance unique indisponible ({e})", kind.name());
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_title(kind.name());
                if let Ok(icon) = tauri::image::Image::from_bytes(kind.icon_png()) {
                    let _ = w.set_icon(icon);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            doc_open,
            doc_call,
            doc_paint,
            doc_close,
            new_document,
            recent_files,
            app_info,
            take_launches,
            launch_app,
            route_files,
            warm_engine,
            printers,
            print_document,
            print_with_system
        ])
        .build(context)
        .expect("démarrage d'AuxiOffice")
        .run(|app, event| {
            // macOS : documents ouverts depuis le Finder (double-clic, « Ouvrir avec »).
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                let files: Vec<String> = urls.iter().filter_map(|u| u.to_file_path().ok()).map(|p| p.to_string_lossy().into_owned()).collect();
                if !files.is_empty() {
                    queue_launch(app, Launch { files, new_doc: false });
                }
            }
            if let tauri::RunEvent::Exit = event {
                let st = app.state::<AppState>();
                apps::unlisten(&st.data_dir, st.kind);
                let engines = app.state::<Engines>();
                let mut all: Vec<_> = engines.docs.lock().unwrap().drain().map(|(_, e)| e).collect();
                if let Some((spare, _, _)) = engines.spare.lock().unwrap().take() {
                    all.push(Arc::new(spare));
                }
                eprintln!("AuxiOffice : fermeture, arrêt de {} moteur(s)", all.len());
                for e in all {
                    e.shutdown();
                }
            }
        });
}
