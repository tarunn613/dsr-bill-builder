# DSR Bill Builder — Session Handoff

> Purpose: let a fresh agent pick up this project with full context. Everything
> done up to now is captured here. Paths are relative to the **primary working
> directory** `dyanamic-bill-builder/`; almost all code lives under
> `schedule-builder/`.

---

## 1. What this project is

A **local, offline** app for Indian government tendering (client context: DUSIB —
Delhi Urban Shelter Improvement Board). It turns the extracted **DSR 2023** rate
database into a **Schedule of Work**, and then into a full **RA Bill**
(Schedule + Record of Measurements + Abstract). It runs as a local web app in
development and ships as a **desktop app** (Windows `.exe` / Mac `.dmg`) for
non-technical contractors.

Stack: **React + Vite** frontend, **Node/Express** backend, **ExcelJS** (xlsx) +
**pdfkit** (pdf), **Electron** + **electron-builder** for the desktop shell.
Everything is local-only; no internet at runtime.

**Governing constraint (do not violate):** the DSR database must stay faithful to
the source PDF — *never mutate a DSR rate in the DB to match an external
reference*. If a tender legitimately needs a different rate, use the **per-line
rate override** feature (Phase 2), which flags the deviation and shows the book
rate alongside. This principle came from a real incident (a reference tender had a
mislabeled rate; the DB was correct).

---

## 2. Where things stand right now (TL;DR)

- **Phases 1–4 are complete and verified.** Phase 1 (data extraction), Phase 2
  (DSR→Schedule), Phase 3 (Schedule→Bill), Phase 4 (sessions + desktop packaging).
- **This session delivered:** a small input bug fix, full **session management**
  (named tenders, autosave, archived exports/imports, portable `.dbill` files),
  and **desktop packaging** (Electron app + installers).
- **Built artifacts:**
  - `schedule-builder/desktop-dist/DSR-Bill-Builder-1.0.0.dmg` — Mac installer
    (105 MB, built and runtime-verified on this machine).
  - `dsr-bill-builder-source.zip` (356 KB, in this folder) — clean source bundle
    to copy to a Windows machine for building the `.exe`.
- **Immediate open thread:** the user is building the **Windows installer on a
  Windows PC**. They asked about a `python3` error — answer: **Python is not
  needed on Windows** (the DSR data is bundled); it's only used by the optional
  `sync-db` script. Windows uses `python`/`py`, not `python3`, if ever needed.
- **Dev preview server** is running on **:5175** (Claude Code preview serverId
  `efa4f761-e69a-4080-a3a7-234b73852011`) serving the built `dist` + API.
- **Dev session store is clean** (0 sessions in `backend/data/sessions`).

---

## 3. Repo layout & key files

