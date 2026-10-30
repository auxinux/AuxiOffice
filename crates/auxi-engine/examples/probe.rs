//! Diagnostic du moteur, étape par étape (utilisé par scripts/diagnose.sh).
//!
//! probe <dossier program/ de LibreOffice> <document> [sortie.png]
//!
//! Démarre `auxi-engine`, charge le document, rend la première page en PNG,
//! saisit du texte et l'enregistre dans une copie. Chaque étape affiche
//! « ok » ou la cause de l'échec.

use auxi_engine::client::{Engine, EngineConfig};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::exit;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

fn step<T>(name: &str, r: Result<T, String>) -> T {
    match r {
        Ok(v) => {
            eprintln!("[ok]    {name}");
            v
        }
        Err(e) => {
            eprintln!("[ÉCHEC] {name} : {e}");
            exit(1);
        }
    }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.len() < 3 {
        eprintln!("usage : probe <program/> <document> [sortie.png]");
        exit(2);
    }
    let exe_dir = std::env::current_exe().unwrap().parent().unwrap().parent().unwrap().to_path_buf();
    let engine_name = if cfg!(windows) { "auxi-engine.exe" } else { "auxi-engine" };
    let out_png = PathBuf::from(a.get(3).cloned().unwrap_or_else(|| std::env::temp_dir().join("auxi-diagnostic.png").to_string_lossy().into()));
    let doc_path = PathBuf::from(&a[2]);
    let work = std::env::temp_dir().join(format!("auxi-diagnostic-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&work);
    let copy = work.join(format!("copie.{}", doc_path.extension().and_then(|e| e.to_str()).unwrap_or("docx")));
    step("copie du document de test", std::fs::copy(&doc_path, &copy).map(|_| ()).map_err(|e| e.to_string()));

    let (ev_tx, ev_rx) = mpsc::channel::<Value>();
    let ev_tx = Mutex::new(ev_tx);
    let t0 = Instant::now();
    let engine = step(
        "démarrage du moteur et de LibreOffice",
        Engine::spawn(
            &EngineConfig {
                engine_exe: exe_dir.join(engine_name),
                program_dir: PathBuf::from(&a[1]),
                profile_dir: Some(work.join("profil")),
                lang: "fr-FR".into(),
                author: "Diagnostic".into(),
                log_file: None,
                profile_root: None,
                grammar_url: None,
                launcher: vec![],
            },
            Box::new(move |e: Value| {
                if std::env::var_os("PROBE_EVENTS").is_some() {
                    eprintln!("        événement {}", e.to_string().chars().take(160).collect::<String>());
                }
                let _ = ev_tx.lock().unwrap().send(e);
            }),
        ),
    );
    eprintln!("        LibreOffice {} prêt en {:?}", engine.libreoffice.clone().unwrap_or_default(), t0.elapsed());

    let t0 = Instant::now();
    let info = step("ouverture du document", engine.call(json!({"cmd": "load", "path": copy})));
    eprintln!(
        "        type {}, {} partie(s), {} × {} twips, en {:?}",
        info["type"], info["parts"], info["width"], info["height"], t0.elapsed()
    );

    let (w, h) = (info["width"].as_i64().unwrap_or(0), info["height"].as_i64().unwrap_or(0).min(info["width"].as_i64().unwrap_or(0) * 3 / 2));
    let px_w: i64 = 800;
    let px_h = (px_w * h / w.max(1)).max(1);
    let r = step(
        "rendu de la première page",
        engine.request(json!({"cmd": "paint", "px_w": px_w, "px_h": px_h, "x": 0, "y": 0, "w": w, "h": h}), &[], Duration::from_secs(60)),
    );
    let opaque = r.bin.chunks_exact(4).filter(|p| p[3] > 0).count();
    let inked = r.bin.chunks_exact(4).filter(|p| p[3] > 0 && (p[0] as u32 + p[1] as u32 + p[2] as u32) < 600).count();
    let total = (px_w * px_h) as usize;
    eprintln!("        pixels dessinés : {:.1} %, texte/traits : {:.2} %", 100.0 * opaque as f64 / total as f64, 100.0 * inked as f64 / total as f64);
    if opaque == 0 {
        eprintln!("[ÉCHEC] le rendu est entièrement vide");
    }
    if let Ok(f) = std::fs::File::create(&out_png) {
        let mut enc = png::Encoder::new(f, px_w as u32, px_h as u32);
        enc.set_color(png::ColorType::Rgba);
        if enc.write_header().and_then(|mut w| w.write_image_data(&r.bin)).is_ok() {
            eprintln!("        image : {}", out_png.display());
        }
    }

    if info["type"] == "text" {
        step("saisie de texte", engine.call(json!({"cmd": "text", "text": "Diagnostic AuxiOffice "})).map(|_| ()));
        std::thread::sleep(Duration::from_millis(800));
        step("enregistrement sur place", engine.call(json!({"cmd": "save_in_place"})).map(|_| ()));
        let pdf = work.join("export.pdf");
        step("export PDF", engine.call(json!({"cmd": "save", "path": pdf, "format": "pdf"})).map(|_| ()));
        dialog_check(&engine, &ev_rx, &out_png);
    }
    engine.shutdown();
    eprintln!("[ok]    diagnostic terminé ({})", work.display());
}

/// Événements `window` (boîtes de dialogue de LibreOffice) reçus pendant `wait`.
fn windows(rx: &mpsc::Receiver<Value>, wait: Duration) -> Vec<Value> {
    let end = Instant::now() + wait;
    let mut out = vec![];
    while let Some(left) = end.checked_duration_since(Instant::now()) {
        match rx.recv_timeout(left) {
            Ok(e) if e["name"] == "window" => {
                if let Some(p) = e["payload"].as_str().and_then(|p| serde_json::from_str::<Value>(p).ok()) {
                    out.push(p);
                }
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    out
}

/// Boîte de dialogue : ouverture, rendu à l'échelle 2 (écran Retina), fermeture.
fn dialog_check(engine: &Engine, rx: &mpsc::Receiver<Value>, out_png: &std::path::Path) {
    while rx.try_recv().is_ok() {}
    step("boîte « Insérer un tableau » demandée", engine.call(json!({"cmd": "uno", "command": ".uno:InsertTable"})).map(|_| ()));
    let evs = windows(rx, Duration::from_secs(8));
    let Some(dlg) = evs.iter().find(|w| w["action"] == "created" && w["type"] == "dialog").cloned() else {
        eprintln!("[ÉCHEC] aucune boîte de dialogue annoncée par LibreOffice ({} événement(s) window)", evs.len());
        for w in &evs {
            eprintln!("        {}", w.to_string().chars().take(200).collect::<String>());
        }
        return;
    };
    let num = |v: &Value| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok()));
    let id = num(&dlg["id"]).unwrap_or(0);
    let size: Vec<i64> = dlg["size"].as_str().unwrap_or("0, 0").split(',').map(|v| v.trim().parse().unwrap_or(0)).collect();
    let (w, h) = (size.first().copied().unwrap_or(0), size.get(1).copied().unwrap_or(0));
    eprintln!("[ok]    boîte annoncée : id {id}, « {} », {w} × {h}", dlg["title"].as_str().unwrap_or(""));
    std::thread::sleep(Duration::from_millis(500));
    for scale in [1.0f64, 2.0] {
        let r = engine.request(json!({"cmd": "paint_window", "window": id, "x": 0, "y": 0, "w": w, "h": h, "scale": scale}), &[], Duration::from_secs(30));
        match r {
            Ok(r) => {
                let (pw, ph) = (((w as f64) * scale).round() as u32, ((h as f64) * scale).round() as u32);
                let px = r.bin.chunks_exact(4).count().max(1);
                let inked = r.bin.chunks_exact(4).filter(|p| p[3] > 0 && (p[0] as u32 + p[1] as u32 + p[2] as u32) < 600).count();
                let white = r.bin.chunks_exact(4).filter(|p| p[0] > 250 && p[1] > 250 && p[2] > 250).count();
                eprintln!(
                    "{}  rendu de la boîte ×{scale} : {} octets ({} attendus), texte/traits {:.1} %, blanc {:.1} %",
                    if inked > 0 { "[ok]  " } else { "[ÉCHEC]" },
                    r.bin.len(),
                    pw * ph * 4,
                    100.0 * inked as f64 / px as f64,
                    100.0 * white as f64 / px as f64
                );
                if scale == 2.0 && r.bin.len() == (pw * ph * 4) as usize {
                    let file = out_png.with_file_name("diagnostic-dialogue.png");
                    if let Ok(f) = std::fs::File::create(&file) {
                        let mut enc = png::Encoder::new(f, pw, ph);
                        enc.set_color(png::ColorType::Rgba);
                        if enc.write_header().and_then(|mut wr| wr.write_image_data(&r.bin)).is_ok() {
                            eprintln!("        image : {}", file.display());
                        }
                    }
                }
            }
            Err(e) => eprintln!("[ÉCHEC] rendu de la boîte ×{scale} : {e}"),
        }
    }
    step("fermeture demandée", engine.call(json!({"cmd": "window_close", "window": id})).map(|_| ()));
    let evs = windows(rx, Duration::from_secs(5));
    if evs.iter().any(|w| num(&w["id"]) == Some(id) && w["action"] == "close") {
        eprintln!("[ok]    boîte fermée par LibreOffice");
    } else {
        eprintln!("[ÉCHEC] LibreOffice n'a pas fermé la boîte ({} événement(s) window reçus)", evs.len());
    }
    let alive = engine.call(json!({"cmd": "info"}));
    eprintln!("{}  moteur toujours disponible après la boîte", if alive.is_ok() { "[ok]  " } else { "[ÉCHEC]" });
}
