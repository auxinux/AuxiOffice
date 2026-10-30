//! Espace de documents de chaque utilisateur : `données/files/<id>/`.
//!
//! L'interface ne voit que des chemins virtuels (`/Rapports/bilan.docx`),
//! traduits ici en chemins réels après vérification : jamais de `..`, de
//! composant vide ni de caractère de contrôle, et aucun lien symbolique
//! suivi hors de l'espace de l'utilisateur.

use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Dossier des documents vierges : `isUntitled()` de l'interface reconnaît
/// `…/AuxiOffice/Sans titre <n>.<ext>`.
pub const UNTITLED_DIR: &str = "/.temp/AuxiOffice";

#[derive(Clone)]
pub struct Storage {
    root: PathBuf,
}

#[derive(Serialize)]
pub struct Entry {
    pub name: String,
    pub dir: bool,
    pub size: u64,
    pub mtime: u64,
}

#[derive(Serialize, Clone, Copy)]
pub struct Stat {
    pub exists: bool,
    pub mtime: u64,
    pub size: u64,
}

/// Composants validés d'un chemin virtuel (`/a/b.txt` → `["a", "b.txt"]`).
pub fn components(vpath: &str) -> Result<Vec<&str>, String> {
    if !vpath.starts_with('/') {
        return Err(format!("chemin invalide : {vpath}"));
    }
    let mut out = vec![];
    for c in vpath.split('/').skip(1) {
        if c.is_empty() {
            continue;
        }
        if c == "." || c == ".." || c.chars().any(|ch| ch.is_control() || ch == '\\') || c.len() > 255 {
            return Err(format!("chemin invalide : {vpath}"));
        }
        out.push(c);
    }
    Ok(out)
}

/// Forme canonique d'un chemin virtuel (`//a/./b` refusé, `/a//b` → `/a/b`).
pub fn normalize(vpath: &str) -> Result<String, String> {
    Ok(format!("/{}", components(vpath)?.join("/")))
}

pub fn file_name(vpath: &str) -> &str {
    vpath.rsplit('/').next().unwrap_or(vpath)
}

fn mtime_ms(m: &std::fs::Metadata) -> u64 {
    m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

impl Storage {
    pub fn new(root: PathBuf) -> Storage {
        Storage { root }
    }

    pub fn user_root(&self, user: &str) -> PathBuf {
        self.root.join(user)
    }

    /// Chemin réel d'un chemin virtuel de l'utilisateur. Les dossiers
    /// intermédiaires ne doivent pas être des liens symboliques.
    pub fn real(&self, user: &str, vpath: &str) -> Result<PathBuf, String> {
        let base = self.user_root(user);
        let mut p = base.clone();
        for c in components(vpath)? {
            if p != base && std::fs::symlink_metadata(&p).map(|m| m.file_type().is_symlink()).unwrap_or(false) {
                return Err(format!("chemin invalide : {vpath}"));
            }
            p.push(c);
        }
        if std::fs::symlink_metadata(&p).map(|m| m.file_type().is_symlink()).unwrap_or(false) {
            return Err(format!("chemin invalide : {vpath}"));
        }
        Ok(p)
    }

    pub fn ensure_user(&self, user: &str) -> std::io::Result<()> {
        let r = self.user_root(user);
        if !r.exists() {
            std::fs::create_dir_all(r.join("Documents"))?;
        }
        Ok(())
    }

    pub fn list(&self, user: &str, vpath: &str) -> Result<Vec<Entry>, String> {
        let dir = self.real(user, vpath)?;
        let rd = std::fs::read_dir(&dir).map_err(|e| io_msg(vpath, &e))?;
        let mut out = vec![];
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            // Dossiers internes (préférences, documents vierges) et verrous de LibreOffice.
            if (vpath == "/" && (name == ".auxi" || name == ".temp")) || name.starts_with(".~lock.") {
                continue;
            }
            let Ok(m) = e.metadata() else { continue };
            if m.file_type().is_symlink() {
                continue;
            }
            out.push(Entry { name, dir: m.is_dir(), size: if m.is_dir() { 0 } else { m.len() }, mtime: mtime_ms(&m) });
        }
        out.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        Ok(out)
    }

    pub fn stat(&self, user: &str, vpath: &str) -> Stat {
        match self.real(user, vpath).and_then(|p| std::fs::metadata(p).map_err(|e| e.to_string())) {
            Ok(m) if m.is_file() => Stat { exists: true, mtime: mtime_ms(&m), size: m.len() },
            _ => Stat { exists: false, mtime: 0, size: 0 },
        }
    }

    pub fn read(&self, user: &str, vpath: &str) -> Result<Vec<u8>, String> {
        let p = self.real(user, vpath)?;
        if p.is_dir() {
            return Err(format!("« {} » est un dossier", file_name(vpath)));
        }
        std::fs::read(&p).map_err(|e| io_msg(vpath, &e))
    }

    /// Écrit le fichier sans jamais le laisser à moitié écrit ; crée les
    /// dossiers manquants.
    pub fn write(&self, user: &str, vpath: &str, bytes: &[u8]) -> Result<Stat, String> {
        let p = self.real(user, vpath)?;
        if components(vpath)?.is_empty() || p.is_dir() {
            return Err(format!("« {vpath} » est un dossier"));
        }
        if let Some(d) = p.parent() {
            std::fs::create_dir_all(d).map_err(|e| io_msg(vpath, &e))?;
        }
        write_atomic(&p, bytes).map_err(|e| io_msg(vpath, &e))?;
        Ok(self.stat(user, vpath))
    }

    /// Copie un fichier du serveur (espace de travail d'un moteur) dans l'espace de l'utilisateur.
    pub fn import(&self, user: &str, vpath: &str, from: &Path) -> Result<Stat, String> {
        let bytes = std::fs::read(from).map_err(|e| e.to_string())?;
        self.write(user, vpath, &bytes)
    }

    pub fn mkdir(&self, user: &str, vpath: &str) -> Result<(), String> {
        let p = self.real(user, vpath)?;
        std::fs::create_dir_all(&p).map_err(|e| io_msg(vpath, &e))
    }

    pub fn rename(&self, user: &str, from: &str, to: &str) -> Result<(), String> {
        let (a, b) = (self.real(user, from)?, self.real(user, to)?);
        if components(from)?.is_empty() || components(to)?.is_empty() {
            return Err("chemin invalide".into());
        }
        if b.exists() {
            return Err(format!("« {} » existe déjà", file_name(to)));
        }
        if b.starts_with(&a) {
            return Err("un dossier ne peut pas être déplacé dans lui-même".into());
        }
        if let Some(d) = b.parent() {
            std::fs::create_dir_all(d).map_err(|e| io_msg(to, &e))?;
        }
        std::fs::rename(&a, &b).map_err(|e| io_msg(from, &e))
    }

    pub fn delete(&self, user: &str, vpath: &str) -> Result<(), String> {
        if components(vpath)?.is_empty() {
            return Err("impossible de supprimer la racine".into());
        }
        let p = self.real(user, vpath)?;
        let res = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
        res.map_err(|e| io_msg(vpath, &e))
    }

    /// Espace occupé par l'utilisateur (octets).
    pub fn usage(&self, user: &str) -> u64 {
        fn walk(p: &Path) -> u64 {
            let Ok(rd) = std::fs::read_dir(p) else { return 0 };
            rd.flatten()
                .map(|e| match e.metadata() {
                    Ok(m) if m.is_dir() => walk(&e.path()),
                    Ok(m) => m.len(),
                    Err(_) => 0,
                })
                .sum()
        }
        walk(&self.user_root(user))
    }
}

