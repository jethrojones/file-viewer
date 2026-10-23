# File Viewer (view CSV, JSONL, JSON, VTT, Log, SRT, and more)

File Viewer lets you open common data, transcript, and text-based files directly in Obsidian with purpose-built views instead of raw plain text.

Use it to view and edit `.csv` files as formatted tables, edit `.json` files with validation and spacing controls, read `.jsonl` files as pretty-printed records filtered by a jq expression, inspect `.log` files with filters and highlighting, and read `.vtt` or `.srt` transcript files as searchable timestamped cues.

## Features

- **CSV Parsing** — RFC-compliant parser handling quoted fields, escaped quotes, and mixed line endings
- **Interactive Tables** — Click column headers to sort ascending/descending with smart numeric detection
- **Inline Editing** — Toggle edit mode to modify cells directly in the table. Changes auto-save on blur. Tab/Shift+Tab to navigate between cells, Escape to deselect.
- **CSV Search & Filter** — Real-time search across all columns with match highlighting
- **JSONL Viewer** — Open `.jsonl` files as pretty-printed records with source line numbers and a jq filter bar (runs real jq 1.8 compiled to WebAssembly)
- **JSON Editing** — Edit `.json` files in a monospace editor with live validation, friendly error locations, pretty formatting, and minifying
- **Log Viewer** — Open `.log` and `.txt` files with line numbers, log level coloring, timestamp highlighting, level filters, search, and auto-scroll
- **Transcript Viewer** — Open `.vtt` and `.srt` files as readable cue lists with timestamps, multiline captions, and search highlighting
- **Theme Support** — Uses Obsidian's CSS variables so tables match your light or dark theme
- **Responsive Layout** — Sticky headers, horizontal scrolling, and text-overflow handling for wide data
- **Row & Column Counts** — Toolbar shows dataset dimensions and filtered result counts

## Installation

### From Community Plugins (recommended)

1. Open **Settings → Community Plugins → Browse**
2. Search for **File Viewer**
3. Click **Install**, then **Enable**

### Obsidian CLI

```bash
obsidian plugin:install id=csv-viewer enable
```

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/jethrojones/file-viewer/releases/latest)
2. Create a folder called `csv-viewer` in your vault's `.obsidian/plugins/` directory
3. Copy all three files into that folder
4. Reload Obsidian and enable the plugin in **Settings → Community Plugins**

## Usage

Once enabled, open any `.csv` file in your vault and it will render as a table automatically.

- **Sort** — Click any column header. Click again to reverse the sort direction.
- **Search** — Type in the search box to filter rows. Matching cells are highlighted.
- **Edit** — Click the Edit button in the toolbar to toggle edit mode. Click any cell to modify its contents. Changes save automatically when you click away. Sorting is disabled while editing.

Open any `.log` or `.txt` file in your vault to inspect it in the log viewer.

- **Search** — Type in the filter box to show matching log lines.
- **Level filters** — Toggle Errors, Warnings, Info, and Debug to narrow the view.
- **Auto-scroll** — Keep the viewer pinned to the latest matching line when reading growing logs.

Open any `.vtt` or `.srt` file in your vault to read it in the transcript viewer.

- **Search** — Type in the filter box to show matching transcript cues.
- **Cue timing** — Each cue shows its number and start/end timestamp.
- **Multiline captions** — Wrapped captions preserve line breaks from the transcript file.

Open any `.jsonl` or `.ndjson` file in your vault to read it in the JSONL viewer.

- **jq filter** — Type any jq expression in the top bar. Each line is fed to jq separately, so `.level` or `select(.status == "error") | .msg` behaves exactly like `jq -c` on the file.
- **Pretty output** — Every jq result is pretty-printed with the line number it came from. Filtered-out lines disappear.
- **Errors** — Invalid JSON lines are flagged individually; jq errors show in the toolbar.

Open any `.json` file in your vault to edit it in the JSON viewer.

- **Validate** — Check whether the current JSON is valid and see friendly line/column errors.
- **Format** — Pretty-print the document with 2-space or 4-space indentation.
- **Minify** — Collapse valid JSON to a compact single-line representation.

## Options

In the plugin options, you can enable or disable CSV, JSON, JSONL, log, VTT transcript, and SRT transcript viewing separately.
Each viewer also has an **Additional extensions** field: type your own extensions (comma-separated, e.g. `jsonl, ndjson`)
and files with those extensions open in that viewer. Reload the plugin after changing any file type option.

## Privacy

File Viewer works entirely inside your vault. It does not make network requests, collect telemetry, show ads, require an account, or read files outside the CSV, JSON, log, or transcript file opened in Obsidian.

## Development

```bash
git clone https://github.com/jethrojones/file-viewer.git
cd file-viewer
npm install
npm run dev    # Watch mode with sourcemaps
npm run build  # Production build
```

## License

[MIT](LICENSE) — Copyright (c) 2026 Jethro Jones
