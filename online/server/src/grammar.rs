//! AuxiCorrect dans AuxiOffice Online : le correcteur du français tourne sur
//! le serveur (`auxicorrect-cli`, programme séparé). Le moteur d'un document,
//! sans réseau, lui parle par la prise Unix de son emplacement
//! (`slot-N/grammar.sock`, relais dans auxi-engine) ; la réponse suit les
//! options AuxiCorrect de l'utilisateur à qui appartient le document.

use crate::auxicorrect::{self, Options};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};

/// Chemin des requêtes LanguageTool du relais (voir auxi-engine).
const PREFIX: &str = "/auxicorrect/v2/";

/// Options AuxiCorrect d'un utilisateur (`/.auxi/auxicorrect-options.json`).
pub fn user_options(files_root: &Path, user: &str) -> Options {
    auxicorrect::read_options(&files_root.join(user).join(".auxi").join("auxicorrect-options.json"))
}

pub fn save_user_options(files_root: &Path, user: &str, o: &Options) -> Result<(), String> {
    auxicorrect::write_options(&files_root.join(user).join(".auxi").join("auxicorrect-options.json"), o)
}

/// Écoute la prise d'un emplacement ; `owner` donne l'utilisateur du
/// document qui l'occupe en ce moment.
#[cfg(unix)]
pub fn listen(socket: PathBuf, cli: PathBuf, files_root: PathBuf, owner: impl Fn() -> Option<String> + Send + Sync + 'static) -> Result<(), String> {
    use std::os::unix::net::UnixListener;
    let _ = std::fs::remove_file(&socket);
    let listener = UnixListener::bind(&socket).map_err(|e| format!("{} : {e}", socket.display()))?;
    let owner = std::sync::Arc::new(owner);
    std::thread::spawn(move || {
        for conn in listener.incoming().flatten() {
            let (cli, files_root, owner) = (cli.clone(), files_root.clone(), owner.clone());
            std::thread::spawn(move || {
                let opts = owner().map(|u| user_options(&files_root, &u)).filter(|o| o.enabled);
                let _ = handle(conn, &cli, opts.as_ref());
            });
        }
    });
    Ok(())
}

#[cfg(not(unix))]
pub fn listen(_socket: PathBuf, _cli: PathBuf, _files_root: PathBuf, _owner: impl Fn() -> Option<String> + Send + Sync + 'static) -> Result<(), String> {
    Err("AuxiCorrect en ligne : Linux seulement".into())
}

/// Une requête HTTP du relais → réponse du protocole LanguageTool.
fn handle<S: Read + Write>(conn: S, cli: &Path, opts: Option<&Options>) -> std::io::Result<()> {
    let mut r = BufReader::new(conn);
    let mut line = String::new();
    r.read_line(&mut line)?;
    let mut parts = line.split_whitespace();
    let (method, target) = (parts.next().unwrap_or("").to_string(), parts.next().unwrap_or("").to_string());
    let mut len = 0usize;
    loop {
        let mut h = String::new();
        if r.read_line(&mut h)? == 0 || h == "\r\n" || h == "\n" {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-length") {
                len = v.trim().parse().unwrap_or(0);
            }
        }
    }
    let (status, body) = if len > 4 << 20 {
        (413, "{}".to_string())
    } else {
        let mut body = vec![0u8; len];
        r.read_exact(&mut body)?;
        match target.strip_prefix(PREFIX) {
            Some(route) => auxicorrect::respond(&method, route, &body, cli, opts),
            None => (404, "{}".into()),
        }
    };
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        413 => "Payload Too Large",
        _ => "Error",
    };
    let conn = r.get_mut();
    write!(conn, "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())?;
    conn.flush()
}
