//! Domain model shared with `src/types.ts`.
//!
//! Every struct is serialised with camelCase keys so the TypeScript layer can
//! consume the payloads directly with full backwards compatibility.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RepeatMode {
    Off,
    All,
    One,
}

impl Default for RepeatMode {
    fn default() -> Self {
        RepeatMode::Off
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlaybackStatus {
    Idle,
    Loading,
    Playing,
    Paused,
    Error,
}

impl Default for PlaybackStatus {
    fn default() -> Self {
        PlaybackStatus::Idle
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EqSettings {
    pub enabled: bool,
    pub preset: String,
    pub preamp: f32,
    pub bands: [f32; 10],
}

impl Default for EqSettings {
    fn default() -> Self {
        EqSettings {
            enabled: false,
            preset: "flat".into(),
            preamp: 0.0,
            bands: [0.0; 10],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_number: Option<u32>,
    /// Seconds. `0.0` means "not yet known".
    pub duration: f64,
    /// Original location on disk. Files are never copied into app storage.
    pub path: String,
    /// Normalised identity key used for de-duplication.
    pub key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artwork: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lyrics: Option<String>,
    #[serde(rename = "sourceKind")]
    pub source_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub play_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_played_at: Option<u64>,
    #[serde(default)]
    pub missing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderPlaylist {
    pub id: String,
    pub name: String,
    pub path: String,
    pub track_ids: Vec<String>,
    pub recursive: bool,
    pub missing: bool,
    pub added_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_scanned_at: Option<u64>,
    #[serde(default)]
    pub sample: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPlaylist {
    pub id: String,
    pub name: String,
    pub track_ids: Vec<String>,
    pub created_at: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryState {
    pub folders: Vec<FolderPlaylist>,
    pub tracks: serde_json::Map<String, serde_json::Value>,
    pub loose_track_ids: Vec<String>,
    #[serde(default)]
    pub playlists: Vec<UserPlaylist>,
}

fn default_theme() -> String {
    "light".into()
}

fn default_artwork_size() -> u32 {
    320
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub recursive_scan: bool,
    #[serde(default = "default_true")]
    pub remember_last_playlist: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_playlist_id: Option<String>,
    #[serde(default)]
    pub launch_at_startup: bool,
    #[serde(default)]
    pub show_sample_collection: bool,
    #[serde(default = "default_artwork_size")]
    pub artwork_size: u32,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_true")]
    pub close_to_tray: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            recursive_scan: false,
            remember_last_playlist: true,
            last_playlist_id: None,
            launch_at_startup: false,
            show_sample_collection: false,
            artwork_size: 320,
            theme: "light".into(),
            close_to_tray: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetSettings {
    pub visible: bool,
    pub always_on_top: bool,
    pub opacity: f64,
    pub size: String,
    pub show_artwork: bool,
    pub show_progress: bool,
    pub show_volume: bool,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub click_through: bool,
}

impl Default for WidgetSettings {
    fn default() -> Self {
        WidgetSettings {
            visible: false,
            always_on_top: false,
            opacity: 0.94,
            size: "expanded".into(),
            show_artwork: true,
            show_progress: true,
            show_volume: true,
            x: 0.0,
            y: 0.0,
            width: 384.0,
            height: 188.0,
            click_through: false,
        }
    }
}

fn default_speed() -> f64 {
    1.0
}

fn default_volume() -> f64 {
    0.72
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_id: Option<String>,
    #[serde(default)]
    pub position: f64,
    #[serde(default = "default_volume")]
    pub volume: f64,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub shuffle: bool,
    #[serde(default)]
    pub repeat: RepeatMode,
    #[serde(default = "default_speed")]
    pub speed: f64,
    #[serde(default)]
    pub eq: EqSettings,
}

impl Default for PlaybackSnapshot {
    fn default() -> Self {
        PlaybackSnapshot {
            track_id: None,
            position: 0.0,
            volume: 0.72,
            muted: false,
            shuffle: false,
            repeat: RepeatMode::Off,
            speed: 1.0,
            eq: EqSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub version: u32,
    pub library: LibraryState,
    pub settings: Settings,
    pub widget: WidgetSettings,
    pub playback: PlaybackSnapshot,
}

/// Full playback state broadcast to every window on `playback://state`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStateEvent {
    pub status: PlaybackStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_id: Option<String>,
    pub position: f64,
    pub duration: f64,
    pub volume: f64,
    pub muted: bool,
    pub shuffle: bool,
    pub repeat: RepeatMode,
    pub speed: f64,
    pub eq: EqSettings,
    pub queue: Vec<String>,
    pub base_queue: Vec<String>,
    pub index: i64,
    pub device_available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Default for PlaybackStateEvent {
    fn default() -> Self {
        PlaybackStateEvent {
            status: PlaybackStatus::Idle,
            track_id: None,
            position: 0.0,
            duration: 0.0,
            volume: 0.72,
            muted: false,
            shuffle: false,
            repeat: RepeatMode::Off,
            speed: 1.0,
            eq: EqSettings::default(),
            queue: Vec::new(),
            base_queue: Vec::new(),
            index: -1,
            device_available: true,
            error: None,
        }
    }
}
