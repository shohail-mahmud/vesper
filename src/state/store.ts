/**
 * Shared application state + playback engine (Tauri 2 Native + WebAudio fallback).
 *
 * Preserves all folder & single-track import logic, non-destructive library
 * management, Fisher–Yates shuffle & repeat policies, and floating desktop widget
 * synchronisation — while wiring up the real multi-threaded Rust audio engine,
 * 10-band biquad equalizer, queue management, custom playlists, favorites,
 * synced lyrics, drag-and-drop, and Windows system integration.
 */

import { useSyncExternalStore } from "react";
import type {
  AppSnapshot,
  EqSettings,
  FolderPlaylist,
  LibraryState,
  PlaybackState,
  RepeatMode,
  Settings,
  Track,
  UserPlaylist,
  WidgetSettings,
} from "../types";
import {
  artistFromFileName,
  folderFromRelativePath,
  isAudioFile,
  normalizePath,
  signatureKey,
  stripExtension,
  titleFromFileName,
  trackKey,
} from "../lib/path";
import { planImport, selectImportableFiles } from "../lib/import-policy";
import { readTags } from "../lib/id3";
import { buildQueue, nextIndex, previousIndex, shuffleArray } from "../lib/shuffle";
import { DEFAULT_EQ, EQ_FREQUENCIES, normalizeEq, presetToEq } from "../lib/eq";
import {
  events,
  loadSnapshot,
  native,
  openStateChannel,
  pickCoverDataUrlWeb,
  pickFolderFiles,
  pickTrackFiles,
  readDroppedItems,
  resolveArtworkUrl,
  runtime,
  saveSnapshot,
  type PickedFile,
} from "./bridge";

export type View =
  | { name: "home" }
  | { name: "playlist"; id: string }
  | { name: "userPlaylist"; id: string }
  | { name: "tracks" }
  | { name: "albums" }
  | { name: "artists" }
  | { name: "favorites" }
  | { name: "settings" };

export type DrawerPanel = "none" | "queue" | "lyrics" | "eq";

export interface Toast {
  id: string;
  tone: "info" | "error" | "success";
  title: string;
  detail?: string;
}

export interface AppState {
  ready: boolean;
  backend: "native" | "web";
  view: View;
  drawer: DrawerPanel;
  searchQuery: string;
  library: LibraryState;
  settings: Settings;
  widget: WidgetSettings;
  playback: PlaybackState;
  toasts: Toast[];
  busy: { label: string; processed: number; total: number } | null;
}

const SNAPSHOT_VERSION = 2;

const defaultSettings: Settings = {
  recursiveScan: false,
  rememberLastPlaylist: true,
  lastPlaylistId: null,
  launchAtStartup: false,
  showSampleCollection: false,
  artworkSize: 320,
  theme: "light",
  // Closing the main window must quit + stop playback by default.
  // "Close to tray" is an explicit opt-in in Settings only.
  closeToTray: false,
};

const defaultWidget: WidgetSettings = {
  visible: false,
  alwaysOnTop: false,
  opacity: 0.96,
  size: "expanded",
  showArtwork: true,
  showProgress: true,
  showVolume: true,
  x: 0,
  y: 0,
  width: 424,
  height: 112,
  clickThrough: false,
};

const defaultPlayback: PlaybackState = {
  status: "idle",
  trackId: null,
  position: 0,
  duration: 0,
  volume: 0.72,
  muted: false,
  shuffle: false,
  repeat: "off",
  speed: 1.0,
  eq: DEFAULT_EQ,
  queue: [],
  baseQueue: [],
  index: -1,
  deviceAvailable: true,
};

let state: AppState = {
  ready: false,
  backend: runtime.isTauri ? "native" : "web",
  view: { name: "home" },
  drawer: "none",
  searchQuery: "",
  library: { folders: [], tracks: {}, looseTrackIds: [], playlists: [] },
  settings: defaultSettings,
  widget: defaultWidget,
  playback: defaultPlayback,
  toasts: [],
  busy: null,
};

const listeners = new Set<() => void>();
let snapshotTimer: number | null = null;
let channelSync: ReturnType<typeof openStateChannel> | null = null;
let isWidgetWindow = false;
let suppressPersist = false;

function notify(skipPersist = false) {
  for (const listener of listeners) listener();
  if (!skipPersist && !suppressPersist && !isWidgetWindow) {
    schedulePersist();
  }
  if (!isWidgetWindow && channelSync) {
    const track = state.playback.trackId ? state.library.tracks[state.playback.trackId] : null;
    channelSync.post({
      kind: "state",
      playback: state.playback,
      widget: state.widget,
      track: track ?? null,
    });
  }
}

function flushPersistNow() {
  if (snapshotTimer !== null) {
    window.clearTimeout(snapshotTimer);
    snapshotTimer = null;
  }
  if (!suppressPersist && !isWidgetWindow) {
    void saveSnapshot(toSnapshot(state));
  }
}

function schedulePersist() {
  if (snapshotTimer !== null) window.clearTimeout(snapshotTimer);
  snapshotTimer = window.setTimeout(() => {
    snapshotTimer = null;
    if (!suppressPersist && !isWidgetWindow) {
      void saveSnapshot(toSnapshot(state));
    }
  }, 120);
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): AppState {
  return state;
}

export function useApp(): AppState {
  return useSyncExternalStore(subscribe, getState, getState);
}

function setState(patch: Partial<AppState>, skipPersist = false) {
  state = { ...state, ...patch };
  notify(skipPersist);
}

function setPlayback(patch: Partial<PlaybackState>, skipPersist = false) {
  state = { ...state, playback: { ...state.playback, ...patch } };
  notify(skipPersist);
}

/* ------------------------------------------------------------------ *
 * Snapshots
 * ------------------------------------------------------------------ */

export function toSnapshot(source: AppState): AppSnapshot {
  const { playback } = source;
  return {
    version: SNAPSHOT_VERSION,
    library: source.library,
    settings: source.settings,
    widget: source.widget,
    playback: {
      trackId: playback.trackId,
      position: playback.position,
      volume: playback.volume,
      muted: playback.muted,
      shuffle: playback.shuffle,
      repeat: playback.repeat,
      speed: playback.speed,
      eq: playback.eq,
    },
  };
}

