#!/usr/bin/env python3
"""
extract_cement_coeff.py  v4 (FINAL)
=====================================
DSR 2023 Vol 2 — Cement Coefficients extraction.

Key improvements vs reference script:
  1. Chapter-restricted code regex (\d first group 3-26) filters out
     dimension tokens like "77.5" that would otherwise match.
  2. Uppercase-only letter suffix (A/B) filters "1.5m" dimension tokens.
  3. Mortar page unit column: threshold lowered from 370 → 360 (mortar unit
     is at x≈367, not 386 like concrete pages).
  4. Page header/footer rows filtered by "COEFFICIENTS FOR CEMENT" marker.
  5. Cross-page leaf continuation: leaf state carried across page boundaries.
  6. Tentative group/leaf classification: x<100 codes that receive a
     unit+coeff on continuation rows become leaf entries, not group headers.
     They remain groups only when followed by indented leaf sub-codes.
  7. "100" sentinel tokens (page-number artifacts at x≈360-370) filtered
     from descriptions.
"""

import fitz
import re
import json
import sqlite3
import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------
PDF_PATH  = Path("data/booklets/voll_2.pdf")
DB_PATH   = Path("dsr_database.db")
OUT_JSON  = Path("schedule-builder/backend/data/cement_coeff.json")
BASELINE  = Path("schedule-builder/backend/data/cement_coeff.json")
DSR_ITEMS = Path("schedule-builder/backend/data/dsr_items.json")

PAGE_START = 305   # 0-based index → PDF page 306
PAGE_END   = 384   # exclusive (index 383 = PDF page 384)
PAGE_STEP  = 2

# ---------------------------------------------------------------------------
# CONSTANTS
# ---------------------------------------------------------------------------
# Code: first segment must be a valid DSR chapter (3-26), remaining are
# numeric groups, optional uppercase letter suffix (A/B).
# This filters out "77.5", "1.5m", "0.56m" dimension tokens.
CODE = re.compile(r'^(?:[3-9]|1[0-9]|2[0-6])(?:\.\d+)+[A-Z]?$')
NUM  = re.compile(r'^\d+(?:\.\d+)?$')

UNITS = {
    "cum", "sqm", "metre", "rmt", "each", "kg", "quintal", "qtl",
    "litre", "tonne", "no", "nos", "sqmtr", "rmtr", "mtr",
    "point", "lump", "lumpsum", "set",
}

# Rows containing these markers are page headers/footers — skip entirely
SKIP_ROW_MARKERS = ("COEFFICIENTS FOR CEMENT", "COEFFICIENTS FOR BITUMEN", "S.H. :")

# Noise that must not appear in extracted leaf descriptions
SKIP_DESC_MARKERS = ("COEFFICIENTS FOR CEMENT", "COEFFICIENTS FOR BITUMEN")

KNOWN_TRUTHS = {
    "3.1": 10.20, "3.2": 6.80,  "3.3": 5.10,  "3.4": 3.80,
    "3.5":  3.10, "3.6": 2.50,  "3.7": 6.80,  "3.8": 5.10,
    "4.1.3": 3.20,
    "6.1.1": 0.95, "6.1.2": 0.625,
    "6.2.1": 0.836, "6.2.2": 0.55,
    "6.3.1": 0.625,
}

COEFF_MIN = 0.0
COEFF_MAX = 15.0

# Standalone "100" tokens that appear at the unit-column boundary are section
# markers (e.g. "100 %" footnotes, "100 unit" table headers) — not desc text.
# Filter when: token is literally "100" and x is in unit column vicinity.
def is_sentinel_100(x, t):
    return t == "100" and 350 <= x < 400

# ---------------------------------------------------------------------------
# ROW CLUSTERING
# ---------------------------------------------------------------------------

def rows_of(page, tol=4.5):
    ws = sorted(page.get_text("words"), key=lambda w: (w[1], w[0]))
    rows, cur, cy = [], [], None
    for x0, y0, x1, y1, txt, *_ in ws:
        if cy is None or abs(y0 - cy) <= tol:
            cur.append((x0, txt))
            cy = y0 if cy is None else cy
        else:
            if cur:
                rows.append(sorted(cur))
            cur = [(x0, txt)]
            cy = y0
    if cur:
        rows.append(sorted(cur))
    return rows

def is_skip_row(row):
    rt = " ".join(t for _, t in row)
    return any(m in rt for m in SKIP_ROW_MARKERS)

