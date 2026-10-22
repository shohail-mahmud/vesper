# Vesper

A minimalist, native Windows local music player built with **Tauri 2**, **Rust (`rodio` + `symphonia` + `rusqlite` + `lofty` + `souvlaki`)**, **React 19**, **TypeScript**, and **Tailwind CSS 4**.

---

## Highlights

- **Minimalist Square-Tile Home Library**
  - Single solid background surface (light & dark solid themes) with sharp dark-outlined tiles and zero mock filler data.
  - **`[+] Import Music` Tile (Always First)**: One-click menu with **Import Folder** (creates a persistent folder playlist tile) and **Import Track** (imports individual audio files directly into the Home library without scanning their parent directory).
  - **Folder Playlist Tiles**: Horizontal wrapping grid of square folder tiles supporting individual track playback, **Play All**, **Shuffle**, display-name editing, subfolder toggle, folder refresh, **Show in Windows Explorer**, and non-destructive removal from the library.
  - **Individual Track Tiles & List View**: Visually distinct tiles on Home for loose tracks that start playback immediately when clicked.
- **Native Multi-Threaded Rust Audio Engine (`src-tauri/src/playback.rs` & `eq.rs`)**
  - Dedicated OS audio thread with `rodio 0.20` + `symphonia-all` decoding **MP3, FLAC, WAV, M4A, AAC, OGG, Opus, AIFF**.
  - **Real-Time 10-Band Biquad Equalizer (`32 Hz – 16 kHz`)** + Preamp (`-12 dB` to `+12 dB`) + 9 presets (`Flat`, `Bass Boost`, `Treble Boost`, `Acoustic`, `Classical`, `Electronic`, `Rock`, `Vocal`, `Late Night`) + variable playback speed (`0.5×` – `2.0×`).
  - Sample-accurate track elapsed position accounting across pauses, seeks, and speed changes.
- **Synced `.lrc` & Embedded Lyrics (`src-tauri/src/commands.rs` & `src/lib/lyrics.ts`)**
  - Automatically discovers sidecar `.lrc` files beside audio tracks or reads embedded `USLT` / Vorbis `LYRICS` tags, with click-to-seek lines.
- **Full Windows OS Integration**
  - **System Tray (`tray-icon`)**: Minimize-to-tray background playback + tray menu (*Open Vesper*, *Play / Pause*, *Next Track*, *Previous Track*, *Toggle Mini-Widget*, *Quit Vesper*).
  - **Hardware Media Keys & Windows Flyout (`SMTC` via `souvlaki`)**: Play/Pause/Next/Prev hardware keys, Bluetooth headset controls, and Windows 10/11 volume flyout metadata & cover art.
  - **Floating Smoked-Glass Desktop Mini-Widget**: Dedicated transparent OS window (`?window=widget`) synced with the main engine, compact & expanded layouts, pin-on-top, opacity slider, and one-click *Open Library* button.
  - **Native Drag & Drop + File Associations**: Drop folders or audio files directly onto the window, or double-click audio files in Windows Explorer (`Open with Vesper`).
- **Automated Windows Installer Pipeline (`.github/workflows/windows-build.yml`)**
  - Builds `vesper.exe`, Windows `.msi`, and NSIS `-setup.exe` installers automatically on GitHub Actions (`windows-latest`), uploading build artifacts on every push and publishing GitHub Releases on `v*` tags.

---

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Space` | Play / Pause |
| `Left` / `Right` | Seek `-5s` / `+5s` |
| `Shift + Left` / `Shift + Right` | Previous / Next track |
| `Ctrl + F` | Focus instant library search |
| `S` | Toggle Shuffle |
| `R` | Cycle Repeat (`off` → `all` → `one`) |
| `M` | Mute / Unmute |
| `Q` | Toggle Up Next Queue drawer |
| `L` | Toggle Synced Lyrics drawer |
| `E` | Toggle 10-Band Equalizer & Speed drawer |
| `W` | Toggle Floating Desktop Mini-Widget |

---

## Building Locally on Windows

### Prerequisites
1. **Node.js 20+**
2. **Rust stable** (`x86_64-pc-windows-msvc` via [rustup.rs](https://rustup.rs))
3. **Visual Studio C++ Build Tools** (*Desktop development with C++* workload)

### Commands

```powershell
# Install frontend dependencies
npm install

# Run TypeScript check + unit test suite
npm run typecheck
npm test

# Run Rust backend unit tests
cargo test --manifest-path src-tauri/Cargo.toml

# Launch native Windows app in dev mode (with hot reload)
npm run tauri:dev

# Produce production Windows installers (.msi + NSIS -setup.exe)
npm run tauri:build
```

Built installers are written to:
- `src-tauri/target/release/vesper.exe`
- `src-tauri/target/release/bundle/msi/*.msi`
- `src-tauri/target/release/bundle/nsis/*-setup.exe`
