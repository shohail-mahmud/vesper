//! Application lifecycle, Windows DWM & SMTC sync, Drag & Drop, and CLI file open.
//!
//! Vesper deliberately has NO system-tray icon: closing the last visible window
//! always stops playback and quits the process, so nothing can keep running (or
//! playing) invisibly in the background.

mod commands;
mod db;
mod eq;
mod library;
mod metadata;
mod model;
mod playback;
mod ring;
mod smtc;
mod stream;

use std::time::Duration;

use parking_lot::Mutex;
use tauri::{DragDropEvent, Emitter, Manager, WindowEvent};

use commands::AppState;

/// Configure Windows 11 DWM attributes:
///  • `main`: smooth native OS rounded window corners (`DWMWCP_ROUND = 2`).
///  • `widget`: remove DWM 1px rectangular border (`DWMWA_COLOR_NONE = 0xFFFFFFFE`)
///    so ONLY the pure round capsule floats cleanly over the desktop wallpaper!
#[cfg(target_os = "windows")]
fn configure_windows_dwm(app: &tauri::AppHandle) {
    use std::ffi::c_void;

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: *mut c_void,
            dwAttribute: u32,
            pvAttribute: *const c_void,
            cbAttribute: u32,
        ) -> i32;
    }

    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
    const DWMWA_BORDER_COLOR: u32 = 34;
    const DWMWCP_DONOTROUND: u32 = 1;
    const DWMWCP_ROUND: u32 = 2;
    const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;

    if let Some(main_win) = app.get_webview_window("main") {
        if let Ok(hwnd) = main_win.hwnd() {
            unsafe {
                let _ = DwmSetWindowAttribute(
                    hwnd.0 as *mut c_void,
                    DWMWA_WINDOW_CORNER_PREFERENCE,
                    (&DWMWCP_ROUND as *const u32).cast(),
                    4,
                );
            }
        }
    }

    if let Some(widget_win) = app.get_webview_window("widget") {
        if let Ok(hwnd) = widget_win.hwnd() {
            unsafe {
                let _ = DwmSetWindowAttribute(
                    hwnd.0 as *mut c_void,
                    DWMWA_BORDER_COLOR,
                    (&DWMWA_COLOR_NONE as *const u32).cast(),
                    4,
                );
                let _ = DwmSetWindowAttribute(
                    hwnd.0 as *mut c_void,
                    DWMWA_WINDOW_CORNER_PREFERENCE,
                    (&DWMWCP_DONOTROUND as *const u32).cast(),
                    4,
                );
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn configure_windows_dwm(_app: &tauri::AppHandle) {}

/// Size limits for the main window.
///
/// These mirror the `main` window block in tauri.conf.json. They live here as
/// well because the fit below has to be able to lower the minimum when the
/// screen itself is smaller than the minimum.
const MAIN_PREFERRED_W: f64 = 1180.0;
const MAIN_PREFERRED_H: f64 = 800.0;
const MAIN_MIN_W: f64 = 840.0;
const MAIN_MIN_H: f64 = 560.0;

/// Gap between the window and the edges of the usable screen area.
const SCREEN_MARGIN: f64 = 12.0;

/// Absolute floor: below this the interface stops being usable at all, and a
/// window smaller than it would be worse than a slightly clipped one.
const ABSOLUTE_FLOOR_W: f64 = 640.0;
const ABSOLUTE_FLOOR_H: f64 = 420.0;

/// Keep the main window inside the usable area of the screen it opens on.
///
/// The configured size is 1180 x 800. A desktop monitor has room for that, but
/// a 1366 x 768 laptop does not: Windows keeps roughly 40 px for the taskbar, so
/// only about 728 px of height remains, the window hangs off the bottom and the
/// player bar ends up under the taskbar.
///
/// Three things make this correct rather than approximate:
///
///  1. Work area, not screen size. `work_area()` already excludes the taskbar
///     and any docked toolbars, which is exactly the space a normal window may
///     occupy.
///  2. Display scaling. Sizes are converted to logical pixels before comparing,
///     because at 125 percent or 150 percent scaling the screen is far smaller
///     in logical pixels than its resolution suggests, and the configured
///     minimum of 840 x 560 can itself be larger than the whole screen.
///  3. The minimum size is lowered first. A window whose minimum is bigger than
///     the screen silently refuses to shrink, which is how a "fixed" window
///     still ends up clipped. Lowering the minimum before resizing is what
///     makes the fit actually happen at high DPI.
///
/// On a screen with room to spare this does nothing at all: the width and the
/// height both stay at the configured values.
fn fit_main_window_to_screen(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };

    let scale = monitor.scale_factor();
    if !scale.is_finite() || scale <= 0.0 {
        return;
    }

    let work = monitor.work_area();
    let avail_w = work.size.width as f64 / scale;
    let avail_h = work.size.height as f64 / scale;
    if !avail_w.is_finite() || !avail_h.is_finite() || avail_w < 1.0 || avail_h < 1.0 {
        return;
    }

    // Space a window may occupy, minus a small breathing gap on each side.
    let limit_w = (avail_w - SCREEN_MARGIN * 2.0).max(ABSOLUTE_FLOOR_W);
    let limit_h = (avail_h - SCREEN_MARGIN * 2.0).max(ABSOLUTE_FLOOR_H);

    // Never larger than the preferred size, never larger than the screen.
    let width = MAIN_PREFERRED_W.min(limit_w);
    let height = MAIN_PREFERRED_H.min(limit_h);

    // Drop the minimum first when the screen cannot hold it, otherwise the
    // resize below is ignored by the window manager.
    let min_w = width.min(MAIN_MIN_W);
    let min_h = height.min(MAIN_MIN_H);
    let _ = window.set_min_size(Some(tauri::LogicalSize::new(min_w, min_h)));

    let _ = window.set_size(tauri::LogicalSize::new(width, height));
    let _ = window.center();
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            configure_windows_dwm(app.handle());

            // The main window is created hidden (see tauri.conf.json). Size it
            // against the screen first, then reveal it, so the wrong size is
            // never painted: no grow-then-shrink jump on launch.
            fit_main_window_to_screen(app.handle());
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            let database = db::Database::open()?;
            let snapshot = database.load_snapshot().ok().flatten();

            let initial_eq = snapshot
                .as_ref()
                .map(|s| s.playback.eq.clone())
                .unwrap_or_default();
            let player = playback::PlaybackService::new(initial_eq);

            if let Some(ref snap) = snapshot {
                player.set_volume(snap.playback.volume, snap.playback.muted);
                player.set_speed(snap.playback.speed);
                player.set_repeat(snap.playback.repeat);
                player.set_shuffle(snap.playback.shuffle);
            }

            let widget = snapshot
                .as_ref()
                .map(|s| s.widget.clone())
                .unwrap_or_default();

            let smtc = smtc::MediaTransport::new(app.handle(), player.clone());

            app.manage(AppState {
                db: Mutex::new(database),
                player,
                widget: Mutex::new(widget),
                smtc,
            });

            let cli_files: Vec<String> = std::env::args()
                .skip(1)
                .filter(|arg| !arg.starts_with('-'))
                .filter(|arg| {
                    let p = std::path::Path::new(arg);
                    p.is_file() && library::is_audio(p)
                })
                .collect();
            if !cli_files.is_empty() {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(450));
                    let _ = handle.emit("app://open-files", cli_files);
                });
            }

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut last_payload = String::new();
                let mut last_track_id: Option<String> = None;
                let mut cached_track: Option<model::Track> = None;

                loop {
                    // 80 ms keeps the progress bar smooth and shrinks the silence gap
                    // between tracks (this loop is what starts the next one).
                    std::thread::sleep(Duration::from_millis(80));
                    let Some(state) = handle.try_state::<AppState>() else {
                        continue;
                    };
                    state.player.tick();
                    let payload = state.player.state();

                    if payload.track_id != last_track_id {
                        last_track_id = payload.track_id.clone();
                        cached_track = payload.track_id.as_ref().and_then(|id| {
                            state
                                .db
                                .lock()
                                .load_snapshot()
                                .ok()
                                .flatten()
                                .and_then(|s| s.library.tracks.get(id).cloned())
                                .and_then(|v| serde_json::from_value::<model::Track>(v).ok())
                        });
                    }

                    if let Ok(encoded) = serde_json::to_string(&payload) {
                        if encoded != last_payload {
                            last_payload = encoded;
                            state.smtc.update(
                                payload.status,
                                payload.position,
                                cached_track.as_ref(),
                            );
                            let _ = handle.emit("playback://state", payload);
                        }
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
                    let strings: Vec<String> = paths
                        .iter()
                        .map(|p| p.to_string_lossy().to_string())
                        .collect();
                    if !strings.is_empty() {
                        let _ = window.app_handle().emit("app://file-drop", strings);
                    }
                }
                WindowEvent::CloseRequested { .. } if window.label() == "main" => {
                    // There is no tray to hide into, so closing Vesper always
                    // means quitting: stop the audio engine, then exit. This is
                    // also why the old "close to tray / ghost playback" problem
                    // cannot come back — no visible window, no process.
                    if let Some(st) = window.app_handle().try_state::<AppState>() {
                        st.player.stop();
                    }
                    window.app_handle().exit(0);
                }
                WindowEvent::CloseRequested { api, .. } if window.label() == "widget" => {
                    // Closing the LAST visible window must quit + stop
                    // playback. If the main window is still open, just hide
                    // the widget (never destroy it, so it can reopen later).
                    let app = window.app_handle();
                    let main_visible = app
                        .get_webview_window("main")
                        .and_then(|w| w.is_visible().ok())
                        .unwrap_or(false);
                    if main_visible {
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        if let Some(st) = app.try_state::<AppState>() {
                            st.player.stop();
                        }
                        app.exit(0);
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::snapshot_load,
            commands::snapshot_save,
            commands::pick_folder,
            commands::pick_tracks,
            commands::pick_cover_image,
            commands::set_track_cover,
            commands::remove_track_cover,
            commands::import_folder,
            commands::import_tracks,
            commands::import_dropped_paths,
            commands::refresh_folder,
            commands::remove_folder,
            commands::remove_track,
            commands::rename_folder,
            commands::read_track_lyrics,
            commands::prune_artwork,
            commands::audio_diagnostics,
            commands::player_play_queue,
            commands::player_enqueue,
            commands::player_remove_queue_index,
            commands::player_move_queue_item,
            commands::player_jump_to_index,
            commands::player_play,
            commands::player_pause,
            commands::player_toggle,
            commands::player_stop,
            commands::player_seek,
            commands::player_next,
            commands::player_previous,
            commands::player_set_volume,
            commands::player_set_speed,
            commands::player_set_eq,
            commands::player_set_shuffle,
            commands::player_set_repeat,
            commands::main_window_show,
            commands::app_quit,
            commands::widget_show,
            commands::widget_hide,
            commands::widget_close,
            commands::widget_set_always_on_top,
            commands::widget_set_bounds,
            commands::factory_reset,
            commands::open_external,
            commands::open_path,
            commands::open_data_folder,
            commands::set_playlist_cover,
            commands::remove_playlist_cover,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vesper");
}
