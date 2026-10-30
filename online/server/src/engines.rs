//! Moteurs de documents d'AuxiOffice Online : un processus `auxi-engine`
//! (LibreOfficeKit) par document ouvert, comme dans l'application de bureau.
//!
//! Chaque moteur tourne dans un « emplacement » (`données/engines/slot-N/`) :
//! son profil et son espace de travail (`work/`). Le document y est copié à
//! l'ouverture et recopié dans l'espace de l'utilisateur à l'enregistrement :
//! le moteur ne voit jamais les autres fichiers du serveur. Sous Linux, il
//! tourne de plus dans un bac à sable bubblewrap (sans réseau, système en
//! lecture seule, seul son emplacement est modifiable).
//!
//! Des moteurs de réserve, LibreOffice déjà démarré, rendent l'ouverture
//! d'un document presque immédiate.

use crate::storage::{self, Storage};
use auxi_engine::client::{Engine, EngineConfig};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::mpsc::UnboundedSender;

/// Message vers une connexion WebSocket.
pub enum WsOut {
    Text(String),
    Binary(Vec<u8>),
}

pub type Outbox = UnboundedSender<WsOut>;

#[derive(Clone, Debug)]
pub enum Sandbox {
    None,
    Bwrap(PathBuf),
}

pub struct Setup {
    pub engine_exe: PathBuf,
    pub program_dir: PathBuf,
    pub templates: PathBuf,
    pub lang: String,
    pub root: PathBuf,
    pub sandbox: Sandbox,
    pub max_engines: usize,
    pub max_per_user: usize,
    pub spares: usize,
    pub max_open_mb: u64,
    /// `auxicorrect-cli` d'AuxiCorrect (correction du français), si installé.
    pub auxicorrect: Option<PathBuf>,
    /// Espaces des utilisateurs (`données/files`) : options d'AuxiCorrect.
    pub files_root: PathBuf,
}

/// Où envoyer les événements d'un moteur : fixé quand il reçoit son document
/// (un moteur de réserve n'appartient encore à personne).
#[derive(Default)]
struct Route {
    doc: AtomicU64,
    tx: Mutex<Option<Outbox>>,
}

struct Spare {
    engine: Engine,
    route: Arc<Route>,
    slot: usize,
}

struct DocState {
    vpath: String,
    work_file: PathBuf,
}

pub struct OpenDoc {
    pub id: u64,
    pub user: String,
    /// Session WebSocket du document : elle survit à une coupure le temps
    /// d'une reconnexion (voir `detach` et `attach`).
    pub session: String,
    engine: Engine,
    route: Arc<Route>,
    slot: usize,
    work: PathBuf,
    state: Mutex<DocState>,
    last: Mutex<Instant>,
}

/// Session WebSocket : son utilisateur et, si sa connexion est coupée, depuis quand.
struct Session {
    user: String,
    detached: Option<Instant>,
}

pub struct Pool {
    pub setup: Setup,
    sessions: Mutex<HashMap<String, Session>>,
    /// Utilisateur du document de chaque emplacement (AuxiCorrect).
    slot_users: Arc<Mutex<HashMap<usize, String>>>,
    /// Emplacements dont la prise AuxiCorrect écoute déjà.
    grammar_slots: Mutex<std::collections::HashSet<usize>>,
    slots: Mutex<Vec<bool>>,
    spares: Mutex<Vec<Spare>>,
    warming: AtomicUsize,
    docs: Mutex<HashMap<u64, Arc<OpenDoc>>>,
    next: AtomicU64,
}

/// Commandes du protocole du moteur que l'interface peut envoyer telles quelles.
const PASS_THROUGH: &[&str] = &[
    "info", "key", "text", "mouse", "window_mouse", "window_key", "window_text", "window_close", "set_part", "set_part_mode", "command_values", "selection", "paste",
    "set_text_selection", "reset_selection", "client_zoom", "visible_area",
];

