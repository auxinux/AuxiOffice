//! Moteur documentaire d'AuxiOffice.
//!
//! - [`protocol`] : trames échangées avec le processus `auxi-engine` ;
//! - [`client`] : côté application, lancement et pilotage du moteur ;
//! - [`lok`] : côté moteur, enveloppe de LibreOfficeKit.

pub mod client;
pub mod lok;
pub mod protocol;

/// Sous Windows, lance le processus sans fenêtre de console : `auxi-engine`
/// et les outils en ligne de commande (AuxiCorrect…) sont des programmes
/// console, et chacun ouvrirait sinon sa propre fenêtre noire.
pub fn no_console(cmd: &mut std::process::Command) -> &mut std::process::Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}
