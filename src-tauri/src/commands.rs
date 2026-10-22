//! Tauri command surface. Every function here matches `src/state/bridge.ts` 1-to-1.

use std::collections::HashSet;
use std::path::PathBuf;

use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::Database;
use crate::library;
use crate::model::{AppSnapshot, EqSettings, RepeatMode, WidgetSettings};
use crate::playback::{PlaybackService, QueueItem};
use crate::smtc::MediaTransport;

pub struct AppState {
    pub db: Mutex<Database>,
    pub player: PlaybackService,
    pub widget: Mutex<WidgetSettings>,
    pub smtc: MediaTransport,
}

/* ----------------------------- library ----------------------------- */

#[tauri::command]
pub fn snapshot_load(state: State<'_, AppState>) -> Result<Option<AppSnapshot>, String> {
    state.db.lock().load_snapshot().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn snapshot_save(state: State<'_, AppState>, snapshot: AppSnapshot) -> Result<(), String> {
    let db = state.db.lock();
    db.save_snapshot(&snapshot).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn pick_tracks(app: AppHandle) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let files = app
        .dialog()
        .file()
        .add_filter(
            "Audio",
            &[
                "mp3", "wav", "flac", "m4a", "aac", "ogg", "oga", "opus", "wma", "aiff", "aif",
            ],
        )
        .blocking_pick_files();
    Ok(files
        .unwrap_or_default()
        .into_iter()
        .map(|p| p.to_string())
        .collect())
}

#[tauri::command]
pub fn import_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    recursive: bool,
) -> Result<serde_json::Value, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("Not a readable directory: {path}"));
    }

    let db = state.db.lock();
    let mut snapshot = db
        .load_snapshot()
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| AppSnapshot {
            version: 2,
            library: Default::default(),
            settings: Default::default(),
            widget: WidgetSettings::default(),
            playback: Default::default(),
        });

    let existing: HashSet<String> = snapshot.library.tracks.keys().cloned().collect();
    let id = library::track_id(&format!("{path}:folder"));
    let outcome = library::scan_folder(
        &root,
        recursive,
        Some(&id),
        &existing,
        &db.data_dir.join("artwork"),
    )
    .map_err(|e| e.to_string())?;

    let playlist = library::build_playlist(&root, &id, recursive, &outcome.all_track_ids);
    for track in &outcome.tracks {
        snapshot.library.tracks.insert(
            track.id.clone(),
            serde_json::to_value(track).map_err(|e| e.to_string())?,
        );
    }
    snapshot.library.folders.retain(|f| f.id != playlist.id);
    snapshot.library.folders.push(playlist.clone());
    db.save_snapshot(&snapshot).map_err(|e| e.to_string())?;
    drop(db);

    let _ = app.emit("library://changed", ());
    Ok(serde_json::json!({
        "added": outcome.tracks.len(),
        "skippedDuplicates": outcome.skipped_duplicates,
        "missing": outcome.missing,
        "playlist": playlist,
    }))
}

#[tauri::command]
pub fn import_tracks(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<serde_json::Value, String> {
    let db = state.db.lock();
    let mut snapshot = db
        .load_snapshot()
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| AppSnapshot {
            version: 2,
            library: Default::default(),
            settings: Default::default(),
            widget: WidgetSettings::default(),
            playback: Default::default(),
        });

    let mut existing: HashSet<String> = snapshot.library.tracks.keys().cloned().collect();
    let mut added = 0usize;
    let mut skipped = 0usize;
    let mut first_added_id: Option<String> = None;

    for path in &paths {
        let file = PathBuf::from(path);
        if !file.is_file() {
            skipped += 1;
            continue;
        }
        let id = library::track_id(path);
        if existing.contains(&id) {
            if first_added_id.is_none() {
                first_added_id = Some(id);
            }
            skipped += 1;
            continue;
        }
        let meta = crate::metadata::read(&file, &db.data_dir.join("artwork")).unwrap_or_default();
        let size = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
        let title = meta
            .title
            .clone()
            .unwrap_or_else(|| crate::metadata::title_from_file_name(&file));
        let track = crate::model::Track {
            id: id.clone(),
            title,
            artist: meta.artist,
            album: meta.album,
            track_number: meta.track_number,
            duration: meta.duration,
            path: path.clone(),
            key: id.clone(),
            artwork: meta.artwork,
            lyrics: meta.lyrics,
            source_kind: "loose".into(),
            folder_id: None,
            size_bytes: Some(size),
            favorite: false,
            play_count: 0,
            last_played_at: None,
            missing: false,
            error: None,
        };
        snapshot.library.tracks.insert(
            id.clone(),
            serde_json::to_value(&track).map_err(|e| e.to_string())?,
        );
        snapshot.library.loose_track_ids.push(id.clone());
        existing.insert(id.clone());
        if first_added_id.is_none() {
            first_added_id = Some(id);
        }
        added += 1;
    }

    db.save_snapshot(&snapshot).map_err(|e| e.to_string())?;
    drop(db);
    let _ = app.emit("library://changed", ());
    Ok(serde_json::json!({
        "added": added,
        "skippedDuplicates": skipped,
        "firstTrackId": first_added_id,
    }))
}

