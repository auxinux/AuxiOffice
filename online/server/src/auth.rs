//! Comptes (fichier `users.json`, mots de passe en Argon2id) et sessions
//! (jeton aléatoire dans un témoin HttpOnly, SameSite=Strict). Les sessions
//! sont gardées dans `sessions.json` (empreinte SHA-256 du jeton seulement) :
//! un redémarrage du serveur ne déconnecte personne.
//!
//! Sans comptes (`--no-auth`, poste local ou développement), tout le monde
//! est l'utilisateur « local ».

use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const COOKIE: &str = "auxi_session";
pub const MIN_PASSWORD: usize = 8;

#[derive(Clone, Serialize, Deserialize)]
pub struct User {
    /// Identifiant stable : nom du dossier des documents.
    pub id: String,
    pub email: String,
    pub name: String,
    pub hash: String,
    #[serde(default)]
    pub quota_mb: Option<u64>,
    /// Administrateur : gère les comptes depuis le portail.
    #[serde(default)]
    pub admin: bool,
}

/// Session gardée sur le disque : compte et expiration (secondes depuis 1970).
#[derive(Clone, Serialize, Deserialize)]
struct Stored {
    user: String,
    expires: u64,
}

pub struct Auth {
    file: Option<PathBuf>,
    sessions_file: Option<PathBuf>,
    users: Mutex<Vec<User>>,
    /// Empreinte du jeton → session.
    sessions: Mutex<HashMap<String, Stored>>,
    /// Échecs récents par adresse courriel (ralentit les essais de mots de passe).
    failures: Mutex<HashMap<String, (u32, Instant)>>,
    ttl: Duration,
}

pub fn local_user() -> User {
    User { id: "local".into(), email: "local".into(), name: whoami(), hash: String::new(), quota_mb: None, admin: false }
}

