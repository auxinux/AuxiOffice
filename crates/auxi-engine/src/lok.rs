//! Enveloppe sûre autour de LibreOfficeKit. Utilisée uniquement dans le
//! processus `auxi-engine` : un seul `Office` par processus, et tous les
//! appels se font depuis le même fil.

use lok_sys as sys;
use std::ffi::{c_char, c_int, c_long, c_void, CStr, CString};
use std::path::Path;

pub type CallbackFn = Box<dyn Fn(i32, String) + Send + Sync>;

pub struct Office {
    kit: *mut sys::LibreOfficeKit,
    _lib: sys::Loaded,
    callback: Option<Box<CallbackFn>>,
}

pub struct Document {
    doc: *mut sys::LibreOfficeKitDocument,
    callback: Option<Box<CallbackFn>>,
}

fn cstr(s: &str) -> CString {
    CString::new(s.replace('\0', "")).unwrap()
}

unsafe extern "C" fn trampoline(n_type: c_int, payload: *const c_char, data: *mut c_void) {
    let cb = &*(data as *const CallbackFn);
    let text = if payload.is_null() {
        String::new()
    } else {
        CStr::from_ptr(payload).to_string_lossy().into_owned()
    };
    cb(n_type, text);
}

macro_rules! call {
    ($self:ident . $ptr:ident, $f:ident ( $($arg:expr),* )) => {{
        let class = &*(*$self.$ptr).pClass;
        match class.$f {
            Some(f) => Ok(f($self.$ptr $(, $arg)*)),
            None => Err(concat!("fonction LibreOfficeKit absente : ", stringify!($f)).to_string()),
        }
    }};
}

impl Office {
    /// Démarre LibreOffice depuis son dossier `program/`.
    pub fn init(program_dir: &Path, profile_url: Option<&str>) -> Result<Office, String> {
        let (lib, kit) = unsafe { sys::lok_init_2(program_dir, profile_url)? };
        let announced = unsafe { (*(*kit).pClass).nSize };
        sys::check_layout("LibreOfficeKitClass", announced, std::mem::size_of::<sys::LibreOfficeKitClass>())?;
        Ok(Office { kit, _lib: lib, callback: None })
    }

    pub fn raw(&self) -> *mut sys::LibreOfficeKit {
        self.kit
    }

    pub fn version_info(&self) -> Option<String> {
        unsafe { call!(self.kit, getVersionInfo()).ok().and_then(|p| sys::take_string(p)) }
    }

    pub fn set_optional_features(&self, features: u64) {
        unsafe {
            let _ = call!(self.kit, setOptionalFeatures(features));
        }
    }

    pub fn set_option(&self, name: &str, value: &str) {
        let (n, v) = (cstr(name), cstr(value));
        unsafe {
            let _ = call!(self.kit, setOption(n.as_ptr(), v.as_ptr()));
        }
    }

    pub fn register_callback(&mut self, cb: CallbackFn) {
        let boxed = Box::new(cb);
        let data = &*boxed as *const CallbackFn as *mut c_void;
        unsafe {
            let _ = call!(self.kit, registerCallback(trampoline, data));
        }
        self.callback = Some(boxed);
    }

    pub fn set_document_password(&self, url: &str, password: Option<&str>) {
        let u = cstr(url);
        let p = password.map(cstr);
        unsafe {
            let _ = call!(self.kit, setDocumentPassword(u.as_ptr(), p.as_ref().map_or(std::ptr::null(), |p| p.as_ptr())));
        }
    }

    fn error(&self) -> String {
        unsafe {
            let class = &*(*self.kit).pClass;
            let p = class.getError.map(|f| f(self.kit)).unwrap_or(std::ptr::null_mut());
            if p.is_null() {
                return "erreur inconnue".into();
            }
            let s = CStr::from_ptr(p).to_string_lossy().into_owned();
            if let Some(free) = class.freeError {
                free(p);
            }
            s
        }
    }

    pub fn load(&self, url: &str, options: &str) -> Result<Document, String> {
        let (u, o) = (cstr(url), cstr(options));
        let doc = unsafe { call!(self.kit, documentLoadWithOptions(u.as_ptr(), o.as_ptr()))? };
        if doc.is_null() {
            return Err(self.error());
        }
        let announced = unsafe { (*(*doc).pClass).nSize };
        let document = Document { doc, callback: None };
        sys::check_layout("LibreOfficeKitDocumentClass", announced, std::mem::size_of::<sys::LibreOfficeKitDocumentClass>())?;
        Ok(document)
    }
}

