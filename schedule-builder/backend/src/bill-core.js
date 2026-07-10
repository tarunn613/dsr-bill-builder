// RA Bill calculation core — shared by the live preview (/api/bill/compute)
// and the workbook builder (/api/bill/xlsx), so on-screen numbers and the
// exported formula-driven sheet agree.
//
// Chain (matches a real DUSIB bill, e.g. final-sheet-required.xlsx):
//   main total      = Σ (DSR + Appd. items)            [qty × rate]
//   × factor        (e.g. 0.973)                        -> after factor
//   + cost index @ N%                                   = corrected DSR total
//   + MKT items (at par, +) and Recovery items (at par, −)
//   = subtotal
//   less quoted % (below → subtract, above → add)
//   = Work Outlay   (rounded to nearest rupee)
//
// The Abstract runs the SAME chain but on measured quantities (from RE),
// leaving amounts blank until measurements are entered.

function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return isFinite(n) ? n : 0;
}
function round2(n) { return isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0; }
function round3(n) { return isFinite(n) ? Math.round((n + Number.EPSILON) * 1000) / 1000 : 0; }

function isMain(category) {
  return !(category === 'MKT' || category === 'Recovery');
}

// quantity of one measurement row = product of non-blank factors (Excel PRODUCT semantics)
function rowQty(r) {
  if (!r || r.n === '' || r.n === null || r.n === undefined) return null;
  const n = Number(r.n);
  if (!isFinite(n)) return null;
  const mul = (x) => {
    if (x === '' || x === null || x === undefined) return 1;
    const v = Number(x);
    return isFinite(v) ? v : 1;
  };
  return n * mul(r.f) * mul(r.l) * mul(r.w) * mul(r.h);
}

// measured quantity of an item = Σ its measurement rows (null if none entered)
function itemMeasuredQty(rows) {
  let t = 0, any = false;
  for (const r of rows || []) {
    const q = rowQty(r);
    if (q !== null) { t += q; any = true; }
  }
  return any ? round3(t) : null;
}

function runChain(mainAmt, mktRecAmt, factor, ciPct, quotedPct, quotedType) {
  const afterFactor = round2(mainAmt * factor);
  const costIndex = round2(afterFactor * ciPct / 100);
  const corrected = round2(afterFactor + costIndex);
  const subtotal = round2(corrected + mktRecAmt);
  const less = round2(subtotal * quotedPct / 100);
  const outlay = Math.round(quotedType === 'above' ? subtotal + less : subtotal - less);
  return { main: round2(mainAmt), afterFactor, costIndex, corrected, mktRec: round2(mktRecAmt), subtotal, less, outlay };
}

function computeBill(payload = {}) {
  const factor = payload.factor === '' || payload.factor == null ? 1 : num(payload.factor);
  const ciPct = num(payload.costIndexPct);
  const quotedPct = num(payload.quotedPct);
  const quotedType = payload.quotedType === 'above' ? 'above' : 'below';
  const rows = payload.rows || [];
  const meas = payload.meas || {};

  const items = rows.map((it, i) => {
    const category = it.category || 'DSR';
    const rate = num(it.rate);
    const schedQty = num(it.qty);
    const measuredQty = itemMeasuredQty(meas[i]);
    const schedAmt = round2(schedQty * rate);
    const measAmt = measuredQty === null ? null : round2(measuredQty * rate);
    const sign = category === 'Recovery' ? -1 : 1;
    return {
      index: i, category, ref: it.ref || '', description: it.description || '',
      unit: it.unit || '', rate, schedQty, measuredQty,
      schedAmt: sign * schedAmt, measAmt: measAmt === null ? null : sign * measAmt,
    };
  });

  const mainItems = items.filter((x) => isMain(x.category));
  const mktItems = items.filter((x) => !isMain(x.category));

  const schedMain = mainItems.reduce((s, x) => s + x.schedAmt, 0);
  const schedMkt = mktItems.reduce((s, x) => s + x.schedAmt, 0);
  const measMain = mainItems.reduce((s, x) => s + (x.measAmt || 0), 0);
  // MKT / Recovery are billed at their scheduled quantity (Abstract pulls their
  // qty from the Schedule, not RE), so the measured chain uses their scheduled amount.
  const measMkt = mktItems.reduce((s, x) => s + x.schedAmt, 0);

  return {
    items, factor, ciPct, quotedPct, quotedType,
    scheduled: runChain(schedMain, schedMkt, factor, ciPct, quotedPct, quotedType),
    measured: runChain(measMain, measMkt, factor, ciPct, quotedPct, quotedType),
  };
}

export { computeBill, itemMeasuredQty, rowQty, isMain, num, round2, round3 };
