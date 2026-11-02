//! Thème clair ou sombre du bureau. La page web a `prefers-color-scheme`,
//! mais WebKitGTK ne le déduit que du thème GTK ; sous KDE Plasma le choix
//! est dans `kdeglobals`. On regarde, dans l'ordre :
//!
//! 1. `GTK_THEME` (AuxiNuxOS y recopie le choix du bureau) : `Breeze:dark`, `Adwaita-dark`… ;
//! 2. sous KDE, `~/.config/kdeglobals` : nom du jeu de couleurs ou couleur de fond des fenêtres ;
//! 3. `gsettings` : `color-scheme` (`prefer-dark`), puis le nom du thème GTK.
//!
//! Sans réponse, l'interface garde `prefers-color-scheme`.

use std::path::PathBuf;
use std::process::Command;

/// Vrai si le nom d'un thème GTK désigne une variante sombre.
pub fn gtk_theme_is_dark(name: &str) -> bool {
    // `Breeze:dark`, `Adwaita-dark`, `Breeze-Dark`, `Arc-Dark-solid`…
    name.to_ascii_lowercase().contains("dark")
}

/// `kdeglobals` : sombre, clair, ou inconnu.
pub fn kdeglobals_is_dark(text: &str) -> Option<bool> {
    let mut section = String::new();
    let mut scheme: Option<String> = None;
    let mut window_bg: Option<(u32, u32, u32)> = None;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            section = line.to_string();
            continue;
        }
        let Some((k, v)) = line.split_once('=') else { continue };
        let (k, v) = (k.trim(), v.trim());
        if section == "[General]" && k == "ColorScheme" {
            scheme = Some(v.to_string());
        } else if section == "[Colors:Window]" && k == "BackgroundNormal" {
            let c: Vec<u32> = v.split(',').filter_map(|x| x.trim().parse().ok()).collect();
            if c.len() >= 3 {
                window_bg = Some((c[0], c[1], c[2]));
            }
        }
    }
    // La couleur réelle prime : un jeu de couleurs personnalisé peut avoir n'importe quel nom.
    if let Some((r, g, b)) = window_bg {
        let luma = 0.299 * r as f64 + 0.587 * g as f64 + 0.114 * b as f64;
        return Some(luma < 128.0);
    }
    scheme.map(|s| s.to_ascii_lowercase().contains("dark"))
}

fn config_home() -> Option<PathBuf> {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
}

fn gsettings(key: &str) -> Option<String> {
    let out = Command::new("gsettings").args(["get", "org.gnome.desktop.interface", key]).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().trim_matches('\'').to_string())
}

/// `Some(true)` : sombre ; `Some(false)` : clair ; `None` : inconnu.
pub fn system_is_dark() -> Option<bool> {
    if cfg!(not(target_os = "linux")) {
        return None;
    }
    if let Ok(t) = std::env::var("GTK_THEME") {
        if !t.trim().is_empty() {
            return Some(gtk_theme_is_dark(&t));
        }
    }
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().to_ascii_uppercase();
    if desktop.contains("KDE") {
        if let Some(d) = config_home().and_then(|c| std::fs::read_to_string(c.join("kdeglobals")).ok()).and_then(|t| kdeglobals_is_dark(&t)) {
            return Some(d);
        }
    }
    match gsettings("color-scheme").as_deref() {
        Some("prefer-dark") => return Some(true),
        Some("prefer-light") => return Some(false),
        _ => {}
    }
    gsettings("gtk-theme").filter(|t| !t.is_empty()).map(|t| gtk_theme_is_dark(&t))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gtk_theme_names() {
        assert!(gtk_theme_is_dark("Breeze:dark"));
        assert!(gtk_theme_is_dark("Adwaita-dark"));
        assert!(gtk_theme_is_dark("'Breeze-Dark'"));
        assert!(!gtk_theme_is_dark("Breeze"));
        assert!(!gtk_theme_is_dark("Adwaita"));
    }

    #[test]
    fn kde_color_scheme() {
        assert_eq!(kdeglobals_is_dark("[General]\nColorScheme=BreezeDark\n"), Some(true));
        assert_eq!(kdeglobals_is_dark("[General]\nColorScheme=BreezeLight\n"), Some(false));
        let custom = "[General]\nColorScheme=Mon thème\n\n[Colors:Window]\nBackgroundNormal=32,35,38\n";
        assert_eq!(kdeglobals_is_dark(custom), Some(true));
        assert_eq!(kdeglobals_is_dark("[Colors:Window]\nBackgroundNormal=239,240,241\n"), Some(false));
        assert_eq!(kdeglobals_is_dark("[KDE]\nSingleClick=false\n"), None);
    }
}
