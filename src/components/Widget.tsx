import { useCallback, useEffect, useRef } from "react";
import {
  cycleRepeat,
  next,
  openMainWindow,
  previous,
  seek,
  selectors,
  setShuffle,
  setVolume,
  setWidget,
  toggleMute,
  togglePlay,
  useApp,
} from "../state/store";
import { formatTime, percent } from "../lib/format";
import * as I from "./Icons";

export function SeekBar({
  value,
  duration,
  onSeek,
  accent = "#FFFFFF",
  track = "rgba(255,255,255,0.20)",
  height = 3,
  label,
}: {
  value: number;
  duration: number;
  onSeek: (seconds: number) => void;
  accent?: string;
  track?: string;
  height?: number;
  label: string;
}) {
  const pct = percent(value, duration);
  return (
    <input
      type="range"
      className="vesper-range"
      min={0}
      max={Math.max(1, Math.round(duration) || 1)}
      step={1}
      value={Math.round(value)}
      aria-label={label}
      onChange={(e) => onSeek(Number(e.target.value))}
      style={
        {
          "--track-h": `${height}px`,
          "--track-bg": `linear-gradient(to right, ${accent} 0%, ${accent} ${pct}%, ${track} ${pct}%, ${track} 100%)`,
          "--thumb-bg": accent,
        } as React.CSSProperties
      }
    />
  );
}

