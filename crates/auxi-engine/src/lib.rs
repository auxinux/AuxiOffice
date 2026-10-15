//! Moteur documentaire d'AuxiOffice.
//!
//! - [`protocol`] : trames échangées avec le processus `auxi-engine` ;
//! - [`client`] : côté application, lancement et pilotage du moteur ;
//! - [`lok`] : côté moteur, enveloppe de LibreOfficeKit.

pub mod client;
pub mod lok;
pub mod protocol;