fn io_msg(vpath: &str, e: &std::io::Error) -> String {
    let what = match e.kind() {
        std::io::ErrorKind::NotFound => "introuvable".to_string(),
        std::io::ErrorKind::PermissionDenied => "accès refusé".to_string(),
        std::io::ErrorKind::AlreadyExists => "existe déjà".to_string(),
        _ => e.to_string(),
    };
    format!("« {} » : {what}", if vpath == "/" { "/" } else { file_name(vpath) })
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = dir.join(format!(".{name}.auxi-{}-{}.tmp", std::process::id(), rand::random::<u32>()));
    let res = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        std::fs::rename(&tmp, path)
    })();
    if res.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chemins_refuses() {
        for bad in ["a", "/..", "/a/../b", "/a/./b", "/a\\b", "/a\nb", ""] {
            assert!(components(bad).is_err(), "{bad:?}");
        }
        assert_eq!(normalize("/a//b/").unwrap(), "/a/b");
        assert_eq!(normalize("/").unwrap(), "/");
    }

    #[test]
    fn ecrire_lire_lister() {
        let dir = std::env::temp_dir().join(format!("auxi-online-test-{}", rand::random::<u32>()));
        let s = Storage::new(dir.clone());
        s.ensure_user("u").unwrap();
        s.write("u", "/Documents/a.txt", b"bonjour").unwrap();
        assert_eq!(s.read("u", "/Documents/a.txt").unwrap(), b"bonjour");
        assert_eq!(s.list("u", "/Documents").unwrap()[0].name, "a.txt");
        s.rename("u", "/Documents/a.txt", "/b.txt").unwrap();
        assert!(s.stat("u", "/b.txt").exists);
        assert!(s.rename("u", "/Documents", "/Documents/x").is_err());
        s.delete("u", "/b.txt").unwrap();
        assert!(!s.stat("u", "/b.txt").exists);
        assert!(s.delete("u", "/").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc", dir.join("u/lien")).unwrap();
            assert!(s.real("u", "/lien/passwd").is_err());
            assert!(s.read("u", "/lien").is_err());
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}
