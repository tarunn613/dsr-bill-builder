import React, { useEffect, useRef, useState } from 'react';
import { parseJsonImport, rematchJsonRow } from '../api.js';

// A full-screen "JSON import workspace" that opens over the DSR → Schedule
// page — the companion to OcrImportModal for when the user already has a
// vision-AI model's JSON reading of a Schedule of Work (instead of scanning
// the PDF/image themselves through the app):
//   1. paste the JSON (a copy-ready prompt for generating it is built in)
//   2. standard_items are matched against the DSR DB; special_items are kept
//      as read (their rate isn't in any database)
//   3. review/edit every row before it's added, same as the OCR flow
//   4. apply — rows land in the schedule in the source sheet's s_no order.

export const VISION_PROMPT = `You are extracting a "Schedule of Work" / Bill of Quantities table from the attached document (PDF pages or images) into strict JSON. Output ONLY the JSON, inside a single fenced code block (\`\`\`json ... \`\`\`) so your reply shows it as a copy-able box instead of plain chat text — no explanation, no text before or after the code block.

Return exactly this shape:

{
  "standard_items": [
    { "s_no": "string", "type": "DSR", "dsr_code": "string or null", "description": "string", "quantity": 0.0, "unit": "string", "rate": 0.0 }
  ],
  "special_items": [
    { "s_no": "string", "type": "MKT" | "Appd.", "description": "string", "quantity": 0.0, "unit": "string", "rate": 0.0 }
  ]
}

Rules:
1. One entry per priced line item in the table, in reading order, top to bottom, continuing across every page/image as a single document — do not restart s_no per page.
2. s_no — the item's own serial number exactly as printed in the left-most "S.No" / "Item No." column (e.g. "1", "12", "5A"). Always a string, even when it's purely numeric. Never invent one for rows that aren't real line items (see the skip list below).
3. type — copy the item's category using EXACTLY one of these three literal strings (case-sensitive, including the period on "Appd."):
   - "DSR" — a normal item priced against a DSR schedule reference number.
   - "Appd." — an appended / non-schedule item (also printed as "Apd.", "Appendix", or "NS" — normalize all of these to "Appd.").
   - "MKT" — a market-rate item (also printed as "M.R." or "Market Rate" — normalize to "MKT").
   Put every "DSR" item in standard_items, and every "Appd."/"MKT" item in special_items — nothing else goes in either array.
4. dsr_code (standard_items only) — the DSR reference number exactly as printed, preserving every dot (e.g. "15.2.1", "23.1.1.1", "18.72A"). If the row is type "DSR" but the code is blank, smudged, or unreadable, use null — do not guess a code, but still fill in description/quantity/unit/rate from what you can read.
5. description — transcribe the printed text as-is. Do not summarize, translate, expand abbreviations, or add anything that isn't printed.
6. quantity and rate — numbers only (JSON float), never strings. Strip thousand separators, currency symbols (₹, Rs.) and units. Read carefully; only use 0 as a last resort if a value is genuinely illegible.
7. unit — the printed abbreviation exactly as shown (e.g. "Cum", "Sqm", "Rmt", "Kg", "Nos", "Each", "Litre") — do not normalize its case or expand it.
8. Skip rows that are not priced line items: section/group headings with no quantity or rate, "Total", "Total Carried Forward", "Brought Forward", "Say", "Grand Total", multiplying-factor / cost-index footnote lines, page headers/footers, and signature blocks.
9. If the table spans multiple pages or images, treat them as one continuous document — don't repeat a header row as an item, and keep s_no increasing across the page break exactly as printed.
10. Output must be valid JSON: double-quoted keys and strings, no trailing commas, no comments. If a document has no items of one kind, still include that array, empty ([]).

Before answering, cross-check every dsr_code against the description on the same line — a code whose description doesn't match a plausible item for that code is more likely a misread digit than a genuine mismatch; if unsure, prefer null over a guessed code.`;

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()));
const num = (s) => String(s ?? '').replace(/[^0-9.]/g, '');

const STATUS = {
  matched: { cls: 'ok', label: 'Matched' },
  ambiguous: { cls: 'warn', label: 'Check' },
  guess: { cls: 'warn', label: 'Verify' },
  notfound: { cls: 'bad', label: 'Not found' },
  manual: { cls: 'muted', label: 'Manual' },
};

// One review row → the schedule item shape(s) used by the page. Mirrors
// OcrImportModal's rowToItems (see that file for the fuller rationale) —
// duplicated rather than shared since each modal owns its own conversion.
function rowToItems(rows, { useBookRate }) {
  const dsrItems = [];
  const marketItems = [];
  for (const r of rows) {
    if (!r.include) continue;
    const qty = num(r.qty);
    if (r.category === 'MKT') {
      marketItems.push({ id: uuid(), sno: r.s_no || '', ref: r.code || 'MKT', description: r.description || '', unit: r.unit || '', rate: num(r.rate), qty });
      continue;
    }
    const isDsr = r.category === 'DSR';
    const carriage = !!r.carriage;
    const bookRate = isDsr && !carriage && r.rate != null && r.rate !== '' ? num(r.rate) : '';
    dsrItems.push({
      id: uuid(),
      sno: r.s_no || '',
      category: r.category || 'DSR',
      ref: r.code || '', code: r.code || '',
      description: r.description || '', unit: r.unit || '',
      rate: carriage ? '' : (isDsr ? (useBookRate ? bookRate : '') : num(r.rate)),
      qty,
      carriage, rateOptions: r.rateOptions || null, lead: '',
      bookRate, override: isDsr && !carriage && !useBookRate,
    });
  }
  return { dsrItems, marketItems };
}