function Equalizer({ active }: { active: boolean }) {
  return (
    <span className="flex h-3 items-end gap-[2px]" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={active ? "eq-bar w-[2px] rounded-full bg-white" : "w-[2px] rounded-full bg-white/30"}
          style={{ height: "100%", animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}

/**
 * Floating Desktop Mini-Widget.
 * Mounted in its own transparent OS window (`index.html?window=widget`) on Windows,
 * and as a draggable floating overlay in web preview mode.
 */
export function Widget({
  mode,
  onToggleSize,
}: {
  mode: "desktop" | "window";
  onToggleSize?: () => void;
}) {
  const state = useApp();
  const { widget, playback } = state;
  const track = selectors.trackById(playback.trackId);
  const art = selectors.artworkFor(track);
  const playing = playback.status === "playing";
  const compact = widget.size === "compact";
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  const beginDrag = useCallback(
    (event: React.PointerEvent) => {
      const target = event.target as HTMLElement | null;
      // Never hijack interactive controls when dragging the window!
      if (target?.closest("button, input, a, select, [role='switch']")) return;

      const tauriWindow = (window as any).__TAURI__?.window?.getCurrentWindow?.();
      if (mode === "window" && tauriWindow?.startDragging) {
        event.preventDefault();
        void tauriWindow.startDragging();
        return;
      }
      if (mode !== "desktop") return;
      event.preventDefault();
      dragRef.current = { x: event.clientX, y: event.clientY, ox: widget.x, oy: widget.y };
      (event.target as Element).setPointerCapture?.(event.pointerId);
    },
    [mode, widget.x, widget.y],
  );

  const beginResize = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      resizeRef.current = { x: event.clientX, y: event.clientY, w: widget.width, h: widget.height };
      (event.target as Element).setPointerCapture?.(event.pointerId);
    },
    [widget.width, widget.height],
  );

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (dragRef.current) {
        const d = dragRef.current;
        setWidget({
          x: d.ox + (event.clientX - d.x),
          y: d.oy + (event.clientY - d.y),
        });
      }
      if (resizeRef.current) {
        const r = resizeRef.current;
        setWidget({
          width: Math.min(560, Math.max(compact ? 260 : 300, r.w + (event.clientX - r.x))),
          height: Math.min(340, Math.max(compact ? 88 : 150, r.h + (event.clientY - r.y))),
        });
      }
    };
    const up = () => {
      dragRef.current = null;
      resizeRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [compact]);

  const hide = () => setWidget({ visible: false });

  return (
    <div
      className="glass group relative flex select-none flex-col overflow-hidden rounded-[18px] border border-white/18 text-white"
      style={{
        width: mode === "window" ? "100%" : widget.width,
        height: mode === "window" ? "100%" : widget.height,
        opacity: widget.opacity,
      }}
      onPointerDown={beginDrag}
      onDoubleClick={onToggleSize}
    >
      <div className="relative flex min-h-0 flex-1 gap-3.5 p-3.5">
        {widget.showArtwork && (
          <div
            className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-white/16 bg-white/8 text-white/80"
            style={{ width: compact ? 52 : 84, height: compact ? 52 : 84 }}
          >
            {art ? (
              <img
                src={art}
                alt={track?.album ? `Artwork for ${track.album}` : "Album artwork"}
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <I.NoteSingle size={compact ? 22 : 30} />
            )}
            {playing && (
              <div className="absolute bottom-2 left-2 rounded bg-black/50 px-1 py-0.5">
                <Equalizer active />
              </div>
            )}
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div
                className="truncate-1 text-[14px] leading-tight font-medium text-white"
                title={track?.title ?? "Ready to play"}
              >
                {track?.title ?? "Ready to play"}
              </div>
              <div
                className="truncate-1 mt-[3px] text-[11.5px] leading-tight text-white/70"
                title={track?.artist ?? (track ? "Local track" : "Vesper")}
              >
                {track?.artist ?? (track ? "Local track" : "Vesper")}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-0.5 opacity-80 transition-opacity duration-150 group-hover:opacity-100">
              {mode === "window" && (
                <button
                  type="button"
                  className="icon-btn h-7 w-7 text-white/75 hover:bg-white/15 hover:text-white"
                  onClick={() => void openMainWindow()}
                  title="Open Vesper Library Window"
                  aria-label="Open Vesper Library Window"
                >
                  <I.ExternalLink size={13} />
                </button>
              )}
              <button
                type="button"
                className={`icon-btn h-7 w-7 text-white/75 hover:bg-white/15 hover:text-white ${
                  widget.alwaysOnTop ? "bg-white/20 text-white" : ""
                }`}
                onClick={() => setWidget({ alwaysOnTop: !widget.alwaysOnTop })}
                title={widget.alwaysOnTop ? "Unpin from top" : "Pin always on top"}
                aria-pressed={widget.alwaysOnTop}
              >
                <I.Pin size={13} />
              </button>
              {onToggleSize && (
                <button
                  type="button"
                  className="icon-btn h-7 w-7 text-white/75 hover:bg-white/15 hover:text-white"
                  onClick={onToggleSize}
                  title={compact ? "Expanded size" : "Compact size"}
                >
                  <I.Panel size={13} />
                </button>
              )}
              <button
                type="button"
                className="icon-btn h-7 w-7 text-white/75 hover:bg-white/15 hover:text-white"
                onClick={hide}
                title="Hide widget (playback continues)"
              >
                <I.EyeOff size={13} />
              </button>
            </div>
          </div>

          <div className="flex-1" />

          {widget.showProgress && (
            <div className="mb-1.5">
              <SeekBar
                value={playback.position}
                duration={playback.duration || track?.duration || 0}
                onSeek={seek}
                label="Playback position"
              />
              <div className="mt-1 flex items-center justify-between text-white/65">
                <span className="tnum text-[10px]">{formatTime(playback.position)}</span>
                <span className="tnum text-[10px]">
                  {formatTime(playback.duration || track?.duration || 0)}
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            {!compact && (
              <button
                type="button"
                className={`icon-btn h-7 w-7 ${
                  playback.shuffle ? "bg-white/20 text-white" : "text-white/60"
                } hover:bg-white/15 hover:text-white`}
                onClick={() => setShuffle(!playback.shuffle)}
                title="Shuffle"
                aria-pressed={playback.shuffle}
              >
                <I.Shuffle size={14} />
              </button>
            )}
            <button
              type="button"
              className="icon-btn h-8 w-8 text-white/90 hover:bg-white/15 hover:text-white"
              onClick={() => void previous()}
              title="Previous track"
            >
              <I.Prev size={16} />
            </button>
            <button
              type="button"
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white text-[#141416] shadow transition-transform duration-150 hover:scale-[1.05] active:scale-95"
              onClick={() => void togglePlay()}
              title={playing ? "Pause" : "Play"}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <I.Pause size={16} /> : <I.Play size={16} className="translate-x-[1px]" />}
            </button>
            <button
              type="button"
              className="icon-btn h-8 w-8 text-white/90 hover:bg-white/15 hover:text-white"
              onClick={() => void next()}
              title="Next track"
            >
              <I.Next size={16} />
            </button>
            {!compact && (
              <button
                type="button"
                className={`icon-btn h-7 w-7 ${
                  playback.repeat !== "off" ? "bg-white/20 text-white" : "text-white/60"
                } hover:bg-white/15 hover:text-white`}
                onClick={cycleRepeat}
                title={`Repeat: ${playback.repeat}`}
                aria-pressed={playback.repeat !== "off"}
              >
                {playback.repeat === "one" ? <I.RepeatOne size={14} /> : <I.Repeat size={14} />}
              </button>
            )}
            <div className="flex-1" />
            {!compact && widget.showVolume && (
              <div className="flex w-[86px] items-center gap-1.5">
                <button
                  type="button"
                  onClick={toggleMute}
                  className="text-white/65 hover:text-white"
                  title="Mute"
                >
                  {playback.muted ? <I.VolumeMute size={14} /> : <I.Volume size={14} />}
                </button>
                <SeekBar
                  value={playback.muted ? 0 : playback.volume * 100}
                  duration={100}
                  onSeek={(v) => setVolume(v / 100)}
                  accent="#FFFFFF"
                  height={2}
                  label="Volume"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {mode === "desktop" && (
        <div
          className="absolute right-0 bottom-0 h-4 w-4 cursor-nwse-resize opacity-0 transition-opacity group-hover:opacity-100"
          onPointerDown={beginResize}
          title="Resize widget"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4 text-white/50">
            <path
              d="M13 3 3 13M13 8l-5 5"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        </div>
      )}
    </div>
  );
}

export function WidgetWindow() {
  const state = useApp();

  useEffect(() => {
    document.documentElement.classList.add("is-widget");
    return () => {
      document.documentElement.classList.remove("is-widget");
    };
  }, []);

  if (!state.ready) {
    return <div className="h-screen w-screen bg-transparent p-2" />;
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center overflow-hidden bg-transparent p-2">
      <Widget
        mode="window"
        onToggleSize={() =>
          setWidget({
            size: state.widget.size === "compact" ? "expanded" : "compact",
            width: state.widget.size === "compact" ? 384 : 300,
            height: state.widget.size === "compact" ? 188 : 98,
          })
        }
      />
    </div>
  );
}
