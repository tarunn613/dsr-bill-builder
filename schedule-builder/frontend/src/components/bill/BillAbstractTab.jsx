import React from 'react';

const fmt = (r) => (r === '' || r == null ? '' : Number(r).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const isMain = (c) => !(c === 'MKT' || c === 'Recovery');

export default function BillAbstractTab({ computed }) {
  if (!computed) return <div className="empty">Loading…</div>;
  const m = computed.measured;
  return (
    <div>
      <div className="bar"><strong>Abstract (derived from RE × Schedule rates)</strong>
        <span className="hint">Amounts stay blank until measurements are entered in RE</span></div>
      <table className="preview-table">
        <thead>
          <tr><th>S.No</th><th>Description</th><th>Qty</th><th>Unit</th><th>Rate ₹</th><th>Amount ₹</th><th>Source</th></tr>
        </thead>
        <tbody>
          {computed.items.map((it, i) => (
            <tr key={i} className={it.category === 'Recovery' ? 'recovery' : ''}>
              <td className="ctr">{it.sno ?? i + 1}</td>
              <td>{it.description}</td>
              <td className="rt">{it.measuredQty == null ? '' : fmt(it.measuredQty)}</td>
              <td className="ctr">{it.unit}</td>
              <td className="rt">{fmt(it.rate)}</td>
              <td className="rt">{it.measAmt == null ? '' : fmt(it.measAmt)}</td>
              <td className="hint">{isMain(it.category) ? 'RE total' : `RE total · ${it.category} at par`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="sum-table">
        <tbody>
          <tr><td>DSR measured subtotal</td><td className="r">{fmt(m.main)}</td></tr>
          <tr><td>× Multiplying factor</td><td className="r">{fmt(m.afterFactor)}</td></tr>
          <tr><td>+ Cost index</td><td className="r">{fmt(m.costIndex)}</td></tr>
          <tr><td>Corrected DSR subtotal</td><td className="r">{fmt(m.corrected)}</td></tr>
          <tr><td>MKT / Recovery subtotal</td><td className="r">{fmt(m.mktRec)}</td></tr>
          <tr><td>Total</td><td className="r">{fmt(m.subtotal)}</td></tr>
          <tr><td>Less quoted %</td><td className="r">{fmt(m.less)}</td></tr>
          <tr className="grand"><td><b>Gross Amount Payable</b></td><td className="r"><b>{fmt(m.outlay)}</b></td></tr>
        </tbody>
      </table>
    </div>
  );
}
