//! Coque d'AuxiPDFWriter : fenêtres Tauri, fichiers, mot de passe, impression,
//! instance unique, préférences et fichiers récents. La lecture et la
//! modification des PDF sont dans l'interface (`pdfwriter/ui`).
//!
//! L'application est autonome : elle ne dépend d'aucun crate d'AuxiOffice.

mod crypto;
mod fsio;
mod instance;
mod print;
mod theme;

use instance::Launch;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const RECENT_MAX: usize = 15;
const READABLE: &[&str] = &["pdf", "png", "jpg", "jpeg", "webp", "bmp", "gif"];

struct AppState {
    data_dir: PathBuf,
    config_dir: PathBuf,
    pending: Mutex<HashMap<String, Vec<String>>>,
    focused: Mutex<String>,
    next_window: AtomicU32,
    port: Mutex<Option<u16>>,
}

fn extension(p: &str) -> String {
    Path::new(p).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

fn url_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn body_of<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(b) => Ok(b),
        _ => Err("contenu attendu en octets".into()),
    }
}

fn header(request: &Request<'_>, key: &str) -> Option<String> {
    request.headers().get(key).and_then(|v| v.to_str().ok()).map(url_decode)
}

// --- Fichiers ---------------------------------------------------------------

/// Contenu d'un PDF ou d'une image (octets bruts, sans passer par JSON).
#[tauri::command]
async fn read_file(path: String) -> Result<Response, String> {
    if !READABLE.contains(&extension(&path).as_str()) {
        return Err("seuls les PDF et les images sont lus".into());
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(&path).map_err(|e| format!("{path} : {e}"))).await.map_err(|e| e.to_string())??;
    Ok(Response::new(bytes))
}

/// Écrit un PDF (corps brut, chemin dans l'en-tête `x-path`), sans jamais
/// laisser un fichier à moitié écrit. Retourne le chemin écrit.
#[tauri::command]
async fn write_pdf(request: Request<'_>) -> Result<String, String> {
    let bytes = body_of(&request)?.to_vec();
    let path = header(&request, "x-path").ok_or("en-tête x-path manquant")?;
    if extension(&path) != "pdf" || !bytes.starts_with(b"%PDF-") {
        return Err("seuls des documents PDF sont enregistrés".into());
    }
    tauri::async_runtime::spawn_blocking(move || fsio::write_atomic(Path::new(&path), &bytes).map(|_| path.clone()).map_err(|e| format!("{path} : {e}"))).await.map_err(|e| e.to_string())?
}

/// Copie temporaire, pour l'impression. Retourne son chemin.
#[tauri::command]
async fn write_temp(request: Request<'_>) -> Result<String, String> {
    let bytes = body_of(&request)?.to_vec();
    let name = header(&request, "x-name").unwrap_or_else(|| "Document.pdf".into());
    tauri::async_runtime::spawn_blocking(move || {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        let dir = std::env::temp_dir().join("AuxiPDFWriter").join(format!("impression-{stamp}"));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        // Le document peut être confidentiel : dossier réservé à l'utilisateur.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
        }
        let safe: String = Path::new(&name).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default().chars().map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { '_' } else { c }).collect();
        let file = dir.join(if safe.to_lowercase().ends_with(".pdf") { safe } else { "Document.pdf".into() });
        std::fs::write(&file, &bytes).map_err(|e| e.to_string())?;
        Ok(file.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Date de modification et droit d'écriture.
#[tauri::command]
fn file_info(path: String) -> Value {
    match std::fs::metadata(&path) {
        Ok(m) => json!({ "exists": true, "size": m.len(), "readonly": m.permissions().readonly(), "mtime": m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0) }),
        Err(_) => json!({ "exists": false }),
    }
}

// --- Mot de passe -------------------------------------------------------------

#[tauri::command]
async fn pdf_decrypt(request: Request<'_>) -> Result<Response, String> {
    let bytes = body_of(&request)?.to_vec();
    let pw = header(&request, "x-password").unwrap_or_default();
    let out = tauri::async_runtime::spawn_blocking(move || crypto::decrypt(&bytes, &pw)).await.map_err(|e| e.to_string())??;
    Ok(Response::new(out))
}

#[tauri::command]
async fn pdf_encrypt(request: Request<'_>) -> Result<Response, String> {
    let bytes = body_of(&request)?.to_vec();
    let pw = header(&request, "x-password").unwrap_or_default();
    let out = tauri::async_runtime::spawn_blocking(move || crypto::encrypt(&bytes, &pw)).await.map_err(|e| e.to_string())??;
    Ok(Response::new(out))
}

// --- Impression ------------------------------------------------------------------

#[tauri::command]
async fn printers() -> Vec<print::Printer> {
    tauri::async_runtime::spawn_blocking(print::list_printers).await.unwrap_or_default()
}

#[tauri::command]
async fn print_file(path: String, options: print::PrintOptions) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || print::print_pdf(Path::new(&path), &options)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_system(target: String) -> Result<(), String> {
    let web = target.starts_with("http://") || target.starts_with("https://") || target.starts_with("mailto:");
    if !web && extension(&target) != "pdf" {
        return Err("adresse refusée".into());
    }
    print::open_with_system(&target)
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
    fsio::write_atomic(file, &body).map_err(|e| format!("{} : {e}", file.display()))
}

#[tauri::command]
fn prefs_load(state: tauri::State<'_, AppState>) -> Value {
    read_json(&state.config_dir.join("preferences.json")).unwrap_or(json!({}))
}

#[tauri::command]
fn prefs_save(state: tauri::State<'_, AppState>, prefs: Value) -> Result<(), String> {
    write_json(&state.config_dir.join("preferences.json"), &prefs)
}

#[tauri::command]
fn recent_files(state: tauri::State<'_, AppState>, add: Option<String>, remove: Option<String>) -> Vec<String> {
    let file = state.data_dir.join("recent.json");
    let mut list: Vec<String> = read_json(&file).and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
    let before = list.clone();
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
    }
    list
}

