//! Persistent local SQLite library (`%LOCALAPPDATA%\Vesper\library.db`).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};

use crate::model::{
    AppSnapshot, EqSettings, FolderPlaylist, LibraryState, PlaybackSnapshot, RepeatMode, Settings,
    UserPlaylist, WidgetSettings,
};

pub struct Database {
    conn: Connection,
    pub data_dir: PathBuf,
}

impl Database {
    pub fn open() -> Result<Self> {
        let data_dir = dirs::data_dir()
            .context("could not resolve the per-user application data directory")?
            .join("Vesper");
        Self::open_in(data_dir)
    }

    pub fn open_in(data_dir: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&data_dir)?;
        std::fs::create_dir_all(data_dir.join("artwork"))?;
        let conn = Connection::open_in_memory_or_path(&data_dir.join("library.db"))?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA synchronous = NORMAL;",
        )?;
        let db = Database { conn, data_dir };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS folders (
                id              TEXT PRIMARY KEY,
                name            TEXT NOT NULL,
                path            TEXT NOT NULL,
                recursive       INTEGER NOT NULL DEFAULT 0,
                missing         INTEGER NOT NULL DEFAULT 0,
                added_at        INTEGER NOT NULL,
                last_scanned_at INTEGER,
                sample          INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS tracks (
                id             TEXT PRIMARY KEY,
                title          TEXT NOT NULL,
                artist         TEXT,
                album          TEXT,
                track_number   INTEGER,
                duration       REAL NOT NULL DEFAULT 0,
                path           TEXT NOT NULL,
                key            TEXT NOT NULL,
                artwork        TEXT,
                custom_artwork INTEGER NOT NULL DEFAULT 0,
                lyrics         TEXT,
                source_kind    TEXT NOT NULL,
                folder_id      TEXT,
                size_bytes     INTEGER,
                favorite       INTEGER NOT NULL DEFAULT 0,
                play_count     INTEGER NOT NULL DEFAULT 0,
                last_played_at INTEGER,
                missing        INTEGER NOT NULL DEFAULT 0,
                error          TEXT
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_key ON tracks(key);
            CREATE TABLE IF NOT EXISTS folder_tracks (
                folder_id TEXT NOT NULL,
                track_id  TEXT NOT NULL,
                position  INTEGER NOT NULL,
                PRIMARY KEY (folder_id, track_id)
            );
            CREATE TABLE IF NOT EXISTS loose_tracks (
                track_id TEXT PRIMARY KEY,
                position INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_playlists (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_playlist_tracks (
                playlist_id TEXT NOT NULL,
                track_id    TEXT NOT NULL,
                position    INTEGER NOT NULL,
                PRIMARY KEY (playlist_id, track_id)
            );
            CREATE TABLE IF NOT EXISTS playback (
                id       INTEGER PRIMARY KEY CHECK (id = 1),
                track_id TEXT,
                position REAL NOT NULL DEFAULT 0,
                volume   REAL NOT NULL DEFAULT 0.72,
                muted    INTEGER NOT NULL DEFAULT 0,
                shuffle  INTEGER NOT NULL DEFAULT 0,
                repeat   TEXT NOT NULL DEFAULT 'off',
                speed    REAL NOT NULL DEFAULT 1.0,
                eq_json  TEXT
            );
            INSERT OR IGNORE INTO playback (id) VALUES (1);
            "#,
        )?;

        for alter in [
            "ALTER TABLE tracks ADD COLUMN track_number INTEGER",
            "ALTER TABLE tracks ADD COLUMN custom_artwork INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE tracks ADD COLUMN lyrics TEXT",
            "ALTER TABLE tracks ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE tracks ADD COLUMN last_played_at INTEGER",
            "ALTER TABLE playback ADD COLUMN speed REAL NOT NULL DEFAULT 1.0",
            "ALTER TABLE playback ADD COLUMN eq_json TEXT",
        ] {
            let _ = self.conn.execute(alter, []);
        }
        Ok(())
    }

    /// Immediately updates a single track's cover art & custom_artwork flag in SQLite.
    /// Returns the previous artwork path if one was set.
    pub fn set_track_artwork(
        &self,
        track_id: &str,
        artwork: Option<&str>,
        custom: bool,
    ) -> Result<Option<String>> {
        let prev: Option<String> = self
            .conn
            .query_row(
                "SELECT artwork FROM tracks WHERE id = ?1",
                params![track_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();

        self.conn.execute(
            "UPDATE tracks SET artwork = ?1, custom_artwork = ?2 WHERE id = ?3",
            params![artwork, custom as i64, track_id],
        )?;
        Ok(prev)
    }

    pub fn load_snapshot(&self) -> Result<Option<AppSnapshot>> {
        let initialized: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'settings'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        let has_rows: i64 = self.conn.query_row(
            "SELECT (SELECT COUNT(*) FROM folders) + (SELECT COUNT(*) FROM tracks)",
            [],
            |row| row.get(0),
        )?;
        if initialized.is_none() && has_rows == 0 {
            return Ok(None);
        }

        let folders: Vec<FolderPlaylist> = {
            let mut stmt = self.conn.prepare(
                "SELECT id, name, path, recursive, missing, added_at, last_scanned_at, sample
                 FROM folders ORDER BY added_at ASC",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(FolderPlaylist {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    recursive: row.get::<_, i64>(3)? != 0,
                    missing: row.get::<_, i64>(4)? != 0,
                    added_at: row.get::<_, i64>(5)? as u64,
                    last_scanned_at: row.get::<_, Option<i64>>(6)?.map(|v| v as u64),
                    sample: row.get::<_, i64>(7)? != 0,
                    track_ids: Vec::new(),
                })
            })?;
            let mut folders: Vec<FolderPlaylist> = rows.filter_map(|r| r.ok()).collect();

            let mut order = self.conn.prepare(
                "SELECT track_id FROM folder_tracks WHERE folder_id = ?1 ORDER BY position ASC",
            )?;
            for folder in folders.iter_mut() {
                let ids = order
                    .query_map([&folder.id], |row| row.get::<_, String>(0))?
                    .filter_map(|r| r.ok())
                    .collect();
                folder.track_ids = ids;
            }
            folders
        };

        let mut tracks = serde_json::Map::new();
        {
            let mut stmt = self.conn.prepare(
                "SELECT id, title, artist, album, track_number, duration, path, key, artwork,
                        custom_artwork, lyrics, source_kind, folder_id, size_bytes, favorite,
                        play_count, last_played_at, missing, error FROM tracks",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(crate::model::Track {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    artist: row.get(2)?,
                    album: row.get(3)?,
                    track_number: row.get::<_, Option<i64>>(4)?.map(|v| v as u32),
                    duration: row.get(5)?,
                    path: row.get(6)?,
                    key: row.get(7)?,
                    artwork: row.get(8)?,
                    custom_artwork: row.get::<_, i64>(9)? != 0,
                    lyrics: row.get(10)?,
                    source_kind: row.get(11)?,
                    folder_id: row.get(12)?,
                    size_bytes: row.get::<_, Option<i64>>(13)?.map(|v| v as u64),
                    favorite: row.get::<_, i64>(14)? != 0,
                    play_count: row.get::<_, i64>(15)? as u32,
                    last_played_at: row.get::<_, Option<i64>>(16)?.map(|v| v as u64),
                    missing: row.get::<_, i64>(17)? != 0,
                    error: row.get(18)?,
                })
            })?;
            for track in rows.filter_map(|r| r.ok()) {
                let id = track.id.clone();
                tracks.insert(id, serde_json::to_value(track)?);
            }
        }

        let mut loose_track_ids: Vec<String> = {
            let mut stmt = self
                .conn
                .prepare("SELECT track_id FROM loose_tracks ORDER BY position ASC")?;
            let ids: Vec<String> = stmt
                .query_map([], |row| row.get::<_, String>(0))?
                .filter_map(|r| r.ok())
                .filter(|id| tracks.contains_key(id))
                .collect();
            ids
        };
        let known_loose: HashSet<String> = loose_track_ids.iter().cloned().collect();
        let in_folders: HashSet<String> = folders
            .iter()
            .flat_map(|f| f.track_ids.iter().cloned())
            .collect();
        for (id, val) in &tracks {
            if !known_loose.contains(id)
                && !in_folders.contains(id)
                && val.get("sourceKind").and_then(|s| s.as_str()) == Some("loose")
            {
                loose_track_ids.push(id.clone());
            }
        }

        let playlists: Vec<UserPlaylist> = {
            let mut stmt = self.conn.prepare(
                "SELECT id, name, created_at FROM user_playlists ORDER BY created_at ASC",
            )?;
            let mut list: Vec<UserPlaylist> = stmt
                .query_map([], |row| {
                    Ok(UserPlaylist {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        created_at: row.get::<_, i64>(2)? as u64,
                        track_ids: Vec::new(),
                    })
                })?
                .filter_map(|r| r.ok())
                .collect();
            let mut order = self.conn.prepare(
                "SELECT track_id FROM user_playlist_tracks WHERE playlist_id = ?1 ORDER BY position ASC",
            )?;
            for pl in list.iter_mut() {
                pl.track_ids = order
                    .query_map([&pl.id], |row| row.get::<_, String>(0))?
                    .filter_map(|r| r.ok())
                    .filter(|id| tracks.contains_key(id))
                    .collect();
            }
            list
        };

        let settings: Settings = initialized
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();

        let widget: WidgetSettings = self
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'widget'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();

        let playback: PlaybackSnapshot = self
            .conn
            .query_row(
                "SELECT track_id, position, volume, muted, shuffle, repeat, speed, eq_json FROM playback WHERE id = 1",
                [],
                |row| {
                    let eq_raw: Option<String> = row.get(7)?;
                    let eq = eq_raw
                        .and_then(|raw| serde_json::from_str::<EqSettings>(&raw).ok())
                        .unwrap_or_default();
                    Ok(PlaybackSnapshot {
                        track_id: row.get(0)?,
                        position: row.get(1)?,
                        volume: row.get(2)?,
                        muted: row.get::<_, i64>(3)? != 0,
                        shuffle: row.get::<_, i64>(4)? != 0,
                        repeat: match row.get::<_, String>(5)?.as_str() {
                            "all" => RepeatMode::All,
                            "one" => RepeatMode::One,
                            _ => RepeatMode::Off,
                        },
                        speed: row.get::<_, Option<f64>>(6)?.unwrap_or(1.0),
                        eq,
                    })
                },
            )
            .optional()?
            .unwrap_or_default();

        Ok(Some(AppSnapshot {
            version: 2,
            library: LibraryState {
                folders,
                tracks,
                loose_track_ids,
                playlists,
            },
            settings,
            widget,
            playback,
        }))
    }

    pub fn save_snapshot(&self, snapshot: &AppSnapshot) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;

        // Preserve any custom covers set via `set_track_cover` so debounced snapshot writes
        // or folder refreshes NEVER overwrite a user's saved song cover!
        let preserved_covers: HashMap<String, String> = {
            let mut stmt = tx.prepare(
                "SELECT id, artwork FROM tracks WHERE custom_artwork = 1 AND artwork IS NOT NULL",
            )?;
            let pairs: HashMap<String, String> = stmt
                .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
                .filter_map(|r| r.ok())
                .collect();
            pairs
        };

        tx.execute("DELETE FROM folder_tracks", [])?;
        tx.execute("DELETE FROM loose_tracks", [])?;
        tx.execute("DELETE FROM user_playlist_tracks", [])?;
        tx.execute("DELETE FROM folders", [])?;
        tx.execute("DELETE FROM user_playlists", [])?;
        tx.execute("DELETE FROM tracks", [])?;

        for (id, value) in &snapshot.library.tracks {
            let mut track: crate::model::Track = serde_json::from_value(value.clone())?;
            if let Some(saved_art) = preserved_covers.get(id) {
                if track.artwork.is_none() || track.custom_artwork {
                    if track.artwork.is_none() {
                        track.artwork = Some(saved_art.clone());
                    }
                    track.custom_artwork = true;
                }
            }
            tx.execute(
                "INSERT INTO tracks (
                    id, title, artist, album, track_number, duration, path, key, artwork,
                    custom_artwork, lyrics, source_kind, folder_id, size_bytes, favorite,
                    play_count, last_played_at, missing, error
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
                params![
                    id,
                    track.title,
                    track.artist,
                    track.album,
                    track.track_number.map(|v| v as i64),
                    track.duration,
                    track.path,
                    track.key,
                    track.artwork,
                    track.custom_artwork as i64,
                    track.lyrics,
                    track.source_kind,
                    track.folder_id,
                    track.size_bytes.map(|v| v as i64),
                    track.favorite as i64,
                    track.play_count as i64,
                    track.last_played_at.map(|v| v as i64),
                    track.missing as i64,
                    track.error,
                ],
            )?;
        }

        for folder in &snapshot.library.folders {
            tx.execute(
                "INSERT INTO folders (id, name, path, recursive, missing, added_at, last_scanned_at, sample)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    folder.id,
                    folder.name,
                    folder.path,
                    folder.recursive as i64,
                    folder.missing as i64,
                    folder.added_at as i64,
                    folder.last_scanned_at.map(|v| v as u64).map(|v| v as i64),
                    folder.sample as i64,
                ],
            )?;
            for (position, track_id) in folder.track_ids.iter().enumerate() {
                tx.execute(
                    "INSERT OR REPLACE INTO folder_tracks (folder_id, track_id, position) VALUES (?1, ?2, ?3)",
                    params![folder.id, track_id, position as i64],
                )?;
            }
        }

        for (position, track_id) in snapshot.library.loose_track_ids.iter().enumerate() {
            tx.execute(
                "INSERT OR REPLACE INTO loose_tracks (track_id, position) VALUES (?1, ?2)",
                params![track_id, position as i64],
            )?;
        }

        for pl in &snapshot.library.playlists {
            tx.execute(
                "INSERT INTO user_playlists (id, name, created_at) VALUES (?1, ?2, ?3)",
                params![pl.id, pl.name, pl.created_at as i64],
            )?;
            for (position, track_id) in pl.track_ids.iter().enumerate() {
                tx.execute(
                    "INSERT OR REPLACE INTO user_playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)",
                    params![pl.id, track_id, position as i64],
                )?;
            }
        }

        tx.execute(
            "INSERT INTO settings (key, value) VALUES ('settings', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![serde_json::to_string(&snapshot.settings)?],
        )?;
        tx.execute(
            "INSERT INTO settings (key, value) VALUES ('widget', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![serde_json::to_string(&snapshot.widget)?],
        )?;
        tx.execute(
            "UPDATE playback
             SET track_id = ?1, position = ?2, volume = ?3, muted = ?4, shuffle = ?5,
                 repeat = ?6, speed = ?7, eq_json = ?8
             WHERE id = 1",
            params![
                snapshot.playback.track_id,
                snapshot.playback.position,
                snapshot.playback.volume,
                snapshot.playback.muted as i64,
                snapshot.playback.shuffle as i64,
                match snapshot.playback.repeat {
                    RepeatMode::All => "all",
                    RepeatMode::One => "one",
                    RepeatMode::Off => "off",
                },
                snapshot.playback.speed,
                serde_json::to_string(&snapshot.playback.eq)?,
            ],
        )?;

        tx.commit()?;
        Ok(())
    }
}

