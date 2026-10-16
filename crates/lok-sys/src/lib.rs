// SPDX-License-Identifier: MPL-2.0
//
// Transcription en Rust des en-têtes C de LibreOfficeKit
// (include/LibreOfficeKit/LibreOfficeKit.h, LibreOfficeKitEnums.h,
// LibreOfficeKitInit.h de LibreOffice 26.8), sous Mozilla Public License 2.0.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//
// L'ordre des champs des tables de fonctions DOIT suivre exactement celui des
// en-têtes : LibreOffice lit ces structures par position. Attention : la partie
// « instable » de l'API change d'une version à l'autre (LibreOffice 26.8 a
// retiré sendDialogEvent et setAllowChangeComments au milieu des tables) ;
// `check_layout` refuse donc toute version dont la taille des tables diffère. Les entrées dont
// AuxiOffice ne se sert pas sont déclarées `Slot` (même taille qu'un pointeur
// de fonction) avec le nom d'origine en commentaire.

#![allow(non_camel_case_types, non_snake_case)]

use std::ffi::{c_char, c_int, c_long, c_uchar, c_ulonglong, c_void, CStr, CString};
use std::path::{Path, PathBuf};

pub type LibreOfficeKitCallback =
    unsafe extern "C" fn(n_type: c_int, payload: *const c_char, data: *mut c_void);

pub type LibreOfficeKitPollCallback = unsafe extern "C" fn(data: *mut c_void, timeout_us: c_int) -> c_int;
pub type LibreOfficeKitWakeCallback = unsafe extern "C" fn(data: *mut c_void);

/// Entrée de table non utilisée : sert uniquement à conserver la disposition.
pub type Slot = Option<unsafe extern "C" fn()>;

#[repr(C)]
pub struct LibreOfficeKit {
    pub pClass: *mut LibreOfficeKitClass,
}

#[repr(C)]
pub struct LibreOfficeKitClass {
    pub nSize: usize,
    pub destroy: Option<unsafe extern "C" fn(*mut LibreOfficeKit)>,
    pub documentLoad: Option<unsafe extern "C" fn(*mut LibreOfficeKit, *const c_char) -> *mut LibreOfficeKitDocument>,
    pub getError: Option<unsafe extern "C" fn(*mut LibreOfficeKit) -> *mut c_char>,
    pub documentLoadWithOptions: Option<
        unsafe extern "C" fn(*mut LibreOfficeKit, *const c_char, *const c_char) -> *mut LibreOfficeKitDocument,
    >,
    pub freeError: Option<unsafe extern "C" fn(*mut c_char)>,
    pub registerCallback: Option<unsafe extern "C" fn(*mut LibreOfficeKit, LibreOfficeKitCallback, *mut c_void)>,
    pub getFilterTypes: Option<unsafe extern "C" fn(*mut LibreOfficeKit) -> *mut c_char>,
    pub setOptionalFeatures: Option<unsafe extern "C" fn(*mut LibreOfficeKit, c_ulonglong)>,
    pub setDocumentPassword: Option<unsafe extern "C" fn(*mut LibreOfficeKit, *const c_char, *const c_char)>,
    pub getVersionInfo: Option<unsafe extern "C" fn(*mut LibreOfficeKit) -> *mut c_char>,
    pub runMacro: Slot,
    pub signDocument: Slot,
    pub runLoop: Option<
        unsafe extern "C" fn(*mut LibreOfficeKit, LibreOfficeKitPollCallback, LibreOfficeKitWakeCallback, *mut c_void),
    >,
    pub setOption: Option<unsafe extern "C" fn(*mut LibreOfficeKit, *const c_char, *const c_char)>,
    pub dumpState: Slot,
    pub extractRequest: Slot,
    pub trimMemory: Option<unsafe extern "C" fn(*mut LibreOfficeKit, c_int)>,
    pub startURP: Slot,
    pub stopURP: Slot,
    pub joinThreads: Slot,
    pub startThreads: Slot,
    pub setForkedChild: Slot,
    pub extractDocumentStructureRequest: Slot,
    pub registerAnyInputCallback: Slot,
    pub getDocsCount: Slot,
    pub registerFileSaveDialogCallback: Slot,
}