/// Commandes UNO refusées : macros, accès à d'autres fichiers du serveur,
/// boîtes de fichiers de LibreOffice, fermeture du document par le moteur.
const DENIED_UNO: &[&str] = &[
    ".uno:Open", ".uno:OpenFromWriter", ".uno:OpenFromCalc", ".uno:OpenRemote", ".uno:OpenUrl", ".uno:OpenTemplate", ".uno:RunMacro", ".uno:MacroDialog",
    ".uno:MacroOrganizer", ".uno:BasicIDEAppear", ".uno:MacroRecorder", ".uno:StopRecording", ".uno:ScriptOrganizer", ".uno:Quit", ".uno:CloseDoc", ".uno:CloseWin",
    ".uno:SaveAs", ".uno:SaveACopy", ".uno:SaveAll", ".uno:ExportTo", ".uno:ExportToPDF", ".uno:ExportDirectToPDF", ".uno:ExportToEPUB", ".uno:InsertObject",
    ".uno:InsertPlugin", ".uno:InsertDoc", ".uno:InsertFile", ".uno:LinkDialog", ".uno:ManageLinks", ".uno:EditLinks", ".uno:AddDirect", ".uno:NewDoc",
    ".uno:ExtensionManager", ".uno:OptionsTreeDialog", ".uno:AutoPilotMenu", ".uno:DataSourceBrowser", ".uno:ViewDataSourceBrowser", ".uno:Signature",
    ".uno:PrintDefault", ".uno:Print", ".uno:PrinterSetup", ".uno:SendMail", ".uno:SendMailDocAsPDF", ".uno:SendMailDocAsMS", ".uno:SendMailDocAsOOo",
];

fn now_ms() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

/// Nom de fichier sûr dans un espace de travail.
fn safe_name(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { '_' } else { c }).collect();
    let s = s.trim().trim_start_matches('.').to_string();
    if s.is_empty() {
        "Document".into()
    } else {
        s
    }
}

fn file_url(p: &Path) -> String {
    url::Url::from_file_path(p).map(|u| u.to_string()).unwrap_or_default()
}

impl Pool {
    pub fn new(setup: Setup) -> Pool {
        // Emplacements d'une exécution précédente : profils gardés, espaces de travail vidés.
        if let Ok(rd) = std::fs::read_dir(&setup.root) {
            for e in rd.flatten() {
                let _ = std::fs::remove_dir_all(e.path().join("work"));
            }
        }
        Pool { setup, sessions: Mutex::new(HashMap::new()), slot_users: Default::default(), grammar_slots: Default::default(), slots: Mutex::new(vec![]), spares: Mutex::new(vec![]), warming: AtomicUsize::new(0), docs: Mutex::new(HashMap::new()), next: AtomicU64::new(0) }
    }

    fn alloc_slot(&self) -> Option<usize> {
        let mut s = self.slots.lock().unwrap();
        if s.iter().filter(|u| **u).count() >= self.setup.max_engines {
            return None;
        }
        Some(match s.iter().position(|u| !u) {
            Some(i) => {
                s[i] = true;
                i
            }
            None => {
                s.push(true);
                s.len() - 1
            }
        })
    }

    fn free_slot(&self, i: usize) {
        self.slot_users.lock().unwrap().remove(&i);
        let _ = std::fs::remove_dir_all(self.slot_dir(i).join("work"));
        if let Some(u) = self.slots.lock().unwrap().get_mut(i) {
            *u = false;
        }
    }

    fn slot_dir(&self, i: usize) -> PathBuf {
        self.setup.root.join(format!("slot-{i}"))
    }

    pub fn running(&self) -> usize {
        self.slots.lock().unwrap().iter().filter(|u| **u).count()
    }

    pub fn open_count(&self) -> usize {
        self.docs.lock().unwrap().len()
    }