/// Handles mixed Drag & Drop payloads (folders + audio files dropped together from Explorer).
#[tauri::command]
pub fn import_dropped_paths(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
    recursive: bool,
) -> Result<serde_json::Value, String> {
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    for p in paths {
        let pb = PathBuf::from(&p);
        if pb.is_dir() {
            dirs.push(p);
        } else if pb.is_file() && library::is_audio(&pb) {
            files.push(p);
        }
    }
    let mut folders_added = 0usize;
    let mut tracks_added = 0usize;
    for dir in dirs {
        if let Ok(res) = import_folder(app.clone(), state.clone(), dir, recursive) {
            folders_added += 1;
            tracks_added += res.get("added").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        }
    }
    if !files.is_empty() {
        if let Ok(res) = import_tracks(app, state, files) {
            tracks_added += res.get("added").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        }
    }
    Ok(serde_json::json!({
        "foldersAdded": folders_added,
        "tracksAdded": tracks_added,
    }))
}

#[tauri::command]
pub fn refresh_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    recursive: Option<bool>,
) -> Result<serde_json::Value, String> {
    let db = state.db.lock();
    let mut snapshot = db
        .load_snapshot()
        .map_err(|e| e.to_string())?
        .ok_or("no library")?;
    let folder = snapshot
        .library
        .folders
        .iter()
        .find(|f| f.id == id)
        .cloned()
        .ok_or("playlist not found")?;

    let use_recursive = recursive.unwrap_or(folder.recursive);
    let root = PathBuf::from(&folder.path);
    if !root.is_dir() {
        for f in snapshot.library.folders.iter_mut() {
            if f.id == id {
                f.missing = true;
            }
        }
        db.save_snapshot(&snapshot).map_err(|e| e.to_string())?;
        drop(db);
        let _ = app.emit("library://changed", ());
        return Err(format!("Folder unavailable: {}", folder.path));
    }

    let existing: HashSet<String> = snapshot.library.tracks.keys().cloned().collect();
    let outcome = library::scan_folder(
        &root,
        use_recursive,
        Some(&id),
        &existing,
        &db.data_dir.join("artwork"),
    )
    .map_err(|e| e.to_string())?;

    for track in &outcome.tracks {
        snapshot.library.tracks.insert(
            track.id.clone(),
            serde_json::to_value(track).map_err(|e| e.to_string())?,
        );
    }
    for f in snapshot.library.folders.iter_mut() {
        if f.id == id {
            f.missing = false;
            f.recursive = use_recursive;
            f.last_scanned_at = Some(library::now_ms());
            f.track_ids = outcome.all_track_ids.clone();
        }
    }
    db.save_snapshot(&snapshot).map_err(|e| e.to_string())?;
    drop(db);
    let _ = app.emit("library://changed", ());
    Ok(serde_json::json!({
        "added": outcome.tracks.len(),
        "skippedDuplicates": outcome.skipped_duplicates,
    }))
}

