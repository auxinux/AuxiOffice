//! Lecture et écriture des fichiers texte : encodage (BOM, UTF-8, UTF-16,
//! encodages 8 bits devinés par `chardetng`), fins de ligne détectées puis
//! conservées, fichiers binaires ou énormes refusés, enregistrement atomique
//! (fichier temporaire puis renommage, droits du fichier conservés).
//!
//! L'interface ne voit que des `\n` : les fins de ligne d'origine sont
//! retirées à la lecture et remises à l'enregistrement. Un fichier relu puis
//! réécrit sans modification redonne exactement les mêmes octets (sauf
//! fins de ligne mélangées, ramenées à la plus fréquente).

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// Au-delà, l'ouverture demande confirmation.
pub const LARGE_FILE: u64 = 50 * 1024 * 1024;
/// Au-delà, l'ouverture est refusée.
pub const MAX_FILE: u64 = 1024 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Eol {
    Lf,
    Crlf,
    Cr,
}

impl Eol {
    fn as_str(self) -> &'static str {
        match self {
            Eol::Lf => "\n",
            Eol::Crlf => "\r\n",
            Eol::Cr => "\r",
        }
    }

    /// Fin de ligne des fichiers neufs.
    pub fn platform() -> Eol {
        if cfg!(windows) {
            Eol::Crlf
        } else {
            Eol::Lf
        }
    }
}

/// Erreur transmise à l'interface : `code` permet d'y réagir (proposer
/// d'ouvrir quand même, d'enregistrer en UTF-8…), `message` est affichable.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TextError {
    pub code: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    /// Premier caractère impossible à représenter et sa ligne (à partir de 1).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
}

impl TextError {
    fn new(code: &'static str, message: impl Into<String>) -> TextError {
        TextError { code, message: message.into(), size: None, ch: None, line: None }
    }

    fn io(path: &Path, e: &io::Error) -> TextError {
        let what = match e.kind() {
            io::ErrorKind::NotFound => "fichier introuvable".to_string(),
            io::ErrorKind::PermissionDenied => "accès refusé".to_string(),
            _ => e.to_string(),
        };
        let code = match e.kind() {
            io::ErrorKind::NotFound => "notfound",
            io::ErrorKind::PermissionDenied => "permission",
            _ => "io",
        };
        TextError::new(code, format!("« {} » : {what}", path.display()))
    }
}

/// Texte décodé.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Decoded {
    /// Contenu, fins de ligne ramenées à `\n`.
    pub text: String,
    /// Nom de l'encodage : `UTF-8`, `UTF-16LE`, `UTF-16BE`, `ISO-8859-1` ou
    /// un nom de la norme WHATWG (`windows-1252`, `ISO-8859-15`, `Shift_JIS`…).
    pub encoding: String,
    pub bom: bool,
    pub eol: Eol,
    /// Plusieurs sortes de fins de ligne : elles seront unifiées.
    pub mixed_eol: bool,
    /// Octets invalides pour l'encodage (remplacés par U+FFFD).
    pub lossy: bool,
}

/// Encodage reconnu par son nom (insensible à la casse).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Codec {
    Utf8,
    Utf16Le,
    Utf16Be,
    /// Le vrai ISO-8859-1 : octet = point de code (WHATWG le confond avec windows-1252).
    Latin1,
    Other(&'static encoding_rs::Encoding),
}

impl Codec {
    fn parse(name: &str) -> Option<Codec> {
        let n = name.trim().to_ascii_lowercase().replace('_', "-");
        match n.as_str() {
            "utf-8" | "utf8" => Some(Codec::Utf8),
            "utf-16le" | "utf-16" => Some(Codec::Utf16Le),
            "utf-16be" => Some(Codec::Utf16Be),
            "iso-8859-1" | "latin1" | "latin-1" | "iso8859-1" => Some(Codec::Latin1),
            _ => match encoding_rs::Encoding::for_label(name.trim().as_bytes()) {
                Some(e) if e == encoding_rs::UTF_8 => Some(Codec::Utf8),
                Some(e) if e == encoding_rs::UTF_16LE => Some(Codec::Utf16Le),
                Some(e) if e == encoding_rs::UTF_16BE => Some(Codec::Utf16Be),
                // `replacement` et `x-user-defined` ne sont pas de vrais encodages de fichier.
                Some(e) if e == encoding_rs::REPLACEMENT || e == encoding_rs::X_USER_DEFINED => None,
                Some(e) => Some(Codec::Other(e)),
                None => None,
            },
        }
    }

