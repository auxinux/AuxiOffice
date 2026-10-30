//! Réglages du serveur modifiables par les administrateurs depuis le portail
//! (`données/settings.json`). Les options de la ligne de commande donnent
//! les valeurs de départ ; une fois enregistrés, les réglages du portail
//! priment.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Espace par défaut d'un compte (Mo).
    pub default_quota_mb: u64,
    /// Documents de bureautique ouverts en même temps par compte.
    pub max_docs_per_user: usize,
    /// Fermeture d'un document resté inactif (minutes).
    pub idle_minutes: u64,
    /// Adresse d'AuxiMail (webmail) ; vide : « bientôt » dans le portail.
    pub auximail_url: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { default_quota_mb: 1024, max_docs_per_user: 6, idle_minutes: 120, auximail_url: String::new() }
    }
}

impl Settings {
    /// Valeurs acceptées (bornes raisonnables) ; message d'erreur sinon.
    pub fn check(&self) -> Result<(), String> {
        if !(10..=10_000_000).contains(&self.default_quota_mb) {
            return Err("Espace par défaut : entre 10 Mo et 10 To.".into());
        }
        if !(1..=50).contains(&self.max_docs_per_user) {
            return Err("Documents ouverts par compte : entre 1 et 50.".into());
        }
        if !(5..=10_080).contains(&self.idle_minutes) {
            return Err("Fermeture des documents inactifs : entre 5 minutes et 7 jours.".into());
        }
        let u = self.auximail_url.trim();
        if !u.is_empty() && !(u.starts_with("https://") || u.starts_with("http://")) {
            return Err("Adresse d'AuxiMail : elle doit commencer par https://".into());
        }
        Ok(())
    }
}

pub struct Store {
    file: PathBuf,
    current: Mutex<Settings>,
}

impl Store {
    /// Réglages enregistrés, sinon `initial` (options de la ligne de commande).
    pub fn load(file: PathBuf, initial: Settings) -> Store {
        let current = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(initial);
        Store { file, current: Mutex::new(current) }
    }

    pub fn get(&self) -> Settings {
        self.current.lock().unwrap().clone()
    }

    pub fn set(&self, mut s: Settings) -> Result<Settings, String> {
        s.auximail_url = s.auximail_url.trim().to_string();
        s.check()?;
        crate::storage::write_atomic(&self.file, &serde_json::to_vec_pretty(&s).unwrap()).map_err(|e| e.to_string())?;
        *self.current.lock().unwrap() = s.clone();
        Ok(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reglages() {
        let dir = std::env::temp_dir().join(format!("auxi-settings-{}", rand::random::<u32>()));
        std::fs::create_dir_all(&dir).unwrap();
        let st = Store::load(dir.join("settings.json"), Settings { default_quota_mb: 500, ..Default::default() });
        assert_eq!(st.get().default_quota_mb, 500);
        assert!(st.set(Settings { max_docs_per_user: 0, ..Default::default() }).is_err());
        assert!(st.set(Settings { auximail_url: "ftp://x".into(), ..Default::default() }).is_err());
        st.set(Settings { default_quota_mb: 2048, auximail_url: " https://mail.auxinux.ca ".into(), ..Default::default() }).unwrap();
        let again = Store::load(dir.join("settings.json"), Settings::default());
        assert_eq!(again.get().default_quota_mb, 2048);
        assert_eq!(again.get().auximail_url, "https://mail.auxinux.ca");
        let _ = std::fs::remove_dir_all(dir);
    }
}
