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

// Ancestor codes of a DSR code, nearest first: '11.22.1.1' -> ['11.22.1', '11.22'].
// STOPS at two segments — '11.26' -> '11' is a CHAPTER, not an item, and inheriting
// a chapter-wide coefficient would be meaningless.
function baseCodesOf(code) {
  const parts = String(code).split('.');
  const out = [];
  for (let i = parts.length - 1; i >= 2; i--) out.push(parts.slice(0, i).join('.'));
  return out;
}

// Would inheriting from `code` be unsafe? YES if its entry reads like a GROUP HEADING
// rather than a priced item.
//
// This guard is load-bearing, not defensive padding. Two shapes of parent exist:
//   • a real priced item whose sub-codes share its value — `11.26` Kota stone 0.1491,
//     billed as `11.26.1`. Inheriting is correct.
//   • a group heading whose leaves each have their OWN value — `17.4` "Fixing white
//     vitreous china urinal basin :" over 17.4.1/.2/.3/.4 = 0.025/0.04/0.067/0.095.
//     Inheriting would hand every variant the FIRST one's value.
// The book's convention marks a heading with a trailing ':'. The second test catches
// headings the extractor mangled: it failed to see the child's code, so it absorbed
// the child's row — leaving the child's token inside this leaf_desc AND (worse) the
// child's coefficient on the parent. Those parents are themselves mis-extracted; see
// the phantom-parent note in the cement extraction guide.
//
// Measured against the BSNL VFP database: without the guard, 194 codes resolve but 21
// are WRONG (all 21 trace to phantom parents 17.4/17.5/17.6/17.61/20.2A). With it,
// 164 resolve and 0 are wrong — it blocks exactly the 21, costing 9 conservative
// refusals. For a cement register, silently absent is recoverable; silently wrong is not.
function isGroupHeading(entry, code) {
  const leaf = String(entry.leaf_desc || '').trim();
  if (leaf.endsWith(':')) return true;
  return new RegExp(`(?<![\\d.])${code.replace(/\./g, '\\.')}\\.\\d`).test(leaf);
}

// Exact-code lookup, with a guarded base-code fallback.
//
// The Vol-2 appendix often prints ONE coefficient against a parent code while a bill
// legitimately cites a sub-code (`11.26` -> `11.26.1`). Without a fallback those items
// silently get NO cement at all. 164 such inheritances are independently confirmed by
// the BSNL VFP database, where the same sub-codes carry exactly their parent's value —
// this is what a real government estimating app does. See [[third-party-vfp-databases]].
//
// A fallback hit is reported as matchType:'base' with the ancestor in `matchedCode`, so
// the UI flags it rather than passing it off as an exact match.
// Returns { code: { description, unit, coeff, leaf_desc, group_desc, full_desc,
//                   source_page, matchType:'exact'|'base', matchedCode } }
export function coeffsFor(codes = []) {
  const db = load();
  const out = {};
  for (const raw of codes) {
    const code = String(raw || '').trim();
    if (!code) continue;
    if (db[code]) {
      out[code] = { ...db[code], matchType: 'exact', matchedCode: code };
      continue;
    }
    const base = baseCodesOf(code).find((b) => db[b] && !isGroupHeading(db[b], b));
    if (base) {
      out[code] = { ...db[base], matchType: 'base', matchedCode: base };
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
        // Both carried so the Cement sheet's "Keep full description" tick can
        // toggle between them on desc/code-matched rows too, not just exact ones.
        leaf_desc: entry.leaf_desc || '',
        full_desc: entry.full_desc || entry.description || '',
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
        // Both carried so the Cement sheet's "Keep full description" tick can
        // toggle between them on desc/code-matched rows too, not just exact ones.
        leaf_desc: entry.leaf_desc || '',
        full_desc: entry.full_desc || entry.description || '',
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