#[repr(C)]
pub struct LibreOfficeKitDocument {
    pub pClass: *mut LibreOfficeKitDocumentClass,
}

type Doc = *mut LibreOfficeKitDocument;

#[repr(C)]
pub struct LibreOfficeKitDocumentClass {
    pub nSize: usize,
    pub destroy: Option<unsafe extern "C" fn(Doc)>,
    pub saveAs: Option<unsafe extern "C" fn(Doc, *const c_char, *const c_char, *const c_char) -> c_int>,
    pub getDocumentType: Option<unsafe extern "C" fn(Doc) -> c_int>,
    pub getParts: Option<unsafe extern "C" fn(Doc) -> c_int>,
    pub getPartPageRectangles: Option<unsafe extern "C" fn(Doc) -> *mut c_char>,
    pub getPart: Option<unsafe extern "C" fn(Doc) -> c_int>,
    pub setPart: Option<unsafe extern "C" fn(Doc, c_int)>,
    pub getPartName: Option<unsafe extern "C" fn(Doc, c_int) -> *mut c_char>,
    pub setPartMode: Option<unsafe extern "C" fn(Doc, c_int)>,
    pub paintTile: Option<unsafe extern "C" fn(Doc, *mut c_uchar, c_int, c_int, c_int, c_int, c_int, c_int)>,
    pub getTileMode: Option<unsafe extern "C" fn(Doc) -> c_int>,
    pub getDocumentSize: Option<unsafe extern "C" fn(Doc, *mut c_long, *mut c_long)>,
    pub initializeForRendering: Option<unsafe extern "C" fn(Doc, *const c_char)>,
    pub registerCallback: Option<unsafe extern "C" fn(Doc, LibreOfficeKitCallback, *mut c_void)>,
    pub postKeyEvent: Option<unsafe extern "C" fn(Doc, c_int, c_int, c_int)>,
    pub postMouseEvent: Option<unsafe extern "C" fn(Doc, c_int, c_int, c_int, c_int, c_int, c_int)>,
    pub postUnoCommand: Option<unsafe extern "C" fn(Doc, *const c_char, *const c_char, bool)>,
    pub setTextSelection: Option<unsafe extern "C" fn(Doc, c_int, c_int, c_int)>,
    pub getTextSelection: Option<unsafe extern "C" fn(Doc, *const c_char, *mut *mut c_char) -> *mut c_char>,
    pub paste: Option<unsafe extern "C" fn(Doc, *const c_char, *const c_char, usize) -> bool>,
    pub setGraphicSelection: Option<unsafe extern "C" fn(Doc, c_int, c_int, c_int)>,
    pub resetSelection: Option<unsafe extern "C" fn(Doc)>,
    pub getCommandValues: Option<unsafe extern "C" fn(Doc, *const c_char) -> *mut c_char>,
    pub setClientZoom: Option<unsafe extern "C" fn(Doc, c_int, c_int, c_int, c_int)>,
    pub setClientVisibleArea: Option<unsafe extern "C" fn(Doc, c_int, c_int, c_int, c_int)>,
    pub createView: Option<unsafe extern "C" fn(Doc) -> c_int>,
    pub destroyView: Option<unsafe extern "C" fn(Doc, c_int)>,
    pub setView: Option<unsafe extern "C" fn(Doc, c_int)>,
    pub getView: Option<unsafe extern "C" fn(Doc) -> c_int>,
    pub getViewsCount: Option<unsafe extern "C" fn(Doc) -> c_int>,
    pub renderFont: Slot,
    pub getPartHash: Option<unsafe extern "C" fn(Doc, c_int) -> *mut c_char>,
    pub paintPartTile: Option<unsafe extern "C" fn(Doc, *mut c_uchar, c_int, c_int, c_int, c_int, c_int, c_int, c_int, c_int)>,
    pub getViewIds: Slot,
    pub setOutlineState: Slot,
    pub paintWindow: Option<unsafe extern "C" fn(Doc, u32, *mut c_uchar, c_int, c_int, c_int, c_int)>,
    pub postWindow: Option<unsafe extern "C" fn(Doc, u32, c_int, *const c_char)>,
    pub postWindowKeyEvent: Option<unsafe extern "C" fn(Doc, u32, c_int, c_int, c_int)>,
    pub postWindowMouseEvent: Option<unsafe extern "C" fn(Doc, u32, c_int, c_int, c_int, c_int, c_int, c_int)>,
    pub setViewLanguage: Option<unsafe extern "C" fn(Doc, c_int, *const c_char)>,
    pub postWindowExtTextInputEvent: Option<unsafe extern "C" fn(Doc, u32, c_int, *const c_char)>,
    pub getPartInfo: Option<unsafe extern "C" fn(Doc, c_int) -> *mut c_char>,
    pub paintWindowDPI: Option<unsafe extern "C" fn(Doc, u32, *mut c_uchar, c_int, c_int, c_int, c_int, f64)>,
    pub insertCertificate: Slot,
    pub addCertificate: Slot,
    pub getSignatureState: Slot,
    pub renderShapeSelection: Slot,
    pub postWindowGestureEvent: Slot,
    pub createViewWithOptions: Slot,
    pub selectPart: Slot,
    pub moveSelectedParts: Slot,
    pub resizeWindow: Slot,
    pub getClipboard: Slot,
    pub setClipboard: Slot,
    pub getSelectionType: Option<unsafe extern "C" fn(Doc) -> c_int>,
    pub removeTextContext: Slot,
    pub renderFontOrientation: Slot,
    pub paintWindowForView: Slot,
    pub completeFunction: Slot,
    pub setWindowTextSelection: Slot,
    pub sendFormFieldEvent: Slot,
    pub setBlockedCommandList: Slot,
    pub renderSearchResult: Slot,
    pub sendContentControlEvent: Slot,
    pub getSelectionTypeAndText: Slot,
    pub getDataArea: Slot,
    pub getEditMode: Slot,
    pub setViewTimezone: Slot,
    pub setAccessibilityState: Slot,
    pub getA11yFocusedParagraph: Slot,
    pub getA11yCaretPosition: Slot,
    pub setViewReadOnly: Slot,
    pub getPresentationInfo: Slot,
    pub createSlideRenderer: Slot,
    pub postSlideshowCleanup: Slot,
    pub renderNextSlideLayer: Slot,
    pub setViewOption: Option<unsafe extern "C" fn(Doc, *const c_char, *const c_char)>,
    pub setColorPreviewState: Slot,
}

