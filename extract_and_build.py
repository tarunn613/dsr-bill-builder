"""
DSR Data Extraction Pipeline v3
================================
Extracts all items from DSR 2023 Vol 1 & Vol 2 PDFs into SQLite + Excel.

Handles:
1. Standard portrait pages (Code, Description, Unit, Rate) via pdfplumber
2. Rotated/landscape carriage pages — 8 distance columns (1.1.x) via PyMuPDF
3. Horizontal carriage pages — 2/1 rate columns (1.2.x/1.3/1.4.x) via PyMuPDF coords
4. Hindi page filtering (skips Devanagari text)
5. Hierarchical parent-child description inheritance (e.g., 13.73 -> 13.73.1)
6. Codes up to 4 levels deep (e.g., 4.20.1.3)

v3 fixes (data-integrity, for government tendering):
  FIX-1  Exclude the "COEFFICIENTS FOR CEMENT/BITUMEN CONSUMPTION" appendix
         (Vol 2 pp.305-393). Those tables share the code+desc+number shape of
         the rate tables but the trailing number is a *consumption coefficient*
         (quintals per 100 sqm), NOT a rate. Previously ingested as fake items.
  FIX-2  Provenance + safe de-dup. Every row carries `volume` and `source_page`.
         De-dup key is (volume, code) so Vol-1 and Vol-2 items with the same
         chapter number are no longer collapsed into one. Any remaining
         (volume, code) collision with DISAGREEING rate is reported as a
         CONFLICT (never silently dropped).
  FIX-3  Unit regex no longer swallows trailing description numbers. The numeric
         multiplier is restricted to a known set {10,100,1000,10000}, so
         "as per IS - 3989 each 705.20" -> unit "each", desc keeps "3989"
         (was: unit "3989 each", desc truncated to "IS -").
  FIX-4  Carriage coverage: the 1.2.x (manual/mechanical) and 1.3/1.4.x
         (loading/unloading) carriage items on horizontal pages are now
         extracted with correct, per-page-detected rate columns.
  FIX-5  Description double-concatenation removed. Parent nodes now store their
         OWN text; the leaf builder walks the ancestor chain once.
"""

import pdfplumber
import fitz  # PyMuPDF
import re
import json
import sqlite3
import pandas as pd
import os


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def is_hindi(text):
    """Detect Hindi/Devanagari pages by counting Devanagari characters."""
    devanagari_count = sum(1 for char in text if 'ऀ' <= char <= 'ॿ')
    return devanagari_count > 20


# FIX-1: markers that uniquely identify the cement/bitumen consumption appendix.
# These strings never appear on real rate pages (verified against both volumes:
# Vol 1 matches only its Contents page; Vol 2 matches Contents + pp.305-393).
_COEFF_MARKERS = (
    "COEFFICIENTS FOR CEMENT CONSUMPTION",
    "COEFFICIENTS FOR BITUMEN CONSUMPTION",
    "Quantity of cement",
    "Quantity of bitumen",
)


def is_coefficient_page(text):
    """True if the page is part of the material-consumption coefficient appendix."""
    return any(marker in text for marker in _COEFF_MARKERS)


def is_valid_dotted_code(code):
    """Reject dotted 'codes' that are really measurements on a wrapped line.

    Real DSR dotted codes: chapter 1..30, and no non-chapter segment has a
    leading zero. This rejects '0.075' (chapter 0) and '5.00' (segment '00'),
    which are values like '0.075 mm' that happened to start a wrapped line.
    Recovering these also restores the parent item's real rate, which the old
    parser dropped when it mistook the wrapped line for a new code.
    """
    # Allow an optional single trailing letter suffix (e.g. '4.1.10A', '17.7A').
    core = code[:-1] if code[-1:].isalpha() else code
    segs = core.split('.')
    if not segs[0].isdigit() or (len(segs[0]) > 1 and segs[0].startswith('0')):
        return False
    if not (1 <= int(segs[0]) <= 30):
        return False
    for s in segs[1:]:
        if not s.isdigit():
            return False
        if len(s) > 1 and s.startswith('0'):
            return False
    return True


def get_parent_code(code):
    """Get the parent code by stripping the last segment.
    e.g., '13.73.1' -> '13.73', '4.20.1.3' -> '4.20.1'
    """
    parts = code.rsplit('.', 1)
    if len(parts) > 1:
        return parts[0]
    return None


