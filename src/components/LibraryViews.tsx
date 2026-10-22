import { useMemo, useState } from "react";
import {
  applyEqPreset,
  createPlaylist,
  deleteUserPlaylist,
  jumpToQueueIndex,
  moveQueueItem,
  playFromList,
  removeFromQueue,
  removeTrack,
  removeTrackFromPlaylist,
  renameUserPlaylist,
  seek,
  selectors,
  setDrawer,
  setEq,
  setSpeed,
  setView,
  stop,
  useApp,
} from "../state/store";
import { EQ_LABELS, EQ_PRESETS, clampDb } from "../lib/eq";
import { activeLyricIndex, parseLyrics } from "../lib/lyrics";
import { formatCount, formatDurationTotal, formatTime } from "../lib/format";
import { TrackTable } from "./TrackTable";
import * as I from "./Icons";
import type { Track } from "../types";

type SortField = "title" | "artist" | "album" | "duration";

function sortTracks(tracks: Track[], field: SortField, asc: boolean): Track[] {
  const dir = asc ? 1 : -1;
  return [...tracks].sort((a, b) => {
    if (field === "duration") return ((a.duration || 0) - (b.duration || 0)) * dir;
    const va = (a[field] ?? "").toString();
    const vb = (b[field] ?? "").toString();
    return va.localeCompare(vb) * dir;
  });
}

function filterByQuery(tracks: Track[], query: string): Track[] {
  const q = query.trim().toLowerCase();
  if (!q) return tracks;
  return tracks.filter(
    (t) =>
      t.title.toLowerCase().includes(q) ||
      (t.artist ?? "").toLowerCase().includes(q) ||
      (t.album ?? "").toLowerCase().includes(q),
  );
}

/* ------------------------------------------------------------------ *
 * All Tracks / Favorites Views
 * ------------------------------------------------------------------ */

