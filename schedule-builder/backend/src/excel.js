// Build the Schedule of Work .xlsx, matching Schedule_of_Work.xlsx layout.
// Formula-driven (amount = qty*rate, totals via SUM/ROUND) so the file stays auditable.
import ExcelJS from 'exceljs';

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E23' } }; // dark green
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
const MONEY = '#,##,##0.00'; // Indian grouping (e.g. 7,23,540.69)
const QTY = '0.00';
const YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3B0' } };
const fmtIN = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

function buildScheduleWorkbook(computed, header = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DSR Schedule Builder';
  wb.created = new Date();
  const ws = wb.addWorksheet('Schedule of Work', {
    views: [{ state: 'frozen', ySplit: 0 }],
    pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'landscape' },
  });

  // Columns A..H
  ws.columns = [
    { width: 7 },   // A S.No
    { width: 12 },  // B DSR Ref
    { width: 62 },  // C Description
    { width: 10 },  // D Quantity
    { width: 9 },   // E Unit
    { width: 13 },  // F Rate
    { width: 34 },  // G Rate in words
    { width: 15 },  // H Amount
  ];

  const merge8 = (row) => ws.mergeCells(`A${row}:H${row}`);
  const titleRow = (text, opts = {}) => {
    const r = ws.addRow([text]);
    merge8(r.number);
    r.getCell(1).font = { bold: opts.bold !== false, size: opts.size || 11 };
    r.getCell(1).alignment = { horizontal: opts.center === false ? 'left' : 'center', wrapText: true, vertical: 'center' };
    if (opts.height) r.height = opts.height;
    return r;
  };

  // ---- Header block ----------------------------------------------------------
  titleRow(header.organization || 'DELHI URBAN SHELTER IMPROVEMENT BOARD, GNCTD');
  if (header.office) titleRow(header.office, { bold: false });
  if (header.division) titleRow(header.division, { bold: false });
  if (header.subHead) titleRow('Sub Head: ' + header.subHead, { bold: false, size: 10, height: 30 });
  if (header.nameOfWork) titleRow('Name of Work: ' + header.nameOfWork, { bold: false, size: 10, height: 30 });
  ws.addRow([]);
  titleRow('Schedule of Work', { size: 13, height: 20 });
  ws.addRow([]);

  // ---- Table header ----------------------------------------------------------
  const head = ws.addRow(['S. No.', 'DSR Ref. No.', 'Description of Item', 'Quantity', 'Unit', 'Rate (in Rupees)', 'Rate (in words)', 'Amount']);
  head.eachCell((c) => {
    c.fill = HEADER_FILL; c.font = HEADER_FONT; c.border = BORDER;
    c.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
  });
  head.height = 30;
  const headRowNum = head.number;
  ws.views = [{ state: 'frozen', ySplit: headRowNum }];

  const dataRow = (row) => {
    const r = ws.addRow([
      row.sno, row.ref, row.description, row.qty, row.unit, row.rate, row.rateWords, null,
    ]);
    r.getCell(4).numFmt = QTY;
    r.getCell(6).numFmt = MONEY;
    r.getCell(8).numFmt = MONEY;
    // amount formula = ROUND(qty*rate,2)
    r.getCell(8).value = { formula: `ROUND(D${r.number}*F${r.number},2)`, result: row.amount };
    r.getCell(1).alignment = { horizontal: 'center', vertical: 'top' };
    r.getCell(2).alignment = { horizontal: 'center', vertical: 'top' };
    r.getCell(3).alignment = { wrapText: true, vertical: 'top' };
    r.getCell(4).alignment = { horizontal: 'center', vertical: 'top' };
    r.getCell(5).alignment = { horizontal: 'center', vertical: 'top' };
    r.getCell(6).alignment = { horizontal: 'right', vertical: 'top' };
    r.getCell(7).alignment = { wrapText: true, vertical: 'top' };
    r.getCell(8).alignment = { horizontal: 'right', vertical: 'top' };
    r.eachCell((c) => { c.border = BORDER; });
    if (row.deviates) {
      r.getCell(6).fill = YELLOW;
      r.getCell(6).note = `Rate overridden by user.\nDSR 2023 book rate: ${fmtIN(row.bookRate)}`;
    }
    return r.number;
  };

  const summaryRow = (label, amount, formula, note, bold = false) => {
    const r = ws.addRow([null, null, label, null, null, null, note || null, null]);
    ws.mergeCells(`C${r.number}:F${r.number}`);
    r.getCell(3).alignment = { horizontal: 'right', vertical: 'center' };
    r.getCell(8).numFmt = MONEY;
    r.getCell(8).value = formula ? { formula, result: amount } : amount;
    r.getCell(8).alignment = { horizontal: 'right' };
    for (const col of [3, 7, 8]) r.getCell(col).fill = TOTAL_FILL;
    if (bold) { r.getCell(3).font = { bold: true }; r.getCell(8).font = { bold: true }; r.getCell(7).font = { bold: true }; }
    r.eachCell((c) => { c.border = BORDER; });
    return r.number;
  };

  // ---- DSR items -------------------------------------------------------------
  const dsrRowNums = computed.dsrRows.map(dataRow);
  const firstDsr = dsrRowNums[0];
  const lastDsr = dsrRowNums[dsrRowNums.length - 1];

  let c1Ref = null;
  if (dsrRowNums.length) {
    const subRow = summaryRow('Total', computed.dsrSubtotal, `ROUND(SUM(H${firstDsr}:H${lastDsr}),2)`, null, true);
    const facRow = summaryRow(`Multiplying factor @ ${computed.factor}`, computed.afterFactor, `ROUND(H${subRow}*${computed.factor},2)`);
    const ciRow = summaryRow(`Add @ ${computed.costIndexPct}% Cost Index on DSR 2023`, computed.costIndexAmount, `ROUND(H${facRow}*${computed.costIndexPct}/100,2)`);
    const c1Row = summaryRow('Corrected DSR Total', computed.c1, `ROUND(H${facRow}+H${ciRow},2)`, 'C1', true);
    c1Ref = `H${c1Row}`;
  }

  // ---- Market items ----------------------------------------------------------
  const mktRowNums = computed.marketRows.map(dataRow);
  const firstMkt = mktRowNums[0];
  const lastMkt = mktRowNums[mktRowNums.length - 1];

  // ---- Grand total + Say -----------------------------------------------------
  let grandFormula;
  if (c1Ref && mktRowNums.length) grandFormula = `ROUND(${c1Ref}+SUM(H${firstMkt}:H${lastMkt}),2)`;
  else if (c1Ref) grandFormula = `ROUND(${c1Ref},2)`;
  else if (mktRowNums.length) grandFormula = `ROUND(SUM(H${firstMkt}:H${lastMkt}),2)`;
  else grandFormula = null;

  const grandRow = summaryRow('Total', computed.grandTotal, grandFormula, 'C1', true);
  summaryRow('Say', computed.say, `ROUND(H${grandRow},0)`, 'C2', true);

  // Grand total in words as a full-width note
  ws.addRow([]);
  const wr = ws.addRow([computed.grandTotalWords]);
  ws.mergeCells(`A${wr.number}:H${wr.number}`);
  wr.getCell(1).font = { italic: true };
  wr.getCell(1).alignment = { wrapText: true };

  // Audit footnote: list every DSR line whose rate was overridden away from the book value
  const devs = computed.dsrRows.filter((r) => r.deviates);
  if (devs.length) {
    ws.addRow([]);
    const t = ws.addRow(['* Rate overrides (deviating from DSR 2023):']);
    ws.mergeCells(`A${t.number}:H${t.number}`);
    t.getCell(1).font = { bold: true, color: { argb: 'FF9B1C1C' } };
    for (const d of devs) {
      const dr = ws.addRow([`Item ${d.sno} (${d.ref}): used ${fmtIN(d.rate)} — DSR book rate ${fmtIN(d.bookRate)}`]);
      ws.mergeCells(`A${dr.number}:H${dr.number}`);
      dr.getCell(1).font = { color: { argb: 'FF9B1C1C' } };
    }
  }

  return wb;
}

export { buildScheduleWorkbook };
