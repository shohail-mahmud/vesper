import { useEffect, useRef, useState } from "react";
import {
  chooseTrackCover,
  clearTrackCover,
  enqueueTrack,
  importFolder,
  importTracks,
  playFromList,
  removeFolder,
  removeTrack,
  selectors,
  setView,
  toggleFavorite,
  useApp,
} from "../state/store";
import { formatCount, formatTime } from "../lib/format";
import { PlayingBadge, TrackTable } from "./TrackTable";
import * as I from "./Icons";

export function HomeScreen() {
  const state = useApp();
  const { library, playback, searchQuery } = state;
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [looseLayout, setLooseLayout] = useState<"tiles" | "list">("tiles");
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!importMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setImportMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setImportMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [importMenuOpen]);

  const query = searchQuery.trim().toLowerCase();

  const folders = library.folders.filter((folder) => {
    if (!query) return true;
    if (folder.name.toLowerCase().includes(query) || folder.path.toLowerCase().includes(query)) {
      return true;
    }
    return selectors
      .folderTracks(folder)
      .some(
        (t) =>
          t.title.toLowerCase().includes(query) ||
          (t.artist ?? "").toLowerCase().includes(query) ||
          (t.album ?? "").toLowerCase().includes(query),
      );
  });

  const looseTracks = selectors.looseTracks().filter((track) => {
    if (!query) return true;
    return (
      track.title.toLowerCase().includes(query) ||
      (track.artist ?? "").toLowerCase().includes(query) ||
      (track.album ?? "").toLowerCase().includes(query)
    );
  });

  return (
    <div className="fade px-8 py-9 sm:px-11 sm:py-11">
      {/* Horizontal wrapping grid of square tiles with clear, dark outlines */}
      <section aria-label="Music library">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,148px))] gap-x-7 gap-y-8">
          {/* 1. First tile (always first): Import Music */}
          <div ref={menuRef} className="relative flex flex-col items-center">
            <button
              type="button"
              onClick={() => setImportMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={importMenuOpen}
              aria-label="Import Music"
              className="tile-square cursor-pointer"
            >
              <I.Plus size={32} />
            </button>

            <span className="mt-2.5 w-full text-center text-[13px] font-medium leading-snug text-ink">
              Import Music
            </span>

            {importMenuOpen && (
              <div
                role="menu"
                aria-label="Import Music options"
                className="rise absolute top-[calc(100%-22px)] left-0 z-40 mt-1.5 w-52 overflow-hidden rounded-[12px] border-[1.75px] border-[var(--tile-outline)] bg-paper-2"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setImportMenuOpen(false);
                    void importFolder();
                  }}
                  className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left text-[13px] font-medium text-ink transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <I.Folder size={17} />
                  <div>
                    <div>Import Folder</div>
                    <div className="text-[11px] font-normal text-ink-3">Create folder playlist</div>
                  </div>
                </button>
                <div className="h-[1px] bg-rule" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setImportMenuOpen(false);
                    void importTracks();
                  }}
                  className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left text-[13px] font-medium text-ink transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <I.NoteSingle size={17} />
                  <div>
                    <div>Import Track</div>
                    <div className="text-[11px] font-normal text-ink-3">Add single audio files</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* 2. Remaining square tiles: Imported Folders */}
          {folders.map((folder) => {
            const tracks = selectors.folderTracks(folder);
            const hasActiveTrack =
              Boolean(playback.trackId) && folder.trackIds.includes(playback.trackId!);

            return (
              <div key={folder.id} className="group relative flex flex-col items-center">
                <div className="relative w-full">
                  <button
                    type="button"
                    onClick={() => setView({ name: "playlist", id: folder.id })}
                    aria-label={`Open folder ${folder.name}`}
                    className="tile-square cursor-pointer"
                  >
                    <I.Folder size={32} />

                    {hasActiveTrack && (
                      <span className="absolute bottom-2.5 left-2.5">
                        <PlayingBadge playing={playback.status === "playing"} />
                      </span>
                    )}

                    {folder.missing && (
                      <span
                        title="Folder currently unavailable on disk"
                        className="plate absolute bottom-2 left-2 rounded px-1.5 py-0.5 text-[9px] bg-[#B4453A]/15 text-[#B4453A]"
                      >
                        Offline
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFolder(folder.id);
                    }}
                    title="Remove folder from library (files stay untouched on disk)"
                    aria-label={`Remove ${folder.name} from library`}
                    className="icon-btn absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-paper-2/90 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                  >
                    <I.X size={13} />
                  </button>

                  {tracks.length > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void playFromList(tracks, 0, false);
                      }}
                      title={`Play all tracks in ${folder.name}`}
                      aria-label={`Play all tracks in ${folder.name}`}
                      className="icon-btn absolute right-1.5 bottom-1.5 h-7 w-7 rounded-full bg-paper-2/90 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                    >
                      <I.Play size={13} />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setView({ name: "playlist", id: folder.id })}
                  className="mt-2.5 w-full cursor-pointer text-center"
                >
                  <div className="truncate-1 text-[13px] font-medium leading-snug text-ink" title={folder.name}>
                    {folder.name}
                  </div>
                  <div className="tnum mt-0.5 text-[11px] text-ink-3">
                    {formatCount(tracks.length, "track")}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. Individual Imported Tracks — directly accessible on Home without forcing into a folder */}
      {looseTracks.length > 0 && (
        <section aria-label="Individual tracks" className="mt-12 border-t border-rule pt-8">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <I.NoteSingle size={15} className="text-ink-2" />
              <h2 className="plate text-ink-2">
                Individual tracks ({looseTracks.length})
              </h2>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void playFromList(looseTracks, 0, false)}
                className="btn btn-ghost py-1.5 px-3 text-[11.5px]"
              >
                <I.Play size={12} /> Play All
              </button>
              <button
                type="button"
                onClick={() => void playFromList(looseTracks, 0, true)}
                className="btn btn-ghost py-1.5 px-3 text-[11.5px]"
              >
                <I.Shuffle size={12} /> Shuffle
              </button>
              <button
                type="button"
                onClick={() => setLooseLayout((m) => (m === "tiles" ? "list" : "tiles"))}
                title={looseLayout === "tiles" ? "Switch to compact list" : "Switch to track tiles"}
                aria-label="Toggle individual track display layout"
                className="icon-btn h-7 w-7 border border-rule"
              >
                {looseLayout === "tiles" ? <I.List size={14} /> : <I.Home size={14} />}
              </button>
            </div>
          </div>

          {looseLayout === "tiles" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,148px))] gap-x-7 gap-y-8">
              {looseTracks.map((track, idx) => {
                const isCurrent = playback.trackId === track.id;
                const isPlaying = isCurrent && playback.status === "playing";
                const art = selectors.artworkFor(track);
                return (
                  <div key={track.id} className="group relative flex flex-col items-center">
                    <div className="relative w-full">
                      <button
                        type="button"
                        onClick={() => void playFromList(looseTracks, idx, state.playback.shuffle)}
                        aria-label={`Play ${track.title}`}
                        className={`track-tile relative cursor-pointer ${
                          isCurrent || art ? "!border-solid" : ""
                        } ${isCurrent ? "ring-2 ring-[var(--tile-outline)]/25" : ""}`}
                      >
                        {art ? (
                          <img
                            src={art}
                            alt=""
                            className="h-full w-full object-cover"
                            draggable={false}
                          />
                        ) : isPlaying ? (
                          <PlayingBadge playing />
                        ) : (
                          <I.NoteSingle size={28} />
                        )}

                        {track.duration > 0 && (
                          <span
                            className={`tnum absolute bottom-2.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              art ? "bg-black/65 text-white" : "text-ink-3"
                            }`}
                          >
                            {formatTime(track.duration)}
                          </span>
                        )}
                      </button>

                      {/* Favorite */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(track.id);
                        }}
                        title={track.favorite ? "Unfavorite" : "Favorite"}
                        aria-label={track.favorite ? "Remove from favorites" : "Add to favorites"}
                        className={`icon-btn absolute top-2 left-2 h-6 w-6 rounded-full bg-paper-2/92 transition-opacity ${
                          track.favorite ? "opacity-100 text-[#D93848]" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
                        }`}
                      >
                        {track.favorite ? <I.HeartFilled size={12} /> : <I.Heart size={12} />}
                      </button>

                      {/* Set / Remove Cover quick button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (art && e.shiftKey) void clearTrackCover(track.id);
                          else void chooseTrackCover(track.id);
                        }}
                        title={art ? "Change cover (Shift+Click to remove cover)" : "Add song cover"}
                        aria-label={`Set cover image for ${track.title}`}
                        className="icon-btn absolute bottom-2 left-2 h-6 w-6 rounded-full bg-paper-2/92 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                      >
                        <I.ImagePlus size={12} />
                      </button>

                      {/* Queue */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void enqueueTrack(track, false);
                        }}
                        title="Add to queue"
                        aria-label={`Add ${track.title} to queue`}
                        className="icon-btn absolute right-2 bottom-2 h-6 w-6 rounded-full bg-paper-2/92 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                      >
                        <I.ListPlus size={13} />
                      </button>

                      {/* Remove from library */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTrack(track.id);
                        }}
                        title="Remove from library (file stays on disk)"
                        aria-label={`Remove ${track.title} from library`}
                        className="icon-btn absolute top-2 right-2 h-6 w-6 rounded-full bg-paper-2/92 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                      >
                        <I.X size={12} />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => void playFromList(looseTracks, idx, state.playback.shuffle)}
                      className="mt-2.5 w-full cursor-pointer text-center"
                    >
                      <div className="truncate-1 text-[13px] font-medium leading-snug text-ink" title={track.title}>
                        {track.title}
                      </div>
                      <div className="truncate-1 mt-0.5 text-[11px] text-ink-3">
                        {track.artist ?? "Single track"}
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <TrackTable
              tracks={looseTracks}
              currentId={playback.trackId}
              showAlbum
              onPlay={(index) => void playFromList(looseTracks, index, state.playback.shuffle)}
              onRemove={(track) => removeTrack(track.id)}
            />
          )}
        </section>
      )}
    </div>
  );
}
