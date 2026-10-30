//! AuxiOffice Online : serveur de web.office.auxinux.ca.
//!
//! Il sert l'interface (les mêmes applications que sur le bureau, chargées
//! et exécutées par le navigateur), l'espace de documents de chaque
//! utilisateur et, pour les documents de bureautique, un moteur isolé par
//! document. AuxiText et AuxiPDF fonctionnent entièrement dans le navigateur.

mod api;
mod auth;
mod engines;
mod grammar;
mod storage;
mod ws;

// AuxiCorrect : les mêmes modules que l'application de bureau (AuxiWriter
// et AuxiText), qui appellent l'outil `auxicorrect-cli` d'AuxiCorrect.
#[allow(dead_code)]
#[path = "../../../app/src-tauri/src/auxicorrect.rs"]
mod auxicorrect;
#[allow(dead_code)]
#[path = "../../../text/src-tauri/src/auxicorrect.rs"]
mod text_auxicorrect;

/// Pour `auxicorrect::serve` (inutilisé ici) : jeton aléatoire.
#[allow(dead_code)]
mod apps {
    pub fn new_token() -> String {
        crate::auth::random_token()
    }
}

use axum::routing::{get, post};
use axum::Router;
use engines::{Pool, Sandbox, Setup};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tower_http::services::ServeDir;

pub struct Download {
    user: String,
    name: String,
    mime: &'static str,
    bytes: Vec<u8>,
    at: Instant,
}

pub struct AppState {
    pub auth: auth::Auth,
    pub store: storage::Storage,
    pub pool: Arc<Pool>,
    pub secure_cookies: bool,
    pub quota_mb: u64,
    /// AuxiCorrect : `auxicorrect-cli` et sa version, s'il est installé.
    pub auxicorrect: Option<(PathBuf, Option<String>)>,
    downloads: Mutex<HashMap<String, Download>>,
}

impl AppState {
    pub fn add_download(&self, user: &str, name: &str, mime: &'static str, bytes: Vec<u8>) -> String {
        let token = auth::random_token();
        let mut d = self.downloads.lock().unwrap();
        d.retain(|_, x| x.at.elapsed() < Duration::from_secs(600));
        d.insert(token.clone(), Download { user: user.into(), name: name.into(), mime, bytes, at: Instant::now() });
        token
    }

    pub fn take_download(&self, token: &str, user: &str) -> Option<Download> {
        let mut d = self.downloads.lock().unwrap();
        match d.get(token) {
            Some(x) if x.user == user && x.at.elapsed() < Duration::from_secs(600) => d.remove(token),
            _ => None,
        }
    }
}

const USAGE: &str = "AuxiOffice Online — serveur de web.office.auxinux.ca