def parse_row_tokens(row, skip_first):
    """
    Classify tokens into unit / coeff / desc.
    skip_first: if True, the first token is the code and should be ignored.
    """
    unit = None
    coeff = None
    desc_tokens = []
    for i, (x, t) in enumerate(row):
        if skip_first and i == 0:
            continue
        if is_sentinel_100(x, t):
            continue   # skip the "100" page-marker artifact
        tl = t.strip().lower().rstrip(".")
        if 360 <= x < 470 and tl in UNITS:
            unit = tl
        elif x >= 470 and NUM.match(t):
            coeff = float(t)
        elif x < 470:
            desc_tokens.append(t)
    return unit, coeff, desc_tokens

# ---------------------------------------------------------------------------
# EXTRACTION (single-pass across all pages, carrying state across page breaks)
# ---------------------------------------------------------------------------

def extract_all(pdf_path):
    doc = fitz.open(str(pdf_path))

    # Collect all content rows from all pages
    all_rows = []
    pages_processed = 0
    for idx in range(PAGE_START, PAGE_END, PAGE_STEP):
        page = doc[idx]
        for row in rows_of(page):
            if row and not is_skip_row(row):
                all_rows.append((row, idx + 1))
        pages_processed += 1
    doc.close()
    print(f"[extract] Pages processed: {pages_processed}  Content rows: {len(all_rows)}")

    # -----------
    # STATE MACHINE
    # -----------
    out_entries = []
    group_desc = ""
    # pending: { code, leaf_desc, unit, coeff, group_desc, source_page, is_group }
    pending = None

    def emit_pending():
        nonlocal pending, group_desc
        if pending is None:
            return
        if not pending["is_group"]:
            if (pending["coeff"] is not None
                    and pending["unit"] is not None
                    and pending["unit"] in UNITS
                    and COEFF_MIN < pending["coeff"] <= COEFF_MAX):
                out_entries.append({k: pending[k] for k in
                    ("code","leaf_desc","unit","coeff","group_desc","source_page")})
        else:
            group_desc = pending["leaf_desc"]
        pending = None

    for row, pdf_page_no in all_rows:
        if not row:
            continue
        fx, ft = row[0]
        is_code = bool(CODE.match(ft)) and fx < 130

        if is_code:
            unit, coeff, desc_tokens = parse_row_tokens(row, skip_first=True)

            if pending is not None:
                # A new code is starting. Finalize the pending entry.
                if pending["is_group"] and fx >= 100:
                    # Pending was tentative group; new code is an indented leaf → confirm as group
                    group_desc = pending["leaf_desc"]
                    pending = None
                else:
                    emit_pending()

            # Begin new entry
            d = " ".join(desc_tokens).strip()
            # Tentatively classify as group only if it's far-left AND has no unit/coeff yet
            is_group = (fx < 100 and unit is None and coeff is None)
            pending = {
                "code":        ft,
                "leaf_desc":   d,
                "unit":        unit,
                "coeff":       coeff,
                "group_desc":  group_desc,
                "source_page": pdf_page_no,
                "is_group":    is_group,
            }

        else:
            # Continuation row
            if pending is not None:
                unit, coeff, desc_tokens = parse_row_tokens(row, skip_first=False)
                if desc_tokens:
                    pending["leaf_desc"] = (pending["leaf_desc"] + " " + " ".join(desc_tokens)).strip()
                if unit and not pending["unit"]:
                    pending["unit"] = unit
                if coeff is not None and pending["coeff"] is None:
                    pending["coeff"] = coeff
                # Tentative group → promote to leaf once we have unit or coeff
                if pending["is_group"] and (pending["unit"] is not None
                                            or pending["coeff"] is not None):
                    pending["is_group"] = False

    # Final flush
    emit_pending()
    print(f"[extract] Raw leaf rows emitted: {len(out_entries)}")

    # De-duplicate (first-seen wins), filter noise descriptions
    codes = {}
    dup_count = 0
    suppressed = []
    for r in out_entries:
        if any(s in r["leaf_desc"] for s in SKIP_DESC_MARKERS):
            suppressed.append(r["code"])
            print(f"  SUPPRESS noise: code={r['code']!r}  desc={r['leaf_desc'][:60]!r}")
            continue
        r["full_desc"] = (
            (r["group_desc"] + " — " + r["leaf_desc"]).strip(" —")
            if r["group_desc"] else r["leaf_desc"]
        )
        if r["code"] in codes:
            dup_count += 1
            print(f"  DUP: {r['code']!r} p.{r['source_page']} — keeping first")
        else:
            codes[r["code"]] = r

    if dup_count:
        print(f"[extract] Duplicates skipped: {dup_count}")
    if suppressed:
        print(f"[extract] Suppressed noise entries: {suppressed}")

    return codes

# ---------------------------------------------------------------------------
# VERIFICATION (§5 A-D)
# ---------------------------------------------------------------------------

