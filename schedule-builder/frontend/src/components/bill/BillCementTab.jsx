import React, { useState, useEffect } from 'react';
import { searchCementByDesc, searchCementByCode, searchCementCombined } from '../../api.js';

// ---- formatting helpers ----
const n = (v) => { const x = Number(v); return isFinite(x) ? x : 0; };
const fmtN = (v, dec = 3) =>
  v === '' || v == null
    ? ''
    : Number(v).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtBags = (qtl) => Math.round(n(qtl) * 2).toLocaleString('en-IN');

const hasRowContent = (r) =>
  ['ref', 'description', 'qty', 'rate'].some((k) => String(r[k] ?? '').trim() !== '');

// ---- match type badge ----
function MatchBadge({ matchType }) {
  if (!matchType) return null;
  const cfg = {
    exact:  { label: 'DSR DB', bg: '#dcfce7', color: '#15803d', title: 'Auto-filled from DSR 2023 Vol-2 coefficient table (exact code match)' },
    desc:   { label: 'Desc match', bg: '#fef9c3', color: '#a16207', title: 'Filled via description/mix-spec fallback search — verify before use' },
    code:   { label: 'Code match', bg: '#dbeafe', color: '#1d4ed8', title: 'Matched via DSR ref code search in cement DB' },
    manual: { label: 'Manual', bg: '#f3f4f6', color: '#6b7280', title: 'Entered manually by user' },
  };
  const c = cfg[matchType] || cfg.manual;
  return (
    <span title={c.title} style={{
      display: 'inline-block', fontSize: 10, fontWeight: 700,
      background: c.bg, color: c.color,
      padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap', letterSpacing: '.3px',
    }}>{c.label}</span>
  );
}

// ---- qty source badge ----
function QtySourceBadge({ source }) {
  if (!source) return null;
  const cfg = {
    measured: { label: 'RE', bg: '#dbeafe', color: '#1d4ed8', title: 'Quantity from Record of Measurements (RE tab)' },
    scheduled: { label: 'Sched', bg: '#f3f4f6', color: '#6b7280', title: 'Scheduled quantity (no RE measurements entered yet)' },
    overridden: { label: 'Edit', bg: '#fef3c7', color: '#d97706', title: 'Quantity manually overridden by user' },
    manual: { label: 'Manual', bg: '#f3f4f6', color: '#6b7280', title: 'Quantity entered manually for this cement row' },
  };
  const c = cfg[source] || cfg.scheduled;
  return (
    <span title={c.title} style={{
      display: 'inline-block', fontSize: 9, fontWeight: 700,
      background: c.bg, color: c.color,
      padding: '1px 5px', borderRadius: 999, marginLeft: 4,
    }}>{c.label}</span>
  );
}

