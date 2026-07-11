// OCR import for the DSR → Schedule page.
//
// The scanned "Schedule of Work" is a ruled table:
//   S.No | DSR Ref No | Description | Quantity | Unit | Rate | Rate in words | Amount
//
// The frontend renders each PDF page to an image and runs Tesseract (WASM,
// fully offline). It sends us the *word boxes* it read. This module:
//   1. reconstructs table rows from those word boxes (geometry, not raw text),
//   2. classifies each row (DSR item / market item / appended / skip),
//   3. matches each DSR code against the 5,353-item database — crucially
//      recovering the code even when OCR drops the dots (15.2.1 -> "1521"),
//   4. returns editable rows carrying both what OCR read and what the DB says,
//      so a user can cross-check before applying.
//
// A `visionExtract()` seam is included but not activated: later a cloud vision
// model (Claude / GPT-4V) can be dropped in for handwriting, behind the same
// row contract, without touching the frontend.

import { all, search } from './data.js';

// ---------------------------------------------------------------------------
// 1. DSR code matching (dot-tolerant)
// ---------------------------------------------------------------------------

let SIG = null; // Map<digitString, item[]>  — DSR codes keyed by their digits only

const digitsOf = (s) => String(s == null ? '' : s).replace(/[^0-9]/g, '');
const segCount = (code) => String(code || '').split(/[.\s]+/).filter(Boolean).length;

function buildIndex() {
  SIG = new Map();
  for (const it of all()) {
    const k = digitsOf(it.code);
    if (!k) continue;
    if (!SIG.has(k)) SIG.set(k, []);
    SIG.get(k).push(it);
  }
}

// True when an OCR token's digits resolve to exactly one real DSR code — strong
// evidence it's a genuine code even without an S.No beside it.
function uniqueSignature(t) {
  if (!SIG) buildIndex();
  const c = SIG.get(digitsOf(t));
  return Boolean(c && c.length === 1);
}

