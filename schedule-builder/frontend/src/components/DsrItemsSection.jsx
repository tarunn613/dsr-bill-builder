import React from 'react';
import DsrCodeSearch from './DsrCodeSearch.jsx';

const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const fmt = (r) => (r === '' || r == null ? '' : Number(r).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const leadLabel = (k) => k
  .replace(/_/g, ' ')
  .replace('upto', 'up to')
  .replace('addl', 'addl.')
  .replace('per km', '/km');

export function newDsrItem() {
  return {
    id: crypto.randomUUID(), sno: '', category: 'DSR', ref: '', code: '', description: '',
    unit: '', rate: '', qty: '', carriage: false, rateOptions: null, lead: '',
    bookRate: '', override: false,
  };
}

function DsrRow({ index, item, patch, remove }) {
  const isDsr = item.category === 'DSR';
  const amount = round2(Number(item.qty || 0) * Number(item.rate || 0));
  const deviates = isDsr && item.override && item.bookRate !== '' && item.bookRate != null
    && Number(item.rate) !== Number(item.bookRate);

  function onPick(row) {
    if (row.carriage) {
      patch({
        code: row.code, ref: row.code, description: row.description, unit: row.unit,
        carriage: true, rateOptions: row.rate_options || {}, rate: '', lead: '',
        bookRate: '', override: false,
      });
    } else {
      patch({
        code: row.code, ref: row.code, description: row.description, unit: row.unit,
        rate: row.rate, carriage: false, rateOptions: null, lead: '',
        bookRate: row.rate, override: false,
      });
    }
  }

  return (
    <tr>
      {/* S.No is editable and defaults to position — imports (JSON/OCR) fill in the
          schedule's own serial number here, which must be shown verbatim (never
          re-sorted or renumbered) since AE/JE sign off by cross-checking this number
          against their BOQ. `value` binds straight to item.sno (no `|| default`
          fallback — that would snap a backspaced field back to the position number),
          so clearing the box leaves it truly blank; a blank S.No still falls back to
          the position downstream (see effectiveSno in bill-core / core.js). */}
      <td className="c-sno">
        <input className="sno-input" value={item.sno ?? ''}
          onChange={(e) => patch({ sno: e.target.value })} />
      </td>
      <td className="c-cat">
        <select value={item.category} onChange={(e) => patch({ category: e.target.value })}>
          <option value="DSR">DSR</option>
          <option value="Appd.">Appd.</option>
          <option value="NS">NS</option>
        </select>
      </td>
      <td className="c-ref">
        {isDsr ? (
          <DsrCodeSearch value={item.ref} onSelect={onPick} onChange={(val) => patch({ ref: val, code: val })} />
        ) : (
          <input value={item.ref} placeholder="ref" onChange={(e) => patch({ ref: e.target.value })} />
        )}
        {item.carriage && (
          <select className="lead-select" value={item.lead}
            onChange={(e) => patch({ lead: e.target.value, rate: item.rateOptions[e.target.value] })}>
            <option value="">pick lead…</option>
            {Object.entries(item.rateOptions || {}).map(([k, v]) => (
              <option key={k} value={k}>{leadLabel(k)} — ₹{fmt(v)}</option>
            ))}
          </select>
        )}
      </td>
      <td className="c-desc">
        <textarea rows={2} value={item.description}
          placeholder={isDsr ? 'select a code or type manually' : 'description'}
          onChange={(e) => patch({ description: e.target.value })} />
      </td>
      <td className="c-qty">
        <input type="number" step="0.01" min="0" value={item.qty}
          onChange={(e) => patch({ qty: e.target.value })} />
      </td>
      <td className="c-unit">
        <input value={item.unit} onChange={(e) => patch({ unit: e.target.value })} />
      </td>
      <td className="c-rate">
        <input type="number" step="0.01" value={item.rate}
          readOnly={isDsr && !item.carriage && !item.override}
          className={deviates ? 'rate-deviates' : ''}
          title={item.carriage ? 'set by chosen lead' : (isDsr && !item.override ? 'DSR book rate' : '')}
          onChange={(e) => patch({ rate: e.target.value })} />
        {isDsr && !item.carriage && (
          !item.override ? (
            <button className="linkbtn" onClick={() => patch({ override: true })} title="use a rate other than the DSR book rate">✎ override</button>
          ) : (
            <div className="ovr-ctl">
              <span className={deviates ? 'warn' : 'muted'}>{deviates ? '⚠ ' : ''}book ₹{fmt(item.bookRate)}</span>
              <button className="linkbtn" onClick={() => patch({ override: false, rate: item.bookRate })} title="restore the DSR book rate">revert</button>
            </div>
          )
        )}
      </td>
      <td className="c-amt">{amount ? fmt(amount) : ''}</td>
      <td className="c-del"><button className="del-btn" onClick={remove} title="remove">✕</button></td>
    </tr>
  );
}

export default function DsrItemsSection({ items, setItems, onCleared }) {
  const patchAt = (id, changes) => setItems(items.map((it) => (it.id === id ? { ...it, ...changes } : it)));
  const removeAt = (id) => setItems(items.filter((it) => it.id !== id));
  const add = () => setItems([...items, { ...newDsrItem(), sno: String(items.length + 1) }]);
  const removeAll = () => {
    if (items.length === 0) return;
    if (window.confirm(`Remove all ${items.length} DSR item${items.length === 1 ? '' : 's'}? This cannot be undone.`)) {
      setItems([]);
      if (onCleared) onCleared();
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>DSR / Schedule Items <span className="count">({items.length})</span></h2>
        <span className="hint">factored by multiplying factor + cost index</span>
      </div>
      <table className="items-table">
        <thead>
          <tr>
            <th className="c-sno">S.No</th>
            <th className="c-cat">Type</th>
            <th className="c-ref">DSR Ref / Code</th>
            <th className="c-desc">Description</th>
            <th className="c-qty">Qty</th>
            <th className="c-unit">Unit</th>
            <th className="c-rate">Rate ₹</th>
            <th className="c-amt">Amount ₹</th>
            <th className="c-del"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <DsrRow key={it.id} index={i} item={it}
              patch={(c) => patchAt(it.id, c)} remove={() => removeAt(it.id)} />
          ))}
          {items.length === 0 && (
            <tr><td colSpan={9} className="empty">No DSR items yet — click “Add DSR item”.</td></tr>
          )}
        </tbody>
      </table>
      <div className="section-actions">
        <button className="add-btn" onClick={add}>+ Add DSR item</button>
        <button className="ghost danger" onClick={removeAll} disabled={items.length === 0} title="remove every DSR item row">Remove all</button>
      </div>
    </section>
  );
}
