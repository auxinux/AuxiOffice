// Pas de console sous Windows en version de production.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    auxitext_lib::run()
}
