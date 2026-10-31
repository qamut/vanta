// Sem console em release: o VANTA é uma aplicação de bandeja.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    vanta_lib::run()
}