def build_full_description(code, own_desc, parent_descriptions):
    """Build the full description by walking up the parent chain.

    parent_descriptions maps a parent code -> its OWN description only (FIX-5),
    so each ancestor contributes its text exactly once.
    """
    ancestors = []
    current = get_parent_code(code)
    while current:
        if current in parent_descriptions:
            ancestors.append(parent_descriptions[current])
        current = get_parent_code(current)

    # Reverse so we go from top-level ancestor down
    ancestors.reverse()

    if ancestors:
        full = ' '.join(ancestors)
        if own_desc:
            full = full + ' ' + own_desc
        return full
    return own_desc


# ============================================================================
# PHASE 1: CARRIAGE PAGES (Rotated/Landscape, 8 distance columns) — PyMuPDF
# ============================================================================

DISTANCE_KEYS = ["1km", "2km", "3km", "4km", "5km",
                 "beyond_5km_upto_10km_per_km",
                 "beyond_10km_upto_20km_per_km",
                 "beyond_20km_addl_per_km"]

_carriage_code_re = re.compile(r'^\d{1,2}\.\d{1,2}(?:\.\d{1,3})*$')
_carriage_rate_re = re.compile(r'^[\d,]+\.\d{2}$')


def _parse_carriage_block(block_lines):
    """Parse a single block from a rotated carriage page (8 distance columns)."""
    if not block_lines:
        return None

    code = block_lines[0].strip()
    if not _carriage_code_re.match(code):
        return None

    desc_parts = []
    unit = ''
    rates = []

    for i in range(1, len(block_lines)):
        text = block_lines[i].strip()
        if _carriage_rate_re.match(text):
            rates.append(text)
        elif re.match(r'^\d*\s*(m|cum|tonne|Nos|qtl|each|kg|litre|sq\.?m|sqm)$', text):
            unit = text
        else:
            desc_parts.append(text)

    description = ' '.join(desc_parts)

    rate_json = {}
    for ki, key in enumerate(DISTANCE_KEYS):
        if ki < len(rates):
            rate_json[key] = rates[ki]

    return {
        'code': code,
        'description': description,
        'unit': unit,
        'rate': json.dumps(rate_json) if rate_json else ''
    }


def extract_carriage_items(pdf_path):
    """Extract rotated carriage pages (1.1.x, 8 distance columns) using PyMuPDF."""
    print(f"  [PyMuPDF] Scanning for rotated carriage pages...")
    doc = fitz.open(pdf_path)
    items = []
    carriage_page_indices = set()

    for page_idx in range(len(doc)):
        page = doc[page_idx]
        data = page.get_text("dict")

        # Check if page has rotated text blocks
        has_rotated = False
        for block in data['blocks']:
            if block.get('type') != 0:
                continue
            for line in block.get('lines', []):
                direction = line.get('dir', (1, 0))
                if abs(direction[0]) < 0.1 and abs(direction[1]) > 0.9:
                    has_rotated = True
                    break
            if has_rotated:
                break

        if not has_rotated:
            continue

        # Parse rotated blocks as carriage items
        page_items = []
        for block in data['blocks']:
            if block.get('type') != 0:
                continue

            block_lines = []
            is_rotated = False
            for line in block.get('lines', []):
                direction = line.get('dir', (1, 0))
                if abs(direction[0]) < 0.1:
                    is_rotated = True
                text_parts = [span['text'] for span in line.get('spans', [])]
                block_lines.append(''.join(text_parts).strip())

            if not is_rotated or not block_lines:
                continue

            first_line = block_lines[0]
            if _carriage_code_re.match(first_line):
                item = _parse_carriage_block(block_lines)
                if item and item['rate']:
                    item['source_page'] = page_idx
                    page_items.append(item)

        if page_items:
            carriage_page_indices.add(page_idx)
            items.extend(page_items)

    doc.close()
    print(f"  [PyMuPDF] Found {len(items)} rotated-carriage items across "
          f"{len(carriage_page_indices)} pages")
    return items, carriage_page_indices


# ============================================================================
# PHASE 1b: CARRIAGE PAGES (Horizontal, 1-2 rate columns) — PyMuPDF coords
#   Covers 1.2.x (manual/mechanical carriage) and 1.3 / 1.4.x
#   (loading & unloading). These pages are portrait/horizontal, so neither the
#   rotated-carriage detector nor the standard parser handled them before.
# ============================================================================

