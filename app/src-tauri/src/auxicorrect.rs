//! AuxiCorrect, le correcteur du français de l'écosystème AuxiNux.
//!
//! AuxiCorrect est un programme séparé (GPL-3.0) : AuxiOffice ne lie pas sa
//! bibliothèque, il appelle son outil `auxicorrect-cli` (voir INTEGRATION.md
//! d'AuxiCorrect). L'activation se lit dans le réglage commun
//! `auxicorrect.json`, écrit par AuxiCorrect (Paramètres → Intégration).
//!
//! Dans les documents texte, LibreOffice demande la correction par son
//! correcteur grammatical « LanguageTool » à un petit serveur HTTP local tenu
//! ici (`127.0.0.1`, chemin secret) : les remarques d'AuxiCorrect deviennent
//! des soulignements du document, avec suggestions au clic droit.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Nom du réglage commun, gardé en clair dans l'exécutable : l'onglet
/// Intégration d'AuxiCorrect le cherche pour savoir si cette version
/// d'AuxiOffice prend AuxiCorrect en charge.
pub const SETTINGS_FILE: &str = "auxicorrect.json";

/// Réglage commun écrit par AuxiCorrect (lu seulement).
#[derive(Clone, Debug, Default)]
pub struct Shared {
    pub version: Option<String>,
    pub cli: Option<PathBuf>,
    pub app: Option<PathBuf>,
    pub enabled: bool,
    pub file: PathBuf,
    pub found: bool,
}

pub fn shared_settings_path() -> PathBuf {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from).unwrap_or_default();
    let dir = if cfg!(target_os = "macos") {
        home.join("Library/Application Support/AuxiNux")
    } else if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| home.join("AppData/Roaming")).join("AuxiNux")
    } else {
        std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).filter(|p| p.is_absolute()).unwrap_or_else(|| home.join(".config")).join("auxinux")
    };
    dir.join(SETTINGS_FILE)
}

pub fn read_shared(file: &Path) -> Shared {
    let mut s = Shared { file: file.to_path_buf(), ..Default::default() };
    let Some(v) = std::fs::read(file).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else {
        return s;
    };
    s.found = true;
    s.version = v["auxicorrect_version"].as_str().map(str::to_owned);
    s.cli = v["cli"].as_str().map(PathBuf::from).filter(|p| p.is_file());
    s.app = v["app"].as_str().map(PathBuf::from).filter(|p| p.exists());
    s.enabled = v["products"]["auxioffice"]["enabled"].as_bool() == Some(true) && s.cli.is_some();
    s
}

/// Options propres à AuxiOffice (dossier de données, `auxicorrect-options.json`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Options {
    /// Utiliser AuxiCorrect quand il est installé et activé pour AuxiOffice.
    pub enabled: bool,
    /// Profil français international (sinon québécois).
    pub international: bool,
    /// Variante orthographique : toutes, classique, 1990.
    pub variant: String,
    /// Suggestions de style (désactivées par défaut, comme dans AuxiCorrect).
    pub style: bool,
    /// Particularités régionales (québécismes, anglicismes…).
    pub regional: bool,
}

impl Default for Options {
    fn default() -> Self {
        Options { enabled: true, international: false, variant: "toutes".into(), style: false, regional: true }
    }
}

impl Options {
    fn args(&self) -> Vec<String> {
        let mut a = vec!["verifier".into(), "-".into(), "--json".into()];
        if self.international {
            a.push("--international".into());
        }
        if !self.style {
            a.push("--sans-style".into());
        }
        if !self.regional {
            a.push("--sans-regional".into());
        }
        if matches!(self.variant.as_str(), "classique" | "1990") {
            a.push("--variante".into());
            a.push(self.variant.clone());
        }
        a
    }
}