    fn name(self) -> String {
        match self {
            Codec::Utf8 => "UTF-8".into(),
            Codec::Utf16Le => "UTF-16LE".into(),
            Codec::Utf16Be => "UTF-16BE".into(),
            Codec::Latin1 => "ISO-8859-1".into(),
            Codec::Other(e) => e.name().into(),
        }
    }

    fn bom(self) -> &'static [u8] {
        match self {
            Codec::Utf8 => b"\xEF\xBB\xBF",
            Codec::Utf16Le => b"\xFF\xFE",
            Codec::Utf16Be => b"\xFE\xFF",
            _ => b"",
        }
    }
}

/// Fichier binaire (image, exécutable, archive…) : octets nuls ou trop de
/// caractères de contrôle au début du fichier. À appeler hors UTF-16.
pub fn looks_binary(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(8192)];
    if head.contains(&0) {
        return true;
    }
    let controls = head
        .iter()
        .filter(|&&b| b < 0x20 && !matches!(b, b'\t' | b'\n' | b'\r' | 0x0C | 0x0B | 0x1B | 0x08))
        .count();
    !head.is_empty() && controls * 10 > head.len()
}

/// UTF-16 sans BOM : un octet sur deux nul (texte surtout latin).
fn utf16_without_bom(bytes: &[u8]) -> Option<Codec> {
    let head = &bytes[..bytes.len().min(4096) & !1];
    if head.len() < 4 {
        return None;
    }
    let pairs = head.len() / 2;
    let zero_even = head.iter().step_by(2).filter(|&&b| b == 0).count();
    let zero_odd = head.iter().skip(1).step_by(2).filter(|&&b| b == 0).count();
    if zero_odd * 10 >= pairs * 7 && zero_even * 20 <= pairs {
        Some(Codec::Utf16Le)
    } else if zero_even * 10 >= pairs * 7 && zero_odd * 20 <= pairs {
        Some(Codec::Utf16Be)
    } else {
        None
    }
}

/// Encodage d'un fichier sans BOM ni UTF-8 valide.
fn guess_legacy(bytes: &[u8]) -> Codec {
    let mut det = chardetng::EncodingDetector::new();
    det.feed(bytes, true);
    // Domaine « ca » : favorise les encodages d'Europe de l'Ouest en cas de doute.
    let e = det.guess(Some(b"ca"), false);
    if e == encoding_rs::UTF_8 {
        Codec::Other(encoding_rs::WINDOWS_1252)
    } else {
        Codec::Other(e)
    }
}

fn decode_with(codec: Codec, body: &[u8]) -> (String, bool) {
    match codec {
        Codec::Utf8 => match std::str::from_utf8(body) {
            Ok(s) => (s.to_string(), false),
            Err(_) => (String::from_utf8_lossy(body).into_owned(), true),
        },
        Codec::Utf16Le | Codec::Utf16Be => {
            let units = body.chunks(2).map(|c| {
                let b1 = c.get(1).copied().unwrap_or(0);
                if codec == Codec::Utf16Le {
                    u16::from_le_bytes([c[0], b1])
                } else {
                    u16::from_be_bytes([c[0], b1])
                }
            });
            let mut lossy = body.len() % 2 == 1;
            let s: String = char::decode_utf16(units)
                .map(|r| {
                    r.unwrap_or_else(|_| {
                        lossy = true;
                        char::REPLACEMENT_CHARACTER
                    })
                })
                .collect();
            (s, lossy)
        }
        Codec::Latin1 => (body.iter().map(|&b| b as char).collect(), false),
        Codec::Other(e) => {
            let (s, had_errors) = e.decode_without_bom_handling(body);
            (s.into_owned(), had_errors)
        }
    }
}

/// Fins de ligne : la plus fréquente (à égalité, LF puis CRLF), et s'il y en
/// a de plusieurs sortes. Sans aucune fin de ligne : celle de la plateforme.
pub fn detect_eol(text: &str) -> (Eol, bool) {
    let b = text.as_bytes();
    let (mut lf, mut crlf, mut cr) = (0usize, 0usize, 0usize);
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'\r' if b.get(i + 1) == Some(&b'\n') => {
                crlf += 1;
                i += 1;
            }
            b'\r' => cr += 1,
            b'\n' => lf += 1,
            _ => {}
        }
        i += 1;
    }
    let kinds = [lf, crlf, cr].iter().filter(|&&n| n > 0).count();
    let eol = if kinds == 0 {
        Eol::platform()
    } else if lf >= crlf && lf >= cr {
        Eol::Lf
    } else if crlf >= cr {
        Eol::Crlf
    } else {
        Eol::Cr
    };
    (eol, kinds > 1)
}