// --- Fenêtres et lancements -------------------------------------------------

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
    let dark = theme::system_is_dark().unwrap_or(false);
    let mut b = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("AuxiPDFWriter")
        .inner_size(1280.0, 860.0)
        .min_inner_size(760.0, 480.0)
        .theme(Some(if dark { tauri::Theme::Dark } else { tauri::Theme::Light }));
    if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")) {
        b = b.icon(icon).map_err(|e| e.to_string())?;
    }
    b.build().map_err(|e| e.to_string())?;
    *state.focused.lock().unwrap() = label;
    Ok(())
}

/// Lancement reçu d'un second processus, ou fichier ouvert depuis le Finder :
/// confié à la dernière fenêtre active. Elle le charge si son document est un
/// document vierge intact, sinon elle ouvre une nouvelle fenêtre.
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
            let _ = app.run_on_main_thread(move || {
                let files = if l.files.is_empty() { vec![vec![]] } else { l.files.iter().map(|f| vec![f.clone()]).collect() };
                for f in files {
                    if let Err(e) = create_window(&app2, f) {
                        eprintln!("AuxiPDFWriter : nouvelle fenêtre impossible ({e})");
                    }
                }
            });
        }
    }
}

#[tauri::command]
fn app_info() -> Value {
    json!({ "version": env!("CARGO_PKG_VERSION"), "platform": std::env::consts::OS })
}

#[tauri::command]
async fn system_theme() -> Option<&'static str> {
    tauri::async_runtime::spawn_blocking(|| theme::system_is_dark().map(|d| if d { "dark" } else { "light" })).await.ok().flatten()
}

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    let id = context.config().identifier.clone();
    let data_dir = user_dir(&id, "XDG_DATA_HOME", ".local/share");
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--version" || a == "-V") {
        println!("AuxiPDFWriter {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    let launch = instance::parse_args(&args, &cwd);
    if instance::forward(&data_dir, &launch) {
        return;
    }
    let initial = launch.files;
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            data_dir: data_dir.clone(),
            config_dir: user_dir(&id, "XDG_CONFIG_HOME", ".config"),
            pending: Mutex::new(HashMap::new()),
            focused: Mutex::new(String::new()),
            next_window: AtomicU32::new(0),
            port: Mutex::new(None),
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            match instance::listen(&data_dir, move |l| on_launch(&handle, l)) {
                Ok(port) => *app.state::<AppState>().port.lock().unwrap() = Some(port),
                Err(e) => eprintln!("AuxiPDFWriter : instance unique indisponible ({e})"),
            }
            if initial.is_empty() {
                create_window(app.handle(), vec![])?;
            } else {
                for f in &initial {
                    create_window(app.handle(), vec![f.clone()])?;
                }
            }
            Ok(())
        })
        .on_window_event(|w, ev| {
            if let tauri::WindowEvent::Focused(true) = ev {
                *w.app_handle().state::<AppState>().focused.lock().unwrap() = w.label().to_string();
            }
        })
        .invoke_handler(tauri::generate_handler![
            read_file, write_pdf, write_temp, file_info, pdf_decrypt, pdf_encrypt, printers, print_file, open_system, prefs_load, prefs_save, recent_files, take_launches, new_window, app_info, system_theme
        ])
        .build(context)
        .expect("démarrage d'AuxiPDFWriter")
        .run(|app, event| {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_url() {
        assert_eq!(url_decode("%C3%A9t%C3%A9%20a"), "été a");
        assert_eq!(url_decode("a%2"), "a%2");
        assert_eq!(url_decode("100%"), "100%");
    }
}