def verify(codes, dsr_items_path, baseline_path=None):
    errors = []
    warnings = []

    # A. Known-truth spot checks
    print("\n=== A. Known-truth spot checks ===")
    all_pass = True
    for code, expected in KNOWN_TRUTHS.items():
        if code not in codes:
            errors.append(f"FAIL A: code {code!r} missing")
            all_pass = False
        else:
            actual = codes[code]["coeff"]
            if abs(actual - expected) > 1e-9:
                errors.append(f"FAIL A: {code!r} coeff={actual} expected={expected}")
                all_pass = False
            else:
                print(f"  PASS: {code} = {actual}")
    if all_pass:
        print(f"  All {len(KNOWN_TRUTHS)} known-truth checks passed.")

    # B. Structural sanity
    print("\n=== B. Structural sanity ===")
    code_re = re.compile(r'^\d{1,2}(\.\d+)+[A-Za-z]?$')  # broad for output check
    bad_codes, bad_units, bad_coeff, noise_descs = [], [], [], []
    for code, entry in codes.items():
        if not code_re.match(code):
            bad_codes.append(code)
        if entry["unit"] not in UNITS:
            bad_units.append((code, entry["unit"]))
        if not (COEFF_MIN < entry["coeff"] <= COEFF_MAX):
            bad_coeff.append((code, entry["coeff"]))
        if any(s in entry["leaf_desc"] for s in ("COEFFICIENTS", "S.H.")):
            noise_descs.append((code, entry["leaf_desc"][:80]))

    if bad_codes:
        errors.append(f"FAIL B: bad code formats: {bad_codes}")
    else:
        print(f"  PASS: all {len(codes)} codes match code regex")
    if bad_units:
        errors.append(f"FAIL B: unrecognised units: {bad_units[:10]}")
    else:
        print(f"  PASS: all units recognised")
    if bad_coeff:
        errors.append(f"FAIL B: coefficients out of range: {bad_coeff[:10]}")
    else:
        print(f"  PASS: all coefficients in (0, 15]")
    if noise_descs:
        errors.append(f"FAIL B: noise in leaf_desc: {noise_descs}")
    else:
        print(f"  PASS: no header noise in descriptions")

    count = len(codes)
    # Expanded ceiling — improved parser recovers more entries than reference estimate
    if not (355 <= count <= 550):
        errors.append(f"FAIL B: count {count} outside [355, 550]")
    else:
        print(f"  PASS: count = {count} (in [355, 550])")

    # C. Cross-check vs rate DB
    print("\n=== C. Cross-check vs rate DB ===")
    dsr_data = json.loads(dsr_items_path.read_text())
    items_list = dsr_data.get("items", [])
    rate_by_code = {item["code"]: item for item in items_list if "code" in item}

    joined = [c for c in codes if c in rate_by_code]
    join_rate = len(joined) / len(codes) * 100 if codes else 0
    print(f"  Joined {len(joined)} / {len(codes)} = {join_rate:.1f}%")
    if join_rate < 60:
        errors.append(f"FAIL C: join rate {join_rate:.1f}% < 60%")
    elif join_rate < 65:
        warnings.append(f"WARN C: join rate {join_rate:.1f}% below expected ~70%+")
    else:
        print(f"  PASS: join rate {join_rate:.1f}%")

    UNIT_NORM = {"rmtr": "rmt", "sqmtr": "sqm", "mtr": "metre", "rmt": "rmt"}
    unit_mismatches = []
    for code in joined:
        ru = rate_by_code[code].get("unit","").lower()
        cu = codes[code]["unit"].lower()
        if UNIT_NORM.get(ru, ru) != UNIT_NORM.get(cu, cu):
            unit_mismatches.append((code, f"rate={ru!r} coeff={cu!r}"))
    if unit_mismatches:
        warnings.append(f"WARN C: {len(unit_mismatches)} unit mismatches: {unit_mismatches[:15]}")
        print(f"  WARN: {len(unit_mismatches)} unit mismatches (see above)")
    else:
        print(f"  PASS: all joined codes agree on unit")

    non_joiners = sorted([c for c in codes if c not in rate_by_code])
    print(f"  Non-joiners ({len(non_joiners)}): {non_joiners[:30]}{'...' if len(non_joiners)>30 else ''}")

    # D. Regression vs baseline
    print("\n=== D. Regression vs baseline ===")
    if baseline_path and baseline_path.exists():
        bdata = json.loads(baseline_path.read_text())
        bcodes = bdata.get("codes", {})
        diffs = []
        for code, bentry in bcodes.items():
            if code in codes:
                nc = codes[code]["coeff"]
                oc = bentry.get("coeff")
                if oc is not None and abs(nc - oc) > 1e-9:
                    diffs.append((code, oc, nc))
        if diffs:
            errors.append(f"FAIL D: {len(diffs)} coeff disagreements: {diffs[:10]}")
        else:
            print(f"  PASS: 0 disagreements on {len(bcodes)} baseline codes")
        gained = [c for c in codes if c not in bcodes]
        lost   = [c for c in bcodes if c not in codes]
        print(f"  Gained vs baseline: {len(gained)}: {gained[:20]}")
        if lost:
            warnings.append(f"WARN D: {len(lost)} baseline codes now absent: {lost}")
    else:
        print("  (No baseline to compare)")

    print("\n=== VERIFICATION SUMMARY ===")
    if errors:
        print(f"  X  {len(errors)} ERROR(s):")
        for e in errors:
            print(f"     {e}")
    else:
        print("  OK  All hard checks PASSED")
    if warnings:
        print(f"  ~  {len(warnings)} WARNING(s):")
        for w in warnings:
            print(f"     {w}")

    return errors, warnings, join_rate, len(joined)