function applySnapshot(snapshot: AppSnapshot | null, preservePlaybackRuntime = false) {
  if (!snapshot) return;
  const library: LibraryState = {
    folders: (snapshot.library?.folders ?? []).filter((f) => !f.sample),
    tracks: Object.fromEntries(
      Object.entries(snapshot.library?.tracks ?? {}).filter(([, t]) => t.sourceKind !== "sample"),
    ),
    looseTrackIds: (snapshot.library?.looseTrackIds ?? []).filter(
      (id) => snapshot.library?.tracks?.[id] && snapshot.library.tracks[id].sourceKind !== "sample",
    ),
    playlists: snapshot.library?.playlists ?? [],
  };

  const rawWidget = { ...defaultWidget, ...(snapshot.widget ?? {}) };
  const normalizedWidget: WidgetSettings = {
    ...rawWidget,
    width: rawWidget.size === "compact" ? 364 : 424,
    height: rawWidget.size === "compact" ? 96 : 112,
  };

  setState(
    {
      library,
      settings: { ...defaultSettings, ...(snapshot.settings ?? {}) },
      widget: normalizedWidget,
      playback: preservePlaybackRuntime
        ? state.playback
        : {
            ...defaultPlayback,
            ...(snapshot.playback ?? {}),
            speed: snapshot.playback?.speed ?? 1.0,
            eq: normalizeEq(snapshot.playback?.eq),
            status: snapshot.playback?.trackId ? "paused" : "idle",
            position: snapshot.playback?.position ?? 0,
            duration: snapshot.playback?.trackId
              ? (library.tracks[snapshot.playback.trackId]?.duration ?? 0)
              : 0,
            queue: [],
            baseQueue: [],
            index: -1,
          },
    },
    true,
  );
}

async function syncNativeSnapshot() {
  if (state.backend !== "native") return;
  suppressPersist = true;
  if (snapshotTimer !== null) {
    window.clearTimeout(snapshotTimer);
    snapshotTimer = null;
  }
  try {
    const fresh = await native.snapshotLoad();
    if (fresh) applySnapshot(fresh, true);
  } finally {
    suppressPersist = false;
  }
}

/* ------------------------------------------------------------------ *
 * WebAudio Engine + Real 10-Band Biquad EQ (Browser Preview Backend)
 * ------------------------------------------------------------------ */

const fileSources = new Map<string, File>();
const objectUrls = new Map<string, string>();
let audioEl: HTMLAudioElement | null = null;
let audioCtx: AudioContext | null = null;
let preampNode: GainNode | null = null;
let eqFilters: BiquadFilterNode[] = [];
let tickHandle: number | null = null;
let advancing = false;

function ensureWebAudioGraph(el: HTMLAudioElement) {
  if (audioCtx || typeof window === "undefined") return;
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return;
  try {
    audioCtx = new Ctx();
    const source = audioCtx.createMediaElementSource(el);
    preampNode = audioCtx.createGain();
    eqFilters = EQ_FREQUENCIES.map((freq, idx) => {
      const f = audioCtx!.createBiquadFilter();
      f.type = idx === 0 ? "lowshelf" : idx === 9 ? "highshelf" : "peaking";
      f.frequency.value = freq;
      f.Q.value = 0.92;
      f.gain.value = 0;
      return f;
    });
    let cursor: AudioNode = source;
    cursor.connect(preampNode);
    cursor = preampNode;
    for (const f of eqFilters) {
      cursor.connect(f);
      cursor = f;
    }
    cursor.connect(audioCtx.destination);
    syncWebAudioEq(state.playback.eq);
  } catch {
    audioCtx = null;
  }
}

function syncWebAudioEq(eq: EqSettings) {
  if (!audioCtx || !preampNode || eqFilters.length !== 10) return;
  if (!eq.enabled) {
    preampNode.gain.value = 1.0;
    eqFilters.forEach((f) => {
      f.gain.value = 0;
    });
    return;
  }
  preampNode.gain.value = Math.pow(10, eq.preamp / 20);
  eqFilters.forEach((f, idx) => {
    f.gain.value = eq.bands[idx] ?? 0;
  });
}

function ensureAudio(): HTMLAudioElement {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = "auto";
    audioEl.addEventListener("timeupdate", () => {
      setPlayback(
        { position: audioEl!.currentTime, duration: safeDuration(audioEl!.duration) },
        true,
      );
    });
    audioEl.addEventListener("loadedmetadata", () => {
      setPlayback({ duration: safeDuration(audioEl!.duration) }, true);
    });
    audioEl.addEventListener("ended", () => {
      void handleEnded();
    });
    audioEl.addEventListener("error", () => {
      const track = currentTrack();
      handleTrackError(track, "This audio file could not be decoded.");
    });
    audioEl.addEventListener("playing", () => {
      setPlayback({ status: "playing", error: undefined });
    });
    audioEl.addEventListener("pause", () => {
      if (state.playback.status !== "idle" && !audioEl!.ended) {
        setPlayback({ status: "paused" });
      }
    });
  }
  audioEl.volume = state.playback.muted ? 0 : state.playback.volume;
  audioEl.playbackRate = state.playback.speed || 1.0;
  ensureWebAudioGraph(audioEl);
  return audioEl;
}

function safeDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function objectUrlFor(track: Track): string | null {
  const existing = objectUrls.get(track.id);
  if (existing) return existing;
  const file = fileSources.get(track.id);
  if (!file) return null;
  const url = URL.createObjectURL(file);
  objectUrls.set(track.id, url);
  return url;
}

function startTicker() {
  if (tickHandle !== null) return;
  tickHandle = window.setInterval(() => {
    if (state.playback.status === "playing" && audioEl) {
      setPlayback(
        { position: audioEl.currentTime, duration: safeDuration(audioEl.duration) },
        true,
      );
    }
  }, 180);
}

function stopTicker() {
  if (tickHandle !== null) {
    window.clearInterval(tickHandle);
    tickHandle = null;
  }
}

function currentTrack(): Track | null {
  const id = state.playback.trackId;
  return id ? (state.library.tracks[id] ?? null) : null;
}

function handleTrackError(track: Track | null, message: string) {
  if (track) {
    state.library.tracks[track.id] = { ...track, missing: true, error: message };
  }
  setPlayback({ status: "error", error: message });
  toast("error", "Playback error", track ? `${track.title} — ${message}` : message);
  window.setTimeout(() => {
    if (state.playback.status === "error" && state.playback.queue.length > 1) {
      void next(true);
    }
  }, 900);
}

/* ------------------------------------------------------------------ *
 * Toasts, Navigation & UI Drawers
 * ------------------------------------------------------------------ */

export function toast(tone: Toast["tone"], title: string, detail?: string) {
  const item: Toast = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    tone,
    title,
    detail,
  };
  setState({ toasts: [...state.toasts, item] }, true);
  window.setTimeout(() => dismissToast(item.id), 4500);
}

export function dismissToast(id: string) {
  setState({ toasts: state.toasts.filter((t) => t.id !== id) }, true);
}

export function setView(view: View) {
  const patch: Partial<AppState> = { view };
  if (view.name === "playlist" && state.settings.rememberLastPlaylist) {
    patch.settings = { ...state.settings, lastPlaylistId: view.id };
  }
  setState(patch);
}

export function setDrawer(drawer: DrawerPanel) {
  const nextDrawer = state.drawer === drawer ? "none" : drawer;
  setState({ drawer: nextDrawer }, true);
  if (nextDrawer === "lyrics") {
    const t = currentTrack();
    if (t && !t.lyrics && state.backend === "native") {
      void ensureLyricsLoaded(t.id);
    }
  }
}

