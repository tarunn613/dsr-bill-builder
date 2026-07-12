import React, { useEffect, useMemo, useRef, useState } from 'react';
import HeaderForm from '../components/HeaderForm.jsx';
import DsrItemsSection, { newDsrItem } from '../components/DsrItemsSection.jsx';
import MarketItemsSection, { newMarketItem } from '../components/MarketItemsSection.jsx';
import SchedulePreview from '../components/SchedulePreview.jsx';
import OcrImportModal from '../components/OcrImportModal.jsx';
import JsonImportModal from '../components/JsonImportModal.jsx';
import SaveAsDialog from '../components/SaveAsDialog.jsx';
import { computeSchedule, downloadSchedule, saveBlob, archiveExport, getMeta } from '../api.js';
import { sendScheduleToBill } from '../store.js';
import { useSession } from '../SessionContext.jsx';

const fmt = (r) => (r === '' || r == null ? '' : Number(r).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const DEFAULT_HEADER = {
  organization: 'DELHI URBAN SHELTER IMPROVEMENT BOARD, GNCTD',
  office: '', division: '', subHead: '', nameOfWork: '',
};

function hasContent(row) {
  return ['ref', 'code', 'description', 'qty', 'rate'].some((k) => String(row[k] ?? '').trim() !== '');
}

export default function DsrToSchedulePage() {
  // This component is remounted (via key on session id) whenever the active
  // session changes, so we can initialize state directly from the saved slice.
  const { activeId, session, saveSlice, reloadActive } = useSession();
  const slice = session?.state?.schedule || null;

  const [header, setHeader] = useState(() => slice?.header || DEFAULT_HEADER);
  const [factor, setFactor] = useState(() => slice?.factor ?? '1');
  const [costIndexPct, setCostIndexPct] = useState(() => slice?.costIndexPct ?? '0');
  const [dsrItems, setDsrItems] = useState(() => slice?.dsrItems || []);
  const [marketItems, setMarketItems] = useState(() => slice?.marketItems || []);
  const [nDsr, setNDsr] = useState(() => slice?.nDsr ?? '1');
  const [nMkt, setNMkt] = useState(() => slice?.nMkt ?? '0');
  const [computed, setComputed] = useState(null);
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [ocrOpen, setOcrOpen] = useState(false);
  const [jsonImportOpen, setJsonImportOpen] = useState(false);
  const [pendingSave, setPendingSave] = useState(null); // { blob, defaultName }
  const timer = useRef(null);

  // ---- autosave this page's state into the active session (debounced) ----
  const scheduleSlice = useMemo(
    () => ({ header, factor, costIndexPct, dsrItems, marketItems, nDsr, nMkt }),
    [header, factor, costIndexPct, dsrItems, marketItems, nDsr, nMkt],
  );
  const lastSavedRef = useRef(JSON.stringify(scheduleSlice)); // matches what's on disk at mount
  useEffect(() => {
    const cur = JSON.stringify(scheduleSlice);
    if (cur === lastSavedRef.current) return; // nothing actually changed
    lastSavedRef.current = cur;
    saveSlice('schedule', scheduleSlice);
  }, [scheduleSlice, saveSlice]);

  useEffect(() => { getMeta().then(setMeta); }, []);

  const payload = useMemo(() => ({
    header,
    factor: factor === '' ? 1 : Number(factor),
    costIndexPct: costIndexPct === '' ? 0 : Number(costIndexPct),
    dsrItems: dsrItems.filter(hasContent).map((r) => ({
      category: r.category, ref: r.ref, code: r.code, description: r.description,
      unit: r.unit, rate: r.rate, qty: r.qty, override: r.override, bookRate: r.bookRate,
    })),
    marketItems: marketItems.filter(hasContent).map((r) => ({
      ref: r.ref, description: r.description, unit: r.unit, rate: r.rate, qty: r.qty,
    })),
  }), [header, factor, costIndexPct, dsrItems, marketItems]);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { setComputed(await computeSchedule(payload)); setError(''); }
      catch { setError('Live totals unavailable — is the backend running on :5175?'); }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [payload]);

  function applySetup() {
    setDsrItems(Array.from({ length: Math.max(0, parseInt(nDsr, 10) || 0) }, newDsrItem));
    setMarketItems(Array.from({ length: Math.max(0, parseInt(nMkt, 10) || 0) }, newMarketItem));
  }

  // Merge imported rows (from OCR or pasted JSON) into the schedule (dropping
  // any blank template rows), and adopt the factor / cost index if the source
  // provided them.
  function handleImportApply({ dsrItems: incomingDsr = [], marketItems: incomingMkt = [], meta: sheet = {} }) {
    if (incomingDsr.length) setDsrItems((prev) => [...prev.filter(hasContent), ...incomingDsr]);
    if (incomingMkt.length) setMarketItems((prev) => [...prev.filter(hasContent), ...incomingMkt]);
    if (sheet.factor) setFactor(String(sheet.factor));
    if (sheet.costIndexPct != null && sheet.costIndexPct !== '') setCostIndexPct(String(sheet.costIndexPct));
    setError('');
  }

  async function doExport(kind) {
    setBusy(kind); setError('');
    try {
      const { blob, defaultName } = await downloadSchedule(kind, payload);
      setPendingSave({ blob, defaultName, kind });
    } catch { setError(`Export failed (${kind}). Is the backend running?`); }
    finally { setBusy(''); }
  }

  function toBill() {
    if (!computed || (!computed.dsrRows.length && !computed.marketRows.length)) {
      setError('Add some items before sending to the bill.'); return;
    }
    const rows = [
      ...computed.dsrRows.map((r) => ({ ref: r.ref, description: r.description, unit: r.unit, rate: r.rate, qty: r.qty, category: r.category || 'DSR' })),
      ...computed.marketRows.map((r) => ({ ref: r.ref || 'MKT', description: r.description, unit: r.unit, rate: r.rate, qty: r.qty, category: 'MKT' })),
    ];
    sendScheduleToBill({
      rows,
      meta: { workName: header.nameOfWork, subHead: header.subHead, agency: '', workNo: '' },
      factor: payload.factor, costIndexPct: payload.costIndexPct,
    });
    window.location.hash = '#/bill';
  }

  const dsrCount = dsrItems.filter(hasContent).length;
  const startMktSno = dsrCount + 1;

  return (
    <div className="page">
      <div className="actionbar">
        <div className="topbar-figs">
          <div className="fig"><span>Grand Total</span><b>₹ {computed ? fmt(computed.grandTotal) : '0.00'}</b></div>
          <div className="fig"><span>Say</span><b>₹ {computed ? fmt(computed.say) : '0'}</b></div>
        </div>
        <div className="topbar-actions">
          <button className="ghost" onClick={() => setOcrOpen(true)} title="scan a printed/scanned Schedule of Work PDF and extract its DSR items">⤓ Import from PDF</button>
          <button className="ghost" onClick={() => setJsonImportOpen(true)} title="paste JSON extracted by a vision AI model from a Schedule of Work">{'{ }'} Import from JSON</button>
          <button className="ghost" disabled={busy} onClick={() => doExport('xlsx')}>{busy === 'xlsx' ? '…' : 'Export Excel'}</button>
          <button className="ghost" disabled={busy} onClick={() => doExport('pdf')}>{busy === 'pdf' ? '…' : 'Export PDF'}</button>
          <button className="primary" onClick={toBill} title="carry this schedule into the bill builder">Send to Bill →</button>
        </div>
      </div>

      {ocrOpen && <OcrImportModal onClose={() => setOcrOpen(false)} onApply={handleImportApply} />}
      {jsonImportOpen && <JsonImportModal onClose={() => setJsonImportOpen(false)} onApply={handleImportApply} />}
      {pendingSave && (
        <SaveAsDialog
          defaultName={pendingSave.defaultName}
          onConfirm={async (filename) => {
            saveBlob(pendingSave.blob, filename);
            setPendingSave(null);
            await archiveExport(activeId, { page: 'schedule', kind: pendingSave.kind, filename, blob: pendingSave.blob });
            await reloadActive(); // refresh the session's archived-files list
          }}
          onCancel={() => setPendingSave(null)}
        />
      )}

      {error && <div className="banner err">{error}</div>}

      <main className="layout">
        <div className="col-inputs">
          <HeaderForm header={header} setHeader={setHeader} />
          <section className="card">
            <div className="card-head"><h2>Setup</h2></div>
            <div className="setup-row">
              <label className="field sm"><span>No. of DSR items</span>
                <input type="number" min="0" value={nDsr} onChange={(e) => setNDsr(e.target.value)} /></label>
              <label className="field sm"><span>No. of market items</span>
                <input type="number" min="0" value={nMkt} onChange={(e) => setNMkt(e.target.value)} /></label>
              <button className="secondary" onClick={applySetup}>Create rows</button>
              <div className="spacer" />
              <label className="field sm"><span>Multiplying factor</span>
                <input type="number" step="0.001" value={factor} onChange={(e) => setFactor(e.target.value)} /></label>
              <label className="field sm"><span>Cost Index %</span>
                <input type="number" step="0.01" value={costIndexPct} onChange={(e) => setCostIndexPct(e.target.value)} /></label>
            </div>
            <p className="note">Factor &amp; cost index apply to DSR items only. Market items are added at par. “Create rows” replaces current rows with blank ones; you can also add/remove individually below.</p>
          </section>
          <DsrItemsSection items={dsrItems} setItems={setDsrItems} />
          <MarketItemsSection items={marketItems} setItems={setMarketItems} startSno={startMktSno} />
        </div>
        <div className="col-preview">
          <div className="preview-head">
            <h2>Live Preview</h2>
            <span className="hint">{meta ? `${meta.count} DSR items loaded` : ''}</span>
          </div>
          <SchedulePreview computed={computed} header={header} />
        </div>
      </main>
    </div>
  );
}