    /// Arguments de bubblewrap : seul l'emplacement du moteur est modifiable.
    fn launcher(&self, slot_dir: &Path) -> Vec<OsString> {
        let Sandbox::Bwrap(bwrap) = &self.setup.sandbox else { return vec![] };
        let mut a: Vec<OsString> = vec![bwrap.into()];
        let mut push = |v: &[&str]| a.extend(v.iter().map(OsString::from));
        // Pas de --die-with-parent : il est lié au fil qui lance le moteur
        // (fils temporaires de tokio), pas au serveur. Si le serveur
        // s'arrête, le moteur voit son entrée se fermer et quitte seul.
        push(&["--new-session", "--unshare-all", "--cap-drop", "ALL"]);
        // /etc/ssl : sans certificats, LibreOffice renonce à son client HTTP et
        // donc au correcteur AuxiCorrect (même joint en HTTP local).
        for d in ["/usr", "/lib", "/lib64", "/lib32", "/bin", "/sbin", "/etc/fonts", "/etc/ld.so.cache", "/etc/localtime", "/etc/alternatives", "/etc/ssl", "/var/cache/fontconfig"] {
            push(&["--ro-bind-try", d, d]);
        }
        push(&["--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp"]);
        let mut bind = |flag: &str, p: &Path| {
            a.push(flag.into());
            a.push(p.into());
            a.push(p.into());
        };
        // Installation de LibreOffice : le dossier qui contient `program/`.
        let lo_root = self.setup.program_dir.parent().unwrap_or(&self.setup.program_dir);
        bind("--ro-bind", lo_root);
        bind("--ro-bind", &self.setup.engine_exe);
        bind("--bind", slot_dir);
        a.extend(["--setenv", "HOME"].map(OsString::from));
        a.push(slot_dir.join("home").into());
        a.extend(["--chdir"].map(OsString::from));
        a.push(slot_dir.into());
        a.push("--".into());
        a
    }

    /// Prise AuxiCorrect de l'emplacement (créée une fois), si AuxiCorrect est installé.
    fn grammar_socket(&self, slot: usize, dir: &Path) -> Option<PathBuf> {
        let cli = self.setup.auxicorrect.clone()?;
        let socket = dir.join("grammar.sock");
        let mut started = self.grammar_slots.lock().unwrap();
        if !started.contains(&slot) {
            let users = self.slot_users.clone();
            if let Err(e) = crate::grammar::listen(socket.clone(), cli, self.setup.files_root.clone(), move || users.lock().unwrap().get(&slot).cloned()) {
                eprintln!("auxi-online : AuxiCorrect indisponible pour l'emplacement {slot} : {e}");
                return None;
            }
            started.insert(slot);
        }
        Some(socket)
    }

    fn spawn(&self, slot: usize, route: Arc<Route>) -> Result<Engine, String> {
        let dir = self.slot_dir(slot);
        let _ = std::fs::remove_dir_all(dir.join("work"));
        for d in ["work", "home", "profile"] {
            std::fs::create_dir_all(dir.join(d)).map_err(|e| format!("{} : {e}", dir.display()))?;
        }
        let cfg = EngineConfig {
            engine_exe: self.setup.engine_exe.clone(),
            program_dir: self.setup.program_dir.clone(),
            profile_dir: Some(dir.join("profile")),
            lang: self.setup.lang.clone(),
            author: String::new(),
            log_file: Some(self.setup.root.join("moteur.log")),
            profile_root: Some(dir.clone()),
            grammar_url: None,
            launcher: self.launcher(&dir),
            grammar_socket: self.grammar_socket(slot, &dir),
        };
        Engine::spawn(
            &cfg,
            Box::new(move |mut ev: Value| {
                let id = route.doc.load(Ordering::Relaxed);
                if id == 0 {
                    return;
                }
                ev["doc"] = json!(id);
                if let Some(tx) = route.tx.lock().unwrap().as_ref() {
                    let _ = tx.send(WsOut::Text(json!({"event": "engine", "payload": ev}).to_string()));
                }
            }),
        )
    }