export function setSearchQuery(searchQuery: string) {
  setState({ searchQuery }, true);
}

export async function openMainWindow() {
  if (state.backend === "native") {
    await native.mainWindowShow().catch(() => undefined);
  } else {
    channelSync?.post({ kind: "command", command: "openMain" });
  }
}

/* ------------------------------------------------------------------ *
 * Playback Actions
 * ------------------------------------------------------------------ */

function bumpPlayStats(trackId: string) {
  const track = state.library.tracks[trackId];
  if (!track) return;
  state.library.tracks[trackId] = {
    ...track,
    playCount: (track.playCount ?? 0) + 1,
    lastPlayedAt: Date.now(),
    missing: false,
    error: undefined,
  };
}

export async function ensureLyricsLoaded(trackId: string): Promise<void> {
  const track = state.library.tracks[trackId];
  if (!track || track.lyrics || state.backend !== "native") return;
  try {
    const lyrics = await native.readTrackLyrics(track.path);
    if (lyrics) {
      setState({
        library: {
          ...state.library,
          tracks: {
            ...state.library.tracks,
            [trackId]: { ...state.library.tracks[trackId], lyrics },
          },
        },
      });
    }
  } catch {
    /* optional lyrics lookup */
  }
}

export async function playTrack(track: Track, queue: Track[] = [track]): Promise<void> {
  const idx = Math.max(
    0,
    queue.findIndex((t) => t.id === track.id),
  );
  await playFromList(queue, idx, state.playback.shuffle);
}

export async function playFromList(
  tracks: Track[],
  startIndex: number,
  shuffle: boolean,
): Promise<void> {
  if (tracks.length === 0) return;
  const clampedStart = Math.max(0, Math.min(startIndex, tracks.length - 1));
  const baseQueue = tracks.map((t) => t.id);

  if (state.backend === "native") {
    bumpPlayStats(tracks[clampedStart].id);
    setPlayback({
      trackId: tracks[clampedStart].id,
      duration: tracks[clampedStart].duration || 0,
      position: 0,
      shuffle,
      status: "playing",
      error: undefined,
    });
    try {
      await native.playerPlayQueue(baseQueue, clampedStart, shuffle, true, 0);
      if (state.drawer === "lyrics") void ensureLyricsLoaded(tracks[clampedStart].id);
    } catch (err) {
      handleTrackError(
        tracks[clampedStart],
        err instanceof Error ? err.message : "Native audio playback failed",
      );
    }
    return;
  }

  let order = baseQueue;
  let index = clampedStart;
  if (shuffle) {
    order = shuffleArray(baseQueue);
    index = Math.max(0, order.indexOf(baseQueue[clampedStart]));
  }
  await startWebPlayback(tracks[clampedStart], order, baseQueue, index, shuffle);
}

async function startWebPlayback(
  track: Track,
  order: string[],
  baseQueue: string[],
  index: number,
  shuffle = state.playback.shuffle,
) {
  bumpPlayStats(track.id);
  setPlayback({
    trackId: track.id,
    queue: order,
    baseQueue,
    index,
    shuffle,
    position: 0,
    duration: track.duration || 0,
    status: "loading",
    error: undefined,
  });

  stopTicker();
  const audio = ensureAudio();
  if (audioCtx?.state === "suspended") {
    void audioCtx.resume().catch(() => undefined);
  }
  const url = objectUrlFor(track);
  if (!url) {
    handleTrackError(
      track,
      "Re-import this file in browser preview to grant File access (desktop app reads directly from disk).",
    );
    return;
  }
  audio.src = url;
  audio.currentTime = 0;
  audio.playbackRate = state.playback.speed || 1.0;
  try {
    await audio.play();
    setPlayback({ status: "playing" });
    startTicker();
  } catch (err) {
    handleTrackError(track, err instanceof Error ? err.message : "Audio playback failed.");
  }
}

export async function togglePlay(): Promise<void> {
  if (isWidgetWindow && state.backend === "web") {
    channelSync?.post({ kind: "command", command: "toggle" });
    return;
  }
  const { playback } = state;
  if (!playback.trackId) {
    const firstId = state.library.folders[0]?.trackIds[0] ?? state.library.looseTrackIds[0];
    if (firstId && state.library.tracks[firstId]) {
      const folder = state.library.folders[0];
      const list = folder
        ? folder.trackIds.map((id) => state.library.tracks[id]).filter(Boolean)
        : state.library.looseTrackIds.map((id) => state.library.tracks[id]).filter(Boolean);
      await playFromList(list, 0, playback.shuffle);
    }
    return;
  }
  if (state.backend === "native") {
    await native.playerToggle().catch(() => undefined);
    return;
  }
  if (playback.status === "playing") await pause();
  else await resume();
}

export async function pause(): Promise<void> {
  if (state.backend === "native") {
    await native.playerPause().catch(() => undefined);
    setPlayback({ status: "paused" });
    return;
  }
  audioEl?.pause();
  stopTicker();
  setPlayback({ status: "paused" });
}

export async function resume(): Promise<void> {
  const track = currentTrack();
  if (!track) return;
  if (state.backend === "native") {
    await native.playerPlay().catch(() => undefined);
    setPlayback({ status: "playing" });
    return;
  }
  const audio = ensureAudio();
  if (audioCtx?.state === "suspended") {
    void audioCtx.resume().catch(() => undefined);
  }
  const url = objectUrlFor(track);
  if (!url) {
    handleTrackError(
      track,
      "Re-import this file in browser preview to grant File access (desktop app reads directly from disk).",
    );
    return;
  }
  if (audio.src !== url) {
    audio.src = url;
    audio.currentTime = state.playback.position;
  }
  try {
    await audio.play();
    setPlayback({ status: "playing" });
    startTicker();
  } catch (err) {
    handleTrackError(track, err instanceof Error ? err.message : "Playback could not be resumed.");
  }
}

export async function stop(): Promise<void> {
  if (state.backend === "native") await native.playerStop().catch(() => undefined);
  audioEl?.pause();
  stopTicker();
  setPlayback({ status: "idle", position: 0, trackId: null, queue: [], baseQueue: [], index: -1 });
}

export async function seek(seconds: number): Promise<void> {
  if (isWidgetWindow && state.backend === "web") {
    channelSync?.post({ kind: "command", seek: seconds });
    return;
  }
  const duration = state.playback.duration;
  const target = Math.max(0, duration ? Math.min(seconds, duration) : seconds);
  if (state.backend === "native") {
    await native.playerSeek(target).catch(() => undefined);
    setPlayback({ position: target });
    return;
  }
  if (audioEl) {
    audioEl.currentTime = target;
  }
  setPlayback({ position: target });
}

export function setVolume(volume: number) {
  if (isWidgetWindow && state.backend === "web") {
    channelSync?.post({ kind: "command", volume });
    return;
  }
  const value = Math.min(1, Math.max(0, volume));
  const muted = value === 0 ? state.playback.muted : false;
  if (state.backend === "native") {
    void native.playerSetVolume(value, muted).catch(() => undefined);
  }
  if (audioEl) audioEl.volume = muted ? 0 : value;
  setPlayback({ volume: value, muted });
}