# Carriage codes on these pages are always sub-head 1.x (chapter 1).
_carr2_code_re = re.compile(r'^1\.\d{1,2}(?:\.\d{1,3})*$')
_UNIT_VOCAB = {'cum', 'tonne', 'nos', 'no', 'no.', 'm', 'metre', 'meter', 'kg',
               'quintal', 'qtl', 'litre', 'liter', 'each', 'sqm', 'sq.m', 'dm',
               'cudm', 'km'}
_MULT_TOKENS = {'10', '100', '1000', '10000'}


def _cluster_1d(values, gap=25.0):
    """Cluster sorted 1-D x-positions into columns; return (min,max) per cluster."""
    if not values:
        return []
    values = sorted(values)
    clusters = [[values[0]]]
    for v in values[1:]:
        if v - clusters[-1][-1] <= gap:
            clusters[-1].append(v)
        else:
            clusters.append([v])
    return [(min(c), max(c)) for c in clusters]


def _parse_carriage_2col_page(page, page_idx):
    """Parse one horizontal carriage page using word coordinates.

    Columns are detected per-page from the x-positions of the rate tokens
    (handles both the 2-column 1.2.x layout and the 1-column 1.3/1.4.x layout).
    Anything to the right of the last rate column is the free-text 'Remarks'
    column and is discarded.
    """
    words = page.get_text("words")  # (x0, y0, x1, y1, text, block, line, wordno)
    if not words:
        return []

    # Group words into visual rows by y.
    rows = {}
    for w in words:
        key = round(w[1] / 3.0)
        rows.setdefault(key, []).append(w)

    # Detect rate columns from every rate-looking token on the page.
    rate_xs = [w[0] for w in words if _carriage_rate_re.match(w[4].strip())]
    rate_cols = _cluster_1d(rate_xs, gap=25.0)
    if not rate_cols:
        return []
    col_centers = [(lo + hi) / 2.0 for lo, hi in rate_cols]
    min_rate_x = min(lo for lo, _ in rate_cols) - 5
    max_rate_x = max(hi for _, hi in rate_cols) + 8

    items = []
    current = None

    def finalize(it):
        if it is None:
            return
        rate_json = {}
        # Column 0 -> base carriage cost; column 1 -> per additional lead.
        labels = ['base', 'per_addl_lead']
        for ci in sorted(it['rates']):
            label = labels[ci] if ci < len(labels) else f'col{ci}'
            rate_json[label] = it['rates'][ci]
        # Require a base (column-0) rate. Section-header rows like "1.2 By
        # Manual Labour ... lead less than 0.50 KM" only pick up a stray
        # column-1 number and must not be emitted as items.
        if 'base' not in rate_json:
            return
        unit = ' '.join(t for _, t in sorted(it['unit_toks']))
        desc = ' '.join(t for _, t, _ in sorted(it['desc_toks'], key=lambda z: (z[2], z[0])))
        desc = re.sub(r'\s+', ' ', desc).strip(' ,')
        items.append({
            'code': it['code'],
            'description': desc,
            'unit': unit,
            'rate': json.dumps(rate_json),
            'source_page': page_idx,
        })

    for y in sorted(rows):
        row = sorted(rows[y], key=lambda w: w[0])
        first = row[0]
        first_txt = first[4].strip()

        if first[0] < 95 and _carr2_code_re.match(first_txt):
            finalize(current)
            current = {'code': first_txt, 'desc_toks': [], 'unit_toks': [], 'rates': {}}
            body = row[1:]
        else:
            body = row

        if current is None:
            continue

        for w in body:
            x0, txt = w[0], w[4].strip()
            if not txt:
                continue
            if x0 > max_rate_x:
                continue  # Remarks column — discard
            if _carriage_rate_re.match(txt):
                ci = min(range(len(col_centers)), key=lambda i: abs(col_centers[i] - x0))
                current['rates'][ci] = txt
            elif x0 < min_rate_x:
                low = txt.lower()
                if low in _UNIT_VOCAB or (txt in _MULT_TOKENS):
                    current['unit_toks'].append((x0, txt))
                else:
                    current['desc_toks'].append((x0, txt, y))

    finalize(current)

    # Keep a multiplier token only if it is genuinely part of the unit
    # (i.e. a real unit word is present); otherwise drop it back is unnecessary
    # because bare multipliers without a unit word never occur on these pages.
    return items


