"""Independent PDF-vs-DB reconciliation ("the certifier").

For every extracted row, verify the rate actually appears in the source PDF at
(or just after) its cited page. Uses PyMuPDF text, which is a DIFFERENT library
from the pdfplumber text the extractor parses from, so this is a genuine
cross-check — and it can read the rotated carriage pages that pdfplumber cannot.

A row is:
  - STRICT-verified if its rate is on the exact cited source_page.
  - SPAN-verified  if its rate is within source_page..+3 (DSR interleaves Hindi
    pages, so a long item's rate lands ~2 English pages after the code starts).
  - a TRUE MISS    if the rate cannot be found even in the span window.
"""
import sqlite3
import json
import fitz  # PyMuPDF

PDF = {'vol1': 'data/booklets/voll_1.pdf', 'vol2': 'data/booklets/voll_2.pdf'}
SPAN = 3


def rate_variants(r):
    out = {r}
    try:
        f = float(r)
        out.add(f'{f:,.2f}')
        out.add(f'{f:.2f}')
    except ValueError:
        pass
    return out


def main():
    docs = {v: fitz.open(p) for v, p in PDF.items()}
    text = {}

    def page_text(vol, pg):
        key = (vol, pg)
        if key not in text:
            d = docs[vol]
            text[key] = d[pg].get_text() if 0 <= pg < len(d) else ''
        return text[key]

    conn = sqlite3.connect('dsr_database.db')
    rows = conn.execute(
        'SELECT code, unit, rate, volume, source_page FROM dsr_items').fetchall()
    conn.close()

    strict = span = miss = 0
    carr_ok = carr_miss = 0
    true_misses = []

    for code, unit, rate, vol, pg in rows:
        if rate.startswith('{'):  # carriage JSON — all column values must appear
            vals = list(json.loads(rate).values())
            blob = ''.join(page_text(vol, p) for p in range(pg, pg + SPAN + 1))
            if code in blob and all(v in blob for v in vals):
                carr_ok += 1
            else:
                carr_miss += 1
                true_misses.append((vol, pg, code, 'carriage value not found'))
            continue

        variants = rate_variants(rate)
        if any(v in page_text(vol, pg) for v in variants):
            strict += 1
        else:
            blob = ''.join(page_text(vol, p) for p in range(pg + 1, pg + SPAN + 1))
            if any(v in blob for v in variants):
                span += 1
            else:
                miss += 1
                true_misses.append((vol, pg, code, f'rate {rate} not found'))

    std = strict + span + miss
    carr = carr_ok + carr_miss
    print(f"Standard items: {std}")
    print(f"  rate on cited page (strict):         {strict}  ({100*strict/std:.2f}%)")
    print(f"  rate within +{SPAN} pages (long item):    {span}")
    print(f"  TRUE MISS (rate not in source):      {miss}")
    print(f"Carriage items: {carr}")
    print(f"  all column values verified:          {carr_ok}")
    print(f"  TRUE MISS:                           {carr_miss}")

    tot = std + carr
    verified = strict + span + carr_ok
    print(f"\nTraceable to source: {verified}/{tot} = {100*verified/tot:.2f}%")
    print(f"Unexplained misses:  {miss + carr_miss}")
    for m in true_misses[:20]:
        print("   MISS", m)


if __name__ == "__main__":
    main()