```
dyanamic-bill-builder/                 (primary cwd)
├── HANDOFF.md                         ← this file
├── dsr-bill-builder-source.zip        ← source bundle for the Windows build
└── schedule-builder/                  ← the actual app
    ├── package.json                   root: dev scripts + Electron/electron-builder config
    ├── dev.mjs                        runs backend(:5175, --watch) + vite(:5173) together
    ├── export_dsr_json.py             DSR sqlite -> backend/data/dsr_items.json (needs Python + the .db)
    ├── README.md                      full architecture + build docs
    ├── USER-GUIDE.md                  plain-language guide for contractors
    ├── desktop/
    │   └── main.cjs                   Electron main: spawns backend, opens a window
    ├── backend/
    │   ├── package.json               deps: express, cors, exceljs, pdfkit, adm-zip
    │   ├── data/
    │   │   ├── dsr_items.json          DSR snapshot, 5353 items (git-ignored, ESSENTIAL)
    │   │   └── sessions/               saved tenders (dev only; desktop uses OS user-data dir)
    │   └── src/
    │       ├── data.js                 load + ranked search + exact lookup
    │       ├── core.js                 schedule calc chain + Indian number-to-words
    │       ├── excel.js / pdf.js        schedule exports (rate-override flagging)
    │       ├── bill-core.js             bill calc chain (scheduled + measured)
    │       ├── bill-excel.js            RA Bill workbook (3 cross-linked sheets, live formulas)
    │       ├── bill-parse.js            parse an uploaded schedule workbook
    │       ├── sessions.js              file-based session store (+ .dbill package/import)
    │       └── server.js                REST API; also serves the built frontend
    └── frontend/
        ├── vite.config.js             dev proxy /api -> :5175
        └── src/
            ├── main.jsx               wraps <App> in <SessionProvider>
            ├── App.jsx                hash router + nav + active-session chip; key={session.id} on pages
            ├── SessionContext.jsx     active session + debounced autosave (the heart of Phase 4 FE)
            ├── api.js                 fetch wrappers (schedule, bill, sessions)
            ├── store.js               Phase2->3 handoff via localStorage 'billHandoff'
            ├── styles.css             all styles (session UI appended at the end)
            ├── pages/
            │   ├── HomePage.jsx
            │   ├── DsrToSchedulePage.jsx   Phase 2 UI (+ session hydrate/autosave)
            │   ├── ScheduleToBillPage.jsx  Phase 3 UI (+ session hydrate/autosave)
            │   └── SessionsPage.jsx        Phase 4 UI (list/create/open/rename/delete/export/import)
            └── components/
                ├── HeaderForm.jsx      NOTE: "Name of Work"/"Sub Head" are <textarea>, others <input>
                ├── DsrItemsSection.jsx, DsrCodeSearch.jsx, MarketItemsSection.jsx, SchedulePreview.jsx
                └── bill/ BillScheduleTab.jsx, BillReTab.jsx, BillAbstractTab.jsx
```

---

## 4. Phase-by-phase (what each does)

**Phase 1 — DSR extraction (done earlier, context only).** DSR 2023 Vol1/Vol2 PDF
→ SQLite → JSON snapshot. 100% source fidelity. The backend reads the **JSON
snapshot** (`backend/data/dsr_items.json`, 5353 items) — deliberately no native
SQLite module, so it's robust across Node versions and clean to package.
Regenerate via `npm run sync-db` only if the source `.db` changes.

**Phase 2 — DSR → Schedule** (`DsrToSchedulePage`, `core.js`, `excel.js`, `pdf.js`).
Enter DSR codes + quantities (+ market items); description/unit/rate auto-fill from
the DB. Calc chain (matches `Schedule_of_Work.xlsx` to the paise):
`Σ(qty×rate) → ×multiplying factor → +cost index% = Corrected DSR Total (C1)
→ + market items at par → Grand Total → "Say" (round to rupee)`.
Exports Excel + PDF. **Per-line rate override** flags deviations everywhere
(UI, live preview, Excel note+fill, PDF asterisk+footnote) without touching the DB.

**Phase 3 — Schedule → Bill** (`ScheduleToBillPage`, `bill-core.js`, `bill-excel.js`).
3 cross-linked sheets with live formulas (edit a measurement → Abstract updates;
edit schedule → RE + Abstract update). RE row qty = `PRODUCT(Nos,Factor,L,W,H)`;
negative Nos = a "less" deduction. Categories: DSR, Appd., MKT, **Recovery**
(negative). Corrected chain vs the original HTML: `main(DSR+Appd) → ×factor →
+cost index → +MKT / −Recovery → less quoted % (e.g. 18.5% below) → Work Outlay /
Gross Amount Payable`. Target reference = `phase-3/final-sheet-required.xlsx`.

**Phase 4 — Sessions + Desktop (this session).** See §5.

---

## 5. This session's changes (in detail)

### 5a. Input bug fix — `frontend/src/pages/DsrToSchedulePage.jsx`
"No. of DSR items / market items" snapped back to `0` on backspace because
`onChange` did `parseInt(value) || 0` (empty string → `0`). Fixed by holding the
raw **string** in state (`nDsr`/`nMkt` init `'1'`/`'0'`) and coercing only in
`applySetup()` via `parseInt(nDsr,10)||0`. Verified: field now stays empty.

