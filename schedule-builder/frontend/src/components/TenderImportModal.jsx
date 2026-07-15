import React, { useState } from 'react';
import { parseTenderImport } from '../api.js';

// "Import tender details from JSON" — the Schedule → Bill page's companion to
// JsonImportModal. The user gives the built-in prompt + the award letter / work
// order to a vision AI, pastes the JSON back, reviews every field, and applies
// it to the Bill Header (and the quoted rate box).
//
// Two deliberate choices, both because this ends up on a bill that gets signed:
//   • the model transcribes VERBATIM — no abbreviating, no normalising. Editing
//     is the user's job, in the review step.
//   • Date of start / completion are never auto-filled. The letter states a
//     formula ("90 days, reckoned from 15 days after issue"), but the real
//     agreement dates can differ from it, so the computed pair is only ever
//     offered as a suggestion the user clicks to accept.

export const TENDER_PROMPT = `You are extracting the tender details from the attached award letter / work order (a "Letter of Award" issued to a contractor — PDF pages or images) into strict JSON. Output ONLY the JSON, inside a single fenced code block (\`\`\`json ... \`\`\`) so your reply shows it as a copy-able box instead of plain chat text — no explanation, no text before or after the code block.

Return exactly this shape:

{
  "award_letter": {
    "letter_no": "string",
    "letter_date": "YYYY-MM-DD",
    "department": "string or null",
    "issuing_office": "string or null",
    "signatory": "string or null"
  },
  "agency": { "name": "string", "address": "string or null" },
  "work": { "scheme_name": "string", "sub_head": "string", "project_id": "string or null" },
  "tender": { "nit_no": "string or null", "tender_id": "string or null" },
  "amounts": {
    "quoted_amount": 0.0,
    "quoted_amount_words": "string",
    "estimated_cost": 0.0,
    "estimated_cost_words": "string",
    "quoted_percent": 0.0,
    "quoted_direction": "below" | "above"
  },
  "performance_guarantee": { "amount": 0.0, "amount_words": "string or null", "submit_within_days": 0 },
  "time_allowed": { "days": 0, "reckoned_from_days_after_letter": 0 }
}

Rules:
1. Transcribe what is PRINTED, verbatim. Do not abbreviate, expand, translate, tidy, or re-title anything. Copy the scheme name in full ("Environmental Improvement in Urban Slums (Capital)" stays exactly that — never shorten it to an acronym), and keep the agency exactly as addressed, including any "M/s." prefix.
2. letter_no — the letter's own reference number from the "NO." line at the top left, as one string, keeping every slash and hyphen (e.g. "AL-00/EEX-0/DUSIB/AE-I/2025-26/D-000"). Collapse runs of spaces, but change nothing else.
3. letter_date — the "Dated:" value at the top right. It is printed DAY-MONTH-YEAR (e.g. "21-02-2026" means 21 February 2026). Output it as YYYY-MM-DD ("2026-02-21"). Never swap day and month.
4. scheme_name — the value printed against "Name of Scheme".
5. sub_head — the value printed against "Sub Head", but WITHOUT any leading boiler-plate label such as "NOW:", "EIUS (Capital) Sub. Head:" or similar. Keep the actual description of the work, including its locality, assembly-constituency code and any trailing "(Project ID ...)" text as printed.
6. project_id — the digits printed as "Project ID" / "PID" inside the sub head, as a string, keeping any leading zeros ("000012345"). null if not printed.
7. nit_no — just the NIT number itself ("104", not "NIT No.104"). tender_id — the full tender id ("2026_DUSIB_000000_1").
8. quoted_amount — the contractor's accepted/quoted tender amount ("Your tender ... has been accepted ... at your quoted tender amount of Rs. ..."). estimated_cost — the department's estimated cost that the quote is compared against ("... below/above the estimated cost of Rs. ..."). Never swap these two: the quoted amount is the contractor's price, the estimated cost is the department's, and on a "below" tender the quoted amount is the SMALLER number.
9. All amounts are JSON numbers, never strings: strip "Rs.", "₹", "/-" and every comma. Indian digit grouping ("12,34,567") means 1234567 — not 1234.567.
10. *_words — the amount as spelled out in the brackets right after the figure, copied exactly as printed INCLUDING any misspelling (these letters really do print "Fourty" and "Ninty"). Do not correct it; it is used to double-check the digits.
11. quoted_percent — the percentage the quote is below/above the estimate ("which is 00.00% below ..."), as a number (25.9). quoted_direction — "below" or "above", whichever the letter prints.
12. time_allowed.days — the number of days allowed for carrying out the work ("the time allowed for carrying out the work as entered in the tender 90 days"). reckoned_from_days_after_letter — the offset it is reckoned from ("shall be reckoned from 15 days after the date of issue of this letter"). These are two different numbers; do not confuse them.
13. performance_guarantee.amount / submit_within_days — the performance security/guarantee figure and the number of days allowed to submit it ("within 07 days" → 7).
14. Use null for anything genuinely not printed on the letter. Do not invent, infer, or carry over a value from another document. Do not compute any date — only letter_date is a date, and it is printed.
15. Output must be valid JSON: double-quoted keys and strings, no trailing commas, no comments.

Before answering, re-read each amount and check it against its own words in brackets — if the digits and the words disagree, you misread one of them; fix it before replying.`;

