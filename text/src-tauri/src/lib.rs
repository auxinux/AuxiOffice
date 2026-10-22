//! Coque d'AuxiText : fenêtres Tauri, lecture et écriture des fichiers
//! (`textio`), instance unique (`instance`), thème du bureau (`theme`),
//! préférences et fichiers récents. L'édition elle-même est dans la page
//! (CodeMirror, `text/ui`).
//!
//! AuxiText ne dépend pas d'AuxiOffice : il s'installe seul. Quand la suite
//! est présente, « Ouvrir dans AuxiWriter » lance `auxioffice --app writer`.

mod instance;
mod textio;
mod theme;

use instance::Launch;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use textio::{Eol, Opened, Stat, TextError};

const RECENT_MAX: usize = 15;

struct AppState {
    data_dir: PathBuf,
    config_dir: PathBuf,
    /// Fichiers à ouvrir que chaque fenêtre n'a pas encore pris.
    pending: Mutex<HashMap<String, Vec<String>>>,
    /// Dernière fenêtre active : elle reçoit les fichiers d'un second lancement.
    focused: Mutex<String>,
    next_window: AtomicU32,
    port: Mutex<Option<u16>>,
}

// --- Fichiers ---------------------------------------------------------------

#[tauri::command]
async fn read_text(path: String, encoding: Option<String>, force: Option<bool>) -> Result<Opened, TextError> {
    tauri::async_runtime::spawn_blocking(move || textio::read_file(Path::new(&path), encoding.as_deref(), force.unwrap_or(false)))
        .await
        .unwrap_or_else(|e| Err(TextError { code: "io", message: e.to_string(), size: None, ch: None, line: None }))
}

#[tauri::command]
async fn write_text(path: String, text: String, encoding: String, bom: bool, eol: Eol) -> Result<Stat, TextError> {
    tauri::async_runtime::spawn_blocking(move || textio::write_file(Path::new(&path), &text, &encoding, bom, eol))
        .await
        .unwrap_or_else(|e| Err(TextError { code: "io", message: e.to_string(), size: None, ch: None, line: None }))
}

#[tauri::command]
fn stat_files(paths: Vec<String>) -> Vec<Stat> {
    paths.iter().map(|p| textio::stat(Path::new(p))).collect()
}

// --- Préférences et fichiers récents ----------------------------------------

fn read_json(file: &Path) -> Option<Value> {
    std::fs::read(file).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

fn write_json(file: &Path, v: &Value) -> Result<(), String> {
    if let Some(d) = file.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_vec_pretty(v).map_err(|e| e.to_string())?;
    textio::write_atomic(file, &body).map_err(|e| format!("{} : {e}", file.display()))
}

/// Préférences brutes (l'interface les vérifie et complète).
#[tauri::command]
fn prefs_load(state: tauri::State<'_, AppState>) -> Value {
    read_json(&state.config_dir.join("preferences.json")).unwrap_or(json!({}))
}

/// Enregistre les préférences et les transmet aux autres fenêtres.
#[tauri::command]
fn prefs_save(app: AppHandle, window: WebviewWindow, state: tauri::State<'_, AppState>, prefs: Value) -> Result<(), String> {
    write_json(&state.config_dir.join("preferences.json"), &prefs)?;
    for (label, w) in app.webview_windows() {
        if label != window.label() {
            let _ = w.emit_to(label.as_str(), "prefs", &prefs);
        }
    }
    Ok(())
}

/// Liste des fichiers récents, le plus récent d'abord. `add` le place en
/// tête, `remove` le retire (fichier disparu), `clear` vide la liste.
#[tauri::command]
fn recent_files(app: AppHandle, state: tauri::State<'_, AppState>, add: Option<String>, remove: Option<String>, clear: Option<bool>) -> Vec<String> {
    let file = state.data_dir.join("recent.json");
    let mut list: Vec<String> = read_json(&file).and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
    let before = list.clone();
    if clear == Some(true) {
        list.clear();
    }
    if let Some(r) = remove {
        list.retain(|p| *p != r);
    }
    if let Some(a) = add {
        list.retain(|p| *p != a);
        list.insert(0, a);
    }
    list.truncate(RECENT_MAX);
    if list != before {
        let _ = write_json(&file, &json!(list));
        let _ = app.emit("recent", &list);
    }
    list
}

// --- Fenêtres et lancements -------------------------------------------------

/// Fichiers transmis à cette fenêtre (arguments, second lancement).
#[tauri::command]
fn take_launches(window: WebviewWindow, state: tauri::State<'_, AppState>) -> Vec<String> {
    state.pending.lock().unwrap().remove(window.label()).unwrap_or_default()
}

#[tauri::command]
async fn new_window(app: AppHandle, files: Vec<String>) -> Result<(), String> {
    create_window(&app, files)
}

fn create_window(app: &AppHandle, files: Vec<String>) -> Result<(), String> {
    let state = app.state::<AppState>();
    let n = state.next_window.fetch_add(1, Ordering::Relaxed);
    let label = if n == 0 { "main".to_string() } else { format!("w{n}") };
    state.pending.lock().unwrap().insert(label.clone(), files);
    // Thème GTK (barre de menus) connu d'avance. Pas de couleur de fond
    // imposée : elle s'appliquerait aussi à la barre de menus et la
    // rendrait illisible après un changement de thème.
    let forced = read_json(&state.config_dir.join("preferences.json")).and_then(|p| p.get("theme").and_then(|t| t.as_str()).map(str::to_string));
    let dark = match forced.as_deref() {
        Some("dark") => true,
        Some("light") => false,
        _ => theme::system_is_dark().unwrap_or(false),
    };
    let mut b = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("AuxiText")
        .inner_size(1000.0, 720.0)
        .min_inner_size(480.0, 320.0)
        .theme(Some(if dark { tauri::Theme::Dark } else { tauri::Theme::Light }));
    if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")) {
        b = b.icon(icon).map_err(|e| e.to_string())?;
    }
    b.build().map_err(|e| e.to_string())?;
    *state.focused.lock().unwrap() = label;
    Ok(())
}