export function AllTracksScreen({ favoritesOnly = false }: { favoritesOnly?: boolean }) {
  const state = useApp();
  const [sortBy, setSortBy] = useState<SortField>("title");
  const [asc, setAsc] = useState(true);

  const raw = favoritesOnly ? selectors.favoriteTracks() : selectors.allTracks();
  const tracks = useMemo(
    () => sortTracks(filterByQuery(raw, state.searchQuery), sortBy, asc),
    [raw, state.searchQuery, sortBy, asc],
  );
  const totalTime = tracks.reduce((s, t) => s + (t.duration || 0), 0);

  const toggleSort = (field: SortField) => {
    if (sortBy === field) setAsc((v) => !v);
    else {
      setSortBy(field);
      setAsc(true);
    }
  };

  return (
    <div className="fade px-8 py-9 sm:px-11">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-5">
        <div>
          <span className="plate text-ink-3">{favoritesOnly ? "Collection" : "Library"}</span>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-tight text-ink">
            {favoritesOnly ? "Favorites" : "All Tracks"}
          </h1>
          <p className="mt-1 text-[12px] text-ink-3">
            {formatCount(tracks.length, "track")} · {formatDurationTotal(totalTime)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-[6px] border border-rule bg-paper-2 p-0.5 text-[11.5px]">
            {(["title", "artist", "album", "duration"] as SortField[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => toggleSort(f)}
                className={`rounded-[4px] px-2.5 py-1 capitalize transition-colors ${
                  sortBy === f ? "bg-ink text-paper" : "text-ink-2 hover:text-ink"
                }`}
              >
                {f} {sortBy === f ? (asc ? "↑" : "↓") : ""}
              </button>
            ))}
          </div>
          {tracks.length > 0 && (
            <>
              <button className="btn btn-primary" onClick={() => void playFromList(tracks, 0, false)}>
                <I.Play size={13} /> Play All
              </button>
              <button className="btn btn-ghost" onClick={() => void playFromList(tracks, 0, true)}>
                <I.Shuffle size={13} /> Shuffle
              </button>
            </>
          )}
        </div>
      </div>

      <TrackTable
        tracks={tracks}
        currentId={state.playback.trackId}
        onPlay={(index) => void playFromList(tracks, index, state.playback.shuffle)}
        onRemove={favoritesOnly ? undefined : (track) => removeTrack(track.id)}
        emptyState={
          <p className="text-[13px] text-ink-2">
            {favoritesOnly
              ? "No favorite tracks yet — click the heart icon on any track to save it here."
              : "No tracks imported yet — use the Import Music tile on Home to add folders or audio files."}
          </p>
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Albums & Artists Views
 * ------------------------------------------------------------------ */

export function AlbumsScreen() {
  const state = useApp();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const albums = selectors.albums().filter((a) => {
    const q = state.searchQuery.trim().toLowerCase();
    return !q || a.name.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q);
  });
  const activeAlbum = albums.find((a) => a.key === selectedKey) ?? null;

  if (activeAlbum) {
    return (
      <div className="fade px-8 py-9 sm:px-11">
        <button
          type="button"
          className="plate flex items-center gap-2 text-ink-3 hover:text-ink"
          onClick={() => setSelectedKey(null)}
        >
          <I.ArrowLeft size={13} /> Albums
        </button>
        <div className="mt-5 mb-7 flex flex-wrap items-end justify-between gap-6 border-b border-rule pb-6">
          <div className="flex items-center gap-5">
            <div className="tile-square !h-20 !w-20 shrink-0 overflow-hidden">
              {activeAlbum.artwork ? (
                <img src={activeAlbum.artwork} alt="" className="h-full w-full object-cover" />
              ) : (
                <I.Disc size={30} />
              )}
            </div>
            <div>
              <h1 className="text-[24px] font-semibold tracking-tight text-ink">{activeAlbum.name}</h1>
              <p className="mt-1 text-[13px] text-ink-2">
                {activeAlbum.artist} · {formatCount(activeAlbum.tracks.length, "track")}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="btn btn-primary"
              onClick={() => void playFromList(activeAlbum.tracks, 0, false)}
            >
              <I.Play size={13} /> Play Album
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => void playFromList(activeAlbum.tracks, 0, true)}
            >
              <I.Shuffle size={13} /> Shuffle
            </button>
          </div>
        </div>
        <TrackTable
          tracks={activeAlbum.tracks}
          currentId={state.playback.trackId}
          showAlbum={false}
          onPlay={(idx) => void playFromList(activeAlbum.tracks, idx, state.playback.shuffle)}
        />
      </div>
    );
  }

  return (
    <div className="fade px-8 py-9 sm:px-11">
      <div className="mb-7 border-b border-rule pb-5">
        <span className="plate text-ink-3">Library</span>
        <h1 className="mt-1.5 text-[24px] font-semibold tracking-tight text-ink">Albums</h1>
      </div>

      {albums.length === 0 ? (
        <p className="py-12 text-center text-[13px] text-ink-2">
          Import folders or audio files to browse albums automatically from embedded tags.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,148px))] gap-x-7 gap-y-8">
          {albums.map((album) => (
            <button
              key={album.key}
              type="button"
              onClick={() => setSelectedKey(album.key)}
              className="group flex cursor-pointer flex-col items-center text-center"
            >
              <div className="tile-square overflow-hidden">
                {album.artwork ? (
                  <img src={album.artwork} alt={album.name} className="h-full w-full object-cover" />
                ) : (
                  <I.Disc size={30} />
                )}
              </div>
              <div className="mt-2.5 w-full truncate-1 text-[13px] font-medium text-ink">
                {album.name}
              </div>
              <div className="mt-0.5 w-full truncate-1 text-[11px] text-ink-3">{album.artist}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ArtistsScreen() {
  const state = useApp();
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const artists = selectors.artists().filter((a) => {
    const q = state.searchQuery.trim().toLowerCase();
    return !q || a.name.toLowerCase().includes(q);
  });
  const active = artists.find((a) => a.name === selectedArtist) ?? null;

  if (active) {
    return (
      <div className="fade px-8 py-9 sm:px-11">
        <button
          type="button"
          className="plate flex items-center gap-2 text-ink-3 hover:text-ink"
          onClick={() => setSelectedArtist(null)}
        >
          <I.ArrowLeft size={13} /> Artists
        </button>
        <div className="mt-5 mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-5">
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight text-ink">{active.name}</h1>
            <p className="mt-1 text-[12px] text-ink-3">{formatCount(active.tracks.length, "track")}</p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={() => void playFromList(active.tracks, 0, false)}>
              <I.Play size={13} /> Play All
            </button>
            <button className="btn btn-ghost" onClick={() => void playFromList(active.tracks, 0, true)}>
              <I.Shuffle size={13} /> Shuffle
            </button>
          </div>
        </div>
        <TrackTable
          tracks={active.tracks}
          currentId={state.playback.trackId}
          onPlay={(idx) => void playFromList(active.tracks, idx, state.playback.shuffle)}
        />
      </div>
    );
  }

  return (
    <div className="fade px-8 py-9 sm:px-11">
      <div className="mb-7 border-b border-rule pb-5">
        <span className="plate text-ink-3">Library</span>
        <h1 className="mt-1.5 text-[24px] font-semibold tracking-tight text-ink">Artists</h1>
      </div>

      {artists.length === 0 ? (
        <p className="py-12 text-center text-[13px] text-ink-2">
          Import music to group tracks by artist automatically.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,148px))] gap-x-7 gap-y-8">
          {artists.map((artist) => (
            <button
              key={artist.name}
              type="button"
              onClick={() => setSelectedArtist(artist.name)}
              className="flex cursor-pointer flex-col items-center text-center"
            >
              <div className="tile-square">
                <I.Users size={30} />
              </div>
              <div className="mt-2.5 w-full truncate-1 text-[13px] font-medium text-ink">
                {artist.name}
              </div>
              <div className="tnum mt-0.5 text-[11px] text-ink-3">
                {formatCount(artist.tracks.length, "track")}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Custom User Playlist Screen
 * ------------------------------------------------------------------ */

export function UserPlaylistScreen({ playlistId }: { playlistId: string }) {
  const state = useApp();
  const pl = selectors.playlistById(playlistId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(pl?.name ?? "");

  if (!pl) {
    return (
      <div className="fade px-10 py-20 text-center">
        <p className="text-[14px] text-ink-2">Playlist not found.</p>
        <button className="btn btn-ghost mt-4" onClick={() => setView({ name: "home" })}>
          <I.ArrowLeft size={13} /> Home
        </button>
      </div>
    );
  }

  const tracks = selectors.playlistTracks(pl);

  return (
    <div className="fade px-8 py-9 sm:px-11">
      <button
        type="button"
        className="plate flex items-center gap-2 text-ink-3 hover:text-ink"
        onClick={() => setView({ name: "home" })}
      >
        <I.ArrowLeft size={13} /> Home
      </button>

      <div className="mt-5 mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-5">
        <div>
          <span className="plate text-ink-3">Custom playlist</span>
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (draft.trim()) renameUserPlaylist(pl.id, draft);
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (draft.trim()) renameUserPlaylist(pl.id, draft);
                  setEditing(false);
                }
              }}
              className="mt-1 block border-b border-ink bg-transparent text-[24px] font-semibold text-ink outline-none"
            />
          ) : (
            <h1
              onClick={() => {
                setDraft(pl.name);
                setEditing(true);
              }}
              className="mt-1 cursor-text text-[24px] font-semibold tracking-tight text-ink"
              title="Click to rename"
            >
              {pl.name}
            </h1>
          )}
          <p className="mt-1 text-[12px] text-ink-3">{formatCount(tracks.length, "track")}</p>
        </div>

        <div className="flex gap-2">
          {tracks.length > 0 && (
            <>
              <button className="btn btn-primary" onClick={() => void playFromList(tracks, 0, false)}>
                <I.Play size={13} /> Play All
              </button>
              <button className="btn btn-ghost" onClick={() => void playFromList(tracks, 0, true)}>
                <I.Shuffle size={13} /> Shuffle
              </button>
            </>
          )}
          <button
            className="btn btn-ghost text-[#B4453A]"
            onClick={() => deleteUserPlaylist(pl.id)}
            title="Delete custom playlist"
          >
            <I.Trash size={13} /> Delete
          </button>
        </div>
      </div>

      <TrackTable
        tracks={tracks}
        currentId={state.playback.trackId}
        onPlay={(idx) => void playFromList(tracks, idx, state.playback.shuffle)}
        onRemove={(track) => removeTrackFromPlaylist(pl.id, track.id)}
        emptyState={
          <p className="text-[13px] text-ink-2">
            Use the “+” menu on any track row to add songs into “{pl.name}”.
          </p>
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Right-Side Inspector Drawers: Up Next Queue · Synced Lyrics · 10-Band EQ
 * ------------------------------------------------------------------ */

export function InspectorDrawer() {
  const state = useApp();
  const { drawer, playback } = state;
  const [newPlName, setNewPlName] = useState("");
  if (drawer === "none") return null;

  const track = selectors.trackById(playback.trackId);
  const parsedLyrics = parseLyrics(track?.lyrics);
  const activeLine = parsedLyrics.synced
    ? activeLyricIndex(parsedLyrics.lines, playback.position)
    : -1;

  return (
    <aside
      aria-label={`${drawer} panel`}
      className="scroll-area flex w-[340px] shrink-0 flex-col border-l border-rule bg-paper-2 p-5 overflow-y-auto"
    >
      <div className="mb-4 flex items-center justify-between border-b border-rule pb-3">
        <div className="flex items-center gap-1.5">
          {(
            [
              ["queue", "Queue"],
              ["lyrics", "Lyrics"],
              ["eq", "Equalizer"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                if (drawer !== id) setDrawer(id);
              }}
              className={`rounded-[5px] px-2.5 py-1 text-[12px] font-medium transition-colors ${
                drawer === id ? "bg-ink text-paper" : "text-ink-2 hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setDrawer(drawer)}
          aria-label="Close panel"
          className="icon-btn h-7 w-7"
        >
          <I.X size={14} />
        </button>
      </div>

      {/* 1. UP NEXT QUEUE */}
      {drawer === "queue" && (
        <div className="flex flex-1 flex-col">
          <div className="mb-3 flex items-center justify-between">
            <span className="plate text-ink-3">
              {formatCount(playback.queue.length, "queued track")}
            </span>
            {playback.queue.length > 0 && (
              <button
                type="button"
                onClick={() => void stop()}
                className="text-[11.5px] text-ink-2 hover:text-ink"
              >
                Clear queue
              </button>
            )}
          </div>

          {playback.queue.length === 0 ? (
            <p className="py-10 text-center text-[12.5px] text-ink-3">
              Queue is empty. Click any folder or track to start listening.
            </p>
          ) : (
            <>
              <ul className="space-y-1 flex-1">
                {playback.queue.map((id, i) => {
                  const t = state.library.tracks[id];
                  if (!t) return null;
                  const current = i === playback.index;
                  return (
                    <li
                      key={`${id}-${i}`}
                      className={`group flex items-center gap-2 rounded-[6px] px-2.5 py-2 text-[12.5px] ${
                        current ? "border border-[var(--tile-outline)] bg-paper font-medium" : "hover:bg-paper"
                      }`}
                    >
                      <span className="tnum w-5 text-[11px] text-ink-3">{i + 1}</span>
                      <button
                        type="button"
                        onClick={() => void jumpToQueueIndex(i)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate-1 text-ink">{t.title}</div>
                        <div className="truncate-1 text-[11px] text-ink-3">
                          {t.artist ?? "Unknown artist"}
                        </div>
                      </button>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => void moveQueueItem(i, i - 1)}
                          disabled={i === 0}
                          className="icon-btn h-6 w-6 disabled:opacity-30"
                          title="Move up"
                        >
                          <I.ChevronUp size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void moveQueueItem(i, i + 1)}
                          disabled={i === playback.queue.length - 1}
                          className="icon-btn h-6 w-6 disabled:opacity-30"
                          title="Move down"
                        >
                          <I.ChevronDown size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeFromQueue(i)}
                          className="icon-btn h-6 w-6"
                          title="Remove from queue"
                        >
                          <I.X size={12} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newPlName.trim()) return;
                  createPlaylist(newPlName, playback.queue);
                  setNewPlName("");
                }}
                className="mt-4 flex gap-1.5 border-t border-rule pt-3"
              >
                <input
                  value={newPlName}
                  onChange={(e) => setNewPlName(e.target.value)}
                  placeholder="Save queue as playlist…"
                  className="min-w-0 flex-1 rounded-[5px] border border-rule bg-paper px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-[var(--tile-outline)]"
                />
                <button type="submit" className="btn btn-primary py-1.5 px-3 text-[11.5px]">
                  Save
                </button>
              </form>
            </>
          )}
        </div>
      )}

      {/* 2. SYNCED .LRC & EMBEDDED LYRICS */}
      {drawer === "lyrics" && (
        <div className="flex flex-1 flex-col">
          {!track ? (
            <p className="py-10 text-center text-[12.5px] text-ink-3">
              Play a track to display embedded tags or companion <code>.lrc</code> lyrics.
            </p>
          ) : parsedLyrics.lines.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-[13px] font-medium text-ink">No lyrics found for “{track.title}”</p>
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
                Drop a matching <code>.lrc</code> file alongside the audio file or embed USLT/LYRICS tags
                to get automatic click-to-seek synced lyrics.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5 py-2">
              {parsedLyrics.lines.map((line, idx) => {
                const isActive = idx === activeLine;
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={line.time === null}
                    onClick={() => {
                      if (line.time !== null) void seek(line.time);
                    }}
                    className={`block w-full rounded-[6px] px-2.5 py-1.5 text-left transition-colors ${
                      line.time !== null ? "cursor-pointer hover:bg-paper" : "cursor-default"
                    } ${
                      isActive
                        ? "bg-paper text-[15px] font-semibold text-ink"
                        : "text-[13px] text-ink-3"
                    }`}
                  >
                    {line.time !== null && (
                      <span className="tnum mr-2.5 text-[10.5px] text-ink-3">
                        {formatTime(line.time)}
                      </span>
                    )}
                    <span>{line.text}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 3. 10-BAND NATIVE BIQUAD EQUALIZER + PLAYBACK SPEED */}
      {drawer === "eq" && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] font-medium text-ink">10-Band Equalizer</div>
              <div className="text-[11px] text-ink-3">Real-time biquad audio filter</div>
            </div>
            <button
              type="button"
              onClick={() => setEq({ ...playback.eq, enabled: !playback.eq.enabled })}
              className={`btn py-1 px-3 text-[11.5px] ${
                playback.eq.enabled ? "btn-primary" : "btn-ghost"
              }`}
            >
              {playback.eq.enabled ? "Enabled" : "Bypassed"}
            </button>
          </div>

          <div>
            <label className="plate block text-ink-3">Preset</label>
            <select
              value={playback.eq.preset}
              onChange={(e) => applyEqPreset(e.target.value)}
              className="mt-1.5 w-full rounded-[6px] border-[1.5px] border-[var(--tile-outline)] bg-paper px-2.5 py-1.5 text-[12.5px] text-ink outline-none"
            >
              {EQ_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              {!EQ_PRESETS.some((p) => p.id === playback.eq.preset) && (
                <option value="custom">Custom</option>
              )}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between text-[11.5px]">
              <span className="plate text-ink-3">Preamp</span>
              <span className="tnum text-ink-2">
                {playback.eq.preamp > 0 ? `+${playback.eq.preamp}` : playback.eq.preamp} dB
              </span>
            </div>
            <input
              type="range"
              min={-12}
              max={12}
              step={0.5}
              value={playback.eq.preamp}
              onChange={(e) =>
                setEq({
                  ...playback.eq,
                  enabled: true,
                  preset: "custom",
                  preamp: clampDb(Number(e.target.value)),
                })
              }
              className="vesper-range mt-1.5"
              style={
                {
                  "--track-h": "4px",
                  "--thumb-bg": "var(--text-primary)",
                } as React.CSSProperties
              }
            />
          </div>

          {/* 10 vertical band sliders */}
          <div className="grid grid-cols-10 gap-1 pt-2">
            {EQ_LABELS.map((label, idx) => {
              const val = playback.eq.bands[idx] ?? 0;
              return (
                <div key={label} className="flex flex-col items-center gap-2">
                  <span className="tnum text-[9.5px] text-ink-3">
                    {val > 0 ? `+${Math.round(val)}` : Math.round(val)}
                  </span>
                  <div className="flex h-28 items-center justify-center">
                    <input
                      type="range"
                      min={-12}
                      max={12}
                      step={0.5}
                      value={val}
                      aria-label={`${label} Hz gain`}
                      onChange={(e) => {
                        const bands = [...playback.eq.bands];
                        bands[idx] = clampDb(Number(e.target.value));
                        setEq({
                          ...playback.eq,
                          enabled: true,
                          preset: "custom",
                          bands,
                        });
                      }}
                      className="h-24 w-5 cursor-pointer accent-[var(--text-primary)] [writing-mode:vertical-lr] [direction:rtl]"
                    />
                  </div>
                  <span className="tnum text-[9.5px] font-medium text-ink-2">{label}</span>
                </div>
              );
            })}
          </div>

          <div className="border-t border-rule pt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="plate text-ink-3">Playback speed</span>
              <span className="tnum text-[12px] text-ink">{playback.speed.toFixed(2)}×</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[0.75, 0.9, 1.0, 1.1, 1.25, 1.5].map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => setSpeed(sp)}
                  className={`tnum rounded-[5px] border px-2 py-1 text-[11px] ${
                    Math.abs(playback.speed - sp) < 0.01
                      ? "border-[var(--tile-outline)] bg-ink text-paper"
                      : "border-rule text-ink-2 hover:text-ink"
                  }`}
                >
                  {sp}×
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
