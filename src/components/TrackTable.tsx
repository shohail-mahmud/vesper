import { useState } from "react";
import type { Track } from "../types";
import { formatTime } from "../lib/format";
import { selectors } from "../state/store";
import {
  addTrackToPlaylist,
  chooseTrackCover,
  clearTrackCover,
  createPlaylist,
  enqueueTrack,
  revealInExplorer,
  runtimeIsNative,
  toggleFavorite,
  useApp,
} from "./trackActions";
import * as I from "./Icons";

export function PlayingBadge({ playing }: { playing: boolean }) {
  return (
    <span className="inline-flex h-3 items-end gap-[2px]" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={playing ? "eq-bar w-[2px] rounded-full bg-ink" : "w-[2px] rounded-full bg-ink/45"}
          style={{ height: "100%", animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}

export function TrackTable({
  tracks,
  currentId,
  onPlay,
  onRemove,
  showAlbum = true,
  emptyState,
  startIndex = 1,
}: {
  tracks: Track[];
  currentId: string | null;
  onPlay: (index: number, track: Track) => void;
  onRemove?: (track: Track) => void;
  showAlbum?: boolean;
  emptyState?: React.ReactNode;
  startIndex?: number;
}) {
  const { library, playback } = useApp();
  const [menuTrackId, setMenuTrackId] = useState<string | null>(null);
  const [newPlTitle, setNewPlTitle] = useState("");

  if (tracks.length === 0) {
    // No table header is rendered when there are no rows, so nothing draws a
    // rule and nothing reserves a row of height. The empty message sits in a
    // dashed panel that matches the section cards instead of floating in a
    // strip of blank paper.
    return (
      <div className="mt-6 flex flex-col items-center justify-center rounded-[14px] border border-dashed border-rule px-6 py-16 text-center">
        {emptyState ?? <p className="text-[13px] text-ink-2">No tracks here yet.</p>}
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="plate flex items-center gap-4 border-b border-rule pb-2.5 text-ink-3">
        <span className="w-8 text-right">#</span>
        <span className="flex-1">Title</span>
        {showAlbum && <span className="hidden w-48 lg:block">Album</span>}
        <span className="w-14 text-right">Time</span>
        <span className="w-28 text-right">Actions</span>
      </div>

      <ul role="list">
        {tracks.map((track, index) => {
          const active = track.id === currentId;
          const isPlaying = active && playback.status === "playing";
          const openMenu = menuTrackId === track.id;
          const art = selectors.artworkFor(track);

          return (
            <li
              key={`${track.id}-${index}`}
              className={`group relative rounded-[10px] border-b border-rule-soft px-1 transition-colors duration-100 hover:bg-[var(--surface-hover)] ${
                active ? "bg-[var(--surface-hover)]/70" : ""
              }`}
            >
              <div className="flex items-center gap-3.5 py-2">
                <button
                  type="button"
                  className="w-7 shrink-0 cursor-pointer text-right"
                  onClick={() => onPlay(index, track)}
                  title={`Play ${track.title}`}
                  aria-label={`Play ${track.title}`}
                >
                  <span className="tnum inline-flex justify-end text-[12px] font-medium text-ink-3 group-hover:hidden">
                    {active ? <PlayingBadge playing={isPlaying} /> : String(index + startIndex).padStart(2, "0")}
                  </span>
                  <span className="hidden justify-end text-ink group-hover:inline-flex">
                    <I.Play size={13} />
                  </span>
                </button>

                {/* Cover thumbnail — click to set/change song cover directly */}
                <button
                  type="button"
                  onClick={() => void chooseTrackCover(track.id)}
                  title={art ? "Change song cover image" : "Add song cover image"}
                  aria-label={`Set cover image for ${track.title}`}
                  className="group/art relative flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-[10px] border border-rule bg-paper text-ink-3"
                >
                  {art ? (
                    <img
                      src={art}
                      alt=""
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <I.NoteSingle size={16} />
                  )}
                  <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-white opacity-0 transition-opacity group-hover/art:opacity-100">
                    <I.ImagePlus size={13} />
                  </span>
                </button>

                <button
                  type="button"
                  className="min-w-0 flex-1 cursor-pointer text-left"
                  onClick={() => onPlay(index, track)}
                  title={track.title}
                >
                  <div className={`truncate-1 text-[13.5px] leading-tight ${active ? "font-semibold text-ink" : "font-medium text-ink"}`}>
                    {track.title}
                  </div>
                  <div className="truncate-1 mt-0.5 text-[11.5px] leading-tight text-ink-2">
                    {track.artist ?? "Unknown artist"}
                    {track.missing && (
                      <span className="ml-2 rounded px-1.5 py-[1px] text-[10px] bg-[#B4453A]/12 text-[#B4453A]">
                        file missing
                      </span>
                    )}
                  </div>
                </button>

                {showAlbum && (
                  <div className="hidden w-48 truncate-1 text-[12px] text-ink-2 lg:block">
                    {track.album ?? "—"}
                  </div>
                )}

                <div className="tnum w-14 text-right text-[12px] font-medium text-ink-2">
                  {formatTime(track.duration)}
                </div>

                <div className="relative flex w-28 items-center justify-end gap-0.5">
                  <button
                    type="button"
                    onClick={() => toggleFavorite(track.id)}
                    aria-label={track.favorite ? "Unfavorite" : "Favorite"}
                    title={track.favorite ? "Remove from Favorites" : "Add to Favorites"}
                    className={`icon-btn h-7 w-7 ${
                      track.favorite
                        ? "text-[#D93848] opacity-100"
                        : "opacity-0 group-hover:opacity-100 focus:opacity-100"
                    }`}
                  >
                    {track.favorite ? <I.HeartFilled size={14} /> : <I.Heart size={14} />}
                  </button>

                  <button
                    type="button"
                    onClick={() => setMenuTrackId(openMenu ? null : track.id)}
                    aria-label={`More actions for ${track.title}`}
                    title="Cover, Queue & Playlist actions"
                    className="icon-btn h-7 w-7 opacity-0 group-hover:opacity-100 focus:opacity-100"
                  >
                    <I.More size={14} />
                  </button>

                  {onRemove && (
                    <button
                      type="button"
                      className="icon-btn h-7 w-7 opacity-0 group-hover:opacity-100 focus:opacity-100"
                      onClick={() => onRemove(track)}
                      title="Remove from library (file stays untouched on disk)"
                      aria-label={`Remove ${track.title} from library`}
                    >
                      <I.X size={13} />
                    </button>
                  )}

                  {openMenu && (
                    <div
                      role="menu"
                      onMouseLeave={() => setMenuTrackId(null)}
                      className="rise absolute top-8 right-0 z-30 w-56 rounded-[12px] border-[1.5px] border-[var(--tile-outline)] bg-paper-2 p-1.5 text-left"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuTrackId(null);
                          void chooseTrackCover(track.id);
                        }}
                        className="flex w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[12px] font-medium text-ink hover:bg-[var(--surface-hover)]"
                      >
                        <I.ImagePlus size={14} /> {art ? "Change Cover" : "Add Cover"}
                      </button>

                      {art && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuTrackId(null);
                            void clearTrackCover(track.id);
                          }}
                          className="flex w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[12px] font-medium text-[#C53949] hover:bg-[var(--surface-hover)]"
                        >
                          <I.ImageOff size={14} /> Remove Cover
                        </button>
                      )}

                      <div className="my-1 h-[1px] bg-rule" />

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          void enqueueTrack(track, true);
                          setMenuTrackId(null);
                        }}
                        className="flex w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[12px] text-ink hover:bg-[var(--surface-hover)]"
                      >
                        <I.Play size={13} /> Play Next
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          void enqueueTrack(track, false);
                          setMenuTrackId(null);
                        }}
                        className="flex w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[12px] text-ink hover:bg-[var(--surface-hover)]"
                      >
                        <I.ListPlus size={14} /> Add to Queue
                      </button>
                      {runtimeIsNative() && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            void revealInExplorer(track.path);
                            setMenuTrackId(null);
                          }}
                          className="flex w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[12px] text-ink hover:bg-[var(--surface-hover)]"
                        >
                          <I.ExternalLink size={13} /> Show in Explorer
                        </button>
                      )}

                      <div className="my-1 h-[1px] bg-rule" />
                      <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                        Add to playlist
                      </div>
                      {library.playlists.map((pl) => (
                        <button
                          key={pl.id}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            addTrackToPlaylist(pl.id, track.id);
                            setMenuTrackId(null);
                          }}
                          className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-[12px] text-ink hover:bg-[var(--surface-hover)]"
                        >
                          <I.Plus size={12} /> <span className="truncate-1">{pl.name}</span>
                        </button>
                      ))}

                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!newPlTitle.trim()) return;
                          createPlaylist(newPlTitle, [track.id]);
                          setNewPlTitle("");
                          setMenuTrackId(null);
                        }}
                        className="mt-1 flex gap-1 px-1.5 pb-1"
                      >
                        <input
                          value={newPlTitle}
                          onChange={(e) => setNewPlTitle(e.target.value)}
                          placeholder="New playlist…"
                          className="min-w-0 flex-1 rounded-[8px] border border-rule bg-paper px-2 py-1 text-[11.5px] text-ink outline-none"
                        />
                        <button type="submit" className="btn btn-primary py-1 px-2.5 text-[11px]">
                          Add
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
