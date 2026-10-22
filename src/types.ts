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
  bands: number[];
}

export interface Track {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  trackNumber?: number;
  duration: number;
  path: string;
  key: string;
  artwork?: string;
  /** True when user explicitly set a custom cover image on this song. */
  customArtwork?: boolean;
  lyrics?: string;
  sourceKind: TrackSourceKind;
  folderId?: string;
  sizeBytes?: number;
  favorite?: boolean;
  playCount?: number;
  lastPlayedAt?: number;
  missing?: boolean;
  error?: string;
}

export interface FolderPlaylist {
  id: string;
  name: string;
  path: string;
  trackIds: string[];
  recursive: boolean;
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
  queue: string[];
  baseQueue: string[];
  index: number;
  deviceAvailable?: boolean;
  error?: string;
}

export interface WidgetSettings {
  visible: boolean;
  alwaysOnTop: boolean;
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