export function toggleMute() {
  const muted = !state.playback.muted;
  if (audioEl) audioEl.volume = muted ? 0 : state.playback.volume;
  if (state.backend === "native") {
    void native.playerSetVolume(state.playback.volume, muted).catch(() => undefined);
  }
  setPlayback({ muted });
}

export function setSpeed(speed: number) {
  const clamped = Math.max(0.5, Math.min(2.0, Math.round(speed * 100) / 100));
  if (state.backend === "native") {
    void native.playerSetSpeed(clamped).catch(() => undefined);
  }
  if (audioEl) audioEl.playbackRate = clamped;
  setPlayback({ speed: clamped });
}

export function setEq(eq: EqSettings) {
  const normalized = normalizeEq(eq);
  if (state.backend === "native") {
    void native.playerSetEq(normalized).catch(() => undefined);
  }
  syncWebAudioEq(normalized);
  setPlayback({ eq: normalized });
}

export function applyEqPreset(presetId: string) {
  setEq(presetToEq(presetId, true));
}

export function setShuffle(shuffle: boolean) {
  if (isWidgetWindow && state.backend === "web") {
    channelSync?.post({ kind: "command", command: "shuffle" });
    return;
  }
  if (state.backend === "native") {
    void native.playerSetShuffle(shuffle).catch(() => undefined);
  }
  const { playback } = state;
  const base = playback.baseQueue.length ? playback.baseQueue : playback.queue;
  const current = playback.trackId;
  const order = buildQueue(base, shuffle, current, (id) => id);
  setPlayback({
    shuffle,
    queue: order.map((id) => id),
    index: current ? Math.max(0, order.indexOf(current)) : playback.index,
  });
}

export function cycleRepeat() {
  if (isWidgetWindow && state.backend === "web") {
    channelSync?.post({ kind: "command", command: "repeat" });
    return;
  }
  const order: RepeatMode[] = ["off", "all", "one"];
  const nextMode = order[(order.indexOf(state.playback.repeat) + 1) % order.length];
  if (state.backend === "native") {
    void native.playerSetRepeat(nextMode).catch(() => undefined);
  }
  setPlayback({ repeat: nextMode });
}

export async function next(autoAdvance = false): Promise<void> {
  if (isWidgetWindow && state.backend === "web") {
    channelSync?.post({ kind: "command", command: "next" });
    return;
  }
  if (state.backend === "native") {
    await native.playerNext().catch(() => undefined);
    return;
  }
  const { playback } = state;
  if (advancing || playback.queue.length === 0) return;

  if (playback.repeat === "one" && autoAdvance) {
    await seek(0);
    await resume();
    return;
  }
  const candidate = nextIndex(playback.index, playback.queue.length, playback.repeat, autoAdvance);
  if (candidate === null) {
    setPlayback({ status: "paused", position: playback.duration });
    stopTicker();
    return;
  }
  const track = state.library.tracks[playback.queue[candidate]];
  if (!track) return;
  advancing = true;
  try {
    await startWebPlayback(track, playback.queue, playback.baseQueue, candidate);
  } finally {
    advancing = false;
  }
}

export async function previous(): Promise<void> {
  if (isWidgetWindow && state.backend === "web") {
    channelSync?.post({ kind: "command", command: "prev" });
    return;
  }
  if (state.backend === "native") {
    await native.playerPrevious().catch(() => undefined);
    return;
  }
  const { playback } = state;
  const target = previousIndex(playback.index, playback.position);
  if (target === "restart" || target === null) {
    await seek(0);
    return;
  }
  const track = state.library.tracks[playback.queue[target]];
  if (!track) return;
  await startWebPlayback(track, playback.queue, playback.baseQueue, target);
}

async function handleEnded() {
  if (state.playback.repeat === "one") {
    await seek(0);
    await resume();
    return;
  }
  await next(true);
}

/* ------------------------------------------------------------------ *
 * Queue Operations
 * ------------------------------------------------------------------ */

export async function enqueueTrack(track: Track, playNext = false): Promise<void> {
  if (state.backend === "native") {
    await native.playerEnqueue(track.id, playNext).catch(() => undefined);
    toast("info", playNext ? "Playing next" : "Added to queue", track.title);
    return;
  }
  const { playback } = state;
  if (playback.queue.length === 0) {
    await playTrack(track, [track]);
    return;
  }
  const insertAt = playNext ? Math.min(playback.queue.length, playback.index + 1) : playback.queue.length;
  const queue = [...playback.queue];
  queue.splice(insertAt, 0, track.id);
  setPlayback({ queue, baseQueue: [...playback.baseQueue, track.id] });
  toast("info", playNext ? "Playing next" : "Added to queue", track.title);
}

export async function removeFromQueue(index: number): Promise<void> {
  if (state.backend === "native") {
    await native.playerRemoveQueueIndex(index).catch(() => undefined);
    return;
  }
  const { playback } = state;
  if (index < 0 || index >= playback.queue.length) return;
  const removedId = playback.queue[index];
  const queue = playback.queue.filter((_, i) => i !== index);
  const baseQueue = playback.baseQueue.filter((id) => id !== removedId);
  if (index === playback.index) {
    if (queue.length === 0) await stop();
    else {
      const nextIdx = Math.min(index, queue.length - 1);
      const nextTrack = state.library.tracks[queue[nextIdx]];
      if (nextTrack) await startWebPlayback(nextTrack, queue, baseQueue, nextIdx);
    }
    return;
  }
  setPlayback({
    queue,
    baseQueue,
    index: index < playback.index ? playback.index - 1 : playback.index,
  });
}

export async function moveQueueItem(from: number, to: number): Promise<void> {
  if (state.backend === "native") {
    await native.playerMoveQueueItem(from, to).catch(() => undefined);
    return;
  }
  const { playback } = state;
  if (from < 0 || to < 0 || from >= playback.queue.length || to >= playback.queue.length || from === to) {
    return;
  }
  const queue = [...playback.queue];
  const [moved] = queue.splice(from, 1);
  queue.splice(to, 0, moved);
  setPlayback({
    queue,
    index: playback.trackId ? Math.max(0, queue.indexOf(playback.trackId)) : playback.index,
  });
}

export async function jumpToQueueIndex(index: number): Promise<void> {
  if (state.backend === "native") {
    await native.playerJumpToIndex(index).catch(() => undefined);
    return;
  }
  const { playback } = state;
  const track = state.library.tracks[playback.queue[index]];
  if (!track) return;
  await startWebPlayback(track, playback.queue, playback.baseQueue, index);
}

/* ------------------------------------------------------------------ *
 * Favorites, Custom Playlists & Library Management
 * ------------------------------------------------------------------ */

export function setSettings(patch: Partial<Settings>) {
  const nextSettings = { ...state.settings, ...patch };
  setState({ settings: nextSettings });
}

