import { useState } from "react";
import {
  factoryReset,
  loadPlayableDemoAudio,
  openExternalUrl,
  setSettings,
  setView,
  setWidget,
  toast,
  useApp,
} from "../state/store";
import { SUPPORTED_EXTENSIONS } from "../lib/path";
import { native, runtime } from "../state/bridge";
import * as I from "./Icons";

/** Version comes from package.json at build time (vite.config.ts → `define`). */
const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
const SOURCE_URL = "https://github.com/shohail-mahmud/vesper";

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-8 border-b border-rule-soft py-4">
      <div className="max-w-[54ch]">
        <div className="text-[13px] font-medium leading-tight text-ink">{label}</div>
        {description && <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-[40px] cursor-pointer rounded-full border border-[var(--tile-outline)] transition-colors duration-150 ${
        checked ? "bg-ink" : "bg-paper"
      }`}
    >
      <span
        className={`absolute top-[2px] h-4 w-4 rounded-full transition-all duration-150 ${
          checked ? "bg-paper" : "bg-ink"
        }`}
        style={{ left: checked ? 20 : 2 }}
      />
    </button>
  );
}

function Section({
  index,
  title,
  caption,
  children,
}: {
  index: string;
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid grid-cols-1 gap-6 border-t border-rule pt-6 pb-8 lg:grid-cols-[210px_minmax(0,1fr)]">
      <div>
        <div className="plate text-ink-3">{index}</div>
        <h2 className="mt-2 text-[17px] font-semibold tracking-tight text-ink">{title}</h2>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-2">{caption}</p>
      </div>
      <div>{children}</div>
    </section>
  );
}

export function SettingsScreen() {
  const state = useApp();
  const { settings, widget, library } = state;
  const [confirmingReset, setConfirmingReset] = useState(false);

  const trackCount = Object.keys(library.tracks).length;
  const folderCount = library.folders.length;
  const playlistCount = library.playlists.length;

  return (
    <div className="fade px-8 py-9 sm:px-11">
      <button
        type="button"
        className="plate flex cursor-pointer items-center gap-2 text-ink-3 transition-colors hover:text-ink"
        onClick={() => setView({ name: "home" })}
      >
        <I.ArrowLeft size={13} /> Home
      </button>

      <header className="mt-5 mb-8">
        <h1 className="text-[24px] font-semibold tracking-tight text-ink">Settings</h1>
        <p className="mt-1.5 max-w-[56ch] text-[12.5px] leading-relaxed text-ink-2">
          Preferences are persisted locally in SQLite on Windows and never leave your machine. Theme
          and shuffle live on the home screen and player bar.
        </p>
      </header>

      <Section
        index="01 / Widget"
        title="Floating desktop widget"
        caption="Smoked-glass mini-player shared with the main playback engine."
      >
        <Row label="Always on top" description="Pin the mini-player above other Windows applications.">
          <Toggle
            checked={widget.alwaysOnTop}
            onChange={(v) => setWidget({ alwaysOnTop: v })}
            label="Always on top"
          />
        </Row>
        <Row
          label="Widget style"
          description={
            widget.style === "cover"
              ? "Cover shows the artwork alone with the title and artist as plain text — click the art to play or pause, double-click to open Vesper."
              : "Pill is the glass card with transport controls, progress bar and optional volume."
          }
        >
          <div className="flex overflow-hidden rounded-[6px] border-[1.5px] border-[var(--tile-outline)]">
            {(["pill", "cover"] as const).map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => setWidget({ style })}
                aria-pressed={(widget.style ?? "pill") === style}
                className={`plate px-3.5 py-2 capitalize transition-colors ${
                  (widget.style ?? "pill") === style ? "bg-ink text-paper" : "bg-paper-2 text-ink-2 hover:text-ink"
                }`}
              >
                {style}
              </button>
            ))}
          </div>
        </Row>
        <Row
          label="Widget size"
          description={
            widget.style === "cover"
              ? "Compact shows a 180px cover, expanded a 240px cover."
              : "Compact trims the pill down to artwork, title, transport and time; expanded adds the volume control."
          }
        >
          <div className="flex overflow-hidden rounded-[6px] border-[1.5px] border-[var(--tile-outline)]">
            {(["compact", "expanded"] as const).map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setWidget({ size })}
                aria-pressed={widget.size === size}
                className={`plate px-3.5 py-2 transition-colors ${
                  widget.size === size ? "bg-ink text-paper" : "bg-paper-2 text-ink-2 hover:text-ink"
                }`}
              >
                {size}
              </button>
            ))}
          </div>
        </Row>
        {/* Pill-only rows. Kept in the tree so switching back to Pill restores
            everything exactly as it was. Cover has no card, no progress bar and
            no volume — it is bare artwork plus two text lines. */}
        {(widget.style ?? "pill") === "pill" && (
          <>
          <Row
            label={`Glass opacity — ${Math.round(widget.opacity * 100)}%`}
            description="Fades only the smoked-glass background; the song title, artist and controls stay fully readable."
          >
            <input
              type="range"
              className="vesper-range w-[160px]"
              min={55}
              max={100}
              value={Math.round(widget.opacity * 100)}
              onChange={(e) => setWidget({ opacity: Number(e.target.value) / 100 })}
              aria-label="Widget opacity"
            />
          </Row>
          <Row label="Show album artwork">
            <Toggle
              checked={widget.showArtwork}
              onChange={(v) => setWidget({ showArtwork: v })}
              label="Show artwork"
            />
          </Row>
          <Row label="Show progress bar & timecodes">
            <Toggle
              checked={widget.showProgress}
              onChange={(v) => setWidget({ showProgress: v })}
              label="Show progress"
            />
          </Row>
          <Row label="Show volume slider">
            <Toggle
              checked={widget.showVolume}
              onChange={(v) => setWidget({ showVolume: v })}
              label="Show volume"
            />
          </Row>
          </>
        )}
      </Section>

      <Section
        index="02 / Library"
        title="Scanning & imports"
        caption="How folders and audio files are indexed when added. Closing the last window always ends the session — nothing keeps running in the background."
      >
        <Row
          label="Include nested subfolders when importing a folder"
          description="Off by default so importing a top-level directory never pulls in unwanted subfolder trees unless requested."
        >
          <Toggle
            checked={settings.recursiveScan}
            onChange={(v) => setSettings({ recursiveScan: v })}
            label="Include nested folders"
          />
        </Row>
        <Row label="Supported audio formats">
          <div className="flex max-w-[260px] flex-wrap justify-end gap-1.5">
            {SUPPORTED_EXTENSIONS.map((ext) => (
              <span
                key={ext}
                className="plate rounded-[4px] border border-rule bg-paper-2 px-2 py-[5px] text-ink-2"
              >
                {ext}
              </span>
            ))}
          </div>
        </Row>
      </Section>

      <Section
        index="03 / Data"
        title="Clean data"
        caption="Vesper only ever stores its own library index and cover thumbnails locally."
      >
        {runtime.isTauri && (
          <Row
            label="Where Vesper keeps your library"
            description="%LOCALAPPDATA%\Vesper — the SQLite index, cached cover art and preferences. It lives outside the installer, so updating or reinstalling Vesper keeps your library, and uninstalling (MSI) leaves this folder alone. Use Clean data below to erase it."
          >
            <button
              type="button"
              className="btn btn-ghost py-1.5 text-[11.5px]"
              onClick={() => {
                void native
                  .openDataFolder()
                  .then((path) => toast("info", "Data folder", path))
                  .catch((err: unknown) =>
                    toast("error", "Could not open folder", err instanceof Error ? err.message : String(err)),
                  );
              }}
            >
              <I.Folder size={13} /> Open folder
            </button>
          </Row>
        )}
        <Row
          label="Clean data — factory reset"
          description={`Erases Vesper's library index (${trackCount} track${trackCount === 1 ? "" : "s"}, ${folderCount} folder${folderCount === 1 ? "" : "s"}, ${playlistCount} playlist${playlistCount === 1 ? "" : "s"}), custom covers, cached artwork, equalizer settings and preferences, then restarts the app brand-new. Your music files on disk are never touched.`}
        >
          <button
            type="button"
            className="btn btn-ghost py-1.5 text-[11.5px]"
            onClick={() => setConfirmingReset((v) => !v)}
            aria-expanded={confirmingReset}
          >
            <I.Trash size={13} /> Clean data…
          </button>
        </Row>

        {confirmingReset && (
          <div className="mt-3 rounded-[10px] border-[1.5px] border-[#b4342a] px-4 py-3.5">
            <p className="text-[12.5px] font-semibold text-[#b4342a]">Erase all Vesper data?</p>
            <ul className="mt-2 space-y-1 pl-4 text-[11.5px] leading-relaxed text-ink-2">
              <li className="list-disc">Playback stops immediately and Vesper restarts empty.</li>
              <li className="list-disc">
                Removes {trackCount} track{trackCount === 1 ? "" : "s"}, {folderCount} folder
                {folderCount === 1 ? "" : "s"}, {playlistCount} playlist
                {playlistCount === 1 ? "" : "s"}, custom covers, EQ and preferences.
              </li>
              <li className="list-disc font-medium text-ink">
                Your audio files on disk are never deleted — you can import the same folders again.
              </li>
            </ul>
            <div className="mt-3.5 flex items-center gap-2">
              <button
                type="button"
                className="btn btn-ghost py-1.5 text-[11.5px]"
                onClick={() => setConfirmingReset(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn py-1.5 text-[11.5px] border-[1.5px] border-[#b4342a] bg-[#b4342a] text-white"
                onClick={() => {
                  setConfirmingReset(false);
                  void factoryReset();
                }}
              >
                Yes, erase everything
              </button>
            </div>
          </div>
        )}

        {!runtime.isTauri && (
          <Row
            label="Generate real playable WAV test tracks"
            description="Browser preview only: synthesizes real stereo PCM audio + synced .lrc lyrics in memory if you don't have local audio files handy."
          >
            <button
              type="button"
              className="btn btn-ghost py-1.5 text-[11.5px]"
              onClick={() => void loadPlayableDemoAudio()}
            >
              <I.Music size={13} /> Load real test WAVs
            </button>
          </Row>
        )}
      </Section>

      <Section
        index="04 / About"
        title="Vesper"
        caption="A small, honest music player that plays your own files."
      >
        <div className="border-b border-rule-soft py-4">
          <div className="flex items-baseline gap-2.5">
            <span className="text-[15px] font-semibold tracking-tight text-ink">Vesper</span>
            <span className="plate rounded-[4px] border border-rule bg-paper-2 px-2 py-[3px] text-ink-2">
              v{APP_VERSION}
            </span>
          </div>
          <p className="mt-2 max-w-[54ch] text-[12px] leading-relaxed text-ink-2">
            One of the most lightweight desktop music players you can install: a small native Rust
            core that plays your local files directly, with a real 10-band equalizer, permanent custom
            covers, synced lyrics and a floating desktop widget. Your library never leaves your machine
            — no accounts, no telemetry, no cloud sync, and it makes <span className="text-ink">zero network
            requests</span>: the fonts ship inside the app, so once Vesper is installed it plays with the
            internet cable unplugged. Completely open source.
          </p>

          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-[12px] sm:grid-cols-[132px_minmax(0,1fr)]">
            <dt className="plate text-ink-3">Developer</dt>
            <dd className="text-ink">Shohail Mahmud</dd>

            <dt className="plate text-ink-3">Source code</dt>
            <dd>
              <button
                type="button"
                onClick={() => openExternalUrl(SOURCE_URL)}
                title={SOURCE_URL}
                className="inline-flex cursor-pointer items-center gap-1.5 border-b border-rule pb-[1px] text-ink transition-colors hover:border-ink"
              >
                github.com/shohail-mahmud/vesper
                <I.ExternalLink size={11} />
              </button>
            </dd>

            <dt className="plate text-ink-3">License</dt>
            <dd className="text-ink-2">MIT</dd>

            <dt className="plate text-ink-3">Storage</dt>
            <dd className="text-ink-2">
              {runtime.isTauri
                ? "SQLite · %LOCALAPPDATA%\\Vesper\\library.db"
                : "WebAudio + localStorage (browser preview)"}
            </dd>
          </dl>
        </div>

        <p className="pt-4 text-[11px] leading-relaxed text-ink-3">
          Settings for appearance (light/dark) and playback (shuffle, repeat, equalizer) live where you
          use them — top bar, player bar and the EQ panel — so this page only holds what has no other
          home.
        </p>
      </Section>
    </div>
  );
}
