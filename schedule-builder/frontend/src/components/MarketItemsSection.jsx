import React from 'react';

const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const fmt = (r) => (r === '' || r == null ? '' : Number(r).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function newMarketItem() {
  return { id: crypto.randomUUID(), ref: 'MKT', description: '', unit: '', rate: '', qty: '' };
}

function MarketRow({ index, startSno, item, patch, remove }) {
  const amount = round2(Number(item.qty || 0) * Number(item.rate || 0));
  return (
    <tr>
      <td className="c-sno">{startSno + index}</td>
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

export default function MarketItemsSection({ items, setItems, startSno }) {
  const patchAt = (id, changes) => setItems(items.map((it) => (it.id === id ? { ...it, ...changes } : it)));
  const removeAt = (id) => setItems(items.filter((it) => it.id !== id));
  const add = () => setItems([...items, newMarketItem()]);

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
      <button className="add-btn" onClick={add}>+ Add market item</button>
    </section>
  );
}