export function setWidget(patch: Partial<WidgetSettings>) {
  const widget = { ...state.widget, ...patch };
  setState({ widget });
  if (state.backend === "native") {
    if ("alwaysOnTop" in patch) void native.widgetSetAlwaysOnTop(widget.alwaysOnTop).catch(() => undefined);
    if (
      patch.x !== undefined ||
      patch.y !== undefined ||
      patch.width !== undefined ||
      patch.height !== undefined
    ) {
      void native.widgetSetBounds(widget).catch(() => undefined);
    }
    if ("visible" in patch) {
      void (patch.visible ? native.widgetShow() : native.widgetHide()).catch(() => undefined);
    }
  }
}

/**
 * The widget's ✕ button. In the native app this asks Rust to decide:
 * main window still open → hide the widget; main window already closed →
 * the widget is the last visible window, so Vesper quits and playback
 * stops (never leave ghost audio playing in the background).
 */
export function closeWidget() {
  if (state.backend === "native") {
    setState({ widget: { ...state.widget, visible: false } });
    void native.widgetClose().catch(() => undefined);
    return;
  }
  setWidget({ visible: false });
}

export function toggleFavorite(trackId: string) {
  const track = state.library.tracks[trackId];
  if (!track) return;
  const favorite = !track.favorite;
  setState({
    library: {
      ...state.library,
      tracks: { ...state.library.tracks, [trackId]: { ...track, favorite } },
    },
  });
}

/** Updates cover artwork on a song and persists immediately until explicitly removed. */
export function setTrackCoverData(trackId: string, artwork: string | undefined, custom = true) {
  const track = state.library.tracks[trackId];
  if (!track) return;
  const updated: Track = {
    ...track,
    artwork,
    customArtwork: artwork ? custom : false,
  };
  setState(
    {
      library: {
        ...state.library,
        tracks: { ...state.library.tracks, [trackId]: updated },
      },
    },
    true,
  );
  if (state.backend !== "native") {
    void saveSnapshot(toSnapshot(state));
  }
}

/** Opens the image picker and permanently saves the chosen cover for this song. */
export async function chooseTrackCover(trackId: string): Promise<void> {
  const track = state.library.tracks[trackId];
  if (!track) return;

  if (state.backend === "native") {
    try {
      const picked = await native.pickCoverImage();
      if (!picked) return;
      const savedPath = await native.setTrackCover(trackId, picked);
      setTrackCoverData(trackId, savedPath, true);
      toast("success", "Cover saved", "Saved permanently until you remove it.");
    } catch (err) {
      toast("error", "Could not save cover", err instanceof Error ? err.message : String(err));
    }
    return;
  }

  const dataUrl = await pickCoverDataUrlWeb();
  if (!dataUrl) return;
  setTrackCoverData(trackId, dataUrl, true);
  toast("success", "Cover saved", "Saved until you remove it.");
}

/** Explicitly removes the saved cover image from a song. */
export async function clearTrackCover(trackId: string): Promise<void> {
  const track = state.library.tracks[trackId];
  if (!track) return;

  if (state.backend === "native") {
    try {
      await native.removeTrackCover(trackId);
      setTrackCoverData(trackId, undefined, false);
      toast("info", "Cover removed", track.title);
    } catch (err) {
      toast("error", "Could not remove cover", err instanceof Error ? err.message : String(err));
    }
    return;
  }

  setTrackCoverData(trackId, undefined, false);
  toast("info", "Cover removed", track.title);
}

export function createPlaylist(name: string, initialTrackIds: string[] = []): UserPlaylist | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const pl: UserPlaylist = {
    id: `pl-${trackKey(trimmed + Date.now())}`,
    name: trimmed,
    trackIds: [...initialTrackIds],
    createdAt: Date.now(),
  };
  setState({
    library: { ...state.library, playlists: [...state.library.playlists, pl] },
  });
  toast("success", "Playlist created", `“${trimmed}”`);
  return pl;
}

export function renameUserPlaylist(id: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  setState({
    library: {
      ...state.library,
      playlists: state.library.playlists.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
    },
  });
}

export function deleteUserPlaylist(id: string) {
  setState({
    library: {
      ...state.library,
      playlists: state.library.playlists.filter((p) => p.id !== id),
    },
    view: state.view.name === "userPlaylist" && state.view.id === id ? { name: "home" } : state.view,
  });
  toast("info", "Playlist deleted", "Tracks remain safely in your library.");
}

export function addTrackToPlaylist(playlistId: string, trackId: string) {
  const pl = state.library.playlists.find((p) => p.id === playlistId);
  if (!pl) return;
  if (pl.trackIds.includes(trackId)) {
    toast("info", "Already in playlist", pl.name);
    return;
  }
  setState({
    library: {
      ...state.library,
      playlists: state.library.playlists.map((p) =>
        p.id === playlistId ? { ...p, trackIds: [...p.trackIds, trackId] } : p,
      ),
    },
  });
  toast("success", `Added to ${pl.name}`);
}

export function removeTrackFromPlaylist(playlistId: string, trackId: string) {
  setState({
    library: {
      ...state.library,
      playlists: state.library.playlists.map((p) =>
        p.id === playlistId ? { ...p, trackIds: p.trackIds.filter((id) => id !== trackId) } : p,
      ),
    },
  });
}

export async function revealInExplorer(path: string) {
  if (state.backend !== "native") {
    toast("info", "File location", path);
    return;
  }
  try {
    await native.openPath(path);
  } catch (err) {
    toast("error", "Could not open folder", err instanceof Error ? err.message : String(err));
  }
}

export function renameFolder(id: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const folders = state.library.folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f));
  setState({ library: { ...state.library, folders } });
  if (state.backend === "native") {
    void native.renameFolder(id, trimmed).catch(() => undefined);
  }
  toast("success", "Folder display name updated", "The physical folder on disk was not modified.");
}

export function removeFolder(id: string) {
  const folder = state.library.folders.find((f) => f.id === id);
  const tracks = { ...state.library.tracks };
  for (const trackId of folder?.trackIds ?? []) {
    const track = tracks[trackId];
    if (track?.sourceKind !== "loose") delete tracks[trackId];
    else tracks[trackId] = { ...track, folderId: undefined, sourceKind: "loose" };
  }
  setState({
    library: {
      ...state.library,
      tracks,
      folders: state.library.folders.filter((f) => f.id !== id),
    },
    view: state.view.name === "playlist" && state.view.id === id ? { name: "home" } : state.view,
  });
  if (state.backend === "native") {
    void native.removeFolder(id).catch(() => undefined);
  }
  toast("info", "Removed from library", "Original audio files on disk remain untouched.");
}