def extract_carriage_2col_items(pdf_path, exclude_pages=None):
    """Find & parse horizontal carriage pages (1.2.x / 1.3 / 1.4.x)."""
    if exclude_pages is None:
        exclude_pages = set()
    print(f"  [PyMuPDF] Scanning for horizontal carriage pages...")
    doc = fitz.open(pdf_path)
    items = []
    pages = set()

    for page_idx in range(len(doc)):
        if page_idx in exclude_pages:
            continue
        page = doc[page_idx]
        text = page.get_text()
        if 'CARRIAGE OF MATERIALS' not in text:
            continue
        if is_hindi(text):
            continue
        # Must be predominantly horizontal (rotated pages handled in Phase 1).
        data = page.get_text("dict")
        vertical = horizontal = 0
        for block in data['blocks']:
            if block.get('type') != 0:
                continue
            for line in block.get('lines', []):
                d = line.get('dir', (1, 0))
                if abs(d[0]) < 0.1 and abs(d[1]) > 0.9:
                    vertical += 1
                else:
                    horizontal += 1
        if horizontal < vertical:
            continue

        page_items = _parse_carriage_2col_page(page, page_idx)
        if page_items:
            pages.add(page_idx)
            items.extend(page_items)

    doc.close()
    print(f"  [PyMuPDF] Found {len(items)} horizontal-carriage items across "
          f"{len(pages)} pages")
    return items, pages


# ============================================================================
# PHASE 2: STANDARD PAGES (Portrait) — Using pdfplumber
# ============================================================================

# FIX-3: restrict the optional unit multiplier to a KNOWN set so it can never
# swallow a trailing description number (IS 3989, ETAG 004, dimensions, ...).
_UNIT_MULT = r'(?:10|100|1000|10000)'
_RATE_PATTERN = re.compile(
    r'\s+((?:' + _UNIT_MULT + r'\s+)?[A-Za-z][A-Za-z.]*)\s+([\d,]+\.\d{2})$'
)


# FIX-6 (data-integrity): recover priced items the end-anchored rate regex
# mis-classifies as rate-less *parents* and silently drops. Two mechanisms,
# both leave the rate NOT at the very end of the joined description text:
#
#   Bug A — trailing non-item text after the rate. Two flavours:
#             * an ALL-CAPS section-divider line the two hard-coded line filters
#               miss ("ROAD WORK", "SAND STONE FLOORING", "C.P. BRASS FITTINGS",
#               "EXTERIOR FINISHING"), leaked when the item is the last priced
#               row before a section break / chapter-divider page.
#             * a "Note for item No. X:- ..." footnote paragraph (the existing
#               'Note :-' filter only catches the colon-dash form).
#           Examples dropped before this fix: 11.27, 13.41.1, 15.60, 18.48A, 5.31.
#
#   Bug B — the rate column value is extracted on its OWN line positioned
#           *between* two wrapped description lines, so a short description tail
#           follows the rate ("... each 12770.55 bricks of class designation
#           7.5"). Hits ~all chapter-19 manhole ".1" sub-variants (19.7.1.1,
#           19.9.1.1, 19.10.1, ...).
#
# recover_rate() runs ONLY after the raw end-anchored match has already failed,
# so it can never change how an existing correctly-parsed item is read — it is
# purely additive (verified by an old-vs-new DB diff after re-extraction).

# Footnote paragraph marker: "Note :-", "Note:-", "Note for item No. 4.15 :-".
# Everything from here to the next code is explanatory text, never item data.
_NOTE_TRUNC_RE = re.compile(r'\bNote\b[^:]*:-', re.IGNORECASE)

# Bug-B units are restricted to concrete PHYSICAL units so a stray "No. 5.31"
# cross-reference (chapter.item) can never be mistaken for a "<unit> <rate>".
_PHYS_UNITS = {'each', 'sqm', 'sq.m', 'metre', 'meter', 'cum', 'kg', 'kilogram',
               'quintal', 'qtl', 'tonne', 'litre', 'liter', 'cudm', 'dm', 'ml',
               'cartridge', 'mt', 'set', 'pair', 'roll', 'bundle', 'km', 'nos'}
_EMB_RATE_RE = re.compile(
    r'(?:(10|100|1000|10000)\s+)?([A-Za-z][A-Za-z.]*)\s+([\d,]+\.\d{2})'
)


