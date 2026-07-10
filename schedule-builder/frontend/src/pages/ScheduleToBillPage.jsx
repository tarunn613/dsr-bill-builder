import React, { useEffect, useMemo, useRef, useState } from 'react';
import BillScheduleTab, { newBillRow } from '../components/bill/BillScheduleTab.jsx';
import BillReTab from '../components/bill/BillReTab.jsx';
import BillAbstractTab from '../components/bill/BillAbstractTab.jsx';
import BillCementTab from '../components/bill/BillCementTab.jsx';
import { computeBill, downloadBill, parseScheduleFile, lookupCementCoeffs } from '../api.js';
import { takeBillHandoff, clearBillHandoff } from '../store.js';
import { useSession } from '../SessionContext.jsx';

const fmt = (r) => (r === '' || r == null ? '' : Number(r).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const DEFAULT_META = { billNo: 'Ist Running Account Bill', workName: '', subHead: '', agency: '', workNo: '', tenderAmount: '', estimateAmount: '', dateStart: '', dateCompletion: '' };
const META_FIELDS = [
  ['billNo', 'Bill No.'], ['workName', 'Name of work'], ['subHead', 'Sub-head'],
  ['agency', 'Agency'], ['workNo', 'Agreement / Work No.'],
  ['tenderAmount', 'Tender amount'], ['estimateAmount', 'Estimate amount'],
  ['dateStart', 'Date of start'], ['dateCompletion', 'Date of completion'],
];
const hasRowContent = (r) => ['ref', 'description', 'qty', 'rate'].some((k) => String(r[k] ?? '').trim() !== '');
const toRow = (r) => ({ id: crypto.randomUUID(), ref: r.ref || '', description: r.description || '', unit: r.unit || '', rate: r.rate ?? '', qty: r.qty ?? '', category: r.category || 'DSR' });

export default function ScheduleToBillPage() {
  // Remounted (via key on session id) when the active session changes, so state
  // initializes from the saved slice. A pending handoff from the schedule page
  // takes priority and is then persisted into the session by the autosave below.
  const { activeId, session, saveSlice, reloadActive } = useSession();

  const handoffRef = useRef(undefined);
  if (handoffRef.current === undefined) handoffRef.current = takeBillHandoff(); // peek once (does not clear)
  const handoff = handoffRef.current;
  const fromHandoff = !!(handoff && handoff.rows);
  const savedBill = session?.state?.bill || null;

  const initRows = fromHandoff ? handoff.rows.map(toRow) : (savedBill?.rows || []);
  const initMeta = fromHandoff ? { ...DEFAULT_META, ...(handoff.meta || {}) } : (savedBill?.meta || DEFAULT_META);
  const initFactor = fromHandoff && handoff.factor != null ? String(handoff.factor) : (savedBill?.factor ?? '0.973');
  const initCI = fromHandoff && handoff.costIndexPct != null ? String(handoff.costIndexPct) : (savedBill?.costIndexPct ?? '3');

  const [meta, setMeta] = useState(initMeta);
  const [factor, setFactor] = useState(initFactor);
  const [costIndexPct, setCostIndexPct] = useState(initCI);
  const [quotedPct, setQuotedPct] = useState(() => savedBill?.quotedPct ?? '0');
  const [quotedType, setQuotedType] = useState(() => savedBill?.quotedType || 'below');
  const [rows, setRows] = useState(initRows);
  const [measById, setMeasById] = useState(() => savedBill?.measById || {});
  const [cementById, setCementById] = useState(() => savedBill?.cementById || {});
  const [cementMatchInfo, setCementMatchInfo] = useState(() => savedBill?.cementMatchInfo || {});
  const [cementMode, setCementMode] = useState(() => savedBill?.cementMode || 'fetch');
  const [cementManualRows, setCementManualRows] = useState(() => savedBill?.cementManualRows || []);
  const [cementQtyOverrides, setCementQtyOverrides] = useState(() => savedBill?.cementQtyOverrides || {});
  const [cementDescOverrides, setCementDescOverrides] = useState(() => savedBill?.cementDescOverrides || {});
  const [cementFetchExtraRows, setCementFetchExtraRows] = useState(() => savedBill?.cementFetchExtraRows || []);
  const [tab, setTab] = useState('schedule');
  const [computed, setComputed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [statusKind, setStatusKind] = useState('');
  const timer = useRef(null);

  // ---- autosave this page's state into the active session (debounced) ----
  const billSlice = useMemo(
    () => ({
      meta, factor, costIndexPct, quotedPct, quotedType, rows, measById,
      cementById, cementMatchInfo, cementMode, cementManualRows,
      cementQtyOverrides, cementDescOverrides, cementFetchExtraRows
    }),
    [
      meta, factor, costIndexPct, quotedPct, quotedType, rows, measById,
      cementById, cementMatchInfo, cementMode, cementManualRows,
      cementQtyOverrides, cementDescOverrides, cementFetchExtraRows
    ],
  );
  // baseline = what's on disk. With a handoff we set it to the (old) saved slice
  // so the autosave fires once and persists the handoff into the session.
  const lastSavedRef = useRef(fromHandoff ? JSON.stringify(savedBill) : JSON.stringify(billSlice));
  useEffect(() => {
    const cur = JSON.stringify(billSlice);
    if (cur === lastSavedRef.current) return;
    lastSavedRef.current = cur;
    saveSlice('bill', billSlice);
  }, [billSlice, saveSlice]);

  // consume the handoff once (it already seeded initial state above)
  useEffect(() => {
    if (fromHandoff) {
      clearBillHandoff();
      setStatus(`Received ${handoff.rows.length} items from the schedule builder.`);
      setStatusKind('ok');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- payload (clean rows + index-keyed measurements + cement overrides/mode) ----
  const payload = useMemo(() => {
    const clean = rows.filter(hasRowContent);
    const meas = {};
    const cement = {};
    const cementQtyOverridesPayload = {};
    const cementDescOverridesPayload = {};

    clean.forEach((r, i) => {
      const list = (measById[r.id] || []).filter((m) => String(m.n ?? '').trim() !== '');
      if (list.length) meas[i] = list;
      
      const co = cementById[r.id];
      if (co !== undefined && co !== '' && Number(co) > 0) {
        cement[i] = Number(co);
      }
      
      const qo = cementQtyOverrides[r.id];
      if (qo !== undefined && qo !== '' && isFinite(Number(qo))) {
        cementQtyOverridesPayload[i] = Number(qo);
      }
      
      const doOver = cementDescOverrides[r.id];
      if (doOver !== undefined && doOver !== '') {
        cementDescOverridesPayload[i] = doOver;
      }
    });

    return {
      meta: { ...meta, quotedPct: Number(quotedPct) || 0, quotedType },
      factor: factor === '' ? 1 : Number(factor), costIndexPct: Number(costIndexPct) || 0,
      quotedPct: Number(quotedPct) || 0, quotedType,
      rows: clean.map((r) => ({ ref: r.ref, description: r.description, unit: r.unit, rate: r.rate, qty: r.qty, category: r.category })),
      meas,
      cement,
      cementMode,
      cementManualRows: cementManualRows.filter(r => String(r.ref || r.description || r.qty || r.coeff).trim() !== ''),
      cementQtyOverrides: cementQtyOverridesPayload,
      cementDescOverrides: cementDescOverridesPayload,
    };
  }, [
    meta, factor, costIndexPct, quotedPct, quotedType, rows, measById, cementById,
    cementMode, cementManualRows, cementQtyOverrides, cementDescOverrides
  ]);

  // auto-fill cement coefficients from the DSR code (only rows the user hasn't set yet)
  const cementTried = useRef(new Set());
  useEffect(() => {
    const clean = rows.filter(hasRowContent);
    const codes = [...new Set(
      clean.map((r) => (r.ref || '').trim()).filter((c) => c && !cementTried.current.has(c))
    )];
    if (!codes.length) return;
    codes.forEach((c) => cementTried.current.add(c));
    lookupCementCoeffs(codes).then((map) => {
      if (!map || !Object.keys(map).length) return;
      setCementById((prev) => {
        const next = { ...prev }; let changed = false;
        for (const r of clean) {
          const code = (r.ref || '').trim();
          if (code && map[code] && (next[r.id] === undefined || next[r.id] === '')) {
            next[r.id] = String(map[code].coeff); changed = true;
          }
        }
        return changed ? next : prev;
      });
      // Store match metadata for display in the Cement tab
      setCementMatchInfo((prev) => {
        const next = { ...prev }; let changed = false;
        for (const r of clean) {
          const code = (r.ref || '').trim();
          if (code && map[code] && !prev[r.id]) {
            next[r.id] = {
              code,
              description: map[code].full_desc || map[code].description || '',
              unit: map[code].unit || '',
              source_page: map[code].source_page || null,
              matchType: 'exact',
            };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
  }, [rows]);

  // ---- live compute ----
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { setComputed(await computeBill(payload)); } catch { /* keep last */ }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [payload]);

  async function onUpload(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setStatus('Reading ' + f.name + '…'); setStatusKind('');
    try {
      const out = await parseScheduleFile(f, activeId);
      if (!out.rows?.length) throw new Error('No items found in the workbook.');
      setRows(out.rows.map(toRow));
      if (out.meta) setMeta((m) => ({ ...m, ...out.meta }));
      await reloadActive(); // reflect the archived import in the session
      setStatus(`Parsed ${out.rows.length} items from ${f.name}.`); setStatusKind('ok');
    } catch (err) { setStatus(err.message); setStatusKind('err'); }
    e.target.value = '';
  }

  async function onExport() {
    setBusy(true); setStatus('');
    try {
      await downloadBill({ ...payload, sessionId: activeId });
      await reloadActive(); // reflect the archived export in the session
      setStatus('Bill workbook exported.'); setStatusKind('ok');
    } catch (e) { setStatus('Export failed. Is the backend running?'); setStatusKind('err'); }
    finally { setBusy(false); }
  }

  const outlay = computed?.measured?.outlay;

  return (
    <div className="page">
      <div className="actionbar">
        <div className="topbar-figs">
          <div className="fig"><span>Work Outlay (scheduled)</span><b>₹ {computed ? fmt(computed.scheduled.outlay) : '0'}</b></div>
          <div className="fig"><span>Gross Payable (measured)</span><b>₹ {outlay != null ? fmt(outlay) : '0'}</b></div>
        </div>
        <div className="topbar-actions">
          <label className="ghost upload-btn">Upload schedule
            <input type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt" onChange={onUpload} hidden />
          </label>
          <button className="primary" disabled={busy || !rows.length} onClick={onExport}>{busy ? 'Exporting…' : '⬇ Export Bill (.xlsx)'}</button>
        </div>
      </div>

      {status && <div className={'banner ' + (statusKind === 'err' ? 'err' : statusKind === 'ok' ? 'ok' : '')}>{status}</div>}

      <main className="bill-main">
        <section className="card">
          <div className="card-head"><h2>Bill Header &amp; Rates</h2></div>
          <div className="header-grid three">
            {META_FIELDS.map(([k, label]) => (
              <label key={k} className="field"><span>{label}</span>
                <input value={meta[k] || ''} onChange={(e) => setMeta({ ...meta, [k]: e.target.value })} /></label>
            ))}
          </div>
          <div className="setup-row" style={{ marginTop: 10 }}>
            <label className="field sm"><span>Multiplying factor</span>
              <input type="number" step="0.001" value={factor} onChange={(e) => setFactor(e.target.value)} /></label>
            <label className="field sm"><span>Cost Index %</span>
              <input type="number" step="0.01" value={costIndexPct} onChange={(e) => setCostIndexPct(e.target.value)} /></label>
            <label className="field sm"><span>Quoted rate %</span>
              <input type="number" step="0.01" value={quotedPct} onChange={(e) => setQuotedPct(e.target.value)} /></label>
            <label className="field sm"><span>Quoted type</span>
              <select value={quotedType} onChange={(e) => setQuotedType(e.target.value)}>
                <option value="below">below</option><option value="above">above</option>
              </select></label>
          </div>
          <p className="note">Chain: main (DSR+Appd.) subtotal → ×factor → +cost index → +MKT/−Recovery → <b>less quoted % → Work Outlay</b>. The Abstract runs the same chain on measured quantities.</p>
        </section>

        <div className="tabs">
          {[['schedule', 'Schedule'], ['re', 'RE — Measurements'], ['abstract', 'Abstract'], ['cement', 'Cement']].map(([k, l]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        <section className="card">
          {tab === 'schedule' && <BillScheduleTab rows={rows} setRows={setRows} computed={computed} />}
          {tab === 're' && <BillReTab rows={rows} measById={measById} setMeasById={setMeasById} />}
          {tab === 'abstract' && <BillAbstractTab computed={computed} />}
          {tab === 'cement' && (
            <BillCementTab
              rows={rows}
              computed={computed}
              cementById={cementById}
              setCementById={setCementById}
              cementMatchInfo={cementMatchInfo}
              setCementMatchInfo={setCementMatchInfo}
              cementMode={cementMode}
              setCementMode={setCementMode}
              cementManualRows={cementManualRows}
              setCementManualRows={setCementManualRows}
              cementQtyOverrides={cementQtyOverrides}
              setCementQtyOverrides={setCementQtyOverrides}
              cementDescOverrides={cementDescOverrides}
              setCementDescOverrides={setCementDescOverrides}
              cementFetchExtraRows={cementFetchExtraRows}
              setCementFetchExtraRows={setCementFetchExtraRows}
            />
          )}
        </section>
      </main>
    </div>
  );
}
