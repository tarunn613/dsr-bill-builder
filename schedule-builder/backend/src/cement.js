// Cement coefficient lookup — DSR 2023 Vol-2 "Coefficients for Cement Consumption"
// appendix, extracted to backend/data/cement_coeff.json (491 codes, keyed by DSR code).
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
let DB = null;

function load() {
  if (DB) return DB;
  try {
    const raw = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'cement_coeff.json'), 'utf8'));
    DB = raw.codes || {};
  } catch {
    DB = {};
  }
  return DB;
}

// Exact-code lookup for a set of DSR codes.
// Returns { code: { description, unit, coeff, leaf_desc, group_desc, full_desc, source_page, matchType:'exact' } }
export function coeffsFor(codes = []) {
  const db = load();
  const out = {};
  for (const raw of codes) {
    const code = String(raw || '').trim();
    if (code && db[code]) {
      out[code] = { ...db[code], matchType: 'exact' };
    }
  }
  return out;
}

// Description-based fallback search.
// Looks for mix/spec keywords (e.g. "1:4", "1:2:4", "1:6") in both
// the query description and the DB descriptions.
// Returns an array of { code, unit, coeff, description, source_page, matchType:'desc', score }
// sorted by descending score. Caller picks the best candidate.
export function searchByDesc(desc = '', limit = 5) {
  if (!desc || !desc.trim()) return [];
  const db = load();
  const query = desc.toLowerCase();

  // Extract mix ratios from the query (e.g. "1:4", "1:2:4", "1:1½:3", "1:6")
  const ratioRe = /\d+(?:[:\s]+\d+(?:½)?)+/g;
  const queryRatios = (query.match(ratioRe) || []).map((r) => r.replace(/\s+/g, ':'));

  const results = [];
  for (const [code, entry] of Object.entries(db)) {
    const entryText = (entry.full_desc || entry.description || '').toLowerCase();
    let score = 0;

    // Ratio match — highest weight
    for (const ratio of queryRatios) {
      if (entryText.includes(ratio)) score += 50;
    }

    // Keyword match — moderate weight
    const queryWords = query.split(/\W+/).filter((w) => w.length > 3);
    for (const word of queryWords) {
      if (entryText.includes(word)) score += 5;
    }

    if (score > 0) {
      results.push({
        code,
        unit: entry.unit,
        coeff: entry.coeff,
        description: entry.full_desc || entry.description || entry.leaf_desc || '',
        source_page: entry.source_page,
        matchType: 'desc',
        score,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// Code-based search — partial/prefix match on DSR codes.
// Returns an array sorted by code similarity.
export function searchByCode(codeQuery = '', limit = 10) {
  if (!codeQuery || !codeQuery.trim()) return [];
  const db = load();
  const q = codeQuery.trim().toLowerCase();
  const results = [];

  for (const [code, entry] of Object.entries(db)) {
    const codeLower = code.toLowerCase();
    let score = 0;

    if (codeLower === q) {
      score = 200;                      // exact match
    } else if (codeLower.startsWith(q)) {
      score = 100 - codeLower.length;   // prefix match, shorter = better
    } else if (codeLower.includes(q)) {
      score = 50;                       // substring match
    }

    if (score > 0) {
      results.push({
        code,
        unit: entry.unit,
        coeff: entry.coeff,
        description: entry.full_desc || entry.description || entry.leaf_desc || '',
        source_page: entry.source_page,
        matchType: 'code',
        score,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// Combined search — searches by both code and description, deduplicates, merges.
export function searchCombined(query = '', limit = 10) {
  if (!query || !query.trim()) return [];
  const byCode = searchByCode(query, limit);
  const byDesc = searchByDesc(query, limit);

  // Merge, deduplicating by code. Code matches get priority.
  const seen = new Set();
  const merged = [];
  for (const r of byCode) {
    seen.add(r.code);
    merged.push(r);
  }
  for (const r of byDesc) {
    if (!seen.has(r.code)) {
      seen.add(r.code);
      merged.push(r);
    }
  }
  return merged.slice(0, limit);
}

export function cementCount() { return Object.keys(load()).length; }