fn normalize_eol(text: String) -> String {
    if !text.contains('\r') {
        return text;
    }
    text.replace("\r\n", "\n").replace('\r', "\n")
}

/// Décode le contenu d'un fichier. `forced` : encodage choisi par
/// l'utilisateur (« Rouvrir avec l'encodage »), sinon détection.
pub fn decode(bytes: &[u8], forced: Option<&str>) -> Result<Decoded, TextError> {
    let (codec, bom_len) = match forced {
        Some(name) => {
            let c = Codec::parse(name).ok_or_else(|| TextError::new("encoding", format!("Encodage inconnu : {name}")))?;
            let bom = c.bom();
            (c, if !bom.is_empty() && bytes.starts_with(bom) { bom.len() } else { 0 })
        }
        None => {
            if bytes.starts_with(Codec::Utf8.bom()) {
                (Codec::Utf8, 3)
            } else if bytes.starts_with(Codec::Utf16Le.bom()) {
                (Codec::Utf16Le, 2)
            } else if bytes.starts_with(Codec::Utf16Be.bom()) {
                (Codec::Utf16Be, 2)
            } else if let Some(c) = utf16_without_bom(bytes) {
                (c, 0)
            } else if looks_binary(bytes) {
                return Err(TextError::new("binary", "Ce fichier n'est pas un fichier texte (fichier binaire)."));
            } else if std::str::from_utf8(bytes).is_ok() {
                (Codec::Utf8, 0)
            } else {
                (guess_legacy(bytes), 0)
            }
        }
    };
    let (text, lossy) = decode_with(codec, &bytes[bom_len..]);
    let (eol, mixed_eol) = detect_eol(&text);
    Ok(Decoded { text: normalize_eol(text), encoding: codec.name(), bom: bom_len > 0, eol, mixed_eol, lossy })
}

/// Encode le texte (fins de ligne `\n`) pour l'enregistrement. Refuse les
/// caractères que l'encodage ne peut pas représenter.
pub fn encode(text: &str, encoding: &str, bom: bool, eol: Eol) -> Result<Vec<u8>, TextError> {
    let codec = Codec::parse(encoding).ok_or_else(|| TextError::new("encoding", format!("Encodage inconnu : {encoding}")))?;
    let normalized;
    let text = if text.contains('\r') {
        normalized = normalize_eol(text.to_string());
        normalized.as_str()
    } else {
        text
    };
    let with_eol;
    let text = if eol == Eol::Lf {
        text
    } else {
        with_eol = text.replace('\n', eol.as_str());
        with_eol.as_str()
    };
    let mut out = Vec::with_capacity(text.len() + 3);
    if bom {
        out.extend_from_slice(codec.bom());
    }
    match codec {
        Codec::Utf8 => out.extend_from_slice(text.as_bytes()),
        Codec::Utf16Le => text.encode_utf16().for_each(|u| out.extend_from_slice(&u.to_le_bytes())),
        Codec::Utf16Be => text.encode_utf16().for_each(|u| out.extend_from_slice(&u.to_be_bytes())),
        Codec::Latin1 => {
            for (i, c) in text.char_indices() {
                if (c as u32) > 0xFF {
                    return Err(unmappable(text, i, c, encoding));
                }
                out.push(c as u32 as u8);
            }
        }
        Codec::Other(e) => {
            let mut enc = e.new_encoder();
            let mut buf = vec![0u8; enc.max_buffer_length_from_utf8_without_replacement(text.len()).unwrap_or(text.len() * 4 + 16)];
            let mut read = 0;
            loop {
                let (res, r, w) = enc.encode_from_utf8_without_replacement(&text[read..], &mut buf, true);
                out.extend_from_slice(&buf[..w]);
                read += r;
                match res {
                    encoding_rs::EncoderResult::InputEmpty => break,
                    encoding_rs::EncoderResult::OutputFull => continue,
                    encoding_rs::EncoderResult::Unmappable(c) => {
                        let at = read - c.len_utf8();
                        return Err(unmappable(text, at, c, encoding));
                    }
                }
            }
        }
    }
    Ok(out)
}

