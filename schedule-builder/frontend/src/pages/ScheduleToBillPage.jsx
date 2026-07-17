import React, { useEffect, useMemo, useRef, useState } from 'react';
import BillScheduleTab, { newBillRow } from '../components/bill/BillScheduleTab.jsx';
import BillReTab from '../components/bill/BillReTab.jsx';
import BillAbstractTab from '../components/bill/BillAbstractTab.jsx';
import BillCementTab from '../components/bill/BillCementTab.jsx';
import TenderImportModal from '../components/TenderImportModal.jsx';
import SaveAsDialog from '../components/SaveAsDialog.jsx';
import { computeBill, downloadBill, saveBlob, archiveExport, lookupCementCoeffs } from '../api.js';
import { takeBillHandoff, clearBillHandoff } from '../store.js';
import { cementDescFor, keepFullFor } from '../cementDesc.js';
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
const toRow = (r) => ({ id: crypto.randomUUID(), sno: r.sno != null ? String(r.sno).trim() : '', ref: r.ref || '', description: r.description || '', unit: r.unit || '', rate: r.rate ?? '', qty: r.qty ?? '', category: r.category || 'DSR' });

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
  // "Keep full description" — per row (id -> bool) + a master that forces it on
  // every row. Ticked shows cement_coeff.full_desc, unticked shows leaf_desc only.
  const [cementFullDesc, setCementFullDesc] = useState(() => savedBill?.cementFullDesc || {});
  const [cementFullDescAll, setCementFullDescAll] = useState(() => savedBill?.cementFullDescAll ?? false);
  const [tab, setTab] = useState('schedule');
  const [computed, setComputed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [statusKind, setStatusKind] = useState('');
  const [pendingSave, setPendingSave] = useState(null); // { blob, defaultName }
  const [tenderImport, setTenderImport] = useState(false); // award-letter JSON import modal
  const timer = useRef(null);

  // Award letter / work order JSON → header + quoted rate. Only fields the letter
  // actually carried are overwritten; anything it didn't state (Bill No., factor,
  // cost index, and the dates unless explicitly accepted) is left untouched.
  function applyTenderImport({ meta: m, rates }) {
    setMeta((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(m || {})) if (String(v ?? '').trim() !== '') next[k] = v;
      return next;
    });
    if (rates?.quotedPct != null) setQuotedPct(String(rates.quotedPct));
    if (rates?.quotedType) setQuotedType(rates.quotedType);
    setStatus('Bill header filled from the award letter — check it against the letter before exporting.');
    setStatusKind('ok');
  }

  // ---- autosave this page's state into the active session (debounced) ----
  const billSlice = useMemo(
    () => ({
      meta, factor, costIndexPct, quotedPct, quotedType, rows, measById,
      cementById, cementMatchInfo, cementMode, cementManualRows,
      cementQtyOverrides, cementDescOverrides, cementFetchExtraRows,
      cementFullDesc, cementFullDescAll
    }),
    [
      meta, factor, costIndexPct, quotedPct, quotedType, rows, measById,
      cementById, cementMatchInfo, cementMode, cementManualRows,
      cementQtyOverrides, cementDescOverrides, cementFetchExtraRows,
      cementFullDesc, cementFullDescAll
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

  // ---- canonical Schedule serial numbers ----
  // One definition, used by every tab: an item's S.No is its OWN explicit serial
  // number — carried in from the schedule builder (typed there, or from a JSON/OCR
  // import) — shown verbatim, never re-sorted or renumbered. Only rows with no
  // explicit number at all (added by hand
  // directly on this page, or sessions saved before this field existed) fall back to
  // their 1-based position among the content-bearing rows. RE / Abstract / Cement all
  // display THIS number (never their own 1..N), because the AE/JE check each line
  // against their BOQ by serial number before signing. Blank scratch rows don't take
  // a number — they're dropped from the bill.
  const snoById = useMemo(() => {
    const m = {};
    let n = 0;
    for (const r of rows) {
      if (!hasRowContent(r)) continue;
      n++;
      const explicit = r.sno != null ? String(r.sno).trim() : '';
      m[r.id] = explicit !== '' ? explicit : String(n);
    }
    return m;
  }, [rows]);

  // ---- payload (clean rows + index-keyed measurements + cement overrides/mode) ----
  const payload = useMemo(() => {
    const clean = rows.filter(hasRowContent);
    const meas = {};
    const cement = {};
    const cementQtyOverridesPayload = {};
    const cementDescOverridesPayload = {};
    // Resolved Cement-sheet description per row, from the CEMENT database only
    // (full_desc when "Keep full description" is ticked, else leaf_desc). Resolved
    // here rather than in the exporter so the tab and the workbook use the exact
    // same string — see cementDesc.js.
    const cementDescsPayload = {};

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

      const cd = cementDescFor(
        cementMatchInfo?.[r.id],
        keepFullFor(r.id, cementFullDesc, cementFullDescAll),
      );
      if (cd) cementDescsPayload[i] = cd;
    });

    return {
      meta: { ...meta, quotedPct: Number(quotedPct) || 0, quotedType },
      factor: factor === '' ? 1 : Number(factor), costIndexPct: Number(costIndexPct) || 0,
      quotedPct: Number(quotedPct) || 0, quotedType,
      rows: clean.map((r) => ({ sno: r.sno, ref: r.ref, description: r.description, unit: r.unit, rate: r.rate, qty: r.qty, category: r.category })),
      meas,
      cement,
      cementMode,
      cementManualRows: cementManualRows.filter(r => String(r.ref || r.description || r.qty || r.coeff).trim() !== ''),
      cementQtyOverrides: cementQtyOverridesPayload,
      cementDescOverrides: cementDescOverridesPayload,
      cementDescs: cementDescsPayload,
      cementFetchExtraRows: (cementFetchExtraRows || []).filter(
        (r) => String(r.ref || r.description || r.qty || r.coeff).trim() !== ''
      ),
    };
  }, [
    meta, factor, costIndexPct, quotedPct, quotedType, rows, measById, cementById,
    cementMode, cementManualRows, cementQtyOverrides, cementDescOverrides,
    cementMatchInfo, cementFullDesc, cementFullDescAll, cementFetchExtraRows
  ]);

  // auto-fill cement coefficients from the DSR code (only rows the user hasn't set yet)
  const cementTried = useRef(new Set());
  useEffect(() => {
    const clean = rows.filter(hasRowContent);
    const codes = [...new Set(
      [
        ...clean.map((r) => (r.ref || '').trim()),
        // Also re-fetch codes a saved session already matched but that predate
        // leaf_desc, including ones the user picked by search (whose code can
        // differ from the row's ref) — they need backfilling, see below.
        ...clean
          .map((r) => cementMatchInfo?.[r.id])
          .filter((mi) => mi && mi.leaf_desc === undefined && mi.code)
          .map((mi) => String(mi.code).trim()),
      ].filter((c) => c && !cementTried.current.has(c))
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
          const ref = (r.ref || '').trim();
          const cur = prev[r.id];
          // Honour a code the user picked by search — it can differ from the ref.
          const code = (cur?.code || ref || '').trim();
          const hit = code && map[code];
          if (!hit) continue;
          const descFields = {
            description: hit.full_desc || hit.description || '',
            // Both kept so "Keep full description" can toggle between them.
            leaf_desc: hit.leaf_desc || '',
            full_desc: hit.full_desc || hit.description || '',
          };
          if (!cur) {
            next[r.id] = {
              code,
              ...descFields,
              unit: hit.unit || '',
              source_page: hit.source_page || null,
              // 'exact' or 'base' — a base-code hit inherits the parent's coefficient
              // and must stay visibly distinct from an exact match.
              matchType: hit.matchType || 'exact',
              matchedCode: hit.matchedCode || code,
            };
            changed = true;
          } else if (cur.leaf_desc === undefined) {
            // BACKFILL. Sessions saved before "Keep full description" stored only
            // `description` (= full_desc) and no leaf_desc. Without leaf_desc the
            // unticked state has nothing to show and falls back to the full text,
            // so the tick silently appears to do nothing on every existing tender.
            // Only the description fields are refreshed — the user's own code,
            // matchType and coefficient are left exactly as saved.
            next[r.id] = { ...cur, ...descFields };
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

  async function onExport() {
    setBusy(true); setStatus('');
    try {
      const { blob, defaultName } = await downloadBill(payload);
      setPendingSave({ blob, defaultName });
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
          <button className="ghost" onClick={() => setTenderImport(true)}>Import tender details (JSON)</button>
          <button className="primary" disabled={busy || !rows.length} onClick={onExport}>{busy ? 'Exporting…' : '⬇ Export Bill (.xlsx)'}</button>
        </div>
      </div>

      {status && <div className={'banner ' + (statusKind === 'err' ? 'err' : statusKind === 'ok' ? 'ok' : '')}>{status}</div>}
      {tenderImport && (
        <TenderImportModal onApply={applyTenderImport} onClose={() => setTenderImport(false)} />
      )}
      {pendingSave && (
        <SaveAsDialog
          defaultName={pendingSave.defaultName}
          onConfirm={async (filename) => {
            saveBlob(pendingSave.blob, filename);
            setPendingSave(null);
            setStatus('Bill workbook exported.'); setStatusKind('ok');
            await archiveExport(activeId, { page: 'bill', kind: 'xlsx', filename, blob: pendingSave.blob });
            await reloadActive(); // reflect the archived export in the session
          }}
          onCancel={() => setPendingSave(null)}
        />
      )}

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
          {tab === 'schedule' && <BillScheduleTab rows={rows} setRows={setRows} computed={computed} snoById={snoById} />}
          {tab === 're' && <BillReTab rows={rows} measById={measById} setMeasById={setMeasById} snoById={snoById} />}
          {tab === 'abstract' && <BillAbstractTab computed={computed} />}
          {tab === 'cement' && (
            <BillCementTab
              rows={rows}
              computed={computed}
              snoById={snoById}
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
              cementFullDesc={cementFullDesc}
              setCementFullDesc={setCementFullDesc}
              cementFullDescAll={cementFullDescAll}
              setCementFullDescAll={setCementFullDescAll}
              cementFetchExtraRows={cementFetchExtraRows}
              setCementFetchExtraRows={setCementFetchExtraRows}
            />
          )}
        </section>
      </main>
    </div>
  );
}