# FIX-7 (data-integrity): the inline "code + rate on the same line" fast-path
# emits an item the moment a code line ENDS in "<word> <NN.dd>", accepting ANY
# word as the unit. On a wrapped first line that ends in a measurement (e.g.
# "16.40 ... premixed fine aggregate ( passing 2.36") it fires on "passing 2.36"
# and stores the sieve size 2.36 as the rate — the real rate "sqm 88.55" sits at
# the end of the item, lines later. Gate the fast-path to KNOWN units only; an
# unknown "unit" means this isn't really the rate, so fall through to normal
# accumulation and let finalize_pending find the true end-of-item rate.
# Deferring is loss-free: finalize's own end-anchored match accepts any unit, so
# a genuine one-line item with a rare unit still comes out byte-identical.
_KNOWN_UNITS = {'each', 'sqm', 'sq.m', 'sqmtr', 'metre', 'meter', 'mtr', 'rmt',
                'rmtr', 'cum', 'kg', 'kilogram', 'quintal', 'qtl', 'tonne',
                'litre', 'liter', 'cudm', 'dm', 'ml', 'cartridge', 'mt', 'set',
                'sets', 'pair', 'roll', 'bundle', 'km', 'nos', 'no', 'day',
                'hour', 'cm', 'm', 'gram', 'sqcm'}


def _known_unit_word(unit_str):
    """True if the parsed unit is a real DSR unit (multiplier prefix allowed)."""
    u = re.sub(r'^(?:10|100|1000|10000)\s+', '', unit_str.strip())
    return u.strip().rstrip('.').lower() in _KNOWN_UNITS


def _is_divider_tok(tok):
    """A token from an all-caps section-divider header (>=2 upper letters, no
    lowercase, no digit). Excludes 'IS'/'4885'-style tokens (they carry digits)."""
    letters = [c for c in tok if c.isalpha()]
    return (len(letters) >= 2 and all(c.isupper() for c in letters)
            and not any(ch.isdigit() for ch in tok))


def _strip_trailing_dividers(text):
    """Drop a trailing run of all-caps section-divider words from `text`."""
    toks = text.split()
    while toks and _is_divider_tok(toks[-1]):
        toks.pop()
    return ' '.join(toks)


def _is_real_item_desc(desc):
    """Guard against recovering a *false* code — a measurement fragment such as
    a wrapped "@ 3.3 kg per sqm" line that the code detector mistook for a code
    (e.g. chapter-3 code "3.3" appearing on a chapter-8 tile page). A genuine
    DSR item title always begins with a capital letter (Providing, Extra, With,
    Kota, ...) or a dimension digit ("12 mm cement plaster"); a stolen fragment
    begins mid-sentence with a lowercase unit word ("kg/ sqm including ...")."""
    d = (desc or '').strip()
    return len(d) >= 8 and (d[0].isupper() or d[0].isdigit())


def recover_rate(full_text):
    """Recover (unit, rate, desc) for an item whose rate isn't end-anchored.

    Call ONLY after `_RATE_PATTERN.search(full_text)` on the RAW text failed.
    Returns None when the text genuinely carries no unit rate (true parent node,
    or a percentage-rate 'Extra ...' item like 2.24.2 whose rate is '25%'), or
    when the recovered description doesn't look like a real item title.
    """
    # Strip a trailing footnote paragraph, then a trailing all-caps divider.
    nt = _NOTE_TRUNC_RE.search(full_text)
    t = full_text[:nt.start()].strip() if nt else full_text
    t2 = _strip_trailing_dividers(t)

    # Bug A: after removing the trailing junk the rate is now end-anchored.
    m = _RATE_PATTERN.search(t2)
    if m:
        desc = t2[:m.start()].strip()
        if _is_real_item_desc(desc):
            return m.group(1).strip(), m.group(2).replace(',', ''), desc
        return None

    # Bug B: rate sits mid-text with a wrapped description tail after it. Take
    # the LAST physical-unit rate (rates come late); keep the tail as description.
    best = None
    for mm in _EMB_RATE_RE.finditer(t):
        uw = mm.group(2).strip('.').lower()
        if uw in _PHYS_UNITS:
            best = mm
    if best:
        before = t[:best.start()].strip()
        if not before:
            return None  # a lone "<unit> <n>" with no description is not an item
        mult = best.group(1)
        unit = (mult + ' ' if mult else '') + best.group(2).strip()
        after = _strip_trailing_dividers(t[best.end():].strip())
        desc = (before + ' ' + after).strip() if after else before
        if _is_real_item_desc(desc):
            return unit, best.group(3).replace(',', ''), desc

    return None


