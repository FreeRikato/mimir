# Mimir

Extract rendered text from open browser tabs, grouped by domain. Mimir is a Chrome
Manifest V3 extension that turns a multi-tab research session into a single exportable
artefact (JSON, Markdown, plain text, CSV, or HTML).

The side panel is the product surface. The popup is a placeholder.

## Features

- **Tab selection** — pick the tabs you want from the current window, grouped by domain.
- **Bulk extraction shortcuts** — extract all tabs to the right of the active tab, the
  currently selected tabs, or Chrome's highlighted tabs.
- **Content-type aware extractors**
  - **HTML pages** — DOM read via `chrome.scripting.executeScript`.
  - **YouTube** — transcript pulled from a configured FastAPI subtitle backend, with
    format (`json` / `vtt` / `text`) and language settings.
  - **PDFs** — remote PDFs are POSTed to the backend; local `file://` PDFs are uploaded
    as a blob. Text layer first, OCR fallback for scanned documents.
  - **Reddit threads** — fetched via Reddit's `.json` endpoint, including nested
    comments.
  - **X / Twitter threads** — a MAIN-world content script patches `window.fetch` to
    capture `TweetDetail` GraphQL responses; the side panel reads the parsed JSON.
- **Export** — copy to clipboard or save to a file in any of `json`, `markdown`, `text`,
  `csv`, or `html`.
- **History** — every export is saved (metadata + the chosen payload) to IndexedDB.
  Search by keyword, date range, or domain. The list is virtualised with
  `react-virtuoso`.
- **Settings** — toggle "close tabs after extraction", and set default subtitle format
  and language.
- **Glass UI** — Tailwind 4 with a custom `glass-*` design token system.

## Install (development)

Mimir is built with `@crxjs/vite-plugin`, so the build output in `dist/` is a
loadable unpacked extension.

1. `npm install`
2. `npm run build` (or `npm run dev` for the HMR server)
3. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and
   point it at `dist/`.
