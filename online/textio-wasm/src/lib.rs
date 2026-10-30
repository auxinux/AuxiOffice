//! Encodages d'AuxiText dans le navigateur : le même code Rust que
//! l'application de bureau (`text/src-tauri/src/textio.rs`), compilé en
//! WebAssembly. Le serveur d'AuxiOffice Online ne fait que garder les octets
//! du fichier : détection, décodage et encodage se font chez le client.

#[allow(dead_code)]
#[path = "../../../text/src-tauri/src/textio.rs"]
mod textio;

use wasm_bindgen::prelude::*;

/// Erreur au format de l'interface (`{code, message, …}`), en JSON.
fn err(e: textio::TextError) -> JsValue {
    JsValue::from_str(&serde_json::to_string(&e).unwrap_or_default())
}

/// Décode les octets d'un fichier ; retourne `Decoded` en JSON.
/// `forced` : encodage choisi par l'utilisateur (vide : détection).
#[wasm_bindgen]
pub fn decode(bytes: &[u8], forced: &str) -> Result<String, JsValue> {
    let forced = (!forced.is_empty()).then_some(forced);
    textio::decode(bytes, forced).map(|d| serde_json::to_string(&d).unwrap_or_default()).map_err(err)
}

/// Encode le texte pour l'enregistrement ; `eol` : `lf`, `crlf` ou `cr`.
#[wasm_bindgen]
pub fn encode(text: &str, encoding: &str, bom: bool, eol: &str) -> Result<Vec<u8>, JsValue> {
    let eol = match eol {
        "crlf" => textio::Eol::Crlf,
        "cr" => textio::Eol::Cr,
        _ => textio::Eol::Lf,
    };
    textio::encode(text, encoding, bom, eol).map_err(err)
}

/// Taille au-delà de laquelle l'ouverture demande confirmation.
#[wasm_bindgen]
pub fn large_file() -> f64 {
    textio::LARGE_FILE as f64
}

/// Taille au-delà de laquelle l'ouverture est refusée.
#[wasm_bindgen]
pub fn max_file() -> f64 {
    textio::MAX_FILE as f64
}

#[cfg(test)]
mod tests {
    #[test]
    fn aller_retour() {
        let d = super::textio::decode("Été\r\n".as_bytes(), None).unwrap();
        assert_eq!(d.text, "Été\n");
        let b = super::textio::encode(&d.text, "windows-1252", false, super::textio::Eol::Crlf).unwrap();
        assert_eq!(b, b"\xc9t\xe9\r\n");
    }
}
