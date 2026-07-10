// Loads the DSR JSON snapshot into memory and serves exact lookup + ranked search.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '..', 'data', 'dsr_items.json');

let ITEMS = [];
let META = { count: 0, carriage_count: 0 };

function load() {
  const raw = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  META = { count: raw.count, carriage_count: raw.carriage_count };
  ITEMS = raw.items.map((it) => ({
    ...it,
    _code: it.code.toLowerCase(),
    _desc: (it.description || '').toLowerCase(),
  }));
  return META;
}

// Natural, segment-aware ordering for codes like 4.1.10 vs 4.1.2
function codeCompare(a, b) {
  const pa = a.split(/[.\s]+/), pb = b.split(/[.\s]+/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = parseInt(pa[i], 10), nb = parseInt(pb[i], 10);
    const va = isNaN(na) ? pa[i] || '' : na;
    const vb = isNaN(nb) ? pb[i] || '' : nb;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

function publicRow(it) {
  return {
    code: it.code,
    description: it.description,
    unit: it.unit,
    rate: it.rate,
    rate_options: it.rate_options,
    carriage: it.carriage,
    volume: it.volume,
    source_page: it.source_page,
  };
}

// All rows whose code matches exactly (usually 1; >1 for same-code rate variants).
function lookup(code) {
  const q = String(code || '').trim().toLowerCase();
  if (!q) return [];
  return ITEMS.filter((it) => it._code === q).map(publicRow);
}

function scoreItem(it, q, tokens) {
  // code scoring
  let codeScore = 0;
  if (it._code === q) codeScore = 1000;
  else if (it._code.startsWith(q)) codeScore = 600 - it._code.length;
  else if (q.length >= 2 && it._code.includes(q)) codeScore = 250;

  // description scoring: reward rows containing all tokens
  let descScore = 0;
  if (tokens.length) {
    let hits = 0, firstIdx = Infinity;
    for (const t of tokens) {
      const idx = it._desc.indexOf(t);
      if (idx >= 0) { hits++; firstIdx = Math.min(firstIdx, idx); }
    }
    if (hits === tokens.length) descScore = 300 - Math.min(firstIdx, 200);
    else if (hits > 0) descScore = 60 * hits;
  }
  return Math.max(codeScore, descScore);
}

function search(q, limit = 25) {
  q = String(q || '').trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  const scored = [];
  for (const it of ITEMS) {
    const s = scoreItem(it, q, tokens);
    if (s > 0) scored.push([s, it]);
  }
  scored.sort((a, b) => (b[0] - a[0]) || codeCompare(a[1].code, b[1].code));
  return scored.slice(0, limit).map(([, it]) => publicRow(it));
}

export { load, search, lookup, publicRow };
export const meta = () => META;
