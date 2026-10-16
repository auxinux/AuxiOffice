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
            },
            Box::new(|e: Value| {
                if std::env::var_os("PROBE_EVENTS").is_some() {
                    eprintln!("        événement {}", e.to_string().chars().take(160).collect::<String>());
                }
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
    }
    engine.shutdown();
    eprintln!("[ok]    diagnostic terminé ({})", work.display());
}