export function removeTrack(id: string) {
  const tracks = { ...state.library.tracks };
  delete tracks[id];
  const folders = state.library.folders.map((f) =>
    f.trackIds.includes(id) ? { ...f, trackIds: f.trackIds.filter((t) => t !== id) } : f,
  );
  const playlists = state.library.playlists.map((p) =>
    p.trackIds.includes(id) ? { ...p, trackIds: p.trackIds.filter((t) => t !== id) } : p,
  );
  setState({
    library: {
      tracks,
      folders,
      looseTrackIds: state.library.looseTrackIds.filter((t) => t !== id),
      playlists,
    },
    playback:
      state.playback.trackId === id
        ? { ...state.playback, status: "idle", trackId: null, queue: [], baseQueue: [], index: -1 }
        : state.playback,
  });
  if (state.backend === "native") {
    void native.removeTrack(id).catch(() => undefined);
  }
  toast("info", "Track removed from library", "The original file remains on disk.");
}

export async function toggleRecursive(folderId: string) {
  const folder = state.library.folders.find((f) => f.id === folderId);
  if (!folder) return;
  const nextRecursive = !folder.recursive;
  const folders = state.library.folders.map((f) =>
    f.id === folderId ? { ...f, recursive: nextRecursive } : f,
  );
  setState({ library: { ...state.library, folders } });
  if (state.backend === "native") {
    await refreshFolder(folderId, nextRecursive);
  } else {
    toast("info", `Nested folders ${nextRecursive ? "enabled" : "disabled"}`);
  }
}

export async function refreshFolder(folderId: string, overrideRecursive?: boolean) {
  const folder = state.library.folders.find((f) => f.id === folderId);
  if (!folder) return;
  if (state.backend === "native") {
    try {
      const res = await native.refreshFolder(folderId, overrideRecursive ?? folder.recursive);
      await syncNativeSnapshot();
      toast(
        "success",
        "Folder refreshed",
        res.added ? `${res.added} new track(s) found.` : `Up to date (${folder.name}).`,
      );
      return;
    } catch (err) {
      await syncNativeSnapshot();
      toast("error", "Folder unavailable", err instanceof Error ? err.message : String(err));
      return;
    }
  }
  setState({ busy: { label: `Refreshing ${folder.name}`, processed: 0, total: folder.trackIds.length } }, true);
  for (let i = 0; i < folder.trackIds.length; i++) {
    const track = state.library.tracks[folder.trackIds[i]];
    const file = track ? fileSources.get(track.id) : undefined;
    if (track && file) {
      const duration = await probeDuration(file);
      state.library.tracks[track.id] = { ...track, duration: duration || track.duration, missing: false };
    }
    setState(
      { busy: { label: `Refreshing ${folder.name}`, processed: i + 1, total: folder.trackIds.length } },
      true,
    );
  }
  const folders = state.library.folders.map((f) =>
    f.id === folderId ? { ...f, lastScannedAt: Date.now(), missing: false } : f,
  );
  setState({ library: { ...state.library, folders }, busy: null });
  toast("success", "Folder refreshed", `${folder.trackIds.length} track(s) verified.`);
}

/* ------------------------------------------------------------------ *
 * Import Pipeline (Folder, Individual Tracks, Drag & Drop, Demo Synth)
 * ------------------------------------------------------------------ */

async function probeDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("audio");
    el.preload = "metadata";
    let settled = false;
    const done = (value: number) => {
      if (settled) return;
      settled = true;
      el.src = "";
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(value) && value > 0 ? value : 0);
    };
    el.onloadedmetadata = () => done(el.duration);
    el.onerror = () => done(0);
    window.setTimeout(() => done(el.duration), 3500);
    el.src = url;
  });
}

function existingSignatureMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const track of Object.values(state.library.tracks)) {
    map.set(normalizePath(track.path), signatureKey(track.sizeBytes ?? 0, track.duration));
  }
  return map;
}

async function buildTrackFromFile(
  file: File,
  path: string,
  lrcByStem: Map<string, string>,
  folderId?: string,
): Promise<Track> {
  const key = trackKey(path);
  let title = titleFromFileName(path);
  let artist = artistFromFileName(path);
  let album: string | undefined;
  let artwork: string | undefined;
  try {
    const tags = await readTags(file);
    if (tags.title) title = tags.title;
    if (tags.artist) artist = tags.artist;
    if (tags.album) album = tags.album;
    if (tags.artwork && tags.artwork.length < 6_000_000) {
      artwork = URL.createObjectURL(
        new Blob([tags.artwork as BlobPart], { type: tags.artworkMime ?? "image/jpeg" }),
      );
    }
  } catch {
    /* filename fallback */
  }
  const stem = stripExtension(file.name).toLowerCase();
  const lyrics = lrcByStem.get(stem);
  const duration = await probeDuration(file);
  fileSources.set(key, file);
  return {
    id: key,
    title,
    artist,
    album,
    duration,
    path,
    key,
    artwork,
    lyrics,
    sourceKind: folderId ? "folder" : "loose",
    folderId,
    sizeBytes: file.size,
  };
}