impl Document {
    pub fn doc_type(&self) -> i32 {
        unsafe { call!(self.doc, getDocumentType()).unwrap_or(sys::LOK_DOCTYPE_OTHER) }
    }

    pub fn parts(&self) -> i32 {
        unsafe { call!(self.doc, getParts()).unwrap_or(1) }
    }

    pub fn part(&self) -> i32 {
        unsafe { call!(self.doc, getPart()).unwrap_or(0) }
    }

    pub fn set_part(&self, part: i32) {
        unsafe {
            let _ = call!(self.doc, setPart(part));
        }
    }

    pub fn part_name(&self, part: i32) -> String {
        unsafe { call!(self.doc, getPartName(part)).ok().and_then(|p| sys::take_string(p)).unwrap_or_default() }
    }

    pub fn part_hash(&self, part: i32) -> String {
        unsafe { call!(self.doc, getPartHash(part)).ok().and_then(|p| sys::take_string(p)).unwrap_or_default() }
    }

    pub fn part_info(&self, part: i32) -> Option<String> {
        unsafe { call!(self.doc, getPartInfo(part)).ok().and_then(|p| sys::take_string(p)) }
    }

    pub fn page_rectangles(&self) -> Option<String> {
        unsafe { call!(self.doc, getPartPageRectangles()).ok().and_then(|p| sys::take_string(p)) }
    }

    pub fn set_part_mode(&self, mode: i32) {
        unsafe {
            let _ = call!(self.doc, setPartMode(mode));
        }
    }

    /// Taille du document (ou de la partie active) en twips.
    pub fn size(&self) -> (i64, i64) {
        let (mut w, mut h): (c_long, c_long) = (0, 0);
        unsafe {
            let _ = call!(self.doc, getDocumentSize(&mut w, &mut h));
        }
        // `long` vaut 32 bits sous Windows, 64 bits ailleurs.
        #[allow(clippy::useless_conversion)]
        (i64::from(w), i64::from(h))
    }

    pub fn initialize_for_rendering(&self, args: &str) {
        let a = cstr(args);
        unsafe {
            let _ = call!(self.doc, initializeForRendering(a.as_ptr()));
        }
    }

    pub fn register_callback(&mut self, cb: CallbackFn) {
        let boxed = Box::new(cb);
        let data = &*boxed as *const CallbackFn as *mut c_void;
        unsafe {
            let _ = call!(self.doc, registerCallback(trampoline, data));
        }
        self.callback = Some(boxed);
    }

    pub fn tile_mode(&self) -> i32 {
        unsafe { call!(self.doc, getTileMode()).unwrap_or(sys::LOK_TILEMODE_BGRA) }
    }

    /// Dessine la zone (`x`, `y`, `w`, `h` en twips) dans une image de
    /// `px_w` × `px_h` pixels, retournée en RGBA non prémultiplié.
    pub fn paint(&self, px_w: i32, px_h: i32, x: i32, y: i32, w: i32, h: i32) -> Vec<u8> {
        let mut buf = vec![0u8; (px_w.max(0) * px_h.max(0) * 4) as usize];
        unsafe {
            let _ = call!(self.doc, paintTile(buf.as_mut_ptr(), px_w, px_h, x, y, w, h));
        }
        to_straight_rgba(&mut buf, self.tile_mode() == sys::LOK_TILEMODE_BGRA);
        buf
    }

    /// Comme `paint`, pour une partie précise (miniatures de diapositives).
    #[allow(clippy::too_many_arguments)]
    pub fn paint_part(&self, part: i32, px_w: i32, px_h: i32, x: i32, y: i32, w: i32, h: i32) -> Vec<u8> {
        let mut buf = vec![0u8; (px_w.max(0) * px_h.max(0) * 4) as usize];
        unsafe {
            let _ = call!(self.doc, paintPartTile(buf.as_mut_ptr(), part, 0, px_w, px_h, x, y, w, h));
        }
        to_straight_rgba(&mut buf, self.tile_mode() == sys::LOK_TILEMODE_BGRA);
        buf
    }

    pub fn post_key(&self, kind: i32, char_code: i32, key_code: i32) {
        unsafe {
            let _ = call!(self.doc, postKeyEvent(kind, char_code, key_code));
        }
    }

    /// Saisie de texte composée (méthodes de saisie, caractères hors clavier).
    pub fn post_text(&self, kind: i32, text: &str) {
        let t = cstr(text);
        unsafe {
            let _ = call!(self.doc, postWindowExtTextInputEvent(0, kind, t.as_ptr()));
        }
    }

