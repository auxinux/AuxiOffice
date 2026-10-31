//! Les applications : AuxiOffice (le lanceur : il crée et ouvre chaque
//! document dans sa vraie application) et AuxiWriter, AuxiSheet, AuxiPresent,
//! AuxiDraw, AuxiPDF (un type de document chacune). C'est le même exécutable ; l'application est choisie
//! au lancement :
//!
//! 1. `--app writer|sheet|present|draw|pdf|office` (raccourcis Linux et Windows) ;
//! 2. variable `AUXI_APP` (développement) ;
//! 3. nom de l'exécutable : `AuxiWriter`, `auxisheet.exe`… (paquets macOS,
//!    où chaque application a son propre paquet `.app`).
//!
//! Chaque application n'a qu'une instance : un second lancement transmet ses
//! fichiers à l'instance en cours (connexion locale, jeton secret) puis quitte.

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppKind {
    Office,
    Writer,
    Sheet,
    Present,
    Draw,
    Pdf,
}

/// Toutes les applications (tests).
#[cfg(test)]
pub const ALL: [AppKind; 6] = [AppKind::Office, AppKind::Writer, AppKind::Sheet, AppKind::Present, AppKind::Draw, AppKind::Pdf];

impl AppKind {
    pub fn slug(self) -> &'static str {
        match self {
            AppKind::Office => "office",
            AppKind::Writer => "writer",
            AppKind::Sheet => "sheet",
            AppKind::Present => "present",
            AppKind::Draw => "draw",
            AppKind::Pdf => "pdf",
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            AppKind::Office => "AuxiOffice",
            AppKind::Writer => "AuxiWriter",
            AppKind::Sheet => "AuxiSheet",
            AppKind::Present => "AuxiPresent",
            AppKind::Draw => "AuxiDraw",
            AppKind::Pdf => "AuxiPDF",
        }
    }

    pub fn parse(s: &str) -> Option<AppKind> {
        let s = s.trim().to_ascii_lowercase();
        let s = s.strip_prefix("auxi").unwrap_or(&s);
        match s {
            "office" => Some(AppKind::Office),
            "writer" | "text" => Some(AppKind::Writer),
            "sheet" | "spreadsheet" => Some(AppKind::Sheet),
            "present" | "presentation" => Some(AppKind::Present),
            "draw" | "drawing" => Some(AppKind::Draw),
            "pdf" => Some(AppKind::Pdf),
            _ => None,
        }
    }

    /// Application qui ouvre ce fichier (d'après son extension).
    pub fn for_path(path: &str) -> AppKind {
        let ext = Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        match ext.as_str() {
            "xlsx" | "xlsm" | "xltx" | "xltm" | "xls" | "xlt" | "xlsb" | "ods" | "ots" | "csv" | "fods" => AppKind::Sheet,
            "pptx" | "pptm" | "ppsx" | "potx" | "potm" | "ppt" | "pps" | "pot" | "odp" | "otp" | "fodp" => AppKind::Present,
            "odg" | "otg" | "fodg" | "vsdx" | "vsd" | "vsdm" | "vdx" | "vstx" | "vst" | "cdr" | "cmx" | "pub" | "wpg" | "svg" => AppKind::Draw,
            "pdf" => AppKind::Pdf,
            _ => AppKind::Writer,
        }
    }

    pub fn icon_png(self) -> &'static [u8] {
        match self {
            AppKind::Office => include_bytes!("../icons/auxioffice.png"),
            AppKind::Writer => include_bytes!("../icons/auxiwriter.png"),
            AppKind::Sheet => include_bytes!("../icons/auxisheet.png"),
            AppKind::Present => include_bytes!("../icons/auxipresent.png"),
            AppKind::Draw => include_bytes!("../icons/auxidraw.png"),
            AppKind::Pdf => include_bytes!("../icons/auxipdf.png"),
        }
    }
}

/// Ce que demande un lancement : l'application, les fichiers à ouvrir et,
/// avec `--new`, un document vierge.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Launch {
    pub files: Vec<String>,
    #[serde(default)]
    pub new_doc: bool,
}

pub fn parse_args(args: &[String], exe: &Path, env_app: Option<&str>) -> (AppKind, Launch) {
    let mut kind = None;
    let mut launch = Launch::default();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if a == "--app" {
            kind = args.get(i + 1).and_then(|v| AppKind::parse(v)).or(kind);
            i += 2;
            continue;
        }
        if let Some(v) = a.strip_prefix("--app=") {
            kind = AppKind::parse(v).or(kind);
        } else if a == "--new" {
            launch.new_doc = true;
        } else if !a.starts_with('-') && Path::new(a).is_file() {
            launch.files.push(absolute(a));
        }
        i += 1;
    }
    let kind = kind
        .or_else(|| env_app.and_then(AppKind::parse))
        .or_else(|| exe.file_stem().and_then(|s| s.to_str()).and_then(AppKind::parse))
        .unwrap_or(AppKind::Office);
    (kind, launch)
}