/// Removes the library entry only. The audio file on disk is NEVER touched.
#[tauri::command]
pub fn remove_folder(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock();
    let mut snapshot = db
        .load_snapshot()
        .map_err(|e| e.to_string())?
        .ok_or("no library")?;
    let track_ids: Vec<String> = snapshot
        .library
        .folders
        .iter()
        .find(|f| f.id == id)
        .map(|f| f.track_ids.clone())
        .unwrap_or_default();

    for track_id in track_ids {
        let is_folder_only = snapshot
            .library
            .tracks
            .get(&track_id)
            .and_then(|v| v.get("sourceKind"))
            .and_then(|v| v.as_str())
            == Some("folder");
        if is_folder_only {
            snapshot.library.tracks.remove(&track_id);
        }
    }
    snapshot.library.folders.retain(|f| f.id != id);
    db.save_snapshot(&snapshot).map_err(|e| e.to_string())?;
    drop(db);
    let _ = app.emit("library://changed", ());
    Ok(())
}

#[tauri::command]
pub fn remove_track(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock();
    let mut snapshot = db
        .load_snapshot()
        .map_err(|e| e.to_string())?
        .ok_or("no library")?;
    snapshot.library.tracks.remove(&id);
    snapshot.library.loose_track_ids.retain(|t| t != &id);
    for folder in snapshot.library.folders.iter_mut() {
        folder.track_ids.retain(|t| t != &id);
    }
    for pl in snapshot.library.playlists.iter_mut() {
        pl.track_ids.retain(|t| t != &id);
    }
    db.save_snapshot(&snapshot).map_err(|e| e.to_string())?;
    drop(db);
    let _ = app.emit("library://changed", ());
    Ok(())
}

#[tauri::command]
pub fn rename_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let db = state.db.lock();
    let mut snapshot = db
        .load_snapshot()
        .map_err(|e| e.to_string())?
        .ok_or("no library")?;
    for folder in snapshot.library.folders.iter_mut() {
        if folder.id == id {
            folder.name = name.trim().to_string();
        }
    }
    db.save_snapshot(&snapshot).map_err(|e| e.to_string())?;
    drop(db);
    let _ = app.emit("library://changed", ());
    Ok(())
}

#[tauri::command]
pub fn read_track_lyrics(path: String) -> Result<Option<String>, String> {
    Ok(crate::metadata::read_lyrics_for_path(std::path::Path::new(
        &path,
    )))
}

#[tauri::command]
pub fn prune_artwork(state: State<'_, AppState>) -> Result<usize, String> {
    let db = state.db.lock();
    let mut referenced = HashSet::new();
    if let Ok(Some(snap)) = db.load_snapshot() {
        for v in snap.library.tracks.values() {
            if let Some(art) = v.get("artwork").and_then(|s| s.as_str()) {
                referenced.insert(art.to_string());
            }
        }
    }
    Ok(crate::metadata::prune_artwork_cache(
        &db.data_dir.join("artwork"),
        &referenced,
    ))
}

/* ----------------------------- playback ---------------------------- */

fn queue_items(snapshot: &AppSnapshot, ids: &[String]) -> Vec<QueueItem> {
    ids.iter()
        .filter_map(|id| snapshot.library.tracks.get(id))
        .filter_map(|value| serde_json::from_value::<crate::model::Track>(value.clone()).ok())
        .map(|track| QueueItem {
            id: track.id,
            path: track.path,
            duration: track.duration,
        })
        .collect()
}

#[tauri::command]
pub fn player_play_queue(
    state: State<'_, AppState>,
    ids: Vec<String>,
    start_index: usize,
    shuffle: bool,
    autoplay: Option<bool>,
    start_position: Option<f64>,
) -> Result<(), String> {
    let snapshot = state
        .db
        .lock()
        .load_snapshot()
        .map_err(|e| e.to_string())?
        .ok_or("no library")?;
    let items = queue_items(&snapshot, &ids);
    state.player.set_queue(
        items,
        start_index,
        shuffle,
        autoplay.unwrap_or(true),
        start_position.unwrap_or(0.0),
    );
    Ok(())
}

#[tauri::command]
pub fn player_enqueue(
    state: State<'_, AppState>,
    id: String,
    play_next: bool,
) -> Result<(), String> {
    let snapshot = state
        .db
        .lock()
        .load_snapshot()
        .map_err(|e| e.to_string())?
        .ok_or("no library")?;
    let items = queue_items(&snapshot, std::slice::from_ref(&id));
    if let Some(item) = items.into_iter().next() {
        state.player.enqueue(item, play_next);
    }
    Ok(())
}