pub fn read_options(file: &Path) -> Options {
    std::fs::read(file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn write_options(file: &Path, o: &Options) -> Result<(), String> {
    if let Some(d) = file.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    std::fs::write(file, serde_json::to_vec_pretty(o).unwrap()).map_err(|e| e.to_string())
}

// --- Vérification ------------------------------------------------------------

/// Remarque d'AuxiCorrect (sortie JSON de `auxicorrect-cli verifier`).
#[derive(Debug, Deserialize)]
struct Diag {
    start_char: usize,
    end_char: usize,
    category: String,
    severity: String,
    #[serde(default)]
    rule_id: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    explanation: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    suggestions: Vec<String>,
}

pub fn check(cli: &Path, opts: &Options, text: &str) -> Result<Value, String> {
    let mut child = Command::new(cli)
        .args(opts.args())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("{} : {e}", cli.display()))?;
    let mut stdin = child.stdin.take().unwrap();
    let input = text.to_string();
    let writer = std::thread::spawn(move || {
        let _ = stdin.write_all(input.as_bytes());
    });
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let _ = writer.join();
    // Le code de sortie ne dit rien (1 dès qu'il y a une faute) : seul compte
    // un tableau JSON valide sur la sortie standard.
    let diags: Vec<Diag> = serde_json::from_slice(&out.stdout)
        .map_err(|_| format!("réponse invalide d'AuxiCorrect : {}", String::from_utf8_lossy(&out.stderr).trim()))?;
    Ok(to_languagetool(text, opts, &diags))
}

/// Remarques d'AuxiCorrect → réponse du protocole LanguageTool, positions en
/// unités UTF-16 (celles des chaînes de LibreOffice).
fn to_languagetool(text: &str, opts: &Options, diags: &[Diag]) -> Value {
    // Position UTF-16 de chaque point de code.
    let mut utf16 = Vec::with_capacity(text.len() + 1);
    let mut pos = 0usize;
    for c in text.chars() {
        utf16.push(pos);
        pos += c.len_utf16();
    }
    utf16.push(pos);
    let at = |i: usize| utf16.get(i).copied().unwrap_or(pos);
    let matches: Vec<Value> = diags
        .iter()
        .filter(|d| {
            // Comme le complément : erreurs, avertissements et particularités
            // régionales ; les simples suggestions seulement pour le style demandé.
            d.severity != "Suggestion" || d.category == "Regional" || (d.category == "Style" && opts.style)
        })
        .filter(|d| d.end_char > d.start_char)
        .map(|d| {
            let category = match d.category.as_str() {
                "Spelling" => "TYPOS",
                "Grammar" => "GRAMMAR",
                "Typography" => "TYPOGRAPHY",
                "Style" => "STYLE",
                "Regional" => "REGIONALISMS",
                _ => "MISC",
            };
            let (s, e) = (at(d.start_char), at(d.end_char));
            json!({
                // LibreOffice affiche « message » dans le menu contextuel et
                // « shortMessage » comme explication détaillée.
                "message": d.message,
                "shortMessage": d.explanation.clone().filter(|x| !x.trim().is_empty() && !x.starts_with("Règle ")).unwrap_or_else(|| d.message.clone()),
                "offset": s,
                "length": e - s,
                "replacements": d.suggestions.iter().take(8).map(|v| json!({"value": v})).collect::<Vec<_>>(),
                "rule": {"id": d.rule_id, "description": d.message, "category": {"id": category, "name": d.category}, "urls": d.url.iter().map(|u| json!({"value": u})).collect::<Vec<_>>()},
            })
        })
        .collect();
    json!({"software": {"name": "AuxiCorrect", "version": "AuxiOffice"}, "matches": matches})
}

// --- Serveur local -----------------------------------------------------------

/// État lu par le serveur à chaque requête (les options changent sans
/// redémarrer).
pub struct Checker {
    pub cli: PathBuf,
    pub options: Mutex<Options>,
}

/// Démarre le serveur ; retourne l'adresse de base pour LibreOffice
/// (`http://127.0.0.1:<port>/<jeton>/v2`).
pub fn serve(checker: Arc<Checker>) -> Result<String, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = crate::apps::new_token();
    let prefix = format!("/{token}/v2/");
    std::thread::spawn(move || {
        for conn in listener.incoming().flatten() {
            let checker = checker.clone();
            let prefix = prefix.clone();
            std::thread::spawn(move || {
                let _ = handle(conn, &prefix, &checker);
            });
        }
    });
    Ok(format!("http://127.0.0.1:{port}/{token}/v2"))
}

fn handle(mut conn: TcpStream, prefix: &str, checker: &Checker) -> std::io::Result<()> {
    conn.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut r = BufReader::new(conn.try_clone()?);
    let mut line = String::new();
    r.read_line(&mut line)?;
    let mut parts = line.split_whitespace();
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
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
    if len > 4 << 20 {
        return reply(&mut conn, 413, "{}");
    }
    let mut body = vec![0u8; len];
    r.read_exact(&mut body)?;
    let Some(route) = target.strip_prefix(prefix) else {
        return reply(&mut conn, 404, "{}");
    };
    match (method, route) {
        ("POST", "check") => {
            let form = parse_form(&String::from_utf8_lossy(&body));
            let text = form.iter().find(|(k, _)| k == "text").map(|(_, v)| v.as_str()).unwrap_or("");
            let opts = checker.options.lock().unwrap().clone();
            match check(&checker.cli, &opts, text) {
                Ok(v) => reply(&mut conn, 200, &v.to_string()),
                Err(e) => {
                    eprintln!("AuxiCorrect : {e}");
                    reply(&mut conn, 500, "{}")
                }
            }
        }
        ("GET", "languages") => {
            let langs: Vec<Value> = ["fr", "fr-CA", "fr-FR", "fr-BE", "fr-CH"].iter().map(|c| json!({"name": "Français", "code": "fr", "longCode": c})).collect();
            reply(&mut conn, 200, &Value::from(langs).to_string())
        }
        _ => reply(&mut conn, 404, "{}"),
    }
}