    /// Démarre en arrière-plan un moteur de réserve s'il en manque ; le
    /// suivant démarre quand celui-ci est prêt (LibreOffice est lourd à
    /// initialiser : un seul démarrage à la fois).
    pub fn refill(self: &Arc<Self>) {
        let slot = {
            let spares = self.spares.lock().unwrap();
            if self.warming.load(Ordering::SeqCst) > 0 || spares.len() >= self.setup.spares {
                return;
            }
            // Ne jamais prendre la dernière place libre pour une réserve.
            if self.running() + 1 >= self.setup.max_engines {
                return;
            }
            let Some(slot) = self.alloc_slot() else { return };
            self.warming.fetch_add(1, Ordering::SeqCst);
            slot
        };
        let pool = self.clone();
        std::thread::spawn(move || {
            let route = Arc::new(Route::default());
            let ok = match pool.spawn(slot, route.clone()) {
                Ok(engine) => {
                    pool.spares.lock().unwrap().push(Spare { engine, route, slot });
                    true
                }
                Err(e) => {
                    eprintln!("auxi-online : moteur de réserve impossible : {e}");
                    pool.free_slot(slot);
                    false
                }
            };
            pool.warming.fetch_sub(1, Ordering::SeqCst);
            if ok {
                pool.refill();
            }
        });
    }

    fn take_engine(&self) -> Result<(Engine, Arc<Route>, usize), String> {
        loop {
            let spare = self.spares.lock().unwrap().pop();
            let Some(s) = spare else { break };
            if s.engine.is_alive() {
                return Ok((s.engine, s.route, s.slot));
            }
            self.free_slot(s.slot);
        }
        let slot = self.alloc_slot().ok_or("Le serveur est occupé : trop de documents sont ouverts. Réessayez dans un instant.")?;
        let route = Arc::new(Route::default());
        match self.spawn(slot, route.clone()) {
            Ok(e) => Ok((e, route, slot)),
            Err(e) => {
                self.free_slot(slot);
                Err(e)
            }
        }
    }

    /// Ouvre un document de l'utilisateur dans un moteur.
    #[allow(clippy::too_many_arguments)]
    pub fn open(self: &Arc<Self>, store: &Storage, user: &str, session: &str, tx: Outbox, vpath: &str, password: Option<String>) -> Result<Value, String> {
        let vpath = storage::normalize(vpath)?;
        let real = store.real(user, &vpath)?;
        let meta = std::fs::metadata(&real).map_err(|_| format!("« {} » est introuvable", storage::file_name(&vpath)))?;
        if !meta.is_file() {
            return Err(format!("« {} » n'est pas un fichier", storage::file_name(&vpath)));
        }
        if meta.len() > self.setup.max_open_mb * 1024 * 1024 {
            return Err(format!("« {} » est trop volumineux pour être ouvert en ligne (plus de {} Mo).", storage::file_name(&vpath), self.setup.max_open_mb));
        }
        {
            let docs = self.docs.lock().unwrap();
            let mine = docs.values().filter(|d| d.user == user).count();
            if mine >= self.setup.max_per_user {
                return Err(format!("Vous avez déjà {mine} documents ouverts : fermez-en un pour en ouvrir un autre."));
            }
            if docs.values().any(|d| d.user == user && d.state.lock().unwrap().vpath == vpath) {
                return Err(format!("« {} » est déjà ouvert dans un autre onglet ou une autre fenêtre.", storage::file_name(&vpath)));
            }
        }
        let (engine, route, slot) = self.take_engine()?;
        self.slot_users.lock().unwrap().insert(slot, user.to_string());
        self.refill();
        let work = self.slot_dir(slot).join("work");
        let work_file = work.join(safe_name(storage::file_name(&vpath)));
        let res = std::fs::copy(&real, &work_file).map_err(|e| e.to_string()).and_then(|_| {
            let mut req = json!({"cmd": "load", "path": work_file});
            if let Some(p) = password {
                req["password"] = json!(p);
            }
            engine.call(req)
        });
        let mut info = match res {
            Ok(i) => i,
            Err(e) => {
                engine.shutdown();
                self.free_slot(slot);
                return Err(e);
            }
        };
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        *route.tx.lock().unwrap() = Some(tx);
        route.doc.store(id, Ordering::Relaxed);
        info["doc"] = json!(id);
        info["path"] = json!(vpath);
        info["libreoffice"] = Value::Null;
        // Verrou et lecture seule : propres à l'espace de travail, sans objet ici.
        info["read_only"] = json!(false);
        info["locked_by"] = Value::Null;
        let doc = OpenDoc {
            id,
            user: user.to_string(),
            session: session.to_string(),
            engine,
            route,
            slot,
            work,
            state: Mutex::new(DocState { vpath, work_file }),
            last: Mutex::new(Instant::now()),
        };
        self.docs.lock().unwrap().insert(id, Arc::new(doc));
        Ok(info)
    }

