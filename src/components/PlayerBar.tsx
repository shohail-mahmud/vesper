import {
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
import { formatTime } from "../lib/format";
import { SeekBar } from "./Widget";
import * as I from "./Icons";

export function PlayerBar() {
  const state = useApp();
  const { playback, widget, drawer } = state;
  const track = selectors.trackById(playback.trackId);
  const art = selectors.artworkFor(track);
  const playing = playback.status === "playing";
  const duration = playback.duration || track?.duration || 0;

  return (
    <footer className="relative z-20 shrink-0 border-t-[1.5px] border-rule bg-paper-2">
      <div className="px-5 py-2.5">
        <div className="flex items-center gap-4">
          {/* Left: Outlined Square Artwork Tile + Track Info */}
          <div className="flex min-w-0 flex-[1.25] items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[4px] border-[1.5px] border-[var(--tile-outline)] bg-paper text-ink">
              {art ? (
                <img src={art} alt="" className="h-full w-full object-cover" draggable={false} />
              ) : (
                <I.NoteSingle size={20} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate-1 text-[13px] font-medium leading-tight text-ink" title={track?.title}>
                {track?.title ?? "Ready to play"}
              </div>
              <div className="truncate-1 mt-0.5 text-[11.5px] leading-tight text-ink-2">
                {track?.artist ?? (track ? "Local audio track" : "Select a folder or track")}
              </div>
            </div>
            {track && (
              <button
                type="button"
                onClick={() => toggleFavorite(track.id)}
                aria-label={track.favorite ? "Remove from favorites" : "Add to favorites"}
                title={track.favorite ? "Unfavorite" : "Favorite"}
                className={`icon-btn h-8 w-8 shrink-0 ${track.favorite ? "text-[#D93848]" : ""}`}
              >
                {track.favorite ? <I.HeartFilled size={15} /> : <I.Heart size={15} />}
              </button>
            )}
          </div>

          {/* Center: Transport Controls + Tabular Seek Bar */}
          <div className="flex flex-[1.6] flex-col items-center gap-1.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={`icon-btn h-8 w-8 ${playback.shuffle ? "!bg-ink !text-paper" : ""}`}
                onClick={() => setShuffle(!playback.shuffle)}
                title="Shuffle (S)"
                aria-pressed={playback.shuffle}
              >
                <I.Shuffle size={15} />
              </button>
              <button
                type="button"
                className="icon-btn h-8 w-8"
                onClick={() => void previous()}
                title="Previous (Shift + Left)"
              >
                <I.Prev size={16} />
              </button>
              <button
                type="button"
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-[1.5px] border-[var(--tile-outline)] bg-ink text-paper transition-transform duration-150 hover:scale-[1.04] active:scale-95"
                onClick={() => void togglePlay()}
                title={playing ? "Pause (Space)" : "Play (Space)"}
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? <I.Pause size={17} /> : <I.Play size={17} className="translate-x-[1px]" />}
              </button>
              <button
                type="button"
                className="icon-btn h-8 w-8"
                onClick={() => void next()}
                title="Next (Shift + Right)"
              >
                <I.Next size={16} />
              </button>
              <button
                type="button"
                className={`icon-btn h-8 w-8 ${playback.repeat !== "off" ? "!bg-ink !text-paper" : ""}`}
                onClick={cycleRepeat}
                title={`Repeat: ${playback.repeat} (R)`}
                aria-pressed={playback.repeat !== "off"}
              >
                {playback.repeat === "one" ? <I.RepeatOne size={15} /> : <I.Repeat size={15} />}
              </button>
            </div>

            <div className="flex w-full max-w-[460px] items-center gap-2.5">
              <span className="tnum w-9 text-right text-[10.5px] text-ink-2">
                {formatTime(playback.position)}
              </span>
              <div className="flex-1">
                <SeekBar
                  value={playback.position}
                  duration={duration}
                  onSeek={seek}
                  accent="var(--text-primary)"
                  track="rgba(113,113,122,0.24)"
                  label="Playback position"
                />
              </div>
              <span className="tnum w-9 text-[10.5px] text-ink-2">{formatTime(duration)}</span>
            </div>
          </div>

          {/* Right: Lyrics, 10-Band EQ, Queue, Floating Mini-Widget, Volume */}
          <div className="flex flex-[1.25] items-center justify-end gap-1">
            <button
              type="button"
              className={`icon-btn h-8 w-8 ${drawer === "lyrics" ? "!bg-ink !text-paper" : ""}`}
              onClick={() => setDrawer("lyrics")}
              title="Lyrics (L)"
              aria-pressed={drawer === "lyrics"}
            >
              <I.Lyrics size={16} />
            </button>
            <button
              type="button"
              className={`icon-btn h-8 w-8 ${
                drawer === "eq" || playback.eq.enabled ? "!bg-ink !text-paper" : ""
              }`}
              onClick={() => setDrawer("eq")}
              title="10-Band Equalizer & Speed (E)"
              aria-pressed={drawer === "eq"}
            >
              <I.Sliders size={15} />
            </button>
            <button
              type="button"
              className={`icon-btn h-8 w-8 ${drawer === "queue" ? "!bg-ink !text-paper" : ""}`}
              onClick={() => setDrawer("queue")}
              title="Up Next Queue (Q)"
              aria-pressed={drawer === "queue"}
            >
              <I.Queue size={16} />
            </button>
            <button
              type="button"
              className={`icon-btn h-8 w-8 ${widget.visible ? "!bg-ink !text-paper" : ""}`}
              onClick={() => setWidget({ visible: !widget.visible })}
              title={widget.visible ? "Hide Desktop Mini-Widget (W)" : "Show Desktop Mini-Widget (W)"}
              aria-pressed={widget.visible}
            >
              <I.Panel size={16} />
            </button>

            <div className="mx-1 h-4 w-[1px] bg-rule" />

            <button
              type="button"
              className="icon-btn h-8 w-8"
              onClick={toggleMute}
              title="Mute (M)"
            >
              {playback.muted ? <I.VolumeMute size={16} /> : <I.Volume size={16} />}
            </button>
            <div className="w-[82px]">
              <SeekBar
                value={playback.muted ? 0 : playback.volume * 100}
                duration={100}
                onSeek={(v) => setVolume(v / 100)}
                accent="var(--text-primary)"
                track="rgba(113,113,122,0.24)"
                height={3}
                label="Volume"
              />
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
