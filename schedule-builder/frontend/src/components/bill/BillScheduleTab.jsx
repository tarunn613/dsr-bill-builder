import React from 'react';

const fmt = (r) => (r === '' || r == null ? '' : Number(r).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const CATS = ['DSR', 'Appd.', 'MKT', 'Recovery'];

export function newBillRow() {
  return { id: crypto.randomUUID(), ref: '', description: '', unit: '', rate: '', qty: '', category: 'DSR' };
}

function Row({ sno, item, patch, remove }) {
  const sign = item.category === 'Recovery' ? -1 : 1;
  const amount = round2(sign * Number(item.qty || 0) * Number(item.rate || 0));
  return (
    <tr className={item.category === 'Recovery' ? 'recovery' : ''}>
      {/* Canonical S.No (blank for an empty scratch row — it isn't in the bill yet) */}
      <td className="c-sno">{sno ?? ''}</td>
      <td className="c-ref"><input value={item.ref} onChange={(e) => patch({ ref: e.target.value })} /></td>
      <td className="c-desc"><textarea rows={2} value={item.description} onChange={(e) => patch({ description: e.target.value })} /></td>
      <td className="c-qty"><input type="number" step="any" value={item.qty} onChange={(e) => patch({ qty: e.target.value })} /></td>
      <td className="c-unit"><input value={item.unit} onChange={(e) => patch({ unit: e.target.value })} /></td>
      <td className="c-rate"><input type="number" step="any" value={item.rate} onChange={(e) => patch({ rate: e.target.value })} /></td>
      <td className="c-cat">
        <select value={item.category} onChange={(e) => patch({ category: e.target.value })}>
          {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>
      <td className="c-amt">{amount ? fmt(amount) : ''}</td>
      <td className="c-del"><button className="del-btn" onClick={remove}>✕</button></td>
    </tr>
  );
}

export default function BillScheduleTab({ rows, setRows, computed, snoById = {} }) {
  const patchAt = (id, ch) => setRows(rows.map((r) => (r.id === id ? { ...r, ...ch } : r)));
  const removeAt = (id) => setRows(rows.filter((r) => r.id !== id));
  const add = () => setRows([...rows, newBillRow()]);
  const s = computed?.scheduled;

  return (
    <div>
      <div className="bar"><strong>Schedule (editable)</strong><span className="hint">{rows.length} items · Recovery items are deducted</span></div>
      <table className="items-table bill-sched">
        <thead>
          <tr>
            <th className="c-sno">S.No</th><th className="c-ref">Ref DSR</th><th className="c-desc">Description</th>
            <th className="c-qty">Qty</th><th className="c-unit">Unit</th><th className="c-rate">Rate ₹</th>
            <th className="c-cat">Category</th><th className="c-amt">Amount ₹</th><th className="c-del"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((it) => (
            <Row key={it.id} sno={snoById[it.id]} item={it} patch={(c) => patchAt(it.id, c)} remove={() => removeAt(it.id)} />
          ))}
          {rows.length === 0 && <tr><td colSpan={9} className="empty">No items — upload a schedule or send one from the DSR → Schedule page.</td></tr>}
        </tbody>
      </table>
      <button className="add-btn" onClick={add}>+ Add item</button>

      {s && (
        <table className="sum-table">
          <tbody>
            <tr><td>Main (DSR + Appd.) subtotal</td><td className="r">{fmt(s.main)}</td></tr>
            <tr><td>× Multiplying factor</td><td className="r">{fmt(s.afterFactor)}</td></tr>
            <tr><td>+ Cost index</td><td className="r">{fmt(s.costIndex)}</td></tr>
            <tr><td>Corrected DSR total</td><td className="r">{fmt(s.corrected)}</td></tr>
            <tr><td>MKT / Recovery</td><td className="r">{fmt(s.mktRec)}</td></tr>
            <tr><td>Total</td><td className="r">{fmt(s.subtotal)}</td></tr>
            <tr><td>Less quoted %</td><td className="r">{fmt(s.less)}</td></tr>
            <tr className="grand"><td><b>Work Outlay (scheduled)</b></td><td className="r"><b>{fmt(s.outlay)}</b></td></tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