/// Lancement reçu d'un second processus : fichiers dans la dernière fenêtre
/// active, ou nouvelle fenêtre (`--new-window`, ou aucun fichier).
fn on_launch(app: &AppHandle, l: Launch) {
    let state = app.state::<AppState>();
    let target = {
        let focused = state.focused.lock().unwrap().clone();
        let windows = app.webview_windows();
        if windows.contains_key(&focused) {
            Some(focused)
        } else {
            windows.keys().next().cloned()
        }
    };
    match target {
        Some(label) if !l.new_window && !l.files.is_empty() => {
            state.pending.lock().unwrap().entry(label.clone()).or_default().extend(l.files);
            let _ = app.emit_to(label.as_str(), "launch", ());
            if let Some(w) = app.get_webview_window(&label) {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
        _ => {
            let app2 = app.clone();
            // Création de fenêtre : sur le fil principal.
            let _ = app.run_on_main_thread(move || {
                if let Err(e) = create_window(&app2, l.files) {
                    eprintln!("AuxiText : nouvelle fenêtre impossible ({e})");
                }
            });
        }
    }
}

// --- Divers -----------------------------------------------------------------

/// AuxiWriter (suite AuxiOffice) : `auxioffice` à côté de notre exécutable,
/// dans le PATH, ou désigné par `AUXI_OFFICE_EXE`.
fn office_exe() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("AUXI_OFFICE_EXE").map(PathBuf::from) {
        return p.is_file().then_some(p);
    }
    let names: &[&str] = if cfg!(windows) { &["AuxiOffice.exe", "auxioffice.exe"] } else { &["auxioffice", "AuxiOffice"] };
    let mut dirs: Vec<PathBuf> = vec![];
    if let Some(d) = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)) {
        dirs.push(d);
    }
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    dirs.push(PathBuf::from("/opt/auxioffice"));
    dirs.iter().flat_map(|d| names.iter().map(move |n| d.join(n))).find(|p| p.is_file())
}

#[cfg(target_os = "macos")]
fn writer_bundle() -> Option<PathBuf> {
    let mut dirs = vec![];
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join("Applications"));
    }
    dirs.push(PathBuf::from("/Applications"));
    dirs.into_iter().map(|d| d.join("AuxiWriter.app")).find(|b| b.join("Contents/Info.plist").is_file())
}

fn writer_available() -> bool {
    #[cfg(target_os = "macos")]
    if writer_bundle().is_some() {
        return true;
    }
    office_exe().is_some()
}