fn unmappable(text: &str, at: usize, c: char, encoding: &str) -> TextError {
    let line = text[..at].bytes().filter(|&b| b == b'\n').count() + 1;
    let mut e = TextError::new("unmappable", format!("Le caractère « {c} » (ligne {line}) n'existe pas dans l'encodage {encoding}."));
    e.ch = Some(c.to_string());
    e.line = Some(line);
    e
}

// --- Fichiers -------------------------------------------------------------

/// État d'un fichier sur le disque (détection des modifications externes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Stat {
    pub exists: bool,
    /// Date de modification en millisecondes depuis 1970 (0 si inconnue).
    pub mtime: u64,
    pub size: u64,
}

pub fn stat(path: &Path) -> Stat {
    match fs::metadata(path) {
        Ok(m) => Stat { exists: true, mtime: mtime_ms(&m), size: m.len() },
        Err(_) => Stat { exists: false, mtime: 0, size: 0 },
    }
}

fn mtime_ms(m: &fs::Metadata) -> u64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize)]
pub struct Opened {
    #[serde(flatten)]
    pub doc: Decoded,
    pub stat: Stat,
    /// Fichier non modifiable par l'utilisateur.
    pub readonly: bool,
}

/// Lit un fichier texte. `force_large` : l'utilisateur a accepté d'ouvrir
/// un fichier de plus de 50 Mo.
pub fn read_file(path: &Path, encoding: Option<&str>, force_large: bool) -> Result<Opened, TextError> {
    let meta = fs::metadata(path).map_err(|e| TextError::io(path, &e))?;
    if meta.is_dir() {
        return Err(TextError::new("folder", format!("« {} » est un dossier.", path.display())));
    }
    let size = meta.len();
    if size > MAX_FILE {
        let mut e = TextError::new("huge", format!("« {} » est trop volumineux ({} Mo) pour AuxiText.", path.display(), size / 1_048_576));
        e.size = Some(size);
        return Err(e);
    }
    if size > LARGE_FILE && !force_large {
        let mut e = TextError::new("large", format!("« {} » fait {} Mo : l'ouvrir peut être lent.", path.display(), size / 1_048_576));
        e.size = Some(size);
        return Err(e);
    }
    let bytes = fs::read(path).map_err(|e| TextError::io(path, &e))?;
    let doc = decode(&bytes, encoding)?;
    let readonly = fs::OpenOptions::new().write(true).open(path).is_err();
    Ok(Opened { doc, stat: stat(path), readonly })
}

