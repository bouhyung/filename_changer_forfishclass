# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app does

A Tauri desktop app for bulk-renaming fish survey photos. Users browse media files one-by-one, enter fish name / dive point / photographer / date, and the app renames files to a structured format:

```
{originalBase}_{fishName}_{pointPrefix+pointName[N]}_{photographer}_{shootDate}.{ext}
```

Example: `IMG_1234_돌돔_남애북바위N_홍길동_20240815.jpg`

The suffix `J` = juvenile, `(name)` = uncertain ID, `N` appended to point name = night dive.

## Development

```bash
# Run in dev mode
cargo tauri dev

# Build for current platform → dist/
npm run build

# Build Mac + Windows → dist/ (recommended for releases)
npm run build:release
```

## Version management

**Single source of truth**: `build/version.json`

`package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` are auto-synced from it. Never edit versions in those files directly.

```bash
npm run sync-version           # sync current version
npm run sync-version -- 1.0.2  # update + sync
```

## Releasing

```bash
npm run release            # uses version from build/version.json
npm run release -- 1.0.2   # updates version, builds, creates GitHub Release
```

Requires `gh` CLI authenticated (`gh auth login`).

## Architecture

**Frontend** (`src/`): Vanilla HTML/JS/CSS, no build step or bundler. Served directly as `frontendDist` by Tauri.

**Backend** (`src-tauri/src/lib.rs`): All Rust Tauri commands. No `main.rs` logic — `main.rs` just calls `lib.rs::run()`.

**IPC**: Frontend calls Rust via `window.__TAURI__.core.invoke('command_name', { args })`. Commands defined in `lib.rs` and registered in `run()`.

### Tauri commands (lib.rs)

| Command | Purpose |
|---------|---------|
| `read_files` | List media files in a folder (sorted) |
| `rename_file` | Rename a file in the same folder |
| `move_to_skip` | Move file to `Skip/` subfolder |
| `load_defaults` / `save_defaults` | Persist form defaults to `app_config_dir/defaults.json` |
| `open_help` | Open `help.html` in a new WebviewWindow |
| `suggest_species` | Few-shot fish species suggestion via local Ollama (Gemma 3 vision). Sends N=4 random sample images per species (from bundled `resources/reference_images/<species>/`) plus the query image. Returns top-3 candidates with confidences. |

### Frontend state (renderer.js)

- `imageFiles[]` — sorted list of filenames in current folder
- `currentIndex` — index into imageFiles
- `fishInputCache` — per-filename fish name/checkbox cache
- `parsedCache` — per-filename parsed filename structure

`parseExistingFilename()` reverse-parses the structured filename format to pre-fill form fields when revisiting already-renamed files.

### Supported file types

- Browser images: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`
- RAW (shows SVG placeholder, still renameable): `.heic`, `.heif`, `.orf`, `.cr2`, `.cr3`, `.arw`, `.nef`, `.dng`, `.rw2`, `.raf`, `.pef`, etc.
- Video: `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`, `.m4v`

## Key workflows

- **Enter** key triggers rename + advance to next file
- **Arrow keys** navigate between files (triggers rename of current if ready)
- Skipped files go to `Skip/` subdirectory inside the selected folder
- Point prefix (e.g. "남애") + point name are stored separately; combined on rename
- Prefixes: the autocomplete datalist is driven only by user input history (`history.prefixes`). `parseExistingFilename`'s prefix recognition uses `history.prefixes` ∪ `SEED_PREFIXES` (a small built-in list: `남애`, `북애`, `동애`, `서애`, `속초`, `고성`) so that fresh-install users can still parse already-renamed files.