4. Optional: configure the subtitle backend (see [Environment variables](#environment-variables)).
5. Reassign shortcuts at `chrome://extensions/shortcuts` if you want different bindings.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (use with the HMR extension workflow). |
| `npm run build` | `tsc -b && vite build` → `dist/`. |
| `npm run lint` | Biome lint. |
| `npm run format` | Biome format (write). |
| `npm run check` | Biome lint + format + import organisation. |

The pre-commit hook runs `biome check --staged`. CI (`.github/workflows/ci.yml`) runs
`biome ci .` followed by `npm run build` on Node 20.

## Environment variables

Vite bakes these in at build time. Configure them in `.env.local` (gitignored).

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_SUBTITLES_BASE_URL` | empty | Base URL of the FastAPI backend. The same service exposes the YouTube transcript endpoint and the `/extract/pdf` endpoint. If empty, both YouTube and remote-PDF extraction fail with a backend-unavailable toast. |
| `VITE_SUBTITLES_API_KEY` | empty | Sent as the `X-API-Key` header from the background service worker for both subtitle and PDF requests. |

Both are consumed by the **background service worker**, never the side panel. The SW
proxies the request to bypass CORS and to attach the API key. The PDF backend
(`/extract/pdf`) reuses the same base URL and API key as the subtitle backend.

## Keyboard shortcuts

Defined in `manifest.json` under `commands` and dispatched from
`src/background/index.ts` to the side panel via `chrome.runtime.sendMessage`.

| Command | macOS | Windows / Linux | Description |
| --- | --- | --- | --- |
| `_execute_action` | `Command+Shift+Y` | `Ctrl+Shift+Y` | Activate extension (opens the Mimir side panel). |
| `extract-to-right` | `Command+Shift+Right` | `Ctrl+Shift+Right` | Extract every tab to the right of the active tab. |
| `extract-selected` | `Command+Shift+Down` | `Ctrl+Shift+Down` | Extract the tabs you've ticked in the side panel. |
| `extract-highlighted` | `Command+Shift+Left` | `Ctrl+Shift+Left` | Extract Chrome's currently highlighted tabs. |

Reassign at `chrome://extensions/shortcuts`. Reserved OS / Chrome shortcuts take
precedence — if a binding does not fire, something else owns that combination.

## Project structure

```
.
├── manifest.json                MV3 manifest (commands, permissions, side panel)
├── vite.config.ts               crx + tailwind + react-compiler + PDF.js worker emit
├── biome.json                   Lint / format config (tabs, 120 col, double quotes)
├── tsconfig.app.json            strict, react-jsx, ES2022, chrome types
├── src/
│   ├── main.tsx                 Popup entry
│   ├── App.tsx                  Popup UI (placeholder)
│   ├── SidePanelApp.tsx         Main side-panel UI (the product surface)
│   ├── background/              Service worker (commands, fetch proxy)
│   ├── content/                 MAIN-world content scripts
│   │   ├── xTwitter.ts          TweetDetail fetch patcher
│   │   └── index.ts             Generic floating button (skips PDF pages)
│   ├── sidepanel/               Side-panel entry HTML + TSX
│   ├── popup/                   Popup entry HTML + TSX
│   ├── components/              16 React UI components
│   ├── hooks/                   5 React hooks
│   ├── utils/                   17 utility modules
│   └── types/                   Shared TS types + SubtitleError class
├── public/                      Static assets (icon)
└── .github/workflows/ci.yml     Biome + build on push / PR to main
```

## Architecture notes

- **Three execution contexts.**
  - Side panel — the main UI, runs in the extension's isolated world.
  - Background service worker — keyboard commands, fetch proxy for the subtitle and
    PDF backends, persistent settings.
  - Content scripts — `src/content/index.ts` runs in the isolated world on every page
    (bails on PDFs); `src/content/xTwitter.ts` runs in the MAIN world on `x.com` and
    `twitter.com` to patch `window.fetch`.
- **Background as a fetch proxy.** Subtitle and PDF requests are routed through
  `chrome.runtime.sendMessage` so the service worker can attach the `X-API-Key` header
  and avoid CORS. The side panel never calls the backend directly.
- **Storage split.**
  - `chrome.storage.session` — tab and content cache, LRU with a 9 MB cap and 5-minute
    TTL (see `src/utils/cache.ts`).
  - `chrome.storage.local` — subtitle cache (100 MB cap) and user settings.
  - IndexedDB — export history (metadata + the payload the user chose to save). **Do
    not** persist extracted tab text in IndexedDB.
- **Typed errors.** `SubtitleError` in `src/types/index.ts` is the only typed error in
  the project. Preserve its `code` / `originalError` / `url` fields when re-throwing;
  the UI relies on the `code` for the friendly `userMessage`.
- **PDF.js worker.** Vite emits `pdfjs-dist`'s worker to `assets/pdf.worker.mjs` so it
  can be served from the extension's own origin (required by CSP).
- **Storage keys** are prefixed with `mimir_` (e.g. `mimir_close_tabs_enabled`,
  `mimir_cached_tabs`, `mimir_subtitle_metadata`).

## Conventions

- **No path aliases.** All imports are relative (`./utils/cache`, `../types`).
- **No test suite.** CI is Biome + build only.
- **Biome 2.4.16 is the only linter / formatter.** Tabs for indent, double quotes,
  120-character line width, trailing commas.
- **No `any`.** `noExplicitAny` is `error`. Use `unknown` and narrow.
- **No `React.FC`.** Components declare inline `interface FooProps` at the top of the
  file.
- **Hooks return typed objects**, not arrays.
- **Glass design tokens** (`src/index.css`): `glass-heavy`, `glass-medium`,
  `glass-light`, `glass-hover`. Text tokens: `text-glass-primary`, `text-glass-secondary`,
  `text-glass-muted`. Use these — do not invent new opacity values.
- **Long lists** use `react-virtuoso` (see `HistoryPanel`). Do not render >100 items
  via `.map` + native scroll.