#[tauri::command]
fn open_in_writer(path: String) -> Result<(), String> {
    let mut c;
    #[cfg(target_os = "macos")]
    if let Some(b) = writer_bundle() {
        c = std::process::Command::new("open");
        c.arg("-a").arg(b).arg(&path);
        return c.stdin(std::process::Stdio::null()).spawn().map(|_| ()).map_err(|e| e.to_string());
    }
    let exe = office_exe().ok_or("AuxiOffice n'est pas installé.")?;
    c = std::process::Command::new(exe);
    c.args(["--app", "writer"]).arg(&path);
    c.stdin(std::process::Stdio::null()).spawn().map(|_| ()).map_err(|e| format!("Lancement d'AuxiWriter impossible : {e}"))
}

#[tauri::command]
fn app_info() -> Value {
    json!({ "version": env!("CARGO_PKG_VERSION"), "writer": writer_available(), "platform": std::env::consts::OS })
}

/// Thème du bureau : `"dark"`, `"light"`, ou `null` (inconnu).
#[tauri::command]
async fn system_theme() -> Option<&'static str> {
    tauri::async_runtime::spawn_blocking(|| theme::system_is_dark().map(|d| if d { "dark" } else { "light" })).await.ok().flatten()
}

/// Imprime la page (l'interface a préparé sa vue imprimable).
#[tauri::command]
fn print_page(window: WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

/// Dossiers de l'application, calculés avant Tauri (instance unique) et
/// comme lui : `~/.local/share/<id>` (données : instance, fichiers récents)
/// et `~/.config/<id>` (préférences) sous Linux ; un seul dossier ailleurs.
fn user_dir(identifier: &str, xdg: &str, fallback: &str) -> PathBuf {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let base = if cfg!(target_os = "macos") {
        home.join("Library").join("Application Support")
    } else if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| home.join("AppData").join("Roaming"))
    } else {
        std::env::var_os(xdg).map(PathBuf::from).filter(|p| p.is_absolute()).unwrap_or_else(|| home.join(fallback))
    };
    base.join(identifier)
}

fn data_dir_for(identifier: &str) -> PathBuf {
    user_dir(identifier, "XDG_DATA_HOME", ".local/share")
}

fn config_dir_for(identifier: &str) -> PathBuf {
    user_dir(identifier, "XDG_CONFIG_HOME", ".config")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    let data_dir = data_dir_for(&context.config().identifier);
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--version" || a == "-V") {
        println!("AuxiText {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    let launch = instance::parse_args(&args, &cwd);
    // Déjà ouvert : lui confier les fichiers et s'arrêter.
    if instance::forward(&data_dir, &launch) {
        return;
    }
    let initial = launch.files;
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            data_dir: data_dir.clone(),
            config_dir: config_dir_for(&context.config().identifier),
            pending: Mutex::new(HashMap::new()),
            focused: Mutex::new(String::new()),
            next_window: AtomicU32::new(0),
            port: Mutex::new(None),
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            match instance::listen(&data_dir, move |l| on_launch(&handle, l)) {
                Ok(port) => *app.state::<AppState>().port.lock().unwrap() = Some(port),
                Err(e) => eprintln!("AuxiText : instance unique indisponible ({e})"),
            }
            create_window(app.handle(), initial.clone())?;
            Ok(())
        })
        .on_window_event(|w, ev| {
            if let tauri::WindowEvent::Focused(true) = ev {
                *w.app_handle().state::<AppState>().focused.lock().unwrap() = w.label().to_string();
            }
        })
        .invoke_handler(tauri::generate_handler![
            read_text,
            write_text,
            stat_files,
            prefs_load,
            prefs_save,
            recent_files,
            take_launches,
            new_window,
            open_in_writer,
            app_info,
            system_theme,
            print_page
        ])
        .build(context)
        .expect("démarrage d'AuxiText")
        .run(|app, event| {
            // macOS : fichiers ouverts depuis le Finder.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                let files: Vec<String> = urls.iter().filter_map(|u| u.to_file_path().ok()).map(|p| p.to_string_lossy().into_owned()).collect();
                if !files.is_empty() {
                    on_launch(app, Launch { files, new_window: false });
                }
            }
            if let tauri::RunEvent::Exit = event {
                let st = app.state::<AppState>();
                let port = *st.port.lock().unwrap();
                if let Some(port) = port {
                    instance::unlisten(&st.data_dir, port);
                }
            }
        });
}
