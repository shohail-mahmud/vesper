/**
 * Typed boundary between the React UI and the native (Tauri 2 / Rust) core.
 *
 * Every native command here matches `src-tauri/src/commands.rs` 1-to-1.
 * In browser preview mode, File System / `<input webkitdirectory>` / HTML5 Drag & Drop
 * + WebAudio + `localStorage` back the exact same API.
 */

import type { AppSnapshot, EqSettings, PlaybackState, RepeatMode, WidgetSettings } from "../types";

type Unlisten = () => void;

export const runtime = {
  get isTauri(): boolean {
    if (typeof window === "undefined") return false;
    return Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);
  },
};

export class NativeUnavailableError extends Error {
  constructor(command: string) {
    super(`Native command "${command}" is unavailable outside the Tauri runtime`);
    this.name = "NativeUnavailableError";
  }
}

export async function nativeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const internals = (window as any).__TAURI_INTERNALS__;
  if (!internals?.invoke) throw new NativeUnavailableError(command);
  return internals.invoke(command, args) as Promise<T>;
}

export async function nativeListen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten> {
  const tauri = (window as any).__TAURI__;
  if (tauri?.event?.listen) {
    const un = await tauri.event.listen(event, (e: { payload: T }) => handler(e.payload));
    return () => {
      void un;
    };
  }
  return () => {};
}

/** Convert local cached artwork file paths into WebView2-safe `asset://` URLs. */
export function resolveArtworkUrl(artwork?: string | null): string | null {
  if (!artwork) return null;
  if (
    artwork.startsWith("blob:") ||
    artwork.startsWith("data:") ||
    artwork.startsWith("http://") ||
    artwork.startsWith("https://") ||
    artwork.startsWith("asset:") ||
    artwork.startsWith("/")
  ) {
    return artwork;
  }
  const convert = (window as any).__TAURI_INTERNALS__?.convertFileSrc;
  if (typeof convert === "function") {
    try {
      return convert(artwork);
    } catch {
      return artwork;
    }
  }
  return artwork;
}

/* ------------------------------------------------------------------ *
 * Native Command Surface (exact mirror of src-tauri/src/commands.rs)
 * ------------------------------------------------------------------ */

export interface NativeApi {
  snapshotLoad(): Promise<AppSnapshot | null>;
  snapshotSave(snapshot: AppSnapshot): Promise<void>;
  pickFolder(): Promise<string | null>;
  pickTracks(): Promise<string[]>;
  importFolder(path: string, recursive: boolean): Promise<{
    added: number;
    skippedDuplicates: number;
    missing: number;
    playlist?: { id: string; name: string };
  }>;
  importTracks(paths: string[]): Promise<{
    added: number;
    skippedDuplicates: number;
    firstTrackId?: string | null;
  }>;
  importDroppedPaths(paths: string[], recursive: boolean): Promise<{
    foldersAdded: number;
    tracksAdded: number;
  }>;
  refreshFolder(id: string, recursive?: boolean): Promise<{ added: number; skippedDuplicates: number }>;
  removeFolder(id: string): Promise<void>;
  removeTrack(id: string): Promise<void>;
  renameFolder(id: string, name: string): Promise<void>;
  readTrackLyrics(path: string): Promise<string | null>;
  pruneArtwork(): Promise<number>;

  playerPlayQueue(
    ids: string[],
    startIndex: number,
    shuffle: boolean,
    autoplay?: boolean,
    startPosition?: number,
  ): Promise<void>;
  playerEnqueue(id: string, playNext: boolean): Promise<void>;
  playerRemoveQueueIndex(index: number): Promise<void>;
  playerMoveQueueItem(from: number, to: number): Promise<void>;
  playerJumpToIndex(index: number): Promise<void>;
  playerPlay(): Promise<void>;
  playerPause(): Promise<void>;
  playerToggle(): Promise<void>;
  playerStop(): Promise<void>;
  playerSeek(seconds: number): Promise<void>;
  playerNext(): Promise<void>;
  playerPrevious(): Promise<void>;
  playerSetVolume(volume: number, muted?: boolean): Promise<void>;
  playerSetSpeed(speed: number): Promise<void>;
  playerSetEq(eq: EqSettings): Promise<void>;
  playerSetShuffle(value: boolean): Promise<void>;
  playerSetRepeat(value: RepeatMode): Promise<void>;

