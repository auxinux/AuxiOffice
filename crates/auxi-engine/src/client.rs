//! Client du processus moteur : lance `auxi-engine`, envoie les requêtes et
//! distribue les réponses et les événements. Un moteur = un document, ce qui
//! isole les plantages de LibreOffice : seul l'onglet concerné est perdu.

use crate::protocol::{read_frame, write_frame};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufReader, BufWriter};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub struct EngineConfig {
    /// Exécutable `auxi-engine`.
    pub engine_exe: PathBuf,
    /// Dossier `program/` de LibreOffice.
    pub program_dir: PathBuf,
    /// Profil utilisateur du moteur (réglages, dictionnaires personnels…).
    pub profile_dir: Option<PathBuf>,
    pub lang: String,
    pub author: String,
    /// Journal où recopier la sortie d'erreur du moteur (diagnostic).
    pub log_file: Option<PathBuf>,
    /// Dossier commun des profils de l'application : un verrou de document
    /// posé depuis l'un d'eux est forcément orphelin (l'application n'ouvre
    /// jamais deux fois le même fichier).
    pub profile_root: Option<PathBuf>,
    /// Serveur de correction du français (AuxiCorrect, protocole LanguageTool)
    /// que LibreOffice doit interroger ; None : correcteur de LibreOffice.
    pub grammar_url: Option<String>,
    /// Programme qui lance le moteur, suivi de ses arguments (bac à sable
    /// d'AuxiOffice Online) ; vide : le moteur est lancé directement.
    pub launcher: Vec<std::ffi::OsString>,
}

/// Dernières lignes écrites par le moteur sur sa sortie d'erreur.
type StderrTail = Arc<Mutex<std::collections::VecDeque<String>>>;
const TAIL_LINES: usize = 25;

pub struct Reply {
    pub json: Value,
    pub bin: Vec<u8>,
}

type Pending = Arc<Mutex<HashMap<u64, Sender<Result<Reply, String>>>>>;
pub type EventSink = Box<dyn Fn(Value) + Send + 'static>;

pub struct Engine {
    child: Mutex<Child>,
    stdin: Mutex<BufWriter<ChildStdin>>,
    pending: Pending,
    next_id: AtomicU64,
    pub libreoffice: Option<String>,
}

impl Engine {
    /// Lance le moteur et attend qu'il signale qu'il est prêt.
    pub fn spawn(cfg: &EngineConfig, on_event: EventSink) -> Result<Engine, String> {
        // Configuration par l'environnement, jamais par arguments : LibreOffice
        // lit les arguments du processus sous macOS (voir auxi-engine).
        let mut cmd = match cfg.launcher.split_first() {
            Some((prog, args)) => {
                let mut c = Command::new(prog);
                c.args(args).arg(&cfg.engine_exe);
                c
            }
            None => Command::new(&cfg.engine_exe),
        };
        cmd.env("AUXI_ENGINE_PROGRAM_DIR", &cfg.program_dir).env("AUXI_ENGINE_LANG", &cfg.lang);
        match &cfg.profile_dir {
            Some(p) => cmd.env("AUXI_ENGINE_PROFILE", p),
            None => cmd.env_remove("AUXI_ENGINE_PROFILE"),
        };
        cmd.env("AUXI_ENGINE_AUTHOR", &cfg.author);
        match &cfg.profile_root {
            Some(r) => cmd.env("AUXI_ENGINE_PROFILE_ROOT", r),
            None => cmd.env_remove("AUXI_ENGINE_PROFILE_ROOT"),
        };
        match &cfg.grammar_url {
            Some(u) => cmd.env("AUXI_ENGINE_GRAMMAR_URL", u),
            None => cmd.env_remove("AUXI_ENGINE_GRAMMAR_URL"),
        };
        // Aucun accès réseau ni dialogue système depuis le moteur.
        // Langues pour lesquelles LibreOffice active correcteur et césure.
        cmd.env("LOK_ALLOWLIST_LANGUAGES", "fr-FR fr-CA en-US en-GB es-ES de-DE");
        cmd.env("SAL_USE_VCLPLUGIN", "svp").env_remove("DISPLAY").env_remove("WAYLAND_DISPLAY");
        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("impossible de lancer {} : {e}", cfg.engine_exe.display()))?;
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();