/// Vrai si la table `class` (de taille annoncée `n_size`) contient le champ
/// situé à `offset` — équivalent de LIBREOFFICEKIT_HAS_MEMBER.
pub fn has_member(n_size: usize, offset: usize) -> bool {
    offset < n_size
}

/// Version de LibreOffice dont ces tables sont la transcription.
pub const LAYOUT_VERSION: &str = "26.8";

/// Vérifie que la table annoncée par LibreOffice (`nSize`) a exactement la
/// taille transcrite ici. Une différence signifie une autre version de
/// l'API : appeler une fonction par sa position pourrait alors en appeler une
/// autre, d'où un refus net plutôt qu'un plantage imprévisible.
pub fn check_layout(what: &str, announced: usize, expected: usize) -> Result<(), String> {
    if announced == expected || std::env::var_os("AUXI_LOK_ANY_LAYOUT").is_some() {
        Ok(())
    } else {
        Err(format!(
            "LibreOfficeKit incompatible ({what} : {announced} octets annoncés, {expected} attendus pour LibreOffice {LAYOUT_VERSION})"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const P: usize = std::mem::size_of::<usize>();

    #[test]
    fn tables_match_libreoffice_26_8() {
        // 27 et 79 entrées (nSize compris) dans les en-têtes de LibreOffice 26.8.
        assert_eq!(std::mem::size_of::<LibreOfficeKitClass>(), 27 * P);
        assert_eq!(std::mem::size_of::<LibreOfficeKitDocumentClass>(), 79 * P);
    }

    #[test]
    fn layout_check() {
        assert!(check_layout("x", 8, 8).is_ok());
        assert!(check_layout("x", 16, 8).is_err());
    }
}

// --- LibreOfficeKitEnums.h -------------------------------------------------

pub const LOK_DOCTYPE_TEXT: c_int = 0;
pub const LOK_DOCTYPE_SPREADSHEET: c_int = 1;
pub const LOK_DOCTYPE_PRESENTATION: c_int = 2;
pub const LOK_DOCTYPE_DRAWING: c_int = 3;
pub const LOK_DOCTYPE_OTHER: c_int = 4;

pub const LOK_PARTMODE_SLIDES: c_int = 0;
pub const LOK_PARTMODE_NOTES: c_int = 1;

pub const LOK_TILEMODE_RGBA: c_int = 0;
pub const LOK_TILEMODE_BGRA: c_int = 1;

pub const LOK_WINDOW_CLOSE: c_int = 0;
pub const LOK_WINDOW_PASTE: c_int = 1;

pub const LOK_SELTYPE_NONE: c_int = 0;
pub const LOK_SELTYPE_TEXT: c_int = 1;
pub const LOK_SELTYPE_COMPLEX: c_int = 3;

pub const LOK_FEATURE_DOCUMENT_PASSWORD: c_ulonglong = 1 << 0;
pub const LOK_FEATURE_DOCUMENT_PASSWORD_TO_MODIFY: c_ulonglong = 1 << 1;
pub const LOK_FEATURE_PART_IN_INVALIDATION_CALLBACK: c_ulonglong = 1 << 2;
pub const LOK_FEATURE_NO_TILED_ANNOTATIONS: c_ulonglong = 1 << 3;
pub const LOK_FEATURE_RANGE_HEADERS: c_ulonglong = 1 << 4;
pub const LOK_FEATURE_VIEWID_IN_VISCURSOR_INVALIDATION_CALLBACK: c_ulonglong = 1 << 5;

pub const LOK_CALLBACK_INVALIDATE_TILES: c_int = 0;
pub const LOK_CALLBACK_INVALIDATE_VISIBLE_CURSOR: c_int = 1;
pub const LOK_CALLBACK_TEXT_SELECTION: c_int = 2;
pub const LOK_CALLBACK_TEXT_SELECTION_START: c_int = 3;
pub const LOK_CALLBACK_TEXT_SELECTION_END: c_int = 4;
pub const LOK_CALLBACK_CURSOR_VISIBLE: c_int = 5;
pub const LOK_CALLBACK_GRAPHIC_SELECTION: c_int = 6;
pub const LOK_CALLBACK_HYPERLINK_CLICKED: c_int = 7;
pub const LOK_CALLBACK_STATE_CHANGED: c_int = 8;
pub const LOK_CALLBACK_STATUS_INDICATOR_START: c_int = 9;
pub const LOK_CALLBACK_STATUS_INDICATOR_SET_VALUE: c_int = 10;
pub const LOK_CALLBACK_STATUS_INDICATOR_FINISH: c_int = 11;
pub const LOK_CALLBACK_SEARCH_NOT_FOUND: c_int = 12;
pub const LOK_CALLBACK_DOCUMENT_SIZE_CHANGED: c_int = 13;
pub const LOK_CALLBACK_SET_PART: c_int = 14;
pub const LOK_CALLBACK_SEARCH_RESULT_SELECTION: c_int = 15;
pub const LOK_CALLBACK_UNO_COMMAND_RESULT: c_int = 16;
pub const LOK_CALLBACK_CELL_CURSOR: c_int = 17;
pub const LOK_CALLBACK_MOUSE_POINTER: c_int = 18;
pub const LOK_CALLBACK_CELL_FORMULA: c_int = 19;
pub const LOK_CALLBACK_DOCUMENT_PASSWORD: c_int = 20;
pub const LOK_CALLBACK_DOCUMENT_PASSWORD_TO_MODIFY: c_int = 21;
pub const LOK_CALLBACK_ERROR: c_int = 22;
pub const LOK_CALLBACK_CONTEXT_MENU: c_int = 23;
pub const LOK_CALLBACK_CELL_ADDRESS: c_int = 34;
pub const LOK_CALLBACK_WINDOW: c_int = 36;
pub const LOK_CALLBACK_CLIPBOARD_CHANGED: c_int = 38;
pub const LOK_CALLBACK_CONTEXT_CHANGED: c_int = 39;
pub const LOK_CALLBACK_CELL_SELECTION_AREA: c_int = 42;
pub const LOK_CALLBACK_JSDIALOG: c_int = 46;
pub const LOK_CALLBACK_INVALIDATE_SHEET_GEOMETRY: c_int = 50;
pub const LOK_CALLBACK_DOCUMENT_BACKGROUND_COLOR: c_int = 52;
pub const LOK_CALLBACK_FONTS_MISSING: c_int = 57;
pub const LOK_CALLBACK_EXPORT_FILE: c_int = 59;
pub const LOK_CALLBACK_TOOLTIP: c_int = 71;

pub const LOK_KEYEVENT_KEYINPUT: c_int = 0;
pub const LOK_KEYEVENT_KEYUP: c_int = 1;

pub const LOK_EXT_TEXTINPUT: c_int = 0;
pub const LOK_EXT_TEXTINPUT_POS: c_int = 1;
pub const LOK_EXT_TEXTINPUT_END: c_int = 2;

pub const LOK_MOUSEEVENT_MOUSEBUTTONDOWN: c_int = 0;
pub const LOK_MOUSEEVENT_MOUSEBUTTONUP: c_int = 1;
pub const LOK_MOUSEEVENT_MOUSEMOVE: c_int = 2;

pub const LOK_SETTEXTSELECTION_START: c_int = 0;
pub const LOK_SETTEXTSELECTION_END: c_int = 1;
pub const LOK_SETTEXTSELECTION_RESET: c_int = 2;

// --- Codes de touches VCL (com::sun::star::awt::Key) -----------------------

pub mod key {
    use std::ffi::c_int;
    pub const NUM0: c_int = 256;
    pub const A: c_int = 512;
    pub const F1: c_int = 768;
    pub const DOWN: c_int = 1024;
    pub const UP: c_int = 1025;
    pub const LEFT: c_int = 1026;
    pub const RIGHT: c_int = 1027;
    pub const HOME: c_int = 1028;
    pub const END: c_int = 1029;
    pub const PAGEUP: c_int = 1030;
    pub const PAGEDOWN: c_int = 1031;
    pub const RETURN: c_int = 1280;
    pub const ESCAPE: c_int = 1281;
    pub const TAB: c_int = 1282;
    pub const BACKSPACE: c_int = 1283;
    pub const SPACE: c_int = 1284;
    pub const INSERT: c_int = 1285;
    pub const DELETE: c_int = 1286;
    pub const SHIFT: c_int = 0x1000;
    pub const MOD1: c_int = 0x2000; // Ctrl (Cmd sous macOS)
    pub const MOD2: c_int = 0x4000; // Alt
    pub const MOD3: c_int = 0x8000; // Ctrl sous macOS
}

pub const MOUSE_LEFT: c_int = 1;
pub const MOUSE_MIDDLE: c_int = 2;
pub const MOUSE_RIGHT: c_int = 4;

// --- LibreOfficeKitInit.h ----------------------------------------------------

#[cfg(target_os = "windows")]
const TARGET_LIBS: [&str; 2] = ["sofficeapp.dll", "mergedlo.dll"];
#[cfg(target_os = "macos")]
const TARGET_LIBS: [&str; 2] = ["libsofficeapp.dylib", "libmergedlo.dylib"];
#[cfg(all(unix, not(target_os = "macos")))]
const TARGET_LIBS: [&str; 2] = ["libsofficeapp.so", "libmergedlo.so"];

type HookFn2 = unsafe extern "C" fn(*const c_char, *const c_char) -> *mut LibreOfficeKit;

/// Bibliothèque LibreOffice chargée ; doit vivre aussi longtemps que l'instance.
pub struct Loaded {
    pub lib: libloading::Library,
    pub path: PathBuf,
}

/// Équivalent de `lok_init_2` : charge le moteur depuis `program_dir` (le
/// dossier `program/` de LibreOffice) et retourne l'instance LibreOfficeKit.
///
/// # Safety
/// N'appeler qu'une fois par processus ; LibreOffice n'est pas réentrant.
pub unsafe fn lok_init_2(
    program_dir: &Path,
    user_profile_url: Option<&str>,
) -> Result<(Loaded, *mut LibreOfficeKit), String> {
    let mut last_err = String::from("aucune bibliothèque LibreOffice trouvée");
    for name in TARGET_LIBS {
        let path = program_dir.join(name);
        if !path.exists() {
            continue;
        }
        let lib = match open_library(&path) {
            Ok(lib) => lib,
            Err(e) => {
                last_err = format!("{}: {e}", path.display());
                continue;
            }
        };
        let hook: libloading::Symbol<HookFn2> = match lib.get(b"libreofficekit_hook_2\0") {
            Ok(h) => h,
            Err(e) => return Err(format!("{}: libreofficekit_hook_2 introuvable: {e}", path.display())),
        };
        let install = CString::new(program_dir.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
        let profile = user_profile_url.map(|u| CString::new(u).unwrap());
        let kit = hook(install.as_ptr(), profile.as_ref().map_or(std::ptr::null(), |p| p.as_ptr()));
        if kit.is_null() {
            return Err(format!("{}: initialisation de LibreOfficeKit refusée", path.display()));
        }
        return Ok((Loaded { lib, path }, kit));
    }
    Err(last_err)
}

#[cfg(unix)]
unsafe fn open_library(path: &Path) -> Result<libloading::Library, libloading::Error> {
    // RTLD_LAZY comme lok_loadlib ; RTLD_GLOBAL pour les composants UNO
    // chargés ensuite par LibreOffice.
    libloading::os::unix::Library::open(Some(path), libc_flags()).map(Into::into)
}

#[cfg(unix)]
fn libc_flags() -> std::ffi::c_int {
    libloading::os::unix::RTLD_LAZY | libloading::os::unix::RTLD_GLOBAL
}

#[cfg(windows)]
unsafe fn open_library(path: &Path) -> Result<libloading::Library, libloading::Error> {
    // LibreOffice charge ses DLL sœurs depuis program/ : rechercher d'abord là.
    use libloading::os::windows::{Library, LOAD_LIBRARY_SEARCH_DEFAULT_DIRS, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR};
    Library::load_with_flags(path, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS)
        .map(Into::into)
}

/// Copie une chaîne C allouée par LibreOffice puis la libère avec `free()`,
/// comme l'exige l'API (les chaînes retournées sont allouées par malloc).
///
/// # Safety
/// `p` doit être nul ou une chaîne allouée par LibreOffice.
pub unsafe fn take_string(p: *mut c_char) -> Option<String> {
    if p.is_null() {
        return None;
    }
    let s = CStr::from_ptr(p).to_string_lossy().into_owned();
    libc_free(p as *mut c_void);
    Some(s)
}

extern "C" {
    #[link_name = "free"]
    fn libc_free(p: *mut c_void);
}
