# DSR Bill Builder

A **local, offline** app for government tendering that turns the extracted DSR
rate database into a **Schedule of Work** and then into a full **RA Bill**
(Schedule + Record of Measurements + Abstract). Runs as a normal web app in
development, and ships as a **desktop app** (Windows `.exe` / Mac `.dmg`) for
non-technical contractors.

- **Contractors / end users:** see **[USER-GUIDE.md](USER-GUIDE.md)** — how to
  install and use the desktop app. No technical knowledge required.
- **Whoever builds the installer:** see [Building the desktop app](#building-the-desktop-app-installer) below.

## What it does (the three phases)

1. **DSR → Schedule** — enter DSR codes + quantities (+ market items); the app
   pulls description/unit/rate from the DSR database, applies the tender
   calculation chain, and exports a Schedule of Work as **Excel** / **PDF**.
2. **Schedule → Bill** — turn a schedule into a live RA Bill. Editing a
   measurement flows to the Abstract; editing the schedule flows everywhere. The
   quoted rate % (e.g. *18.5% below*) is applied to give the Gross Amount Payable.
3. **Sessions** — every tender is a named **session**, saved automatically. It
   keeps the schedule, the bill, and **archived copies of every exported/imported
   file**. Sessions are portable: export one as a single `.dbill` file and import
   it on another machine. Nothing is ever lost.

## Architecture

```
schedule-builder/
├── export_dsr_json.py        # DSR sqlite -> backend/data/dsr_items.json (re-run after Phase 1 rebuilds)
├── package.json              # root: dev scripts + Electron/electron-builder config
├── desktop/
│   └── main.cjs              # Electron shell: spawns the backend, opens a window
├── backend/                  # Node/Express API (:5175)
│   ├── data/
│   │   ├── dsr_items.json     # in-memory search index (5353 items)
│   │   └── sessions/          # saved tenders (dev only; desktop uses the OS user-data dir)
│   └── src/
│       ├── data.js            # load + ranked search + exact lookup
│       ├── core.js            # schedule calc chain + Indian number-to-words
│       ├── excel.js / pdf.js  # schedule exports
│       ├── bill-core.js       # bill calc chain (measured + scheduled)
│       ├── bill-excel.js      # RA Bill workbook (cross-linked sheets, live formulas)
│       ├── sessions.js        # file-based session store (+ .dbill package/import)
│       └── server.js          # REST API; also serves the built frontend
└── frontend/                 # React + Vite (:5173 in dev)
    └── src/
        ├── SessionContext.jsx # active session + debounced autosave
        ├── pages/             # HomePage, DsrToSchedulePage, ScheduleToBillPage, SessionsPage
        └── components/…       # header form, DSR autocomplete, bill tabs, etc.
```

The backend reads a **JSON snapshot** of the DSR database (no native SQLite module
— robust across Node versions and clean to package). Re-generate it with
`npm run sync-db` whenever `../dsr_database.db` is rebuilt.

## OCR import (scan a Schedule of Work)

On **DSR → Schedule**, *⤓ Import from PDF* opens a full-screen workspace that turns
a scanned "Schedule of Work" into editable, DSR-matched rows.

- **Rendering** happens in the browser (`frontend/src/ocr/renderPdf.js`, pdf.js).
  Each page image is streamed to the backend one at a time so the modal shows a
  real progress bar.
- **Recognition** runs on-device in the backend (`backend/src/ocr-engines.js`):
  `paddle` = PaddleOCR PP-OCRv4 (open weights via `@gutenye/ocr-node` /
  onnxruntime-node — recommended, robust on skewed scans) and `tesseract` =
  Tesseract.js (lighter fallback). A `vision` seam (`/api/ocr/vision`) is wired
  for a local VLM / handwriting model, disabled until `OCR_VISION_ENDPOINT` +
  `OCR_VISION_API_KEY` are set.
- **Parsing + matching** (`backend/src/ocr.js`) reconstructs the ruled table from
  the recognised token boxes and matches each code to the DSR DB by **digit
  signature** — so it recovers codes even when OCR drops the dots (`1521` →
  `15.2.1`) — with a description tiebreak. Low-confidence rows are flagged for
  review; the user cross-checks against the page and edits before applying.

Offline assets: Tesseract language data lives in `backend/ocr-assets/tessdata/`
(the tracked `.gz`); PaddleOCR models ship inside `@gutenye/ocr-models`; the pdf.js
worker is vendored to `frontend/public/ocr/` by the frontend `postinstall`.

> **Packaging note:** the `paddle` engine pulls in **onnxruntime-node** (a large
> native module). It runs fine in dev and inside the packaged app (the backend
> ships as Electron `extraResources`, so the native `.node` loads without
> asar-unpacking), but building the **Windows** installer requires the win32
> onnxruntime-node binary to be present at build time. Tesseract has no native
> dependency and always works.

## Run (development)

```bash
cd schedule-builder
npm run setup        # installs backend + frontend deps  (first time)
npm run sync-db      # only if dsr_database.db changed since last export

npm run dev          # hot reload, two processes  -> http://localhost:5173
# or
npm run build && npm start   # single process     -> http://localhost:5175
```

## Building the desktop app (installer)

The desktop app is a thin [Electron](https://www.electronjs.org/) shell: it starts
the existing Express backend as a child process on a free port (with the session
folder pointed at the OS user-data dir) and opens a window on it. No backend code
changes between web and desktop.

**One-time setup on the build machine:**

```bash
cd schedule-builder
npm run setup            # backend + frontend deps
npm install              # root deps: electron + electron-builder
```

**Build the installer:**

```bash
npm run dist:win     # Windows  -> desktop-dist/DSR-Bill-Builder-Setup-1.0.0.exe   (build on Windows)
npm run dist:mac     # macOS    -> desktop-dist/DSR-Bill-Builder-1.0.0.dmg          (build on macOS)
npm run desktop      # just run the desktop app locally (no installer)
```

Build each OS's installer **on that OS** (or via CI). Cross-building a Windows
`.exe` from macOS/Linux needs extra tooling (Wine) and is not recommended; the
reliable path for "Windows mostly" is to run `npm run dist:win` on a Windows PC or
a Windows CI runner. The output installers land in `desktop-dist/`.

> **Icons (optional but recommended):** drop `icon.ico` (Windows, 256×256) and
> `icon.icns` (Mac) into `desktop/build/`. electron-builder picks them up
> automatically; without them the default Electron icon is used.

Where a contractor's data lives once installed (shown at the bottom of the
Sessions page):

| OS | Folder |
|---|---|
| Windows | `%APPDATA%\DSR Bill Builder\sessions` |
| macOS | `~/Library/Application Support/DSR Bill Builder/sessions` |

## Calculation model

**Schedule** (matches `Schedule_of_Work.xlsx` to the paise):

```
per-item amount = round(qty × rate, 2)
DSR subtotal (DSR / Appd. / NS items)
× Multiplying factor       (e.g. 0.973)
+ Cost Index @ N%          = Corrected DSR Total (C1)
+ Market items             (added at par — NOT factored, NO cost index)
= Grand Total  →  "Say"    (rounded to the rupee)
```

**Bill** (same chain, run on measured quantities):

```
main (DSR + Appd.) → ×factor → +cost index → +MKT / −Recovery
→ less quoted %  (e.g. 18.5% below)  →  Work Outlay / Gross Amount Payable
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/meta` | item counts |
| GET  | `/api/dsr/search?q=` | ranked search (code prefix or keywords) |
| GET  | `/api/dsr/:code` | exact lookup (all rate variants) |
| POST | `/api/schedule/compute` · `/xlsx` · `/pdf` | live totals / Excel / PDF |
| POST | `/api/bill/compute` · `/xlsx` · `/parse` | bill totals / Excel / parse upload |
| POST | `/api/ocr/recognize` | OCR one page image (`engine`: `paddle` \| `tesseract`) → token boxes |
| POST | `/api/ocr/parse` | reconstruct the table from tokens + match codes to the DSR DB |
| POST | `/api/ocr/match` | re-match one edited code against the DSR DB |
| GET  | `/api/ocr/engines` | which OCR engines can run on this device |
| GET/POST | `/api/sessions` | list / create sessions |
| GET/PUT/DELETE | `/api/sessions/:id` | load / autosave / delete |
| GET | `/api/sessions/:id/exports/:exportId` | re-download an archived export |
| GET | `/api/sessions/:id/package` | download a whole session as `.dbill` |
| POST | `/api/sessions/import` | import a `.dbill` as a new session |

Export/parse requests accept an optional `sessionId`; when present, the produced
or uploaded file is archived into that session.
```