fn absolute(p: &str) -> String {
    std::fs::canonicalize(p).map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| p.to_string())
}

// --- Instance unique -------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct Endpoint {
    port: u16,
    token: String,
}

fn endpoint_file(dir: &Path, kind: AppKind) -> PathBuf {
    dir.join("instances").join(format!("{}.json", kind.slug()))
}

/// Transmet le lancement à l'instance déjà ouverte de cette application.
/// Retourne vrai si elle l'a reçu (le processus courant peut alors quitter).
pub fn forward(dir: &Path, kind: AppKind, launch: &Launch) -> bool {
    let Some(ep) = std::fs::read(endpoint_file(dir, kind)).ok().and_then(|b| serde_json::from_slice::<Endpoint>(&b).ok()) else {
        return false;
    };
    let addr = SocketAddr::from(([127, 0, 0, 1], ep.port));
    let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) else {
        return false;
    };
    let _ = s.set_read_timeout(Some(Duration::from_secs(3)));
    let msg = serde_json::to_string(launch).unwrap_or_default();
    if writeln!(s, "{}\n{}", ep.token, msg).is_err() {
        return false;
    }
    let mut reply = String::new();
    BufReader::new(s).read_line(&mut reply).is_ok() && reply.trim() == "ok"
}

/// Retire l'adresse de l'instance (à la fermeture).
pub fn unlisten(dir: &Path, kind: AppKind) {
    let _ = std::fs::remove_file(endpoint_file(dir, kind));
}

/// Écoute les lancements suivants de cette application.
pub fn listen(dir: &Path, kind: AppKind, on_launch: impl Fn(Launch) + Send + 'static) -> Result<(), String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = new_token();
    let file = endpoint_file(dir, kind);
    std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    let body = serde_json::to_vec(&Endpoint { port, token: token.clone() }).map_err(|e| e.to_string())?;
    write_private(&file, &body)?;
    std::thread::spawn(move || {
        for conn in listener.incoming().flatten() {
            let _ = conn.set_read_timeout(Some(Duration::from_secs(3)));
            let mut r = BufReader::new(&conn);
            let (mut t, mut m) = (String::new(), String::new());
            if r.read_line(&mut t).is_err() || t.trim() != token || r.read_line(&mut m).is_err() {
                continue;
            }
            if let Ok(l) = serde_json::from_str::<Launch>(m.trim()) {
                on_launch(l);
                let _ = (&conn).write_all(b"ok\n");
            }
        }
    });
    Ok(())
}

