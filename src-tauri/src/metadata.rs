//! Metadata, artwork & lyrics extraction via `lofty`.
//!
//! Only the tag header block is read — never the full audio payload. Embedded
//! cover art is deduplicated by SHA-256 into `%LOCALAPPDATA%\Vesper\artwork\`.
//! Lyrics are resolved from `.lrc` sidecar files first, then embedded tags,
//! then `.txt` sidecars.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use anyhow::Result;
use lofty::picture::PictureType;
use lofty::prelude::*;
use lofty::probe::Probe;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Default)]
pub struct TrackMeta {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track_number: Option<u32>,
    pub duration: f64,
    pub artwork: Option<String>,
    pub lyrics: Option<String>,
}

fn artwork_cache_path(cache_dir: &Path, bytes: &[u8], extension: &str) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hex::encode(hasher.finalize());
    cache_dir.join(format!("{digest}.{extension}"))
}

pub fn read(path: &Path, cache_dir: &Path) -> Result<TrackMeta> {
    let mut meta = TrackMeta::default();

    let tagged_file = match Probe::open(path).and_then(|p| p.read()) {
        Ok(file) => file,
        Err(err) => {
            eprintln!("[vesper] metadata unreadable for {}: {err}", path.display());
            meta.lyrics = find_sidecar_lyrics(path);
            return Ok(meta);
        }
    };

    meta.duration = tagged_file.properties().duration().as_secs_f64();

    if let Some(tag) = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())
    {
        meta.title = tag
            .get_string(&ItemKey::TrackTitle)
            .map(|s| s.to_string())
            .filter(|s| !s.trim().is_empty());
        meta.artist = tag
            .get_string(&ItemKey::TrackArtist)
            .or_else(|| tag.get_string(&ItemKey::AlbumArtist))
            .map(|s| s.to_string())
            .filter(|s| !s.trim().is_empty());
        meta.album = tag
            .get_string(&ItemKey::AlbumTitle)
            .map(|s| s.to_string())
            .filter(|s| !s.trim().is_empty());
        meta.track_number = tag.track();

        let embedded_lyrics = tag
            .get_string(&ItemKey::Lyrics)
            .map(|s| s.to_string())
            .filter(|s| !s.trim().is_empty());
        meta.lyrics = find_sidecar_lyrics(path).or(embedded_lyrics);

        if let Some(picture) = tag
            .pictures()
            .iter()
            .find(|p| p.pic_type() == PictureType::CoverFront)
            .or_else(|| tag.pictures().first())
        {
            if let Some(cached) = cache_artwork(cache_dir, picture) {
                meta.artwork = Some(cached.to_string_lossy().to_string());
            }
        }
    } else {
        meta.lyrics = find_sidecar_lyrics(path);
    }

    // Folder cover fallback (`cover.jpg` / `folder.jpg` / `front.jpg` next to audio file)
    if meta.artwork.is_none() {
        meta.artwork = find_folder_artwork(path);
    }

    Ok(meta)
}

pub fn read_lyrics_for_path(path: &Path) -> Option<String> {
    if let Some(lrc) = find_sidecar_lyrics(path) {
        return Some(lrc);
    }
    let tagged_file = Probe::open(path).and_then(|p| p.read()).ok()?;
    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag())?;
    tag.get_string(&ItemKey::Lyrics)
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty())
}

fn find_sidecar_lyrics(audio_path: &Path) -> Option<String> {
    let parent = audio_path.parent()?;
    let stem = audio_path.file_stem()?.to_string_lossy().to_lowercase();

    for ext in ["lrc", "txt"] {
        let direct = audio_path.with_extension(ext);
        if direct.is_file() {
            if let Ok(content) = std::fs::read_to_string(&direct) {
                if !content.trim().is_empty() {
                    return Some(content);
                }
            }
        }
    }

    // Case-insensitive match inside parent folder
    if let Ok(entries) = std::fs::read_dir(parent) {
        for entry in entries.filter_map(|e| e.ok()) {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let entry_stem = p
                .file_stem()
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            let entry_ext = p
                .extension()
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if entry_stem == stem && entry_ext == "lrc" {
                if let Ok(content) = std::fs::read_to_string(&p) {
                    if !content.trim().is_empty() {
                        return Some(content);
                    }
                }
            }
        }
    }
    None
}

fn find_folder_artwork(audio_path: &Path) -> Option<String> {
    let parent = audio_path.parent()?;
    for candidate in [
        "cover.jpg",
        "cover.png",
        "folder.jpg",
        "folder.png",
        "front.jpg",
        "album.jpg",
    ] {
        let p = parent.join(candidate);
        if p.is_file() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

fn cache_artwork(cache_dir: &Path, picture: &lofty::picture::Picture) -> Option<PathBuf> {
    let bytes = picture.data();
    if bytes.len() < 256 || bytes.len() > 8_000_000 {
        return None;
    }
    let extension = match picture.mime_type() {
        Some(lofty::picture::MimeType::Png) => "png",
        Some(lofty::picture::MimeType::Gif) => "gif",
        _ => "jpg",
    };
    let target = artwork_cache_path(cache_dir, bytes, extension);
    if !target.exists() {
        std::fs::write(&target, bytes).ok()?;
    }
    Some(target)
}

/// Remove unreferenced cached cover art files so `%LOCALAPPDATA%\Vesper\artwork` never grows unbounded.
pub fn prune_artwork_cache(cache_dir: &Path, referenced: &HashSet<String>) -> usize {
    let mut removed = 0usize;
    let Ok(entries) = std::fs::read_dir(cache_dir) else {
        return 0;
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let full = path.to_string_lossy().to_string();
        if !referenced.contains(&full) && std::fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// Human-readable title fallback when the file carries no title tag.
pub fn title_from_file_name(path: &Path) -> String {
    let raw = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown track".into());
    let trimmed = raw
        .trim_start_matches(|c: char| c.is_ascii_digit() || c == '.' || c == ' ' || c == '_' || c == '-');
    let trimmed = trimmed.replace('_', " ");
    if trimmed.trim().is_empty() {
        raw
    } else {
        trimmed.trim().to_string()
    }
}
