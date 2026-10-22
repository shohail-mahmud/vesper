import {
  loadPlayableDemoAudio,
  setSettings,
  setShuffle,
  setView,
  setWidget,
  toast,
  useApp,
} from "../state/store";
import { SUPPORTED_EXTENSIONS } from "../lib/path";
import { native, runtime } from "../state/bridge";
import * as I from "./Icons";

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
  const { settings, widget, playback } = state;

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
          Preferences are persisted locally in SQLite on Windows and never leave your machine.
        </p>
      </header>

      <Section
        index="01 / Appearance"
        title="Surface & window"
        caption="Solid high-contrast minimalism built for distraction-free listening."
      >
        <Row
          label="Solid dark surface"
          description="Switch between crisp solid off-white and solid dark charcoal while keeping sharp high-contrast outlines."
        >
          <Toggle
            checked={settings.theme === "dark"}
            onChange={(dark) => setSettings({ theme: dark ? "dark" : "light" })}
            label="Dark theme"
          />
        </Row>
        <Row
          label="Minimize to Windows System Tray on close"
          description="Closing the main window hides Vesper to the system tray so background playback and hardware media keys stay active."
        >
          <Toggle
            checked={settings.closeToTray}
            onChange={(v) => setSettings({ closeToTray: v })}
            label="Close to tray"
          />
        </Row>
      </Section>

      <Section
        index="02 / Library"
        title="Scanning & imports"
        caption="How folders and audio files are indexed when added."
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
        {runtime.isTauri ? (
          <Row
            label="Clean up unreferenced cached cover art"
            description="Removes unused cover thumbnails from %LOCALAPPDATA%\\Vesper\\artwork."
          >
            <button
              type="button"
              className="btn btn-ghost py-1.5 text-[11.5px]"
              onClick={() => {
                void native.pruneArtwork().then((n) => {
                  toast("success", "Artwork cache cleaned", `${n} unused thumbnail(s) removed.`);
                });
              }}
            >
              Clean cache
            </button>
          </Row>
        ) : (
          <Row
            label="Generate real playable WAV test tracks"
            description="Synthesizes real stereo PCM audio + synced .lrc lyrics in browser memory if you don't have local audio files handy right now."
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
        index="03 / Widget"
        title="Floating desktop widget"
        caption="Smoked-glass mini-player shared with the main playback engine."
      >
        <Row label="Show floating desktop widget" description="Hiding it never interrupts playback.">
          <Toggle
            checked={widget.visible}
            onChange={(v) => setWidget({ visible: v })}
            label="Show widget"
          />
        </Row>
        <Row label="Always on top" description="Pin the mini-player above other Windows applications.">
          <Toggle
            checked={widget.alwaysOnTop}
            onChange={(v) => setWidget({ alwaysOnTop: v })}
            label="Always on top"
          />
        </Row>
        <Row label="Widget size">
          <div className="flex overflow-hidden rounded-[6px] border-[1.5px] border-[var(--tile-outline)]">
            {(["compact", "expanded"] as const).map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setWidget({ size })}
                className={`plate px-3.5 py-2 transition-colors ${
                  widget.size === size ? "bg-ink text-paper" : "bg-paper-2 text-ink-2 hover:text-ink"
                }`}
              >
                {size}
              </button>
            ))}
          </div>
        </Row>
        <Row label={`Glass opacity — ${Math.round(widget.opacity * 100)}%`}>
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
      </Section>

      <Section
        index="04 / Session"
        title="Playback summary"
        caption="Live engine status shared across main window, tray, SMTC & widget."
      >
        <Row label="Shuffle">
          <Toggle
            checked={playback.shuffle}
            onChange={(value) => setShuffle(value)}
            label="Shuffle"
          />
        </Row>
        <Row label="Storage backend">
          <span className="plate rounded-[4px] border border-rule bg-paper-2 px-2.5 py-1.5 text-ink-2">
            {runtime.isTauri ? "SQLite · %LOCALAPPDATA%\\Vesper\\library.db" : "WebAudio + localStorage"}
          </span>
        </Row>
      </Section>
    </div>
  );
}