fn reply(conn: &mut TcpStream, status: u16, body: &str) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        413 => "Payload Too Large",
        _ => "Error",
    };
    write!(
        conn,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn parse_form(s: &str) -> Vec<(String, String)> {
    s.split('&')
        .map(|kv| {
            let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
            (percent_decode(k), percent_decode(v))
        })
        .collect()
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < b.len() => {
                match std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(v) => {
                        out.push(v);
                        i += 2;
                    }
                    None => out.push(b'%'),
                }
            }
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// --- Dictionnaire --------------------------------------------------------------

/// Définition, synonymes, antonymes ou conjugaison (texte de l'outil).
pub fn lookup(cli: &Path, what: &str, word: &str) -> Result<String, String> {
    let cmd = match what {
        "definir" | "synonymes" | "antonymes" | "conjuguer" => what,
        _ => return Err(format!("demande inconnue : {what}")),
    };
    let word = word.trim();
    if word.is_empty() || word.len() > 100 || word.contains('\n') {
        return Err("sélectionnez un mot".into());
    }
    let out = Command::new(cli).arg(cmd).arg(word).stdin(Stdio::null()).output().map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if text.is_empty() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn positions_are_converted_to_utf16_and_suggestions_filtered() {
        let text = "😀 Les enfant joue.";
        let diags = vec![
            Diag { start_char: 6, end_char: 12, category: "Grammar".into(), severity: "Error".into(), rule_id: "g".into(), message: "Accord".into(), explanation: None, url: None, suggestions: vec!["enfants".into()] },
            Diag { start_char: 2, end_char: 5, category: "Style".into(), severity: "Suggestion".into(), rule_id: "s".into(), message: "Style".into(), explanation: None, url: None, suggestions: vec![] },
        ];
        let v = to_languagetool(text, &Options::default(), &diags);
        let m = v["matches"].as_array().unwrap();
        assert_eq!(m.len(), 1, "suggestion de style écartée par défaut");
        // L'émoji compte pour 2 unités UTF-16 : « enfant » commence à 7.
        assert_eq!(m[0]["offset"], 7);
        assert_eq!(m[0]["length"], 6);
        assert_eq!(m[0]["rule"]["category"]["id"], "GRAMMAR");
        assert_eq!(m[0]["replacements"][0]["value"], "enfants");
        let with_style = to_languagetool(text, &Options { style: true, ..Options::default() }, &diags);
        assert_eq!(with_style["matches"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn form_decoding_matches_libreoffice_encoding() {
        // LibreOffice encode tout sauf A-Z a-z 0-9 - . _ ~ en UTF-8 %XX.
        let f = parse_form("text=Les%20enfant%20joue%20%C3%A0%20l%E2%80%99%C3%A9cole%2B1&language=fr-CA");
        assert_eq!(f[0], ("text".into(), "Les enfant joue à l’école+1".into()));
        assert_eq!(f[1], ("language".into(), "fr-CA".into()));
        assert_eq!(percent_decode("100%"), "100%");
    }

    #[test]
    fn options_become_cli_flags() {
        assert_eq!(Options::default().args(), vec!["verifier", "-", "--json", "--sans-style"]);
        let o = Options { international: true, style: true, regional: false, variant: "1990".into(), enabled: true };
        assert_eq!(o.args(), vec!["verifier", "-", "--json", "--international", "--sans-regional", "--variante", "1990"]);
    }

    #[test]
    fn shared_settings_require_existing_cli() {
        let dir = std::env::temp_dir().join(format!("auxi-ac-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let cli = dir.join("auxicorrect-cli");
        std::fs::write(&cli, b"").unwrap();
        let f = dir.join(SETTINGS_FILE);
        std::fs::write(&f, json!({"version": 1, "auxicorrect_version": "0.1.0", "cli": cli, "products": {"auxioffice": {"enabled": true}}}).to_string()).unwrap();
        let s = read_shared(&f);
        assert!(s.enabled && s.found);
        std::fs::write(&f, json!({"version": 1, "cli": dir.join("absent"), "products": {"auxioffice": {"enabled": true}}}).to_string()).unwrap();
        assert!(!read_shared(&f).enabled, "outil absent : comme désactivé");
        assert!(!read_shared(&dir.join("rien.json")).found);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
