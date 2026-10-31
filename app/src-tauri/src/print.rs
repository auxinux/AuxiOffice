//! Impression : le document est exporté en PDF par le moteur, puis envoyé au
//! service d'impression du système (CUPS, `lp`, présent sous macOS et Linux),
//! ou ouvert dans l'aperçu du système (qui a sa propre boîte d'impression).

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Serialize)]
pub struct Printer {
    pub name: String,
    pub default: bool,
}

#[derive(Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrintOptions {
    pub printer: String,
    pub copies: u32,
    /// « one-sided », « two-sided-long-edge », « two-sided-short-edge ».
    pub sides: String,
    pub monochrome: bool,
}

/// Arguments de `lp` pour un fichier PDF.
pub fn lp_args(file: &Path, o: &PrintOptions) -> Result<Vec<String>, String> {
    if o.printer.is_empty() || o.printer.starts_with('-') || o.printer.contains(char::is_whitespace) {
        return Err("imprimante invalide".into());
    }
    if !(1..=999).contains(&o.copies) {
        return Err("nombre de copies invalide".into());
    }
    let sides = match o.sides.as_str() {
        "one-sided" | "two-sided-long-edge" | "two-sided-short-edge" => o.sides.clone(),
        _ => return Err("recto verso invalide".into()),
    };
    let mut args = vec!["-d".into(), o.printer.clone(), "-n".into(), o.copies.to_string(), "-o".into(), format!("sides={sides}")];
    if o.monochrome {
        args.push("-o".into());
        args.push("print-color-mode=monochrome".into());
    }
    args.push("-t".into());
    args.push(file.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "AuxiOffice".into()));
    args.push("--".into());
    args.push(file.to_string_lossy().into_owned());
    Ok(args)
}

/// Imprimantes connues de CUPS (`lpstat -e`, imprimante par défaut `lpstat -d`).
pub fn list_printers() -> Vec<Printer> {
    let run = |args: &[&str]| -> String {
        Command::new("lpstat").args(args).env("LC_ALL", "C").output().ok().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default()
    };
    let default = run(&["-d"]).split(':').nth(1).map(|s| s.trim().to_string()).unwrap_or_default();
    run(&["-e"])
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(|name| Printer { default: name == default, name: name.to_string() })
        .collect()
}

/// Envoie le PDF à l'imprimante ; retourne la réponse de `lp` (numéro de tâche).
pub fn print_pdf(file: &Path, o: &PrintOptions) -> Result<String, String> {
    let out = Command::new("lp").args(lp_args(file, o)?).output().map_err(|e| format!("service d'impression indisponible ({e})"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Arguments de `lp` pour certaines pages d'un PDF (`-P 1-3,5` ; vide = toutes).
pub fn lp_args_pages(file: &Path, pages: &str, o: &PrintOptions) -> Result<Vec<String>, String> {
    let mut args = lp_args(file, o)?;
    let pages: String = pages.chars().filter(|c| !c.is_whitespace()).map(|c| if c == ';' { ',' } else { c }).collect();
    if !pages.is_empty() {
        let ok = pages.split(',').all(|part| {
            let mut ends = part.splitn(2, '-');
            let num = |x: Option<&str>| x.is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()) && n.parse::<u32>().is_ok_and(|v| v >= 1));
            let first = ends.next();
            let rest = ends.next();
            num(first) && (rest.is_none() || num(rest))
        });
        if !ok {
            return Err(format!("pages invalides : « {pages} » (exemple : 1-3, 5)"));
        }
        let at = args.len() - 2; // avant « -- fichier »
        args.splice(at..at, ["-P".to_string(), pages]);
    }
    Ok(args)
}

/// Envoie certaines pages d'un PDF à l'imprimante (AuxiPDF).
pub fn print_pdf_pages(file: &Path, pages: &str, o: &PrintOptions) -> Result<String, String> {
    let out = Command::new("lp").args(lp_args_pages(file, pages, o)?).output().map_err(|e| format!("service d'impression indisponible ({e})"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Ouvre un fichier avec l'application par défaut du système (aperçu PDF).
pub fn open_with_system(file: &Path) -> Result<(), String> {
    let status = if cfg!(target_os = "macos") {
        Command::new("open").arg(file).status()
    } else if cfg!(windows) {
        auxi_engine::no_console(&mut Command::new("cmd")).args(["/C", "start", ""]).arg(file).status()
    } else {
        Command::new("xdg-open").arg(file).status()
    };
    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => Err(format!("ouverture impossible ({s})")),
        Err(e) => Err(format!("ouverture impossible ({e})")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts() -> PrintOptions {
        PrintOptions { printer: "Bureau_HP".into(), copies: 2, sides: "two-sided-long-edge".into(), monochrome: true }
    }

    #[test]
    fn builds_lp_arguments() {
        let a = lp_args(Path::new("/tmp/Rapport annuel.pdf"), &opts()).unwrap();
        assert_eq!(
            a,
            ["-d", "Bureau_HP", "-n", "2", "-o", "sides=two-sided-long-edge", "-o", "print-color-mode=monochrome", "-t", "Rapport annuel", "--", "/tmp/Rapport annuel.pdf"]
        );
    }

    #[test]
    fn rejects_unsafe_options() {
        let mut o = opts();
        o.printer = "-h evil".into();
        assert!(lp_args(Path::new("/tmp/a.pdf"), &o).is_err());
        let mut o = opts();
        o.copies = 0;
        assert!(lp_args(Path::new("/tmp/a.pdf"), &o).is_err());
        let mut o = opts();
        o.sides = "both".into();
        assert!(lp_args(Path::new("/tmp/a.pdf"), &o).is_err());
    }

    #[test]
    fn page_ranges_for_pdf_files() {
        let a = lp_args_pages(Path::new("/tmp/f.pdf"), " 1-3; 5 ", &opts()).unwrap();
        assert_eq!(&a[a.len() - 4..], ["-P", "1-3,5", "--", "/tmp/f.pdf"]);
        assert_eq!(lp_args_pages(Path::new("/tmp/f.pdf"), "", &opts()).unwrap(), lp_args(Path::new("/tmp/f.pdf"), &opts()).unwrap());
        for bad in ["0", "1-", "-2", "a", "1--2", "1,,2", "1-2-3"] {
            assert!(lp_args_pages(Path::new("/tmp/f.pdf"), bad, &opts()).is_err(), "{bad}");
        }
    }
}
