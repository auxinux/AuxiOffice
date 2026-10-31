//! Espace occupé au nom d'un client : « Mes fichiers » et tout ce
//! qu'AuxiMailWeb garde pour lui (courriels, pièces jointes, carnets). Le
//! forfait du compte vaut pour le total.
//!
//! Côté AuxiMail, deux sources, dans l'ordre :
//! 1. `--auximail-data <dossier>` : dossier de données d'AuxiMailWeb sur ce
//!    serveur ; l'espace d'une adresse est `users/ao-<24 premiers caractères
//!    hexadécimaux du SHA-256 de l'adresse en minuscules>` (web/INTEGRATION.md) ;
//! 2. sinon, si AuxiMailWeb est relié (`--auximail-proxy` ou
//!    `--auximail-health`) : `GET /mail/api/internal/usage?email=…` →
//!    `{"bytes": n}` (route interne, jamais relayée depuis un navigateur).
//!
//! Le résultat est gardé 60 s par adresse.

use crate::auth::User;
use crate::settings::Plan;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Clone, Serialize)]
pub struct Usage {
    /// Total compté dans le forfait (octets).
    pub used: u64,
    pub files: u64,
    pub mail: u64,
    /// Espace du forfait (octets).
    pub quota: u64,
    pub plan: Plan,
    /// Espace particulier donné par l'administrateur (au lieu du forfait).
    pub custom: bool,
}

pub struct MailUsage {
    data: Option<PathBuf>,
    http: Option<String>,
    client: ::reqwest::Client,
    cache: Mutex<HashMap<String, (u64, Instant)>>,
}

pub fn space_dir(data: &Path, email: &str) -> PathBuf {
    use sha2::{Digest, Sha256};
    let hex: String = Sha256::digest(email.trim().to_lowercase().as_bytes()).iter().map(|b| format!("{b:02x}")).collect();
    data.join("users").join(format!("ao-{}", &hex[..24]))
}

pub fn dir_size(p: &Path) -> u64 {
    let Ok(rd) = std::fs::read_dir(p) else { return 0 };
    rd.flatten()
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => dir_size(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

impl MailUsage {
    pub fn new(data: Option<PathBuf>, http: Option<String>) -> MailUsage {
        MailUsage { data, http: http.map(|h| h.trim_end_matches('/').to_string()), client: ::reqwest::Client::new(), cache: Mutex::new(HashMap::new()) }
    }

    pub fn enabled(&self) -> bool {
        self.data.is_some() || self.http.is_some()
    }

    /// Espace AuxiMail d'une adresse (octets) ; 0 si AuxiMail n'est pas relié.
    /// À appeler hors des fils de tokio (spawn_blocking).
    pub fn bytes(&self, email: &str) -> u64 {
        let key = email.trim().to_lowercase();
        if let Some((n, at)) = self.cache.lock().unwrap().get(&key) {
            if at.elapsed() < Duration::from_secs(60) {
                return *n;
            }
        }
        let n = if let Some(d) = &self.data {
            dir_size(&space_dir(d, &key))
        } else if let Some(base) = &self.http {
            let url = format!("{base}/mail/api/internal/usage?email={}", url::form_urlencoded::byte_serialize(key.as_bytes()).collect::<String>());
            let req = self.client.get(url).timeout(Duration::from_secs(5)).send();
            let fetched = tokio::runtime::Handle::try_current().ok().and_then(|h| {
                h.block_on(async {
                    let r = req.await.ok()?;
                    if !r.status().is_success() {
                        return None;
                    }
                    let v: serde_json::Value = serde_json::from_slice(&r.bytes().await.ok()?).ok()?;
                    v.get("bytes").and_then(|b| b.as_u64())
                })
            });
            match fetched {
                Some(n) => n,
                // Route pas encore offerte par AuxiMailWeb : dernière valeur connue.
                None => return self.cache.lock().unwrap().get(&key).map(|c| c.0).unwrap_or(0),
            }
        } else {
            0
        };
        self.cache.lock().unwrap().insert(key, (n, Instant::now()));
        n
    }

    /// Oublie la valeur gardée (après une action qui change l'espace).
    pub fn forget(&self, email: &str) {
        self.cache.lock().unwrap().remove(&email.trim().to_lowercase());
    }
}

/// Espace d'un compte (à appeler hors des fils de tokio).
pub fn of(app: &crate::AppState, u: &User) -> Usage {
    let settings = app.settings.get();
    let plan = settings.plan(u.plan.as_deref());
    let quota_mb = u.quota_mb.unwrap_or(plan.quota_mb);
    let files = app.store.usage(&u.id);
    let mail = if u.email.contains('@') { app.mail_usage.bytes(&u.email) } else { 0 };
    Usage { used: files + mail, files, mail, quota: quota_mb * 1024 * 1024, plan, custom: u.quota_mb.is_some() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn espace_auximail() {
        // Même règle que web/INTEGRATION.md d'AuxiMail.
        assert_eq!(space_dir(Path::new("/d"), " Aporler@Hotmail.com "), Path::new("/d/users/ao-0fa06e757c275f2da56e0ad7"));
        let dir = std::env::temp_dir().join(format!("auxi-usage-{}", rand::random::<u32>()));
        let space = space_dir(&dir, "a@b.ca");
        std::fs::create_dir_all(space.join("sous")).unwrap();
        std::fs::write(space.join("x"), vec![0u8; 1000]).unwrap();
        std::fs::write(space.join("sous/y"), vec![0u8; 500]).unwrap();
        let m = MailUsage::new(Some(dir.clone()), None);
        assert_eq!(m.bytes("A@B.ca"), 1500);
        assert_eq!(MailUsage::new(None, None).bytes("a@b.ca"), 0);
        let _ = std::fs::remove_dir_all(dir);
    }
}