trait OpenPathExt {
    fn open_in_memory_or_path(path: &Path) -> rusqlite::Result<Connection>;
}

impl OpenPathExt for Connection {
    fn open_in_memory_or_path(path: &Path) -> rusqlite::Result<Connection> {
        Connection::open(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Track;

    #[test]
    fn round_trip_persists_loose_tracks_custom_covers_and_deletions() {
        let dir = std::env::temp_dir().join(format!("vesper-db-test-{}", crate::library::now_ms()));
        let db = Database::open_in(dir.clone()).unwrap();
        assert!(db.load_snapshot().unwrap().is_none());

        let track = Track {
            id: "t1".into(),
            title: "Night Drive".into(),
            artist: Some("Kiasmos".into()),
            album: None,
            track_number: Some(1),
            duration: 215.0,
            path: "C:\\Music\\Night Drive.flac".into(),
            key: "t1".into(),
            artwork: None,
            custom_artwork: false,
            lyrics: None,
            source_kind: "loose".into(),
            folder_id: None,
            size_bytes: Some(1024),
            favorite: true,
            play_count: 2,
            last_played_at: None,
            missing: false,
            error: None,
        };

        let mut map = serde_json::Map::new();
        map.insert("t1".into(), serde_json::to_value(&track).unwrap());
        let mut snap = AppSnapshot {
            version: 2,
            library: LibraryState {
                folders: vec![],
                tracks: map,
                loose_track_ids: vec!["t1".into()],
                playlists: vec![UserPlaylist {
                    id: "p1".into(),
                    name: "Late Night".into(),
                    track_ids: vec!["t1".into()],
                    created_at: 100,
                }],
            },
            settings: Settings::default(),
            widget: WidgetSettings::default(),
            playback: PlaybackSnapshot::default(),
        };

        db.save_snapshot(&snap).unwrap();

        // Assign custom cover directly in SQLite and confirm stale snapshot save keeps it!
        db.set_track_artwork("t1", Some("C:\\AppData\\Vesper\\artwork\\custom-abc.png"), true)
            .unwrap();
        db.save_snapshot(&snap).unwrap();
        let with_cover = db.load_snapshot().unwrap().unwrap();
        let saved_track: Track =
            serde_json::from_value(with_cover.library.tracks.get("t1").unwrap().clone()).unwrap();
        assert!(saved_track.custom_artwork);
        assert_eq!(
            saved_track.artwork.as_deref(),
            Some("C:\\AppData\\Vesper\\artwork\\custom-abc.png")
        );

        // Removing custom cover explicitly clears it
        db.set_track_artwork("t1", None, false).unwrap();
        let after_remove = db.load_snapshot().unwrap().unwrap();
        let cleared_track: Track =
            serde_json::from_value(after_remove.library.tracks.get("t1").unwrap().clone()).unwrap();
        assert!(!cleared_track.custom_artwork);
        assert!(cleared_track.artwork.is_none());

        // Removing the track persists deletion cleanly
        snap.library.tracks.clear();
        snap.library.loose_track_ids.clear();
        snap.library.playlists.clear();
        db.save_snapshot(&snap).unwrap();

        let reloaded = db.load_snapshot().unwrap().unwrap();
        assert!(reloaded.library.tracks.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }
}