// ---- combined cement search popover (by code + description) ----
function CementSearchPopover({ rowId, initialDesc, initialCode, onSelect, onClose }) {
  const [searchMode, setSearchMode] = useState('code'); // 'code' | 'desc' | 'combined'
  const [codeQuery, setCodeQuery] = useState(initialCode || '');
  const [descQuery, setDescQuery] = useState(initialDesc || '');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  const doSearch = () => {
    setLoading(true);
    let promise;
    if (searchMode === 'code') {
      if (!codeQuery.trim()) { setResults([]); setLoading(false); return; }
      promise = searchCementByCode(codeQuery, 10);
    } else if (searchMode === 'desc') {
      if (!descQuery.trim()) { setResults([]); setLoading(false); return; }
      promise = searchCementByDesc(descQuery, 10);
    } else {
      const q = (codeQuery || descQuery).trim();
      if (!q) { setResults([]); setLoading(false); return; }
      promise = searchCementCombined(q, 10);
    }
    promise.then((r) => { setResults(r); setLoading(false); });
  };

  useEffect(() => {
    // Auto-search on open: try code first if available, else description
    if (initialCode && initialCode.trim()) {
      setSearchMode('code');
      setCodeQuery(initialCode);
    } else if (initialDesc && initialDesc.trim()) {
      setSearchMode('desc');
    }
    // Run initial search after a tick
    const t = setTimeout(doSearch, 50);
    return () => clearTimeout(t);
  }, []);

  // Re-run search when mode changes
  useEffect(() => { doSearch(); }, [searchMode]);

  const tabStyle = (mode) => ({
    padding: '4px 12px', fontSize: 12, fontWeight: searchMode === mode ? 700 : 400,
    background: searchMode === mode ? '#1d4ed8' : '#f3f4f6',
    color: searchMode === mode ? '#fff' : '#374151',
    border: 'none', borderRadius: 6, cursor: 'pointer',
  });

  return (
    <div className="cem-popover">
      <div className="cem-popover-head">
        <span>Search Cement DB</span>
        <button className="cem-popover-close" onClick={onClose}>✕</button>
      </div>
      {/* Search mode tabs */}
      <div style={{ display: 'flex', gap: 6, padding: '6px 10px', borderBottom: '1px solid #e5e7eb' }}>
        <button style={tabStyle('code')} onClick={() => setSearchMode('code')}>By DSR Ref</button>
        <button style={tabStyle('desc')} onClick={() => setSearchMode('desc')}>By Description</button>
        <button style={tabStyle('combined')} onClick={() => setSearchMode('combined')}>Combined</button>
      </div>
      {/* Search bar */}
      <div className="cem-popover-searchbar">
        {searchMode === 'code' && (
          <input
            type="text"
            className="cem-popover-input"
            value={codeQuery}
            onChange={(e) => setCodeQuery(e.target.value)}
            placeholder="Type DSR code (e.g. 5.1, 4.1.3, 11.1)..."
            onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); }}
            autoFocus
          />
        )}
        {searchMode === 'desc' && (
          <input
            type="text"
            className="cem-popover-input"
            value={descQuery}
            onChange={(e) => setDescQuery(e.target.value)}
            placeholder="Type keywords (e.g. mortar 1:4, concrete 1:2:4)..."
            onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); }}
            autoFocus
          />
        )}
        {searchMode === 'combined' && (
          <input
            type="text"
            className="cem-popover-input"
            value={codeQuery || descQuery}
            onChange={(e) => { setCodeQuery(e.target.value); setDescQuery(e.target.value); }}
            placeholder="Type DSR code or keywords..."
            onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); }}
            autoFocus
          />
        )}
        <button className="secondary sm" onClick={doSearch} style={{ height: 28 }}>Search</button>
      </div>
      {loading && <div className="cem-popover-item muted">Searching…</div>}
      {results && results.length === 0 && !loading && (
        <div className="cem-popover-item muted">No matches found. Try refining search keywords or enter coefficient manually.</div>
      )}
      <div className="cem-popover-results">
        {(results || []).map((r) => (
          <div key={r.code} className="cem-popover-item" onClick={() => onSelect(r)}>
            <div className="cem-popover-top">
              <span className="cem-popover-code">{r.code}</span>
              <span className="cem-popover-coeff">{r.coeff} Qtl/{r.unit}</span>
              {r.matchType === 'code' && <span style={{ fontSize: 10, color: '#1d4ed8', fontWeight: 600 }}>code match</span>}
              {r.matchType === 'desc' && <span className="cem-popover-score">score {r.score}</span>}
            </div>
            <div className="cem-popover-desc">{r.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- main component ----
export default function BillCementTab({
  rows,
  computed,
  cementById,
  setCementById,
  cementMatchInfo,
  setCementMatchInfo,
  cementMode,
  setCementMode,
  cementManualRows,
  setCementManualRows,
  cementQtyOverrides,
  setCementQtyOverrides,
  cementDescOverrides,
  setCementDescOverrides,
  cementFetchExtraRows,
  setCementFetchExtraRows,
}) {
  const [searchingFor, setSearchingFor] = useState(null); // rowId currently searching

  const clean = rows.filter(hasRowContent);
  const items = computed?.items || [];

  const setCoeff = (id, v, matchType = 'manual') => {
    setCementById((p) => ({ ...p, [id]: v }));
    if (v === '' || v == null) {
      setCementMatchInfo((p) => { const nx = { ...p }; delete nx[id]; return nx; });
    } else if (matchType === 'manual') {
      setCementMatchInfo((p) => ({ ...p, [id]: { ...p[id], matchType: 'manual' } }));
    }
  };

  const applyDescMatch = (rowId, result) => {
    setCementById((p) => ({ ...p, [rowId]: String(result.coeff) }));
    setCementMatchInfo((p) => ({
      ...p,
      [rowId]: {
        code: result.code,
        description: result.description,
        unit: result.unit,
        source_page: result.source_page,
        matchType: result.matchType || 'desc',
      },
    }));
    setSearchingFor(null);
  };

  // ---- Fetch Mode calculations ----
  // Only show schedule items that have a cement DB match (exact) or a user-assigned coeff.
  // Items with no cement data are silently hidden — they are not cement-consuming items.
  let totalQtl = 0;
  const viewFetch = clean
    .map((r, i) => {
      const it = items[i] || {};

      // Quantity logic with overrides
      let baseQty;
      let qtySource;
      if (it.measuredQty != null) {
        baseQty = it.measuredQty;
        qtySource = 'measured';
      } else if (it.schedQty != null) {
        baseQty = it.schedQty;
        qtySource = 'scheduled';
      } else {
        baseQty = n(r.qty);
        qtySource = 'scheduled';
      }

      const hasQtyOverride = cementQtyOverrides[r.id] !== undefined && cementQtyOverrides[r.id] !== '';
      const qty = hasQtyOverride ? n(cementQtyOverrides[r.id]) : baseQty;
      if (hasQtyOverride) qtySource = 'overridden';

      // Description logic with overrides
      const hasDescOverride = cementDescOverrides[r.id] !== undefined && cementDescOverrides[r.id] !== '';
      const desc = hasDescOverride ? cementDescOverrides[r.id] : r.description;

      const coeff = cementById[r.id];
      const coeffNum = coeff !== undefined && coeff !== '' ? n(coeff) : null;
      const cq = coeffNum != null && coeffNum > 0 ? Math.round(coeffNum * qty * 100) / 100 : null;

      const matchInfo = cementMatchInfo?.[r.id] || null;
      const matchType = matchInfo?.matchType || (coeff !== undefined && coeff !== '' ? 'manual' : null);

      // Only include this row if it has cement DB data (exact match) or user has set a coeff
      const hasCementData = matchInfo != null || (coeff !== undefined && coeff !== '');
      if (!hasCementData) return null;

      if (cementMode === 'fetch' && cq != null) totalQtl += cq;

      return {
        id: r.id, ref: r.ref || '', desc, originalDesc: r.description, baseQty, hasQtyOverride,
        hasDescOverride, qty, qtySource, unit: it.unit || r.unit || '', coeff, coeffNum, cq, matchInfo, matchType
      };
    })
    .filter(Boolean); // remove nulls (items with no cement relevance)

  // ---- Fetch Mode extra rows (manually added in fetch mode) ----
  const addFetchExtraRow = () => {
    setCementFetchExtraRows((p) => [
      ...p,
      { id: crypto.randomUUID(), ref: '', description: '', qty: '', unit: '', coeff: '' }
    ]);
  };
  const patchFetchExtraRow = (id, ch) => {
    setCementFetchExtraRows((p) => p.map((r) => r.id === id ? { ...r, ...ch } : r));
  };
  const removeFetchExtraRow = (id) => {
    setCementFetchExtraRows((p) => p.filter((r) => r.id !== id));
  };

  const viewFetchExtra = (cementFetchExtraRows || []).map((r) => {
    const qty = n(r.qty);
    const coeff = n(r.coeff);
    const cq = qty > 0 && coeff > 0 ? Math.round(qty * coeff * 100) / 100 : null;
    if (cementMode === 'fetch' && cq != null) totalQtl += cq;
    return { ...r, qty, coeff, cq };
  });

  // ---- Manual Mode calculations ----
  const addManualRow = () => {
    setCementManualRows((p) => [
      ...p,
      { id: crypto.randomUUID(), ref: '', description: '', qty: '', unit: '', coeff: '' }
    ]);
  };
  const patchManualRow = (id, ch) => {
    setCementManualRows((p) => p.map((r) => r.id === id ? { ...r, ...ch } : r));
  };
  const removeManualRow = (id) => {
    setCementManualRows((p) => p.filter((r) => r.id !== id));
  };

  const viewManual = cementManualRows.map((r) => {
    const qty = n(r.qty);
    const coeff = n(r.coeff);
    const cq = qty > 0 && coeff > 0 ? Math.round(qty * coeff * 100) / 100 : null;
    if (cementMode === 'manual' && cq != null) totalQtl += cq;
    return { ...r, qty, coeff, cq };
  });

  totalQtl = Math.round(totalQtl * 100) / 100;
  const totalBags = Math.round(totalQtl * 2);
  const totalMT = (totalQtl / 10).toFixed(3);

  const hasAny = cementMode === 'manual'
    ? viewManual.length > 0
    : (viewFetch.some((v) => v.coeffNum != null && v.coeffNum > 0) || viewFetchExtra.some((v) => v.cq != null));

  return (
    <div className="bill-cement">
      {/* Mode Toggle Toolbar */}
      <div className="cem-toolbar">
        <label className="field sm" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 'bold', color: '#374151' }}>Cement Sourcing:</span>
          <select
            value={cementMode}
            onChange={(e) => setCementMode(e.target.value)}
            style={{ width: 180, fontWeight: 'bold' }}
          >
            <option value="fetch">Fetch from Schedule</option>
            <option value="manual">Everything Manual</option>
          </select>
        </label>
        {cementMode === 'manual' && (
          <button className="secondary sm" onClick={addManualRow}>+ Add manual item</button>
        )}
        {cementMode === 'fetch' && (
          <button className="secondary sm" onClick={addFetchExtraRow}>+ Add row</button>
        )}
      </div>

      {/* Header note */}
      <div className="cem-header-note">
        <div>
          {cementMode === 'fetch' ? (
            <span>
              <strong>Fetch from Schedule Mode:</strong> Item quantities and descriptions import from the schedule automatically.
              You can override quantities, edit descriptions, and search the DSR DB.
            </span>
          ) : (
            <span>
              <strong>Everything Manual Mode:</strong> Build the cement statement independently.
              Add rows, enter quantities, coefficients, and descriptions manually.
            </span>
          )}
        </div>
        {cementMode === 'fetch' && (
          <div className="cem-legend">
            <MatchBadge matchType="exact" /> auto-filled (exact code)&nbsp;&nbsp;
            <MatchBadge matchType="code" /> code search match&nbsp;&nbsp;
            <MatchBadge matchType="desc" /> description match&nbsp;&nbsp;
            <MatchBadge matchType="manual" /> manual entry
          </div>
        )}
      </div>

      {/* Tables based on mode */}
      {cementMode === 'fetch' ? (
        <div className="cem-table-wrap">
          <table className="cem-table">
            <thead>
              <tr>
                <th className="cem-sno">S.No</th>
                <th className="cem-ref">DSR Ref</th>
                <th className="cem-desc">Item Description</th>
                <th className="cem-qty" style={{ width: 140 }}>Quantity</th>
                <th className="cem-unit">Unit</th>
                <th className="cem-coeff">Coeff<br />(Qtl/unit)</th>
                <th className="cem-match">Match</th>
                <th className="cem-cement">Cement<br />(Qtl)</th>
              </tr>
            </thead>
            <tbody>
              {viewFetch.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty">No items in the schedule. Add items in the Schedule tab first.</td>
                </tr>
              )}
              {viewFetch.map((v, i) => {
                const hasCoeff = v.coeffNum != null && v.coeffNum > 0;
                const bags = hasCoeff && v.cq != null ? Math.round(v.cq * 2) : null;
                const isSearching = searchingFor === v.id;

                return (
                  <React.Fragment key={v.id}>
                    <tr className={hasCoeff ? '' : 'cem-row-nocoeff'}>
                      <td className="cem-sno">{i + 1}</td>
                      <td className="cem-ref-cell">
                        <span className="cem-code-pill">{v.ref || <em className="muted">—</em>}</span>
                      </td>
                      <td className="cem-desc-cell">
                        <textarea
                          rows={2}
                          className="cem-desc-edit-input"
                          value={v.desc}
                          onChange={(e) => setCementDescOverrides((p) => ({ ...p, [v.id]: e.target.value }))}
                          placeholder="Edit description here..."
                        />
                        {v.hasDescOverride && (
                          <button
                            className="linkbtn sm"
                            onClick={() => setCementDescOverrides((p) => { const nx = { ...p }; delete nx[v.id]; return nx; })}
                          >
                            Reset Description
                          </button>
                        )}
                        {v.matchInfo?.source_page && (
                          <div className="cem-source-page-inline">DSR Vol-2 p.{v.matchInfo.source_page}</div>
                        )}
                      </td>
                      <td className="cem-qty-cell" style={{ verticalAlign: 'middle' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <input
                            type="number"
                            step="any"
                            className={`cem-qty-edit-input${v.hasQtyOverride ? ' overridden' : ''}`}
                            value={cementQtyOverrides[v.id] !== undefined ? cementQtyOverrides[v.id] : v.baseQty || ''}
                            onChange={(e) => setCementQtyOverrides((p) => ({ ...p, [v.id]: e.target.value }))}
                            placeholder="Qty..."
                          />
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                            <QtySourceBadge source={v.qtySource} />
                            {v.hasQtyOverride && (
                              <button
                                className="linkbtn sm"
                                onClick={() => setCementQtyOverrides((p) => { const nx = { ...p }; delete nx[v.id]; return nx; })}
                              >
                                Reset Qty
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="cem-unit-cell" style={{ verticalAlign: 'middle' }}>{v.unit || '—'}</td>
                      <td className="cem-coeff-cell" style={{ verticalAlign: 'middle' }}>
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          className={`cem-coeff-input${hasCoeff ? '' : ' cem-coeff-empty'}`}
                          value={v.coeff ?? ''}
                          placeholder="—"
                          onChange={(e) => setCoeff(v.id, e.target.value)}
                        />
                        {v.matchInfo?.unit && v.matchInfo.unit !== v.unit && (
                          <div className="cem-unit-warn" title="DB unit differs from schedule unit — verify">⚠ DB unit: {v.matchInfo.unit}</div>
                        )}
                      </td>
                      <td className="cem-match-cell" style={{ verticalAlign: 'middle' }}>
                        {v.matchType && <MatchBadge matchType={v.matchType} />}
                        {!v.matchType && (
                          <button
                            className="cem-search-btn"
                            title="Search for a coefficient by description"
                            onClick={() => setSearchingFor(isSearching ? null : v.id)}
                          >
                            🔍 Search
                          </button>
                        )}
                        {v.matchType && (
                          <button
                            className="cem-search-btn"
                            title="Search database for a different coefficient"
                            onClick={() => setSearchingFor(isSearching ? null : v.id)}
                            style={{ marginTop: 3 }}
                          >
                            🔍 Search
                          </button>
                        )}
                      </td>
                      <td className="cem-cement-cell" style={{ verticalAlign: 'middle' }}>{v.cq != null ? fmtN(v.cq, 2) : <span className="muted">—</span>}</td>
                    </tr>
                    {/* Popover search row */}
                    {isSearching && (
                      <tr className="cem-search-row">
                        <td colSpan={8} style={{ padding: 0 }}>
                          <CementSearchPopover
                            rowId={v.id}
                            initialDesc={v.desc}
                            initialCode={v.ref}
                            onSelect={(result) => applyDescMatch(v.id, result)}
                            onClose={() => setSearchingFor(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {viewFetchExtra.map((r, i) => {
                const isSearching = searchingFor === r.id;
                return (
                  <React.Fragment key={r.id}>
                    <tr className="cem-extra-row">
                      <td className="cem-sno" style={{ verticalAlign: 'middle' }}>{viewFetch.length + i + 1}</td>
                      <td className="cem-ref-cell" style={{ verticalAlign: 'middle' }}>
                        <input
                          value={r.ref}
                          className="cem-manual-input font-mono"
                          onChange={(e) => patchFetchExtraRow(r.id, { ref: e.target.value })}
                          placeholder="e.g. 4.1.3"
                        />
                      </td>
                      <td className="cem-desc-cell">
                        <textarea
                          rows={2}
                          className="cem-desc-edit-input"
                          value={r.description}
                          onChange={(e) => patchFetchExtraRow(r.id, { description: e.target.value })}
                          placeholder="Enter description here..."
                        />
                      </td>
                      <td className="cem-qty-cell" style={{ verticalAlign: 'middle' }}>
                        <input
                          type="number"
                          step="any"
                          className="cem-qty-edit-input overridden"
                          value={r.qty === 0 ? '' : r.qty}
                          onChange={(e) => patchFetchExtraRow(r.id, { qty: e.target.value })}
                          placeholder="Qty..."
                        />
                      </td>
                      <td className="cem-unit-cell" style={{ verticalAlign: 'middle' }}>
                        <input
                          value={r.unit}
                          className="cem-unit-input"
                          onChange={(e) => patchFetchExtraRow(r.id, { unit: e.target.value })}
                          placeholder="Unit"
                        />
                      </td>
                      <td className="cem-coeff-cell" style={{ verticalAlign: 'middle' }}>
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          className="cem-coeff-input"
                          value={r.coeff === 0 ? '' : r.coeff}
                          onChange={(e) => patchFetchExtraRow(r.id, { coeff: e.target.value })}
                          placeholder="—"
                        />
                      </td>
                      <td className="cem-match-cell" style={{ verticalAlign: 'middle' }}>
                        <button
                          className="cem-search-btn"
                          title="Search database for a coefficient"
                          onClick={() => setSearchingFor(isSearching ? null : r.id)}
                        >
                          🔍 Search
                        </button>
                      </td>
                      <td className="cem-cement-cell" style={{ verticalAlign: 'middle' }}>
                        {r.cq != null ? fmtN(r.cq, 2) : <span className="muted">—</span>}
                      </td>
                      <td style={{ verticalAlign: 'middle', textAlign: 'center' }}>
                        <button
                          className="action-btn del-btn"
                          title="Delete extra row"
                          onClick={() => removeFetchExtraRow(r.id)}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                    {isSearching && (
                      <tr className="cem-search-row">
                        <td colSpan={9} style={{ padding: 0 }}>
                          <CementSearchPopover
                            rowId={r.id}
                            initialDesc={r.description}
                            initialCode={r.ref}
                            onSelect={(result) => {
                              patchFetchExtraRow(r.id, {
                                ref: result.code,
                                description: result.description,
                                unit: result.unit,
                                coeff: result.coefficient
                              });
                              setSearchingFor(null);
                            }}
                            onClose={() => setSearchingFor(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* Manual Mode UI */
        <div className="cem-table-wrap">
          <table className="cem-table">
            <thead>
              <tr>
                <th className="cem-sno">S.No</th>
                <th className="cem-ref" style={{ width: 140 }}>DSR Ref</th>
                <th className="cem-desc">Item Description</th>
                <th className="cem-qty" style={{ width: 120 }}>Quantity</th>
                <th className="cem-unit" style={{ width: 100 }}>Unit</th>
                <th className="cem-coeff" style={{ width: 120 }}>Coeff<br />(Qtl/unit)</th>
                <th className="cem-cement">Cement<br />(Qtl)</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {viewManual.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty">No manual rows. Click "+ Add manual item" to start building your statement.</td>
                </tr>
              )}
              {viewManual.map((r, i) => {
                const bags = r.cq != null ? Math.round(r.cq * 2) : null;
                const isSearching = searchingFor === r.id;

                return (
                  <React.Fragment key={r.id}>
                    <tr>
                      <td className="cem-sno" style={{ verticalAlign: 'middle' }}>{i + 1}</td>
                      <td className="cem-ref-cell" style={{ verticalAlign: 'middle' }}>
                        <input
                          value={r.ref}
                          className="cem-manual-input font-mono"
                          onChange={(e) => patchManualRow(r.id, { ref: e.target.value })}
                          placeholder="e.g. 4.1.3"
                        />
                      </td>
                      <td className="cem-desc-cell">
                        <textarea
                          rows={2}
                          className="cem-desc-edit-input"
                          value={r.description}
                          onChange={(e) => patchManualRow(r.id, { description: e.target.value })}
                          placeholder="Enter description here..."
                        />
                      </td>
                      <td className="cem-qty-cell" style={{ verticalAlign: 'middle' }}>
                        <input
                          type="number"
                          step="any"
                          className="cem-qty-edit-input overridden"
                          value={r.qty === 0 ? '' : r.qty}
                          onChange={(e) => patchManualRow(r.id, { qty: e.target.value })}
                          placeholder="Qty..."
                        />
                      </td>
                      <td className="cem-unit-cell" style={{ verticalAlign: 'middle' }}>
                        <input
                          value={r.unit}
                          className="cem-manual-input text-center"
                          onChange={(e) => patchManualRow(r.id, { unit: e.target.value })}
                          placeholder="e.g. cum"
                        />
                      </td>
                      <td className="cem-coeff-cell" style={{ verticalAlign: 'middle' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            type="number"
                            step="0.001"
                            min="0"
                            className="cem-coeff-input"
                            value={r.coeff === 0 ? '' : r.coeff}
                            placeholder="Coeff..."
                            onChange={(e) => patchManualRow(r.id, { coeff: e.target.value })}
                          />
                          <button
                            className="cem-search-btn"
                            title="Search database for coefficient"
                            onClick={() => setSearchingFor(isSearching ? null : r.id)}
                            style={{ margin: 0, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            🔍
                          </button>
                        </div>
                      </td>
                      <td className="cem-cement-cell" style={{ verticalAlign: 'middle' }}>{r.cq != null ? fmtN(r.cq, 2) : <span className="muted">—</span>}</td>
                      <td style={{ verticalAlign: 'middle', textAlign: 'center' }}>
                        <button className="del-btn" onClick={() => removeManualRow(r.id)}>✕</button>
                      </td>
                    </tr>
                    {isSearching && (
                      <tr className="cem-search-row">
                        <td colSpan={8} style={{ padding: 0 }}>
                          <CementSearchPopover
                            rowId={r.id}
                            initialDesc={r.description}
                            initialCode={r.ref}
                            onSelect={(result) => {
                              patchManualRow(r.id, {
                                ref: result.code,
                                description: result.description,
                                unit: result.unit,
                                coeff: String(result.coeff)
                              });
                              setSearchingFor(null);
                            }}
                            onClose={() => setSearchingFor(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary totals */}
      {hasAny && (
        <div className="cem-summary">
          <table className="cem-sum-table">
            <tbody>
              <tr>
                <td>Total Cement</td>
                <td className="cem-sum-val">{fmtN(totalQtl, 2)} <span className="cem-sum-unit">Quintals</span></td>
              </tr>
              <tr>
                <td>= Metric Tonnes</td>
                <td className="cem-sum-val">{totalMT} <span className="cem-sum-unit">MT</span></td>
              </tr>
              <tr className="cem-sum-grand">
                <td><strong>Cement (Bags of 50 kg)</strong></td>
                <td className="cem-sum-val"><strong>{totalBags.toLocaleString('en-IN')}</strong> <span className="cem-sum-unit">bags</span></td>
              </tr>
            </tbody>
          </table>
          {cementMode === 'fetch' && (
            <p className="cem-sum-note">
              Quantities shown are a mix of <strong>scheduled/measured</strong> quantities and manual edits.
              Items marked <QtySourceBadge source="scheduled" /> will automatically update once RE measurements are entered.
            </p>
          )}
        </div>
      )}

      {!hasAny && viewFetch.length > 0 && (
        <div className="cem-no-data">
          No coefficients entered yet. They are auto-filled from DSR 2023 Vol-2 when a schedule item's DSR ref
          matches a code in the appendix. For items not in the appendix, use the 🔍 Search button to find
          a matching mix/specification coefficient.
        </div>
      )}
    </div>
  );
}