    pub fn post_mouse(&self, kind: i32, x: i32, y: i32, count: i32, buttons: i32, mods: i32) {
        unsafe {
            let _ = call!(self.doc, postMouseEvent(kind, x, y, count, buttons, mods));
        }
    }

    pub fn uno(&self, command: &str, args: Option<&str>, notify: bool) {
        let c = cstr(command);
        let a = args.map(cstr);
        unsafe {
            let _ = call!(self.doc, postUnoCommand(c.as_ptr(), a.as_ref().map_or(std::ptr::null(), |a| a.as_ptr()), notify));
        }
    }

    pub fn command_values(&self, command: &str) -> Option<String> {
        let c = cstr(command);
        unsafe { call!(self.doc, getCommandValues(c.as_ptr())).ok().and_then(|p| sys::take_string(p)) }
    }

    pub fn text_selection(&self, mime: &str) -> Option<String> {
        let m = cstr(mime);
        let mut used: *mut c_char = std::ptr::null_mut();
        unsafe {
            let r = call!(self.doc, getTextSelection(m.as_ptr(), &mut used)).ok().and_then(|p| sys::take_string(p));
            sys::take_string(used);
            r
        }
    }

    pub fn paste(&self, mime: &str, data: &[u8]) -> bool {
        let m = cstr(mime);
        unsafe { call!(self.doc, paste(m.as_ptr(), data.as_ptr() as *const c_char, data.len())).unwrap_or(false) }
    }

    pub fn set_text_selection(&self, kind: i32, x: i32, y: i32) {
        unsafe {
            let _ = call!(self.doc, setTextSelection(kind, x, y));
        }
    }

    pub fn set_graphic_selection(&self, kind: i32, x: i32, y: i32) {
        unsafe {
            let _ = call!(self.doc, setGraphicSelection(kind, x, y));
        }
    }

    pub fn reset_selection(&self) {
        unsafe {
            let _ = call!(self.doc, resetSelection());
        }
    }

    pub fn selection_type(&self) -> i32 {
        unsafe { call!(self.doc, getSelectionType()).unwrap_or(sys::LOK_SELTYPE_NONE) }
    }

    pub fn set_client_zoom(&self, tile_px_w: i32, tile_px_h: i32, tile_twip_w: i32, tile_twip_h: i32) {
        unsafe {
            let _ = call!(self.doc, setClientZoom(tile_px_w, tile_px_h, tile_twip_w, tile_twip_h));
        }
    }

    pub fn set_client_visible_area(&self, x: i32, y: i32, w: i32, h: i32) {
        unsafe {
            let _ = call!(self.doc, setClientVisibleArea(x, y, w, h));
        }
    }

    pub fn set_view_language(&self, lang: &str) {
        let l = cstr(lang);
        unsafe {
            let view = call!(self.doc, getView()).unwrap_or(0);
            let _ = call!(self.doc, setViewLanguage(view, l.as_ptr()));
        }
    }

    pub fn save_as(&self, url: &str, format: Option<&str>, filter: Option<&str>) -> Result<(), String> {
        let u = cstr(url);
        let f = format.map(cstr);
        let o = filter.map(cstr);
        let ok = unsafe {
            call!(
                self.doc,
                saveAs(
                    u.as_ptr(),
                    f.as_ref().map_or(std::ptr::null(), |f| f.as_ptr()),
                    o.as_ref().map_or(std::ptr::null(), |o| o.as_ptr())
                )
            )?
        };
        if ok != 0 {
            Ok(())
        } else {
            Err(format!("échec de l'enregistrement vers {url}"))
        }
    }
}

impl Drop for Document {
    fn drop(&mut self) {
        unsafe {
            let _ = call!(self.doc, destroy());
        }
    }
}

/// Convertit en place un tampon BGRA/RGBA prémultiplié en RGBA non
/// prémultiplié (format attendu par `ImageData` côté interface).
pub fn to_straight_rgba(buf: &mut [u8], bgra: bool) {
    for px in buf.chunks_exact_mut(4) {
        if bgra {
            px.swap(0, 2);
        }
        let a = px[3] as u32;
        if a != 0 && a != 255 {
            for c in &mut px[..3] {
                *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::to_straight_rgba;

    #[test]
    fn converts_bgra_premultiplied() {
        let mut px = vec![10, 20, 30, 255, 0, 0, 64, 128, 0, 0, 0, 0];
        to_straight_rgba(&mut px, true);
        assert_eq!(&px[..4], &[30, 20, 10, 255]);
        assert_eq!(&px[4..8], &[128, 0, 0, 128]);
        assert_eq!(&px[8..], &[0, 0, 0, 0]);
    }
}
