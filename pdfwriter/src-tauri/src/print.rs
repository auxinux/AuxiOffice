//! Impression : le PDF part vers CUPS (`lp`, Linux et macOS) ; ailleurs, il est
//! ouvert par l'application du système, qui a sa propre boîte d'impression.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

/// Pas de fenêtre de console noire sous Windows pour les commandes lancées.
pub fn no_console(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

#[derive(Serialize)]
pub struct Printer {
    pub name: String,
    pub default: bool,
}

#[derive(Deserialize, Debug, Clone)]
pub struct PrintOptions {
    pub printer: String,
    pub copies: u32,
    /// « 1-3,5 » ; vide = toutes.
    pub pages: String,
}

pub fn lp_args(file: &Path, o: &PrintOptions) -> Result<Vec<String>, String> {
    if o.printer.is_empty() || o.printer.starts_with('-') || o.printer.contains(char::is_whitespace) {
        return Err("imprimante invalide".into());
    }
    if !(1..=999).contains(&o.copies) {
        return Err("nombre de copies invalide".into());
    }
    let mut args = vec!["-d".to_string(), o.printer.clone(), "-n".into(), o.copies.to_string()];
    let pages: String = o.pages.chars().filter(|c| !c.is_whitespace()).map(|c| if c == ';' { ',' } else { c }).collect();
    if !pages.is_empty() {
        let num = |n: &str| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()) && n.parse::<u32>().is_ok_and(|v| v >= 1);
        let ok = pages.split(',').all(|p| match p.split_once('-') {
            Some((a, b)) => num(a) && num(b),
            None => num(p),
        });
        if !ok {
            return Err(format!("pages invalides : « {pages} » (exemple : 1-3,5)"));
        }
        args.extend(["-P".to_string(), pages]);
    }
    args.push("-t".into());
    args.push(file.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "AuxiPDFWriter".into()));
    args.push("--".into());
    args.push(file.to_string_lossy().into_owned());
    Ok(args)
}

pub fn list_printers() -> Vec<Printer> {
    // Windows n'a pas CUPS : l'impression passe par l'application PDF du système.
    if cfg!(windows) {
        return vec![];
    }
    let run = |args: &[&str]| -> String { Command::new("lpstat").args(args).env("LC_ALL", "C").output().ok().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default() };
    let default = run(&["-d"]).split(':').nth(1).map(|s| s.trim().to_string()).unwrap_or_default();
    run(&["-e"]).lines().map(str::trim).filter(|l| !l.is_empty()).map(|name| Printer { default: name == default, name: name.to_string() }).collect()
}

pub fn print_pdf(file: &Path, o: &PrintOptions) -> Result<String, String> {
    let out = no_console(&mut Command::new("lp")).args(lp_args(file, o)?).output().map_err(|e| format!("service d'impression indisponible ({e})"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

pub fn open_with_system(target: &str) -> Result<(), String> {
    let mut c;
    if cfg!(target_os = "macos") {
        c = Command::new("open");
        c.arg(target);
    } else if cfg!(windows) {
        c = Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", target]);
    } else {
        c = Command::new("xdg-open");
        c.arg(target);
    }
    no_console(&mut c).spawn().map(|_| ()).map_err(|e| format!("ouverture impossible ({e})"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn o(pages: &str) -> PrintOptions {
        PrintOptions { printer: "Bureau".into(), copies: 2, pages: pages.into() }
    }

    #[test]
    fn arguments() {
        let a = lp_args(Path::new("/t/Doc.pdf"), &o("1-3, 5")).unwrap();
        assert_eq!(a, ["-d", "Bureau", "-n", "2", "-P", "1-3,5", "-t", "Doc", "--", "/t/Doc.pdf"]);
        assert!(!lp_args(Path::new("/t/a.pdf"), &o("")).unwrap().contains(&"-P".to_string()));
    }

    #[test]
    fn refus() {
        assert!(lp_args(Path::new("/a.pdf"), &o("x")).is_err());
        assert!(lp_args(Path::new("/a.pdf"), &PrintOptions { printer: "-oups".into(), copies: 1, pages: "".into() }).is_err());
        assert!(lp_args(Path::new("/a.pdf"), &PrintOptions { printer: "a".into(), copies: 0, pages: "".into() }).is_err());
    }
}
