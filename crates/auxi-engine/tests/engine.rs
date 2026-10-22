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
    setup_with(name, None)
}

fn setup_with(name: &str, grammar_url: Option<String>) -> Option<(Ctx, PathBuf)> {
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
            profile_root: None,
            grammar_url,
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

/// Le code de la macro AuxiBonjour est-il encore dans `doc` ? (relu par
/// LibreOffice et réécrit en ODF, où le module Basic est en clair).
fn macro_survives(doc: &PathBuf, odf_ext: &str) -> bool {
    let (ctx, _) = setup("macro-relu").unwrap();
    ctx.call(json!({"cmd": "load", "path": doc}));
    let odf = ctx.tmp.join(format!("relu.{odf_ext}"));
    ctx.call(json!({"cmd": "save", "path": odf, "format": odf_ext}));
    zip_entry(&odf, "Basic/VBAProject/Module1.xml").contains("AuxiBonjour")
}

#[test]
fn macro_documents_keep_their_vba_project() {
    let Some((ctx, fx)) = setup("docm") else { return };
    // DOCM : Enregistrer (en place), puis Enregistrer sous en .docm.
    let docm = ctx.tmp.join("Lettre de l'été.docm");
    std::fs::copy(fx.join("macro.docm"), &docm).unwrap();
    ctx.call(json!({"cmd": "load", "path": docm}));
    ctx.type_text("Modifié ");
    ctx.settle();
    ctx.call(json!({"cmd": "save_in_place"}));
    assert!(zip_entry(&docm, "word/document.xml").contains("Modifié"));
    assert!(zip_entry(&docm, "[Content_Types].xml").contains("macroEnabled"), "format DOCM perdu");
    let copy = ctx.tmp.join("copie.docm");
    ctx.call(json!({"cmd": "save_as_location", "path": copy}));
    drop(ctx);
    assert!(macro_survives(&docm, "odt"), "macro perdue à l'enregistrement du DOCM");
    assert!(macro_survives(&copy, "odt"), "macro perdue dans Enregistrer sous .docm");

    // XLSM : Ctrl+S pendant la saisie d'une cellule (sans Entrée).
    let (ctx, _) = setup("xlsm").unwrap();
    let xlsm = ctx.tmp.join("classeur.xlsm");
    std::fs::copy(fx.join("macro.xlsm"), &xlsm).unwrap();
    ctx.call(json!({"cmd": "load", "path": xlsm}));
    ctx.call(json!({"cmd": "uno", "command": ".uno:GoToCell", "args": {"ToPoint": {"type": "string", "value": "A3"}}}));
    ctx.type_text("SaisieEnCours");
    ctx.settle();
    ctx.call(json!({"cmd": "save_in_place"}));
    assert!(zip_entry(&xlsm, "[Content_Types].xml").contains("macroEnabled"), "format XLSM perdu");
    assert!(zip_entry(&xlsm, "xl/sharedStrings.xml").contains("SaisieEnCours"), "cellule en cours de saisie non enregistrée");
    drop(ctx);
    assert!(macro_survives(&xlsm, "ods"), "macro perdue à l'enregistrement du XLSM");
}

#[test]
fn encrypted_documents_ask_for_the_password_and_stay_encrypted() {
    let Some((ctx, fx)) = setup("chiffre") else { return };
    // Copie chiffrée (mot de passe « été 2026 ») faite par LibreOffice lui-même.
    let doc = ctx.tmp.join("secret l'été.docx");
    ctx.call(json!({"cmd": "load", "path": fx.join("simple.docx")}));
    let opts = ",Password=été 2026PASSWORDEND";
    ctx.call(json!({"cmd": "save", "path": doc, "format": "docx", "filter": opts}));
    drop(ctx);
    let load = |pw: Option<&str>| {
        let (ctx, _) = setup("chiffre-ouvrir").unwrap();
        let mut req = json!({"cmd": "load", "path": doc});
        if let Some(p) = pw {
            req["password"] = json!(p);
        }
        let r = ctx.engine.request(req, &[], Duration::from_secs(60)).map(|r| r.json);
        (ctx, r)
    };
    assert_eq!(load(None).1.unwrap_err(), "mot de passe requis");
    assert_eq!(load(Some("faux")).1.unwrap_err(), "mot de passe incorrect");
    let (ctx, r) = load(Some("été 2026"));
    assert_eq!(r.unwrap()["type"], "text");
    // Modifié puis « Enregistrer sous » : la copie reste chiffrée (saveAs ne
    // revenait jamais pour un document chiffré modifié).
    ctx.call(json!({"cmd": "uno", "command": ".uno:SelectAll"}));
    ctx.call(json!({"cmd": "uno", "command": ".uno:Bold"}));
    ctx.settle();
    let copy = ctx.tmp.join("copie chiffrée.docx");
    ctx.engine
        .request(json!({"cmd": "save_as_location", "path": copy}), &[], Duration::from_secs(60))
        .expect("Enregistrer sous d'un document chiffré modifié");
    ctx.call(json!({"cmd": "save_in_place"}));
    drop(ctx);
    let (_ctx, r) = {
        let (ctx, _) = setup("chiffre-copie").unwrap();
        let r = ctx.engine.request(json!({"cmd": "load", "path": copy}), &[], Duration::from_secs(60)).map(|r| r.json);
        (ctx, r)
    };
    assert_eq!(r.unwrap_err(), "mot de passe requis", "copie écrite en clair");
}

#[test]
fn save_as_onto_a_file_open_elsewhere_is_refused() {
    let Some((ctx, fx)) = setup("cible-verrouillee") else { return };
    let target = ctx.tmp.join("cible.docx");
    std::fs::copy(fx.join("simple.docx"), &target).unwrap();
    std::fs::write(ctx.tmp.join(".~lock.cible.docx#"), ",marie,poste-12,15.10.2026 09:00,file:///x;").unwrap();
    ctx.call(json!({"cmd": "load", "path": fx.join("simple.docx")}));
    // Sans contrôle, saveAs attendait sans fin la réponse à « Document en
    // cours d'utilisation » et le moteur restait bloqué.
    let err = ctx.engine.request(json!({"cmd": "save_as_location", "path": target}), &[], Duration::from_secs(30)).err().expect("refus attendu");
    assert!(err.contains("déjà ouvert (marie)"), "{err}");
    // Le moteur répond toujours.
    ctx.call(json!({"cmd": "info"}));
}

#[test]
fn csv_opens_without_the_import_dialog() {
    let Some((ctx, _)) = setup("csv") else { return };
    // Point-virgule, virgule décimale, UTF-8 : séparateur et encodage devinés.
    let csv = ctx.tmp.join("relevé.csv");
    std::fs::write(&csv, "Nom;Montant;Ville\nCafé;12,5;Québec\n\"a;b\";2;Montréal\n").unwrap();
    // Sans correctif, LibreOffice attend la réponse à la boîte « Import de texte ».
    let info = ctx.engine.request(json!({"cmd": "load", "path": csv}), &[], Duration::from_secs(60)).expect("chargement du CSV bloqué").json;
    assert_eq!(info["type"], "spreadsheet");
    ctx.call(json!({"cmd": "uno", "command": ".uno:GoToCell", "args": {"ToPoint": {"type": "string", "value": "D2"}}}));
    ctx.type_text("=B2*2");
    ctx.key(lok_sys::key::RETURN);
    ctx.settle();
    ctx.call(json!({"cmd": "save_in_place"}));
    let text = std::fs::read_to_string(&csv).expect("CSV réécrit en UTF-8");
    assert!(text.starts_with("Nom;Montant;Ville"), "{text}");
    assert!(text.contains("Café;12,5;Québec;25"), "colonnes ou formule mal lues : {text}");
    assert!(text.contains("\"a;b\";2;Montréal"), "{text}");
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
fn stale_lock_from_a_sibling_profile_is_removed() {
    let Some(program) = std::env::var_os("AUXI_LO_PROGRAM").map(PathBuf::from) else { return };
    let fixtures = PathBuf::from(std::env::var_os("AUXI_FIXTURES").unwrap());
    let root = std::env::temp_dir().join(format!("auxi-engine-test-root-{}", std::process::id()));
    let sibling = root.join("profil-7");
    std::fs::create_dir_all(&sibling).unwrap();
    let doc = root.join("doc.docx");
    std::fs::copy(fixtures.join("simple.docx"), &doc).unwrap();
    let sibling_url = url::Url::from_directory_path(sibling.canonicalize().unwrap()).unwrap();
    std::fs::write(root.join(".~lock.doc.docx#"), format!(",moi,ici,16.10.2026 09:00,{sibling_url};")).unwrap();
    let engine = Engine::spawn(
        &EngineConfig {
            engine_exe: PathBuf::from(env!("CARGO_BIN_EXE_auxi-engine")),
            program_dir: program,
            profile_dir: Some(root.join("profil-0")),
            lang: "fr-FR".into(),
            author: String::new(),
            log_file: None,
            profile_root: Some(root.clone()),
            grammar_url: None,
        },
        Box::new(|_| {}),
    )
    .unwrap();
    let info = engine.call(json!({"cmd": "load", "path": doc})).unwrap();
    assert_eq!(info["read_only"], false, "{info}");
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

#[test]
fn libreoffice_dialogs_render_and_close() {
    let Some((ctx, fx)) = setup("dialog") else { return };
    ctx.call(json!({"cmd": "load", "path": fx.join("simple.docx")}));
    ctx.settle();
    let before = ctx.events.lock().unwrap().len();
    ctx.call(json!({"cmd": "uno", "command": ".uno:FontDialog"}));
    ctx.settle();
    let created = ctx.events.lock().unwrap()[before..]
        .iter()
        .filter(|e| e["name"] == "window")
        .filter_map(|e| serde_json::from_str::<Value>(e["payload"].as_str().unwrap_or("")).ok())
        .find(|w| w["action"] == "created" && w["type"] == "dialog")
        .expect("boîte de dialogue « Caractère » annoncée");
    let id: i64 = created["id"].as_str().unwrap().parse().unwrap();
    let size: Vec<i64> = created["size"].as_str().unwrap().split(',').map(|v| v.trim().parse().unwrap()).collect();

    // Rendu à l'échelle 2 (écrans haute densité) : tampon entièrement dessiné.
    let r = ctx
        .engine
        .request(json!({"cmd": "paint_window", "window": id, "x": 0, "y": 0, "w": size[0], "h": size[1], "scale": 2.0}), &[], Duration::from_secs(30))
        .unwrap();
    assert_eq!(r.bin.len() as i64, size[0] * 2 * size[1] * 2 * 4);
    let drawn = r.bin.chunks_exact(4).filter(|p| p[3] > 0).count() as i64;
    assert!(drawn > size[0] * size[1] * 3, "rendu incomplet : {drawn} pixels");

    // Clic dans la boîte, puis fermeture : LibreOffice annonce « close ».
    for kind in ["down", "up"] {
        ctx.call(json!({"cmd": "window_mouse", "window": id, "kind": kind, "x": 100, "y": 61}));
    }
    let mark = ctx.events.lock().unwrap().len();
    ctx.call(json!({"cmd": "window_close", "window": id}));
    ctx.settle();
    let closed = ctx.events.lock().unwrap()[mark..].iter().any(|e| {
        e["name"] == "window" && e["payload"].as_str().is_some_and(|p| p.contains("\"close\"") || p.contains("\"hide\""))
    });
    assert!(closed, "fermeture non annoncée");
}

#[test]
fn context_menu_is_described_by_libreoffice() {
    let Some((ctx, fx)) = setup("ctxmenu") else { return };
    ctx.call(json!({"cmd": "load", "path": fx.join("simple.docx")}));
    ctx.settle();
    for kind in ["down", "up"] {
        ctx.call(json!({"cmd": "mouse", "kind": kind, "x": 3000, "y": 3000, "buttons": 4}));
    }
    ctx.settle();
    let menu = ctx
        .events
        .lock()
        .unwrap()
        .iter()
        .find(|e| e["name"] == "context_menu")
        .and_then(|e| serde_json::from_str::<Value>(e["payload"].as_str().unwrap()).ok())
        .expect("menu contextuel");
    assert!(menu["menu"].as_array().is_some_and(|m| m.len() > 3));
}

#[test]
fn export_still_works_after_a_previous_engine_crash() {
    // Un rapport de plantage dans le profil bloquait toute exportation suivante.
    let Some(program) = std::env::var_os("AUXI_LO_PROGRAM").map(PathBuf::from) else { return };
    let fixtures = PathBuf::from(std::env::var_os("AUXI_FIXTURES").unwrap());
    let tmp = std::env::temp_dir().join(format!("auxi-engine-test-crash-{}", std::process::id()));
    let crash = tmp.join("profil").join("crash");
    std::fs::create_dir_all(&crash).unwrap();
    std::fs::write(crash.join("dump.ini"), "[Version]\nProductName=LibreOffice\n").unwrap();
    std::fs::write(crash.join("rapport.dmp"), [0u8; 64]).unwrap();
    let engine = Engine::spawn(
        &EngineConfig {
            engine_exe: PathBuf::from(env!("CARGO_BIN_EXE_auxi-engine")),
            program_dir: program,
            profile_dir: Some(tmp.join("profil")),
            lang: "fr-FR".into(),
            author: String::new(),
            log_file: None,
            profile_root: None,
            grammar_url: None,
        },
        Box::new(|_| {}),
    )
    .unwrap();
    let doc = tmp.join("rapport.docx");
    std::fs::copy(fixtures.join("rapport.docx"), &doc).unwrap();
    engine.call(json!({"cmd": "load", "path": doc})).unwrap();
    let pdf = tmp.join("rapport.pdf");
    engine
        .request(json!({"cmd": "save", "path": pdf, "format": "pdf"}), &[], Duration::from_secs(30))
        .expect("export bloqué après un plantage précédent");
    assert!(std::fs::read(&pdf).unwrap().starts_with(b"%PDF-"));
    assert!(!crash.join("rapport.dmp").exists(), "rapport de plantage non retiré");
}

#[test]
fn pdf_export_honours_page_range() {
    let Some((ctx, fx)) = setup("range") else { return };
    ctx.call(json!({"cmd": "load", "path": fx.join("rapport.docx")}));
    // Objets « /Type /Page » (et non « /Pages »), espaces facultatifs.
    let count = |p: &PathBuf| {
        let d = std::fs::read(p).unwrap();
        let mut n = 0;
        for i in 0..d.len().saturating_sub(5) {
            if &d[i..i + 5] == b"/Type" {
                let mut j = i + 5;
                while j < d.len() && d[j].is_ascii_whitespace() {
                    j += 1;
                }
                if d[j..].starts_with(b"/Page") && d.get(j + 5) != Some(&b's') {
                    n += 1;
                }
            }
        }
        n
    };
    let all = ctx.tmp.join("tout.pdf");
    ctx.call(json!({"cmd": "save", "path": all, "format": "pdf"}));
    let part = ctx.tmp.join("plage.pdf");
    let opts = json!({"PageRange": {"type": "string", "value": "2-3"}}).to_string();
    ctx.call(json!({"cmd": "save", "path": part, "format": "pdf", "filter": opts}));
    let (n_all, n_part) = (count(&all), count(&part));
    eprintln!("pages : tout {n_all}, plage 2-3 : {n_part}");
    assert!(n_all > 5);
    assert!(n_part < n_all && n_part >= 2, "plage non appliquée ({n_part} sur {n_all})");
}

/// AuxiCorrect : avec l'adresse d'un serveur de correction, LibreOffice
/// l'interroge (protocole LanguageTool) pour le français du Canada, et son
/// propre dictionnaire n'est plus utilisé pour le français.
#[test]
fn french_is_checked_by_the_grammar_server() {
    use std::io::{BufRead, BufReader, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let s2 = seen.clone();
    std::thread::spawn(move || {
        for mut c in listener.incoming().flatten() {
            let mut r = BufReader::new(c.try_clone().unwrap());
            let (mut line, mut len) = (String::new(), 0usize);
            r.read_line(&mut line).unwrap();
            loop {
                let mut h = String::new();
                if r.read_line(&mut h).unwrap() == 0 || h.trim().is_empty() {
                    break;
                }
                if let Some(v) = h.to_ascii_lowercase().strip_prefix("content-length:") {
                    len = v.trim().parse().unwrap_or(0);
                }
            }
            let mut body = vec![0; len];
            r.read_exact(&mut body).unwrap();
            s2.lock().unwrap().push(format!("{} {}", line.trim(), String::from_utf8_lossy(&body)));
            let out = r#"{"matches":[]}"#;
            let _ = write!(c, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{out}", out.len());
        }
    });
    let Some((ctx, _)) = setup_with("grammaire", Some(format!("http://127.0.0.1:{port}/secret/v2"))) else { return };
    let doc = ctx.tmp.join("vierge.docx");
    std::fs::copy(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../app/src-tauri/templates/vierge.docx"), &doc).unwrap();
    ctx.call(json!({"cmd": "load", "path": doc}));
    ctx.settle();
    // Saisie en deux temps, comme au clavier : chaque modification relance la
    // vérification du paragraphe.
    ctx.type_text("Je suis allé au magazin hier.");
    let start = Instant::now();
    let mut again = false;
    while start.elapsed() < Duration::from_secs(25) && !seen.lock().unwrap().iter().any(|r| r.contains("magazin")) {
        std::thread::sleep(Duration::from_millis(200));
        if !again && start.elapsed() > Duration::from_secs(3) {
            ctx.type_text(" Encore.");
            again = true;
        }
    }
    let reqs = seen.lock().unwrap().clone();
    let r = reqs.iter().find(|r| r.contains("magazin")).unwrap_or_else(|| panic!("serveur non interrogé : {reqs:?}"));
    assert!(r.starts_with("POST /secret/v2/check"), "{r}");
    assert!(r.contains("language=fr-CA"), "langue du modèle vierge : {r}");
    let xcu = std::fs::read_to_string(ctx.tmp.join("profil/user/registrymodifications.xcu")).unwrap();
    assert!(xcu.contains(r#"SpellCheckerList"><prop oor:name="fr-CA""#), "dictionnaire LibreOffice retiré pour fr-CA");
    ctx.engine.shutdown();
}

/// AuxiDraw : dessin vierge livré, forme insérée, enregistrement ODG et
/// exportations PDF, PNG et SVG.
#[test]
fn draw_shapes_save_and_export() {
    let Some((ctx, _)) = setup("draw") else { return };
    let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../app/src-tauri/templates/vierge.odg");
    let doc = ctx.tmp.join("dessin.odg");
    std::fs::copy(&src, &doc).unwrap();
    let info = ctx.call(json!({"cmd": "load", "path": doc}));
    assert_eq!(info["type"], "drawing");
    assert_eq!(info["parts"], 1);
    // Page Lettre US en portrait (21,59 × 27,94 cm).
    assert!((info["width"].as_i64().unwrap() - 12240).abs() < 30, "{info}");
    ctx.call(json!({"cmd": "uno", "command": ".uno:BasicShapes.rectangle"}));
    ctx.settle();
    let copy = ctx.tmp.join("copie.odg");
    ctx.call(json!({"cmd": "save", "path": copy, "format": "odg"}));
    assert!(zip_entry(&copy, "content.xml").contains("draw:custom-shape"), "forme absente du fichier");
    for (ext, magic) in [("pdf", &b"%PDF-"[..]), ("png", &b"\x89PNG"[..])] {
        let out = ctx.tmp.join(format!("export.{ext}"));
        ctx.call(json!({"cmd": "save", "path": out, "format": ext}));
        assert!(std::fs::read(&out).unwrap().starts_with(magic), "export {ext}");
    }
    let svg = ctx.tmp.join("export.svg");
    ctx.call(json!({"cmd": "save", "path": svg, "format": "svg"}));
    assert!(String::from_utf8_lossy(&std::fs::read(&svg).unwrap()).contains("<svg"), "export svg");
    // Ajouter une page.
    ctx.call(json!({"cmd": "uno", "command": ".uno:InsertPage"}));
    ctx.settle();
    assert_eq!(ctx.call(json!({"cmd": "info"}))["parts"], 2);
}

/// AuxiDraw ouvre aussi les PDF (« Modifier dans AuxiDraw ») : une page de
/// dessin par page du PDF.
#[test]
fn pdf_opens_as_a_drawing() {
    let Some((ctx, fx)) = setup("pdfdraw") else { return };
    ctx.call(json!({"cmd": "load", "path": fx.join("rapport.docx")}));
    let pdf = ctx.tmp.join("rapport.pdf");
    let opts = json!({"PageRange": {"type": "string", "value": "1-2"}}).to_string();
    ctx.call(json!({"cmd": "save", "path": pdf, "format": "pdf", "filter": opts}));
    drop(ctx);
    let Some((ctx, _)) = setup("pdfdraw2") else { return };
    let info = ctx.call(json!({"cmd": "load", "path": pdf}));
    assert_eq!(info["type"], "drawing", "{info}");
    assert_eq!(info["parts"], 2);
    let (w, h) = (info["width"].as_i64().unwrap(), info["height"].as_i64().unwrap());
    assert!(ctx.paint_png("pdf-page.png", Some(0), 300, 0, 0, w, h) > 0.002, "page du PDF vide");
}