export default function JsonImportModal({ onClose, onApply }) {
  const [phase, setPhase] = useState('paste'); // paste | review | error
  const [text, setText] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [rows, setRows] = useState([]);
  const [useBookRate, setUseBookRate] = useState(true);
  const timers = useRef({});

  // Esc closes; lock body scroll while open.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  async function parse() {
    if (!text.trim()) { setError('Paste the JSON first.'); return; }
    setBusy(true); setError('');
    try {
      const res = await parseJsonImport(text);
      setResult(res);
      setRows(res.rows.map((r) => ({ ...r, include: r.match !== 'notfound' })));
      setPhase('review');
    } catch (e) {
      setError(e.message || String(e));
      setPhase('error');
    } finally {
      setBusy(false);
    }
  }

  const patch = (id, changes) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...changes } : r)));
  const removeRow = (id) => setRows((rs) => rs.filter((r) => r.id !== id));

  // Re-match a DSR code the user edited → adopt the canonical DSR fields.
  // Only DSR rows have a database row to re-match against — Appd./MKT rates
  // are never looked up (they don't exist in the DSR book).
  function onCodeEdit(row, code) {
    patch(row.id, { code });
    if (row.category !== 'DSR') return;
    clearTimeout(timers.current[row.id]);
    timers.current[row.id] = setTimeout(async () => {
      const m = await rematchJsonRow(code, row.description);
      if (!m) return;
      patch(row.id, {
        match: m.status, confidence: m.confidence, candidates: m.candidates || [],
        ...(m.item ? {
          code: m.code, description: m.item.description, unit: m.item.unit,
          rate: m.item.rate, carriage: m.item.carriage, rateOptions: m.item.rate_options || null,
        } : {}),
      });
    }, 400);
  }

  function pickCandidate(row, cand) {
    patch(row.id, {
      code: cand.code, description: cand.description, unit: cand.unit,
      rate: cand.rate, carriage: cand.carriage, rateOptions: cand.rate_options || null,
      match: 'matched', confidence: 0.95, candidates: [],
    });
  }

  function copyPrompt() {
    navigator.clipboard?.writeText(VISION_PROMPT).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function apply() {
    const { dsrItems, marketItems } = rowToItems(rows, { useBookRate });
    onApply({ dsrItems, marketItems, meta: {} });
    onClose();
  }

  const included = rows.filter((r) => r.include).length;
  const needReview = rows.filter((r) => r.include && (r.match === 'ambiguous' || r.match === 'guess' || r.match === 'notfound')).length;

  return (
    <div className="ocr-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && phase === 'paste') onClose(); }}>
      <div className="ocr-modal" role="dialog" aria-modal="true">
        <header className="ocr-head">
          <div>
            <h2>Import Schedule from JSON</h2>
            <span className="ocr-sub">Paste the JSON your vision AI read from a Schedule of Work &amp; cross-check every DSR item before adding</span>
          </div>
          <button className="ocr-x" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {error && phase !== 'error' && <div className="banner err">{error}</div>}

        {/* ---- 1. PASTE ---- */}
        {phase === 'paste' && (
          <div className="ocr-body ocr-pick">
            <button type="button" className="linkbtn jsonimp-prompt-toggle" onClick={() => setShowPrompt((v) => !v)}>
              {showPrompt ? '▾' : '▸'} Prompt to generate this JSON from a vision AI (Claude / GPT-4V / Gemini…)
            </button>
            {showPrompt && (
              <div className="jsonimp-prompt-box">
                <textarea readOnly rows={9} value={VISION_PROMPT} onFocus={(e) => e.target.select()} />
                <div className="jsonimp-prompt-actions">
                  <span className="hint">Give this to your vision model along with the scanned PDF/images, then paste its JSON output below.</span>
                  <button type="button" className="ghost" onClick={copyPrompt}>{copied ? 'Copied ✓' : 'Copy prompt'}</button>
                </div>
              </div>
            )}

            <label className="field jsonimp-textarea-field">
              <span>Paste the JSON here</span>
              <textarea
                rows={14}
                placeholder={'{\n  "standard_items": [ ... ],\n  "special_items": [ ... ]\n}'}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>

            <div className="ocr-pick-actions">
              <button className="ghost" onClick={onClose}>Cancel</button>
              <button className="primary" disabled={!text.trim() || busy} onClick={parse}>{busy ? 'Parsing…' : 'Parse JSON →'}</button>
            </div>
          </div>
        )}

        {/* ---- error ---- */}
        {phase === 'error' && (
          <div className="ocr-body ocr-processing">
            <div className="ocr-drop-icon" style={{ color: '#b91c1c' }}>⚠</div>
            <div className="ocr-progress-label">Couldn’t read that JSON</div>
            <div className="hint" style={{ maxWidth: 460, textAlign: 'center' }}>{error}</div>
            <div className="ocr-pick-actions" style={{ marginTop: 18 }}>
              <button className="ghost" onClick={onClose}>Close</button>
              <button className="primary" onClick={() => setPhase('paste')}>Try again</button>
            </div>
          </div>
        )}

        {/* ---- 2. REVIEW ---- */}
        {phase === 'review' && result && (
          <div className="ocr-body ocr-review">
            <div className="ocr-review-bar">
              <div className="ocr-stats">
                <span className="ocr-chip ok">{result.stats.matched} matched</span>
                {needReview > 0 && <span className="ocr-chip warn">{needReview} to check</span>}
                <span className="ocr-chip muted">{included} selected of {rows.length}</span>
              </div>
              <div className="ocr-options">
                <label className="ocr-toggle"><input type="checkbox" checked={useBookRate} onChange={(e) => setUseBookRate(e.target.checked)} /> Use DSR book rates</label>
              </div>
            </div>

            {result.warnings?.length > 0 && (
              <div className="ocr-meta-note">
                {result.warnings.length} note{result.warnings.length === 1 ? '' : 's'} while reading the JSON:
                <ul className="jsonimp-warnings">
                  {result.warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}
                  {result.warnings.length > 6 && <li>…and {result.warnings.length - 6} more</li>}
                </ul>
              </div>
            )}

            <div className="ocr-table-wrap">
              <table className="ocr-table">
                <thead>
                  <tr>
                    <th className="c-inc"><span title="Include in schedule">✓</span></th>
                    <th className="c-st">Status</th>
                    <th className="c-ty">Type</th>
                    <th className="c-cd">DSR Code</th>
                    <th className="c-ds">Description</th>
                    <th className="c-qt">Qty</th>
                    <th className="c-un">Unit</th>
                    <th className="c-rt">Rate ₹</th>
                    <th className="c-sn">Src #</th>
                    <th className="c-rm" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const st = STATUS[r.match] || STATUS.manual;
                    return (
                      <tr key={r.id} className={r.include ? '' : 'off'}>
                        <td className="c-inc"><input type="checkbox" checked={r.include} onChange={(e) => patch(r.id, { include: e.target.checked })} /></td>
                        <td className="c-st"><span className={'ocr-badge ' + st.cls} title={`confidence ${(Math.round((r.confidence || 0) * 100))}%`}>{st.label}</span></td>
                        <td className="c-ty">
                          <select value={r.category} onChange={(e) => patch(r.id, { category: e.target.value })}>
                            <option>DSR</option><option>Appd.</option><option>MKT</option>
                          </select>
                        </td>
                        <td className="c-cd">
                          <input value={r.code || ''} placeholder={r.category === 'MKT' ? '—' : 'code'} onChange={(e) => onCodeEdit(r, e.target.value)} />
                          {r.match === 'ambiguous' && r.candidates?.length > 1 && (
                            <select className="ocr-cands" value="" onChange={(e) => { const c = r.candidates.find((x) => x.code === e.target.value); if (c) pickCandidate(r, c); }}>
                              <option value="">{r.candidates.length} options…</option>
                              {r.candidates.map((c) => <option key={c.code} value={c.code}>{c.code} — {String(c.description).slice(0, 40)}</option>)}
                            </select>
                          )}
                        </td>
                        <td className="c-ds"><textarea rows={2} value={r.description || ''} onChange={(e) => patch(r.id, { description: e.target.value })} /></td>
                        <td className="c-qt"><input value={r.qty || ''} onChange={(e) => patch(r.id, { qty: e.target.value })} /></td>
                        <td className="c-un"><input value={r.unit || ''} onChange={(e) => patch(r.id, { unit: e.target.value })} /></td>
                        <td className="c-rt"><input value={r.carriage ? '' : (r.rate ?? '')} placeholder={r.carriage ? 'lead' : ''} disabled={r.carriage} onChange={(e) => patch(r.id, { rate: e.target.value })} /></td>
                        <td className="c-sn" title="serial number from the source JSON">{r.s_no}</td>
                        <td className="c-rm"><button className="del-btn" onClick={() => removeRow(r.id)} title="remove row">✕</button></td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && <tr><td colSpan={10} className="empty">No items were parsed.</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="ocr-review-actions">
              <span className="hint">Rows follow the JSON's own s_no order · amber rows were guessed or ambiguous — verify the code and description before adding.</span>
              <div className="spacer" />
              <button className="ghost" onClick={onClose}>Cancel</button>
              <button className="primary" disabled={included === 0} onClick={apply}>Add {included} item{included === 1 ? '' : 's'} to schedule</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
