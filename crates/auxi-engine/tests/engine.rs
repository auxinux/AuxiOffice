//! Tests d'intégration du moteur : LibreOffice réel, documents générés par
//! tests/fixtures/generate.py.
//!
//! Variables d'environnement :
//! - `AUXI_LO_PROGRAM`  : dossier `program/` de LibreOffice (sinon tests ignorés) ;
//! - `AUXI_FIXTURES`    : dossier des documents générés.

use auxi_engine::client::{Engine, EngineConfig};
use serde_json::{json, Value};
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

struct Ctx {
    engine: Engine,
    events: Arc<Mutex<Vec<Value>>>,
    tmp: PathBuf,
}

fn setup(name: &str) -> Option<(Ctx, PathBuf)> {
    let program = std::env::var_os("AUXI_LO_PROGRAM").map(PathBuf::from)?;
    let fixtures = PathBuf::from(std::env::var_os("AUXI_FIXTURES").expect("AUXI_FIXTURES manquant"));
    let tmp = std::env::temp_dir().join(format!("auxi-engine-test-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let ev = events.clone();
    let engine = Engine::spawn(
        &EngineConfig {
            engine_exe: PathBuf::from(env!("CARGO_BIN_EXE_auxi-engine")),
            program_dir: program,
            profile_dir: Some(tmp.join("profil")),
            lang: "fr-FR".into(),
            author: "Test AuxiOffice".into(),
            log_file: None,
        },
        Box::new(move |e| ev.lock().unwrap().push(e)),
    )
    .expect("démarrage du moteur");
    Some((Ctx { engine, events, tmp }, fixtures))
}

impl Ctx {
    fn call(&self, v: Value) -> Value {
        self.engine.call(v.clone()).unwrap_or_else(|e| panic!("{v}: {e}"))
    }

    fn type_text(&self, s: &str) {
        self.call(json!({"cmd": "text", "text": s}));
    }

    fn key(&self, code: i32) {
        self.call(json!({"cmd": "key", "char": 0, "code": code}));
        self.call(json!({"cmd": "key", "kind": "up", "char": 0, "code": code}));
    }

    /// Les événements clavier sont traités de façon asynchrone par
    /// LibreOffice : attendre que le flot de rappels se calme.
    fn settle(&self) {
        let mut last = usize::MAX;
        let mut stable = 0;
        let start = Instant::now();
        while stable < 4 && start.elapsed() < Duration::from_secs(30) {
            std::thread::sleep(Duration::from_millis(250));
            let n = self.events.lock().unwrap().len();
            stable = if n == last { stable + 1 } else { 0 };
            last = n;
        }
        let names: std::collections::BTreeMap<String, usize> =
            self.events.lock().unwrap().iter().fold(Default::default(), |mut m, e| {
                *m.entry(e["name"].as_str().unwrap_or("?").to_string()).or_default() += 1;
                m
            });
        eprintln!("événements après {:?} : {names:?}", start.elapsed());
        if std::env::var_os("AUXI_TEST_DUMP").is_some() {
            for e in self.events.lock().unwrap().iter().filter(|e| e["name"] != "state_changed") {
                eprintln!("  {}", e.to_string().chars().take(300).collect::<String>());
            }
        }
    }

    fn has_event(&self, name: &str) -> bool {
        self.events.lock().unwrap().iter().any(|e| e["name"] == name)
    }

    #[allow(clippy::too_many_arguments)]
    fn paint_png(&self, file: &str, part: Option<i64>, px_w: i64, x: i64, y: i64, w: i64, h: i64) -> f64 {
        let px_h = (px_w * h / w).max(1);
        let mut req = json!({"cmd": "paint", "px_w": px_w, "px_h": px_h, "x": x, "y": y, "w": w, "h": h});
        if let Some(p) = part {
            req["part"] = json!(p);
        }
        let r = self.engine.request(req, &[], Duration::from_secs(60)).unwrap();
        assert_eq!(r.bin.len() as i64, px_w * px_h * 4);
        let out = std::fs::File::create(self.tmp.join(file)).unwrap();
        let mut enc = png::Encoder::new(out, px_w as u32, px_h as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.write_header().unwrap().write_image_data(&r.bin).unwrap();
        // Proportion de pixels « encrés » : prouve qu'il y a bien un rendu.
        let inked = r.bin.chunks_exact(4).filter(|p| p[3] > 0 && (p[0] as u32 + p[1] as u32 + p[2] as u32) < 600).count();
        inked as f64 / (px_w * px_h) as f64
    }
}

fn zip_entry(path: &PathBuf, name: &str) -> String {
    let mut z = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
    let mut s = String::new();
    z.by_name(name).unwrap().read_to_string(&mut s).unwrap();
    s
}

#[test]
fn writer_edit_save_and_export() {
    let Some((ctx, fx)) = setup("writer") else { return eprintln!("AUXI_LO_PROGRAM absent : test ignoré") };
    let hello = ctx.call(json!({"cmd": "hello"}));
    assert!(hello["libreoffice"]["ProductVersion"].as_str().is_some(), "{hello}");

    let t0 = Instant::now();
    let info = ctx.call(json!({"cmd": "load", "path": fx.join("simple.docx")}));
    eprintln!("simple.docx chargé en {:?} : {info}", t0.elapsed());
    assert_eq!(info["type"], "text");
    let (w, h) = (info["width"].as_i64().unwrap(), info["height"].as_i64().unwrap());
    assert!(w > 10_000 && h > 10_000);

    let ink = ctx.paint_png("simple-page1.png", None, 816, 0, 0, w, w * 11 / 8);
    assert!(ink > 0.002, "page vide ? encre = {ink}");

    // Fin du document, nouvelle ligne, texte normal puis en gras.
    ctx.key(lok_sys::key::END | lok_sys::key::MOD1);
    ctx.key(lok_sys::key::RETURN);
    ctx.type_text("Ajouté par AuxiOffice : ");
    ctx.call(json!({"cmd": "uno", "command": ".uno:Bold"}));
    ctx.type_text("ÉcritEnGras");
    ctx.settle();

    let out = ctx.tmp.join("modifie.docx");
    ctx.call(json!({"cmd": "save", "path": out, "format": "docx"}));
    let xml = zip_entry(&out, "word/document.xml");
    assert!(ctx.has_event("invalidate_tiles"));
    assert!(ctx.has_event("state_changed"));
    assert!(xml.contains("Ajouté par AuxiOffice"), "texte saisi absent");
    let bold_run = xml.split("<w:r>").find(|r| r.contains("ÉcritEnGras")).or_else(|| xml.split("<w:r ").find(|r| r.contains("ÉcritEnGras")));
    assert!(bold_run.is_some_and(|r| r.contains("<w:b/>") || r.contains("<w:b ")), "gras non enregistré");

    // Enregistrement sur place (Fichier > Enregistrer) d'une copie de travail.
    let copy = ctx.tmp.join("copie.docx");
    std::fs::copy(fx.join("simple.docx"), &copy).unwrap();
    drop(ctx);
    let (ctx, _) = setup("writer-save").unwrap();
    ctx.call(json!({"cmd": "load", "path": copy}));
    ctx.call(json!({"cmd": "paste", "mime": "text/plain;charset=utf-8", "data": "Collé depuis le presse-papiers "}));
    ctx.settle();
    ctx.call(json!({"cmd": "save_in_place"}));
    assert!(zip_entry(&copy, "word/document.xml").contains("Collé depuis le presse-papiers"));

    // Enregistrer sous en ODT : le document prend le nouvel emplacement.
    let odt = ctx.tmp.join("copie.odt");
    ctx.call(json!({"cmd": "save_as_location", "path": odt}));
    ctx.type_text("Après enregistrer sous");
    ctx.settle();
    ctx.call(json!({"cmd": "save_in_place"}));
    assert!(zip_entry(&odt, "content.xml").contains("Après enregistrer sous"));
    assert!(!zip_entry(&copy, "word/document.xml").contains("Après enregistrer sous"));

    let pdf = ctx.tmp.join("export.pdf");
    ctx.call(json!({"cmd": "save", "path": pdf, "format": "pdf"}));
    let head = std::fs::read(&pdf).unwrap();
    assert!(head.starts_with(b"%PDF-"));

    // Document long : temps d'ouverture et de rendu d'une tuile au milieu.
    drop(ctx);
    let (ctx, fx) = setup("writer-long").unwrap();
    let t0 = Instant::now();
    let info = ctx.call(json!({"cmd": "load", "path": fx.join("long-300-pages.docx")}));
    let load = t0.elapsed();
    let h = info["height"].as_i64().unwrap();
    let t1 = Instant::now();
    ctx.paint_png("long-milieu.png", None, 816, 0, h / 2, info["width"].as_i64().unwrap(), 15 * 1056);
    let pages = info["pages"].as_str().unwrap_or("").split(';').filter(|s| !s.is_empty()).count();
    eprintln!("long-300-pages.docx : {pages} pages, ouverture {load:?}, tuile {:?}", t1.elapsed());
    assert!(pages > 150, "{pages} pages seulement");
}

#[test]
fn calc_formula_and_sheets() {
    let Some((ctx, fx)) = setup("calc") else { return };
    let info = ctx.call(json!({"cmd": "load", "path": fx.join("budget.xlsx")}));
    assert_eq!(info["type"], "spreadsheet");
    assert_eq!(info["parts"], 3);
    assert_eq!(info["part_names"][0], "Budget");
    ctx.paint_png("budget.png", None, 1024, 0, 0, 15 * 1024, 15 * 600);

    ctx.call(json!({"cmd": "uno", "command": ".uno:GoToCell", "args": {"ToPoint": {"type": "string", "value": "A20"}}}));
    ctx.type_text("=2*21");
    ctx.key(lok_sys::key::RETURN);
    ctx.settle();
    assert!(ctx.has_event("cell_cursor"));

    let out = ctx.tmp.join("budget-modifie.xlsx");
    ctx.call(json!({"cmd": "save", "path": out, "format": "xlsx"}));
    let sheet = zip_entry(&out, "xl/worksheets/sheet1.xml");
    assert!(sheet.contains("2*21"), "formule saisie absente");
    assert!(sheet.contains("<v>42</v>"), "résultat de la formule absent");

    let info = ctx.call(json!({"cmd": "set_part", "part": 1}));
    assert_eq!(info["part"], 1);
}

#[test]
fn impress_slides_and_thumbnails() {
    let Some((ctx, fx)) = setup("impress") else { return };
    let info = ctx.call(json!({"cmd": "load", "path": fx.join("presentation.pptx")}));
    assert_eq!(info["type"], "presentation");
    assert_eq!(info["parts"], 5);
    let (w, h) = (info["width"].as_i64().unwrap(), info["height"].as_i64().unwrap());
    for p in 0..5 {
        let ink = ctx.paint_png(&format!("diapo-{p}.png"), Some(p), 320, 0, 0, w, h);
        assert!(ink > 0.001, "diapositive {p} vide");
    }
    let pdf = ctx.tmp.join("presentation.pdf");
    ctx.call(json!({"cmd": "save", "path": pdf, "format": "pdf"}));
    assert!(std::fs::read(&pdf).unwrap().starts_with(b"%PDF-"));
}

#[test]
fn foreign_lock_is_reported_then_ignored_on_request() {
    let Some((ctx, fx)) = setup("lock") else { return };
    let doc = ctx.tmp.join("verrouille.docx");
    std::fs::copy(fx.join("simple.docx"), &doc).unwrap();
    let lock = ctx.tmp.join(".~lock.verrouille.docx#");
    std::fs::write(&lock, ",marie,poste-12,15.10.2026 09:00,file:///x;").unwrap();
    let info = ctx.call(json!({"cmd": "load", "path": doc}));
    assert_eq!(info["read_only"], true);
    assert_eq!(info["locked_by"]["user"], "marie");
    drop(ctx);

    let (ctx, _) = setup("lock2").unwrap();
    std::fs::write(&lock, ",marie,poste-12,15.10.2026 09:00,file:///x;").unwrap();
    let info = ctx.call(json!({"cmd": "load", "path": doc, "ignore_lock": true}));
    assert_eq!(info["read_only"], false);
    drop(ctx);

    // Verrou orphelin laissé par notre propre profil : retiré sans question.
    let (ctx, _) = setup("lock3").unwrap();
    let profile = url::Url::from_directory_path(ctx.tmp.join("profil").canonicalize().unwrap()).unwrap();
    std::fs::write(&lock, format!(",moi,ici,15.10.2026 09:00,{profile};")).unwrap();
    let info = ctx.call(json!({"cmd": "load", "path": doc}));
    assert_eq!(info["read_only"], false, "{info}");
    ctx.type_text("Modifiable");
    ctx.settle();
    ctx.call(json!({"cmd": "save", "path": doc, "format": "docx"}));
    assert!(zip_entry(&doc, "word/document.xml").contains("Modifiable"));
}

#[test]
fn bad_requests_are_rejected() {
    let Some((ctx, fx)) = setup("errors") else { return };
    assert!(ctx.engine.call(json!({"cmd": "paint", "px_w": 10, "px_h": 10})).is_err());
    assert!(ctx.engine.call(json!({"cmd": "load", "path": fx.join("inexistant.docx")})).is_err());
    assert!(ctx.engine.call(json!({"cmd": "nimporte"})).is_err());
    ctx.call(json!({"cmd": "load", "path": fx.join("simple.docx")}));
    assert!(ctx.engine.call(json!({"cmd": "uno", "command": "macro:///Standard.x"})).is_err());
    assert!(ctx.engine.call(json!({"cmd": "paint", "px_w": 99999, "px_h": 10})).is_err());
}
