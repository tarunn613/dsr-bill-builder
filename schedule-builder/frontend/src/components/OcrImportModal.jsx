import React, { useEffect, useRef, useState } from 'react';
import { ENGINES, runOcrImport, rematchCode, fetchEngineStatus, visionConfigured } from '../ocr/index.js';

// A full-screen "OCR workspace" that opens over the DSR → Schedule page:
//   1. pick a scanned PDF + recognition engine
//   2. watch a live progress bar while pages are recognised & matched
//   3. review/edit the extracted rows (cross-checked against the DSR DB)
//   4. apply them into the schedule.

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()));
const num = (s) => String(s ?? '').replace(/[^0-9.]/g, '');
const fmt = (r) => (r === '' || r == null ? '' : Number(r).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const STATUS = {
  matched: { cls: 'ok', label: 'Matched' },
  ambiguous: { cls: 'warn', label: 'Check' },
  guess: { cls: 'warn', label: 'Verify' },
  notfound: { cls: 'bad', label: 'Not found' },
  manual: { cls: 'muted', label: 'Manual' },
};

// One review row → the schedule item shape(s) used by the page.
//  • MKT → a market item (rate at par, from OCR).
//  • DSR → book rate carried in (read-only) unless "Use DSR book rates" is off,
//    in which case the row is flagged as an override with a blank rate for the
//    user's own quoted figure (the book rate is kept for the deviation warning).
//  • Appd./NS → editable rate straight from OCR (no DSR book rate exists).
//  • Carriage items → blank rate; the user picks a lead in the schedule.
function rowToItems(rows, { autoQty, useBookRate }) {
  const dsrItems = [];
  const marketItems = [];
  for (const r of rows) {
    if (!r.include) continue;
    const qty = autoQty ? num(r.qty) : '';
    if (r.category === 'MKT') {
      marketItems.push({ id: uuid(), ref: r.code || 'MKT', description: r.description || '', unit: r.unit || '', rate: num(r.rate), qty });
      continue;
    }
    const isDsr = r.category === 'DSR';
    const carriage = !!r.carriage;
    const bookRate = isDsr && !carriage && r.rate != null && r.rate !== '' ? num(r.rate) : '';
    dsrItems.push({
      id: uuid(),
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

export default function OcrImportModal({ onClose, onApply }) {
  const [phase, setPhase] = useState('pick'); // pick | processing | review | error
  const [file, setFile] = useState(null);
  const [engine, setEngine] = useState('paddle');
  const [avail, setAvail] = useState({ tesseract: true, paddle: true });
  const [visionOn, setVisionOn] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState({ ratio: 0, label: '', phase: '' });
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [rows, setRows] = useState([]);
  const [autoQty, setAutoQty] = useState(true);
  const [useBookRate, setUseBookRate] = useState(true);
  const [lightbox, setLightbox] = useState(null);
  const timers = useRef({});

  useEffect(() => {
    fetchEngineStatus().then((s) => {
      setAvail(s);
      if (!s.paddle) setEngine('tesseract'); // fall back if the neural engine can't load here
    });
    visionConfigured().then(setVisionOn);
  }, []);

  // Esc closes; lock body scroll while open.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') (lightbox ? setLightbox(null) : onClose()); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, lightbox]);

  function pickFile(f) {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name)) { setError('Please choose a PDF file.'); return; }
    setError(''); setFile(f);
  }

  async function start() {
    if (!file) return;
    setPhase('processing'); setError(''); setProgress({ ratio: 0, label: 'Starting…', phase: 'render' });
    try {
      const res = await runOcrImport({ file, engine, onProgress: setProgress });
      setResult(res);
      setRows(res.rows.map((r) => ({ ...r, include: r.match !== 'notfound' })));
      setPhase('review');
    } catch (e) {
      setError(e.message || String(e));
      setPhase('error');
    }
  }

  const patch = (id, changes) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...changes } : r)));
  const removeRow = (id) => setRows((rs) => rs.filter((r) => r.id !== id));

  // Re-match a DSR code the user edited → adopt the canonical DSR fields.
  function onCodeEdit(row, code) {
    patch(row.id, { code });
    if (row.category === 'MKT') return;
    clearTimeout(timers.current[row.id]);
    timers.current[row.id] = setTimeout(async () => {
      const m = await rematchCode(code, row.ocrDescription || row.description);
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

  function apply() {
    const { dsrItems, marketItems } = rowToItems(rows, { autoQty, useBookRate });
    onApply({ dsrItems, marketItems, meta: result?.meta || {} });
    onClose();
  }

  const included = rows.filter((r) => r.include).length;
  const needReview = rows.filter((r) => r.include && (r.match === 'ambiguous' || r.match === 'guess' || r.match === 'notfound')).length;
  const thumbOf = (page) => result?.thumbs?.find((t) => t.index === page);

  return (
    <div className="ocr-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && phase === 'pick') onClose(); }}>
      <div className="ocr-modal" role="dialog" aria-modal="true">
        <header className="ocr-head">
          <div>
            <h2>Import Schedule from PDF</h2>
            <span className="ocr-sub">Scan a Schedule of Work &amp; cross-check every DSR item before adding</span>
          </div>
          <button className="ocr-x" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {error && phase !== 'error' && <div className="banner err">{error}</div>}

        {/* ---- 1. PICK ---- */}
        {phase === 'pick' && (
          <div className="ocr-body ocr-pick">
            <label
              className={'ocr-drop' + (dragOver ? ' over' : '') + (file ? ' has' : '')}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
            >
              <input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
              <div className="ocr-drop-icon">{file ? '📄' : '⬆'}</div>
              {file
                ? <><b>{file.name}</b><span className="hint">{(file.size / 1048576).toFixed(1)} MB — click to choose a different file</span></>
                : <><b>Drop a scanned PDF here</b><span className="hint">or click to browse</span></>}
            </label>

            <div className="ocr-engines">
              <div className="ocr-engines-title">Recognition engine</div>
              {ENGINES.map((e) => {
                const disabled = (e.id === 'paddle' && !avail.paddle) || (e.id === 'vision' && !visionOn);
                return (
                  <button
                    key={e.id}
                    className={'ocr-engine' + (engine === e.id ? ' on' : '') + (disabled ? ' disabled' : '')}
                    onClick={() => !disabled && setEngine(e.id)}
                    disabled={disabled}
                  >
                    <span className="ocr-engine-radio" />
                    <span className="ocr-engine-main">
                      <span className="ocr-engine-label">
                        {e.label}
                        {e.recommended && <em className="ocr-tag rec">Recommended</em>}
                        {e.id === 'vision' && !visionOn && <em className="ocr-tag setup">Setup required</em>}
                        {e.id === 'paddle' && !avail.paddle && <em className="ocr-tag setup">Unavailable here</em>}
                      </span>
                      <span className="ocr-engine-sub">{e.sub}</span>
                      <span className="ocr-engine-desc">{e.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="ocr-pick-actions">
              <button className="ghost" onClick={onClose}>Cancel</button>
              <button className="primary" disabled={!file} onClick={start}>Start OCR →</button>
            </div>
          </div>
        )}

        {/* ---- 2. PROCESSING ---- */}
        {phase === 'processing' && (
          <div className="ocr-body ocr-processing">
            <div className="ocr-spinner" />
            <div className="ocr-progress-label">{progress.label || 'Working…'}</div>
            <div className="ocr-bar"><div className="ocr-bar-fill" style={{ width: `${Math.round((progress.ratio || 0) * 100)}%` }} /></div>
            <div className="hint">{progress.phase === 'render' ? 'Rendering pages' : progress.phase === 'recognize' ? 'Reading text on each page' : 'Matching against the DSR database'}</div>
          </div>
        )}

        {/* ---- error ---- */}
        {phase === 'error' && (
          <div className="ocr-body ocr-processing">
            <div className="ocr-drop-icon" style={{ color: '#b91c1c' }}>⚠</div>
            <div className="ocr-progress-label">Couldn’t finish the scan</div>
            <div className="hint" style={{ maxWidth: 460, textAlign: 'center' }}>{error}</div>
            <div className="ocr-pick-actions" style={{ marginTop: 18 }}>
              <button className="ghost" onClick={onClose}>Close</button>
              <button className="primary" onClick={() => setPhase('pick')}>Try again</button>
            </div>
          </div>
        )}

        {/* ---- 3. REVIEW ---- */}
        {phase === 'review' && result && (
          <div className="ocr-body ocr-review">
            <div className="ocr-review-bar">
              <div className="ocr-stats">
                <span className="ocr-chip ok">{result.stats.matched} matched</span>
                {needReview > 0 && <span className="ocr-chip warn">{needReview} to check</span>}
                <span className="ocr-chip muted">{included} selected of {rows.length}</span>
              </div>
              <div className="ocr-options">
                <label className="ocr-toggle"><input type="checkbox" checked={autoQty} onChange={(e) => setAutoQty(e.target.checked)} /> Auto-fetch quantities</label>
                <label className="ocr-toggle"><input type="checkbox" checked={useBookRate} onChange={(e) => setUseBookRate(e.target.checked)} /> Use DSR book rates</label>
              </div>
            </div>

            {(result.meta?.factor || result.meta?.costIndexPct) && (
              <div className="ocr-meta-note">
                Detected on the sheet:
                {result.meta.factor && <b> multiplying factor {result.meta.factor}</b>}
                {result.meta.factor && result.meta.costIndexPct && ' ·'}
                {result.meta.costIndexPct && <b> cost index {result.meta.costIndexPct}%</b>}
                <span className="hint"> — these will be applied to the schedule’s factor fields.</span>
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
                    <th className="c-pg">Pg</th>
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
                            <option>DSR</option><option>Appd.</option><option>NS</option><option>MKT</option>
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
                        <td className="c-pg">{thumbOf(r.page) ? <button className="ocr-pglink" onClick={() => setLightbox(thumbOf(r.page))} title="view the scanned page">{r.page + 1}</button> : (r.page + 1)}</td>
                        <td className="c-rm"><button className="del-btn" onClick={() => removeRow(r.id)} title="remove row">✕</button></td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && <tr><td colSpan={10} className="empty">No items were detected. Try the other engine, or add rows manually.</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="ocr-review-actions">
              <span className="hint">Engine: {ENGINES.find((e) => e.id === (result.engine || engine))?.label || engine} · amber rows were low-confidence — verify their code against the page.</span>
              <div className="spacer" />
              <button className="ghost" onClick={onClose}>Cancel</button>
              <button className="primary" disabled={included === 0} onClick={apply}>Add {included} item{included === 1 ? '' : 's'} to schedule</button>
            </div>
          </div>
        )}

        {lightbox && (
          <div className="ocr-lightbox" onClick={() => setLightbox(null)}>
            <img src={lightbox.dataUrl} alt={`Scanned page ${lightbox.index + 1}`} />
          </div>
        )}
      </div>
    </div>
  );
}
