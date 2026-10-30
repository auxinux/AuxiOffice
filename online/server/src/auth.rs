//! Comptes (fichier `users.json`, mots de passe en Argon2id) et sessions
//! (jeton aléatoire dans un témoin HttpOnly, SameSite=Strict).
//!
//! Sans comptes (`--no-auth`, poste local ou développement), tout le monde
//! est l'utilisateur « local ».

use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const COOKIE: &str = "auxi_session";

#[derive(Clone, Serialize, Deserialize)]
pub struct User {
    /// Identifiant stable : nom du dossier des documents.
    pub id: String,
    pub email: String,
    pub name: String,
    pub hash: String,
    #[serde(default)]
    pub quota_mb: Option<u64>,
}

pub struct Auth {
    file: Option<PathBuf>,
    users: Mutex<Vec<User>>,
    sessions: Mutex<HashMap<String, (String, Instant)>>,
    /// Échecs récents par adresse courriel (ralentit les essais de mots de passe).
    failures: Mutex<HashMap<String, (u32, Instant)>>,
    ttl: Duration,
}

pub fn local_user() -> User {
    User { id: "local".into(), email: "local".into(), name: whoami(), hash: String::new(), quota_mb: None }
}

fn whoami() -> String {
    std::env::var("USER").or_else(|_| std::env::var("USERNAME")).unwrap_or_else(|_| "Utilisateur".into())
}

pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default().hash_password(password.as_bytes(), &salt).map(|h| h.to_string()).map_err(|e| e.to_string())
}

fn verify(hash: &str, password: &str) -> bool {
    PasswordHash::new(hash).is_ok_and(|h| Argon2::default().verify_password(password.as_bytes(), &h).is_ok())
}

pub fn random_token() -> String {
    use rand::RngCore;
    let mut b = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn load_users(file: &PathBuf) -> Vec<User> {
    std::fs::read(file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn save_users(file: &PathBuf, users: &[User]) -> Result<(), String> {
    if let Some(d) = file.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    crate::storage::write_atomic(file, &serde_json::to_vec_pretty(users).unwrap()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

impl Auth {
    /// `file` : None = sans comptes (utilisateur « local »).
    pub fn new(file: Option<PathBuf>, ttl: Duration) -> Auth {
        let users = file.as_ref().map(load_users).unwrap_or_default();
        Auth { file, users: Mutex::new(users), sessions: Mutex::new(HashMap::new()), failures: Mutex::new(HashMap::new()), ttl }
    }

    pub fn enabled(&self) -> bool {
        self.file.is_some()
    }

    /// Relit `users.json` (comptes ajoutés en ligne de commande pendant que le serveur tourne).
    fn reload(&self) {
        if let Some(f) = &self.file {
            *self.users.lock().unwrap() = load_users(f);
        }
    }

    pub fn user(&self, id: &str) -> Option<User> {
        if !self.enabled() {
            return Some(local_user());
        }
        self.users.lock().unwrap().iter().find(|u| u.id == id).cloned()
    }

    /// Utilisateur de la session (témoin), ou l'utilisateur local sans comptes.
    pub fn session_user(&self, token: Option<&str>) -> Option<User> {
        if !self.enabled() {
            return Some(local_user());
        }
        let token = token?;
        let id = {
            let mut s = self.sessions.lock().unwrap();
            let (id, exp) = s.get(token)?.clone();
            if exp < Instant::now() {
                s.remove(token);
                return None;
            }
            // Session prolongée à chaque usage.
            s.insert(token.to_string(), (id.clone(), Instant::now() + self.ttl));
            id
        };
        self.user(&id)
    }

    /// Vérifie le mot de passe et ouvre une session ; retourne le jeton.
    pub fn login(&self, email: &str, password: &str) -> Result<(String, User), String> {
        let key = email.trim().to_lowercase();
        {
            let f = self.failures.lock().unwrap();
            if let Some((n, at)) = f.get(&key) {
                if *n >= 5 && at.elapsed() < Duration::from_secs(60) {
                    return Err("Trop d'essais : réessayez dans une minute.".into());
                }
            }
        }
        self.reload();
        let user = self.users.lock().unwrap().iter().find(|u| u.email.to_lowercase() == key).cloned();
        match user {
            Some(u) if verify(&u.hash, password) => {
                self.failures.lock().unwrap().remove(&key);
                let token = random_token();
                let mut s = self.sessions.lock().unwrap();
                s.retain(|_, (_, exp)| *exp > Instant::now());
                s.insert(token.clone(), (u.id.clone(), Instant::now() + self.ttl));
                Ok((token, u))
            }
            _ => {
                let mut f = self.failures.lock().unwrap();
                let e = f.entry(key).or_insert((0, Instant::now()));
                if e.1.elapsed() > Duration::from_secs(60) {
                    *e = (0, Instant::now());
                }
                e.0 += 1;
                e.1 = Instant::now();
                Err("Adresse ou mot de passe incorrect.".into())
            }
        }
    }

    pub fn logout(&self, token: &str) {
        self.sessions.lock().unwrap().remove(token);
    }

    pub fn ttl(&self) -> Duration {
        self.ttl
    }
}

/// Valeur du témoin de session dans l'en-tête `Cookie`.
pub fn cookie_token(headers: &axum::http::HeaderMap) -> Option<String> {
    headers.get_all(axum::http::header::COOKIE).iter().filter_map(|v| v.to_str().ok()).flat_map(|v| v.split(';')).find_map(|kv| {
        let (k, v) = kv.trim().split_once('=')?;
        (k == COOKIE).then(|| v.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connexion() {
        let dir = std::env::temp_dir().join(format!("auxi-auth-{}", rand::random::<u32>()));
        let file = dir.join("users.json");
        save_users(&file, &[User { id: "u1".into(), email: "Ana@Ex.ca".into(), name: "Ana".into(), hash: hash_password("secret").unwrap(), quota_mb: None }]).unwrap();
        let a = Auth::new(Some(file), Duration::from_secs(60));
        assert!(a.login("ana@ex.ca", "faux").is_err());
        let (tok, u) = a.login("ana@ex.ca", "secret").unwrap();
        assert_eq!(u.id, "u1");
        assert_eq!(a.session_user(Some(&tok)).unwrap().id, "u1");
        assert!(a.session_user(Some("x")).is_none());
        a.logout(&tok);
        assert!(a.session_user(Some(&tok)).is_none());
        let _ = std::fs::remove_dir_all(dir);
    }
}
