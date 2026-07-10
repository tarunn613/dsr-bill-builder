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
│       ├── bill-excel.js      # RA Bill workbook (3 cross-linked sheets, live formulas)
│       ├── bill-parse.js      # parse an uploaded schedule workbook
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
| GET/POST | `/api/sessions` | list / create sessions |
| GET/PUT/DELETE | `/api/sessions/:id` | load / autosave / delete |
| GET | `/api/sessions/:id/exports/:exportId` | re-download an archived export |
| GET | `/api/sessions/:id/package` | download a whole session as `.dbill` |
| POST | `/api/sessions/import` | import a `.dbill` as a new session |

Export/parse requests accept an optional `sessionId`; when present, the produced
or uploaded file is archived into that session.
```