pub fn new_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut out = String::new();
    for i in 0..4u64 {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(i ^ std::process::id() as u64);
        h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

fn write_private(file: &Path, body: &[u8]) -> Result<(), String> {
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    o.open(file).and_then(|mut f| f.write_all(body)).map_err(|e| format!("{} : {e}", file.display()))
}

// --- Lancer une autre application ------------------------------------------

/// Ouvre `kind` (déjà ouverte : lui transmet les fichiers ; sinon la démarre).
pub fn launch(dir: &Path, kind: AppKind, l: &Launch) -> Result<(), String> {
    if forward(dir, kind, l) {
        return Ok(());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut args: Vec<String> = Vec::new();
    if l.new_doc {
        args.push("--new".into());
    }
    args.extend(l.files.iter().cloned());

    // macOS : paquet `AuxiWriter.app` à côté du nôtre → `open`, pour que le
    // Dock montre la bonne application.
    #[cfg(target_os = "macos")]
    if let Some(bundle) = sibling_bundle(&exe, kind) {
        let mut c = Command::new("open");
        c.arg("-a").arg(&bundle);
        c.args(&l.files);
        if l.new_doc {
            c.args(["--args", "--new"]);
        }
        return spawn(c);
    }
    // Linux, Windows : exécutable `auxiwriter` / `AuxiWriter.exe` à côté du nôtre.
    if let Some(sibling) = sibling_exe(&exe, kind) {
        let mut c = Command::new(sibling);
        c.args(&args);
        return spawn(c);
    }
    let mut c = Command::new(exe);
    c.arg("--app").arg(kind.slug()).args(&args);
    spawn(c)
}

fn spawn(mut c: Command) -> Result<(), String> {
    auxi_engine::no_console(&mut c).stdin(Stdio::null());
    let mut child = c.spawn().map_err(|e| format!("lancement impossible : {e}"))?;
    // L'application lancée vit sa vie ; on recueille sa fin pour qu'elle ne
    // reste pas en processus zombie tant qu'AuxiOffice est ouvert.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

/// Paquet `AuxiWriter.app`… : à côté du nôtre, puis dans ~/Applications et
/// /Applications (AuxiOffice lancé hors paquet, par `scripts/dev.sh`).
#[cfg(target_os = "macos")]
fn sibling_bundle(exe: &Path, kind: AppKind) -> Option<PathBuf> {
    let name = format!("{}.app", kind.name());
    let mut dirs: Vec<PathBuf> = vec![];
    // …/AuxiOffice.app/Contents/MacOS/AuxiOffice
    if let Some(app) = exe.parent().and_then(Path::parent).and_then(Path::parent) {
        if app.extension().is_some_and(|e| e == "app") {
            if let Some(d) = app.parent() {
                dirs.push(d.to_path_buf());
            }
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join("Applications"));
    }
    dirs.push(PathBuf::from("/Applications"));
    dirs.into_iter().map(|d| d.join(&name)).find(|b| b.join("Contents/Info.plist").is_file())
}

fn sibling_exe(exe: &Path, kind: AppKind) -> Option<PathBuf> {
    let dir = exe.parent()?;
    let ext = if cfg!(windows) { ".exe" } else { "" };
    [kind.name().to_string(), kind.name().to_ascii_lowercase()]
        .into_iter()
        .map(|n| dir.join(format!("{n}{ext}")))
        .find(|p| p.is_file() && p != exe)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn app_from_args_env_or_exe_name() {
        let exe = Path::new("/usr/bin/auxioffice");
        assert_eq!(parse_args(&s(&["--app", "writer"]), exe, None).0, AppKind::Writer);
        assert_eq!(parse_args(&s(&["--app=sheet", "--new"]), exe, None), (AppKind::Sheet, Launch { files: vec![], new_doc: true }));
        assert_eq!(parse_args(&[], exe, Some("present")).0, AppKind::Present);
        assert_eq!(parse_args(&[], Path::new("/Applications/AuxiWriter.app/Contents/MacOS/AuxiWriter"), None).0, AppKind::Writer);
        assert_eq!(parse_args(&[], Path::new("/opt/auxioffice/auxisheet"), None).0, AppKind::Sheet);
        #[cfg(windows)]
        assert_eq!(parse_args(&[], Path::new("C:\\AuxiOffice\\AuxiSheet.exe"), None).0, AppKind::Sheet);
        assert_eq!(parse_args(&[], exe, None).0, AppKind::Office);
        // L'argument l'emporte sur le nom de l'exécutable.
        assert_eq!(parse_args(&s(&["--app", "present"]), Path::new("/x/auxiwriter"), None).0, AppKind::Present);
    }

    #[test]
    fn files_are_kept_and_made_absolute() {
        let dir = std::env::temp_dir().join(format!("auxi-apps-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a.docx");
        std::fs::write(&f, b"x").unwrap();
        let (_, l) = parse_args(&s(&["--app", "writer", f.to_str().unwrap(), "/nonexistent.docx"]), Path::new("auxioffice"), None);
        assert_eq!(l.files, vec![std::fs::canonicalize(&f).unwrap().to_string_lossy().into_owned()]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn file_types_go_to_the_right_app() {
        assert_eq!(AppKind::for_path("/a/b.DOCX"), AppKind::Writer);
        assert_eq!(AppKind::for_path("b.odt"), AppKind::Writer);
        assert_eq!(AppKind::for_path("b.csv"), AppKind::Sheet);
        assert_eq!(AppKind::for_path("b.xls"), AppKind::Sheet);
        assert_eq!(AppKind::for_path("b.pptx"), AppKind::Present);
        assert_eq!(AppKind::for_path("b.pptm"), AppKind::Present);
        assert_eq!(AppKind::for_path("b.odg"), AppKind::Draw);
        assert_eq!(AppKind::for_path("plan.VSDX"), AppKind::Draw);
        assert_eq!(AppKind::for_path("/a/facture.pdf"), AppKind::Pdf);
        assert_eq!(AppKind::for_path("/a/Prix l'été.XLSM"), AppKind::Sheet);
        assert_eq!(AppKind::for_path("b.docm"), AppKind::Writer);
        for k in ALL {
            assert_eq!(AppKind::parse(k.slug()), Some(k));
            assert_eq!(AppKind::parse(k.name()), Some(k));
        }
        assert_eq!(AppKind::for_path("notes"), AppKind::Writer);
    }

    #[test]
    fn second_launch_is_forwarded_to_the_running_instance() {
        let dir = std::env::temp_dir().join(format!("auxi-inst-{}", std::process::id()));
        let (tx, rx) = std::sync::mpsc::channel();
        assert!(!forward(&dir, AppKind::Sheet, &Launch::default()), "aucune instance encore");
        listen(&dir, AppKind::Sheet, move |l| tx.send(l).unwrap()).unwrap();
        let l = Launch { files: vec!["/tmp/x.xlsx".into()], new_doc: false };
        assert!(forward(&dir, AppKind::Sheet, &l));
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), l);
        // Une autre application n'est pas concernée.
        assert!(!forward(&dir, AppKind::Writer, &l));
        // Mauvais jeton : refusé.
        let mut ep: Endpoint = serde_json::from_slice(&std::fs::read(endpoint_file(&dir, AppKind::Sheet)).unwrap()).unwrap();
        ep.token = "faux".into();
        std::fs::write(endpoint_file(&dir, AppKind::Sheet), serde_json::to_vec(&ep).unwrap()).unwrap();
        assert!(!forward(&dir, AppKind::Sheet, &l));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
