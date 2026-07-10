import React from 'react';

const isMain = (c) => !(c === 'MKT' || c === 'Recovery');
const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const mul = (x) => (x === '' || x == null ? 1 : (isFinite(Number(x)) ? Number(x) : 1));

function rowQty(r) {
  if (!r || r.n === '' || r.n == null || !isFinite(Number(r.n))) return null;
  return round3(Number(r.n) * mul(r.f) * mul(r.l) * mul(r.w) * mul(r.h));
}
function blockTotal(list) {
  let t = 0, any = false;
  for (const r of list || []) { const q = rowQty(r); if (q != null) { t += q; any = true; } }
  return any ? round3(t) : null;
}
const newMeasRow = () => ({ label: '', n: '', f: '', l: '', w: '', h: '' });

function Block({ item, itemNo, list, setList }) {
  const rows = list && list.length ? list : [newMeasRow()];
  const patch = (j, ch) => setList(rows.map((r, k) => (k === j ? { ...r, ...ch } : r)));
  const add = () => setList([...rows, newMeasRow()]);
  const del = (j) => setList(rows.filter((_, k) => k !== j));
  const total = blockTotal(rows);

  return (
    <div className="reblk">
      <div className="reblk-head">
        <span><b>Item {itemNo}</b> — {item.description || <i>(no description)</i>} {item.unit && <em>({item.unit})</em>}</span>
      </div>
      <table className="items-table re-table">
        <thead>
          <tr>
            <th style={{ width: 34 }}>#</th><th style={{ minWidth: 120 }}>Label</th>
            <th style={{ width: 70 }}>Nos</th><th style={{ width: 70 }}>×Factor</th>
            <th style={{ width: 80 }}>Length</th><th style={{ width: 80 }}>Width</th>
            <th style={{ width: 90 }}>Height/Depth</th><th style={{ width: 90 }}>Qty</th><th style={{ width: 30 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, j) => {
            const q = rowQty(r);
            const isLess = Number(r.n) < 0;
            return (
              <tr key={j} className={isLess ? 'less' : ''}>
                <td className="c-sno">{j + 1}</td>
                <td><input value={r.label} placeholder="e.g. open area / less" onChange={(e) => patch(j, { label: e.target.value })} /></td>
                <td><input type="number" step="any" value={r.n} onChange={(e) => patch(j, { n: e.target.value })} /></td>
                <td><input type="number" step="any" value={r.f} onChange={(e) => patch(j, { f: e.target.value })} /></td>
                <td><input type="number" step="any" value={r.l} onChange={(e) => patch(j, { l: e.target.value })} /></td>
                <td><input type="number" step="any" value={r.w} onChange={(e) => patch(j, { w: e.target.value })} /></td>
                <td><input type="number" step="any" value={r.h} onChange={(e) => patch(j, { h: e.target.value })} /></td>
                <td className="c-amt">{q == null ? '' : q}</td>
                <td className="c-del"><button className="del-btn" onClick={() => del(j)}>✕</button></td>
              </tr>
            );
          })}
          <tr className="totrow"><td colSpan={7} className="r">Total</td><td className="c-amt"><b>{total == null ? '' : total}</b></td><td></td></tr>
        </tbody>
      </table>
      <button className="add-btn sm" onClick={add}>+ Row</button>
    </div>
  );
}

export default function BillReTab({ rows, measById, setMeasById }) {
  const mainRows = rows.map((r, i) => ({ r, i })).filter((x) => isMain(x.r.category));
  if (!mainRows.length) return <div className="empty">Add DSR / Appd. items in the Schedule tab first.</div>;
  return (
    <div>
      <div className="bar"><strong>RE — Record of Measurements</strong>
        <span className="hint">Qty = Nos × Factor × L × W × H (blanks = 1). Use a negative “Nos” for “less” deductions.</span></div>
      {mainRows.map(({ r, i }) => (
        <Block key={r.id} item={r} itemNo={i + 1}
          list={measById[r.id]}
          setList={(list) => setMeasById({ ...measById, [r.id]: list })} />
      ))}
    </div>
  );
}