fn whoami() -> String {
    std::env::var("USER").or_else(|_| std::env::var("USERNAME")).unwrap_or_else(|_| "Utilisateur".into())
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn hash_password(password: &str) -> Result<String, String> {
    if password.chars().count() < MIN_PASSWORD {
        return Err(format!("Mot de passe trop court ({MIN_PASSWORD} caractères au moins)."));
    }
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

/// Empreinte d'un jeton de session (seule gardée sur le disque).
fn digest(token: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(token.as_bytes()).iter().map(|x| format!("{x:02x}")).collect()
}

pub fn load_users(file: &PathBuf) -> Vec<User> {
    std::fs::read(file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn write_private(file: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    if let Some(d) = file.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    crate::storage::write_atomic(file, bytes).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn save_users(file: &PathBuf, users: &[User]) -> Result<(), String> {
    write_private(file, &serde_json::to_vec_pretty(users).unwrap())
}

/// Nouveau compte (identifiant aléatoire).
pub fn new_user(email: &str, name: &str, password: &str, quota_mb: Option<u64>, admin: bool) -> Result<User, String> {
    let email = email.trim();
    if !email.contains('@') || email.len() > 200 || email.chars().any(char::is_whitespace) {
        return Err("Adresse courriel invalide.".into());
    }
    let name = if name.trim().is_empty() { email.split('@').next().unwrap_or("").to_string() } else { name.trim().chars().take(100).collect() };
    Ok(User { id: format!("u{}", &random_token()[..16]), email: email.to_string(), name, hash: hash_password(password)?, quota_mb, admin })
}

impl Auth {
    /// `file` : None = sans comptes (utilisateur « local »).
    pub fn new(file: Option<PathBuf>, ttl: Duration) -> Auth {
        let users = file.as_ref().map(load_users).unwrap_or_default();
        let sessions_file = file.as_ref().map(|f| f.with_file_name("sessions.json"));
        let mut sessions: HashMap<String, Stored> = sessions_file.as_ref().and_then(|f| std::fs::read(f).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        sessions.retain(|_, s| s.expires > now());
        Auth { file, sessions_file, users: Mutex::new(users), sessions: Mutex::new(sessions), failures: Mutex::new(HashMap::new()), ttl }
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

    fn save_sessions(&self, s: &HashMap<String, Stored>) {
        if let Some(f) = &self.sessions_file {
            if let Err(e) = write_private(f, &serde_json::to_vec(s).unwrap()) {
                eprintln!("auxi-online : sessions non enregistrées : {e}");
            }
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
        let key = digest(token?);
        let id = {
            let mut s = self.sessions.lock().unwrap();
            let st = s.get_mut(&key)?;
            if st.expires < now() {
                s.remove(&key);
                return None;
            }
            // Session prolongée à chaque usage (sur le disque à la prochaine écriture).
            st.expires = now() + self.ttl.as_secs();
            st.user.clone()
        };
        self.user(&id)
    }

    fn open_session(&self, user: &str) -> String {
        let token = random_token();
        let mut s = self.sessions.lock().unwrap();
        s.retain(|_, st| st.expires > now());
        s.insert(digest(&token), Stored { user: user.to_string(), expires: now() + self.ttl.as_secs() });
        self.save_sessions(&s);
        token
    }

    /// Ferme les sessions d'un compte, sauf `keep` (jeton).
    fn close_sessions(&self, user: &str, keep: Option<&str>) {
        let keep = keep.map(digest);
        let mut s = self.sessions.lock().unwrap();
        s.retain(|k, st| st.user != user || Some(k) == keep.as_ref());
        self.save_sessions(&s);
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
                Ok((self.open_session(&u.id), u))
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
        let mut s = self.sessions.lock().unwrap();
        s.remove(&digest(token));
        self.save_sessions(&s);
    }

    pub fn ttl(&self) -> Duration {
        self.ttl
    }

    // --- Gestion des comptes ---------------------------------------------------

    fn update(&self, f: impl FnOnce(&mut Vec<User>) -> Result<(), String>) -> Result<(), String> {
        let file = self.file.as_ref().ok_or("Serveur sans comptes (--no-auth).")?;
        self.reload();
        let mut users = self.users.lock().unwrap();
        f(&mut users)?;
        save_users(file, &users)
    }

    pub fn list(&self) -> Vec<User> {
        self.reload();
        self.users.lock().unwrap().clone()
    }

    pub fn add(&self, u: User) -> Result<(), String> {
        self.update(|users| {
            if users.iter().any(|x| x.email.eq_ignore_ascii_case(&u.email)) {
                return Err(format!("Le compte {} existe déjà.", u.email));
            }
            users.push(u);
            Ok(())
        })
    }

    /// Supprime un compte et ferme ses sessions (ses fichiers restent).
    pub fn remove(&self, email: &str) -> Result<User, String> {
        let mut removed = None;
        self.update(|users| {
            let i = users.iter().position(|u| u.email.eq_ignore_ascii_case(email)).ok_or(format!("{email} : compte inconnu"))?;
            if users[i].admin && users.iter().filter(|u| u.admin).count() == 1 {
                return Err("Impossible de supprimer le dernier administrateur.".into());
            }
            removed = Some(users.remove(i));
            Ok(())
        })?;
        let u = removed.unwrap();
        self.close_sessions(&u.id, None);
        Ok(u)
    }

    /// Nouveau mot de passe (administration) : les sessions du compte sont fermées.
    pub fn set_password(&self, email: &str, password: &str) -> Result<(), String> {
        let hash = hash_password(password)?;
        let mut id = String::new();
        self.update(|users| {
            let u = users.iter_mut().find(|u| u.email.eq_ignore_ascii_case(email)).ok_or(format!("{email} : compte inconnu"))?;
            u.hash = hash;
            id = u.id.clone();
            Ok(())
        })?;
        self.close_sessions(&id, None);
        Ok(())
    }

    /// Modifie un compte (nom, quota, administrateur).
    pub fn set_profile(&self, email: &str, name: Option<String>, quota_mb: Option<Option<u64>>, admin: Option<bool>) -> Result<(), String> {
        self.update(|users| {
            let i = users.iter().position(|u| u.email.eq_ignore_ascii_case(email)).ok_or(format!("{email} : compte inconnu"))?;
            if admin == Some(false) && users[i].admin && users.iter().filter(|u| u.admin).count() == 1 {
                return Err("Il faut garder au moins un administrateur.".into());
            }
            let u = &mut users[i];
            if let Some(n) = name.filter(|n| !n.trim().is_empty()) {
                u.name = n.trim().chars().take(100).collect();
            }
            if let Some(q) = quota_mb {
                u.quota_mb = q;
            }
            if let Some(a) = admin {
                u.admin = a;
            }
            Ok(())
        })
    }

    /// Changement de son propre mot de passe : l'ancien est vérifié ; les
    /// autres sessions du compte sont fermées.
    pub fn change_own(&self, id: &str, token: &str, old: &str, new: &str) -> Result<(), String> {
        let hash = hash_password(new)?;
        self.update(|users| {
            let u = users.iter_mut().find(|u| u.id == id).ok_or("compte inconnu")?;
            if !verify(&u.hash, old) {
                return Err("Mot de passe actuel incorrect.".into());
            }
            u.hash = hash;
            Ok(())
        })?;
        self.close_sessions(id, Some(token));
        Ok(())
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
    fn connexion_et_comptes() {
        let dir = std::env::temp_dir().join(format!("auxi-auth-{}", rand::random::<u32>()));
        let file = dir.join("users.json");
        let mut ana = new_user("Ana@Ex.ca", "Ana", "secret12", None, true).unwrap();
        ana.id = "u1".into();
        save_users(&file, &[ana]).unwrap();
        let a = Auth::new(Some(file.clone()), Duration::from_secs(60));
        assert!(a.login("ana@ex.ca", "faux").is_err());
        let (tok, u) = a.login("ana@ex.ca", "secret12").unwrap();
        assert_eq!(u.id, "u1");
        assert_eq!(a.session_user(Some(&tok)).unwrap().id, "u1");
        assert!(a.session_user(Some("x")).is_none());
        // Les sessions survivent à un redémarrage ; le jeton n'est pas écrit en clair.
        let disk = std::fs::read_to_string(dir.join("sessions.json")).unwrap();
        assert!(!disk.contains(&tok));
        let b = Auth::new(Some(file.clone()), Duration::from_secs(60));
        assert_eq!(b.session_user(Some(&tok)).unwrap().id, "u1");
        // Comptes.
        assert!(new_user("pas-un-courriel", "", "secret12", None, false).is_err());
        assert!(new_user("x@y.ca", "", "court", None, false).is_err());
        b.add(new_user("bob@ex.ca", "", "secret12", Some(100), false).unwrap()).unwrap();
        assert!(b.add(new_user("BOB@ex.ca", "", "secret12", None, false).unwrap()).is_err());
        assert!(b.remove("ana@ex.ca").is_err(), "dernier administrateur");
        let (tb, _) = b.login("bob@ex.ca", "secret12").unwrap();
        b.set_password("bob@ex.ca", "nouveau12").unwrap();
        assert!(b.session_user(Some(&tb)).is_none(), "sessions fermées");
        b.remove("bob@ex.ca").unwrap();
        assert!(b.login("bob@ex.ca", "nouveau12").is_err());
        // Changement de son mot de passe : la session courante reste.
        assert!(b.change_own("u1", &tok, "faux", "autre1234").is_err());
        b.change_own("u1", &tok, "secret12", "autre1234").unwrap();
        assert!(b.session_user(Some(&tok)).is_some());
        b.logout(&tok);
        assert!(b.session_user(Some(&tok)).is_none());
        let _ = std::fs::remove_dir_all(dir);
    }
}