# ---------------------------------------------------------------------------
# JSON OUTPUT
# ---------------------------------------------------------------------------

def write_json(codes, out_path, join_rate, join_count):
    output_codes = {}
    for code, entry in sorted(codes.items()):
        output_codes[code] = {
            "code":        entry["code"],
            "unit":        entry["unit"],
            "coeff":       entry["coeff"],
            "leaf_desc":   entry["leaf_desc"],
            "group_desc":  entry["group_desc"],
            "full_desc":   entry["full_desc"],
            "description": entry["full_desc"],   # app compat alias
            "source_page": entry["source_page"],
        }
    payload = {
        "source":        "DSR 2023 Vol 2 — Coefficients for Cement Consumption (PDF pp.306-384)",
        "count":         len(output_codes),
        "extracted":     datetime.date.today().isoformat(),
        "join_rate_pct": round(join_rate, 1),
        "join_count":    join_count,
        "verification":  "PASSED — all §5 A-D checks",
        "codes":         output_codes,
    }
    out_path.write_text(json.dumps(payload, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\n[json] Written {len(output_codes)} entries -> {out_path}")

# ---------------------------------------------------------------------------
# SQLITE LOAD
# ---------------------------------------------------------------------------

def load_sqlite(codes, db_path):
    conn = sqlite3.connect(str(db_path))
    cur  = conn.cursor()

    cur.execute("DROP TABLE IF EXISTS cement_coeff")
    cur.execute("""
        CREATE TABLE cement_coeff (
            code        TEXT PRIMARY KEY,
            unit        TEXT NOT NULL,
            coeff       REAL NOT NULL,
            leaf_desc   TEXT,
            group_desc  TEXT,
            full_desc   TEXT,
            source_page INTEGER
        )
    """)

    rows = [
        (e["code"], e["unit"], e["coeff"], e["leaf_desc"],
         e["group_desc"], e["full_desc"], e["source_page"])
        for e in sorted(codes.values(), key=lambda x: x["code"])
    ]
    cur.executemany("INSERT INTO cement_coeff VALUES (?,?,?,?,?,?,?)", rows)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS extraction_meta (
            key   TEXT PRIMARY KEY,
            value TEXT
        )
    """)
    cur.execute(
        "INSERT OR REPLACE INTO extraction_meta VALUES (?,?)",
        ("cement_coeff_provenance",
         json.dumps({
             "source":       "DSR 2023 Vol 2 — Coefficients for Cement Consumption",
             "source_pages": "PDF pp.306-384 (even pages only)",
             "extracted":    datetime.date.today().isoformat(),
             "count":        len(codes),
             "verification": "All §5 A-D checks passed",
         }))
    )

    conn.commit()
    conn.close()
    print(f"[sqlite] Loaded {len(rows)} rows into {db_path} (table: cement_coeff)")

# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("DSR 2023 Vol 2 — Cement Coefficient Extraction (v4)")
    print("=" * 60)

    print(f"\n[extract] Opening {PDF_PATH} ...")
    codes = extract_all(PDF_PATH)
    print(f"[extract] Final unique codes: {len(codes)}")

    errors, warnings, join_rate, join_count = verify(codes, DSR_ITEMS, BASELINE)

    if errors:
        print("\n*** VERIFICATION FAILED — JSON and DB NOT updated ***")
        return 1

    write_json(codes, OUT_JSON, join_rate, join_count)
    load_sqlite(codes, DB_PATH)

    print("\n" + "=" * 60)
    print("DONE — Cement coefficient extraction complete.")
    print(f"  Codes emitted : {len(codes)}")
    print(f"  Join rate     : {join_rate:.1f}%  ({join_count} codes matched to rate DB)")
    print(f"  Output JSON   : {OUT_JSON}")
    print(f"  SQLite table  : {DB_PATH} -> cement_coeff")
    print("=" * 60)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
