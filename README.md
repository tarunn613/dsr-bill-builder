# DSR Bill Builder

**A local, offline desktop app for Indian government construction tendering.**
It turns the CPWD **Delhi Schedule of Rates (DSR) 2023** into a **Schedule of
Work**, and the Schedule into a complete **RA Bill** — Schedule, Record of
Measurements, Abstract and Cement Statement — exported as an Excel workbook with
**live formulas**.

**Version 1.8.0** · MIT licensed · Windows · macOS · Linux · React + Express +
Electron · No internet connection required at any point.

---

## Table of contents

- [Why it exists](#why-it-exists)
- [What it does](#what-it-does)
- [Quick start (development)](#quick-start-development)
- [The DSR database](#the-dsr-database)
- [Architecture](#architecture)
- [Calculation model](#calculation-model)
- [Building the desktop app](#building-the-desktop-app)
  - [Windows installer](#windows-installer-exe)
  - [macOS installer](#macos-installer-dmg)
  - [How packaging is wired](#how-packaging-is-wired)
- [Importing scanned documents](#importing-scanned-documents)
- [API reference](#api-reference)
- [Repository layout](#repository-layout)
- [Release history](#release-history)
- [Data, provenance and privacy](#data-provenance-and-privacy)
- [License](#license)

---

## Why it exists

A DSR bill is a chain of dependent calculations. Change one measured quantity and
the item amount, the DSR subtotal, the multiplying factor, the cost index, the
contractor's quoted percentage and the final Gross Amount Payable all move — across
four sheets that cross-reference each other.

Done the usual way, in hand-built Excel, that arithmetic is re-entered dozens of
times per bill. The errors are silent: nothing warns you, and the mistake surfaces
only when an AE or JE rejects the submission — after signatures, after printing.

This app makes the chain the source of truth. Rates come out of the DSR database
rather than out of typing, quantities flow through the sheets automatically, and
the exported workbook carries **real Excel formulas** — so a reviewer can click any
total and trace exactly where it came from.

## What it does

| Stage | What happens |
|---|---|
| **DSR → Schedule** | Enter a DSR code and a quantity; description, unit and rate are pulled from the 5,465-item database. Market-rate and approved (`Appd.`) items sit alongside DSR items. Exports to Excel and PDF. |
| **Schedule → Bill** | The Schedule becomes a live RA Bill. Editing a measurement in the RE sheet flows through the Abstract to the final totals; editing the Schedule flows everywhere. |
| **Cement Statement** | Cement consumption is computed per item from the DSR Vol-2 coefficient appendix (581 coefficients), linked to measured quantities, with fetch and manual modes. |
| **Sessions** | Every tender is a named session with debounced autosave, plus archived copies of every file exported or imported. Portable: export a session as a single `.dbill` file and import it on another machine. |
| **Document import** | A Schedule of Work or a DUSIB award letter can be imported by pasting a vision model's JSON reading of the scanned page. On-device OCR (PaddleOCR / Tesseract) is available as an alternative path. |
| **Excel → PDF** | Any exported bill workbook converts to a black-and-white, A4 fit-to-one-page-wide PDF, one file per sheet, delivered as a zip. |

Numbers follow Indian billing conventions throughout: Indian digit grouping
(`12,34,567`), money to 2 dp, sheet totals to the whole rupee, and amounts computed
from **unrounded** quantities so totals reconcile to the rupee against a reference
bill.

## Quick start (development)

**Prerequisites:** Node.js 20 LTS or newer, and Python 3 (only needed to regenerate
the database snapshot).

```bash
cd schedule-builder
npm run setup        # installs backend + frontend dependencies (first time only)
npm run dev          # hot reload, two processes -> http://localhost:5173
```

Other useful commands:

```bash
npm run build && npm start   # single process, production build -> http://localhost:5175
npm run desktop              # run the Electron app locally, without packaging
npm run sync-db              # regenerate backend/data/dsr_items.json from dsr_database.db
```

The backend listens on **:5175** and the Vite dev server on **:5173**.

## The DSR database

Everything the app needs to compute a bill is committed to this repository — there
is no external service, no API key and no download step.

| File | Size | What it is |
|---|---|---|
| `dsr_database.db` | 1.7 MB | **Canonical extraction.** SQLite, built from the DSR 2023 source PDFs. |
| `dsr_database.xlsx` | 348 KB | The same data as a spreadsheet, for human spot-checking. |
| `dsr_multirate_codes.csv` | 4 KB | Codes that carry more than one rate variant. |
| `schedule-builder/backend/data/dsr_items.json` | 1.9 MB | Runtime snapshot the backend actually loads. |
| `schedule-builder/backend/data/cement_coeff.json` | 472 KB | Runtime cement coefficients. |
| `schedule-builder/backend/ocr-assets/tessdata/eng.traineddata.gz` | 10 MB | Offline Tesseract English model. |

### Schema

```
dsr_items       5,465 rows   code, description, unit, rate, volume, source_page
                             (Vol-1: 3,680 · Vol-2: 1,785)

cement_coeff      581 rows   code, unit, coeff, per, coeff_source, marker,
                             marker_meaning, leaf_desc, group_desc, full_desc,
                             coeff_cell, coeff_white, coeff_other, other_kind,
                             source_page

extraction_meta     1 row    provenance: source, page range, extraction date,
                             count, verification status
```

The recorded provenance for the cement coefficients is *DSR 2023 Vol 2 —
Coefficients for Cement Consumption*, PDF pp. 306–384 (even pages only), 581
coefficients, extracted 2026-07-17, all verification checks passed.

### Why JSON at runtime

The backend reads a JSON snapshot rather than opening SQLite directly. That avoids
a native SQLite module entirely, which keeps the app robust across Node versions
and makes Electron packaging clean — no native rebuild step, no ABI mismatch. The
snapshot also carries structure the table does not: `carriage_count` is 76, and
each carriage item holds a `rate_options` map of per-kilometre slabs
(`1km`, `2km`, … `beyond_20km_addl_per_km`) instead of a single rate.

Regenerate it with `npm run sync-db` whenever `dsr_database.db` is rebuilt.

### Extraction pipeline

| Script | Role |
|---|---|
| `extract_and_build.py` | Vol-1 / Vol-2 source PDFs → SQLite, including rate-variant handling. |
| `extract_cement_coeff.py` | Legend-aware parser for the Vol-2 coefficient appendix, which encodes values by cell colour and marker glyph rather than by column. |
| `reconcile.py` | Certifier that re-checks extracted rates against the source and reports drift. |

The source PDFs (~221 MB, including a 125 MB volume that exceeds GitHub's file
limit) are **not committed**. They are government publications available from CPWD;
populate `data/booklets/` locally if you want to re-run the extraction. You do not
need them to run the app.

## Architecture

```
schedule-builder/
├── package.json              # root: dev scripts + electron-builder config
├── export_dsr_json.py        # dsr_database.db -> backend/data/dsr_items.json
├── desktop/
│   ├── main.cjs              # Electron shell: spawns the backend, opens a window
│   └── build/                # icons (icon.ico / icon.icns / icon.png)
├── backend/                  # Node + Express API (:5175)
│   ├── data/
│   │   ├── dsr_items.json     # in-memory search index (5,465 items)
│   │   ├── cement_coeff.json  # cement coefficients (581)
│   │   └── sessions/          # saved tenders (dev only; desktop uses the OS user-data dir)
│   ├── ocr-assets/tessdata/   # offline Tesseract model
│   └── src/
│       ├── data.js            # load + ranked search + exact lookup
│       ├── core.js            # schedule calc chain + Indian number-to-words
│       ├── excel.js / pdf.js  # schedule exports
│       ├── bill-core.js       # bill calc chain (measured + scheduled)
│       ├── bill-excel.js      # RA Bill workbook: cross-linked sheets, live formulas
│       ├── bill-parse.js      # read an existing bill workbook back in
│       ├── cement.js          # cement statement computation
│       ├── formula.js         # in-process formula evaluator (for Excel -> PDF)
│       ├── xlsx-pdf.js        # workbook -> B&W A4 PDF per sheet
│       ├── json-import.js     # vision-model JSON -> schedule rows
│       ├── tender-import.js   # award-letter JSON -> bill header
│       ├── ocr.js / ocr-engines.js  # on-device OCR + table reconstruction
│       ├── sessions.js        # file-based session store (+ .dbill package/import)
│       └── server.js          # REST API; also serves the built frontend
└── frontend/                 # React 18 + Vite 5 (:5173 in dev)
    └── src/
        ├── SessionContext.jsx # active session + debounced autosave
        ├── pages/             # Home, DsrToSchedule, ScheduleToBill, Sessions, ExcelToPdf, Help
        └── components/        # header form, DSR autocomplete, bill tabs, import modals
```

`schedule-builder-src/` is an earlier **v1.5.1** snapshot of the same tree, kept for
reference. The live application is `schedule-builder/`.

## Calculation model

**Schedule:**

```
per-item amount = round(qty × rate, 2)
DSR subtotal (DSR / Appd. / NS items)
× multiplying factor        (e.g. 0.973)
+ cost index @ N%           = Corrected DSR Total (C1)
+ market items              (added at par — not factored, no cost index)
= Grand Total  →  "Say"     (rounded to the rupee)
```

**Bill** — the same chain, run on measured quantities:

```
main (DSR + Appd.) → × factor → + cost index → + MKT / − Recovery
→ less quoted %  (e.g. 18.5% below)  →  Work Outlay / Gross Amount Payable
```

Quantities **display** at 2 dp but are carried **unrounded** into every amount, which
is what makes the output reconcile to the rupee against a real signed bill. Cement
coefficients stay at 3 dp for source fidelity.

`S.No` is treated as signature-critical and is never sorted or renumbered: it is
carried verbatim as a string (a value like `"16 17"` survives intact), because the
checking engineer reads it against their own BOQ.

## Building the desktop app

The desktop app is a thin [Electron](https://www.electronjs.org/) shell around the
same local web app. `desktop/main.cjs` spawns the Express backend as a child process
using `ELECTRON_RUN_AS_NODE`, on a free port, with `SESSIONS_DIR` pointed at the OS
user-data folder — then polls `/api/meta` until the server answers and swaps a splash
screen for the real UI. **No backend code differs between web and desktop.**

### One-time setup on the build machine

```bash
cd schedule-builder
npm run setup      # backend + frontend dependencies
npm install        # root dependencies: electron + electron-builder
```

Both are required. `npm run setup` installs only the two sub-packages; the root
`npm install` is what brings in Electron 32 and electron-builder 25. The frontend's
`postinstall` vendors the pdf.js worker and OCR assets into `frontend/public/ocr/`.

### Build commands

```bash
npm run dist:win     # Windows -> desktop-dist/DSR-Bill-Builder-Setup-1.8.0.exe
npm run dist:mac     # macOS   -> desktop-dist/DSR-Bill-Builder-1.8.0.dmg
npm run dist         # current platform, using the default target
npm run desktop      # run the app locally without packaging
```

Each command runs `npm run build` (Vite production build) first, then
electron-builder. Output lands in `desktop-dist/`.

**Build each OS's installer on that OS**, or in CI. Cross-building a Windows `.exe`
from macOS or Linux requires Wine and is not recommended; the reliable path is a
Windows machine or a Windows CI runner.

### Windows installer (.exe)

Target **NSIS**, architecture **x64**, artifact `DSR-Bill-Builder-Setup-${version}.exe`.

The installer is deliberately **not** one-click:

| Setting | Value | Effect |
|---|---|---|
| `oneClick` | `false` | A real wizard, not a silent install. |
| `perMachine` | `false` | Per-user install — **no administrator rights needed**, which matters on locked-down government machines. |
| `allowToChangeInstallationDirectory` | `true` | The user picks the install folder. |
| `createDesktopShortcut` | `always` | Desktop shortcut, named "DSR Bill Builder". |
| `createStartMenuShortcut` | `true` | Start Menu entry. |
| `runAfterFinish` | `true` | Launches on completion. |

**Two Windows-specific things to expect:**

1. **SmartScreen on first run.** The `.exe` is unsigned, so Windows shows
   *"Windows protected your PC"*. Choose **More info → Run anyway**. Removing this
   warning requires an EV code-signing certificate.

2. **A slow first launch.** The shell re-spawns the app's own large binary with
   `ELECTRON_RUN_AS_NODE`. The first time Windows Defender sees that freshly
   installed binary execute, it may real-time-scan it — adding anywhere from a few
   seconds to 20–30+ before the process starts. This is outside the app's control
   and disappears on subsequent launches once AV has cached the binary as
   known-good. The shell handles it deliberately: a splash screen so the wait never
   looks frozen, a generous 45-second timeout, and an in-place **Retry** button
   instead of a hard quit.

**OCR note:** the `paddle` engine pulls in **onnxruntime-node**, a large native
module. Building the Windows installer requires the win32 onnxruntime-node binary to
be present at build time. Tesseract has no native dependency and always works — if
the Windows build fails on onnxruntime, that engine is the reason.

### macOS installer (.dmg)

Target **DMG**, category `public.app-category.business`, artifact
`DSR-Bill-Builder-${version}.dmg`.

**The build is unsigned** — the config sets `identity: null`, which skips code
signing entirely. It runs fine on the machine that built it, but on any other Mac
Gatekeeper will block it with *"unidentified developer"* or *"damaged and can't be
opened"*. Two ways past that:

```bash
# The user right-clicks the app and chooses Open (once), or:
xattr -cr "/Applications/DSR Bill Builder.app"
```

For distribution without any warning you need an Apple Developer ID certificate
(99 USD/year) plus notarization — at which point you would set `identity` to the
certificate name and add a `notarize` block.

**Architecture:** `--mac` builds for the host architecture, so an Apple Silicon Mac
produces an arm64 build that will not run on Intel Macs. For both in one artifact:

```bash
npx electron-builder --mac --universal
```

### How packaging is wired

```
asar: true                 desktop/**/* and package.json are archived
extraResources:            backend/  and  frontend/dist/  ship UNPACKED
  ├── backend/             (excludes .DS_Store, data/sessions/**, package-lock.json)
  └── frontend/dist/
```

Shipping the backend as `extraResources` rather than inside the asar archive is
**load-bearing**, not incidental: the native `.node` binary behind onnxruntime cannot
be loaded from inside an asar archive. Keeping the backend unpacked means it loads
normally, with no asar-unpacking rules to maintain.

`data/sessions/**` is excluded from the package deliberately — a shipped installer
must not carry anyone's saved tenders, and at runtime sessions live in the per-user
data folder instead:

| OS | Session folder |
|---|---|
| Windows | `%APPDATA%\DSR Bill Builder\sessions` |
| macOS | `~/Library/Application Support/DSR Bill Builder/sessions` |

App identity is `in.gov.etenderdelhi.dsrbillbuilder`, product name **DSR Bill
Builder**. Icons are picked up automatically from `desktop/build/`
(`icon.ico` for Windows, `icon.icns` for macOS, `icon.png` for the window).
A Linux **AppImage** target is configured as well.

The shell also takes a single-instance lock: launching a second copy focuses the
existing window rather than starting a competing backend.

## Importing scanned documents

On **DSR → Schedule**, the import workspace turns a scanned Schedule of Work into
editable, DSR-matched rows. Two paths exist:

**JSON import (primary).** You paste a vision model's JSON reading of the page,
following a fixed contract with an embedded prompt. Rows are matched to the database
in `s_no` order. The award-letter equivalent autofills the Bill Header and
self-verifies by checking that the amount in words matches the digits, and that
`quoted = estimated × (1 − pct%)`.

**On-device OCR (alternative).** Page rendering happens in the browser via pdf.js;
each page image is streamed to the backend one at a time so the progress bar is real.
Recognition runs locally through either `paddle` (PaddleOCR PP-OCRv4, robust on
skewed scans) or `tesseract` (lighter fallback). The parser reconstructs the ruled
table from recognised token boxes and matches codes by **digit signature**, so it
recovers a code even when OCR drops the dots (`1521` → `15.2.1`), with a description
tiebreak. Low-confidence rows are flagged for review before anything is applied.

A `vision` seam (`/api/ocr/vision`) is wired for a local VLM or handwriting model,
disabled until `OCR_VISION_ENDPOINT` and `OCR_VISION_API_KEY` are set.

## API reference

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/meta` | Item counts; also the readiness probe the Electron shell polls. |
| GET | `/api/dsr/search?q=` | Ranked search by code prefix or keywords. |
| GET | `/api/dsr/:code` | Exact lookup, including all rate variants. |
| POST | `/api/schedule/compute` · `/xlsx` · `/pdf` | Live totals, Excel export, PDF export. |
| POST | `/api/bill/compute` · `/xlsx` · `/parse` | Bill totals, workbook export, parse an uploaded bill. |
| POST | `/api/ocr/recognize` | OCR one page image (`engine`: `paddle` \| `tesseract`) → token boxes. |
| POST | `/api/ocr/parse` | Reconstruct the table from tokens and match codes to the database. |
| POST | `/api/ocr/match` | Re-match a single edited code. |
| GET | `/api/ocr/engines` | Which OCR engines can run on this device. |
| GET/POST | `/api/sessions` | List / create sessions. |
| GET/PUT/DELETE | `/api/sessions/:id` | Load / autosave / delete. |
| GET | `/api/sessions/:id/exports/:exportId` | Re-download an archived export. |
| GET | `/api/sessions/:id/package` | Download a whole session as `.dbill`. |
| POST | `/api/sessions/import` | Import a `.dbill` as a new session. |

Export and parse requests accept an optional `sessionId`; when present, the produced
or uploaded file is archived into that session.

## Repository layout

```
schedule-builder/          the application (see Architecture above)
schedule-builder-src/      earlier v1.5.1 source snapshot, kept for reference
dsr_database.db            extracted DSR 2023 rate book (SQLite)
dsr_database.xlsx          the same data, human-readable
dsr_multirate_codes.csv    codes carrying multiple rate variants
extract_and_build.py       Vol-1/Vol-2 PDF -> SQLite extraction pipeline
extract_cement_coeff.py    legend-aware parser for the cement coefficient appendix
reconcile.py               certifier: re-checks extracted rates against the source
BILL-TO-JSON-PROMPT.md     vision-model prompt for reading a signed bill into JSON
CEMENT-COEFFICIENT-EXTRACTION-GUIDE.md   how the coefficient appendix is decoded
HANDOFF.md                 design notes and the reasoning behind the calc chain
```

## Release history

Every release from v1.3.1 onward is tagged — see [Releases](../../releases) or
`git tag -l`.

| Tag | Highlights |
|---|---|
| `v1.8.0` | Sessions active-tender highlight, duplicate-name guard, JSON-import fixes |
| `v1.7.0` | Cement base-code fallback, "Keep full description" toggle |
| `v1.6.3` | S.No backspace-to-blank fix and the duplicate-key bug it exposed |
| `v1.6.2` | Abstract spacer row removed, wider Qty/Rate columns |
| `v1.6.1` | JSON-import S.No flows verbatim through schedule, bill and export |
| `v1.6.0` | Canonical schedule numbering, RE-linked cement quantity, tender-details import |
| `v1.5.1` | 2 dp quantity display, cross-sheet bill header |
| `v1.5.0` | Sessions dashboard redesign, JSON schedule import |
| `v1.4.0` | Left-drawer navigation, Help guide, Windows startup race fix |
| `v1.3.1` | Excel → PDF converter page, RA Bill RE sheet rework |

## Data, provenance and privacy

The rate data in this repository is derived from the **publicly published CPWD Delhi
Schedule of Rates 2023** and is included so that the application runs without a
separate extraction step. Provenance for the cement coefficients — source volume,
page range, extraction date and verification status — is recorded inside the
database itself, in `extraction_meta`.

**Real tender documents are deliberately excluded.** Award letters, signed bills and
schedules identify a named contracting agency and carry award-letter numbers, site
and JSC codes, and the contractor's quoted percentage below estimate — commercially
sensitive bid data. Those files were removed from this repository's history, and
every agreement number, amount and percentage appearing in the documentation is a
**placeholder**. Some code comments still name the reference workbooks the
calculations were validated against; those files are not shipped, and none are
needed to run or build the app.

If you work from this repository, keep your own tender documents outside it, or rely
on the `.gitignore` rules already in place.

## License

[MIT](LICENSE) © 2026 Tarun
