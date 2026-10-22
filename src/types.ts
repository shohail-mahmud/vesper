/**
 * Shared domain model between the React UI and the Rust core (`src-tauri/src/model.rs`).
 */

export type TrackSourceKind = "folder" | "loose" | "sample";
export type RepeatMode = "off" | "all" | "one";
export type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "error";
export type ThemeMode = "light" | "dark";

export interface EqSettings {
  enabled: boolean;
  preset: string;
  preamp: number;
  /** 10 bands in dB (-12..+12): 32, 64, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Hz */
  bands: number[];
}

export interface Track {
  id: string;
  /** Display title. From ID3/Vorbis/MP4 tags when available, else the file name. */
  title: string;
  /** From tags only (or filename Artist - Title). Never invented. */
  artist?: string;
  album?: string;
  trackNumber?: number;
  /** Seconds. 0 means "not yet known". */
  duration: number;
  /** Original file location, never copied into app storage. */
  path: string;
  /** Normalised identity used for de-duplication. */
  key: string;
  artwork?: string;
  lyrics?: string;
  sourceKind: TrackSourceKind;
  folderId?: string;
  sizeBytes?: number;
  favorite?: boolean;
  playCount?: number;
  lastPlayedAt?: number;
  /** Set when the file can no longer be found at `path`. */
  missing?: boolean;
  /** Media error description for the last playback attempt. */
  error?: string;
}

export interface FolderPlaylist {
  id: string;
  /** Display name, editable by the user. The physical folder is never renamed. */
  name: string;
  path: string;
  trackIds: string[];
  /** Nested-directory policy for this folder. */
  recursive: boolean;
  /** The folder could not be reached on the last scan. Entry is preserved. */
  missing: boolean;
  addedAt: number;
  lastScannedAt?: number;
  sample?: boolean;
}

export interface UserPlaylist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}

export interface PlaybackState {
  status: PlaybackStatus;
  trackId: string | null;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  speed: number;
  eq: EqSettings;
  /** Play order currently in effect (shuffled when `shuffle` is true). */
  queue: string[];
  /** Playlist order, restored when shuffle is switched off. */
  baseQueue: string[];
  index: number;
  deviceAvailable?: boolean;
  error?: string;
}

export interface WidgetSettings {
  visible: boolean;
  alwaysOnTop: boolean;
  /** 0.55 – 1.0 */
  opacity: number;
  size: "compact" | "expanded";
  showArtwork: boolean;
  showProgress: boolean;
  showVolume: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  clickThrough: boolean;
}

export interface Settings {
  recursiveScan: boolean;
  rememberLastPlaylist: boolean;
  lastPlaylistId: string | null;
  launchAtStartup: boolean;
  showSampleCollection: boolean;
  artworkSize: number;
  theme: ThemeMode;
  closeToTray: boolean;
}

export interface LibraryState {
  folders: FolderPlaylist[];
  tracks: Record<string, Track>;
  looseTrackIds: string[];
  playlists: UserPlaylist[];
}

export interface AppSnapshot {
  version: number;
  library: LibraryState;
  settings: Settings;
  widget: WidgetSettings;
  playback: Pick<
    PlaybackState,
    "trackId" | "position" | "volume" | "muted" | "shuffle" | "repeat" | "speed" | "eq"
  >;
}

export interface ImportResult {
  added: number;
  skippedDuplicates: number;
  missing: number;
}
