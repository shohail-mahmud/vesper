import { useState } from "react";
import {
  playFromList,
  refreshFolder,
  removeFolder,
  removeTrack,
  renameFolder,
  revealInExplorer,
  selectors,
  setView,
  toggleRecursive,
  useApp,
} from "../state/store";
import { runtime } from "../state/bridge";
import { formatCount, formatDate, formatDurationTotal } from "../lib/format";
import { TrackTable } from "./TrackTable";
import * as I from "./Icons";

export function PlaylistScreen({ folderId }: { folderId: string }) {
  const state = useApp();
  const folder = selectors.folderById(folderId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(folder?.name ?? "");
  const [menuOpen, setMenuOpen] = useState(false);

  if (!folder) {
    return (
      <div className="fade px-10 py-20 text-center">
        <h2 className="text-[20px] font-medium text-ink">This folder is no longer in your library</h2>
        <button className="btn btn-ghost mt-5" onClick={() => setView({ name: "home" })}>
          <I.ArrowLeft size={14} /> Back to Home
        </button>
      </div>
    );
  }

  const allTracks = selectors.folderTracks(folder);
  const q = state.searchQuery.trim().toLowerCase();
  const tracks = q
    ? allTracks.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.artist ?? "").toLowerCase().includes(q) ||
          (t.album ?? "").toLowerCase().includes(q),
      )
    : allTracks;

  const duration = allTracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  const missing = allTracks.filter((t) => t.missing).length;

  const commitRename = () => {
    if (draft.trim()) renameFolder(folder.id, draft);
    else setDraft(folder.name);
    setEditing(false);
  };

  return (
    <div className="fade px-8 py-9 sm:px-11">
      <button
        type="button"
        className="plate flex cursor-pointer items-center gap-2 text-ink-3 transition-colors hover:text-ink"
        onClick={() => setView({ name: "home" })}
      >
        <I.ArrowLeft size={13} /> Home
      </button>

      <header className="mt-5 flex flex-wrap items-end justify-between gap-6 border-b border-rule pb-6">
        <div className="flex min-w-0 items-start gap-5">
          <div className="tile-square !h-20 !w-20 shrink-0">
            <I.Folder size={30} />
          </div>

          <div className="min-w-0">
            <div className="plate mb-1.5 flex items-center gap-2.5 text-ink-3">
              <span>Folder playlist</span>
              <span>·</span>
              <span>{folder.recursive ? "Recursive scan" : "Top-level scan"}</span>
            </div>

            {editing ? (
              <input
                autoFocus
                className="w-full max-w-[460px] border-b border-[var(--tile-outline)] bg-transparent text-[24px] font-semibold tracking-tight text-ink outline-none"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") {
                    setDraft(folder.name);
                    setEditing(false);
                  }
                }}
                aria-label="Playlist display name"
              />
            ) : (
              <h1
                className="cursor-text text-[24px] font-semibold tracking-tight text-ink"
                onClick={() => {
                  setDraft(folder.name);
                  setEditing(true);
                }}
                title="Click to edit display name (physical folder on disk is never modified)"
              >
                {folder.name}
              </h1>
            )}

            <div className="tnum mt-1 truncate-1 text-[11px] text-ink-3">{folder.path}</div>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-2">
              <span>{formatCount(allTracks.length, "track")}</span>
              <span>·</span>
              <span>{formatDurationTotal(duration)}</span>
              <span>·</span>
              <span>Added {formatDate(folder.addedAt)}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={tracks.length === 0}
            onClick={() => void playFromList(tracks, 0, false)}
          >
            <I.Play size={14} /> Play All
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={tracks.length === 0}
            onClick={() => void playFromList(tracks, 0, true)}
          >
            <I.Shuffle size={14} /> Shuffle
          </button>

          <div className="relative">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <I.More size={14} /> Manage
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="rise absolute right-0 z-30 mt-1.5 w-60 overflow-hidden rounded-[6px] border-[1.5px] border-[var(--tile-outline)] bg-paper-2 shadow-[0_14px_34px_rgba(0,0,0,0.16)]"
                onMouseLeave={() => setMenuOpen(false)}
              >
                {[
                  {
                    icon: <I.Refresh size={14} />,
                    label: "Refresh folder contents",
                    action: () => void refreshFolder(folder.id),
                  },
                  {
                    icon: <I.Folder size={14} />,
                    label: folder.recursive ? "Scan nested folders: On" : "Scan nested folders: Off",
                    action: () => void toggleRecursive(folder.id),
                  },
                  ...(runtime.isTauri
                    ? [
                        {
                          icon: <I.ExternalLink size={14} />,
                          label: "Show in Windows Explorer",
                          action: () => void revealInExplorer(folder.path),
                        },
                      ]
                    : []),
                  {
                    icon: <I.Sparkle size={14} />,
                    label: "Rename display title",
                    action: () => {
                      setDraft(folder.name);
                      setEditing(true);
                    },
                  },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[12px] text-ink transition-colors hover:bg-[var(--surface-hover)]"
                    onClick={() => {
                      item.action();
                      setMenuOpen(false);
                    }}
                  >
                    <span className="text-ink-2">{item.icon}</span>
                    {item.label}
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-3 border-t border-rule px-4 py-2.5 text-left text-[12px] text-[#B4453A] transition-colors hover:bg-[#B4453A]/10"
                  onClick={() => {
                    removeFolder(folder.id);
                    setMenuOpen(false);
                  }}
                >
                  <I.Trash size={14} /> Remove from library
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {(folder.missing || missing > 0) && (
        <div className="mt-6 flex items-start gap-3 rounded-[6px] border border-[#B4453A]/40 bg-[#B4453A]/8 px-5 py-4">
          <span className="mt-[2px] text-[#B4453A]">
            <I.Warning size={16} />
          </span>
          <div>
            <h3 className="text-[12.5px] font-medium text-ink">
              {folder.missing
                ? "This folder is currently unavailable"
                : `${missing} track(s) could not be found on disk`}
            </h3>
            <p className="mt-1 max-w-[64ch] text-[11.5px] leading-relaxed text-ink-2">
              Your playlist entry is safely preserved. Reconnect the drive or restore the folder path,
              then click Refresh.
            </p>
            <button
              type="button"
              className="btn btn-ghost mt-3 py-1 px-3 text-[11.5px]"
              onClick={() => void refreshFolder(folder.id)}
            >
              <I.Refresh size={13} /> Try again
            </button>
          </div>
        </div>
      )}

      <section className="mt-7">
        <TrackTable
          tracks={tracks}
          currentId={state.playback.trackId}
          onPlay={(index) => void playFromList(tracks, index, state.playback.shuffle)}
          onRemove={(track) => removeTrack(track.id)}
          emptyState={
            <div className="py-10 text-center">
              <p className="text-[13px] text-ink-2">
                No audio files found in this folder{folder.recursive ? "" : " at the top level"}.
              </p>
              <button
                type="button"
                className="btn btn-ghost mt-4"
                onClick={() => void toggleRecursive(folder.id)}
              >
                <I.Folder size={13} />{" "}
                {folder.recursive ? "Scan top level only" : "Include nested subfolders"}
              </button>
            </div>
          }
        />
      </section>
    </div>
  );
}