/// Encode et enregistre ; retourne le nouvel état du fichier.
pub fn write_file(path: &Path, text: &str, encoding: &str, bom: bool, eol: Eol) -> Result<Stat, TextError> {
    let bytes = encode(text, encoding, bom, eol)?;
    write_atomic(path, &bytes).map_err(|e| TextError::io(path, &e))?;
    Ok(stat(path))
}

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
        let tmp = dir.join(format!(".{name}.auxitext-{}-{n}.tmp", std::process::id()));
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

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("auxitext-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// Relire puis réécrire sans modification redonne les mêmes octets.
    fn round_trip(bytes: &[u8]) -> Decoded {
        let d = decode(bytes, None).unwrap();
        let out = encode(&d.text, &d.encoding, d.bom, d.eol).unwrap();
        assert_eq!(out, bytes, "aller-retour {} {:?}", d.encoding, d.eol);
        d
    }

    #[test]
    fn utf8_with_and_without_bom() {
        let d = round_trip("Élève à l'école\nçà et là\n".as_bytes());
        assert_eq!((d.encoding.as_str(), d.bom, d.eol, d.lossy), ("UTF-8", false, Eol::Lf, false));
        let d = round_trip(b"\xEF\xBB\xBFBonjour \xC3\xA9t\xC3\xA9\n");
        assert_eq!((d.encoding.as_str(), d.bom), ("UTF-8", true));
        assert_eq!(d.text, "Bonjour été\n", "le BOM ne fait pas partie du texte");
    }

    #[test]
    fn utf16_with_bom_and_without() {
        let mut le = vec![0xFF, 0xFE];
        "Où ça ?\r\n€\r\n".encode_utf16().for_each(|u| le.extend_from_slice(&u.to_le_bytes()));
        let d = round_trip(&le);
        assert_eq!((d.encoding.as_str(), d.bom, d.eol, d.text.as_str()), ("UTF-16LE", true, Eol::Crlf, "Où ça ?\n€\n"));

        let mut be = vec![0xFE, 0xFF];
        "Hé\n".encode_utf16().for_each(|u| be.extend_from_slice(&u.to_be_bytes()));
        let d = round_trip(&be);
        assert_eq!((d.encoding.as_str(), d.text.as_str()), ("UTF-16BE", "Hé\n"));

        let mut nobom = vec![];
        "fichier exporté sans BOM\n".encode_utf16().for_each(|u| nobom.extend_from_slice(&u.to_le_bytes()));
        let d = round_trip(&nobom);
        assert_eq!((d.encoding.as_str(), d.bom), ("UTF-16LE", false));
    }

    #[test]
    fn windows_1252_is_detected_and_kept() {
        // « Été, ça coûte 5 € — déjà ! » en Windows-1252, fins de ligne CRLF.
        let bytes = b"\xC9t\xE9, \xE7a co\xFBte 5 \x80 \x97 d\xE9j\xE0 !\r\nL\x92\xE9l\xE8ve\r\n";
        let d = round_trip(bytes);
        assert_eq!(d.encoding, "windows-1252");
        assert_eq!(d.eol, Eol::Crlf);
        assert_eq!(d.text, "Été, ça coûte 5 € — déjà !\nL’élève\n");
        // Octets sans caractère dans windows-1252 : conservés eux aussi.
        round_trip(b"caf\xE9 \x81\x8D\x8F\x90\x9D\n");
    }

    #[test]
    fn reopen_with_another_encoding() {
        let bytes = "café\n".as_bytes();
        let d = decode(bytes, Some("windows-1252")).unwrap();
        assert_eq!(d.text, "cafÃ©\n");
        let d = decode(b"caf\xE9\n", Some("UTF-8")).unwrap();
        assert!(d.lossy, "octet invalide en UTF-8 signalé");
        let d = decode(b"caf\xE9 \x80\n", Some("ISO-8859-1")).unwrap();
        assert_eq!((d.encoding.as_str(), d.text.as_str()), ("ISO-8859-1", "café \u{80}\n"));
        assert_eq!(encode(&d.text, "ISO-8859-1", false, Eol::Lf).unwrap(), b"caf\xE9 \x80\n");
        let d = decode(b"\xEF\xBB\xBFabc", Some("utf-8")).unwrap();
        assert!(d.bom && d.text == "abc");
        let d = decode(b"\xA4", Some("ISO-8859-15")).unwrap();
        assert_eq!(d.text, "€");
        assert_eq!(decode(b"x", Some("klingon")).unwrap_err().code, "encoding");
    }

    #[test]
    fn line_endings_detected_and_restored() {
        assert_eq!(detect_eol("a\nb\n"), (Eol::Lf, false));
        assert_eq!(detect_eol("a\r\nb\r\n"), (Eol::Crlf, false));
        assert_eq!(detect_eol("a\rb\r"), (Eol::Cr, false));
        assert_eq!(detect_eol("a\r\nb\r\nc\n"), (Eol::Crlf, true));
        assert_eq!(detect_eol("sans fin de ligne"), (Eol::platform(), false));
        let d = round_trip(b"ancien\rMac\r");
        assert_eq!((d.eol, d.text.as_str()), (Eol::Cr, "ancien\nMac\n"));
        // Fins mélangées : unifiées à l'enregistrement.
        let d = decode(b"a\r\nb\nc\r\n", None).unwrap();
        assert!(d.mixed_eol);
        assert_eq!(encode(&d.text, "UTF-8", false, d.eol).unwrap(), b"a\r\nb\r\nc\r\n");
        // Changer de fin de ligne.
        assert_eq!(encode("a\nb", "UTF-8", false, Eol::Crlf).unwrap(), b"a\r\nb");
        // Pas de dernière fin de ligne : rien n'est ajouté.
        round_trip(b"pas de fin\r\nde ligne");
    }

    #[test]
    fn unmappable_characters_are_refused() {
        let e = encode("ligne\nemoji 😀\n", "windows-1252", false, Eol::Lf).unwrap_err();
        assert_eq!((e.code, e.line, e.ch.as_deref()), ("unmappable", Some(2), Some("😀")));
        let e = encode("€", "ISO-8859-1", false, Eol::Lf).unwrap_err();
        assert_eq!(e.code, "unmappable");
        assert_eq!(encode("€", "ISO-8859-15", false, Eol::Lf).unwrap(), b"\xA4");
        assert_eq!(encode("€", "windows-1252", false, Eol::Lf).unwrap(), b"\x80");
    }

    #[test]
    fn binary_files_are_refused() {
        let png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x10";
        assert_eq!(decode(png, None).unwrap_err().code, "binary");
        let elf = b"\x7fELF\x02\x01\x01\0\0\0\0\0\0\0\0\0\x03\0>\0";
        assert_eq!(decode(elf, None).unwrap_err().code, "binary");
        assert!(looks_binary(&[1, 2, 3, 4, 5, 6, 7, b'a']));
        assert!(!looks_binary(b"texte\tavec\x1b[31mcouleurs\x1b[0m\n\x0c"));
        assert!(!looks_binary(b""));
        // Vide : texte UTF-8.
        let d = decode(b"", None).unwrap();
        assert_eq!((d.text.as_str(), d.encoding.as_str()), ("", "UTF-8"));
    }

    #[test]
    fn read_refuses_folders_large_and_missing_files() {
        let dir = tmpdir("read");
        assert_eq!(read_file(&dir, None, false).unwrap_err().code, "folder");
        assert_eq!(read_file(&dir.join("absent.txt"), None, false).unwrap_err().code, "notfound");
        let big = dir.join("gros.log");
        let f = fs::File::create(&big).unwrap();
        f.set_len(LARGE_FILE + 1).unwrap();
        let e = read_file(&big, None, false).unwrap_err();
        assert_eq!((e.code, e.size), ("large", Some(LARGE_FILE + 1)));
        // Accepté : un fichier creux est plein d'octets nuls, donc binaire.
        assert_eq!(read_file(&big, None, true).unwrap_err().code, "binary");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_then_read_round_trip() {
        let dir = tmpdir("rw");
        let p = dir.join("notes.txt");
        let st = write_file(&p, "Québec\nMontréal\n", "windows-1252", false, Eol::Crlf).unwrap();
        assert!(st.exists && st.size == 18);
        assert_eq!(fs::read(&p).unwrap(), b"Qu\xE9bec\r\nMontr\xE9al\r\n");
        let o = read_file(&p, None, false).unwrap();
        assert_eq!((o.doc.text.as_str(), o.doc.encoding.as_str(), o.doc.eol, o.readonly), ("Québec\nMontréal\n", "windows-1252", Eol::Crlf, false));
        assert_eq!(o.stat, st);
        // Aucun fichier temporaire ne reste.
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_save_keeps_permissions_and_follows_symlinks() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let dir = tmpdir("atomic");
        let p = dir.join("script.sh");
        fs::write(&p, "#!/bin/sh\necho a\n").unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(0o750)).unwrap();
        let ino = fs::metadata(&p).unwrap().ino();
        write_atomic(&p, b"#!/bin/sh\necho b\n").unwrap();
        let m = fs::metadata(&p).unwrap();
        assert_eq!(m.permissions().mode() & 0o7777, 0o750, "droits conservés");
        assert_ne!(m.ino(), ino, "remplacé par renommage (atomique)");
        assert_eq!(fs::read(&p).unwrap(), b"#!/bin/sh\necho b\n");

        // Lien symbolique : la cible est modifiée, le lien reste un lien.
        let link = dir.join("lien.sh");
        std::os::unix::fs::symlink(&p, &link).unwrap();
        write_atomic(&link, b"via le lien\n").unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(fs::read(&p).unwrap(), b"via le lien\n");

        // Liens physiques : réécrit sur place, les deux noms restent liés.
        let hard = dir.join("physique.sh");
        fs::hard_link(&p, &hard).unwrap();
        write_atomic(&p, b"partage\n").unwrap();
        assert_eq!(fs::read(&hard).unwrap(), b"partage\n");

        // Fichier en lecture seule : refusé, contenu intact.
        let ro = dir.join("lecture-seule.txt");
        fs::write(&ro, "intact").unwrap();
        fs::set_permissions(&ro, fs::Permissions::from_mode(0o444)).unwrap();
        if fs::OpenOptions::new().write(true).open(&ro).is_err() {
            // (root peut écrire partout : test sans objet)
            assert!(write_atomic(&ro, b"perdu").is_err());
            assert_eq!(fs::read(&ro).unwrap(), b"intact");
            assert!(read_file(&ro, None, false).unwrap().readonly);
        }
        let leftovers: Vec<_> = fs::read_dir(&dir).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().ends_with(".tmp")).collect();
        assert!(leftovers.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn read_only_folder_still_saves_in_place() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tmpdir("rodir");
        let p = dir.join("a.txt");
        fs::write(&p, "avant").unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap();
        let r = write_atomic(&p, b"apres");
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        r.unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"apres");
        let _ = fs::remove_dir_all(&dir);
    }
}