#[tauri::command]
pub fn player_remove_queue_index(state: State<'_, AppState>, index: usize) -> Result<(), String> {
    state.player.remove_queue_index(index);
    Ok(())
}

#[tauri::command]
pub fn player_move_queue_item(
    state: State<'_, AppState>,
    from: usize,
    to: usize,
) -> Result<(), String> {
    state.player.move_queue_item(from, to);
    Ok(())
}

#[tauri::command]
pub fn player_jump_to_index(state: State<'_, AppState>, index: usize) -> Result<(), String> {
    state.player.jump_to_index(index);
    Ok(())
}

#[tauri::command]
pub fn player_play(state: State<'_, AppState>) -> Result<(), String> {
    state.player.play();
    Ok(())
}

#[tauri::command]
pub fn player_pause(state: State<'_, AppState>) -> Result<(), String> {
    state.player.pause();
    Ok(())
}

#[tauri::command]
pub fn player_toggle(state: State<'_, AppState>) -> Result<(), String> {
    state.player.toggle();
    Ok(())
}

#[tauri::command]
pub fn player_stop(state: State<'_, AppState>) -> Result<(), String> {
    state.player.stop();
    Ok(())
}

#[tauri::command]
pub fn player_seek(state: State<'_, AppState>, seconds: f64) -> Result<(), String> {
    state.player.seek(seconds);
    Ok(())
}

#[tauri::command]
pub fn player_next(state: State<'_, AppState>) -> Result<(), String> {
    state.player.next();
    Ok(())
}

#[tauri::command]
pub fn player_previous(state: State<'_, AppState>) -> Result<(), String> {
    state.player.previous();
    Ok(())
}

#[tauri::command]
pub fn player_set_volume(
    state: State<'_, AppState>,
    volume: f64,
    muted: Option<bool>,
) -> Result<(), String> {
    let muted = muted.unwrap_or_else(|| state.player.state().muted);
    state.player.set_volume(volume, muted);
    Ok(())
}

#[tauri::command]
pub fn player_set_speed(state: State<'_, AppState>, speed: f64) -> Result<(), String> {
    state.player.set_speed(speed);
    Ok(())
}

#[tauri::command]
pub fn player_set_eq(state: State<'_, AppState>, eq: EqSettings) -> Result<(), String> {
    state.player.set_eq(eq);
    Ok(())
}

#[tauri::command]
pub fn player_set_shuffle(state: State<'_, AppState>, value: bool) -> Result<(), String> {
    state.player.set_shuffle(value);
    Ok(())
}

#[tauri::command]
pub fn player_set_repeat(state: State<'_, AppState>, value: RepeatMode) -> Result<(), String> {
    state.player.set_repeat(value);
    Ok(())
}

/* -------------------------- windows & tray ------------------------- */

#[tauri::command]
pub fn main_window_show(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub fn app_quit(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn widget_show(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let settings = state.widget.lock().clone();
    if let Some(window) = app.get_webview_window("widget") {
        let _ = window.set_always_on_top(settings.always_on_top);
        let _ = window.set_size(tauri::LogicalSize::new(settings.width, settings.height));
        if settings.x > 0.0 || settings.y > 0.0 {
            let _ = window.set_position(tauri::LogicalPosition::new(settings.x, settings.y));
        }
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub fn widget_hide(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("widget") {
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
pub fn widget_set_always_on_top(
    app: AppHandle,
    state: State<'_, AppState>,
    value: bool,
) -> Result<(), String> {
    state.widget.lock().always_on_top = value;
    if let Some(window) = app.get_webview_window("widget") {
        let _ = window.set_always_on_top(value);
    }
    Ok(())
}

#[tauri::command]
pub fn widget_set_bounds(state: State<'_, AppState>, settings: WidgetSettings) -> Result<(), String> {
    *state.widget.lock() = settings;
    Ok(())
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("Path unavailable: {path}"));
    }
    library::open_in_explorer(&path).map_err(|e| e.to_string())
}