### 5b. Session management

**Backend — `backend/src/sessions.js` (new).** File-based store (NOT SQLite).
One folder per session: `<base>/<id>/session.json` + `exports/` + `imports/`.
Base dir = `process.env.SESSIONS_DIR` (desktop sets it to the OS user-data dir),
else `backend/data/sessions`. A session = one tender holding both pages' state
(`state.schedule`, `state.bill`) plus archived files. API of the module:
`listSessions, createSession, getSession, updateSession, deleteSession,
archiveExport, getExportFile, recordImport, packageSession, importSessionPackage,
sessionsBaseDir`. Safety: session ids validated against a UUID regex (path-traversal
guard); writes are atomic (temp file + rename). Portable **`.dbill`** = a zip of the
session folder (via `adm-zip`); import creates a NEW id so nothing clashes.

**Backend — `backend/src/server.js` (edited).** Added endpoints:
`GET/POST /api/sessions`, `GET/PUT/DELETE /api/sessions/:id`,
`GET /api/sessions/:id/exports/:exportId` (re-download),
`GET /api/sessions/:id/package` (download `.dbill`),
`POST /api/sessions/import`. The existing `/api/schedule/xlsx|pdf`,
`/api/bill/xlsx`, `/api/bill/parse` now accept an optional `sessionId` and archive
the produced/uploaded file into that session (`archiveIfSession` helper; failures
never block the download). JSON body limit raised to 30 mb.
New dep: `adm-zip@^0.5.16` in `backend/package.json`.

**Frontend — `frontend/src/SessionContext.jsx` (new).** `SessionProvider` +
`useSession()`. Always keeps ONE active session (auto-creates "Untitled tender" if
none — so autosave always has a home and nothing is lost). Active id persisted in
`localStorage['activeSessionId']`. `saveSlice(slice, state)` = **debounced (700 ms)**
PUT of a page's slice. Also `newSession, renameSession, removeSession,
importSession, refreshList, reloadActive`.

**Frontend — pages wired to sessions.** `App.jsx` gives the schedule/bill pages
`key={session?.id}` so **switching sessions remounts them** and they initialize
state straight from the saved slice — this sidesteps hydrate-vs-autosave loops.
Each page builds a slice via `useMemo`, keeps a `lastSavedRef`, and only calls
`saveSlice` when `JSON.stringify(slice) !== lastSavedRef`. The **bill page** still
honors a pending `billHandoff` (localStorage, from "Send to Bill →") which takes
priority over the saved slice on mount, then autosaves it into the session. Old
`localStorage['billState']` persistence was removed (sessions replace it).
Exports/uploads pass `sessionId` and call `reloadActive()` to refresh the archive
list. `api.js` gained session fetch helpers; `parseScheduleFile(file, sessionId)`.

**Frontend — `frontend/src/pages/SessionsPage.jsx` (new)** + nav entry +
active-session chip (top-right, shows active tender name). List with create / open
/ rename / delete / **Export** (`.dbill`) / **Import session**, plus a table of
archived exports (with Download) and imports. Styles appended to `styles.css`.

### 5c. Desktop packaging

**`desktop/main.cjs` (new).** Electron main. `app.setName('DSR Bill Builder')`
(clean user-data folder name). On launch it spawns the **unchanged** Express
backend as a child on a free port:
`spawn(process.execPath, [server.js], { env:{ ELECTRON_RUN_AS_NODE:'1', PORT,
SESSIONS_DIR } })` where `SESSIONS_DIR = app.getPath('userData')/sessions`; polls
`/api/meta` until up; then opens a `BrowserWindow` on `http://127.0.0.1:PORT/`.
Single-instance lock; friendly menu; kills the backend on quit.
**Packaged path resolution:** `backendDir = app.isPackaged ?
process.resourcesPath/backend : __dirname/../backend`; `server.js` finds `dist` at
`backend/../../frontend/dist` — so `extraResources` must copy `backend`→`backend`
and `frontend/dist`→`frontend/dist` (layout preserved). This is verified working.

