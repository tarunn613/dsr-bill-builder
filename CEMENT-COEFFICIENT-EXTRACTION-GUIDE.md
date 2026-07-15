# Cement-Coefficient Extraction Guide (DSR 2023 Vol 2)

> **For the executing agent.** This tells you exactly how to extract the
> **"Coefficients for Cement Consumption"** appendix from DSR 2023 Volume 2 into a
> correct, verified dataset. It is written for government tendering — **accuracy is
> non-negotiable**. Every fact below was verified against the actual PDF; the
> reference script was run and cross-checked. Follow the verification section and
> do not ship data until every acceptance test passes.
>
> Scope: **cement coefficients only** (this task). The same method extends to the
> Bitumen appendix that follows it, but that is out of scope here.

---

## 0. What you are producing

A lookup of **cement consumption per unit of work**, keyed by DSR item code:

```json
// cement_coeff.json
{
  "source": "DSR 2023 Vol 2 — Coefficients for Cement Consumption (PDF pp.306–384)",
  "count": <N>,
  "codes": {
    "4.1.3":  { "code": "4.1.3", "unit": "cum", "coeff": 3.20,
                "coeff_source": 3.20, "per": 1, "unit_source": "cum",
                "leaf_desc": "1:2:4 (1 cement : 2 coarse sand ... 20 mm nominal size)",
                "group_desc": "P/L cement concrete - all works upto plinth level :",
                "full_desc": "P/L cement concrete - all works upto plinth level : — 1:2:4 (...)",
                "source_page": 348 },
    "13.1.2": { "code": "13.1.2", "unit": "sqm", "coeff": 0.036,
                "coeff_source": 3.60, "per": 100, "unit_source": "100 sqm",
                "leaf_desc": "1:6 (1 cement : 6 fine sand)", "source_page": 350 },
    "...": { ... }
  }
}
```

`coeff` = **quantity of cement in Quintals per ONE unit** of that item (1 Quintal = 100 kg =
2 bags of 50 kg). Consumers compute `cement_qtl = qty × coeff`, `bags = cement_qtl × 2` — always
use `coeff`, never `coeff_source`.

**`coeff` vs `coeff_source`/`per` (critical — see §6.11).** Many items print their unit as
**"100 sqm" / "100 metre" / "10 Nos."**, meaning the printed coefficient is per *that many* units.
`coeff_source` is the verbatim printed value, `per` is the divisor (1/10/100), `unit_source` is the
printed unit ("100 sqm"), and **`coeff = coeff_source / per`** is the true per-unit figure the bill
must multiply by. Storing the printed 3.60 as if it were per-sqm over-counts cement **100×**.
The hand-made reference bill encodes the same thing by writing `3.60` with a **"/00"** note beside
it and dividing by 100.

Also load it into the SQLite DB as an authoritative table (see §7).

---

## 1. Source — verified facts (do not re-derive; these are confirmed)

