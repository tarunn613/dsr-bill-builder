// Authoritative schedule calculation engine + Indian number-to-words.
// The live preview (/api/schedule/compute), the Excel export and the PDF export
// all go through computeSchedule() so on-screen totals and files never diverge.

// ---- currency-safe rounding -------------------------------------------------
function round2(n) {
  if (!isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return isFinite(n) ? n : 0;
}

// ---- Indian number to words -------------------------------------------------
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
  'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen',
  'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy',
  'Eighty', 'Ninety'];

function twoDigit(n) {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10), o = n % 10;
  return TENS[t] + (o ? ' ' + ONES[o] : '');
}
function words999(n) {
  let w = '';
  const h = Math.floor(n / 100), r = n % 100;
  if (h) w += ONES[h] + ' Hundred';
  if (r) w += (w ? ' ' : '') + twoDigit(r);
  return w;
}
function numToWordsIndian(n) {
  n = Math.floor(n);
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  let w = '';
  if (crore) w += words999(crore) + ' Crore';
  if (lakh) w += (w ? ' ' : '') + words999(lakh) + ' Lakh';
  if (thousand) w += (w ? ' ' : '') + words999(thousand) + ' Thousand';
  if (n) w += (w ? ' ' : '') + words999(n);
  return w;
}

// "Rupees Two Thousand Four Hundred Thirty Four and Twenty Five Paise Only"
function amountInWords(value) {
  const v = round2(num(value));
  const rupees = Math.floor(v + 1e-6);
  const paise = Math.round((v - rupees) * 100);
  let s = 'Rupees ' + numToWordsIndian(rupees);
  if (paise > 0) s += ' and ' + numToWordsIndian(paise) + ' Paise';
  return s + ' Only';
}

// ---- schedule computation ---------------------------------------------------
// payload = {
//   header, factor, costIndexPct,
//   dsrItems:    [{ref, code, description, unit, rate, qty, category}]  (factored block)
//   marketItems: [{ref, description, unit, rate, qty}]                   (added at par)
// }
function computeSchedule(payload = {}) {
  const factor = payload.factor === undefined || payload.factor === '' ? 1 : num(payload.factor);
  const costIndexPct = num(payload.costIndexPct);

  // S.No: trust an explicit incoming value (typed by the user, or carried in from a
  // JSON/OCR import) verbatim — it's the schedule's own serial number and must never
  // be re-sorted or renumbered here. Only fall back to a running position counter
  // when a row genuinely has none (e.g. old saved sessions from before this field
  // existed). The counter is shared across dsrItems then marketItems so the fallback
  // matches today's on-screen ordering (DSR block first, market items after).
  let counter = 0;
  const mapRow = (r, forcedCategory) => {
    const qty = num(r.qty);
    const rate = num(r.rate);
    const amount = round2(qty * rate);
    const bookRate = r.bookRate === undefined || r.bookRate === null || r.bookRate === ''
      ? null : num(r.bookRate);
    const override = !!r.override;
    // a real deviation only when the user overrode AND the value differs from the DSR book rate
    const deviates = override && bookRate != null && round2(bookRate) !== rate;
    counter++;
    const sno = (r.sno !== undefined && r.sno !== null && String(r.sno).trim() !== '')
      ? String(r.sno).trim() : String(counter);
    return {
      sno,
      category: forcedCategory || r.category || 'DSR',
      ref: r.ref || r.code || '',
      code: r.code || r.ref || '',
      description: r.description || '',
      unit: r.unit || '',
      qty,
      rate,
      amount,
      rateWords: rate ? amountInWords(rate) : '',
      override,
      bookRate,
      deviates,
    };
  };

  const dsrRows = (payload.dsrItems || []).map((r) => mapRow(r));
  const marketRows = (payload.marketItems || []).map((r) => mapRow(r, 'MKT'));

  const dsrSubtotal = round2(dsrRows.reduce((s, r) => s + r.amount, 0));
  const afterFactor = round2(dsrSubtotal * factor);
  const costIndexAmount = round2(afterFactor * (costIndexPct / 100));
  const c1 = round2(afterFactor + costIndexAmount);          // corrected DSR total
  const marketSubtotal = round2(marketRows.reduce((s, r) => s + r.amount, 0));
  const grandTotal = round2(c1 + marketSubtotal);
  const say = Math.round(grandTotal);                         // nearest rupee

  return {
    dsrRows,
    marketRows,
    factor,
    costIndexPct,
    dsrSubtotal,
    afterFactor,
    costIndexAmount,
    c1,
    marketSubtotal,
    grandTotal,
    say,
    grandTotalWords: amountInWords(grandTotal),
    sayWords: amountInWords(say),
  };
}

export { computeSchedule, amountInWords, numToWordsIndian, round2, num };