Utilisation :
  auxi-online [serve] [options]        démarre le serveur
  auxi-online user add <courriel> [--name <nom>] [--quota-mb <n>] [--admin]
  auxi-online user admin <courriel>    (donne le rôle d'administrateur)
  auxi-online user passwd <courriel>
  auxi-online user remove <courriel>
  auxi-online user list
  (mot de passe lu dans AUXI_PASSWORD, sinon sur l'entrée standard)

Options (aussi en variables AUXI_ONLINE_<OPTION>, ex. AUXI_ONLINE_LISTEN) :
  --listen <adresse:port>   défaut 127.0.0.1:8090
  --data <dossier>          données (comptes, documents, moteurs) ; défaut ./donnees
  --web <dossier>           interface construite (online/web/dist)
  --no-auth                 sans comptes : un seul utilisateur « local » (poste personnel)
  --secure-cookies          témoin « Secure » (derrière HTTPS : à activer en production)
  --sandbox auto|bwrap|none bac à sable des moteurs (défaut auto : bubblewrap s'il fonctionne)
  --max-engines <n>         moteurs simultanés sur le serveur (défaut 16)
  --max-docs <n>            documents ouverts par utilisateur (défaut 6)
  --spares <n>              moteurs de réserve démarrés d'avance (défaut 1)
  --idle-minutes <n>        fermeture d'un document inactif (défaut 120)
  --resume-seconds <n>      après une coupure, délai de reconnexion avant de fermer les
                            documents de l'onglet (défaut 180)
  --quota-mb <n>            espace par utilisateur (défaut 2048)
  --max-open-mb <n>         taille maximale d'un document ouvert (défaut 200)
  --lang <langue>           langue des moteurs (défaut fr-FR)
  --auxicorrect-cli <outil> correcteur AuxiCorrect (défaut : celui déclaré par AuxiCorrect dans
                            ~/.config/auxinux/auxicorrect.json) ; « none » : sans AuxiCorrect
  --engine <fichier>        auxi-engine (sinon AUXI_ENGINE_EXE ou détection)
  --lo-program <dossier>    dossier program/ du moteur de documents (sinon AUXI_LO_PROGRAM)
  --templates <dossier>     modèles vierges (sinon AUXI_TEMPLATES)
";

struct Args {
    flags: HashMap<String, String>,
    positional: Vec<String>,
}

const BOOL_FLAGS: &[&str] = &["no-auth", "secure-cookies", "help", "admin"];

fn parse_args() -> Args {
    let mut flags = HashMap::new();
    let mut positional = vec![];
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        if a == "-h" {
            flags.insert("help".into(), "1".into());
        } else if let Some(k) = a.strip_prefix("--") {
            if let Some((k, v)) = k.split_once('=') {
                flags.insert(k.into(), v.into());
            } else if BOOL_FLAGS.contains(&k) {
                flags.insert(k.into(), "1".into());
            } else {
                flags.insert(k.into(), it.next().unwrap_or_default());
            }
        } else {
            positional.push(a);
        }
    }
    Args { flags, positional }
}

impl Args {
    fn get(&self, k: &str) -> Option<String> {
        self.flags.get(k).cloned().or_else(|| std::env::var(format!("AUXI_ONLINE_{}", k.to_uppercase().replace('-', "_"))).ok()).filter(|v| !v.is_empty())
    }
    fn on(&self, k: &str) -> bool {
        self.get(k).is_some_and(|v| v != "0" && v != "false")
    }
    fn num(&self, k: &str, default: u64) -> u64 {
        self.get(k).and_then(|v| v.parse().ok()).unwrap_or(default)
    }
}

fn exe_dir() -> PathBuf {
    std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)).unwrap_or_default()
}

/// Racine du dépôt quand le serveur tourne depuis `target/<profil>/`.
fn repo_root() -> Option<PathBuf> {
    let d = exe_dir();
    let r = d.parent()?.parent()?.to_path_buf();
    r.join("online").is_dir().then_some(r)
}

fn dev_platform() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => Some("linux-x86_64"),
        ("linux", "aarch64") => Some("linux-aarch64"),
        ("macos", "aarch64") => Some("macos-aarch64"),
        ("windows", "x86_64") => Some("windows-x86_64"),
        _ => None,
    }
}

/// Emplacements par défaut : à côté de l'exécutable (installation :
/// `auxi-engine`, `engine/program/`, `templates/`, `web/`), sinon l'arbre de
/// développement (`target/<profil>/`, `.engine/<plateforme>/program-dir`).
fn locate(args: &Args) -> (PathBuf, PathBuf, PathBuf, PathBuf) {
    let dir = exe_dir();
    let engine_name = if cfg!(windows) { "auxi-engine.exe" } else { "auxi-engine" };
    let repo = repo_root();
    let pick = |flag: &str, env: &str, installed: PathBuf, dev: Option<PathBuf>| -> PathBuf {
        args.flags.get(flag).map(PathBuf::from).or_else(|| std::env::var_os(env).map(PathBuf::from)).unwrap_or_else(|| if installed.exists() { installed } else { dev.unwrap_or(installed) })
    };
    let dev_program = repo.as_ref().zip(dev_platform()).and_then(|(r, p)| std::fs::read_to_string(r.join(".engine").join(p).join("program-dir")).ok()).map(|s| PathBuf::from(s.trim()));
    let engine = pick("engine", "AUXI_ENGINE_EXE", dir.join(engine_name), None);
    let program = pick("lo-program", "AUXI_LO_PROGRAM", dir.join("engine").join("program"), dev_program);
    let templates = pick("templates", "AUXI_TEMPLATES", dir.join("templates"), repo.as_ref().map(|r| r.join("app/src-tauri/templates")));
    let web = args.get("web").map(PathBuf::from).unwrap_or_else(|| if dir.join("web").is_dir() { dir.join("web") } else { repo.as_ref().map(|r| r.join("online/web/dist")).unwrap_or(dir.join("web")) });
    (engine, program, templates, web)
}

