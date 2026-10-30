//! AuxiSheet Lite : conversion entre le format .xlsx et le classeur
//! d'IronCalc (moteur de tableur en Rust), dans le navigateur. Le serveur
//! d'AuxiOffice Online ne fait que garder les octets du fichier : ouverture,
//! calcul et enregistrement se font chez le client.

use ironcalc::base::Model;
use wasm_bindgen::prelude::*;

fn js(e: impl ToString) -> JsValue {
    JsValue::from_str(&e.to_string())
}

/// Classeur .xlsx → octets du modèle d'IronCalc (pour `Model.fromBytes`).
/// `locale` : format des nombres et dates (`fr`, `en`…), `tz` : fuseau
/// horaire IANA, `lang` : langue des noms de fonctions.
#[wasm_bindgen]
pub fn xlsx_to_model(bytes: &[u8], name: &str, locale: &str, tz: &str, lang: &str) -> Result<Vec<u8>, JsValue> {
    let wb = ironcalc::import::load_from_xlsx_bytes(bytes, name, locale, tz).map_err(js)?;
    Ok(Model::from_workbook(wb, lang).map_err(js)?.to_bytes())
}

/// Octets du modèle d'IronCalc (`model.toBytes()`) → classeur .xlsx.
#[wasm_bindgen]
pub fn model_to_xlsx(bytes: &[u8], lang: &str) -> Result<Vec<u8>, JsValue> {
    let m = Model::from_bytes(bytes, lang).map_err(js)?;
    Ok(ironcalc::export::save_xlsx_to_writer(&m, std::io::Cursor::new(Vec::new())).map_err(js)?.into_inner())
}

/// Classeur vierge (une feuille), en octets du modèle.
#[wasm_bindgen]
pub fn new_model(name: &str, locale: &str, tz: &str, lang: &str) -> Result<Vec<u8>, JsValue> {
    Ok(Model::new_empty(name, locale, tz, lang).map_err(js)?.to_bytes())
}
