import { useEffect, useRef, useState } from "react";
import {
  dismissToast,
  handleBrowserDrop,
  setSearchQuery,
  setSettings,
  setView,
  setWidget,
  toast,
  useApp,
} from "../state/store";
import { runtime } from "../state/bridge";
import { HomeScreen } from "./HomeScreen";
import { PlaylistScreen } from "./PlaylistScreen";
import {
  AllTracksScreen,
  AlbumsScreen,
  ArtistsScreen,
  InspectorDrawer,
  UserPlaylistScreen,
} from "./LibraryViews";
import { SettingsScreen } from "./SettingsScreen";
import { PlayerBar } from "./PlayerBar";
import { Widget } from "./Widget";
import * as I from "./Icons";

function TopBar({ searchInputRef }: { searchInputRef: React.RefObject<HTMLInputElement | null> }) {
  const state = useApp();
  const { view, searchQuery, settings, library } = state;

  const nativeWindow = () => (window as any).__TAURI__?.window?.getCurrentWindow?.();

  const windowAction = (kind: "minimize" | "maximize" | "close") => {
    const win = nativeWindow();
    if (win) {
      if (kind === "minimize") void win.minimize?.();
      if (kind === "maximize") void win.toggleMaximize?.();
      if (kind === "close") void win.close?.();
      return;
    }
    toast(
      "info",
      "Native window control",
      "In the Windows app this controls the native window frame. Closing the window always quits Vesper — there is no tray icon.",
    );
  };

  const navItems = [
    { key: "home", label: "Home", active: view.name === "home" || view.name === "playlist", go: () => setView({ name: "home" }) },
    { key: "tracks", label: "Tracks", active: view.name === "tracks", go: () => setView({ name: "tracks" }) },
    { key: "albums", label: "Albums", active: view.name === "albums", go: () => setView({ name: "albums" }) },
    { key: "artists", label: "Artists", active: view.name === "artists", go: () => setView({ name: "artists" }) },
    { key: "favorites", label: "Favorites", active: view.name === "favorites", go: () => setView({ name: "favorites" }) },
  ];

  return (
    <header
      className="relative z-20 flex h-12 shrink-0 select-none items-center justify-between gap-4 border-b border-rule-soft pl-4 backdrop-blur-md"
      style={{ background: "var(--topbar-bg)" }}
      data-tauri-drag-region
    >
      {/* Brand + Minimal Navigation */}
      <div className="flex min-w-0 items-center gap-5" data-tauri-drag-region>
        <button
          type="button"
          onClick={() => setView({ name: "home" })}
          className="flex cursor-pointer items-center gap-2 text-ink"
        >
          <I.Mark size={19} className="text-accent-ink" />
          <span className="font-display text-[14.5px] tracking-tight">Vesper</span>
        </button>

        <nav aria-label="Primary" className="hidden items-center gap-1 sm:flex">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={item.go}
              aria-current={item.active ? "page" : undefined}
              className={`cursor-pointer rounded-[5px] px-2.5 py-1 text-[12.5px] font-medium transition-colors ${
                item.active
                  ? "bg-accent text-accent-on"
                  : "text-ink-2 hover:bg-[var(--surface-hover)] hover:text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
          {library.playlists.map((pl) => {
            const active = view.name === "userPlaylist" && view.id === pl.id;
            return (
              <button
                key={pl.id}
                type="button"
                onClick={() => setView({ name: "userPlaylist", id: pl.id })}
                className={`max-w-[120px] truncate-1 cursor-pointer rounded-[5px] px-2.5 py-1 text-[12px] font-medium transition-colors ${
                  active
                    ? "bg-accent text-accent-on"
                    : "text-ink-3 hover:bg-[var(--surface-hover)] hover:text-ink"
                }`}
              >
                {pl.name}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Instant Search + Theme + Settings + Native Window Buttons */}
      <div className="flex h-full items-center gap-1.5">
        <div className="relative flex items-center">
          <I.Search size={14} className="pointer-events-none absolute left-2.5 text-ink-3" />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search library…"
            aria-label="Search library"
            className="w-40 rounded-[5px] border border-rule bg-paper py-1 pr-6 pl-8 text-[12px] text-ink outline-none transition-all focus:w-56 focus:border-[var(--tile-outline)]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="absolute right-1.5 text-ink-3 hover:text-ink"
            >
              <I.X size={12} />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setSettings({ theme: settings.theme === "dark" ? "light" : "dark" })}
          title={settings.theme === "dark" ? "Switch to solid light theme" : "Switch to solid dark theme"}
          aria-label="Toggle theme"
          className="icon-btn h-8 w-8"
        >
          {settings.theme === "dark" ? <I.Sun size={15} /> : <I.Moon size={15} />}
        </button>

        <button
          type="button"
          onClick={() => setView(view.name === "settings" ? { name: "home" } : { name: "settings" })}
          title="Settings"
          aria-label="Settings"
          className={`icon-btn h-8 w-8 ${view.name === "settings" ? "!bg-accent !text-accent-on" : ""}`}
        >
          <I.Settings size={15} />
        </button>

        <div className="ml-1 flex h-full items-stretch border-l border-rule">
          {[
            { icon: <I.Minus size={13} />, label: "Minimize", kind: "minimize" as const },
            { icon: <I.Square size={11} />, label: "Maximize", kind: "maximize" as const },
            { icon: <I.X size={13} />, label: "Close", kind: "close" as const },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              aria-label={item.label}
              title={item.label}
              onClick={() => windowAction(item.kind)}
              className={`flex w-11 items-center justify-center text-ink-2 transition-colors duration-100 hover:bg-[var(--surface-hover)] hover:text-ink ${
                item.kind === "close" ? "hover:!bg-[#C4443A] hover:!text-white" : ""
              }`}
            >
              {item.icon}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

function BusyStrip() {
  const { busy } = useApp();
  if (!busy) return null;
  const pct = busy.total ? Math.round((busy.processed / busy.total) * 100) : 35;
  return (
    <div className="sticky top-0 z-30 border-b border-rule bg-paper-2 px-8 py-2">
      <div className="flex items-center gap-3">
        <span className="plate text-ink-2">{busy.label}</span>
        <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-rule">
          <div
            className="h-full rounded-full bg-ink transition-[width] duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="tnum text-[10px] text-ink-3">
          {busy.total ? `${busy.processed} / ${busy.total}` : "…"}
        </span>
      </div>
    </div>
  );
}

function Toasts() {
  const { toasts } = useApp();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-50 flex w-[min(400px,88vw)] -translate-x-1/2 flex-col gap-2">
      {toasts.map((item) => (
        <div
          key={item.id}
          role="status"
          className="rise pointer-events-auto flex items-start gap-3 rounded-[6px] border-[1.5px] border-[var(--tile-outline)] bg-paper-2 px-4 py-2.5 text-ink"
        >
          <span className={`mt-[2px] ${item.tone === "error" ? "text-[#B4453A]" : "text-ink"}`}>
            {item.tone === "error" ? <I.Warning size={14} /> : <I.Check size={14} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium">{item.title}</div>
            {item.detail && (
              <div className="mt-0.5 text-[11px] leading-relaxed text-ink-2">{item.detail}</div>
            )}
          </div>
          <button
            type="button"
            className="icon-btn h-6 w-6"
            onClick={() => dismissToast(item.id)}
            aria-label="Dismiss notification"
          >
            <I.X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Desktop({
  searchInputRef,
}: {
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const state = useApp();
  const [draggingOver, setDraggingOver] = useState(false);
  const dragDepth = useRef(0);

  // Sync solid theme token onto document root
  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme;
  }, [state.settings.theme]);

  // Default widget coordinates for browser preview floating mode (clean bottom-right corner)
  useEffect(() => {
    if (!runtime.isTauri && state.widget.x === 0 && state.widget.y === 0) {
      const width = state.widget.size === "compact" ? 360 : 418;
      const height = state.widget.size === "compact" ? 96 : 112;
      setWidget({
        x: Math.max(24, window.innerWidth - width - 28),
        y: Math.max(72, window.innerHeight - height - 104),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden bg-paper text-ink"
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current += 1;
        setDraggingOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDraggingOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDraggingOver(false);
        if (e.dataTransfer) void handleBrowserDrop(e.dataTransfer);
      }}
    >
      <TopBar searchInputRef={searchInputRef} />

      <div className="flex min-h-0 flex-1">
        <main className="scroll-area relative min-w-0 flex-1 overflow-y-auto bg-paper">
          <BusyStrip />
          {state.view.name === "home" && <HomeScreen />}
          {state.view.name === "playlist" && <PlaylistScreen folderId={state.view.id} />}
          {state.view.name === "userPlaylist" && (
            <UserPlaylistScreen playlistId={state.view.id} />
          )}
          {state.view.name === "tracks" && <AllTracksScreen />}
          {state.view.name === "favorites" && <AllTracksScreen favoritesOnly />}
          {state.view.name === "albums" && <AlbumsScreen />}
          {state.view.name === "artists" && <ArtistsScreen />}
          {state.view.name === "settings" && <SettingsScreen />}
        </main>

        <InspectorDrawer />
      </div>

      <PlayerBar />

      {/* In browser preview, render the floating mini-widget directly; in native Tauri, the real 2nd OS window owns it */}
      {!runtime.isTauri && state.widget.visible && (
        <div
          className="fixed z-40 cursor-grab active:cursor-grabbing"
          style={
            state.widget.x > 0 || state.widget.y > 0
              ? { left: state.widget.x, top: state.widget.y }
              : { right: 24, bottom: 100 }
          }
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("button,[role='slider']")) return;
            const startX = e.clientX;
            const startY = e.clientY;
            const originX = state.widget.x;
            const originY = state.widget.y;
            const move = (ev: PointerEvent) => {
              setWidget({
                x: Math.max(8, originX + (ev.clientX - startX)),
                y: Math.max(8, originY + (ev.clientY - startY)),
              });
            };
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
        >
          <Widget
            mode="desktop"
            onToggleSize={() =>
              setWidget({ size: state.widget.size === "compact" ? "expanded" : "compact" })
            }
          />
        </div>
      )}

      {draggingOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-paper/90">
          <div className="flex flex-col items-center gap-3 rounded-[8px] border-2 border-dashed border-[var(--tile-outline)] bg-paper-2 px-10 py-8 text-center">
            <I.Folder size={34} />
            <div className="text-[15px] font-semibold text-ink">Drop folders or audio files to import</div>
            <div className="text-[12px] text-ink-2">
              Folders become square tiles · Single audio files appear right on Home
            </div>
          </div>
        </div>
      )}

      <Toasts />
    </div>
  );
}
