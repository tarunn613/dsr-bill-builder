// Parse an uploaded schedule workbook (.xlsx) into normalized bill rows.
// Mirrors the client-side heuristic: find the header row, map columns, extract
// item rows, skip summary/adjustment lines.
import ExcelJS from 'exceljs';

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
function num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const c = String(v ?? '').replace(/Rs\.?|INR/gi, '').replace(/[,\s]/g, '').replace(/[^\d.\-]/g, '');
  if (!c || c === '-' || c === '.') return null;
  const n = Number(c); return isFinite(n) ? n : null;
}

function findHeader(m) {
  for (let i = 0; i < Math.min(m.length, 80); i++) {
    const r = (m[i] || []).map((c) => norm(c).toLowerCase());
    const hasDesc = r.some((c) => c.includes('description'));
    const hasRate = r.some((c) => c.includes('rate'));
    const hasQty = r.some((c) => c.includes('qty') || c.includes('quantity'));
    if (hasDesc && (hasRate || hasQty)) return i;
  }
  return -1;
}
function mapCols(h) {
  const L = h.map((x) => norm(x).toLowerCase());
  const find = (...n) => L.findIndex((c) => n.some((x) => c.includes(x)));
  const amountCols = L.map((c, i) => ({ c, i })).filter((x) => x.c.includes('amount'));
  return {
    sno: find('s.no', 's no', 'sno', 'serial'), ref: find('ref', 'dsr'),
    desc: find('description'), qty: find('qty', 'quantity'), unit: find('unit'),
    rate: find('rate'), amount: amountCols.length ? amountCols[amountCols.length - 1].i : -1,
    cat: find('category', 'source'),
  };
}
function categoryFrom(ref, explicit) {
  const s = norm(explicit || ref).toUpperCase();
  if (s.includes('RECOV')) return 'Recovery';
  if (s.includes('MKT') || s.includes('MARKET')) return 'MKT';
  if (s.includes('APPD') || s.includes('APPROVED')) return 'Appd.';
  return 'DSR';
}

function matrixToRows(m) {
  if (!m.length) return { rows: [], meta: {} };
  const meta = {};
  const HDR = { 'NAME OF WORK': 'workName', 'SUB-HEAD': 'subHead', 'SUBHEAD': 'subHead', 'AGENCY': 'agency', 'AGREEMENT': 'workNo', 'TENDER': 'tenderAmount', 'ESTIMATE': 'estimateAmount', 'QUOTED': 'quotedRate' };
  for (let r = 0; r < Math.min(m.length, 18); r++) {
    const cell = norm(m[r][0] || '').toUpperCase();
    for (const k in HDR) {
      if (cell.includes(k)) {
        let v = String(m[r][0] || '').replace(new RegExp('^.*?' + k + '[:\\-\\s]*', 'i'), '').trim();
        if (!v && m[r][1]) v = norm(m[r][1]);
        if (v && !meta[HDR[k]]) meta[HDR[k]] = v;
        break;
      }
    }
  }
  const hi = findHeader(m);
  let cols, ds;
  if (hi >= 0) { cols = mapCols(m[hi]); ds = hi + 1; }
  else { cols = { sno: 0, ref: 1, desc: 2, qty: 3, unit: 4, rate: 5, amount: 6, cat: -1 }; ds = 0; }
  ['desc', 'qty', 'rate', 'sno', 'ref', 'unit'].forEach((k) => { if (cols[k] < 0) cols[k] = { desc: 2, qty: 3, rate: 5, sno: 0, ref: 1, unit: 4 }[k]; });

  const rows = [];
  for (let i = ds; i < m.length; i++) {
    const rr = m[i] || [];
    const desc = norm(rr[cols.desc]), snoR = norm(rr[cols.sno]), ref = norm(rr[cols.ref]);
    const qty = num(rr[cols.qty]), rate = num(rr[cols.rate]);
    if (!desc && !snoR && !ref && qty == null && rate == null) continue;
    if (/^(total|subtotal|grand total|say|multiplying|applying|add @|add cost|corrected|work outlay|less @)/i.test(desc || snoR)) continue;
    if (!desc || qty == null || rate == null) continue;
    rows.push({
      // Keep the sheet's own S.No cell verbatim (a string) — it may be a merged
      // ("16 17") or lettered ("5A") value that num() would otherwise mangle.
      sno: snoR || String(rows.length + 1), ref, description: desc, unit: norm(rr[cols.unit]),
      qty, rate, category: categoryFrom(ref, cols.cat >= 0 ? rr[cols.cat] : ''),
    });
  }
  return { rows, meta };
}

async function parseScheduleBuffer(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  let ws = wb.worksheets.find((s) => /schedule/i.test(s.name)) || wb.worksheets[0];
  if (!ws) return { rows: [], meta: {} };
  const m = [];
  ws.eachRow({ includeEmpty: true }, (row, rn) => {
    const arr = [];
    row.eachCell({ includeEmpty: true }, (cell, cn) => {
      let v = cell.value;
      if (v && typeof v === 'object') v = v.result ?? v.text ?? v.richText?.map((t) => t.text).join('') ?? '';
      arr[cn - 1] = v;
    });
    m[rn - 1] = arr;
  });
  return matrixToRows(m);
}

export { parseScheduleBuffer, matrixToRows };