/// bubblewrap utilisable (espaces de noms autorisés par le noyau) ?
fn detect_sandbox(choice: &str) -> Result<Sandbox, String> {
    let find = || -> Option<PathBuf> {
        let path = std::env::var_os("PATH")?;
        std::env::split_paths(&path).map(|d| d.join("bwrap")).find(|p| p.is_file())
    };
    let works = |b: &Path| {
        std::process::Command::new(b)
            .args(["--ro-bind", "/", "/", "--unshare-all", "--die-with-parent", "true"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
    };
    match choice {
        "none" => Ok(Sandbox::None),
        "bwrap" => match find() {
            Some(b) if works(&b) => Ok(Sandbox::Bwrap(b)),
            Some(_) => Err("bubblewrap ne fonctionne pas sur ce système (espaces de noms utilisateur désactivés ?)".into()),
            None => Err("bubblewrap (bwrap) est introuvable : installez le paquet bubblewrap".into()),
        },
        _ => Ok(match find() {
            Some(b) if cfg!(target_os = "linux") && works(&b) => Sandbox::Bwrap(b),
            _ => {
                eprintln!("auxi-online : ATTENTION, moteurs sans bac à sable (installez bubblewrap pour un serveur public)");
                Sandbox::None
            }
        }),
    }
}

fn read_password() -> String {
    if let Ok(p) = std::env::var("AUXI_PASSWORD") {
        return p;
    }
    eprint!("Mot de passe : ");
    let mut s = String::new();
    let _ = std::io::stdin().read_line(&mut s);
    s.trim_end_matches(['\r', '\n']).to_string()
}

fn user_command(args: &Args, data: &Path) -> Result<(), String> {
    let file = data.join("users.json");
    let mut users = auth::load_users(&file);
    let pos = &args.positional;
    let email = pos.get(2).map(|e| e.trim().to_string());
    match pos.get(1).map(String::as_str) {
        Some("list") => {
            for u in &users {
                println!("{}\t{}\t{}{}", u.email, u.name, u.id, if u.admin { "\tadministrateur" } else { "" });
            }
            Ok(())
        }
        Some("add") => {
            let email = email.ok_or("courriel manquant")?;
            if users.iter().any(|u| u.email.eq_ignore_ascii_case(&email)) {
                return Err(format!("{email} existe déjà"));
            }
            // Le premier compte est administrateur.
            let admin = args.on("admin") || users.is_empty();
            let u = auth::new_user(&email, &args.get("name").unwrap_or_default(), &read_password(), args.get("quota-mb").and_then(|q| q.parse().ok()), admin)?;
            users.push(u);
            auth::save_users(&file, &users)?;
            println!("compte créé : {email}{}", if admin { " (administrateur)" } else { "" });
            Ok(())
        }
        Some("admin") => {
            let email = email.ok_or("courriel manquant")?;
            let u = users.iter_mut().find(|u| u.email.eq_ignore_ascii_case(&email)).ok_or(format!("{email} : compte inconnu"))?;
            u.admin = true;
            auth::save_users(&file, &users)?;
            println!("{email} est administrateur");
            Ok(())
        }
        Some("passwd") => {
            let email = email.ok_or("courriel manquant")?;
            let hash = auth::hash_password(&read_password())?;
            let u = users.iter_mut().find(|u| u.email.eq_ignore_ascii_case(&email)).ok_or(format!("{email} : compte inconnu"))?;
            u.hash = hash;
            auth::save_users(&file, &users)?;
            println!("mot de passe changé : {email}");
            Ok(())
        }
        Some("remove") => {
            let email = email.ok_or("courriel manquant")?;
            let before = users.len();
            users.retain(|u| !u.email.eq_ignore_ascii_case(&email));
            if users.len() == before {
                return Err(format!("{email} : compte inconnu"));
            }
            auth::save_users(&file, &users)?;
            println!("compte supprimé : {email} (ses documents restent dans {})", data.join("files").display());
            Ok(())
        }
        _ => Err(USAGE.into()),
    }
}

#[tokio::main]
async fn main() {
    let args = parse_args();
    if args.on("help") {
        print!("{USAGE}");
        return;
    }
    let data = PathBuf::from(args.get("data").unwrap_or_else(|| "donnees".into()));
    if args.positional.first().map(String::as_str) == Some("user") {
        if let Err(e) = user_command(&args, &data) {
            eprintln!("{e}");
            std::process::exit(1);
        }
        return;
    }
    if let Err(e) = serve(args, data).await {
        eprintln!("auxi-online : {e}");
        std::process::exit(1);
    }
}

async fn serve(args: Args, data: PathBuf) -> Result<(), String> {
    std::fs::create_dir_all(&data).map_err(|e| format!("{} : {e}", data.display()))?;
    let data = data.canonicalize().map_err(|e| e.to_string())?;
    let (engine_exe, program_dir, templates, web) = locate(&args);
    for (what, p) in [("moteur (auxi-engine)", &engine_exe), ("moteur de documents (program/)", &program_dir), ("modèles", &templates)] {
        if !p.exists() {
            eprintln!("auxi-online : ATTENTION, {what} introuvable : {}", p.display());
        }
    }
    if !web.join("index.html").is_file() {
        eprintln!("auxi-online : ATTENTION, interface introuvable : {} (cd online/web && npm run build)", web.display());
    }
    let sandbox = detect_sandbox(&args.get("sandbox").unwrap_or_else(|| "auto".into()))?;
    let auxicorrect = match args.get("auxicorrect-cli").as_deref() {
        Some("none") => None,
        Some(p) => Some((PathBuf::from(p), None)).filter(|(p, _)| p.is_file()),
        None => {
            let shared = auxicorrect::read_shared(&auxicorrect::shared_settings_path());
            shared.cli.map(|c| (c, shared.version))
        }
    };
    match &auxicorrect {
        Some((cli, _)) => eprintln!("auxi-online : AuxiCorrect : {}", cli.display()),
        None => eprintln!("auxi-online : sans AuxiCorrect (correcteur intégré seulement)"),
    }
    let setup = Setup {
        engine_exe,
        program_dir,
        templates,
        lang: args.get("lang").unwrap_or_else(|| "fr-FR".into()),
        root: data.join("engines"),
        sandbox: sandbox.clone(),
        max_engines: args.num("max-engines", 16).max(1) as usize,
        max_per_user: args.num("max-docs", 6).max(1) as usize,
        spares: args.num("spares", 1) as usize,
        max_open_mb: args.num("max-open-mb", 200),
        auxicorrect: auxicorrect.as_ref().map(|(c, _)| c.clone()),
        files_root: data.join("files"),
    };
    std::fs::create_dir_all(&setup.root).map_err(|e| e.to_string())?;
    let no_auth = args.on("no-auth");
    let users_file = data.join("users.json");
    if !no_auth {
        let mut users = auth::load_users(&users_file);
        if users.is_empty() {
            eprintln!("auxi-online : aucun compte. Créez-en un : auxi-online user add <courriel> --data {}", data.display());
        } else if !users.iter().any(|u| u.admin) {
            // Comptes créés avant le rôle d'administrateur : le premier le reçoit.
            users[0].admin = true;
            auth::save_users(&users_file, &users)?;
            eprintln!("auxi-online : {} devient administrateur (premier compte)", users[0].email);
        }
    }
    let pool = Arc::new(Pool::new(setup));
    let app = Arc::new(AppState {
        auth: auth::Auth::new((!no_auth).then_some(users_file), Duration::from_secs(args.num("session-days", 14) * 86400)),
        store: storage::Storage::new(data.join("files")),
        pool: pool.clone(),
        secure_cookies: args.on("secure-cookies"),
        quota_mb: args.num("quota-mb", 2048),
        auxicorrect,
        downloads: Mutex::new(HashMap::new()),
    });
    pool.refill();

    // Documents inactifs : fermés (leur moteur libéré) après le délai.
    let idle = Duration::from_secs(args.num("idle-minutes", 120) * 60);
    let grace = Duration::from_secs(args.num("resume-seconds", 180));
    let p = pool.clone();
    tokio::spawn(async move {
        let mut t = tokio::time::interval(Duration::from_secs(20));
        loop {
            t.tick().await;
            let p = p.clone();
            let _ = tokio::task::spawn_blocking(move || {
                p.reap(idle, grace);
                p.refill();
            })
            .await;
        }
    });

    // L'interface : portail à la racine, applications dans /office et /text ;
    // les ressources appelées par un chemin absolu (/icons, /pdfjs) sont
    // cherchées dans chacune.
    let statics = ServeDir::new(&web).fallback(ServeDir::new(web.join("office")).fallback(ServeDir::new(web.join("text"))));
    let router = Router::new()
        .route("/api/me", get(api::me))
        .route("/api/login", post(api::login))
        .route("/api/logout", post(api::logout))
        .route("/api/me/password", post(api::change_password))
        .route("/api/admin/users", get(api::admin_list).post(api::admin_add))
        .route("/api/admin/users/update", post(api::admin_update))
        .route("/api/admin/users/delete", post(api::admin_delete))
        .route("/api/files", get(api::list))
        .route("/api/file", get(api::read).put(api::write))
        .route("/api/stat", post(api::stat))
        .route("/api/mkdir", post(api::mkdir))
        .route("/api/move", post(api::rename))
        .route("/api/delete", post(api::delete))
        .route("/api/new", post(api::new_document))
        .route("/api/kv/{name}", get(api::kv_get).put(api::kv_put))
        .route("/api/download/{token}", get(api::download))
        .route("/api/log", post(api::log))
        .route("/api/auxicorrect", get(api::auxicorrect_get).put(api::auxicorrect_put))
        .route("/api/auxicorrect/lookup", post(api::auxicorrect_lookup))
        .route("/api/auxicorrect/check", post(api::auxicorrect_check))
        .route("/ws", get(ws::handler))
        .fallback_service(statics)
        // Pages HTML toujours revérifiées : après une mise à jour, le navigateur
        // charge la nouvelle interface (les scripts ont des noms qui changent).
        .layer(axum::middleware::map_response(|mut r: axum::response::Response| async move {
            let html = r.headers().get(axum::http::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|t| t.starts_with("text/html"));
            if html {
                r.headers_mut().insert(axum::http::header::CACHE_CONTROL, axum::http::HeaderValue::from_static("no-cache"));
            }
            r
        }))
        .layer(axum::extract::DefaultBodyLimit::max(args.num("max-open-mb", 200) as usize * 1024 * 1024))
        .layer(tower_http::set_header::SetResponseHeaderLayer::overriding(axum::http::header::X_CONTENT_TYPE_OPTIONS, axum::http::HeaderValue::from_static("nosniff")))
        .layer(tower_http::set_header::SetResponseHeaderLayer::overriding(axum::http::header::REFERRER_POLICY, axum::http::HeaderValue::from_static("same-origin")))
        .with_state(app.clone());

    let listen: SocketAddr = args.get("listen").unwrap_or_else(|| "127.0.0.1:8090".into()).parse().map_err(|e| format!("--listen : {e}"))?;
    let listener = tokio::net::TcpListener::bind(listen).await.map_err(|e| format!("{listen} : {e}"))?;
    eprintln!(
        "AuxiOffice Online {} : http://{listen}/ (données {}, {}, bac à sable : {})",
        env!("CARGO_PKG_VERSION"),
        data.display(),
        if no_auth { "sans comptes" } else { "comptes" },
        match sandbox {
            Sandbox::Bwrap(_) => "bubblewrap",
            Sandbox::None => "aucun",
        }
    );
    // Arrêt (Ctrl+C, SIGTERM) : moteurs fermés proprement, sans attendre
    // la fin des connexions WebSocket encore ouvertes.
    let stop = async {
        let ctrl_c = tokio::signal::ctrl_c();
        #[cfg(unix)]
        {
            let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("signal");
            tokio::select! { _ = ctrl_c => {}, _ = term.recv() => {} }
        }
        #[cfg(not(unix))]
        let _ = ctrl_c.await;
    };
    tokio::select! {
        r = axum::serve(listener, router) => r.map_err(|e| e.to_string())?,
        _ = stop => {}
    }
    eprintln!("auxi-online : arrêt, fermeture des moteurs…");
    let p = pool.clone();
    let _ = tokio::task::spawn_blocking(move || p.shutdown_all()).await;
    Ok(())
}
