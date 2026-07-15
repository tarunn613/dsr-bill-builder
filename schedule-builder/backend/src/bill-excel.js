// Build the RA Bill workbook (Schedule + RE + Abstract) with exceljs.
// All three sheets are cross-linked with live formulas so the workbook is dynamic:
//   • RE quantity  = PRODUCT(Nos, factor, L, W, H) per row; item Total = SUM(rows) (unrounded, shown 2 dp)
//   • Abstract qty = RE item Total  (blank until measured) → amount = qty × Schedule rate
//   • Schedule description/rate/unit flow into RE and Abstract by reference
// Editing an RE measurement updates the Abstract; editing the Schedule updates both.
import ExcelJS from 'exceljs';
import { isMain, round2, effectiveSno } from './bill-core.js';

const MONEY = '#,##,##0.00';
const QTY = '0.00';
const thin = { style: 'thin', color: { argb: 'FF334155' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const GREEN = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
const GREY = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
const YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const WHITEBOLD = { bold: true, color: { argb: 'FFFFFFFF' } };

function colLetter(n) { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }

// approximate row height so a wrapped description is fully visible in any viewer
// (viewers don't reliably auto-fit rows for wrapText cells filled by a formula)
function descHeight(text, charsPerLine) {
  const len = String(text || '').length;
  const lines = Math.max(1, Math.ceil(len / charsPerLine));
  return Math.min(170, Math.max(16, lines * 15));
}

function num(v) { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : ''; }

// srcSheet (optional): when set, the tender-detail rows mirror that sheet via live
// formulas instead of writing literals — so the details are typed once on the Schedule
// sheet and reflect on RE / Abstract / Cement. The title row stays sheet-specific.
function headerBlock(ws, meta, width, title, srcSheet) {
  const last = colLetter(width);
  const line = (r, text, opts = {}) => {
    ws.mergeCells(`A${r}:${last}${r}`);
    const c = ws.getCell(`A${r}`);
    c.value = (srcSheet && !opts.title)
      ? { formula: `IF(${srcSheet}!A${r}="","",${srcSheet}!A${r})` }
      : text;
    c.font = { bold: opts.bold || false, size: opts.size || 11 };
    c.alignment = { horizontal: opts.center ? 'center' : 'left', vertical: 'center', wrapText: true };
    if (opts.fill) c.fill = YELLOW;
  };
  const q = `${(num(meta.quotedPct) || 0).toFixed(2)}% ${meta.quotedType === 'above' ? 'above' : 'below'}`;
  line(1, title || meta.billNo || 'Running Account Bill', { bold: true, size: 13, center: true, title: true });
  line(3, `NAME OF WORK:- ${meta.workName || ''}`, { bold: true });
  line(4, `SUB-HEAD:- ${meta.subHead || ''}`, { bold: true });
  line(5, `Agency : ${meta.agency || ''}`, { fill: true });
  line(6, `No:  ${meta.workNo || ''}`, { fill: true });
  line(7, `Tender Amount Rs. ${meta.tenderAmount || ''}`, { fill: true });
  line(8, `Estimate Amount Rs. ${meta.estimateAmount || ''}`, { fill: true });
  line(9, `Quoted Rate : ${q}`, { fill: true });
  line(11, `DATE OF START AS PER AGMT. : ${meta.dateStart || ''}`, { fill: true });
  line(12, `DATE OF COMPLETION AS PER AGMT : ${meta.dateCompletion || ''}`, { fill: true });
  line(14, `ACTUAL DATE OF START :`, { fill: true });
  line(15, `ACTUAL DATE OF COMPLETION :`, { fill: true });
}

function colHeaderRow(ws, r, headers) {
  headers.forEach((h, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = h; c.fill = GREEN; c.font = WHITEBOLD; c.border = BORDER;
    c.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
  });
}

// ---- main entry -------------------------------------------------------------
function buildBillWorkbook(payload = {}) {
  const meta = payload.meta || {};
  const rows = payload.rows || [];
  const meas = payload.meas || {};
  const factor = payload.factor === '' || payload.factor == null ? 1 : num(payload.factor) || 0;
  const ciPct = num(payload.costIndexPct) || 0;
  const quotedPct = num(payload.quotedPct) || 0;
  const below = payload.quotedType !== 'above';

  // ordering: main (DSR/Appd) items first, then MKT/Recovery — matches a real bill
  const idx = rows.map((_, i) => i);
  const mainIdx = idx.filter((i) => isMain(rows[i].category || 'DSR'));
  const mktIdx = idx.filter((i) => !isMain(rows[i].category || 'DSR'));
  const ordered = [...mainIdx, ...mktIdx]; // schedule order: main items first, then MKT/Recovery

  const wb = new ExcelJS.Workbook();
  wb.creator = 'DSR Bill Builder';
  wb.calcProperties.fullCalcOnLoad = true;

  const schedRow = {}; // originalIndex -> schedule row
  const reTotalRow = {}; // originalIndex -> RE total row (main items only)
  const abQtyRow = {}; // originalIndex -> Abstract qty row (for the Cement sheet)

  // ============ SCHEDULE ============
  const sch = wb.addWorksheet('Schedule', { views: [{ showGridLines: false }] });
  sch.columns = [{ width: 7 }, { width: 12 }, { width: 68 }, { width: 9 }, { width: 9 }, { width: 13 }, { width: 15 }];
  headerBlock(sch, meta, 7, meta.billNo);
  colHeaderRow(sch, 19, ['S.No', 'Ref to DSR', 'DESCRIPTION', 'QTY.', 'UNIT', 'RATE', 'AMOUNT']);

  const writeItemRow = (r, sno, it, recovery) => {
    const cells = [sno, it.ref || '', it.description || '', num(it.qty), it.unit || '', num(it.rate)];
    cells.forEach((v, i) => {
      const c = sch.getCell(r, i + 1); c.value = v; c.border = BORDER;
      if (i === 2) c.alignment = { wrapText: true, vertical: 'top' };
      else c.alignment = { horizontal: i === 0 ? 'center' : (i >= 3 ? 'right' : 'left'), vertical: 'top' };
      if (i === 1 || i === 2 || i === 3 || i === 4 || i === 5) c.fill = YELLOW;
    });
    sch.getCell(r, 4).numFmt = QTY;
    sch.getCell(r, 6).numFmt = MONEY;
    const g = sch.getCell(r, 7);
    g.value = { formula: recovery ? `-ROUND(D${r}*F${r},2)` : `ROUND(D${r}*F${r},2)` };
    g.numFmt = MONEY; g.border = BORDER; g.alignment = { horizontal: 'right' };
    sch.getRow(r).height = descHeight(it.description, 62);
  };

  // S.No is effectiveSno() (see bill-core.js) — the row's own explicit serial number
  // if it has one (from a JSON/OCR import or an uploaded schedule's S.No column),
  // else its position in the schedule (i + 1) as a fallback — NOT a running counter
  // over the printed rows. The sheet groups MKT/Recovery below the corrected-DSR
  // subtotal, so a running counter would renumber them and they'd no longer match
  // the BOQ / the app's Schedule tab. Either way this can leave a gap in the main
  // block wherever an MKT/Recovery item sits — that gap is intentional and is what
  // lets the AE/JE find "item 44" in both documents.
  let r = 21;
  const mainStart = r;
  for (const i of mainIdx) { schedRow[i] = r; writeItemRow(r, effectiveSno(rows[i], i), rows[i], false); r++; }
  const mainEnd = r - 1;

  const sumLabel = (row, text, formula, bold = true) => {
    sch.mergeCells(`C${row}:F${row}`);
    const lc = sch.getCell(`C${row}`); lc.value = text; lc.alignment = { horizontal: 'right' }; lc.font = { bold }; lc.border = BORDER;
    const g = sch.getCell(`G${row}`); g.value = { formula }; g.numFmt = MONEY; g.font = { bold }; g.border = BORDER; g.alignment = { horizontal: 'right' };
    sch.getCell(`A${row}`).border = BORDER; sch.getCell(`B${row}`).border = BORDER;
    return row;
  };

  r += 1;
  const totRow = sumLabel(r, 'Total Amount (Rs.)', `ROUND(SUM(G${mainStart}:G${mainEnd}),2)`);
  const facRow = sumLabel(r + 1, `Applying correction of ${factor}`, `ROUND(G${totRow}*${factor},2)`, false);
  const ciRow = sumLabel(r + 2, `Applying cost index of ${ciPct}%`, `ROUND(G${facRow}*${ciPct}%,2)`, false);
  const corrRow = sumLabel(r + 3, 'Corrected DSR Total (Rs.)', `ROUND(G${facRow}+G${ciRow},2)`);

  // MKT / recovery items
  r = corrRow + 1;
  for (const i of mktIdx) { schedRow[i] = r; writeItemRow(r, effectiveSno(rows[i], i), rows[i], rows[i].category === 'Recovery'); r++; }
  const mktEnd = r - 1;

  const subFormula = mktIdx.length ? `ROUND(G${corrRow}+SUM(G${corrRow + 1}:G${mktEnd}),2)` : `ROUND(G${corrRow},2)`;
  const subRow = sumLabel(r, 'Total (Rs.)', subFormula);
  const lessRow = sumLabel(r + 1, `Less @ ${quotedPct}% ${below ? 'below' : 'above'} as per Contractor quoted rate`, `ROUND(G${subRow}*${quotedPct}%,2)`, false);
  sumLabel(r + 2, 'Work Outlay (Rs.)', `ROUND(G${subRow}${below ? '-' : '+'}G${lessRow},0)`);

  // ============ RE (one measurement block per item; the signature line sits
  //   OUTSIDE the table, and every item is measured — MKT/Recovery included) ============
  const re = wb.addWorksheet('RE', { views: [{ showGridLines: false }] });
  re.columns = [{ width: 7 }, { width: 36 }, { width: 8 }, { width: 8 }, { width: 11 }, { width: 11 }, { width: 12 }, { width: 13 }, { width: 9 }];
  headerBlock(re, meta, 9, 'Record Entry', 'Schedule');

  // signature line — deliberately borderless (not part of the table), spread across the page
  const signatureLine = (rr) => {
    const marks = [['B', 'A.E.'], ['E', 'J.E. (C)'], ['H', 'Cont.']];
    for (const [c, label] of marks) {
      const cell = re.getCell(`${c}${rr}`);
      cell.value = label; cell.font = { bold: true }; cell.alignment = { horizontal: 'center' };
    }
  };

  let ry = 17;
  for (const i of ordered) {
    const sr = schedRow[i];
    re.getCell(`B${ry}`).value = 'Date of Measurement:-'; re.getCell(`B${ry}`).font = { bold: true };
    re.getCell(`H${ry}`).value = 'P-'; re.getCell(`H${ry}`).font = { bold: true };
    colHeaderRow(re, ry + 1, ['S.No', 'Description', 'Nos', 'Nos', 'Length', 'Width', 'Height /Depth', 'Quantity', 'Unit']);
    const itemRow = ry + 2;
    re.getCell(`A${itemRow}`).value = { formula: `IF(Schedule!A${sr}="","",Schedule!A${sr})` };
    re.getCell(`B${itemRow}`).value = { formula: `IF(Schedule!C${sr}="","",Schedule!C${sr})` };
    for (let c = 1; c <= 9; c++) { re.getCell(itemRow, c).border = BORDER; re.getCell(itemRow, c).font = { bold: true }; }
    re.getCell(`B${itemRow}`).alignment = { wrapText: true, vertical: 'top' };
    re.getRow(itemRow).height = descHeight(rows[i].description, 34);

    // Every item gets the measured grid — MKT / Recovery included. Their "at par"
    // treatment is purely about the rate (no factor / cost index, applied further down
    // in the Schedule and Abstract summaries); the quantity is measured here like any
    // other item. This total is what the Abstract multiplies by the rate, so a bare
    // link to Schedule!D here would hard-code the tendered quantity and make the
    // measurements typed into this grid have no effect on the bill.
    const mrows = (meas[i] || []).filter((m) => m && (m.n !== '' && m.n != null));
    const nMeas = Math.max(mrows.length, 6);
    const ms = itemRow + 1, me = ms + nMeas - 1;
    for (let k = 0; k < nMeas; k++) {
      const rr = ms + k, m = mrows[k] || {};
      const put = (col, val) => { const c = re.getCell(rr, col); if (val !== '' && val != null) c.value = num(val); c.fill = YELLOW; c.border = BORDER; c.alignment = { horizontal: 'right' }; };
      const b = re.getCell(rr, 2); b.value = m.label || ''; b.fill = YELLOW; b.border = BORDER; b.alignment = { wrapText: true };
      re.getCell(rr, 1).border = BORDER;
      put(3, m.n); put(4, m.f); put(5, m.l); put(6, m.w); put(7, m.h);
      const h = re.getCell(rr, 8); h.value = { formula: `IF(C${rr}="","",PRODUCT(C${rr}:G${rr}))` }; h.numFmt = QTY; h.border = BORDER; h.alignment = { horizontal: 'right' };
      re.getCell(rr, 9).border = BORDER;
    }
    const tRow = me + 1;
    const th = re.getCell(`H${tRow}`); th.value = { formula: `IF(SUM(H${ms}:H${me})=0,"",SUM(H${ms}:H${me}))` }; th.numFmt = QTY; th.font = { bold: true };
    re.getCell(`G${tRow}`).value = 'Total'; re.getCell(`G${tRow}`).font = { bold: true }; re.getCell(`G${tRow}`).alignment = { horizontal: 'right' };
    re.getCell(`I${tRow}`).value = { formula: `IF(Schedule!E${sr}="","",Schedule!E${sr})` };
    for (const c of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']) re.getCell(`${c}${tRow}`).border = BORDER;
    reTotalRow[i] = tRow;
    re.getCell(`B${tRow + 1}`).value = 'C/O   MB -                     P-';
    signatureLine(tRow + 3);
    ry = tRow + 5;
  }

  // ============ ABSTRACT ============
  const ab = wb.addWorksheet('Abstract', { views: [{ showGridLines: false }] });
  ab.columns = [{ width: 7 }, { width: 68 }, { width: 12 }, { width: 9 }, { width: 13 }, { width: 15 }];
  headerBlock(ab, meta, 6, meta.billNo, 'Schedule');
  colHeaderRow(ab, 18, ['S.No', 'DESCRIPTION', 'QTY.', 'UNIT', 'RATE', 'AMOUNT']);
  let ay = 20;
  const mainAmtCells = [], mktAmtCells = [];
  for (const i of ordered) {
    const sr = schedRow[i], main = isMain(rows[i].category || 'DSR'), recovery = rows[i].category === 'Recovery';
    const descRow = ay, qtyRow = ay + 1;
    ab.getCell(`A${descRow}`).value = { formula: `IF(Schedule!A${sr}="","",Schedule!A${sr})` };
    ab.getCell(`B${descRow}`).value = { formula: `IF(Schedule!C${sr}="","",Schedule!C${sr})` };
    ab.getCell(`B${descRow}`).alignment = { wrapText: true, vertical: 'top' };
    ab.getRow(descRow).height = descHeight(rows[i].description, 62);
    for (let c = 1; c <= 6; c++) ab.getCell(descRow, c).border = BORDER;
    // qty: brought forward from the RE total for EVERY item, MKT / Recovery included —
    // "at par" only exempts them from the factor / cost index below, not from measurement.
    ab.getCell(`B${qtyRow}`).value = 'Qty. B/F from RE -            at P -';
    const qC = ab.getCell(`C${qtyRow}`);
    qC.value = { formula: `IF(RE!H${reTotalRow[i]}="","",RE!H${reTotalRow[i]})` };
    qC.numFmt = QTY; qC.alignment = { horizontal: 'right' };
    ab.getCell(`D${qtyRow}`).value = { formula: `IF(Schedule!E${sr}="","",Schedule!E${sr})` };
    ab.getCell(`E${qtyRow}`).value = { formula: `IF(Schedule!F${sr}="","",Schedule!F${sr})` };
    ab.getCell(`E${qtyRow}`).numFmt = MONEY;
    const fC = ab.getCell(`F${qtyRow}`);
    fC.value = { formula: `IF(OR(C${qtyRow}="",E${qtyRow}=""),"",${recovery ? '-' : ''}ROUND(C${qtyRow}*E${qtyRow},2))` };
    fC.numFmt = MONEY; fC.alignment = { horizontal: 'right' };
    for (let c = 1; c <= 6; c++) ab.getCell(qtyRow, c).border = BORDER;
    (main ? mainAmtCells : mktAmtCells).push(`F${qtyRow}`);
    abQtyRow[i] = qtyRow;
    ay = qtyRow + 1; // next item starts immediately, no spacer row
  }

  // Abstract summary (measured chain)
  const asum = (row, text, formula, bold = true) => {
    ab.mergeCells(`B${row}:E${row}`);
    const lc = ab.getCell(`B${row}`); lc.value = text; lc.alignment = { horizontal: 'right' }; lc.font = { bold }; lc.border = BORDER;
    const f = ab.getCell(`F${row}`); f.value = { formula }; f.numFmt = MONEY; f.font = { bold }; f.border = BORDER; f.alignment = { horizontal: 'right' };
    ab.getCell(`A${row}`).border = BORDER;
    return row;
  };
  ay += 1;
  const sumMain = mainAmtCells.length ? `ROUND(SUM(${mainAmtCells.join(',')}),2)` : '0';
  const aTot = asum(ay, 'DSR measured subtotal', sumMain);
  const aFac = asum(ay + 1, `Applying correction of ${factor}`, `ROUND(F${aTot}*${factor},2)`, false);
  const aCi = asum(ay + 2, `Applying cost index of ${ciPct}%`, `ROUND(F${aFac}*${ciPct}%,2)`, false);
  const aCorr = asum(ay + 3, 'Corrected DSR subtotal', `ROUND(F${aFac}+F${aCi},2)`);
  const sumMkt = mktAmtCells.length ? `ROUND(SUM(${mktAmtCells.join(',')}),2)` : '0';
  const aMkt = asum(ay + 4, 'MKT / Recovery subtotal', sumMkt, false);
  const aSub = asum(ay + 5, 'Total (Rs.)', `ROUND(F${aCorr}+F${aMkt},2)`);
  const aLess = asum(ay + 6, `Less @ ${quotedPct}% ${below ? 'below' : 'above'}`, `ROUND(F${aSub}*${quotedPct}%,2)`, false);
  asum(ay + 7, 'Gross Amount Payable (Rs.)', `ROUND(F${aSub}${below ? '-' : '+'}F${aLess},0)`);

  // ============ CEMENT (only items given a coefficient or manually added) ============
  // Qty links live to the Abstract (if not overridden); Cement (Qtl) = Qty × coeff; Bags = Qtl × 2 (50 kg/bag).
  // Sheet columns: S.No | DSR Ref | Description | Qty | Unit | Coeff.(Qtl/unit) | Cement(Qtl) | Bags(50 kg)
  const cementMap = payload.cement || {};
  const cementMode = payload.cementMode || 'fetch';
  const cementManualRows = payload.cementManualRows || [];
  const cementQtyOverrides = payload.cementQtyOverrides || {};
  const cementDescOverrides = payload.cementDescOverrides || {};

  const isManualMode = cementMode === 'manual';
  const cemItems = isManualMode ? [] : ordered.filter((i) => num(cementMap[i]) > 0);
  const cementFetchExtraRows = payload.cementFetchExtraRows || [];

  if (isManualMode ? cementManualRows.length > 0 : (cemItems.length > 0 || cementFetchExtraRows.length > 0)) {
    const cem = wb.addWorksheet('Cement', { views: [{ showGridLines: false }] });
    // 7 columns: A=S.No, B=Ref, C=Description, D=Qty, E=Unit, F=Coeff, G=Cement(Qtl)
    cem.columns = [
      { width: 6 },   // A: S.No
      { width: 12 },  // B: DSR Ref
      { width: 56 },  // C: Description
      { width: 11 },  // D: Qty
      { width: 8 },   // E: Unit
      { width: 14 },  // F: Coeff
      { width: 14 },  // G: Cement (Qtl)
    ];
    headerBlock(cem, meta, 7, 'CEMENT CONSUMPTION STATEMENT', 'Schedule');
    // Source note row
    cem.mergeCells('A16:G16');
    const noteCell = cem.getCell('A16');
    noteCell.value = isManualMode
      ? 'Ref: Independent Manual Cement Consumption Statement. Unit: Quintals per unit of work (1 Qtl = 100 kg = 2 bags of 50 kg).'
      : 'Ref: DSR 2023 Vol-2 — Coefficients for Cement Consumption. Unit: Quintals per unit of work (1 Qtl = 100 kg = 2 bags of 50 kg).';
    noteCell.font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
    noteCell.alignment = { horizontal: 'left' };

    colHeaderRow(cem, 17, ['S.No', 'DSR Ref', 'Description', 'Qty', 'Unit', 'Coeff.\n(Qtl/unit)', 'Cement\n(Qtl)']);
    cem.getRow(17).height = 28;

    const cemStart = 18;
    let cy = cemStart, cs = 0;

    if (isManualMode) {
      for (const mr of cementManualRows) {
        // A: S.No
        const ac = cem.getCell(`A${cy}`); ac.value = ++cs; ac.border = BORDER; ac.alignment = { horizontal: 'center', vertical: 'top' };
        // B: DSR Ref
        const bc = cem.getCell(`B${cy}`); bc.value = mr.ref || ''; bc.border = BORDER; bc.alignment = { horizontal: 'left', vertical: 'top' }; bc.font = { bold: true, color: { argb: 'FF1f4e23' } };
        // C: Description
        cem.getCell(`C${cy}`).value = mr.description || '';
        cem.getCell(`C${cy}`).alignment = { wrapText: true, vertical: 'top' };
        cem.getRow(cy).height = descHeight(mr.description, 46);
        // D: Qty
        const dc = cem.getCell(`D${cy}`); dc.value = num(mr.qty); dc.numFmt = QTY; dc.alignment = { horizontal: 'right', vertical: 'top' };
        // E: Unit
        cem.getCell(`E${cy}`).value = mr.unit || '';
        cem.getCell(`E${cy}`).alignment = { horizontal: 'center', vertical: 'top' };
        // F: Coefficient
        const fc = cem.getCell(`F${cy}`); fc.value = num(mr.coeff); fc.numFmt = '0.000'; fc.fill = YELLOW; fc.alignment = { horizontal: 'right', vertical: 'top' };
        // G: Cement (Qtl)
        const gc = cem.getCell(`G${cy}`); gc.value = { formula: `IF(D${cy}="","",ROUND(D${cy}*F${cy},2))` }; gc.numFmt = QTY; gc.alignment = { horizontal: 'right', vertical: 'top' };

        for (let c = 1; c <= 7; c++) cem.getCell(cy, c).border = BORDER;
        cy++;
      }
    } else {
      for (const i of cemItems) {
        const sr = schedRow[i], aq = abQtyRow[i];
        // A: S.No — the item's SCHEDULE serial number, linked live from the Schedule
        // sheet (same as RE/Abstract do). This sheet lists only cement-consuming
        // items, so these numbers are sparse and non-contiguous BY DESIGN (9, 10, 11,
        // 17, 20, 24 ...) — exactly like the hand-made bill. A running 1..N counter
        // here would look tidier but would break the AE/JE's BOQ cross-check.
        const ac = cem.getCell(`A${cy}`);
        ac.value = { formula: `IF(Schedule!A${sr}="","",Schedule!A${sr})` };
        ac.border = BORDER; ac.alignment = { horizontal: 'center', vertical: 'top' };
        // B: DSR Ref (from Schedule)
        const bc = cem.getCell(`B${cy}`);
        bc.value = { formula: `IF(Schedule!B${sr}="","",Schedule!B${sr})` };
        bc.border = BORDER; bc.alignment = { horizontal: 'left', vertical: 'top' }; bc.font = { bold: true, color: { argb: 'FF1f4e23' } };
        
        // C: Description (override or schedule link)
        const descOver = cementDescOverrides[i];
        if (descOver !== undefined && descOver !== '') {
          cem.getCell(`C${cy}`).value = descOver;
        } else {
          cem.getCell(`C${cy}`).value = { formula: `IF(Schedule!C${sr}="","",Schedule!C${sr})` };
        }
        cem.getCell(`C${cy}`).alignment = { wrapText: true, vertical: 'top' };
        cem.getRow(cy).height = descHeight(descOver || rows[i].description, 46);

        // D: Qty (override or Abstract link)
        const dc = cem.getCell(`D${cy}`);
        const qtyOver = cementQtyOverrides[i];
        if (qtyOver !== undefined && qtyOver !== '') {
          dc.value = num(qtyOver);
        } else {
          dc.value = { formula: `IF(Abstract!C${aq}="","",Abstract!C${aq})` };
        }
        dc.numFmt = QTY; dc.alignment = { horizontal: 'right', vertical: 'top' };

        // E: Unit (linked to Schedule)
        cem.getCell(`E${cy}`).value = { formula: `IF(Schedule!E${sr}="","",Schedule!E${sr})` };
        cem.getCell(`E${cy}`).alignment = { horizontal: 'center', vertical: 'top' };
        // F: Coefficient (editable, highlighted)
        const fc = cem.getCell(`F${cy}`);
        fc.value = num(cementMap[i]);
        fc.numFmt = '0.000'; fc.fill = YELLOW; fc.alignment = { horizontal: 'right', vertical: 'top' };
        // G: Cement in Quintals = D × F
        const gc = cem.getCell(`G${cy}`);
        gc.value = { formula: `IF(D${cy}="","",ROUND(D${cy}*F${cy},2))` };
        gc.numFmt = QTY; gc.alignment = { horizontal: 'right', vertical: 'top' };
        // borders for all 7 columns
        for (let c = 1; c <= 7; c++) cem.getCell(cy, c).border = BORDER;
        cy++;
      }
      for (const mr of cementFetchExtraRows) {
        // A: S.No — these rows were added by hand and have no schedule item behind
        // them, so they have no schedule serial number. Print a dash rather than a
        // counter: any digit here would read as a BOQ number and send the AE/JE
        // looking for a schedule item that doesn't exist.
        const ac = cem.getCell(`A${cy}`); ac.value = '—'; ac.border = BORDER; ac.alignment = { horizontal: 'center', vertical: 'top' };
        // B: DSR Ref
        const bc = cem.getCell(`B${cy}`); bc.value = mr.ref || ''; bc.border = BORDER; bc.alignment = { horizontal: 'left', vertical: 'top' }; bc.font = { bold: true, color: { argb: 'FF1f4e23' } };
        // C: Description
        cem.getCell(`C${cy}`).value = mr.description || '';
        cem.getCell(`C${cy}`).alignment = { wrapText: true, vertical: 'top' };
        cem.getRow(cy).height = descHeight(mr.description, 46);
        // D: Qty
        const dc = cem.getCell(`D${cy}`); dc.value = num(mr.qty); dc.numFmt = QTY; dc.alignment = { horizontal: 'right', vertical: 'top' };
        // E: Unit
        cem.getCell(`E${cy}`).value = mr.unit || '';
        cem.getCell(`E${cy}`).alignment = { horizontal: 'center', vertical: 'top' };
        // F: Coefficient
        const fc = cem.getCell(`F${cy}`); fc.value = num(mr.coeff); fc.numFmt = '0.000'; fc.fill = YELLOW; fc.alignment = { horizontal: 'right', vertical: 'top' };
        // G: Cement (Qtl)
        const gc = cem.getCell(`G${cy}`); gc.value = { formula: `IF(D${cy}="","",ROUND(D${cy}*F${cy},2))` }; gc.numFmt = QTY; gc.alignment = { horizontal: 'right', vertical: 'top' };

        for (let c = 1; c <= 7; c++) cem.getCell(cy, c).border = BORDER;
        cy++;
      }
    }

    const cemEnd = cy - 1;

    const cemSum = (row, text, formula, numFmt = QTY) => {
      cem.mergeCells(`B${row}:F${row}`);
      cem.getCell(`A${row}`).border = BORDER;
      const lc = cem.getCell(`B${row}`);
      lc.value = text; lc.font = { bold: true }; lc.alignment = { horizontal: 'right' }; lc.border = BORDER;
      const g = cem.getCell(`G${row}`);
      g.value = { formula }; g.numFmt = numFmt; g.font = { bold: true };
      g.alignment = { horizontal: 'right' }; g.border = BORDER;
    };

    // Total Cement in Quintals
    const totRow = cy;
    cemSum(totRow, 'Total Cement (Quintals)', `ROUND(SUM(G${cemStart}:G${cemEnd}),2)`);

    // Total Bags
    const bagRow = cy + 1;
    cem.mergeCells(`B${bagRow}:F${bagRow}`);
    cem.getCell(`A${bagRow}`).border = BORDER;
    const bagLabel = cem.getCell(`B${bagRow}`);
    bagLabel.value = 'Cement in Bags of 50 kg'; bagLabel.font = { bold: true };
    bagLabel.alignment = { horizontal: 'right' }; bagLabel.border = BORDER;
    const bagVal = cem.getCell(`G${bagRow}`);
    bagVal.value = { formula: `ROUND(G${totRow}*2,0)` };
    bagVal.numFmt = '#,##,##0'; bagVal.font = { bold: true, size: 12 };
    bagVal.alignment = { horizontal: 'right' }; bagVal.border = BORDER;
    bagVal.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F3E8' } };

    // Metric Tonne row
    const mtRow = cy + 2;
    cem.mergeCells(`B${mtRow}:F${mtRow}`);
    cem.getCell(`A${mtRow}`).border = BORDER;
    const mtLabel = cem.getCell(`B${mtRow}`);
    mtLabel.value = 'Cement in Metric Tonnes (1 MT = 10 Qtl)';
    mtLabel.font = { italic: true, size: 10 }; mtLabel.alignment = { horizontal: 'right' }; mtLabel.border = BORDER;
    const mtVal = cem.getCell(`G${mtRow}`);
    mtVal.value = { formula: `ROUND(G${totRow}/10,2)` };
    mtVal.numFmt = '0.00'; mtVal.font = { italic: true, size: 10 };
    mtVal.alignment = { horizontal: 'right' }; mtVal.border = BORDER;
  }

  return wb;
}

export { buildBillWorkbook };