const FIELD_LABELS = [
  ['workName', 'Name of work'],
  ['subHead', 'Sub-head'],
  ['agency', 'Agency'],
  ['workNo', 'Agreement / Work No.'],
  ['tenderAmount', 'Tender amount'],
  ['estimateAmount', 'Estimate amount'],
];

export default function TenderImportModal({ onApply, onClose }) {
  const [phase, setPhase] = useState('paste'); // paste | review
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const [copied, setCopied] = useState(false);

  const [meta, setMeta] = useState({});
  const [rates, setRates] = useState({ quotedPct: null, quotedType: null });
  const [checks, setChecks] = useState([]);
  const [dateSuggestion, setDateSuggestion] = useState(null);
  const [dates, setDates] = useState({ dateStart: '', dateCompletion: '' });

  function copyPrompt() {
    navigator.clipboard?.writeText(TENDER_PROMPT).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  async function run() {
    setBusy(true); setError('');
    try {
      const res = await parseTenderImport(text);
      setMeta(res.meta || {});
      setRates(res.rates || { quotedPct: null, quotedType: null });
      setChecks(res.checks || []);
      setDateSuggestion(res.dateSuggestion || null);
      setDates({ dateStart: '', dateCompletion: '' });
      setPhase('review');
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function useSuggestedDates() {
    if (!dateSuggestion) return;
    setDates({ dateStart: dateSuggestion.dateStart, dateCompletion: dateSuggestion.dateCompletion });
  }

  function apply() {
    const out = { ...meta };
    if (dates.dateStart) out.dateStart = dates.dateStart;
    if (dates.dateCompletion) out.dateCompletion = dates.dateCompletion;
    onApply({ meta: out, rates });
    onClose();
  }

  const warnCount = checks.filter((c) => c.level === 'warn').length;

  return (
    <div className="ocr-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && phase === 'paste') onClose(); }}>
      <div className="ocr-modal" role="dialog" aria-modal="true">
        <header className="ocr-head">
          <div>
            <h2>Import Tender Details from JSON</h2>
            <span className="ocr-sub">Paste the JSON your vision AI read from the award letter / work order &amp; check every field before filling the bill header</span>
          </div>
          <button className="ocr-x" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {error && <div className="banner err">{error}</div>}

        {/* ---- 1. PASTE ---- */}
        {phase === 'paste' && (
          <div className="ocr-body ocr-pick">
            <button type="button" className="linkbtn jsonimp-prompt-toggle" onClick={() => setShowPrompt((v) => !v)}>
              {showPrompt ? '▾' : '▸'} Prompt to generate this JSON from a vision AI (Claude / GPT-4V / Gemini…)
            </button>
            {showPrompt && (
              <div className="jsonimp-prompt-box">
                <textarea readOnly rows={9} value={TENDER_PROMPT} onFocus={(e) => e.target.select()} />
                <div className="jsonimp-prompt-actions">
                  <span className="hint">Give this to your vision model along with the award letter (PDF/photo), then paste its JSON output below.</span>
                  <button type="button" className="ghost" onClick={copyPrompt}>{copied ? 'Copied ✓' : 'Copy prompt'}</button>
                </div>
              </div>
            )}

            <label className="field jsonimp-textarea-field">
              <span>Paste the JSON here</span>
              <textarea
                rows={12}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder='{ "award_letter": { "letter_no": "...", "letter_date": "2026-02-21" }, "agency": { ... }, "work": { ... }, "amounts": { ... } }'
              />
            </label>

            <div className="ocr-actions">
              <button className="ghost" onClick={onClose}>Cancel</button>
              <button className="primary" disabled={busy || !text.trim()} onClick={run}>
                {busy ? 'Reading…' : 'Read details'}
              </button>
            </div>
          </div>
        )}

        {/* ---- 2. REVIEW ---- */}
        {phase === 'review' && (
          <div className="ocr-body">
            {checks.length > 0 && (
              <div className={'banner ' + (warnCount ? 'err' : 'ok')} style={{ textAlign: 'left' }}>
                <strong>
                  {warnCount
                    ? `${warnCount} cross-check${warnCount > 1 ? 's' : ''} failed — verify against the letter before applying`
                    : 'All cross-checks passed (amounts match their words, and the quoted % reconciles)'}
                </strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {checks.map((c, i) => (
                    <li key={i} style={{ color: c.level === 'warn' ? '#b91c1c' : '#15803d' }}>
                      <b>{c.label}:</b> {c.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="hint" style={{ margin: '4px 0 10px' }}>
              Read verbatim from the letter — edit anything here before it goes into the bill header.
            </p>

            {FIELD_LABELS.map(([k, label]) => (
              <label className="field" key={k}>
                <span>{label}</span>
                {k === 'subHead' ? (
                  <textarea rows={2} value={meta[k] || ''} onChange={(e) => setMeta((m) => ({ ...m, [k]: e.target.value }))} />
                ) : (
                  <input value={meta[k] || ''} onChange={(e) => setMeta((m) => ({ ...m, [k]: e.target.value }))} />
                )}
              </label>
            ))}

            <label className="field">
              <span>Quoted rate</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="number" step="any" style={{ maxWidth: 120 }}
                  value={rates.quotedPct ?? ''}
                  onChange={(e) => setRates((r) => ({ ...r, quotedPct: e.target.value === '' ? null : Number(e.target.value) }))}
                />
                <span>%</span>
                <select
                  value={rates.quotedType || 'below'}
                  onChange={(e) => setRates((r) => ({ ...r, quotedType: e.target.value }))}
                >
                  <option value="below">below</option>
                  <option value="above">above</option>
                </select>
                <span className="hint">of the estimated cost</span>
              </div>
            </label>

            <label className="field">
              <span>Date of start / completion</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  style={{ maxWidth: 140 }} placeholder="Date of start"
                  value={dates.dateStart}
                  onChange={(e) => setDates((d) => ({ ...d, dateStart: e.target.value }))}
                />
                <input
                  style={{ maxWidth: 160 }} placeholder="Date of completion"
                  value={dates.dateCompletion}
                  onChange={(e) => setDates((d) => ({ ...d, dateCompletion: e.target.value }))}
                />
              </div>
            </label>
            {dateSuggestion ? (
              <p className="hint" style={{ marginTop: -4 }}>
                The letter implies <b>{dateSuggestion.dateStart}</b> → <b>{dateSuggestion.dateCompletion}</b> ({dateSuggestion.basis}).
                The agreement's actual dates often differ, so these are left blank unless you want them.{' '}
                <button type="button" className="linkbtn" onClick={useSuggestedDates}>Use these dates</button>
              </p>
            ) : (
              <p className="hint" style={{ marginTop: -4 }}>
                The letter didn’t give enough to work these out — type them in if you need them.
              </p>
            )}

            <div className="ocr-actions">
              <button className="ghost" onClick={() => setPhase('paste')}>← Back</button>
              <button className="primary" onClick={apply}>Fill bill header</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
