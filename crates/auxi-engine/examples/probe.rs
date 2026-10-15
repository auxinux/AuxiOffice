//! Outil de diagnostic : charge un document, rend une zone en PNG.
//! probe <program/> <document> <sortie.png> [part] [px_w]
use auxi_engine::client::{Engine, EngineConfig};
use serde_json::json;
use std::path::PathBuf;
use std::time::Duration;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let engine = Engine::spawn(
        &EngineConfig {
            engine_exe: std::env::current_exe().unwrap().parent().unwrap().parent().unwrap().join("auxi-engine"),
            program_dir: PathBuf::from(&a[1]),
            profile_dir: Some(std::env::temp_dir().join("auxi-probe-profile")),
            lang: "fr-FR".into(),
            author: String::new(),
        },
        Box::new(|e| if std::env::var_os("PROBE_EVENTS").is_some() { eprintln!("event {e}") }),
    )
    .unwrap();
    let info = engine.call(json!({"cmd": "load", "path": a[2]})).unwrap();
    eprintln!("{info}");
    let part: Option<i64> = a.get(4).map(|s| s.parse().unwrap());
    if let Some(p) = part.filter(|p| *p >= 0) {
        eprintln!("{}", engine.call(json!({"cmd": "set_part", "part": p})).unwrap());
    }
    if let Ok(m) = std::env::var("PROBE_MODE") { engine.call(json!({"cmd": "set_part_mode", "mode": m.parse::<i64>().unwrap()})).unwrap(); }
    if let Ok(c) = std::env::var("PROBE_UNO") { engine.call(json!({"cmd": "uno", "command": c})).unwrap(); std::thread::sleep(Duration::from_millis(1500)); }
    if let Ok(c) = std::env::var("PROBE_CMDVAL") {
        let v = engine.call(json!({"cmd": "command_values", "command": c})).unwrap();
        println!("{}", v["values"].to_string().chars().take(1500).collect::<String>());
        return;
    }
    if let Ok(ms) = std::env::var("PROBE_SLEEP") { std::thread::sleep(Duration::from_millis(ms.parse().unwrap())); }
    if std::env::var_os("PROBE_ZOOM").is_some() {
        engine.call(json!({"cmd": "client_zoom", "tile_px_w": 256, "tile_px_h": 256, "tile_twip_w": 3840, "tile_twip_h": 3840})).unwrap();
        engine.call(json!({"cmd": "visible_area", "x": 0, "y": 0, "w": 30000, "h": 20000})).unwrap();
    }
    let info = engine.call(json!({"cmd": "info"})).unwrap();
    let (w, h) = (info["width"].as_i64().unwrap(), info["height"].as_i64().unwrap().min(info["width"].as_i64().unwrap() * 3 / 2));
    let px_w: i64 = a.get(5).map(|s| s.parse().unwrap()).unwrap_or(800);
    let px_h = px_w * h / w;
    let r = engine
        .request(json!({"cmd": "paint", "px_w": px_w, "px_h": px_h, "x": 0, "y": 0, "w": w, "h": h}), &[], Duration::from_secs(60))
        .unwrap();
    let f = std::fs::File::create(&a[3]).unwrap();
    let mut enc = png::Encoder::new(f, px_w as u32, px_h as u32);
    enc.set_color(png::ColorType::Rgba);
    enc.write_header().unwrap().write_image_data(&r.bin).unwrap();
}