| Fact | Value |
|---|---|
| File | `data/booklets/voll_2.pdf` (396 PDF pages) |
| Appendix title page | PDF page **304** ("COEFFICIENTS FOR CEMENT CONSUMPTION") |
| Coefficient tables | **even PDF pages 306, 308, 310 … 384** (39 pages) |
| Odd pages in that range | **blank** (no text layer) — iterate evens, or iterate all and skip empties |
| Printed page numbers | 347–386 (printed page = PDF page + 41; **ignore**, it's a header artifact) |
| **Hard stop** | PDF page **386** begins **"COEFFICIENTS FOR BITUMEN CONSUMPTION"** — a *different* appendix. **Do NOT extract page 386 or later as cement.** |
| Sub-heads (in order) | 3.0 Mortar · 4.0 Concrete · 5.0 RCC · 6.0 Masonry · 7.0 Stone · 8.0 Cladding · 9.0 Wood & PVC · 10.0 Steel · 11.0 Flooring · 12.0 Roofing · 13.0 Finishing · 14.0 Repairs · 16.0 Road · 17.0 Sanitary · 18.0 Water Supply · 19.0 Drainage · 20.0 Pile · 22.0 Water Proofing · 26.0 New Technologies |
| Expected entry count | **≈ 360–395** leaf coefficients (baseline extraction = 358; a clean run ≈ 375) |

**`page.find_tables()` returns nothing** on these pages (no ruled lines). Do **not**
rely on table detection. Use **word coordinates** (`page.get_text("words")`).

---

## 2. Page layout (what each page looks like)

Reading top to bottom, every table page is:

```
347                                                    ← printed page no. (SKIP)
COEFFICIENTS FOR CEMENT CONSUMPTION S.H. : 6.0 MASONRY WORK   ← running header (SKIP; may read sub-head from it)
1.0 COEFFICIENTS FOR CEMENT CONSUMPTION                 ← SKIP  (⚠ "1.0" looks like a code — exclude it)
6.0 MASONRY WORK                                        ← sub-head (SKIP or capture as chapter)
Code | No. | Description | Unit | Quantity of cement per unit quantity of work (Quintals)  ← column headers (SKIP)
6.1   Brick work in foundation & plinth with non modular bricks.       ← GROUP header: code + desc, NO unit, NO coeff
6.1.1 Cement mortar 1:4 (1 cement : 4 coarse sand)      cum   0.95     ← LEAF entry: code, desc, unit, coeff
6.1.2 Cement mortar 1:6 (1 cement : 6 coarse sand)      cum   0.625    ← LEAF entry
6.2   Brick work in foundation & plinth with modular bricks.          ← GROUP header
6.2.1 Cement mortar 1:4 ...                             cum   0.836
...
```

Two kinds of rows:
- **Group/section header** (e.g. `6.1`, `6.2`) — has a code + description but **no unit and no coefficient**. It is context only. Its description qualifies the leaf entries beneath it.
- **Leaf entry** (e.g. `6.1.1`, `6.1.2`) — has code + description + unit + coefficient. **These are what you emit.**

---

## 3. Column geometry (the reliable extraction key)

Word x-coordinates (x0), verified across concrete/RCC/masonry/sanitary pages:

| Column | x0 band | Notes |
|---|---|---|
| **Group code** | ≈ **58** | section headers like `6.1`, `4.1` sit far left |
| **Leaf code** | ≈ **117** | ⚠ leaf codes are **indented** — they overlap the description's left edge |
| **Description** | ≈ **140 – 375** | wide; **wraps across multiple lines** |
| **Unit** | ≈ **380 – 470** (≈386–396) | `cum`, `sqm`, `each`, `metre`, `kg`, `quintal` … |
| **Coefficient** | ≈ **> 470** (≈499–505) | the number in Quintals/unit |

**Two subtleties that break naïve parsers — handle both:**

1. **Leaf codes are indented to x≈117**, i.e. *left of the description body but not at the far-left margin*. So you cannot separate "code vs description" by x alone — **a code is identified by regex `^\d{1,2}(\.\d+)+[A-Za-z]?$` on the first token of a row, with x0 < ~130.**
2. **The unit and coefficient sit on a slightly different y** than the code's first text line (e.g. code baseline y=151, unit/coeff baseline y=153). If you cluster words into rows by *exact* y you will split them apart. **Cluster y with a tolerance of ≈ 4–5 px** so a code and its unit/coeff merge into one logical row, while a genuinely separate description continuation line (≈14–17 px away) stays separate.

---

## 4. Extraction algorithm

1. Open `voll_2.pdf`; iterate PDF pages **305…383 step 2** (0-based) → pages 306…384.
2. For each page, get `page.get_text("words")` → `(x0, y0, x1, y1, text, …)`.
3. **Cluster words into rows** by y with tolerance 4.5 px; sort each row by x0.
4. Walk rows top→bottom, maintaining `group_desc` (latest section header) and a
   `pending_leaf`:
   - Classify the row's first token: it is a **code** iff it matches the code
     regex **and** x0 < 130.
   - Within the row, bucket the remaining tokens: **unit** if x0∈[370,470) and the
     token is a known unit; **coefficient** if x0≥470 and it's numeric;
     **description** otherwise (x0∈[100,470)).
   - If the row starts a code **at x0<100 with no unit/coeff** → it's a **group
     header**: flush any pending leaf, set `group_desc = its description`.
   - If the row starts a code (leaf) → flush pending leaf, begin a new leaf
     `{code, leaf_desc, unit, coeff, group_desc, source_page}`.
   - If the row has **no code** → it's a continuation: append its description
     tokens to the pending leaf; fill unit/coeff if still empty.
   - **Flush** a leaf (emit it) when the next code appears or the page ends — but
     **only if it has a coefficient and a valid unit**.
5. Compose `full_desc = group_desc + " — " + leaf_desc` (see §6).
6. De-duplicate by code (a code should appear once; if it repeats, keep the first
   and log it — repeats usually mean a parse error).

### Reference implementation (validated — reproduced all known truths, 0 coeff
### disagreements vs the prior data on shared codes)

```python
import fitz, re, json

UNITS = {"cum","sqm","metre","rmt","each","kg","quintal","qtl","litre","tonne","no","nos"}
CODE  = re.compile(r'^\d{1,2}(?:\.\d+)+[A-Za-z]?$')     # 3.1, 4.1.3, 4.1.2A
NUM   = re.compile(r'^\d+(?:\.\d+)?$')
SKIP_DESC = ("COEFFICIENTS FOR CEMENT", "S.H.")         # header noise

def rows_of(page, tol=4.5):
    ws = sorted(page.get_text("words"), key=lambda w: (w[1], w[0]))
    rows, cur, cy = [], [], None
    for x0, y0, x1, y1, txt, *_ in ws:
        if cy is None or abs(y0 - cy) <= tol:
            cur.append((x0, txt)); cy = y0 if cy is None else cy
        else:
            rows.append(sorted(cur)); cur = [(x0, txt)]; cy = y0
    if cur: rows.append(sorted(cur))
    return rows

def extract_page(page, pageno):
    out, leaf, group = [], None, ""
    def flush():
        nonlocal leaf
        if leaf and leaf["coeff"] is not None and leaf["unit"] in UNITS \
           and 0 < leaf["coeff"] <= 15:
            out.append(leaf)
        leaf = None
    for row in rows_of(page):
        fx, ft = row[0]
        is_code = bool(CODE.match(ft)) and fx < 130 and ft != "1.0"
        unit = coeff = None; desc = []
        for x, t in row:
            if (x, t) == (fx, ft) and is_code:      # skip the code token itself
                continue
            tl = t.strip().lower().rstrip(".")
            if 370 <= x < 470 and tl in UNITS:      unit = tl
            elif x >= 470 and NUM.match(t):         coeff = float(t)
            elif 100 <= x < 470:                    desc.append(t)
        if is_code:
            flush()
            if fx < 100 and unit is None and coeff is None:      # group header
                d = " ".join(desc).strip()
                group = "" if any(s in d for s in SKIP_DESC) else d
            else:                                                 # leaf entry
                leaf = {"code": ft, "leaf_desc": " ".join(desc).strip(),
                        "unit": unit, "coeff": coeff, "group_desc": group,
                        "source_page": pageno}
        elif leaf is not None:
            if desc:  leaf["leaf_desc"] = (leaf["leaf_desc"] + " " + " ".join(desc)).strip()
            if unit and not leaf["unit"]:  leaf["unit"] = unit
            if coeff is not None and leaf["coeff"] is None:  leaf["coeff"] = coeff
    flush()
    return out

doc = fitz.open("data/booklets/voll_2.pdf")
rows = []
for p in range(305, 384, 2):                 # even PDF pages 306..384
    rows += extract_page(doc[p], p + 1)
doc.close()

codes = {}
for r in rows:
    r["full_desc"] = (r["group_desc"] + " — " + r["leaf_desc"]).strip(" —") \
                     if r["group_desc"] else r["leaf_desc"]
    if r["code"] in codes:
        print("WARN duplicate code:", r["code"], "p", r["source_page"])
    codes.setdefault(r["code"], r)

json.dump({"source": "DSR 2023 Vol 2 — Coefficients for Cement Consumption (PDF pp.306-384)",
           "count": len(codes), "codes": codes},
          open("cement_coeff.json", "w"), indent=1, ensure_ascii=False)
print("emitted", len(codes), "codes")
```

> The reference run emits ≈ 375–395 codes. It is a **starting point, not gospel** —
> §6 pitfalls and §5 verification are what guarantee correctness.

---

## 5. Verification — MUST all pass before shipping

Run every check. If any fails, fix the parser and re-run.

**A. Known-truth spot check (hard-coded; these are confirmed correct):**
```
3.1=10.20  3.2=6.80  3.3=5.10  3.4=3.80  3.5=3.10  3.6=2.50  3.7=6.80  3.8=5.10
4.1.3=3.20   6.1.1=0.95   6.1.2=0.625   6.2.1=0.836   6.2.2=0.55   6.3.1=0.625
```
Every one of these codes must be present with exactly that coefficient.

**B. Structural sanity:**
- Every key matches `^\d{1,2}(\.\d+)+[A-Za-z]?$` (no bare chapter numbers, no `"1.0"`).
- Every entry has `unit ∈ {cum, sqm, metre, each, kg, quintal, …}` and `0 < coeff ≤ 15`
  — check the **effective** `coeff`, not `coeff_source` (§6.13).
- **Zero** entries whose `leaf_desc` contains "COEFFICIENTS" or "S.H." (header leakage).
- No duplicate codes.
- Count is in **[355, 550]**. Far outside → parser broke. (Current run: **510**.)

**C. Cross-check against the priced-rate DB (`dsr_items.json`):** the appendix codes
**are the same codes** as the priced items (verified: 3.1, 4.1.3, 6.1.1, 6.1.2 all
match by code, unit, and item). So:
- Join `codes` to the rate DB by exact code. **≈ 77 %** must join (≈ 275 of ~358).
  A dramatically lower join rate means you invented/garbled codes.
- For **joined** codes, the **unit must equal** the rate-item unit (cum=cum, etc.).
  Any unit mismatch is a parse error — investigate it.
- The **non-joiners (~23 %)** are mostly legitimate: letter-suffix variants
  (`4.1.6B`, `4.9A`, `5.8A`) and coefficient-only codes (`5.48`, `6.26`…). Skim the
  list; they should look like real DSR sub-codes, **not** like `1.5m`, `0.56m`,
  `1.0`, or description fragments (those are false positives — remove them).

**D. Regression vs the existing baseline** (`schedule-builder/backend/data/cement_coeff.json`):
the check is **scale-aware** — on codes present in **both**, the ONLY permitted movement is a
clean `/per` rescale (new `coeff == old/per` and new `coeff_source == old`); **any other change
FAILS the build and refuses to write the JSON/DB**. Newly recovered codes show up as "Gained".
This is the highest-value check in the file: it caught a real 4-code regression (§6.12) that every
other check passed. Investigate every unexpected diff — one of the two is wrong.

**E. Eyeball 10 random entries** against the PDF (open the `source_page`, find the
code, confirm description/unit/coeff). Especially check one from each of: mortar,
concrete, RCC, masonry, sanitary (unit `each`), flooring (`sqm`), steel (`kg`).

---

## 6. Known pitfalls (real failure modes seen in this appendix)

1. **`"1.0"` header false-positive** — the line `1.0 COEFFICIENTS FOR CEMENT
   CONSUMPTION` on every page. `1.0` matches the code regex. **Explicitly exclude
   `"1.0"`** and any row whose description contains "COEFFICIENTS"/"S.H.".
2. **Dimension tokens masquerading as codes** — `1.5m`, `0.56m`, `1.22m`, `1.67m`
   appear inside descriptions and match `^\d+\.\d+[A-Za-z]$`. Defeat this by
   requiring a code token to be the **first token** of the row **and x0 < 130**
   (dimensions sit deep in the description, x0 > 140).
3. **Leaf-code indentation (x≈117)** — do **not** treat "first token at x>100" as
   description; check the regex first. (§3)
4. **Unit/coeff on a different y-line than the code** — cluster y with ~4.5 px
   tolerance or you will drop every coefficient. (§3)
5. **Multi-line descriptions** — concrete/RCC descriptions span 2–4 lines; keep
   appending description-column tokens until the next code.
6. **Group headers have no coefficient** — never emit them as entries; use them
   only to build `full_desc`. Emitting them (with a null/0 coeff) corrupts the set.
7. **Letter-suffix codes are real** — `4.1.2A`, `4.1.3A` (RCA variants). Keep the
   suffix; it distinguishes them from the base code.
8. **Bitumen boundary** — stop at PDF page 384. Page 386+ is the Bitumen appendix
   with identical layout; extracting it as cement is a silent, serious error.
9. **Blank odd pages** — 305, 307, … have no text; skip gracefully.
10. **Precision** — keep coefficients as given (e.g. `0.625`, `0.836`); don't round.
    Store the float; if you also keep the raw string, verify `float(raw)==coeff`.
11. **Unit scale — the 100× trap (worst bug found; fixed 2026-07-15).** ~158 of 510 rows print
    the unit as **"100 sqm" / "100 metre" / "10 Nos."**: an integer at x≈367–382 sitting
    immediately LEFT of the unit word (x≈386–400), with the coefficient per *that many* units
    (`13.1.2 … 100 sqm 3.60` = 0.036/sqm). Do **not** dismiss that "100" as a page artifact — an
    earlier `is_sentinel_100()` did exactly that and over-counted cement 100× on every
    plaster/pointing/pipe/finishing item. **Rule: a scale is an integer 10/100/1000 in the unit
    band that is left of a unit word ON THE SAME ROW.** The "same row as the unit" clause is
    load-bearing: mix-ratio digits (the `10` of `1:5:10`, x≈355, on a no-unit *continuation* line)
    sit in a similar x range and would otherwise turn concrete `4.1.10A` from 1.3/cum into 0.13.
    Store `coeff_source`, `per`, `unit_source` alongside the divided `coeff` so it stays auditable.
12. **Asterisked coefficients = a DIFFERENT material or a per-page footnote — never strip the
    marker.** The coeff column can carry TWO components: `8.11` prints `8.16 + 3.30*` = ordinary
    cement **+ white cement**; `3.15` ("White cement mortar 1:2") is a lone `6.80*`; `5.18.x` is
    `1.64**` whose legend reads "** Cement for fixing only" (the hand-made bill *does* count that
    one); `20.5.x` pile work also uses a single `*`. **Legends are page-specific — there is no
    global meaning.** `NUM` rejects `3.30*` naturally; stripping the `*` lets the white-cement
    value overwrite the real coefficient (this regressed `7.29`/`8.1`/`8.11`/`8.14` and was caught
    only by check D). ~31 such values are deliberately left unextracted pending a domain decision.
13. **Range-check the EFFECTIVE coeff, not the printed one.** A per-100 row legitimately prints up
    to 58.6 (`19.2.5` = 31.72 per 100 metre = 0.3172/metre), so a `0 < raw <= 15` gate silently
    dropped 19 real codes (`19.2.1-5`, `19.3.3-5`, `13.15`, `13.72`, `26.33/34/38/46/47`). Gate
    `0 < coeff_source/per <= 15`. Sanity-check recoveries as proportional series against their
    neighbours (`26.34`: 50mm=16.5, 75mm=24.75=1.5×, 100mm=33.0=2×).
14. **`&` paired codes (12 rows, still unhandled).** The appendix merges two codes into one entry:
    `6.12.1 &` on one line, then `6.13.1  100 sqm  14.28` on the next — the description belongs to
    the first, the coefficient to the second, and **both codes share it**. Also inline
    (`7.1 & 7.2 … cum 0.825`, `11.39 & …` whose partner is `11.40`). Current parser keeps only the
    coefficient-bearing code and leaves its `leaf_desc` **empty** — an empty `leaf_desc` is the
    tell-tale of this pattern.

---

## 7. Where the data goes (integrate like Phase 1)

Treat coefficients as **authoritative DSR data**, same discipline as the rate DB:

1. **SQLite** — add a table to `dsr_database.db`:
   ```sql
   CREATE TABLE cement_coeff (
     code TEXT PRIMARY KEY, unit TEXT, coeff REAL,
     leaf_desc TEXT, group_desc TEXT, full_desc TEXT, source_page INTEGER
   );
   ```
2. **JSON export** — mirror `export_dsr_json.py`: write
   `schedule-builder/backend/data/cement_coeff.json` (shape in §0). The app already
   expects `{ "codes": { <code>: {description, unit, coeff} } }`, so include at
   least `unit`, `coeff`, and a `description` (use `full_desc`).
3. Commit a short **provenance note**: source pages, extraction date, entry count,
   and the verification results (§5 A–E) so the data is auditable.

**How consumers should match a schedule item to a coefficient (important):**
- **Primary:** exact **code** join (schedule item `ref` == coefficient `code`).
  Works for ~77 % of coefficient codes.
- **Fallback (for the ~23 % and for schedule items whose code isn't in the
  appendix):** match by **mix/spec in the description** (e.g. "1:2:4", "1:6",
  "1:1½:3") — the coefficients are per mortar/concrete mix, so the ratio is the
  discriminator. Keep `full_desc` so this fallback is possible.
- Always allow a **manual override** per line (cement coefficients occasionally
  need engineer judgement).

---

## 8. Quick start for the executing agent

```
1. Read §1–§3 (facts, layout, geometry). Do not skip §3's two subtleties.
2. Run the §4 reference script from the project root (needs PyMuPDF: `pip install pymupdf`).
3. Run ALL of §5 (A–E). Fix the parser until every check passes. Pay special
   attention to §6.1 / §6.2 false positives and §6.8 the bitumen boundary.
4. Load into SQLite + JSON per §7, with a provenance note.
5. Report: final count, known-truth check result, join-rate %, and any codes you
   deliberately excluded and why.
```

**Golden numbers to hit:** all 14 known truths in §5A correct · count 355–400 ·
~77 % join to the rate DB · 0 coeff disagreements with the baseline on shared codes ·
0 header/dimension false positives.
```
