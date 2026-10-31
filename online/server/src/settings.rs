//! Réglages du serveur modifiables par les administrateurs depuis le portail
//! (`données/settings.json`). Les options de la ligne de commande donnent
//! les valeurs de départ ; une fois enregistrés, les réglages du portail
//! priment.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

/// Forfait : espace total d'un compte (documents, courriels, pièces jointes :
/// tout ce qui prend de la place sur le serveur au nom du client).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Plan {
    pub id: String,
    pub name: String,
    pub quota_mb: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Forfaits offerts ; le premier créé est « Free » (1 Go).
    pub plans: Vec<Plan>,
    /// Forfait des comptes qui n'en ont pas reçu.
    pub default_plan: String,
    /// Espace du forfait par défaut (Mo) ; gardé pour les anciens réglages
    /// et l'option --quota-mb.
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
        Settings { plans: vec![], default_plan: String::new(), default_quota_mb: 1024, max_docs_per_user: 6, idle_minutes: 120, auximail_url: String::new() }
    }
}

/// Identifiant d'un forfait d'après son nom (« Plus 10 Go » → « plus-10-go »).
pub fn plan_id(name: &str) -> String {
    let mut id = String::new();
    for c in name.trim().to_lowercase().chars() {
        let c = match c {
            'à' | 'â' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' => 'i',
            'ô' | 'ö' => 'o',
            'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            c => c,
        };
        if c.is_ascii_alphanumeric() {
            id.push(c);
        } else if !id.ends_with('-') && !id.is_empty() {
            id.push('-');
        }
    }
    id.trim_end_matches('-').to_string()
}

impl Settings {
    /// Anciens réglages (sans forfaits) : un forfait « Free » de l'espace par défaut.
    fn normalize(&mut self) {
        if self.plans.is_empty() {
            self.plans.push(Plan { id: "free".into(), name: "Free".into(), quota_mb: self.default_quota_mb });
        }
        for p in &mut self.plans {
            p.name = p.name.trim().to_string();
            if p.id.is_empty() {
                p.id = plan_id(&p.name);
            }
        }
        if !self.plans.iter().any(|p| p.id == self.default_plan) {
            self.default_plan = self.plans[0].id.clone();
        }
        self.default_quota_mb = self.plan(None).quota_mb;
    }

    /// Forfait `id`, sinon le forfait par défaut.
    pub fn plan(&self, id: Option<&str>) -> Plan {
        id.and_then(|i| self.plans.iter().find(|p| p.id == i))
            .or_else(|| self.plans.iter().find(|p| p.id == self.default_plan))
            .or_else(|| self.plans.first())
            .cloned()
            .unwrap_or(Plan { id: "free".into(), name: "Free".into(), quota_mb: self.default_quota_mb })
    }

    /// Valeurs acceptées (bornes raisonnables) ; message d'erreur sinon.
    pub fn check(&self) -> Result<(), String> {
        if self.plans.is_empty() {
            return Err("Il faut au moins un forfait.".into());
        }
        let mut seen = std::collections::HashSet::new();
        for p in &self.plans {
            if p.name.is_empty() || p.id.is_empty() {
                return Err("Chaque forfait doit avoir un nom.".into());
            }
            if !seen.insert(p.id.clone()) {
                return Err(format!("Deux forfaits portent le même nom : « {} ».", p.name));
            }
            if !(10..=10_000_000).contains(&p.quota_mb) {
                return Err(format!("Forfait « {} » : espace entre 10 Mo et 10 To.", p.name));
            }
        }
        if !(1..=50).contains(&self.max_docs_per_user) {
            return Err("Documents ouverts par compte : entre 1 et 50.".into());
        }
        if !(5..=10_080).contains(&self.idle_minutes) {
            return Err("Fermeture des documents inactifs : entre 5 minutes et 7 jours.".into());
        }
        // Adresse complète, ou relative au portail (« /mail/ » : même hôte, http comme https).
        let u = self.auximail_url.trim();
        let relative = u.starts_with('/') && !u.starts_with("//");
        if !u.is_empty() && !(u.starts_with("https://") || u.starts_with("http://") || relative) || u.chars().any(|c| c.is_whitespace() || c == '"' || c == '<') {
            return Err("Adresse d'AuxiMail : https://… ou une adresse de ce serveur comme /mail/".into());
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
        let mut current: Settings = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(initial);
        current.normalize();
        Store { file, current: Mutex::new(current) }
    }

    pub fn get(&self) -> Settings {
        self.current.lock().unwrap().clone()
    }

    pub fn set(&self, mut s: Settings) -> Result<Settings, String> {
        s.auximail_url = s.auximail_url.trim().to_string();
        s.normalize();
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
        assert_eq!(st.get().plan(None), Plan { id: "free".into(), name: "Free".into(), quota_mb: 500 });
        assert_eq!(plan_id(" Plus 10 Go (été) "), "plus-10-go-ete");
        let two = Settings { plans: vec![Plan { id: String::new(), name: "Free".into(), quota_mb: 1024 }, Plan { id: String::new(), name: "Plus".into(), quota_mb: 10240 }], default_plan: "plus".into(), ..Default::default() };
        let saved = st.set(two).unwrap();
        assert_eq!(saved.plan(Some("free")).quota_mb, 1024);
        assert_eq!(saved.plan(Some("inconnu")).id, "plus");
        assert_eq!(saved.default_quota_mb, 10240);
        let dup = Settings { plans: vec![Plan { id: "a".into(), name: "A".into(), quota_mb: 100 }, Plan { id: "a".into(), name: "A".into(), quota_mb: 200 }], ..Default::default() };
        assert!(st.set(dup).is_err());
        assert!(st.set(Settings { max_docs_per_user: 0, ..Default::default() }).is_err());
        assert!(st.set(Settings { auximail_url: "ftp://x".into(), ..Default::default() }).is_err());
        assert!(st.set(Settings { auximail_url: "//pirate.example/".into(), ..Default::default() }).is_err());
        st.set(Settings { auximail_url: "/mail/".into(), ..Default::default() }).unwrap();
        st.set(Settings { plans: vec![Plan { id: "free".into(), name: "Free".into(), quota_mb: 2048 }], auximail_url: " https://mail.auxinux.ca ".into(), ..Default::default() }).unwrap();
        let again = Store::load(dir.join("settings.json"), Settings::default());
        assert_eq!(again.get().default_quota_mb, 2048);
        assert_eq!(again.get().auximail_url, "https://mail.auxinux.ca");
        let _ = std::fs::remove_dir_all(dir);
    }
}
