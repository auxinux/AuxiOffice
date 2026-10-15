//! Protocole entre AuxiOffice et le processus `auxi-engine`.
//!
//! Chaque message est une trame :
//! `[u32 LE longueur JSON][u32 LE longueur binaire][JSON UTF-8][octets]`.
//! Le JSON porte la commande, la réponse ou l'événement ; la partie binaire
//! transporte les pixels des tuiles (RGBA) sans encodage intermédiaire.
//!
//! Requête  : `{"id": 7, "cmd": "paint", ...}`
//! Réponse  : `{"id": 7, "ok": true, ...}` ou `{"id": 7, "ok": false, "error": "..."}`
//! Événement: `{"event": "callback", "type": 0, "name": "invalidate_tiles", "payload": "..."}`

use std::io::{self, Read, Write};

/// Trame maximale acceptée (garde-fou contre un flux corrompu).
const MAX_FRAME: u32 = 512 * 1024 * 1024;

pub struct Frame {
    pub json: serde_json::Value,
    pub bin: Vec<u8>,
}

pub fn write_frame(w: &mut impl Write, json: &serde_json::Value, bin: &[u8]) -> io::Result<()> {
    let text = serde_json::to_vec(json)?;
    let mut head = [0u8; 8];
    head[..4].copy_from_slice(&(text.len() as u32).to_le_bytes());
    head[4..].copy_from_slice(&(bin.len() as u32).to_le_bytes());
    w.write_all(&head)?;
    w.write_all(&text)?;
    w.write_all(bin)?;
    w.flush()
}

/// Lit une trame ; `Ok(None)` en fin de flux propre.
pub fn read_frame(r: &mut impl Read) -> io::Result<Option<Frame>> {
    let mut head = [0u8; 8];
    match r.read_exact(&mut head) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let jlen = u32::from_le_bytes(head[..4].try_into().unwrap());
    let blen = u32::from_le_bytes(head[4..].try_into().unwrap());
    if jlen > MAX_FRAME || blen > MAX_FRAME {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "trame trop grande"));
    }
    let mut text = vec![0u8; jlen as usize];
    r.read_exact(&mut text)?;
    let mut bin = vec![0u8; blen as usize];
    r.read_exact(&mut bin)?;
    let json = serde_json::from_slice(&text).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    Ok(Some(Frame { json, bin }))
}

/// Nom lisible d'un type de rappel LibreOfficeKit (pour l'interface et les journaux).
pub fn callback_name(t: i32) -> &'static str {
    match t {
        0 => "invalidate_tiles",
        1 => "invalidate_visible_cursor",
        2 => "text_selection",
        3 => "text_selection_start",
        4 => "text_selection_end",
        5 => "cursor_visible",
        6 => "graphic_selection",
        7 => "hyperlink_clicked",
        8 => "state_changed",
        9 => "status_indicator_start",
        10 => "status_indicator_set_value",
        11 => "status_indicator_finish",
        12 => "search_not_found",
        13 => "document_size_changed",
        14 => "set_part",
        15 => "search_result_selection",
        16 => "uno_command_result",
        17 => "cell_cursor",
        18 => "mouse_pointer",
        19 => "cell_formula",
        20 => "document_password",
        21 => "document_password_to_modify",
        22 => "error",
        23 => "context_menu",
        34 => "cell_address",
        36 => "window",
        38 => "clipboard_changed",
        39 => "context_changed",
        42 => "cell_selection_area",
        46 => "jsdialog",
        50 => "invalidate_sheet_geometry",
        52 => "document_background_color",
        57 => "fonts_missing",
        59 => "export_file",
        71 => "tooltip",
        _ => "other",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_round_trip() {
        let mut buf = Vec::new();
        let j = serde_json::json!({"id": 3, "cmd": "paint", "texte": "éàç"});
        write_frame(&mut buf, &j, &[1, 2, 3, 4]).unwrap();
        write_frame(&mut buf, &serde_json::json!({"id": 4}), &[]).unwrap();
        let mut r = &buf[..];
        let f = read_frame(&mut r).unwrap().unwrap();
        assert_eq!(f.json, j);
        assert_eq!(f.bin, vec![1, 2, 3, 4]);
        let f = read_frame(&mut r).unwrap().unwrap();
        assert_eq!(f.json["id"], 4);
        assert!(read_frame(&mut r).unwrap().is_none());
    }

    #[test]
    fn rejects_oversized_frame() {
        let mut buf = Vec::new();
        buf.extend_from_slice(&u32::MAX.to_le_bytes());
        buf.extend_from_slice(&0u32.to_le_bytes());
        assert!(read_frame(&mut &buf[..]).is_err());
    }
}
