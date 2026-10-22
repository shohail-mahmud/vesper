// Vesper — Windows desktop entry point.
//
// The window is created from `tauri.conf.json` (library window + widget window).
// All application state — library, playback, widget settings — is owned by the
// Rust side so that hiding or closing the library window never stops playback.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    vesper_lib::run();
}