**Root `package.json` (edited).** `name: dsr-bill-builder`, `author`,
`main: desktop/main.cjs`; scripts `desktop` (run locally), `dist`, `dist:mac`,
`dist:win`; devDeps `electron ^32.2.0` + `electron-builder ^25.1.8`; `build` config
(appId `in.gov.dusib.dsrbillbuilder`, productName "DSR Bill Builder",
`extraResources`, nsis + dmg + AppImage, `mac.identity: null` = skip signing).
`.gitignore` gained `desktop-dist/` and `backend/data/sessions/`.

**Docs.** `README.md` rewritten (full app + build). `USER-GUIDE.md` new
(plain-language for contractors: install, sessions, both workflows, FAQ).

### 5d. Earlier in this session (carried from the prior, compacted session)
The "**description missing in RE/Abstract exported Excel**" report was diagnosed as
a **row-height** issue (descriptions were present via live formulas but wrapped
text was clipped to one line). Fixed with a `descHeight()` helper in
`bill-excel.js` applied to Schedule/RE/Abstract description rows. Already done and
verified before the Phase 4 work began.

---

## 6. How to run & build

**Dev (from `schedule-builder/`):**
```
npm run setup                 # backend + frontend deps (first time)
npm run dev                   # two processes -> http://localhost:5173
# or single process:
npm run build && npm start    # -> http://localhost:5175
```

**Run the desktop app locally (no installer):**
```
npm install                   # root: electron + electron-builder (first time)
npm run desktop
```

**Build installers (build each OS on that OS):**
```
npm run dist:mac              # -> desktop-dist/DSR-Bill-Builder-1.0.0.dmg
npm run dist:win              # -> desktop-dist/DSR-Bill-Builder-Setup-1.0.0.exe (run on Windows)
```

**Data-folder locations once installed** (shown at the bottom of the Sessions page):
- Windows: `%APPDATA%\DSR Bill Builder\sessions`
- macOS: `~/Library/Application Support/DSR Bill Builder/sessions`

---

## 7. Key decisions & non-obvious gotchas

- **File-based session store, not SQLite** — chosen to avoid native-module pain on
  Node 26 and to keep Electron packaging clean; also makes a session trivially
  zippable into a `.dbill`.
- **Always-active session** — the app auto-creates "Untitled tender" so autosave
  always has a target ("no work lost" by default). Active id persists in
  localStorage.
- **`key={session.id}` remount** on the schedule/bill pages is intentional — it's
  how session-switch hydration stays correct without save loops. Don't remove it
  without replacing the hydration strategy.
- **npm 11 `allow-scripts` gate (this machine only)** blocked Electron's
  postinstall (binary download), same as esbuild earlier. Manual fix used here:
  `cd node_modules/electron && node install.js`; when only the license extracted,
  manually `unzip ~/Library/Caches/electron/*/electron-*.zip -d node_modules/electron/dist`
  and write `node_modules/electron/path.txt` with **`printf` (NO trailing
  newline)** — a trailing `\n` makes spawn fail with `ENOENT .../Electron\n`.
  A normal Windows/other Node install does NOT hit this (scripts run normally).
- **electron-builder keeps its own cache** separate from the `electron` npm
  package, so it re-downloads the ~99 MB Electron zip at first build.
- **`app.setName()` must run before any `app.getPath('userData')`** or the folder
  falls back to the package name (`dsr-bill-builder`) instead of "DSR Bill Builder".
- **Windows build must be on Windows** (cross-building `.exe` from mac needs Wine).
- **Python is not needed** on Windows/mac to build or run — only `sync-db` uses it,
  and the DSR JSON is already generated/bundled. Windows has no `python3` command;
  it's `python` or `py`.