  mainWindowShow(): Promise<void>;
  appQuit(): Promise<void>;
  widgetShow(): Promise<void>;
  widgetHide(): Promise<void>;
  widgetSetAlwaysOnTop(value: boolean): Promise<void>;
  widgetSetBounds(settings: WidgetSettings): Promise<void>;
  openPath(path: string): Promise<void>;
}

export const native: NativeApi = {
  snapshotLoad: () => nativeInvoke("snapshot_load"),
  snapshotSave: (snapshot) => nativeInvoke("snapshot_save", { snapshot }),
  pickFolder: () => nativeInvoke<string | null>("pick_folder"),
  pickTracks: () => nativeInvoke<string[]>("pick_tracks"),
  importFolder: (path, recursive) => nativeInvoke("import_folder", { path, recursive }),
  importTracks: (paths) => nativeInvoke("import_tracks", { paths }),
  importDroppedPaths: (paths, recursive) => nativeInvoke("import_dropped_paths", { paths, recursive }),
  refreshFolder: (id, recursive) => nativeInvoke("refresh_folder", { id, recursive }),
  removeFolder: (id) => nativeInvoke("remove_folder", { id }),
  removeTrack: (id) => nativeInvoke("remove_track", { id }),
  renameFolder: (id, name) => nativeInvoke("rename_folder", { id, name }),
  readTrackLyrics: (path) => nativeInvoke("read_track_lyrics", { path }),
  pruneArtwork: () => nativeInvoke("prune_artwork"),

  playerPlayQueue: (ids, startIndex, shuffle, autoplay = true, startPosition = 0) =>
    nativeInvoke("player_play_queue", { ids, startIndex, shuffle, autoplay, startPosition }),
  playerEnqueue: (id, playNext) => nativeInvoke("player_enqueue", { id, playNext }),
  playerRemoveQueueIndex: (index) => nativeInvoke("player_remove_queue_index", { index }),
  playerMoveQueueItem: (from, to) => nativeInvoke("player_move_queue_item", { from, to }),
  playerJumpToIndex: (index) => nativeInvoke("player_jump_to_index", { index }),
  playerPlay: () => nativeInvoke("player_play"),
  playerPause: () => nativeInvoke("player_pause"),
  playerToggle: () => nativeInvoke("player_toggle"),
  playerStop: () => nativeInvoke("player_stop"),
  playerSeek: (seconds) => nativeInvoke("player_seek", { seconds }),
  playerNext: () => nativeInvoke("player_next"),
  playerPrevious: () => nativeInvoke("player_previous"),
  playerSetVolume: (volume, muted) => nativeInvoke("player_set_volume", { volume, muted }),
  playerSetSpeed: (speed) => nativeInvoke("player_set_speed", { speed }),
  playerSetEq: (eq) => nativeInvoke("player_set_eq", { eq }),
  playerSetShuffle: (value) => nativeInvoke("player_set_shuffle", { value }),
  playerSetRepeat: (value) => nativeInvoke("player_set_repeat", { value }),

  mainWindowShow: () => nativeInvoke("main_window_show"),
  appQuit: () => nativeInvoke("app_quit"),
  widgetShow: () => nativeInvoke("widget_show"),
  widgetHide: () => nativeInvoke("widget_hide"),
  widgetSetAlwaysOnTop: (value) => nativeInvoke("widget_set_always_on_top", { value }),
  widgetSetBounds: (settings) => nativeInvoke("widget_set_bounds", { settings }),
  openPath: (path) => nativeInvoke("open_path", { path }),
};

export const events = {
  playbackState: (cb: (state: Partial<PlaybackState>) => void): Promise<Unlisten> =>
    nativeListen("playback://state", cb),
  libraryChanged: (cb: () => void): Promise<Unlisten> => nativeListen("library://changed", cb),
  fileDrop: (cb: (paths: string[]) => void): Promise<Unlisten> => nativeListen("app://file-drop", cb),
  openFiles: (cb: (paths: string[]) => void): Promise<Unlisten> => nativeListen("app://open-files", cb),
};

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

const LS_SNAPSHOT = "vesper.snapshot.v2";