def parse_standard_pages(pdf_path, skip_pages=None, allow_basic_codes=True,
                         chapter_range=(1, 26)):
    """Parse standard portrait DSR pages with hierarchical description support.

    Args:
        pdf_path: Path to the PDF file
        skip_pages: Set of page indices to skip (already handled as carriage pages)
        allow_basic_codes: whether 4-digit basic codes exist in this volume
            (True for Vol 1's front basic-rates section; False for Vol 2).
        chapter_range: (lo, hi) inclusive chapter numbers valid for this volume
            (Vol 1 -> 1..12, Vol 2 -> 13..26). Dotted codes whose chapter is out
            of range are measurements on a wrapped line ('3.3 W/m2 K'), not codes.

    Returns:
        items: list of dicts with code, description, unit, rate, source_page
    """
    if skip_pages is None:
        skip_pages = set()
    ch_lo, ch_hi = chapter_range

    print(f"  [pdfplumber] Parsing standard pages (skipping {len(skip_pages)} "
          f"carriage pages)...")

    items = []
    parent_descriptions = {}
    coeff_skipped = 0

    # Trailing [A-Z] (glued, no space) captures letter-suffixed variant codes
    # like '4.1.10A' / '17.7A'. Without it the previous item absorbs the
    # variant line and steals the LAST variant's rate.
    dotted_code_pattern = re.compile(r'^(\d{1,2}(?:\.\d{1,3})+[A-Z]?)\s+(.*)')
    basic_code_pattern = re.compile(r'^(\d{4,5})\s+(.*)')
    rate_pattern = _RATE_PATTERN

    def finalize_pending(code, desc_lines, is_basic, source_page):
        """Emit a leaf item, or record a rateless node as a parent (own text)."""
        full_text = ' '.join(desc_lines)
        rate_match = rate_pattern.search(full_text)
        if rate_match:
            unit = rate_match.group(1).strip()
            rate = rate_match.group(2).strip().replace(',', '')
            desc = full_text[:rate_match.start()].strip()
            if not is_basic:
                full_desc = build_full_description(code, desc, parent_descriptions)
            else:
                full_desc = desc
            items.append({
                'code': code,
                'description': full_desc,
                'unit': unit,
                'rate': rate,
                'source_page': source_page,
            })
        elif not is_basic:
            # FIX-6: the rate may be present but not end-anchored (trailing
            # divider/footnote = Bug A, or embedded mid-description = Bug B).
            # Try to recover it before giving up and treating this as a parent.
            recovered = recover_rate(full_text)
            if recovered:
                unit, rate, desc = recovered
                full_desc = build_full_description(code, desc, parent_descriptions)
                items.append({
                    'code': code,
                    'description': full_desc,
                    'unit': unit,
                    'rate': rate,
                    'source_page': source_page,
                })
            else:
                # Parent/header node (no rate): store its OWN text only (FIX-5).
                parent_descriptions[code] = full_text

    with pdfplumber.open(pdf_path) as pdf:
        total_pages = len(pdf.pages)

        current_code = None
        current_desc_lines = []
        current_is_basic = False
        current_page = None

        for page_idx in range(total_pages):
            if page_idx % 50 == 0:
                print(f"    Processing page {page_idx}/{total_pages}...")

            if page_idx in skip_pages:
                continue

            page = pdf.pages[page_idx]
            text = page.extract_text()

            if not text:
                continue
            if is_hindi(text):
                continue
            # FIX-1: skip the cement/bitumen consumption coefficient appendix.
            if is_coefficient_page(text):
                coeff_skipped += 1
                continue
            # Skip reversed-text carriage pages not caught by rotation check.
            if 'slairetaM' in text and 'edoC' in text:
                continue

            # 4-digit basic codes live only on Vol 1's basic-rates pages (their
            # header reads "... Unit Basic rate"). On every other page a 4-digit
            # line-start is a measurement ('1050 mm', '6063 T5/T6'), not a code.
            is_basic_page = allow_basic_codes and ('basic rate' in text.lower())

            lines = text.split('\n')

            for line in lines:
                line = line.strip()
                if not line:
                    continue

                # Skip known header/footer lines
                if line.startswith('Code') and ('Description' in line or 'No.' in line):
                    continue
                if line.startswith('BASIC RATES') or line.startswith('Note :-'):
                    continue
                # Page-transition footer/header (e.g. "96 SUB HEAD : 4.0 CONCRETE
                # WORK"). If not filtered, it appends after an item's rate when
                # the item wraps across a page boundary, pushing the rate off the
                # end-anchor so the item is misread as a rate-less parent.
                if 'SUB HEAD' in line or line == 'DELHI SCHEDULE OF RATES':
                    continue

                match_dotted = dotted_code_pattern.match(line)
                # Reject measurement-looking false codes: bad format ('0.075',
                # '5.00') or a chapter outside this volume's range ('3.3 W/m2 K'
                # in Vol 2). The line is then kept as description so the real
                # rate survives.
                if match_dotted:
                    _dc = match_dotted.group(1)
                    _ch = int(_dc.split('.')[0])
                    if not is_valid_dotted_code(_dc) or not (ch_lo <= _ch <= ch_hi):
                        match_dotted = None

                match_basic = basic_code_pattern.match(line) if is_basic_page else None

                new_code_match = match_dotted or match_basic

                if new_code_match:
                    # Finalize previous pending code
                    if current_code and current_desc_lines:
                        finalize_pending(current_code, current_desc_lines,
                                         current_is_basic, current_page)
                        current_code = None
                        current_desc_lines = []

                    # Start new code
                    code = new_code_match.group(1)
                    rest = new_code_match.group(2)
                    is_basic = bool(match_basic and not match_dotted)

                    rate_match = rate_pattern.search(rest)
                    # FIX-7: only take the same-line rate when its unit is real;
                    # otherwise this is a wrapped first line (e.g. "... passing
                    # 2.36") and the true rate is at the item's end — defer.
                    if rate_match and (is_basic or _known_unit_word(rate_match.group(1))):
                        unit = rate_match.group(1).strip()
                        rate = rate_match.group(2).strip().replace(',', '')
                        desc = rest[:rate_match.start()].strip()

                        if not is_basic:
                            full_desc = build_full_description(code, desc, parent_descriptions)
                        else:
                            full_desc = desc

                        items.append({
                            'code': code,
                            'description': full_desc,
                            'unit': unit,
                            'rate': rate,
                            'source_page': page_idx,
                        })
                    else:
                        current_code = code
                        current_desc_lines = [rest] if rest else []
                        current_is_basic = is_basic
                        current_page = page_idx

                elif current_code:
                    current_desc_lines.append(line)

        # Finalize the very last pending code
        if current_code and current_desc_lines:
            finalize_pending(current_code, current_desc_lines,
                             current_is_basic, current_page)

    print(f"  [pdfplumber] Found {len(items)} standard items.")
    print(f"  [pdfplumber] Found {len(parent_descriptions)} parent/header entries (no rate).")
    print(f"  [pdfplumber] Skipped {coeff_skipped} coefficient-appendix pages (FIX-1).")
    return items