- **Testing tip:** "Name of Work" and "Sub Head" render as `<textarea>`, the other
  header fields as `<input>` (bit me during browser automation).

---

## 8. Verification done (this session)

- Backspace fix: number field stays empty after clearing (browser).
- Session store unit test: create/update/archive/import/delete + path-traversal
  blocked + package→reimport preserves state & exports.
- Session API over HTTP: create → update → bill export archives → package `.dbill`
  → import as new id → re-download archived export returns a valid xlsx → delete.
- Browser E2E: autosave persists to disk; **reload restores** active session + field
  values; **switching sessions swaps data** and neither session clobbers the other;
  UI export archives and shows in the Sessions files table.
- Electron dev smoke: main spawns backend, window loads, session auto-created in
  `~/Library/Application Support/DSR Bill Builder/sessions`.
- **Packaged app** (`.app` launched directly): backend spawns from `Resources/`,
  GUI bootstraps a session, data folder correct. Mac **DMG built** (exit 0) and its
  `Resources/` contains `backend/`, `backend/data/dsr_items.json`,
  `frontend/dist/index.html`.

---

## 9. Windows build handoff (current immediate context)

The user copied `dsr-bill-builder-source.zip` to a Windows PC to build the `.exe`.
The zip contains **only source + the essential git-ignored `dsr_items.json` +
lockfiles**; it excludes all `node_modules/`, `frontend/dist/`, `desktop-dist/`.

On Windows: install **Node.js LTS (20/22)**, then in the unzipped
`schedule-builder/`:
```
npm run setup
npm install
npm run dist:win     -> desktop-dist\DSR-Bill-Builder-Setup-1.0.0.exe
```
Their last question was a `python3` "not recognized" error → **Python isn't needed**
(explained above). If they report it came from `npm install` (node-gyp), it's an
ignorable optional-dep message — the real test is whether `npm run dist:win`
produces the `.exe`.

---

## 10. Open items / known gaps / suggested next steps

- **Windows `.exe`** not yet produced here (being built by the user on Windows).
- **App icons** — optional: drop `icon.ico` (256×256) + `icon.icns` into
  `desktop/build/`; electron-builder auto-detects. Currently the default Electron
  icon is used.
- **Code signing** — installers are unsigned (mac `identity:null`), so first launch
  shows a one-time "unknown developer" prompt (documented in USER-GUIDE.md).
  Needs paid Apple/Windows certs; fine to skip for internal use.
- **Offered but not yet done:** a `BUILD-WINDOWS.txt` inside the zip; a GitHub
  Actions workflow to build the Windows `.exe` without a Windows machine.
- **Phase 3 scope gaps (future work):** only the **core 3 bill sheets** are
  generated (Schedule/RE/Abstract). The real target `final-sheet-required.xlsx` has
  11 sheets — the other 8 (PR, AE/EE Test, **Cement register** (could use the
  Phase-1 cement coefficient appendix), Recovery statements, Completion
  Certificate, Deviation) are not built. Also: only **one RE measurement block per
  item**; the real bill sometimes splits one item across multiple RE blocks summed
  in the Abstract (`=SUM(C25:C26)`).

---

## 11. Environment quirks (this machine)

- Not a git repo. Platform darwin (arm64), Node v26.3.0, zsh.
- Preview server: Claude Code preview runs `node backend/src/server.js` on **:5175**
  (config in `.claude/launch.json`) — **no `--watch`**, and it serves the **built
  `frontend/dist`**. So: restart the preview to pick up **backend** changes, and
  run `npm run build` to pick up **frontend** changes (dist is what's served).
  Current preview serverId: `efa4f761-e69a-4080-a3a7-234b73852011`.
- Memory files for this project live in the agent's memory dir (indexed in
  `MEMORY.md`): `dsr-extraction-project`, `phase2-schedule-builder`,
  `phase3-bill-builder`, `phase4-sessions-desktop`.
