//! Mot de passe des PDF (`lopdf`) : l'édition travaille sur le document déchiffré
//! en mémoire ; l'enregistrement le chiffre de nouveau (AES-256).

use lopdf::encryption::crypt_filters::{Aes256CryptFilter, CryptFilter};
use lopdf::{Document, EncryptionState, EncryptionVersion, Permissions};
use std::collections::BTreeMap;
use std::sync::Arc;

fn to_bytes(doc: &mut Document) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    doc.save_to(&mut out).map_err(|e| format!("écriture du PDF impossible : {e}"))?;
    Ok(out)
}

/// Retire le chiffrement. Un mauvais mot de passe est une erreur.
pub fn decrypt(bytes: &[u8], password: &str) -> Result<Vec<u8>, String> {
    let mut doc = Document::load_mem_with_options(bytes, lopdf::LoadOptions::with_password(password)).map_err(|e| format!("déchiffrement impossible : {e}"))?;
    if doc.is_encrypted() {
        doc.decrypt(password).map_err(|e| format!("déchiffrement impossible : {e}"))?;
    }
    if let Some(id) = doc.trailer.remove(b"Encrypt").and_then(|o| o.as_reference().ok()) {
        doc.objects.remove(&id);
    }
    doc.encryption_state = None;
    to_bytes(&mut doc)
}

/// Chiffre en AES-256 avec tous les droits : le mot de passe sert à l'ouverture.
pub fn encrypt(bytes: &[u8], password: &str) -> Result<Vec<u8>, String> {
    if password.is_empty() {
        return Err("mot de passe vide".into());
    }
    let mut doc = Document::load_mem(bytes).map_err(|e| format!("lecture du PDF impossible : {e}"))?;
    if doc.is_encrypted() {
        return Err("ce PDF est déjà chiffré".into());
    }
    let mut key = [0u8; 32];
    getrandom::fill(&mut key).map_err(|e| e.to_string())?;
    let filter: Arc<dyn CryptFilter> = Arc::new(Aes256CryptFilter);
    let state = EncryptionState::try_from(EncryptionVersion::V5 {
        encrypt_metadata: true,
        crypt_filters: BTreeMap::from([(b"StdCF".to_vec(), filter)]),
        file_encryption_key: &key,
        stream_filter: b"StdCF".to_vec(),
        string_filter: b"StdCF".to_vec(),
        owner_password: password,
        user_password: password,
        permissions: Permissions::all(),
    })
    .map_err(|e| format!("chiffrement impossible : {e}"))?;
    doc.encrypt(&state).map_err(|e| format!("chiffrement impossible : {e}"))?;
    to_bytes(&mut doc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::content::{Content, Operation};
    use lopdf::{dictionary, Object, Stream};

    fn sample() -> Vec<u8> {
        let mut doc = Document::with_version("1.7");
        let pages = doc.new_object_id();
        let content = Content { operations: vec![Operation::new("BT", vec![]), Operation::new("ET", vec![])] };
        let c = doc.add_object(Stream::new(dictionary! {}, content.encode().unwrap()));
        let page = doc.add_object(dictionary! { "Type" => "Page", "Parent" => pages, "Contents" => c, "MediaBox" => vec![0.into(), 0.into(), 100.into(), 100.into()] });
        doc.objects.insert(pages, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => vec![page.into()], "Count" => 1 }));
        let cat = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
        doc.trailer.set("Root", cat);
        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    }

    #[test]
    fn aller_retour() {
        let enc = encrypt(&sample(), "sécret").unwrap();
        assert!(enc.windows(8).any(|w| w == b"/Encrypt"));
        assert!(decrypt(&enc, "mauvais").is_err(), "mauvais mot de passe refusé");
        let dec = decrypt(&enc, "sécret").unwrap();
        assert!(!dec.windows(8).any(|w| w == b"/Encrypt"), "plus de chiffrement");
        assert_eq!(Document::load_mem(&dec).unwrap().get_pages().len(), 1);
    }

    #[test]
    fn mot_de_passe_vide_refuse() {
        assert!(encrypt(&sample(), "").is_err());
    }
}
