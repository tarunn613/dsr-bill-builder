# DSR Bill Builder

A **local, offline** desktop app for Indian government construction tendering. It
turns the CPWD **DSR 2023** rate book into a **Schedule of Work**, then into a
complete **RA Bill** — Schedule, Record of Measurements, Abstract and Cement
Statement — as a live Excel workbook with real formulas.

Built for contractors and junior engineers who currently do this by hand in Excel,
where a single mis-keyed rate propagates silently into a signed, submitted bill.

> **Current version: 1.8.0.** Every release from `v1.3.1` onward is tagged — see
> [Releases](../../releases) or `git tag -l`.

---

## Why it exists

A DSR bill is a chain of dependent calculations. Change one measured quantity and
the item amount, the DSR subtotal, the multiplying factor, the cost index, the
contractor's quoted percentage and the final Gross Amount Payable all move — across
four cross-referencing sheets. Done by hand, the arithmetic is re-entered dozens of
times per bill, and the errors are invisible until an AE/JE rejects the submission.

This app makes the chain the source of truth: rates come from the DSR database, not
from typing, and the exported workbook carries **live formulas**, so a reviewer can
click any total and see where it came from.

## What it does

| Stage | What happens |
|---|---|
| **DSR → Schedule** | Enter a DSR code and a quantity; description, unit and rate are pulled from a 5,465-item database. Market-rate items sit alongside. Exports to Excel/PDF. |
| **Schedule → Bill** | The schedule becomes a live RA Bill. Editing a measurement flows through the RE sheet to the Abstract and the totals. |
| **Cement Statement** | Cement consumption is computed per item from the DSR Vol-2 coefficient appendix (581 coefficients), linked to measured quantities. |
| **Sessions** | Every tender is a named session with autosave and archived copies of every file exported or imported. Portable as a single `.dbill` file. |
| **Import** | A Schedule of Work or an award letter can be imported by pasting a vision model's JSON reading of the scanned page, with on-device OCR as an alternative path. |
| **Excel → PDF** | Any exported bill workbook converts to a B&W, A4 fit-to-width PDF per sheet. |

## Quick start

```bash
cd schedule-builder
npm run setup
npm run dev
```

Then open <http://localhost:5173>. Full developer documentation — architecture, the
calculation model, the API surface, OCR internals and how to build the Windows/macOS
installers — is in **[schedule-builder/README.md](schedule-builder/README.md)**.
End-user instructions are in
**[schedule-builder/USER-GUIDE.md](schedule-builder/USER-GUIDE.md)**.

## Repository layout

```
schedule-builder/       the app — React + Vite frontend, Express backend, Electron shell
schedule-builder-src/   an earlier v1.5.1 source snapshot, kept for reference
dsr_database.db         extracted DSR 2023 rate book (5,465 items, 581 cement coefficients)
extract_and_build.py    Vol-1/Vol-2 PDF → SQLite extraction pipeline
extract_cement_coeff.py legend-aware parser for the cement coefficient appendix
reconcile.py            certifier that re-checks extracted rates against the source
BILL-TO-JSON-PROMPT.md  the vision-model prompt for reading a signed bill into JSON
HANDOFF.md              design notes and the reasoning behind the calculation chain
```

## A note on the data in this repository

The DSR rate data here is derived from the **publicly published CPWD Delhi Schedule
of Rates 2023** and is included so the app runs without a separate extraction step.

**Real tender documents are deliberately not included.** Award letters, signed bills
and schedules identify a named contracting agency and carry award-letter numbers,
site and JSC codes, and the contractor's quoted percentage below estimate —
commercially sensitive bid data. Those files were removed from this repository's
history, and the example agreement numbers, amounts and percentages that appear in
the documentation are **placeholders**. Some code comments still refer to the
reference workbooks the calculations were validated against; those files are not
shipped, and the app needs no sample data to run.

If you are working from this repo, put your own documents outside it or rely on the
`.gitignore` rules already in place.
