import { useEffect, useRef, useState } from "react";
import { formatTime } from "../lib/format";
import {
  chooseTrackCover,
  clearTrackCover,
  cycleRepeat,
  next,
  previous,
  seek,
  selectors,
  setDrawer,
  setShuffle,
  setVolume,
  setWidget,
  toggleFavorite,
  toggleMute,
  togglePlay,
  useApp,
} from "../state/store";
import * as I from "./Icons";

export function PlayerBar() {
  const { playback, drawer, widget } = useApp();
  const track = selectors.trackById(playback.trackId);
  const artwork = selectors.artworkFor(track);
  const [scrub, setScrub] = useState<number | null>(null);
  const [coverMenuOpen, setCoverMenuOpen] = useState(false);
  const seekBarRef = useRef<HTMLDivElement | null>(null);
  const volBarRef = useRef<HTMLDivElement | null>(null);
  const coverRef = useRef<HTMLDivElement | null>(null);

  const duration = playback.duration || track?.duration || 0;
  const shown = scrub ?? playback.position;
  const progressPct = duration > 0 ? Math.min(100, Math.max(0, (shown / duration) * 100)) : 0;
  const volumePct = Math.round((playback.muted ? 0 : playback.volume) * 100);
  const playing = playback.status === "playing";

  useEffect(() => {
    if (!coverMenuOpen) return;
    const close = (e: PointerEvent) => {
      if (coverRef.current && !coverRef.current.contains(e.target as Node)) {
        setCoverMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [coverMenuOpen]);

  const updateSeekFromPointer = (clientX: number, commit: boolean) => {
    const el = seekBarRef.current;
    if (!el || duration <= 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const target = ratio * duration;
    setScrub(commit ? null : target);
    if (commit) void seek(target);
  };

  const updateVolumeFromPointer = (clientX: number) => {
    const el = volBarRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setVolume(ratio);
  };

  return (
    <footer aria-label="Now playing" className="shrink-0 bg-paper px-4 pt-1.5 pb-3 select-none">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-5 rounded-[22px] border-[1.5px] border-rule bg-paper-2 px-4 py-2.5 shadow-[0_8px_28px_rgba(0,0,0,0.06)]">
        {/* 1. Left: Interactive Cover Art + Song Title & Artist */}
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <div ref={coverRef} className="relative shrink-0">
            <button
              type="button"
              disabled={!track}
              onClick={() => {
                if (!track) return;
                if (artwork) setCoverMenuOpen((v) => !v);
                else void chooseTrackCover(track.id);
              }}
              title={
                !track
                  ? "Select a track to play"
                  : artwork
                    ? "Change or remove song cover"
                    : "Click to add a cover image for this song"
              }
              aria-label={artwork ? "Manage song cover" : "Add song cover"}
              className="group relative flex h-[54px] w-[54px] items-center justify-center overflow-hidden rounded-[14px] border border-rule bg-paper text-ink-2 transition-all hover:border-[var(--tile-outline)] disabled:cursor-default"
            >
              {artwork ? (
                <img
                  src={artwork}
                  alt={`${track?.title ?? "Track"} cover`}
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              ) : (
                <I.NoteSingle size={22} className="text-ink-3" />
              )}

              {track && (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-black/58 text-[9.5px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <I.ImagePlus size={14} />
                  <span>{artwork ? "Cover" : "+ Cover"}</span>
                </span>
              )}
            </button>

            {coverMenuOpen && track && (
              <div
                role="menu"
                className="rise absolute bottom-[62px] left-0 z-50 w-44 overflow-hidden rounded-[12px] border-[1.5px] border-[var(--tile-outline)] bg-paper-2 p-1 shadow-[0_14px_34px_rgba(0,0,0,0.18)]"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setCoverMenuOpen(false);
                    void chooseTrackCover(track.id);
                  }}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-3 py-2 text-left text-[12.5px] font-medium text-ink transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <I.ImagePlus size={14} />
                  <span>Change Cover</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setCoverMenuOpen(false);
                    void clearTrackCover(track.id);
                  }}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-3 py-2 text-left text-[12.5px] font-medium text-[#C53949] transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <I.ImageOff size={14} />
                  <span>Remove Cover</span>
                </button>
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            {track ? (
              <>
                <div className="flex items-center gap-1.5">
                  <span
                    className="truncate-1 text-[14px] font-semibold tracking-[-0.01em] text-ink"
                    title={track.title}
                  >
                    {track.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleFavorite(track.id)}
                    aria-label={track.favorite ? "Remove from favorites" : "Add to favorites"}
                    title={track.favorite ? "Remove from Favorites" : "Save to Favorites"}
                    className={`icon-btn h-7 w-7 shrink-0 ${track.favorite ? "text-[#D93848]" : ""}`}
                  >
                    {track.favorite ? <I.HeartFilled size={14} /> : <I.Heart size={14} />}
                  </button>
                </div>
                <div className="truncate-1 mt-0.5 text-[12px] text-ink-2">
                  {track.artist ?? "Local audio"}
                  {track.album ? ` · ${track.album}` : ""}
                </div>
              </>
            ) : (
              <div>
                <div className="text-[13.5px] font-medium text-ink-2">Ready to play</div>
                <div className="mt-0.5 text-[11.5px] text-ink-3">Choose a folder or song from Home</div>
              </div>
            )}
          </div>
        </div>

        {/* 2. Center: Tactile Transport Controls + Smooth Rounded Scrubber */}
        <div className="flex max-w-[540px] flex-[1.35] flex-col items-center gap-1.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShuffle(!playback.shuffle)}
              aria-pressed={playback.shuffle}
              aria-label="Shuffle"
              title={playback.shuffle ? "Shuffle enabled" : "Shuffle off"}
              className={`icon-btn relative h-8 w-8 ${
                playback.shuffle ? "bg-[var(--surface-hover)] text-ink" : "text-ink-3"
              }`}
            >
              <I.Shuffle size={15} />
              {playback.shuffle && (
                <span className="absolute bottom-1 h-1 w-1 rounded-full bg-ink" />
              )}
            </button>

            <button
              type="button"
              onClick={() => void previous()}
              aria-label="Previous track"
              title="Previous track"
              className="icon-btn h-8 w-8 text-ink"
            >
              <I.Prev size={16} />
            </button>

            <button
              type="button"
              onClick={() => void togglePlay()}
              aria-label={playing ? "Pause" : "Play"}
              title={playing ? "Pause (Space)" : "Play (Space)"}
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-[var(--tile-outline)] text-paper-2 shadow-sm transition-transform hover:scale-[1.04] active:scale-[0.97]"
            >
              {playing ? <I.Pause size={18} /> : <I.Play size={18} className="translate-x-[1px]" />}
            </button>

            <button
              type="button"
              onClick={() => void next()}
              aria-label="Next track"
              title="Next track"
              className="icon-btn h-8 w-8 text-ink"
            >
              <I.Next size={16} />
            </button>

            <button
              type="button"
              onClick={cycleRepeat}
              aria-pressed={playback.repeat !== "off"}
              aria-label={`Repeat: ${playback.repeat}`}
              title={`Repeat: ${playback.repeat}`}
              className={`icon-btn relative h-8 w-8 ${
                playback.repeat !== "off" ? "bg-[var(--surface-hover)] text-ink" : "text-ink-3"
              }`}
            >
              {playback.repeat === "one" ? <I.RepeatOne size={15} /> : <I.Repeat size={15} />}
              {playback.repeat !== "off" && (
                <span className="absolute bottom-1 h-1 w-1 rounded-full bg-ink" />
              )}
            </button>
          </div>

          {/* Smooth custom pill progress bar + crisp sans-serif numbers */}
          <div className="flex w-full items-center gap-3">
            <span className="tnum w-10 text-right text-[11.5px] font-medium text-ink-2">
              {formatTime(shown)}
            </span>

            <div
              ref={seekBarRef}
              role="slider"
              tabIndex={track ? 0 : -1}
              aria-label="Seek track position"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(shown)}
              onPointerDown={(e) => {
                if (!track) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                updateSeekFromPointer(e.clientX, false);
              }}
              onPointerMove={(e) => {
                if (scrub !== null) updateSeekFromPointer(e.clientX, false);
              }}
              onPointerUp={(e) => {
                if (scrub !== null) updateSeekFromPointer(e.clientX, true);
              }}
              className={`group relative flex h-5 flex-1 items-center ${
                track ? "cursor-pointer" : "cursor-default opacity-45"
              }`}
            >
              <div className="relative h-[5px] w-full overflow-hidden rounded-full bg-ink/12 transition-all group-hover:h-[6px]">
                <div
                  className="h-full rounded-full bg-[var(--tile-outline)] transition-[width] duration-75"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              {track && (
                <span
                  className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 rounded-full bg-[var(--tile-outline)] opacity-0 shadow transition-opacity group-hover:opacity-100"
                  style={{ left: `${progressPct}%` }}
                />
              )}
            </div>

            <span className="tnum w-10 text-[11.5px] font-medium text-ink-3">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* 3. Right: Clean Utility Pill Strip + Smooth Volume Bar */}
        <div className="flex flex-1 items-center justify-end gap-2">
          <div className="flex items-center gap-0.5 rounded-full border border-rule-soft bg-paper px-1.5 py-1">
            <button
              type="button"
              onClick={() => setDrawer("lyrics")}
              aria-pressed={drawer === "lyrics"}
              aria-label="Lyrics panel"
              title="Synced Lyrics (L)"
              className={`icon-btn h-7 w-7 ${drawer === "lyrics" ? "bg-paper-2 text-ink shadow-xs" : ""}`}
            >
              <I.Lyrics size={14} />
            </button>

            <button
              type="button"
              onClick={() => setDrawer("eq")}
              aria-pressed={drawer === "eq"}
              aria-label="10-Band Equalizer"
              title="10-Band Equalizer (E)"
              className={`icon-btn relative h-7 w-7 ${drawer === "eq" ? "bg-paper-2 text-ink shadow-xs" : ""}`}
            >
              <I.Sliders size={14} />
              {playback.eq.enabled && (
                <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-ink" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setDrawer("queue")}
              aria-pressed={drawer === "queue"}
              aria-label="Play Queue"
              title="Up Next Queue (Q)"
              className={`icon-btn h-7 w-7 ${drawer === "queue" ? "bg-ink text-paper shadow-xs" : ""}`}
            >
              <I.Queue size={14} />
            </button>

            <button
              type="button"
              onClick={() => setWidget({ visible: !widget.visible })}
              aria-pressed={widget.visible}
              aria-label="Toggle round desktop mini-player"
              title="Toggle round floating desktop widget"
              className={`icon-btn h-7 w-7 ${widget.visible ? "bg-ink text-paper shadow-xs" : ""}`}
            >
              <I.Panel size={14} />
            </button>
          </div>

          <div className="hidden items-center gap-2 pl-1 sm:flex">
            <button
              type="button"
              onClick={toggleMute}
              aria-label={playback.muted ? "Unmute" : "Mute"}
              title={playback.muted ? "Unmute (M)" : "Mute (M)"}
              className="icon-btn h-8 w-8"
            >
              {playback.muted || playback.volume === 0 ? (
                <I.VolumeMute size={15} />
              ) : (
                <I.Volume size={15} />
              )}
            </button>

            <div
              ref={volBarRef}
              role="slider"
              tabIndex={0}
              aria-label="Volume"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={volumePct}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                updateVolumeFromPointer(e.clientX);
              }}
              onPointerMove={(e) => {
                if (e.buttons === 1) updateVolumeFromPointer(e.clientX);
              }}
              className="group relative flex h-5 w-20 cursor-pointer items-center"
            >
              <div className="relative h-[5px] w-full overflow-hidden rounded-full bg-ink/12 transition-all group-hover:h-[6px]">
                <div
                  className="h-full rounded-full bg-[var(--tile-outline)]"
                  style={{ width: `${volumePct}%` }}
                />
              </div>
              <span
                className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-[var(--tile-outline)] opacity-0 shadow transition-opacity group-hover:opacity-100"
                style={{ left: `${volumePct}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
