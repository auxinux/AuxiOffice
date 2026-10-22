//! Instance unique : le premier AuxiText écoute sur `127.0.0.1` (port et
//! jeton secret dans `instance.json`, droits 0600) ; un second lancement lui
//! transmet ses fichiers puis quitte. Même principe que les applications
//! d'AuxiOffice, sans dépendre de la suite.

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Ce que demande un lancement.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Launch {
    /// Chemins absolus (un fichier absent sera créé à l'enregistrement).
    pub files: Vec<String>,
    /// `--new-window` : nouvelle fenêtre plutôt que de nouveaux onglets.
    #[serde(default)]
    pub new_window: bool,
}

/// Arguments de la ligne de commande. `cwd` sert à rendre les chemins absolus
/// (le second lancement n'a pas le même dossier courant que le premier).
pub fn parse_args(args: &[String], cwd: &Path) -> Launch {
    let mut l = Launch::default();
    let mut only_files = false;
    for a in args {
        if !only_files && a == "--" {
            only_files = true;
        } else if !only_files && (a == "--new-window" || a == "-n") {
            l.new_window = true;
        } else if !only_files && a.starts_with('-') && a.len() > 1 {
            // Options inconnues (dont celles du bureau, --sm-client-id…) : ignorées.
        } else {
            let p = file_url_to_path(a).unwrap_or_else(|| PathBuf::from(a));
            let p = if p.is_absolute() { p } else { cwd.join(p) };
            let p = std::fs::canonicalize(&p).unwrap_or(p);
            l.files.push(p.to_string_lossy().into_owned());
        }
    }
    l
}

/// `file:///home/a/b%20c.txt` → `/home/a/b c.txt` (lanceurs qui passent %U).
fn file_url_to_path(a: &str) -> Option<PathBuf> {
    let rest = a.strip_prefix("file://")?;
    let rest = rest.strip_prefix("localhost").unwrap_or(rest);
    let bytes = rest.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let (true, Ok(v)) = (hex.bytes().all(|b| b.is_ascii_hexdigit()), u8::from_str_radix(hex, 16)) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    Some(PathBuf::from(String::from_utf8_lossy(&out).into_owned()))
}

#[derive(Serialize, Deserialize)]
struct Endpoint {
    port: u16,
    token: String,
}

fn endpoint_file(dir: &Path) -> PathBuf {
    dir.join("instance.json")
}

/// Transmet le lancement à l'instance déjà ouverte. Vrai si elle l'a reçu
/// (le processus courant peut alors quitter).
pub fn forward(dir: &Path, launch: &Launch) -> bool {
    let Some(ep) = std::fs::read(endpoint_file(dir)).ok().and_then(|b| serde_json::from_slice::<Endpoint>(&b).ok()) else {
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

/// Retire l'adresse de l'instance (à la fermeture), si c'est bien la nôtre.
pub fn unlisten(dir: &Path, port: u16) {
    let file = endpoint_file(dir);
    if std::fs::read(&file).ok().and_then(|b| serde_json::from_slice::<Endpoint>(&b).ok()).is_some_and(|e| e.port == port) {
        let _ = std::fs::remove_file(file);
    }
}

/// Écoute les lancements suivants ; retourne le port.
pub fn listen(dir: &Path, on_launch: impl Fn(Launch) + Send + 'static) -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = new_token();
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let body = serde_json::to_vec(&Endpoint { port, token: token.clone() }).map_err(|e| e.to_string())?;
    write_private(&endpoint_file(dir), &body)?;
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
    Ok(port)
}

fn new_token() -> String {
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

/// Fichier lisible par son seul propriétaire (le jeton est secret).
fn write_private(file: &Path, body: &[u8]) -> Result<(), String> {
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    let r = o.open(file).and_then(|mut f| f.write_all(body));
    // Fichier déjà présent avec d'autres droits : les resserrer.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o600));
    }
    r.map_err(|e| format!("{} : {e}", file.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn arguments_become_absolute_paths() {
        let dir = std::env::temp_dir().join(format!("auxitext-args-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.txt"), "x").unwrap();
        let l = parse_args(&s(&["a.txt", "--sm-client-id", "neuf.md", "--new-window"]), &dir);
        let canon = std::fs::canonicalize(&dir).unwrap();
        assert_eq!(l.files, vec![canon.join("a.txt").to_string_lossy().into_owned(), dir.join("neuf.md").to_string_lossy().into_owned()]);
        assert!(l.new_window);
        let l = parse_args(&s(&["--", "-tiret.txt"]), Path::new("/tmp"));
        assert_eq!(l.files, vec![Path::new("/tmp").join("-tiret.txt").to_string_lossy().into_owned()]);
        #[cfg(unix)]
        {
            let l = parse_args(&s(&["file:///tmp/un%20fichier%C3%A9.txt"]), Path::new("/"));
            assert_eq!(l.files, vec!["/tmp/un fichieré.txt".to_string()]);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn second_launch_is_forwarded_to_the_running_instance() {
        let dir = std::env::temp_dir().join(format!("auxitext-inst-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (tx, rx) = std::sync::mpsc::channel();
        assert!(!forward(&dir, &Launch::default()), "aucune instance encore");
        let port = listen(&dir, move |l| tx.send(l).unwrap()).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(endpoint_file(&dir)).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600, "jeton lisible par le seul utilisateur");
        }
        let l = Launch { files: vec!["/tmp/x.txt".into(), "/tmp/é y.md".into()], new_window: false };
        assert!(forward(&dir, &l));
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), l);
        let l2 = Launch { files: vec![], new_window: true };
        assert!(forward(&dir, &l2));
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), l2);
        // Mauvais jeton : refusé.
        let mut ep: Endpoint = serde_json::from_slice(&std::fs::read(endpoint_file(&dir)).unwrap()).unwrap();
        ep.token = "faux".into();
        std::fs::write(endpoint_file(&dir), serde_json::to_vec(&ep).unwrap()).unwrap();
        assert!(!forward(&dir, &l));
        assert!(rx.recv_timeout(Duration::from_millis(200)).is_err());
        // Fermeture : l'adresse disparaît (seulement si c'est la nôtre).
        unlisten(&dir, port.wrapping_add(1));
        assert!(endpoint_file(&dir).exists());
        unlisten(&dir, port);
        assert!(!endpoint_file(&dir).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