export async function loadSnapshot(): Promise<AppSnapshot | null> {
  if (runtime.isTauri) {
    try {
      return await native.snapshotLoad();
    } catch (err) {
      console.warn("[vesper] native snapshot load failed, falling back to local cache", err);
    }
  }
  try {
    const raw = localStorage.getItem(LS_SNAPSHOT);
    return raw ? (JSON.parse(raw) as AppSnapshot) : null;
  } catch {
    return null;
  }
}

export async function saveSnapshot(snapshot: AppSnapshot): Promise<void> {
  try {
    localStorage.setItem(LS_SNAPSHOT, JSON.stringify(snapshot));
  } catch {
    /* quota or private mode */
  }
  if (runtime.isTauri) {
    try {
      await native.snapshotSave(snapshot);
    } catch (err) {
      console.warn("[vesper] native snapshot save failed", err);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Cross-window sync for the browser preview (`?window=widget`)
 * ------------------------------------------------------------------ */

const CHANNEL = "vesper://state";

export interface StateChannelMessage {
  kind?: "state" | "command";
  command?: "toggle" | "next" | "prev" | "shuffle" | "repeat" | "openMain";
  seek?: number;
  volume?: number;
  playback?: Partial<PlaybackState>;
  widget?: WidgetSettings;
  track?: import("../types").Track | null;
}

export function openStateChannel(onReceive: (message: StateChannelMessage) => void): {
  post: (message: StateChannelMessage) => void;
  close: Unlisten;
} {
  if (typeof BroadcastChannel === "undefined") {
    return { post: () => {}, close: () => {} };
  }
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event) => onReceive(event.data);
  return {
    post: (message) => channel.postMessage(message),
    close: () => channel.close(),
  };
}

/* ------------------------------------------------------------------ *
 * File & Folder pickers + HTML5 Drag-and-Drop (browser preview)
 * ------------------------------------------------------------------ */

export interface PickedFile {
  file: File;
  relativePath: string;
}

function inputToFileList(accept: string, multiple: boolean, directory: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (!directory) input.accept = accept;
    input.multiple = multiple;
    if (directory) {
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
    }
    input.style.position = "fixed";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => finish(Array.from(input.files ?? [])));
    window.addEventListener(
      "focus",
      () => {
        window.setTimeout(() => finish(Array.from(input.files ?? [])), 600);
      },
      { once: true },
    );
    document.body.appendChild(input);
    input.click();
  });
}

export async function pickFolderFiles(): Promise<PickedFile[]> {
  const files = await inputToFileList("audio/*", true, true);
  return files.map((file) => ({
    file,
    relativePath: (file as unknown as { webkitRelativePath?: string }).webkitRelativePath || file.name,
  }));
}

export async function pickTrackFiles(): Promise<File[]> {
  return inputToFileList("audio/*,.mp3,.flac,.wav,.m4a,.aac,.ogg,.oga,.opus,.wma,.aiff,.lrc", true, false);
}

/** Recursively extract dropped files + folders from a browser `DataTransfer`. */
export async function readDroppedItems(
  dataTransfer: DataTransfer,
): Promise<{ folders: Map<string, PickedFile[]>; looseFiles: File[] }> {
  const folders = new Map<string, PickedFile[]>();
  const looseFiles: File[] = [];

  const readEntry = async (entry: any, prefix = ""): Promise<void> => {
    if (!entry) return;
    if (entry.isFile) {
      const file = await new Promise<File | null>((res) => entry.file(res, () => res(null)));
      if (!file) return;
      if (prefix) {
        const rel = `${prefix}/${file.name}`;
        const root = prefix.split("/")[0];
        if (!folders.has(root)) folders.set(root, []);
        folders.get(root)!.push({ file, relativePath: rel });
      } else {
        looseFiles.push(file);
      }
      return;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const children: any[] = [];
      while (true) {
        const batch: any[] = await new Promise((res) => reader.readEntries(res, () => res([])));
        if (!batch.length) break;
        children.push(...batch);
      }
      const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      for (const child of children) {
        await readEntry(child, nextPrefix);
      }
    }
  };

  const items = Array.from(dataTransfer.items ?? []);
  const entries = items.map((item) => (item as any).webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length > 0) {
    for (const entry of entries) {
      await readEntry(entry, "");
    }
  } else {
    for (const file of Array.from(dataTransfer.files ?? [])) {
      looseFiles.push(file);
    }
  }
  return { folders, looseFiles };
}
