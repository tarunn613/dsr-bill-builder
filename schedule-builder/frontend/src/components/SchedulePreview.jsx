import React from 'react';

const fmt = (r) => (r === '' || r == null ? '' : Number(r).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function SchedulePreview({ computed, header }) {
  if (!computed) return <div className="preview-empty">Add items to see the schedule…</div>;
  const { dsrRows, marketRows } = computed;

  return (
    <div className="preview">
      <div className="preview-header">
        <div className="ph-org">{header.organization || 'DELHI URBAN SHELTER IMPROVEMENT BOARD, GNCTD'}</div>
        {header.office && <div>{header.office}</div>}
        {header.division && <div>{header.division}</div>}
        {header.subHead && <div className="ph-sub">Sub Head: {header.subHead}</div>}
        {header.nameOfWork && <div className="ph-sub">Name of Work: {header.nameOfWork}</div>}
        <div className="ph-title">Schedule of Work</div>
      </div>
      <table className="preview-table">
        <thead>
          <tr>
            <th>S.No</th><th>DSR Ref</th><th>Description of Item</th><th>Qty</th>
            <th>Unit</th><th>Rate (₹)</th><th>Rate (in words)</th><th>Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {/* key by position, not r.sno: S.No is user-editable and may repeat (or two
              blank rows can both fall back to the same number), which would collide
              React keys and make rows duplicate/omit in this preview. */}
          {dsrRows.map((r, i) => (
            <tr key={'d' + i}>
              <td className="ctr">{r.sno}</td>
              <td className="ctr">{r.ref}</td>
              <td>{r.description}</td>
              <td className="ctr">{fmt(r.qty)}</td>
              <td className="ctr">{r.unit}</td>
              <td className={'rt' + (r.deviates ? ' dev' : '')} title={r.deviates ? `DSR book rate ₹${fmt(r.bookRate)}` : ''}>
                {fmt(r.rate)}{r.deviates ? ' *' : ''}
              </td>
              <td className="words">{r.rateWords}</td>
              <td className="rt">{fmt(r.amount)}</td>
            </tr>
          ))}
          {dsrRows.length > 0 && (
            <>
              <tr className="sum"><td colSpan={7} className="rt b">Total</td><td className="rt b">{fmt(computed.dsrSubtotal)}</td></tr>
              <tr className="sum"><td colSpan={7} className="rt">Multiplying factor @ {computed.factor}</td><td className="rt">{fmt(computed.afterFactor)}</td></tr>
              <tr className="sum"><td colSpan={7} className="rt">Add @ {computed.costIndexPct}% Cost Index on DSR 2023</td><td className="rt">{fmt(computed.costIndexAmount)}</td></tr>
              <tr className="sum"><td colSpan={6} className="rt b">Corrected DSR Total</td><td className="ctr">C1</td><td className="rt b">{fmt(computed.c1)}</td></tr>
            </>
          )}
          {marketRows.map((r, i) => (
            <tr key={'m' + i}>
              <td className="ctr">{r.sno}</td>
              <td className="ctr">{r.ref}</td>
              <td>{r.description}</td>
              <td className="ctr">{fmt(r.qty)}</td>
              <td className="ctr">{r.unit}</td>
              <td className="rt">{fmt(r.rate)}</td>
              <td className="words">{r.rateWords}</td>
              <td className="rt">{fmt(r.amount)}</td>
            </tr>
          ))}
          <tr className="grand"><td colSpan={6} className="rt b">Total</td><td className="ctr">C1</td><td className="rt b">{fmt(computed.grandTotal)}</td></tr>
          <tr className="grand"><td colSpan={6} className="rt b">Say</td><td className="ctr">C2</td><td className="rt b">{fmt(computed.say)}</td></tr>
        </tbody>
      </table>
      <div className="preview-words">{computed.grandTotalWords}</div>
      {dsrRows.some((r) => r.deviates) && (
        <div className="preview-overrides">
          <b>* Rate overrides (deviating from DSR 2023):</b>
          <ul>
            {dsrRows.filter((r) => r.deviates).map((r, i) => (
              <li key={i}>Item {r.sno} ({r.ref}): used ₹{fmt(r.rate)} — DSR book rate ₹{fmt(r.bookRate)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