function descTokens(s) {
  return String(s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

// token-overlap similarity between two descriptions (0..1). Normalised by the
// smaller token set (with a floor) so a short, user-edited description still
// scores well against a long canonical DSR description.
function descScore(a, b) {
  const A = new Set(descTokens(a));
  const B = new Set(descTokens(b));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.max(4, Math.min(A.size, B.size));
}

// every digit-string one edit (insert / delete / substitute) away that the DB
// actually knows — recovers a genuinely mis-read digit, not just a dropped dot.
function neighborSignatures(sig) {
  const out = new Set();
  const D = '0123456789';
  for (let i = 0; i <= sig.length; i++) {
    for (const d of D) {
      const ins = sig.slice(0, i) + d + sig.slice(i);
      if (SIG.has(ins)) out.add(ins);
    }
  }
  for (let i = 0; i < sig.length; i++) {
    const del = sig.slice(0, i) + sig.slice(i + 1);
    if (del && SIG.has(del)) out.add(del);
    for (const d of D) {
      const sub = sig.slice(0, i) + d + sig.slice(i + 1);
      if (sub !== sig && SIG.has(sub)) out.add(sub);
    }
  }
  const items = [];
  for (const s of out) items.push(...SIG.get(s));
  return items;
}

const publicOf = (it) => ({
  code: it.code, description: it.description, unit: it.unit,
  rate: it.rate, carriage: it.carriage, rate_options: it.rate_options, volume: it.volume,
});

// Match a (possibly garbled) OCR code + description to a real DSR item.
// status: 'matched' (trust it) | 'ambiguous' (right group, pick one)
//         | 'guess' (recovered via fuzz/description) | 'notfound'
export function matchCode(rawCode, ocrDesc) {
  if (!SIG) buildIndex();
  const raw = String(rawCode || '').trim();
  const sig = digitsOf(raw);
  if (!sig) return { status: 'notfound', code: raw, item: null, confidence: 0, candidates: [] };

  let cands = SIG.get(sig) || [];
  let fuzzy = false;
  if (!cands.length) { cands = neighborSignatures(sig); fuzzy = true; }

  if (!cands.length) {
    const byDesc = search(ocrDesc || '', 5);
    if (byDesc.length) {
      return { status: 'guess', code: byDesc[0].code, item: byDesc[0], confidence: 0.3, candidates: byDesc.map(publicOf) };
    }
    return { status: 'notfound', code: raw, item: null, confidence: 0, candidates: [] };
  }

  // rank: prefer the candidate whose dot-structure matches what OCR saw, then
  // whichever description best matches the scanned description.
  const rawSeg = segCount(raw);
  const ranked = cands
    .map((it) => ({ it, s: (segCount(it.code) === rawSeg ? 0.4 : 0) + 0.6 * descScore(ocrDesc, it.description) }))
    .sort((a, b) => b.s - a.s);
  const best = ranked[0].it;

  let status, confidence;
  if (cands.length === 1 && !fuzzy) {
    status = 'matched'; confidence = 0.98;
  } else if (!fuzzy) {
    const gap = ranked.length > 1 ? ranked[0].s - ranked[1].s : 1;
    confidence = 0.62 + Math.min(0.34, gap);
    status = gap > 0.12 ? 'matched' : 'ambiguous';
  } else {
    status = 'guess'; confidence = 0.4;
  }
  return { status, code: best.code, item: publicOf(best), confidence, candidates: cands.map(publicOf) };
}

// ---------------------------------------------------------------------------
// 2. Row reconstruction from word boxes
// ---------------------------------------------------------------------------

const UNIT_RE = /^(cum|sqm|sm|metre|meter|m|rmt|rm|km|kg|quintal|qtl|tonne|litre|ltr|nos?|each|hour|hr|point|pair|set|job|kl)\.?$/i;
const NUM_RE = /^\d{1,3}(,\d{3})*(\.\d{1,3})?$/;               // 1.00, 2.19, 90.00, 1,234.50
const CLEAN_CODE_RE = /^\d{1,2}(\.\d{1,3}){1,4}[a-z]?$/i;       // 15.2.1, 23.1.1.1, 18.72A
const CODEISH_RE = /^\d[\d.]{1,}[a-z]?$/i;                      // 1521, 23102 (dots dropped)
const MARKET_RE = /^(MKT|MR|M\.R\.?)$/i;
const APPD_RE = /^(Appd\.?|Apd\.?)$/i;
const NS_RE = /^(NS|N\.S\.?)$/i;
const ROMAN_RE = /^(x?(ix|iv|v?i{0,3}))$/i;                     // i..xii
const SUBLETTER_RE = /^[A-H]$/;                                 // A, B ... sub-item labels
const FOOTER_RE = /(multiplying\s*factor|cost\s*index|^total$|^say$|grand\s*total|carried|brought\s*forward)/i;

const median = (arr) => {
  if (!arr.length) return 0;
  const v = arr.slice().sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
};
const cx = (w) => (w.x0 + w.x1) / 2;
const cyr = (w) => (w.y0 + w.y1) / 2;

// split a sorted list of x-centres into clusters on large gaps
function clusterX(values, minGap) {
  const v = values.slice().sort((a, b) => a - b);
  const groups = [];
  let cur = [];
  for (const x of v) {
    if (cur.length && x - cur[cur.length - 1] > minGap) { groups.push(cur); cur = []; }
    cur.push(x);
  }
  if (cur.length) groups.push(cur);
  return groups.map((g) => ({ center: median(g), min: g[0], max: g[g.length - 1], n: g.length }));
}

// Detection engines (PaddleOCR / vision) return line-or-cell *regions* with
// recognised text rather than per-word boxes. Split each region into word-like
// tokens, apportioning the region's x-span by character offset, so the one
// geometric parser can consume either engine. Approximate, but the column
// clustering tolerates it and a row-leading code still lands in the left band.
function regionsToWords(regions) {
  const words = [];
  for (const r of regions || []) {
    const text = String(r.text || '').trim();
    if (!text) continue;
    const parts = text.split(/\s+/).filter(Boolean);
    const span = (r.x1 - r.x0) || 1;
    const total = text.length || 1;
    let cursor = 0;
    for (const p of parts) {
      const at = text.indexOf(p, cursor);
      const idx = at >= 0 ? at : cursor;
      words.push({
        text: p,
        x0: Math.round(r.x0 + (idx / total) * span),
        y0: r.y0,
        x1: Math.round(r.x0 + ((idx + p.length) / total) * span),
        y1: r.y1,
        conf: r.conf,
      });
      cursor = idx + p.length;
    }
  }
  return words;
}

// Parse one page's words into raw rows. Column geometry is inferred per page so
// this survives page-to-page shifts in a scan.
function parsePageRows(page) {
  const source = page.words && page.words.length ? page.words : regionsToWords(page.regions);
  const words = (source || []).filter((w) => w.text && w.text.trim());
  if (!words.length) return [];
  const W = page.width || Math.max(...words.map((w) => w.x1));

  // classify a left-column cell by its text
  const clean = (w) => w.text.replace(/[|,]/g, '').trim();
  const kindOf = (t) => {
    if (MARKET_RE.test(t)) return 'market';
    if (APPD_RE.test(t)) return 'appd';
    if (NS_RE.test(t)) return 'ns';
    if (CLEAN_CODE_RE.test(t)) return 'dsr';
    return null;
  };

  // Codes are left-aligned in their cell, so a cell's LEFT edge (x0) is the
  // reliable column signal. A center-based measure drifts right when an engine
  // merges the code with trailing text ("18.7.4 Eighteen and"), which would
  // push the column off the standalone left-edge codes on a skewed page.
  const lx = (w) => w.x0;

  // Pass 1: locate the code column from *unambiguous* codes/categories, so we
  // don't mistake numbers embedded in the description ("IS: 2800", "300 mm")
  // for row codes. Only multi-segment codes (15.2.1) and categories seed the
  // column — single-dot tokens like "5.40 mm" would drag the column rightward.
  const isSeed = (t) => { const k = kindOf(t); return k && (k !== 'dsr' || segCount(t) >= 3); };
  const seeds = words
    .filter((w) => lx(w) < 0.32 * W && lx(w) > 0.02 * W && isSeed(clean(w)))
    .map((w) => lx(w));
  if (!seeds.length) return [];
  const codeX = median(seeds);
  const codeTol = 0.09 * W;

  // The S.No column: small integers sitting just left of the code column. Their
  // y-positions vouch for a genuine item row — a decimal buried in a paragraph
  // ("5.40 mm", "1.00 m") looks code-like but has no S.No beside it.
  const rowTol = 0.018 * (page.height || W);
  const snoYs = words
    .filter((w) => /^\d{1,2}$/.test(clean(w)) && lx(w) < codeX - 0.015 * W && lx(w) > 0.005 * W)
    .map((w) => cyr(w));
  const hasSno = (y) => snoYs.some((sy) => Math.abs(sy - y) <= rowTol);

  // Pass 2: anchors = cells in the code band. Multi-segment codes (15.2.1) and
  // categories stand on their own; a single-dot or dot-dropped candidate must be
  // backed by an S.No so we don't anchor on description decimals.
  const anchors = [];
  for (const w of words) {
    if (Math.abs(lx(w) - codeX) > codeTol) continue;
    const t = clean(w);
    let kind = kindOf(t);
    if (!kind && CODEISH_RE.test(t) && digitsOf(t).length >= 2) kind = 'dsr';
    if (!kind) continue;
    // Multi-segment codes (15.2.1) and categories stand on their own. A weaker
    // candidate (single-dot / dot-dropped) needs corroboration: an S.No beside
    // it, or a digit-signature that resolves to exactly one real DSR code.
    const strong = kind !== 'dsr' || segCount(t) >= 3;
    if (!strong && !hasSno(cyr(w)) && !uniqueSignature(t)) continue;
    anchors.push({ y: cyr(w), x: lx(w), code: t, kind, conf: w.conf });
  }
  if (!anchors.length) return [];
  anchors.sort((a, b) => a.y - b.y);
  // collapse anchors closer than ~half a text line — keep the one best centred
  const deduped = [];
  for (const a of anchors) {
    const prev = deduped[deduped.length - 1];
    if (prev && a.y - prev.y < 0.012 * (page.height || W)) {
      if (Math.abs(a.x - codeX) < Math.abs(prev.x - codeX)) deduped[deduped.length - 1] = a;
    } else deduped.push(a);
  }
  return buildRows(deduped, words, W, page, codeX);
}

// Slice the page into row bands between successive anchors and read each cell.
function buildRows(anchors, words, W, page, codeX) {
  // --- infer numeric column centres (qty / rate / amount) from the right half ---
  const rightDec = words.filter((w) => NUM_RE.test(w.text.replace(/[|]/g, '')) && cx(w) > 0.50 * W);
  const numCols = clusterX(rightDec.map(cx), 0.05 * W).filter((c) => c.n >= 2);
  // qty is the left-most of the right-side numeric columns
  const qtyX = numCols.length ? numCols[0].center : 0.56 * W;
  const codeMaxX = codeX + 0.05 * W; // right edge of the code column

  // --- slice into row bands between successive anchors (midpoint split) ---
  // Where a row's own numeric cell sits vertically (top/middle/bottom of a
  // tall multi-line description) varies by document layout and scan quality;
  // midpoint slicing is the more broadly reliable default across scans tested.
  const rows = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const yTop = i === 0 ? -Infinity : (anchors[i - 1].y + a.y) / 2;
    const yBot = i === anchors.length - 1 ? Infinity : (a.y + anchors[i + 1].y) / 2;
    const inBand = words.filter((w) => cyr(w) >= yTop && cyr(w) < yBot);

    // description = alpha-ish words between the code column and the qty column
    const descWords = inBand
      .filter((w) => cx(w) > codeMaxX && cx(w) < qtyX - 0.02 * W)
      .filter((w) => /[a-z]/i.test(w.text))
      .sort((p, q) => (cyr(p) - cyr(q)) || (cx(p) - cx(q)));
    const description = descWords.map((w) => w.text).join(' ').replace(/\s+([,.;:])/g, '$1').trim();

    // quantity = numeric token closest to the qty column centre, preferring one
    // that has a plausible unit word right beside it (distinguishes the real
    // qty cell from a stray number embedded in running description prose, e.g.
    // "50" in "within 50 metres lead" — "metres" ≠ the unit token "metre").
    const numsInBand = inBand
      .filter((w) => NUM_RE.test(w.text.replace(/[|]/g, '')) && cx(w) > codeMaxX)
      .map((w) => {
        const hasUnitNear = inBand.some((u) => UNIT_RE.test(u.text.replace(/[|.]/g, ''))
          && Math.abs(cyr(u) - cyr(w)) < 0.01 * (page.height || W) && cx(u) > cx(w) && cx(u) - cx(w) < 0.12 * W);
        return { w, d: Math.abs(cx(w) - qtyX), hasUnitNear };
      })
      .sort((p, q) => (Number(q.hasUnitNear) - Number(p.hasUnitNear)) || (p.d - q.d));
    const qtyTok = numsInBand.find((n) => n.d < 0.10 * W || n.hasUnitNear);
    const qty = qtyTok ? qtyTok.w.text.replace(/[|,]/g, '') : '';

    // unit = a known unit word sitting right of the qty column
    const unitTok = inBand
      .filter((w) => UNIT_RE.test(w.text.replace(/[|.]/g, '')) && cx(w) > qtyX - 0.02 * W)
      .sort((p, q) => cx(p) - cx(q))[0];
    const unit = unitTok ? unitTok.text.replace(/[|]/g, '').toLowerCase() : '';

    rows.push({
      page: page.index, kind: a.kind, ocrCode: a.code, ocrConf: a.conf,
      description, qty, unit, y: a.y,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 3. Document-level parse: rows across all pages + matching + skip footers
// ---------------------------------------------------------------------------

// Pull the two calc rows that map onto the app's own fields.
function extractSheetMeta(pages) {
  const meta = {};
  for (const page of pages) {
    const tokens = page.words && page.words.length ? page.words : (page.regions || []);
    const line = tokens.map((w) => w.text).join(' ');
    let m = line.match(/multiplying\s*factor[^0-9]*([01]\.\d{2,3})/i);
    if (m) meta.factor = m[1];
    m = line.match(/add\s*@?\s*(\d{1,2}(?:\.\d+)?)\s*%?\s*cost\s*index/i);
    if (m) meta.costIndexPct = m[1];
  }
  return meta;
}

export function parseDocument(pages) {
  const raw = [];
  for (const page of pages || []) raw.push(...parsePageRows(page));

  const rows = [];
  let idx = 0;
  for (const r of raw) {
    const codeText = String(r.ocrCode || '').replace(/[.\s]+$/, '');
    if (FOOTER_RE.test(r.description) || FOOTER_RE.test(codeText)) continue;      // Total / Say / factor
    if (ROMAN_RE.test(codeText) || SUBLETTER_RE.test(codeText)) continue;         // composite sub-items
    if (!r.description && !r.qty && r.kind !== 'dsr') continue;                    // empty

    const row = {
      id: `ocr-${r.page}-${idx++}`,
      page: r.page,
      category: r.kind === 'market' ? 'MKT' : r.kind === 'appd' ? 'Appd.' : r.kind === 'ns' ? 'NS' : 'DSR',
      ocrCode: r.ocrCode,
      ocrDescription: r.description,
      qty: r.qty,
      unit: r.unit,
    };

    if (r.kind === 'dsr') {
      const m = matchCode(r.ocrCode, r.description);
      row.match = m.status;
      row.confidence = m.confidence;
      row.code = m.code || r.ocrCode;
      row.candidates = m.candidates;
      if (m.item) {
        row.description = m.item.description;
        row.dsrUnit = m.item.unit;
        row.rate = m.item.rate;
        row.carriage = m.item.carriage;
        row.rateOptions = m.item.rate_options || null;
        if (!row.unit) row.unit = m.item.unit;
      } else {
        row.description = r.description;
      }
    } else {
      // market / appended / non-schedule: keep OCR text, no DB rate
      row.match = 'manual';
      row.confidence = 1;
      row.code = r.kind === 'market' ? '' : r.ocrCode;
      row.description = r.description;
      row.candidates = [];
    }
    rows.push(row);
  }

  return {
    rows,
    meta: extractSheetMeta(pages || []),
    stats: {
      total: rows.length,
      matched: rows.filter((r) => r.match === 'matched').length,
      review: rows.filter((r) => r.match === 'ambiguous' || r.match === 'guess' || r.match === 'notfound').length,
    },
  };
}

// ---------------------------------------------------------------------------
// 4. Vision-OCR provider seam (handwriting / cloud) — not activated yet
// ---------------------------------------------------------------------------

// Later: read an API key from env, POST the page images to a vision model, and
// return the SAME { rows, meta, stats } shape via parseDocument on its output.
export function visionConfigured() {
  return Boolean(process.env.OCR_VISION_API_KEY && process.env.OCR_VISION_ENDPOINT);
}

export async function visionExtract(/* pages, opts */) {
  if (!visionConfigured()) {
    const err = new Error('Vision OCR is not configured on this device. Add OCR_VISION_ENDPOINT and OCR_VISION_API_KEY to enable handwriting/cloud recognition.');
    err.code = 'VISION_NOT_CONFIGURED';
    throw err;
  }
  // Intentionally unimplemented — this is the documented integration point.
  const err = new Error('Vision OCR provider is configured but not yet implemented.');
  err.code = 'VISION_NOT_IMPLEMENTED';
  throw err;
}
