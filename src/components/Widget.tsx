import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { formatTime } from "../lib/format";
import {
  closeWidget,
  next,
  openMainWindow,
  previous,
  seek,
  selectors,
  setVolume,
  setWidget,
  startWindowDrag,
  toggleMute,
  togglePlay,
  useApp,
} from "../state/store";
import * as I from "./Icons";

export interface WidgetProps {
  mode: "window" | "desktop" | "preview";
  onToggleSize?: () => void;
}

export function Widget({ mode }: WidgetProps) {
  const { playback, widget } = useApp();
  const track = selectors.trackById(playback.trackId);
  const artwork = selectors.artworkFor(track);
  const playing = playback.status === "playing";
  const compact = widget.size === "compact";
  const barRef = useRef<HTMLDivElement | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);

  // ---- Cover-widget dragging -------------------------------------------
  // A tap must toggle playback and a drag must move the window, on the same
  // surface. Tauri's `data-tauri-drag-region` cannot do both: its handler
  // preventDefaults and swallows the gesture, so the artwork swallowed every
  // click (and a double-click was turned into a maximise attempt). Here the
  // press is only promoted to a drag after the pointer travels past a small
  // threshold, and the click that follows a drag is suppressed.
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const suppressClickUntil = useRef(0);

  const beginDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragOrigin.current = { x: e.clientX, y: e.clientY };
  };

  const trackDrag = (e: React.PointerEvent) => {
    const origin = dragOrigin.current;
    if (!origin) return;
    if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < 4) return;
    dragOrigin.current = null;
    suppressClickUntil.current = Date.now() + 700;
    void startWindowDrag();
  };

  const endDrag = () => {
    dragOrigin.current = null;
  };

  const duration = playback.duration || track?.duration || 0;
  const shown = scrub ?? playback.position;
  const pct = duration > 0 ? Math.min(100, Math.max(0, (shown / duration) * 100)) : 0;

  const seekFromPointer = (clientX: number, commit: boolean) => {
    const el = barRef.current;
    if (!el || duration <= 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const target = ratio * duration;
    setScrub(commit ? null : target);
    if (commit) void seek(target);
  };

  // ---- Cover style ------------------------------------------------------
  // Bare artwork with two pure text lines underneath: no card, no frame, no
  // background, no shadow behind the glyphs. The window itself is transparent,
  // so the text sits directly on the desktop. Click the art to play/pause,
  // double-click to open the full player.
  if (widget.style === "cover") {
    const artSize = compact ? 180 : 240;
    return (
      <div
        className={
          mode === "window"
            ? "flex h-full w-full items-start justify-center bg-transparent p-2"
            : "w-fit"
        }
        onWheel={(e) => {
          if (Math.abs(e.deltaY) < 2) return;
          const step = e.deltaY < 0 ? 0.05 : -0.05;
          setVolume(playback.volume + step);
        }}
      >
        <div className="flex select-none flex-col items-center" style={{ width: artSize }}>
          {/* Artwork + hover controls. `group` drives the reveal; the buttons are
              siblings of the art (not children) so they never sit inside a
              <button> and never inherit the tap-to-pause handler. */}
          <div className="group relative" style={{ width: artSize, height: artSize }}>
            <button
              type="button"
              onPointerDown={beginDrag}
              onPointerMove={trackDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onClick={() => {
                if (Date.now() < suppressClickUntil.current) return;
                void togglePlay();
              }}
              onDoubleClick={() => void openMainWindow()}
              title={playing ? "Pause · double-click to open Vesper" : "Play · double-click to open Vesper"}
              aria-label={playing ? "Pause" : "Play"}
              className="block h-full w-full cursor-pointer overflow-hidden bg-[rgba(10,10,14,0.55)]"
            >
              {artwork ? (
                <img
                  src={artwork}
                  alt=""
                  draggable={false}
                  className="pointer-events-none h-full w-full object-cover"
                />
              ) : (
                <span className="pointer-events-none flex h-full w-full items-center justify-center text-white/50">
                  <I.NoteSingle size={compact ? 44 : 56} />
                </span>
              )}
            </button>

            {mode !== "preview" && (
              <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
                <button
                  type="button"
                  onClick={() => setWidget({ alwaysOnTop: !widget.alwaysOnTop })}
                  aria-pressed={widget.alwaysOnTop}
                  title={widget.alwaysOnTop ? "Pinned on top of other windows" : "Pin on top of other windows"}
                  aria-label="Toggle always on top"
                  className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-full backdrop-blur-sm transition-colors ${
                    widget.alwaysOnTop
                      ? "bg-white text-[#141418] hover:bg-white/88"
                      : "bg-black/55 text-white hover:bg-black/78"
                  }`}
                >
                  <I.Pin size={13} />
                </button>

                <button
                  type="button"
                  onClick={() => closeWidget()}
                  title="Close widget"
                  aria-label="Close widget"
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-[#c0392b]"
                >
                  <I.X size={13} />
                </button>
              </div>
            )}
          </div>

          {/* Two pure text lines — no background, no shadow, no outline.
              These keep the drag region so the widget can always be moved,
              even if the artwork drag is ever unavailable. */}
          <div
            data-tauri-drag-region
            className={`mt-[13px] w-full text-center leading-tight ${compact ? "text-[13.5px]" : "text-[15px]"}`}
          >
            <div data-tauri-drag-region className="truncate-1 font-bold tracking-[-0.01em] text-white">
              {track?.title ?? "Nothing playing"}
            </div>
            <div
              data-tauri-drag-region
              className={`truncate-1 mt-[2px] font-medium text-white/[0.62] ${
                compact ? "text-[11.5px]" : "text-[12.5px]"
              }`}
            >
              {track?.artist ?? "—"}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        mode === "window"
          ? "flex h-full w-full items-center justify-center bg-transparent p-[3px]"
          : compact
            ? "w-[360px]"
            : "w-[412px]"
      }
      onWheel={(e) => {
        if (Math.abs(e.deltaY) < 2) return;
        const step = e.deltaY < 0 ? 0.05 : -0.05;
        setVolume(playback.volume + step);
      }}
    >
      {/* Clean modern rounded card (rounded-[20px]) — zero rectangular shadow bleed in window mode */}
      <div
        data-tauri-drag-region
        // Glass opacity only tints the smoked-glass background (see .widget-pill
        // in index.css) — never the whole card, so text stays fully readable.
        style={
          {
            "--glass-a1": String(Math.min(1, Math.max(0.35, widget.opacity))),
            "--glass-a2": String(Math.min(1, Math.max(0.3, widget.opacity * 0.92))),
          } as CSSProperties
        }
        className={`widget-pill relative flex w-full items-center select-none text-[#F4F4F6] ${
          mode !== "window" ? "widget-pill-preview" : ""
        } ${compact ? "h-[92px] gap-3 p-3" : "h-[104px] gap-3.5 p-3.5"}`}
      >
        {/* Display-only song cover (strictly read-only — cannot change cover from widget) */}
        {widget.showArtwork && (
          <div
            data-tauri-drag-region
            className={`shrink-0 overflow-hidden rounded-[12px] border border-white/14 bg-white/[0.07] ${
              compact ? "h-[66px] w-[66px]" : "h-[76px] w-[76px]"
            }`}
          >
            {artwork ? (
              <img
                src={artwork}
                alt=""
                className="pointer-events-none h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <div className="pointer-events-none flex h-full w-full items-center justify-center bg-gradient-to-br from-white/[0.1] to-white/[0.03] text-white/70">
                <I.NoteSingle size={compact ? 22 : 26} />
              </div>
            )}
          </div>
        )}

        {/* Right clean 2-row stack */}
        <div data-tauri-drag-region className="flex min-w-0 flex-1 flex-col justify-between gap-2">
          {/* Top row: Song info + 3 compact icon-only controls (Open Full Player · Pin · Close) */}
          <div data-tauri-drag-region className="flex items-start justify-between gap-2">
            <div data-tauri-drag-region className="min-w-0 flex-1">
              <div
                data-tauri-drag-region
                className="truncate-1 text-[13.5px] font-semibold tracking-[-0.01em] text-white"
                title={track?.title ?? "No track playing"}
              >
                {track ? track.title : "Nothing playing"}
              </div>
              <div
                data-tauri-drag-region
                className="truncate-1 mt-0.5 text-[11.5px] font-normal text-white/58"
              >
                {track ? (track.artist ?? "Local audio") : "Select a song in Vesper"}
              </div>
            </div>

            {mode !== "preview" && (
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    void openMainWindow();
                    if (mode === "desktop") {
                      setWidget({ visible: false });
                    }
                  }}
                  title="Open full player"
                  aria-label="Open full player"
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-[7px] text-white/60 transition-colors hover:bg-white/12 hover:text-white"
                >
                  <I.ExternalLink size={12} />
                </button>

                <button
                  type="button"
                  onClick={() => setWidget({ alwaysOnTop: !widget.alwaysOnTop })}
                  title={widget.alwaysOnTop ? "Pinned on top" : "Pin always on top"}
                  aria-label="Toggle always on top"
                  className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-[7px] transition-colors hover:bg-white/12 ${
                    widget.alwaysOnTop ? "bg-white/18 text-white" : "text-white/60 hover:text-white"
                  }`}
                >
                  <I.Pin size={12} />
                </button>

                <button
                  type="button"
                  onClick={() => closeWidget()}
                  title="Close widget (quits Vesper & stops music if the main window is closed)"
                  aria-label="Close widget"
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-[7px] text-white/60 transition-colors hover:bg-white/12 hover:text-white"
                >
                  <I.X size={12} />
                </button>
              </div>
            )}
          </div>

          {/* Bottom row: Clean transport + rounded progress bar + crisp sans timecodes */}
          <div className="flex items-center gap-2.5">
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => void previous()}
                aria-label="Previous track"
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[8px] text-white/75 transition-colors hover:bg-white/12 hover:text-white"
              >
                <I.Prev size={13} />
              </button>

              <button
                type="button"
                onClick={() => void togglePlay()}
                aria-label={playing ? "Pause" : "Play"}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[10px] bg-white text-[#141418] transition-transform hover:scale-[1.04] active:scale-[0.97]"
              >
                {playing ? <I.Pause size={15} /> : <I.Play size={15} className="translate-x-[0.5px]" />}
              </button>

              <button
                type="button"
                onClick={() => void next()}
                aria-label="Next track"
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[8px] text-white/75 transition-colors hover:bg-white/12 hover:text-white"
              >
                <I.Next size={13} />
              </button>
            </div>

            {widget.showProgress && (
              <div
                ref={barRef}
                role="slider"
                tabIndex={track ? 0 : -1}
                aria-label="Seek position"
                aria-valuemin={0}
                aria-valuemax={Math.round(duration)}
                aria-valuenow={Math.round(shown)}
                onPointerDown={(e) => {
                  if (!track) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  seekFromPointer(e.clientX, false);
                }}
                onPointerMove={(e) => {
                  if (scrub !== null) seekFromPointer(e.clientX, false);
                }}
                onPointerUp={(e) => {
                  if (scrub !== null) seekFromPointer(e.clientX, true);
                }}
                className="group relative flex h-5 min-w-0 flex-1 cursor-pointer items-center"
              >
                <div className="relative h-[4.5px] w-full overflow-hidden rounded-full bg-white/18 transition-all group-hover:h-[6px]">
                  <div
                    className="h-full rounded-full bg-white transition-[width] duration-75"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}

            <div className="tnum shrink-0 text-[11px] font-medium text-white/74">
              {formatTime(shown)}
              <span className="mx-1 text-white/32">/</span>
              <span className="text-white/48">{formatTime(duration)}</span>
            </div>

            {widget.showVolume && !compact && (
              <button
                type="button"
                onClick={toggleMute}
                title="Mute / unmute (scroll wheel adjusts volume)"
                aria-label={playback.muted ? "Unmute" : "Mute"}
                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[7px] text-white/60 transition-colors hover:bg-white/12 hover:text-white"
              >
                {playback.muted || playback.volume === 0 ? (
                  <I.VolumeMute size={13} />
                ) : (
                  <I.Volume size={13} />
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Dedicated transparent OS window shell (`?window=widget` on Windows WebView2). */
export function WidgetWindow() {
  useEffect(() => {
    document.documentElement.classList.add("is-widget");
    return () => {
      document.documentElement.classList.remove("is-widget");
    };
  }, []);

  return <Widget mode="window" />;
}
