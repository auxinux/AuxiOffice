//! Coque AuxiOffice : fenêtre Tauri, gestion des moteurs (un processus
//! `auxi-engine` par document ouvert) et pont vers l'interface.

use auxi_engine::client::{Engine, EngineConfig};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct Engines {
    docs: Mutex<HashMap<u64, Arc<Engine>>>,
    next: AtomicU64,
}

impl Engines {
    fn get(&self, doc: u64) -> Result<Arc<Engine>, String> {
        self.docs.lock().unwrap().get(&doc).cloned().ok_or_else(|| "document fermé".to_string())
    }
}

/// Emplacements du moteur. Ordre de recherche :
/// 1. variables `AUXI_ENGINE_EXE` / `AUXI_LO_PROGRAM` (développement, tests) ;
/// 2. à côté de l'exécutable : `auxi-engine` et `engine/program/` (paquets).
fn engine_config(app: &AppHandle) -> Result<EngineConfig, String> {
    let exe_dir = std::env::current_exe().map_err(|e| e.to_string())?.parent().map(Path::to_path_buf).unwrap_or_default();
    let engine_name = if cfg!(windows) { "auxi-engine.exe" } else { "auxi-engine" };
    let engine_exe = std::env::var_os("AUXI_ENGINE_EXE").map(PathBuf::from).unwrap_or_else(|| exe_dir.join(engine_name));
    let program_dir = std::env::var_os("AUXI_LO_PROGRAM").map(PathBuf::from).unwrap_or_else(|| exe_dir.join("engine").join("program"));
    if !engine_exe.exists() {
        return Err(format!("moteur introuvable : {}", engine_exe.display()));
    }
    if !program_dir.exists() {
        return Err(format!("LibreOffice introuvable : {}", program_dir.display()));
    }
    let profile_dir = app.path().app_data_dir().ok().map(|d| d.join("moteur"));
    Ok(EngineConfig {
        engine_exe,
        program_dir,
        profile_dir,
        lang: std::env::var("AUXI_LANG").unwrap_or_else(|_| "fr-FR".into()),
        author: user_name(),
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
    let cfg = engine_config(&app)?;
    let id = state.next.fetch_add(1, Ordering::Relaxed) + 1;
    let emitter = app.clone();
    let engine = tauri::async_runtime::spawn_blocking(move || {
        Engine::spawn(&cfg, Box::new(move |mut ev| {
            ev["doc"] = json!(id);
            let _ = emitter.emit("engine", ev);
        }))
    })
    .await
    .map_err(|e| e.to_string())??;
    let engine = Arc::new(engine);
    let e = engine.clone();
    let req = json!({"cmd": "load", "path": path, "ignore_lock": ignore_lock.unwrap_or(false)});
    let mut info = tauri::async_runtime::spawn_blocking(move || e.call(req)).await.map_err(|e| e.to_string())??;
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

/// Rendu d'une tuile : retourne directement les octets RGBA.
#[tauri::command]
async fn doc_paint(state: State<'_, Engines>, doc: u64, req: Value) -> Result<tauri::ipc::Response, String> {
    let engine = state.get(doc)?;
    let mut req = req;
    req["cmd"] = json!("paint");
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

fn templates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(d) = std::env::var_os("AUXI_TEMPLATES") {
        return Ok(PathBuf::from(d));
    }
    app.path().resource_dir().map(|d| d.join("templates")).map_err(|e| e.to_string())
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

/// Fichier passé en argument de la ligne de commande (« Ouvrir avec »).
#[tauri::command]
fn startup_file() -> Option<String> {
    std::env::args().skip(1).find(|a| !a.starts_with('-') && Path::new(a).is_file())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Engines::default())
        .invoke_handler(tauri::generate_handler![
            doc_open,
            doc_call,
            doc_paint,
            doc_close,
            new_document,
            recent_files,
            startup_file
        ])
        .build(tauri::generate_context!())
        .expect("démarrage d'AuxiOffice")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let engines = app.state::<Engines>();
                let all: Vec<_> = engines.docs.lock().unwrap().drain().map(|(_, e)| e).collect();
                for e in all {
                    e.shutdown();
                }
            }
        });
}
