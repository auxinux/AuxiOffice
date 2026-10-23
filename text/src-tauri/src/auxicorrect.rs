//! AuxiCorrect, le correcteur du français de l'écosystème AuxiNux.
//!
//! AuxiCorrect est un programme séparé (GPL-3.0) : AuxiText ne lie pas sa
//! bibliothèque, il appelle son outil `auxicorrect-cli` (voir INTEGRATION.md
//! d'AuxiCorrect). L'activation se lit dans le réglage commun
//! `auxicorrect.json`, écrit par AuxiCorrect (Paramètres → Intégration, clé
//! `auxitext`) ; il est relu à chaque demande (retour dans la fenêtre).
//! Sans AuxiCorrect, AuxiText fonctionne exactement comme avant.

use serde::Serialize;
use serde_json::Value;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Nom du réglage commun, gardé en clair dans l'exécutable : l'onglet
/// Intégration d'AuxiCorrect le cherche pour savoir si cette version
/// d'AuxiText prend AuxiCorrect en charge.
pub const SETTINGS_FILE: &str = "auxicorrect.json";

/// Texte au-delà duquel la vérification n'est pas faite (caractères).
pub const MAX_CHARS: usize = 200_000;

/// Délai maximal d'une vérification.
const TIMEOUT: Duration = Duration::from_secs(20);

/// Réglage commun écrit par AuxiCorrect (lu seulement).
#[derive(Clone, Debug, Default, Serialize)]
pub struct Status {
    /// Réglage commun trouvé (AuxiCorrect installé).
    pub installed: bool,
    /// AuxiText activé dans AuxiCorrect et outil présent.
    pub enabled: bool,
    pub version: Option<String>,
    #[serde(skip)]
    pub cli: Option<PathBuf>,
    #[serde(skip)]
    pub app: Option<PathBuf>,
    #[serde(rename = "hasApp")]
    pub has_app: bool,
}

pub fn settings_path() -> PathBuf {
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

pub fn read_status(file: &Path) -> Status {
    let mut s = Status::default();
    let Some(v) = std::fs::read(file).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else {
        return s;
    };
    s.installed = true;
    s.version = v["auxicorrect_version"].as_str().map(str::to_owned);
    s.cli = v["cli"].as_str().map(PathBuf::from).filter(|p| p.is_file());
    s.app = v["app"].as_str().map(PathBuf::from).filter(|p| p.exists());
    s.has_app = s.app.is_some();
    s.enabled = v["products"]["auxitext"]["enabled"].as_bool() == Some(true) && s.cli.is_some();
    s
}

/// Remarque transmise à l'éditeur : positions en unités UTF-16 (JavaScript).
#[derive(Debug, Serialize, PartialEq)]
pub struct Remark {
    pub from: usize,
    pub to: usize,
    pub category: String,
    pub severity: String,
    pub message: String,
    pub suggestions: Vec<String>,
    pub rule: String,
}

/// Arguments de `auxicorrect-cli` : profil québécois (ou international),
/// sans les suggestions de style (comme AuxiCorrect par défaut).
pub fn cli_args(international: bool) -> Vec<&'static str> {
    let mut a = vec!["verifier", "-", "--json", "--sans-style"];
    if international {
        a.push("--international");
    }
    a
}

/// Lit la sortie de `verifier --json` : un tableau JSON valide, sinon échec.
/// Les positions (points de code, `start_char`/`end_char`) deviennent des
/// unités UTF-16.
pub fn parse_remarks(text: &str, out: &[u8]) -> Result<Vec<Remark>, String> {
    let list: Vec<Value> = serde_json::from_slice(out).map_err(|_| "réponse d'AuxiCorrect illisible".to_string())?;
    // Table point de code → unité UTF-16.
    let mut utf16 = Vec::with_capacity(text.len() + 1);
    let mut n = 0;
    for c in text.chars() {
        utf16.push(n);
        n += c.len_utf16();
    }
    utf16.push(n);
    let at = |i: usize| utf16.get(i).copied().unwrap_or(n);
    let mut remarks = Vec::new();
    for d in list {
        let (Some(s), Some(e)) = (d["start_char"].as_u64(), d["end_char"].as_u64()) else { continue };
        if e <= s {
            continue;
        }
        let str_of = |k: &str| d[k].as_str().unwrap_or_default().to_string();
        let suggestions = d["suggestions"].as_array().map(|a| a.iter().filter_map(|x| x.as_str()).filter(|x| !x.is_empty()).take(6).map(str::to_owned).collect()).unwrap_or_default();
        remarks.push(Remark {
            from: at(s as usize),
            to: at(e as usize),
            category: str_of("category"),
            severity: str_of("severity"),
            message: str_of("message"),
            suggestions,
            rule: str_of("rule_id"),
        });
    }
    Ok(remarks)
}