    fn get(&self, user: &str, doc: u64) -> Result<Arc<OpenDoc>, String> {
        let d = self.docs.lock().unwrap().get(&doc).cloned().filter(|d| d.user == user).ok_or("document fermé")?;
        *d.last.lock().unwrap() = Instant::now();
        Ok(d)
    }

    /// Requête de l'interface vers le moteur d'un document, filtrée et
    /// traduite (chemins virtuels ↔ espace de travail).
    pub fn call(&self, store: &Storage, user: &str, doc: u64, req: Value) -> Result<Value, String> {
        let d = self.get(user, doc)?;
        let cmd = req.get("cmd").and_then(Value::as_str).unwrap_or("").to_string();
        match cmd.as_str() {
            c if PASS_THROUGH.contains(&c) => d.engine.call(req),
            "uno" => {
                let command = req.get("command").and_then(Value::as_str).unwrap_or("");
                let base = command.split('?').next().unwrap_or("");
                if DENIED_UNO.contains(&base) || base.starts_with(".uno:Macro") || base.contains("Macro") {
                    return Err(format!("commande non disponible en ligne : {base}"));
                }
                let mut req = req;
                if let Some(args) = req.get_mut("args") {
                    self.import_file_args(store, &d, args)?;
                }
                d.engine.call(req)
            }
            "save_in_place" => {
                let (vpath, work_file) = {
                    let s = d.state.lock().unwrap();
                    (s.vpath.clone(), s.work_file.clone())
                };
                let r = d.engine.request(json!({"cmd": "save_in_place"}), &[], Duration::from_secs(300))?;
                store.import(user, &vpath, &work_file)?;
                Ok(r.json)
            }
            "save_as_location" => {
                let target = storage::normalize(req.get("path").and_then(Value::as_str).ok_or("champ path manquant")?)?;
                store.real(user, &target)?;
                let old = d.state.lock().unwrap().work_file.clone();
                let new_work = d.work.join(safe_name(storage::file_name(&target)));
                if new_work != old {
                    let _ = std::fs::remove_file(&new_work);
                }
                d.engine.call(json!({"cmd": "save_as_location", "path": new_work}))?;
                store.import(user, &target, &new_work)?;
                if new_work != old {
                    let _ = std::fs::remove_file(&old);
                }
                *d.state.lock().unwrap() = DocState { vpath: target.clone(), work_file: new_work };
                Ok(json!({"path": target}))
            }
            "save" => {
                let target = storage::normalize(req.get("path").and_then(Value::as_str).ok_or("champ path manquant")?)?;
                store.real(user, &target)?;
                let out = self.export(&d, storage::file_name(&target), req.get("format").and_then(Value::as_str), req.get("filter").and_then(Value::as_str))?;
                let res = store.import(user, &target, &out);
                let _ = std::fs::remove_file(&out);
                res?;
                Ok(json!({"path": target}))
            }
            other => Err(format!("commande non disponible en ligne : {other}")),
        }
    }

    /// Exporte le document dans `work/export/` ; retourne le fichier écrit.
    fn export(&self, d: &OpenDoc, name: &str, format: Option<&str>, filter: Option<&str>) -> Result<PathBuf, String> {
        let dir = d.work.join("export");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let out = dir.join(safe_name(name));
        let mut req = json!({"cmd": "save", "path": out});
        if let Some(f) = format {
            req["format"] = json!(f);
        }
        if let Some(f) = filter {
            req["filter"] = json!(f);
        }
        d.engine.request(req, &[], Duration::from_secs(300))?;
        Ok(out)
    }

