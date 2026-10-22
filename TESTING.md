# Testing Vesper

Two layers: automated tests for everything that can be verified without audio hardware, and a
manual checklist for the Windows-specific behaviour that cannot.

---

## 1. Automated tests

```bash
node scripts/test.mjs        # compiles with tsc, runs node --test
npx tsc --noEmit             # type check of the whole frontend
```

`scripts/test.mjs` uses the project's own TypeScript compiler and Node's built-in test runner, so
the suite runs identically in CI and offline. The GitHub Actions workflow runs both commands and
**fails the job when either fails**.

| Suite | Verifies |
| --- | --- |
| `tests/shuffle.test.ts` | Shuffle is a true permutation (every track exactly once); no immediate repeats across 200 cycles; the current track stays first when shuffle is toggled mid-playback; turning shuffle off restores the intended playlist order; `nextIndex` advances / wraps under repeat-all / stops under repeat-off / loops under repeat-one; `previousIndex` restarts the track after 3 s. |
| `tests/library.test.ts` | Path normalisation (case + separators + `..`); the same file re-imported resolves to the same track key; different files get different keys; file-name fallbacks for title and artist; extension whitelist; folder-picker path parsing; **top-level scan ignores nested directories while a recursive scan includes them**; re-importing the same folder adds nothing; a moved/renamed file is not added twice; **a removal plan contains only library identifiers and never a file path**; timecodes and progress maths. |

Run them once and the output should end with `# fail 0`.

---

## 2. Manual testing checklist (Windows)

Prerequisites: `npm ci`, then `npx tauri dev`. Have a folder with at least one album (10+ files,
mixed formats), a nested sub-folder, and a file with **no** ID3 tags.

### Library & import

| # | Step | Expected |
| --- | --- | --- |
| 1 | **Import Folder** → pick the album folder | A folder playlist named after the folder appears on the home screen with the correct track count. Console shows no unhandled errors. |
| 2 | Open that folder card | The playlist screen lists track titles, artists, durations and the folder path; **Play All** and **Shuffle** are present. |
| 3 | Click a track | Audio starts from that track and the remaining tracks form the queue in playlist order. The player bar and the widget show the same title and artwork. |
| 4 | **Play All** / **Shuffle** | Play All starts at track 1 in order. Shuffle starts at a random track and never repeats one inside the cycle. Turning shuffle off restores the folder order. |
| 5 | **Import Track** → select 2 files from a folder that is *not* in the library | Only those 2 tracks appear under *Individual tracks*. The parent folder is **not** added as a playlist. |
| 6 | Import the same folder again | “Nothing new” / duplicates skipped — the library shows no doubled entries. |
| 7 | Rename a playlist | Only the display name changes; `explorer` shows the physical folder name untouched. |
| 8 | Remove a folder, then check the disk | The playlist disappears from Vesper; every audio file is still in its original location. |
| 9 | Restart the app | Folders, individual tracks, names, volume, repeat/shuffle, widget settings and the last track/position are all restored. |

### Playback & widget

| # | Step | Expected |
| --- | --- | --- |
| 10 | Play a track, then hide the widget | Music continues. Reopen it from the player bar — it shows the current track and progress. |
| 11 | Control playback from the widget (play/pause/prev/next/seek/volume/shuffle/repeat) | Every control acts on the shared engine; the player bar updates instantly and vice versa. |
| 12 | Seek from the widget | The real playback position jumps; the timecodes and progress bar match the audio. |
| 13 | Start a track in the library window while the widget is visible | The widget switches to the new track with a cross-faded artwork change. |
| 14 | Drag the widget, resize it from the corner, enable **Always on top**, set opacity to 60 % | Position, size, pin state and opacity are applied immediately and survive a restart. |
| 15 | Close the library window while music plays and the widget is visible | The window hides; **playback keeps running**. Reopen from the taskbar/tray behaviour of the OS. |
| 16 | Hide the widget, then quit the app | Shutdown is clean; no orphan process keeps the audio device locked. |

### Robustness

| # | Step | Expected |
| --- | --- | --- |
| 17 | Rename or move a file on disk, then **Refresh folder contents** | The entry is re-resolved or flagged *file missing*; the playlist is not deleted. |
| 18 | Disconnect the drive holding a playlist, then open it | A recovery banner appears (“This folder is currently unavailable”) with a *Try again* action; the playlist entry survives. |
| 19 | Reconnect the drive and press *Try again* | The playlist becomes available again with its tracks. |
| 20 | Try to play a truncated/unsupported file (e.g. rename a `.txt` to `.mp3`) | An error toast names the file and playback moves on to the next track instead of stalling. |
| 21 | Import a folder with 1 000+ files | The progress strip advances, the UI stays scrollable and responsive, and memory stays reasonable (artwork is thumbnailed). |
| 22 | Type in the playlist rename field and press Space / arrow keys | No playback shortcut fires while typing. |
| 23 | Press `Space`, `←`, `→`, `Shift+←`, `Shift+→`, `S`, `R`, `W`, `M` outside a text field | Play/pause, seek ±5 s, previous/next, shuffle, repeat, widget toggle, mute. |

### Build

| # | Step | Expected |
| --- | --- | --- |
| 24 | Push a branch and open the *Windows build* workflow | Every step is green **or** the failing step fails the job. |
| 25 | Download the artifact `vesper-windows-<sha>` | It contains `vesper.msi`, the NSIS `*-setup.exe` and `vesper.exe`. |
| 26 | Install the MSI | Installs per-user without elevation, launches, keeps the library from previous runs. SmartScreen warns because the build is **unsigned** — that is expected. |

---

## 3. How the automation maps to the 13 required behaviours

| Required behaviour | Where it is verified |
| --- | --- |
| 1. Importing a folder creates a playlist | manual #1 · `tests/library.test.ts` (scan policy, de-duplication) |
| 2. Opening a playlist displays its tracks | manual #2 |
| 3. Clicking a track starts audio | manual #3 |
| 4. Play All and Shuffle are correct | manual #4 · `tests/shuffle.test.ts` |
| 5. Importing one track does not import the folder | manual #5 · `tests/library.test.ts` (`selectImportableFiles`) |
| 6. Library entries persist across restarts | manual #9 · `src-tauri/src/db.rs` snapshot round-trip |
| 7. Widget and main window share playback state | manual #11, #13 |
| 8. Play/pause/prev/next/seek/volume work from both windows | manual #11, #12 |
| 9. Hiding/closing the main window does not stop playback | manual #15 · `src-tauri/src/lib.rs` (`CloseRequested` → hide) |
| 10. Removing entries never deletes files | manual #8 · `tests/library.test.ts` (`removalPlan`) |
| 11. Missing folders/files produce recoverable errors | manual #17–#20 |
| 12. Widget position and settings persist | manual #14 · `src-tauri/src/db.rs` widget row |
| 13. The Windows build workflow produces the artifact | manual #24, #25 · workflow “Verify build output” step |