        // Sortie d'erreur du moteur : recopiée sur la nôtre et dans le journal,
        // et ses dernières lignes gardées pour expliquer un échec au démarrage.
        let tail: StderrTail = Arc::new(Mutex::new(Default::default()));
        let mut log = cfg.log_file.as_ref().and_then(|f| {
            if let Some(d) = f.parent() {
                let _ = std::fs::create_dir_all(d);
            }
            std::fs::OpenOptions::new().create(true).append(true).open(f).ok()
        });
        let t = tail.clone();
        let stderr_thread = std::thread::Builder::new()
            .name("auxi-engine-stderr".into())
            .spawn(move || {
                use std::io::{BufRead, Write};
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    eprintln!("{line}");
                    if let Some(f) = log.as_mut() {
                        let _ = writeln!(f, "{line}");
                    }
                    let mut q = t.lock().unwrap();
                    if q.len() == TAIL_LINES {
                        q.pop_front();
                    }
                    q.push_back(line);
                }
            })
            .map_err(|e| e.to_string())?;

        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (ready_tx, ready_rx) = channel::<Result<Option<String>, String>>();
        let p = pending.clone();
        std::thread::Builder::new()
            .name("auxi-engine-reader".into())
            .spawn(move || reader(BufReader::new(stdout), p, ready_tx, on_event))
            .map_err(|e| e.to_string())?;

        let failure = match ready_rx.recv_timeout(Duration::from_secs(120)) {
            Ok(Ok(v)) => Ok(v),
            Ok(Err(e)) => Err(e),
            Err(_) => Err("le moteur ne répond pas".into()),
        };
        let libreoffice = match failure {
            Ok(v) => v,
            Err(e) => {
                let _ = child.kill();
                let status = child.wait().ok();
                let _ = stderr_thread.join();
                return Err(startup_error(&e, status, &tail));
            }
        };
        Ok(Engine {
            child: Mutex::new(child),
            stdin: Mutex::new(BufWriter::new(stdin)),
            pending,
            next_id: AtomicU64::new(1),
            libreoffice,
        })
    }

    /// Envoie une requête et retourne le canal où arrivera la réponse.
    pub fn send(&self, mut req: Value, bin: &[u8]) -> Receiver<Result<Reply, String>> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        req["id"] = json!(id);
        let (tx, rx) = channel();
        self.pending.lock().unwrap().insert(id, tx);
        let mut w = self.stdin.lock().unwrap();
        if let Err(e) = write_frame(&mut *w, &req, bin) {
            if let Some(tx) = self.pending.lock().unwrap().remove(&id) {
                let _ = tx.send(Err(format!("moteur indisponible : {e}")));
            }
        }
        rx
    }

    /// Requête bloquante avec délai.
    pub fn request(&self, req: Value, bin: &[u8], timeout: Duration) -> Result<Reply, String> {
        self.send(req, bin).recv_timeout(timeout).map_err(|_| "délai dépassé ou moteur arrêté".to_string())?
    }

    pub fn call(&self, req: Value) -> Result<Value, String> {
        self.request(req, &[], Duration::from_secs(300)).map(|r| r.json)
    }

    pub fn is_alive(&self) -> bool {
        matches!(self.child.lock().unwrap().try_wait(), Ok(None))
    }

    pub fn shutdown(&self) {
        let _ = self.request(json!({"cmd": "quit"}), &[], Duration::from_secs(10));
        let mut c = self.child.lock().unwrap();
        for _ in 0..50 {
            if matches!(c.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = c.kill();
        let _ = c.wait();
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        if self.is_alive() {
            self.shutdown();
        }
    }
}

/// Message d'échec au démarrage : cause, statut de sortie, dernières lignes
/// du moteur (souvent la vraie raison, écrite par LibreOffice).
fn startup_error(e: &str, status: Option<std::process::ExitStatus>, tail: &StderrTail) -> String {
    let mut msg = e.to_string();
    if let Some(st) = status {
        #[cfg(unix)]
        {
            use std::os::unix::process::ExitStatusExt;
            if let Some(sig) = st.signal() {
                msg.push_str(&format!(" (signal {sig}{})", if sig == 6 { ", abandon" } else if sig == 11 { ", erreur de segmentation" } else { "" }));
            } else if let Some(code) = st.code() {
                msg.push_str(&format!(" (code {code})"));
            }
        }
        #[cfg(not(unix))]
        if let Some(code) = st.code() {
            msg.push_str(&format!(" (code {code})"));
        }
    }
    let lines: Vec<String> = tail.lock().unwrap().iter().cloned().collect();
    if !lines.is_empty() {
        msg.push_str("\n\nDernières lignes du moteur :\n");
        msg.push_str(&lines.join("\n"));
    }
    msg
}

fn reader(
    mut r: BufReader<std::process::ChildStdout>,
    pending: Pending,
    ready: Sender<Result<Option<String>, String>>,
    on_event: EventSink,
) {
    let mut ready = Some(ready);
    while let Ok(Some(frame)) = read_frame(&mut r) {
        if let Some(id) = frame.json.get("id").and_then(Value::as_u64) {
            if let Some(tx) = pending.lock().unwrap().remove(&id) {
                let res = if frame.json.get("ok").and_then(Value::as_bool) == Some(true) {
                    Ok(Reply { json: frame.json, bin: frame.bin })
                } else {
                    Err(frame.json.get("error").and_then(Value::as_str).unwrap_or("erreur du moteur").to_string())
                };
                let _ = tx.send(res);
            }
            continue;
        }
        match frame.json.get("event").and_then(Value::as_str) {
            Some("ready") => {
                if let Some(tx) = ready.take() {
                    let _ = tx.send(Ok(frame.json.get("libreoffice").and_then(Value::as_str).map(str::to_owned)));
                }
            }
            Some("fatal") => {
                if let Some(tx) = ready.take() {
                    let _ = tx.send(Err(frame.json.get("error").and_then(Value::as_str).unwrap_or("échec du moteur").to_string()));
                }
            }
            _ => on_event(frame.json),
        }
    }
    // Moteur arrêté : débloquer les requêtes en attente et prévenir l'interface.
    if let Some(tx) = ready.take() {
        let _ = tx.send(Err("le moteur s'est arrêté au démarrage".into()));
    }
    for (_, tx) in pending.lock().unwrap().drain() {
        let _ = tx.send(Err("le moteur s'est arrêté".into()));
    }
    on_event(json!({"event": "engine_exited"}));
}