    /// PDF du document (pages choisies), pour l'impression par le navigateur.
    pub fn pdf(&self, user: &str, doc: u64, title: &str, pages: &str) -> Result<(String, Vec<u8>), String> {
        let d = self.get(user, doc)?;
        let pages = pages.trim();
        if !pages.chars().all(|c| c.is_ascii_digit() || matches!(c, ',' | '-' | ' ' | ';')) {
            return Err(format!("pages invalides : « {pages} » (exemple : 1-3, 5)"));
        }
        let stem = Path::new(title).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let name = format!("{}.pdf", if stem.trim().is_empty() { "Document" } else { stem.trim() });
        let filter = (!pages.is_empty()).then(|| json!({"PageRange": {"type": "string", "value": pages.replace(';', ",")}}).to_string());
        let out = self.export(&d, &format!("impression-{}-{name}", now_ms()), Some("pdf"), filter.as_deref())?;
        let bytes = std::fs::read(&out).map_err(|e| e.to_string());
        let _ = std::fs::remove_file(&out);
        Ok((safe_name(&name), bytes?))
    }

    /// Arguments d'une commande UNO : un fichier (`file:///…`, chemin virtuel
    /// de l'utilisateur, par exemple l'image d'« Insérer une image ») est
    /// copié dans l'espace de travail et l'URL réécrite ; toute autre URL
    /// `file:`, de macro ou de script est refusée.
    fn import_file_args(&self, store: &Storage, d: &OpenDoc, v: &mut Value) -> Result<(), String> {
        match v {
            Value::String(s) => {
                let lower = s.to_ascii_lowercase();
                if lower.starts_with("vnd.sun.star.script") || lower.starts_with("macro:") || lower.starts_with("vnd.sun.star.cmd") || lower.starts_with("private:") {
                    return Err("adresse non autorisée".into());
                }
                if lower.starts_with("file:") {
                    let url = url::Url::parse(s).map_err(|_| "adresse de fichier invalide".to_string())?;
                    let vpath = percent_decode(url.path());
                    let bytes = store.read(&d.user, &storage::normalize(&vpath)?)?;
                    let dir = d.work.join("import");
                    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
                    let local = dir.join(format!("{}-{}", now_ms(), safe_name(storage::file_name(&vpath))));
                    std::fs::write(&local, bytes).map_err(|e| e.to_string())?;
                    *s = file_url(&local);
                }
                Ok(())
            }
            Value::Array(a) => a.iter_mut().try_for_each(|x| self.import_file_args(store, d, x)),
            Value::Object(o) => o.values_mut().try_for_each(|x| self.import_file_args(store, d, x)),
            _ => Ok(()),
        }
    }

    /// Rendu d'une tuile (ou d'une fenêtre de dialogue) : octets RGBA bruts.
    pub fn paint(&self, user: &str, doc: u64, mut req: Value) -> Result<Vec<u8>, String> {
        let d = self.get(user, doc)?;
        req["cmd"] = json!(if req.get("window").is_some() { "paint_window" } else { "paint" });
        Ok(d.engine.request(req, &[], Duration::from_secs(60))?.bin)
    }

    fn release(&self, d: Arc<OpenDoc>) {
        d.engine.shutdown();
        self.free_slot(d.slot);
    }

    pub fn close(&self, user: &str, doc: u64) {
        let d = {
            let mut docs = self.docs.lock().unwrap();
            match docs.get(&doc) {
                Some(d) if d.user == user => docs.remove(&doc),
                _ => None,
            }
        };
        if let Some(d) = d {
            self.release(d);
        }
    }

    /// Nouvelle session WebSocket, ou reprise d'une session coupée de ce même
    /// utilisateur : ses documents envoient de nouveau leurs événements à la
    /// nouvelle connexion. Retourne la session et ses documents encore ouverts.
    pub fn attach(&self, user: &str, resume: Option<&str>, tx: Outbox) -> (String, Vec<u64>) {
        let mut sessions = self.sessions.lock().unwrap();
        let resumed = resume.filter(|r| sessions.get(*r).is_some_and(|s| s.user == user)).map(str::to_owned);
        let Some(token) = resumed else {
            let token = crate::auth::random_token();
            sessions.insert(token.clone(), Session { user: user.to_string(), detached: None });
            return (token, vec![]);
        };
        sessions.get_mut(&token).unwrap().detached = None;
        drop(sessions);
        let mut ids = vec![];
        for d in self.docs.lock().unwrap().values().filter(|d| d.session == token) {
            *d.route.tx.lock().unwrap() = Some(tx.clone());
            ids.push(d.id);
        }
        (token, ids)
    }

