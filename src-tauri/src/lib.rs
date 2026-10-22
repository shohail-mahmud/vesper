//! Application lifecycle, System Tray, Windows DWM & SMTC sync, Drag & Drop, and CLI file open.

mod commands;
mod db;
mod eq;
mod library;
mod metadata;
mod model;
mod playback;
mod smtc;

use std::time::Duration;

use parking_lot::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
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

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let open_item = MenuItemBuilder::with_id("open", "Open Vesper Library").build(app)?;
    let toggle_item = MenuItemBuilder::with_id("toggle", "Play / Pause").build(app)?;
    let next_item = MenuItemBuilder::with_id("next", "Next Track").build(app)?;
    let prev_item = MenuItemBuilder::with_id("prev", "Previous Track").build(app)?;
    let widget_item = MenuItemBuilder::with_id("widget", "Toggle Desktop Widget").build(app)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "Quit Vesper").build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &open_item,
            &sep1,
            &toggle_item,
            &prev_item,
            &next_item,
            &widget_item,
            &sep2,
            &quit_item,
        ])
        .build()?;

    let mut builder = TrayIconBuilder::with_id("vesper-tray")
        .menu(&menu)
        .tooltip("Vesper — Local Music Player")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let Some(state) = app.try_state::<AppState>() else {
                return;
            };
            match event.id().as_ref() {
                "open" => {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.unminimize();
                        let _ = win.set_focus();
                    }
                }
                "toggle" => state.player.toggle(),
                "next" => state.player.next(),
                "prev" => state.player.previous(),
                "widget" => {
                    if let Some(w) = app.get_webview_window("widget") {
                        let vis = w.is_visible().unwrap_or(false);
                        if vis {
                            let _ = w.hide();
                        } else {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                }
                "quit" => {
                    // Stop the audio engine first so no sound can outlive the process.
                    state.player.stop();
                    app.exit(0)
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(win) = tray.app_handle().get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.unminimize();
                    let _ = win.set_focus();
                }
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            configure_windows_dwm(app.handle());

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

            if let Err(err) = build_tray(app.handle()) {
                eprintln!("[vesper] system tray unavailable: {err}");
            }

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
                    std::thread::sleep(Duration::from_millis(180));
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
                WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                    // BUG FIX (ghost background playback): previously closing
                    // the main window ALWAYS hid it to the tray whenever music
                    // was playing or the widget was visible — so the app never
                    // actually closed and the song kept playing invisibly.
                    // Now: closing main QUITS and STOPS playback, unless the
                    // user explicitly opted into "Close to tray" in Settings.
                    let close_to_tray = window
                        .app_handle()
                        .try_state::<AppState>()
                        .map(|st| {
                            st.db
                                .lock()
                                .load_snapshot()
                                .ok()
                                .flatten()
                                .map(|s| s.settings.close_to_tray)
                                .unwrap_or(false)
                        })
                        .unwrap_or(false);
                    if close_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        if let Some(st) = window.app_handle().try_state::<AppState>() {
                            st.player.stop();
                        }
                        // Exit explicitly: the (hidden) widget window still
                        // exists, so merely closing main would leave a silent
                        // background process running.
                        window.app_handle().exit(0);
                    }
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
            commands::open_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vesper");
}