# ============================================================================
# MAIN
# ============================================================================

def process_volume(pdf_path, volume_label):
    """Process a single DSR volume: carriage (rotated + horizontal) + standard."""
    print(f"\nProcessing: {pdf_path}  [{volume_label}]")

    # Phase 1: rotated carriage (1.1.x, 8 distance columns)
    carriage_items, carriage_pages = extract_carriage_items(pdf_path)

    # Phase 1b: horizontal carriage (1.2.x / 1.3 / 1.4.x)  (FIX-4)
    carriage2_items, carriage2_pages = extract_carriage_2col_items(
        pdf_path, exclude_pages=carriage_pages)

    # Phase 2: standard items (skip all carriage pages)
    skip = carriage_pages | carriage2_pages
    # Vol 1 = chapters 1..12 with a front basic-rates section; Vol 2 = 13..26.
    allow_basic = (volume_label == "vol1")
    chapter_range = (1, 12) if volume_label == "vol1" else (13, 26)
    standard_items = parse_standard_pages(pdf_path, skip_pages=skip,
                                          allow_basic_codes=allow_basic,
                                          chapter_range=chapter_range)

    all_items = carriage_items + carriage2_items + standard_items
    for it in all_items:
        it['volume'] = volume_label

    print(f"  TOTAL: {len(all_items)} items "
          f"({len(carriage_items)} rotated-carriage + "
          f"{len(carriage2_items)} horizontal-carriage + "
          f"{len(standard_items)} standard)")
    return all_items