    /// Connexion WebSocket coupée : ses documents restent ouverts le temps
    /// d'une reconnexion (voir `reap`), leurs événements ne partent plus.
    pub fn detach(&self, session: &str) {
        let mut any = false;
        for d in self.docs.lock().unwrap().values().filter(|d| d.session == session) {
            *d.route.tx.lock().unwrap() = None;
            any = true;
        }
        let mut sessions = self.sessions.lock().unwrap();
        if any {
            if let Some(s) = sessions.get_mut(session) {
                s.detached = Some(Instant::now());
            }
        } else {
            sessions.remove(session);
        }
    }

    /// Ferme les documents inactifs depuis `idle`, ceux d'une session coupée
    /// depuis plus de `grace` (pas de reconnexion), et les moteurs arrêtés
    /// (documents et réserve).
    pub fn reap(&self, idle: Duration, grace: Duration) {
        let expired: Vec<String> = {
            let mut sessions = self.sessions.lock().unwrap();
            let gone: Vec<String> = sessions.iter().filter(|(_, s)| s.detached.is_some_and(|t| t.elapsed() > grace)).map(|(k, _)| k.clone()).collect();
            for k in &gone {
                sessions.remove(k);
            }
            gone
        };
        if !expired.is_empty() {
            let gone: Vec<_> = {
                let mut docs = self.docs.lock().unwrap();
                let ids: Vec<u64> = docs.values().filter(|d| expired.contains(&d.session)).map(|d| d.id).collect();
                ids.into_iter().filter_map(|i| docs.remove(&i)).collect()
            };
            for d in gone {
                eprintln!("auxi-online : document {} fermé (connexion perdue sans reprise)", d.id);
                self.release(d);
            }
        }
        let dead: Vec<Spare> = {
            let mut spares = self.spares.lock().unwrap();
            let (alive, dead) = spares.drain(..).partition(|s| s.engine.is_alive());
            *spares = alive;
            dead
        };
        for s in dead {
            eprintln!("auxi-online : moteur de réserve arrêté, remplacé");
            self.free_slot(s.slot);
        }
        let gone: Vec<_> = {
            let mut docs = self.docs.lock().unwrap();
            let ids: Vec<u64> = docs.values().filter(|d| d.last.lock().unwrap().elapsed() > idle || !d.engine.is_alive()).map(|d| d.id).collect();
            ids.into_iter().filter_map(|i| docs.remove(&i)).collect()
        };
        for d in gone {
            eprintln!("auxi-online : document {} fermé (inactif ou moteur arrêté)", d.id);
            self.release(d);
        }
    }

    pub fn shutdown_all(&self) {
        let docs: Vec<_> = self.docs.lock().unwrap().drain().map(|(_, d)| d).collect();
        for d in docs {
            self.release(d);
        }
        let spares: Vec<_> = self.spares.lock().unwrap().drain(..).collect();
        for s in spares {
            s.engine.shutdown();
            self.free_slot(s.slot);
        }
    }

    /// Document vierge : copie du modèle dans le dossier des documents sans titre.
    pub fn new_document(&self, store: &Storage, user: &str, kind: &str) -> Result<String, String> {
        let ext = match kind {
            "text" => "docx",
            "spreadsheet" => "xlsx",
            "presentation" => "pptx",
            "drawing" => "odg",
            _ => return Err(format!("type inconnu : {kind}")),
        };
        let template = self.setup.templates.join(format!("vierge.{ext}"));
        let vpath = format!("{}/Sans titre {}.{ext}", storage::UNTITLED_DIR, now_ms());
        store.import(user, &vpath, &template).map_err(|e| format!("{} : {e}", template.display()))?;
        Ok(vpath)
    }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = |c: u8| (c as char).to_digit(16);
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodage_url() {
        assert_eq!(percent_decode("/Mes%20images/%C3%A9t%C3%A9.png"), "/Mes images/été.png");
        assert_eq!(percent_decode("/a%2"), "/a%2");
        assert_eq!(safe_name("../x"), "_x");
        assert_eq!(safe_name(".."), "Document");
    }
}