async function ingestWebFolder(picked: PickedFile[]): Promise<string | null> {
  const lrcByStem = new Map<string, string>();
  for (const p of picked) {
    if (p.file.name.toLowerCase().endsWith(".lrc")) {
      const txt = await p.file.text().catch(() => "");
      if (txt.trim()) lrcByStem.set(stripExtension(p.file.name).toLowerCase(), txt);
    }
  }

  const audioFiles = picked.filter((p) => isAudioFile(p.file.name));
  if (audioFiles.length === 0) {
    toast("info", "No audio files found", "Supported formats: MP3, WAV, FLAC, M4A, AAC, OGG, Opus.");
    return null;
  }
  const { folder } = folderFromRelativePath(audioFiles[0].relativePath);
  const recursive = state.settings.recursiveScan;
  const candidates = audioFiles.map((p) => ({
    relativePath: p.relativePath,
    name: p.file.name,
    sizeBytes: p.file.size,
    file: p.file,
  }));
  const scoped = selectImportableFiles(candidates, recursive);
  if (scoped.length === 0 && audioFiles.length > 0) {
    toast(
      "info",
      "Only nested subfolders contain audio",
      "Enable “Include nested folders” in Settings to scan subdirectories.",
    );
    return null;
  }
  const plan = planImport(existingSignatureMap(), scoped);
  const folderId = `folder-${trackKey(folder)}`;
  const existingFolder = state.library.folders.find((f) => f.id === folderId);
  const trackIds: string[] = existingFolder ? [...existingFolder.trackIds] : [];
  const duplicates = plan.skipped.length;

  setState({ busy: { label: `Importing ${folder}`, processed: 0, total: plan.add.length } }, true);

  for (let i = 0; i < plan.add.length; i++) {
    const entry = plan.add[i];
    const path = entry.relativePath.replace(/\//g, "\\");
    const key = trackKey(path);
    const track = await buildTrackFromFile(entry.file, path, lrcByStem, folderId);
    state.library.tracks[key] = track;
    if (!trackIds.includes(key)) trackIds.push(key);
    if (i % 6 === 5 || i === plan.add.length - 1) {
      setState(
        {
          library: { ...state.library, tracks: { ...state.library.tracks } },
          busy: { label: `Importing ${folder}`, processed: i + 1, total: plan.add.length },
        },
        true,
      );
    }
  }

  const playlist: FolderPlaylist = {
    id: folderId,
    name: existingFolder?.name ?? (folder || "Imported Folder"),
    path: `C:\\Music\\${folder}`,
    trackIds,
    recursive,
    missing: false,
    addedAt: existingFolder?.addedAt ?? Date.now(),
    lastScannedAt: Date.now(),
  };

  setState({
    library: {
      ...state.library,
      tracks: { ...state.library.tracks },
      folders: [...state.library.folders.filter((f) => f.id !== folderId), playlist],
    },
    busy: null,
  });

  toast(
    "success",
    "Folder imported",
    `${plan.add.length} track(s) in “${playlist.name}”${duplicates ? ` (${duplicates} duplicate skipped)` : ""}.`,
  );
  return folderId;
}

async function ingestWebLooseFiles(rawFiles: File[]): Promise<number> {
  const lrcByStem = new Map<string, string>();
  for (const f of rawFiles) {
    if (f.name.toLowerCase().endsWith(".lrc")) {
      const txt = await f.text().catch(() => "");
      if (txt.trim()) lrcByStem.set(stripExtension(f.name).toLowerCase(), txt);
    }
  }
  const files = rawFiles.filter((f) => isAudioFile(f.name));
  if (files.length === 0) return 0;

  const loose = [...state.library.looseTrackIds];
  let added = 0;
  let duplicates = 0;
  setState({ busy: { label: "Importing tracks", processed: 0, total: files.length } }, true);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const key = trackKey(file.name + file.size);
    if (state.library.tracks[key]) {
      fileSources.set(key, file);
      if (!loose.includes(key) && state.library.tracks[key].sourceKind === "loose") {
        loose.push(key);
      }
      duplicates += 1;
      continue;
    }
    const track = await buildTrackFromFile(file, file.name, lrcByStem);
    track.id = key;
    track.key = key;
    track.sourceKind = "loose";
    fileSources.set(key, file);
    state.library.tracks[key] = track;
    loose.push(key);
    added += 1;
    setState(
      {
        library: { ...state.library, tracks: { ...state.library.tracks }, looseTrackIds: [...loose] },
        busy: { label: "Importing tracks", processed: i + 1, total: files.length },
      },
      true,
    );
  }

  setState({
    library: { ...state.library, tracks: { ...state.library.tracks }, looseTrackIds: [...loose] },
    busy: null,
  });
  toast(
    "success",
    added ? "Tracks imported" : "Already in library",
    added
      ? `${added} individual track(s) added${duplicates ? ` (${duplicates} skipped)` : ""}.`
      : `${duplicates} file(s) refreshed.`,
  );
  return added;
}

export async function importFolder(): Promise<void> {
  if (state.backend === "native") {
    try {
      const path = await native.pickFolder();
      if (!path) return;
      setState({ busy: { label: "Scanning folder", processed: 0, total: 0 } }, true);
      const res = await native.importFolder(path, state.settings.recursiveScan);
      await syncNativeSnapshot();
      setState({ busy: null }, true);
      toast(
        "success",
        "Folder imported",
        `${res.added} track(s) scanned from ${res.playlist?.name ?? path}`,
      );
    } catch (err) {
      setState({ busy: null }, true);
      toast("error", "Import failed", err instanceof Error ? err.message : String(err));
    }
    return;
  }

  const picked = await pickFolderFiles();
  if (picked.length === 0) return;
  await ingestWebFolder(picked);
}

export async function importTracks(): Promise<void> {
  if (state.backend === "native") {
    try {
      const paths = await native.pickTracks();
      if (paths.length === 0) return;
      setState({ busy: { label: "Importing tracks", processed: 0, total: paths.length } }, true);
      const res = await native.importTracks(paths);
      await syncNativeSnapshot();
      setState({ busy: null }, true);
      toast(
        "success",
        res.added ? "Tracks imported" : "Already in library",
        res.added
          ? `${res.added} track(s) added to Home library.`
          : `${res.skippedDuplicates} track(s) already present.`,
      );
    } catch (err) {
      setState({ busy: null }, true);
      toast("error", "Import failed", err instanceof Error ? err.message : String(err));
    }
    return;
  }

  const picked = await pickTrackFiles();
  if (picked.length === 0) return;
  await ingestWebLooseFiles(picked);
}

export async function handleBrowserDrop(dataTransfer: DataTransfer): Promise<void> {
  if (state.backend === "native") return; // Handled natively via Tauri `WindowEvent::DragDrop`
  const { folders, looseFiles } = await readDroppedItems(dataTransfer);
  for (const [, files] of folders) {
    await ingestWebFolder(files);
  }
  if (looseFiles.length > 0) {
    await ingestWebLooseFiles(looseFiles);
  }
}

/**
 * Generates real playable stereo 16-bit PCM WAV files in memory for quick audio/EQ/lyrics
 * verification when evaluating inside a browser with no local MP3 folder handy.
 * Never auto-loaded as fake data — only created when explicitly triggered by the user.
 */
function synthesizeWavFile(
  fileName: string,
  frequencies: number[],
  seconds = 14,
): File {
  const sampleRate = 22050;
  const numChannels = 2;
  const totalSamples = sampleRate * seconds;
  const dataBytes = totalSamples * numChannels * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const env = Math.min(1, t / 0.4) * Math.min(1, (seconds - t) / 0.8);
    const chordIdx = Math.floor(t / (seconds / 2)) % 2;
    let l = 0;
    let r = 0;
    frequencies.forEach((base, idx) => {
      const f = base * (chordIdx === 1 && idx === 1 ? 1.122 : 1.0);
      const detune = 1 + (idx - 1) * 0.0015;
      const amp = (0.2 / frequencies.length) * (0.75 + 0.25 * Math.sin(2 * Math.PI * 0.35 * t + idx));
      l += Math.sin(2 * Math.PI * f * t) * amp;
      r += Math.sin(2 * Math.PI * f * detune * t + 0.35) * amp;
    });
    const sl = Math.max(-1, Math.min(1, l * env));
    const sr = Math.max(-1, Math.min(1, r * env));
    view.setInt16(offset, sl * 32767, true);
    view.setInt16(offset + 2, sr * 32767, true);
    offset += 4;
  }
  return new File([buf], fileName, { type: "audio/wav" });
}