/// Vérifie `text` avec l'outil d'AuxiCorrect.
pub fn check(cli: &Path, text: &str, international: bool) -> Result<Vec<Remark>, String> {
    if text.chars().count() > MAX_CHARS {
        return Ok(vec![]);
    }
    let mut child = Command::new(cli)
        .args(cli_args(international))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("AuxiCorrect introuvable ({e})"))?;
    let mut stdin = child.stdin.take().ok_or("entrée d'AuxiCorrect indisponible")?;
    let body = text.as_bytes().to_vec();
    let writer = std::thread::spawn(move || {
        let _ = stdin.write_all(&body);
    });
    let mut stdout = child.stdout.take().ok_or("sortie d'AuxiCorrect indisponible")?;
    let reader = std::thread::spawn(move || {
        let mut out = Vec::new();
        let _ = stdout.read_to_end(&mut out);
        out
    });
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() > TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("AuxiCorrect n'a pas répondu à temps".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => return Err(e.to_string()),
        }
    }
    let _ = writer.join();
    let out = reader.join().unwrap_or_default();
    // Le code de sortie ne compte pas (1 dès qu'il y a une faute) : seule la
    // présence d'un tableau JSON valide fait foi.
    parse_remarks(text, &out).map_err(|e| {
        let mut err = String::new();
        if let Some(mut s) = child.stderr.take() {
            let _ = s.read_to_string(&mut err);
        }
        let err = err.trim();
        if err.is_empty() { e } else { format!("{e} : {}", err.chars().take(300).collect::<String>()) }
    })
}

/// Ouvre l'application AuxiCorrect (ses paramètres, son dictionnaire).
pub fn open_app(app: &Path) -> Result<(), String> {
    let mut c = if cfg!(target_os = "macos") && app.extension().is_some_and(|e| e == "app") {
        let mut c = Command::new("open");
        c.arg("-a").arg(app);
        c
    } else {
        Command::new(app)
    };
    c.stdin(Stdio::null()).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn product_key_and_existing_cli_are_required() {
        let dir = std::env::temp_dir().join(format!("auxitext-ac-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let cli = dir.join("auxicorrect-cli");
        std::fs::write(&cli, b"").unwrap();
        let file = dir.join(SETTINGS_FILE);
        let write = |v: Value| std::fs::write(&file, serde_json::to_vec(&v).unwrap()).unwrap();
        assert!(!read_status(&file).installed, "fichier absent");
        write(serde_json::json!({"version": 1, "auxicorrect_version": "0.1.0", "cli": cli, "products": {"auxitext": {"enabled": true}, "inconnu": 3}}));
        let s = read_status(&file);
        assert!(s.installed && s.enabled);
        assert_eq!(s.version.as_deref(), Some("0.1.0"));
        // AuxiOffice activé ne suffit pas : la clé est celle d'AuxiText.
        write(serde_json::json!({"cli": cli, "products": {"auxioffice": {"enabled": true}}}));
        assert!(!read_status(&file).enabled);
        // Outil disparu : comme désactivé.
        write(serde_json::json!({"cli": dir.join("absent"), "products": {"auxitext": {"enabled": true}}}));
        let s = read_status(&file);
        assert!(s.installed && !s.enabled);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn positions_become_utf16_units() {
        // « 😀 » : 1 point de code, 2 unités UTF-16 ; « é » : 1 et 1.
        let text = "😀 Les enfant été";
        let out = br#"[{"start":9,"end":15,"start_char":6,"end_char":12,"category":"Grammar","severity":"Error","rule_id":"g1","message":"Accord","suggestions":["enfants",""],"text":"enfant"},
                      {"start_char":3,"end_char":3,"category":"X","severity":"Error"}]"#;
        let r = parse_remarks(text, out).unwrap();
        assert_eq!(r.len(), 1, "remarque vide ignorée");
        assert_eq!((r[0].from, r[0].to), (7, 13));
        let units: Vec<u16> = text.encode_utf16().collect();
        assert_eq!(String::from_utf16(&units[r[0].from..r[0].to]).unwrap(), "enfant");
        assert_eq!(r[0].suggestions, vec!["enfants"]);
        assert_eq!(r[0].rule, "g1");
    }

    #[test]
    fn invalid_output_is_a_failure() {
        assert!(parse_remarks("abc", b"Erreur : moteur").is_err());
        assert!(parse_remarks("abc", b"").is_err());
        assert_eq!(parse_remarks("abc", b"[]").unwrap(), vec![]);
    }

    #[test]
    fn quebec_profile_without_style_by_default() {
        assert_eq!(cli_args(false), vec!["verifier", "-", "--json", "--sans-style"]);
        assert!(cli_args(true).contains(&"--international"));
    }

    #[cfg(unix)]
    #[test]
    fn calls_the_cli_and_reads_its_json() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("auxitext-cli-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let cli = dir.join("auxicorrect-cli");
        // Faux outil : lit l'entrée, signale « fote » (octets 3 à 7) et sort avec le code 1.
        std::fs::write(&cli, "#!/bin/sh\ncat >/dev/null\necho '[{\"start_char\":3,\"end_char\":7,\"category\":\"Spelling\",\"severity\":\"Error\",\"rule_id\":\"s\",\"message\":\"Faute\",\"suggestions\":[\"faute\"]}]'\nexit 1\n").unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o755)).unwrap();
        let r = check(&cli, "Un fote.", false).unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!((r[0].from, r[0].to, r[0].category.as_str()), (3, 7, "Spelling"));
        std::fs::write(&cli, "#!/bin/sh\necho 'moteur absent' >&2\nexit 1\n").unwrap();
        let e = check(&cli, "x", false).unwrap_err();
        assert!(e.contains("moteur absent"), "{e}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
