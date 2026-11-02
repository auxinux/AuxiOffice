//! Écriture atomique des fichiers (même principe qu'AuxiText).

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// Écrit `data` sans jamais laisser un fichier à moitié écrit : fichier
/// temporaire dans le même dossier, données sur disque, droits (et groupe)
/// de l'original, puis renommage par-dessus l'original.
///
/// Un lien symbolique est suivi (c'est sa cible qui est remplacée). Quand le
/// renommage changerait le fichier autrement que par son contenu (fichier
/// d'un autre utilisateur, liens physiques, dossier non modifiable), le
/// fichier est réécrit sur place.
pub fn write_atomic(path: &Path, data: &[u8]) -> io::Result<()> {
    let target = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let original = fs::metadata(&target).ok();
    if let Some(m) = &original {
        if m.is_dir() {
            return Err(io::Error::other("c'est un dossier"));
        }
        // Ne jamais remplacer un fichier que l'utilisateur ne peut pas modifier.
        fs::OpenOptions::new().write(true).open(&target)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if m.nlink() > 1 {
                return write_in_place(&target, data);
            }
        }
    }
    let dir = target.parent().filter(|d| !d.as_os_str().is_empty()).map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
    let Some((tmp, mut file)) = temp_file(&dir, &target) else {
        // Dossier non modifiable, mais fichier modifiable : sur place.
        return match original {
            Some(_) => write_in_place(&target, data),
            None => fs::write(&target, data),
        };
    };
    let result = (|| -> io::Result<bool> {
        file.write_all(data)?;
        file.sync_all()?;
        drop(file);
        if let Some(m) = &original {
            fs::set_permissions(&tmp, m.permissions())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                let mine = fs::metadata(&tmp)?;
                if mine.uid() != m.uid() {
                    return Ok(false);
                }
                if mine.gid() != m.gid() && std::os::unix::fs::chown(&tmp, None, Some(m.gid())).is_err() {
                    return Ok(false);
                }
            }
        }
        fs::rename(&tmp, &target)?;
        Ok(true)
    })();
    match result {
        Ok(true) => {
            #[cfg(unix)]
            if let Ok(d) = fs::File::open(&dir) {
                let _ = d.sync_all();
            }
            Ok(())
        }
        Ok(false) => {
            let _ = fs::remove_file(&tmp);
            write_in_place(&target, data)
        }
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e)
        }
    }
}

fn temp_file(dir: &Path, target: &Path) -> Option<(PathBuf, fs::File)> {
    let name = target.file_name()?.to_string_lossy().into_owned();
    for n in 0..100u32 {
        let tmp = dir.join(format!(".{name}.auxipdfwriter-{}-{n}.tmp", std::process::id()));
        match fs::OpenOptions::new().write(true).create_new(true).open(&tmp) {
            Ok(f) => return Some((tmp, f)),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(_) => return None,
        }
    }
    None
}

fn write_in_place(target: &Path, data: &[u8]) -> io::Result<()> {
    let mut f = fs::OpenOptions::new().write(true).truncate(true).open(target)?;
    f.write_all(data)?;
    f.sync_all()
}