export async function loadPlayableDemoAudio(): Promise<void> {
  const folderFiles: PickedFile[] = [
    {
      file: synthesizeWavFile("01. Kiasmos - Looped.wav", [130.81, 196.0, 246.94, 329.63], 16),
      relativePath: "Ambient Sessions/01. Kiasmos - Looped.wav",
    },
    {
      file: new File(
        [
          "[00:00.00] Warm analog synth pad opens\n[00:04.00] Sub-bass harmonic enters (try the 64 Hz EQ slider)\n[00:08.00] Chord modulation shifts upward\n[00:12.00] Gentle tape fade out",
        ],
        "01. Kiasmos - Looped.lrc",
        { type: "text/plain" },
      ),
      relativePath: "Ambient Sessions/01. Kiasmos - Looped.lrc",
    },
    {
      file: synthesizeWavFile("02. Nils Frahm - My Friend the Forest.wav", [146.83, 220.0, 261.63, 349.23], 15),
      relativePath: "Ambient Sessions/02. Nils Frahm - My Friend the Forest.wav",
    },
    {
      file: synthesizeWavFile("03. Olafur Arnalds - Saman.wav", [164.81, 246.94, 293.66, 392.0], 14),
      relativePath: "Ambient Sessions/03. Olafur Arnalds - Saman.wav",
    },
  ];
  const singleTrack = synthesizeWavFile("Tycho - Awake.wav", [174.61, 220.0, 261.63, 392.0], 15);
  const singleLrc = new File(
    [
      "[00:00.00] Crisp acoustic-synth pulse begins\n[00:04.00] Harmonic fifth layer opens across stereo field\n[00:08.00] Warm upper-register chord shift\n[00:12.00] Clean horizon fade",
    ],
    "Tycho - Awake.lrc",
    { type: "text/plain" },
  );
  await ingestWebFolder(folderFiles);
  await ingestWebLooseFiles([singleTrack, singleLrc]);
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

let bootstrapped = false;

export async function init(widgetWindow = false) {
  isWidgetWindow = widgetWindow;
  if (bootstrapped) return;
  bootstrapped = true;

  const snapshot = await loadSnapshot();
  applySnapshot(snapshot);
  setState({ ready: true }, true);

  if (state.backend === "native") {
    void events.playbackState((patch) => {
      setPlayback(patch, true);
    });
    void events.libraryChanged(() => {
      void syncNativeSnapshot();
    });

    if (!isWidgetWindow) {
      void events.fileDrop((paths) => {
        void (async () => {
          setState({ busy: { label: "Importing dropped items", processed: 0, total: paths.length } }, true);
          try {
            const res = await native.importDroppedPaths(paths, state.settings.recursiveScan);
            await syncNativeSnapshot();
            setState({ busy: null }, true);
            toast(
              "success",
              "Dropped items imported",
              `${res.foldersAdded} folder(s), ${res.tracksAdded} track(s)`,
            );
          } catch (err) {
            setState({ busy: null }, true);
            toast("error", "Drop import failed", err instanceof Error ? err.message : String(err));
          }
        })();
      });

      void events.openFiles((paths) => {
        void (async () => {
          const res = await native.importTracks(paths);
          await syncNativeSnapshot();
          if (res.firstTrackId && state.library.tracks[res.firstTrackId]) {
            await playTrack(state.library.tracks[res.firstTrackId]);
          }
        })();
      });

      // Prime last session track in paused state on main window boot only
      if (snapshot?.playback?.trackId && state.library.tracks[snapshot.playback.trackId]) {
        const t = state.library.tracks[snapshot.playback.trackId];
        await native
          .playerPlayQueue([t.id], 0, snapshot.playback.shuffle ?? false, false, snapshot.playback.position ?? 0)
          .catch(() => undefined);
      }
    }
    return;
  }

  channelSync = openStateChannel((message) => {
    if (isWidgetWindow && message.kind === "state") {
      const patch: Partial<AppState> = {
        playback: { ...state.playback, ...message.playback } as PlaybackState,
      };
      if (message.widget) patch.widget = message.widget;
      if (message.track) {
        patch.library = {
          ...state.library,
          tracks: { ...state.library.tracks, [message.track.id]: message.track },
        };
      }
      setState(patch, true);
      return;
    }

    if (!isWidgetWindow && message.kind === "command") {
      if (message.command === "toggle") void togglePlay();
      if (message.command === "next") void next();
      if (message.command === "prev") void previous();
      if (message.command === "shuffle") setShuffle(!state.playback.shuffle);
      if (message.command === "repeat") cycleRepeat();
      if (message.command === "openMain") window.focus();
      if (message.command === "sync") notify(true);
      if (typeof message.seek === "number") void seek(message.seek);
      if (typeof message.volume === "number") setVolume(message.volume);
    }
  });

  if (isWidgetWindow) {
    channelSync.post({ kind: "command", command: "sync" });
  } else {
    window.addEventListener("beforeunload", flushPersistNow);
    window.addEventListener("pagehide", flushPersistNow);
  }
}

export function isWidgetContext(): boolean {
  return isWidgetWindow;
}

export interface AlbumSummary {
  key: string;
  name: string;
  artist: string;
  artwork?: string | null;
  tracks: Track[];
}

export interface ArtistSummary {
  name: string;
  tracks: Track[];
}

export const selectors = {
  trackById: (id: string | null): Track | null => (id ? (state.library.tracks[id] ?? null) : null),
  folderById: (id: string): FolderPlaylist | null =>
    state.library.folders.find((f) => f.id === id) ?? null,
  playlistById: (id: string): UserPlaylist | null =>
    state.library.playlists.find((p) => p.id === id) ?? null,
  folderTracks: (folder: FolderPlaylist): Track[] =>
    folder.trackIds.map((id) => state.library.tracks[id]).filter(Boolean),
  playlistTracks: (playlist: UserPlaylist): Track[] =>
    playlist.trackIds.map((id) => state.library.tracks[id]).filter(Boolean),
  looseTracks: (): Track[] =>
    state.library.looseTrackIds.map((id) => state.library.tracks[id]).filter(Boolean),
  allTracks: (): Track[] => Object.values(state.library.tracks),
  favoriteTracks: (): Track[] => Object.values(state.library.tracks).filter((t) => t.favorite),
  albums: (): AlbumSummary[] => {
    const map = new Map<string, AlbumSummary>();
    for (const track of Object.values(state.library.tracks)) {
      const albumName = track.album?.trim() || "Unknown Album";
      const key = albumName.toLowerCase();
      let entry = map.get(key);
      if (!entry) {
        entry = {
          key,
          name: albumName,
          artist: track.artist || "Unknown artist",
          artwork: resolveArtworkUrl(track.artwork),
          tracks: [],
        };
        map.set(key, entry);
      }
      if (!entry.artwork && track.artwork) entry.artwork = resolveArtworkUrl(track.artwork);
      entry.tracks.push(track);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  },
  artists: (): ArtistSummary[] => {
    const map = new Map<string, ArtistSummary>();
    for (const track of Object.values(state.library.tracks)) {
      const name = track.artist?.trim() || "Unknown artist";
      const key = name.toLowerCase();
      let entry = map.get(key);
      if (!entry) {
        entry = { name, tracks: [] };
        map.set(key, entry);
      }
      entry.tracks.push(track);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  },
  totalTracks: (): number => Object.keys(state.library.tracks).length,
  artworkFor: (track: Track | null): string | null => resolveArtworkUrl(track?.artwork),
};
