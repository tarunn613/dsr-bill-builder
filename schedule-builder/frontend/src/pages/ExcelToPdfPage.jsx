import React, { useRef, useState } from 'react';
import { listXlsxSheets, convertXlsxToPdf } from '../api.js';
import { useSession } from '../SessionContext.jsx';

// Convert an uploaded .xlsx (Schedule / RE / Abstract / Cement, or any workbook)
// into clean black-&-white, A4-fit PDFs — one per sheet, delivered as a zip.
export default function ExcelToPdfPage() {
  const { session, reloadActive } = useSession();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState([]);      // [{ name, on }]
  const [busy, setBusy] = useState(false);       // 'reading' | 'converting' | false
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');

  async function pickFile(f) {
    setErr(''); setDone(''); setSheets([]); setFile(null);
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) { setErr('Please choose an .xlsx file.'); return; }
    setFile(f);
    setBusy('reading');
    try {
      const names = await listXlsxSheets(f);
      if (!names.length) { setErr('No worksheets found in this file.'); return; }
      setSheets(names.map((name) => ({ name, on: true })));
    } catch (e) {
      setErr(e.message || 'Could not read the workbook.');
      setFile(null);
    } finally { setBusy(false); }
  }

  function toggle(i) {
    setSheets((s) => s.map((x, k) => (k === i ? { ...x, on: !x.on } : x)));
  }
  function setAll(on) { setSheets((s) => s.map((x) => ({ ...x, on }))); }

  const selected = sheets.filter((s) => s.on).map((s) => s.name);

  async function convert() {
    if (!file || !selected.length) return;
    setBusy('converting'); setErr(''); setDone('');
    try {
      const name = await convertXlsxToPdf(file, selected, session?.id);
      setDone(`Downloaded ${name} — ${selected.length} PDF${selected.length === 1 ? '' : 's'} inside.`);
      if (session?.id) reloadActive();
    } catch (e) {
      setErr(e.message || 'Could not convert the workbook.');
    } finally { setBusy(false); }
  }

  function reset() {
    setFile(null); setSheets([]); setErr(''); setDone('');
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="page topdf-page">
      <div className="page-pad">
      <div className="page-head">
        <h1>Excel → PDF</h1>
        <p className="page-sub">
          Turn a bill workbook into clean, print-ready PDFs — one per sheet.
          Colours are dropped for crisp <b>black-&-white tables</b>, and every sheet is
          scaled to fit an <b>A4 page</b> with no column cut off.
        </p>
      </div>

      <div className="home-panel">
        <label className="panel-label">1 · Choose an Excel file (.xlsx)</label>
        <div className="topdf-drop"
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0]); }}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef} type="file" accept=".xlsx" hidden
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          <div className="topdf-drop-inner">
            <span className="topdf-drop-icon">⬆</span>
            {file
              ? <span><b>{file.name}</b> — click to choose a different file</span>
              : <span>Click to browse, or drag an <b>.xlsx</b> here</span>}
          </div>
        </div>
        <p className="hint">
          Works with a workbook exported from this app (Schedule / RE / Abstract / Cement)
          or any Excel file — even a fresh export whose totals haven’t been opened in Excel yet.
        </p>
      </div>

      {busy === 'reading' && <div className="topdf-status">Reading worksheets…</div>}

      {sheets.length > 0 && (
        <div className="home-panel">
          <label className="panel-label">2 · Pick the sheets to convert</label>
          <div className="topdf-sheetbar">
            <button className="ghost sm" onClick={() => setAll(true)}>Select all</button>
            <button className="ghost sm" onClick={() => setAll(false)}>Clear</button>
            <span className="topdf-count">{selected.length} of {sheets.length} selected</span>
          </div>
          <div className="topdf-sheets">
            {sheets.map((s, i) => (
              <label key={s.name} className={'topdf-sheet' + (s.on ? ' on' : '')}>
                <input type="checkbox" checked={s.on} onChange={() => toggle(i)} />
                <span className="topdf-sheet-name">{s.name}</span>
              </label>
            ))}
          </div>

          <div className="topdf-actions">
            <button className="primary" onClick={convert} disabled={busy === 'converting' || !selected.length}>
              {busy === 'converting' ? 'Converting…' : `Convert ${selected.length} sheet${selected.length === 1 ? '' : 's'} → PDF (zip)`}
            </button>
            <button className="ghost" onClick={reset} disabled={busy === 'converting'}>Reset</button>
          </div>
        </div>
      )}

      {err && <div className="home-err">{err}</div>}
      {done && <div className="topdf-done">✓ {done}</div>}
      </div>
    </div>
  );
}