def dedupe_with_conflict_report(df):
    """FIX-2: provenance-aware de-dup that never drops a distinct priced line.

    - Collapse only EXACT (volume, code, rate) repeats — true double-parses.
    - Keep every row with the same (volume, code) but a DIFFERENT rate — these
      are real variants (e.g. letter-suffixed '26.50.1 A/B' whose suffix sits in
      the description). They are listed in a report for transparency.

    Returns (clean_df, multi_rate_df).
    """
    clean = df.drop_duplicates(subset=['volume', 'code', 'rate'],
                               keep='first').reset_index(drop=True)

    multi = []
    for (vol, code), g in clean.groupby(['volume', 'code'], sort=False):
        if len(g) > 1:
            for _, r in g.iterrows():
                multi.append({
                    'volume': vol, 'code': code,
                    'rate': r['rate'], 'unit': r['unit'],
                    'source_page': r['source_page'],
                    'description': r['description'][:80],
                })
    multi_df = pd.DataFrame(multi)
    return clean, multi_df


def main():
    base_dir = "."
    vol1_path = os.path.join(base_dir, "data", "booklets", "voll_1.pdf")
    vol2_path = os.path.join(base_dir, "data", "booklets", "voll_2.pdf")

    all_items = []

    if os.path.exists(vol1_path):
        all_items.extend(process_volume(vol1_path, "vol1"))
    else:
        print(f"Warning: {vol1_path} not found.")

    if os.path.exists(vol2_path):
        all_items.extend(process_volume(vol2_path, "vol2"))
    else:
        print(f"Warning: {vol2_path} not found.")

    if not all_items:
        print("No items extracted. Exiting.")
        return

    df = pd.DataFrame(all_items, columns=['code', 'description', 'unit', 'rate',
                                          'volume', 'source_page'])

    # FIX-2: provenance-aware de-dup (keeps distinct-rate variants).
    df, multi_df = dedupe_with_conflict_report(df)

    print(f"\n{'='*60}")
    print(f"Total unique (volume, code) items: {len(df)}")
    print(f"{'='*60}")

    # --- Spot-checks ---
    print("\n--- Spot checks ---")
    for check_code, expected_fragment in [
        ('13.73.1', 'Forming groove'),
        ('13.1.1', '12 mm cement plaster'),
        ('1.1.17.1', '100 mm dia'),
        ('1.1.18', 'Disposal of moorum'),
        ('0583', 'Chromium plated'),
        ('17.38.1.2', 'IS - 3989'),
        ('1.2.1', 'Lime'),
    ]:
        row = df[df['code'] == check_code]
        if not row.empty:
            desc = row.iloc[0]['description']
            rate = row.iloc[0]['rate']
            status = '✓' if expected_fragment.lower() in desc.lower() else '✗'
            print(f"  {status} {check_code}: {desc[:90]}")
            print(f"    Unit: {row.iloc[0]['unit']!r}  Rate: {str(rate)[:80]}")
        else:
            print(f"  ✗ {check_code}: NOT FOUND")

    # --- Multi-rate code report (FIX-2) ---
    print(f"\n--- Multi-rate codes (kept as distinct variants) ---")
    if multi_df.empty:
        print("  No code carries more than one rate. ✓")
    else:
        n_codes = multi_df.groupby(['volume', 'code']).ngroups
        print(f"  {n_codes} codes carry >1 rate ({len(multi_df)} rows kept). "
              f"Usually letter-suffixed variants; listed for review.")
        multi_path = os.path.join(base_dir, "dsr_multirate_codes.csv")
        multi_df.to_csv(multi_path, index=False)
        print(f"  Written to: {multi_path}")

    # Export to Excel
    excel_path = os.path.join(base_dir, "dsr_database.xlsx")
    df.to_excel(excel_path, index=False)
    print(f"\nSaved to Excel: {excel_path}")

    # Export to SQLite
    db_path = os.path.join(base_dir, "dsr_database.db")
    conn = sqlite3.connect(db_path)
    df.to_sql('dsr_items', conn, if_exists='replace', index=False)
    conn.close()
    print(f"Saved to SQLite: {db_path} (Table: dsr_items)")


if __name__ == "__main__":
    main()
