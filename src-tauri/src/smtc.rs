//! Windows System Media Transport Controls (`SMTC`) + Global Hardware Media Keys.
//!
//! Integrates Vesper with Windows 10/11 hardware Play/Pause/Next/Prev media keys
//! and the native Windows Media Flyout card (song title, artist, album, cover art).
//! Dispatches all WinRT SMTC mutations onto the main STA thread that owns `hwnd`.

use crate::model::{PlaybackStatus, Track};
use crate::playback::PlaybackService;

#[cfg(target_os = "windows")]
mod imp {
    use super::*;
    use parking_lot::Mutex;
    use souvlaki::{
        MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition,
        PlatformConfig, SeekDirection,
    };
    use std::ffi::c_void;
    use std::sync::Arc;
    use std::time::Duration;
    use tauri::{AppHandle, Manager};

    struct SendControls(Option<MediaControls>);
    // Accessed strictly on the Tauri main STA thread via `run_on_main_thread`.
    unsafe impl Send for SendControls {}
    unsafe impl Sync for SendControls {}

    pub struct MediaTransport {
        app: AppHandle,
        controls: Arc<Mutex<SendControls>>,
    }

    impl MediaTransport {
        pub fn new(app: &AppHandle, player: PlaybackService) -> Self {
            let hwnd_opt: Option<*mut c_void> = app
                .get_webview_window("main")
                .and_then(|w| w.hwnd().ok())
                .map(|h| h.0 as *mut c_void);

            let Some(hwnd) = hwnd_opt else {
                return MediaTransport {
                    app: app.clone(),
                    controls: Arc::new(Mutex::new(SendControls(None))),
                };
            };

            let config = PlatformConfig {
                dbus_name: "dev.vesper.player",
                display_name: "Vesper",
                hwnd: Some(hwnd),
            };

            let mut controls = match MediaControls::new(config) {
                Ok(c) => c,
                Err(err) => {
                    eprintln!("[vesper] SMTC unavailable: {err:?}");
                    return MediaTransport {
                        app: app.clone(),
                        controls: Arc::new(Mutex::new(SendControls(None))),
                    };
                }
            };

            let _ = controls.attach(move |event: MediaControlEvent| match event {
                MediaControlEvent::Play => player.play(),
                MediaControlEvent::Pause => player.pause(),
                MediaControlEvent::Toggle => player.toggle(),
                MediaControlEvent::Next => player.next(),
                MediaControlEvent::Previous => player.previous(),
                MediaControlEvent::Stop => player.stop(),
                MediaControlEvent::Seek(dir) => {
                    let pos = player.state().position;
                    let delta = match dir {
                        SeekDirection::Forward => 5.0,
                        SeekDirection::Backward => -5.0,
                    };
                    player.seek((pos + delta).max(0.0));
                }
                MediaControlEvent::SetPosition(MediaPosition(dur)) => {
                    player.seek(dur.as_secs_f64());
                }
                MediaControlEvent::SetVolume(vol) => {
                    player.set_volume(vol, false);
                }
                _ => {}
            });

            MediaTransport {
                app: app.clone(),
                controls: Arc::new(Mutex::new(SendControls(Some(controls)))),
            }
        }

        pub fn update(&self, status: PlaybackStatus, position: f64, track: Option<&Track>) {
            let inner = Arc::clone(&self.controls);
            let owned_track = track.cloned();

            let _ = self.app.run_on_main_thread(move || {
                let mut guard = inner.lock();
                let Some(controls) = guard.0.as_mut() else {
                    return;
                };

                if let Some(ref t) = owned_track {
                    let cover_url = t
                        .artwork
                        .as_ref()
                        .filter(|p| std::path::Path::new(p).exists())
                        .map(|p| format!("file:///{}", p.replace('\\', "/")));
                    let duration = if t.duration > 0.0 {
                        Some(Duration::from_secs_f64(t.duration))
                    } else {
                        None
                    };
                    let _ = controls.set_metadata(MediaMetadata {
                        title: Some(t.title.as_str()),
                        artist: t.artist.as_deref(),
                        album: t.album.as_deref(),
                        duration,
                        cover_url: cover_url.as_deref(),
                    });
                }

                let progress = Some(MediaPosition(Duration::from_secs_f64(position.max(0.0))));
                let playback = match status {
                    PlaybackStatus::Playing => MediaPlayback::Playing { progress },
                    PlaybackStatus::Paused | PlaybackStatus::Loading => {
                        MediaPlayback::Paused { progress }
                    }
                    PlaybackStatus::Idle | PlaybackStatus::Error => MediaPlayback::Stopped,
                };
                let _ = controls.set_playback(playback);
            });
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    use super::*;
    use tauri::AppHandle;

    pub struct MediaTransport;

    impl MediaTransport {
        pub fn new(_app: &AppHandle, _player: PlaybackService) -> Self {
            MediaTransport
        }

        pub fn update(&self, _status: PlaybackStatus, _position: f64, _track: Option<&Track>) {}
    }
}

pub use imp::MediaTransport;
