import React from 'react';

const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const fmt = (r) => (r === '' || r == null ? '' : Number(r).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function newMarketItem() {
  return { id: crypto.randomUUID(), sno: '', ref: 'MKT', description: '', unit: '', rate: '', qty: '' };
}

function MarketRow({ index, startSno, item, patch, remove }) {
  const amount = round2(Number(item.qty || 0) * Number(item.rate || 0));
  return (
    <tr>
      {/* Editable, defaults to position — see DsrItemsSection for why: imports carry
          the schedule's own serial number here and it must never be re-derived.
          `value` binds straight to item.sno so backspacing clears the box to blank
          (no fallback that would snap it back to the default). */}
      <td className="c-sno">
        <input className="sno-input" value={item.sno ?? ''}
          onChange={(e) => patch({ sno: e.target.value })} />
      </td>
      <td className="c-ref">
        <input value={item.ref} onChange={(e) => patch({ ref: e.target.value })} />
      </td>
      <td className="c-desc">
        <textarea rows={2} value={item.description} placeholder="market item description"
          onChange={(e) => patch({ description: e.target.value })} />
      </td>
      <td className="c-qty">
        <input type="number" step="0.01" min="0" value={item.qty}
          onChange={(e) => patch({ qty: e.target.value })} />
      </td>
      <td className="c-unit">
        <input value={item.unit} placeholder="unit" onChange={(e) => patch({ unit: e.target.value })} />
      </td>
      <td className="c-rate">
        <input type="number" step="0.01" min="0" value={item.rate}
          onChange={(e) => patch({ rate: e.target.value })} />
      </td>
      <td className="c-amt">{amount ? fmt(amount) : ''}</td>
      <td className="c-del"><button className="del-btn" onClick={remove} title="remove">✕</button></td>
    </tr>
  );
}

export default function MarketItemsSection({ items, setItems, startSno, onCleared }) {
  const patchAt = (id, changes) => setItems(items.map((it) => (it.id === id ? { ...it, ...changes } : it)));
  const removeAt = (id) => setItems(items.filter((it) => it.id !== id));
  const add = () => setItems([...items, { ...newMarketItem(), sno: String(startSno + items.length) }]);
  const removeAll = () => {
    if (items.length === 0) return;
    if (window.confirm(`Remove all ${items.length} market item${items.length === 1 ? '' : 's'}? This cannot be undone.`)) {
      setItems([]);
      if (onCleared) onCleared();
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Market Rate Items <span className="count">({items.length})</span></h2>
        <span className="hint">added at par — not factored, no cost index</span>
      </div>
      <table className="items-table">
        <thead>
          <tr>
            <th className="c-sno">S.No</th>
            <th className="c-ref">Ref</th>
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
            <MarketRow key={it.id} index={i} startSno={startSno} item={it}
              patch={(c) => patchAt(it.id, c)} remove={() => removeAt(it.id)} />
          ))}
          {items.length === 0 && (
            <tr><td colSpan={8} className="empty">No market items.</td></tr>
          )}
        </tbody>
      </table>
      <div className="section-actions">
        <button className="add-btn" onClick={add}>+ Add market item</button>
        <button className="ghost danger" onClick={removeAll} disabled={items.length === 0} title="remove every market item row">Remove all</button>
      </div>
    </section>
  );
}
