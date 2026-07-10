// Convert an uploaded .xlsx (Schedule / RE / Abstract / Cement, or any sheet)
// into clean, print-ready B&W A4 PDFs — one PDF per worksheet, bundled as a zip.
//
// Design goals (from the user):
//   • all-black-and-white tables (no fills/colors carried over from the workbook)
//   • fits an A4 page when printed, with NO column ever cut off
//   • preserves structure: merged header block, column headers, alignment, formats
//
// Cell values: uses cached formula results when the file has them (Excel/hand-made
// workbooks) and falls back to the in-process evaluator (formula.js) otherwise —
// so a fresh, never-opened export from this app still renders every number.
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import AdmZip from 'adm-zip';
import { createEvaluator } from './formula.js';

// ---- number formatting (Indian grouping, matches the workbook numFmts) ------
function indianGroup(intStr) {
  if (intStr.length <= 3) return intStr;
  const last3 = intStr.slice(-3);
  let rest = intStr.slice(0, -3);
  const parts = [];
  while (rest.length > 2) { parts.unshift(rest.slice(-2)); rest = rest.slice(0, -2); }
  if (rest) parts.unshift(rest);
  return parts.join(',') + ',' + last3;
}
function formatNumber(v, numFmt) {
  if (typeof v !== 'number' || !isFinite(v)) return String(v ?? '');
  const fmt = String(numFmt || '');
  const dm = fmt.match(/0\.(0+)/);
  let decimals = dm ? dm[1].length : (Number.isInteger(v) ? 0 : 2);
  const grouped = fmt.includes(',') || !numFmt; // group by default for plain numbers
  const neg = v < 0;
  const fixed = Math.abs(v).toFixed(decimals);
  let [ip, dp] = fixed.split('.');
  if (grouped) ip = indianGroup(ip);
  return (neg ? '-' : '') + ip + (dp ? '.' + dp : '');
}

// ---- cell text extraction ---------------------------------------------------
function plainText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value.richText) return value.richText.map((t) => t.text).join('');
    if (value.text !== undefined) return value.text;
    if (value.result !== undefined && typeof value.result !== 'object') return value.result;
    if (value.formula !== undefined) return ''; // formula handled by evaluator elsewhere
    return '';
  }
  return value;
}

// A1 helpers
function colToNum(col) { let c = 0; for (const ch of col) c = c * 26 + (ch.charCodeAt(0) - 64); return c; }
function parseA1(a) { const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(a); return { c: colToNum(m[1].toUpperCase()), r: parseInt(m[2], 10) }; }
function excelWidthToPt(w) { const width = (w == null ? 8.43 : w); const px = Math.round(width * 7) + 5; return px * 0.75; }

// ---- build a render model per sheet ----------------------------------------
async function loadModel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  // raw accessor across ALL sheets for the evaluator
  const raw = new Map(); // sheetName -> Map(ADDR -> {formula,result} | primitive)
  for (const ws of wb.worksheets) {
    const m = new Map();
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const addr = cell.address.replace(/\$/g, '').toUpperCase();
        const v = cell.value;
        if (v && typeof v === 'object' && (v.formula !== undefined || v.sharedFormula !== undefined)) {
          m.set(addr, { formula: cell.formula, result: v.result });
        } else if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
          m.set(addr, v);
        } else if (v && typeof v === 'object' && v.richText) {
          m.set(addr, v.richText.map((t) => t.text).join(''));
        }
      });
    });
    raw.set(ws.name, m);
  }
  const getRaw = (sheet, addr) => { const m = raw.get(sheet); return m ? m.get(addr.toUpperCase()) : undefined; };
  const firstSheet = wb.worksheets[0] ? wb.worksheets[0].name : 'Sheet1';
  const evaluate = createEvaluator(getRaw, firstSheet);

  const sheets = [];
  for (const ws of wb.worksheets) {
    const nCols = Math.max(ws.actualColumnCount, ws.columnCount, 1);
    const nRows = Math.max(ws.actualRowCount, ws.rowCount, 1);

    // natural column widths (pt)
    const colWpt = [];
    for (let c = 1; c <= nCols; c++) colWpt[c - 1] = excelWidthToPt(ws.getColumn(c).width);

    // merges -> rectangles
    const merges = (ws.model.merges || []).map((rng) => {
      const [a, b] = rng.split(':');
      const pa = parseA1(a), pb = parseA1(b);
      return { r1: Math.min(pa.r, pb.r), r2: Math.max(pa.r, pb.r), c1: Math.min(pa.c, pb.c), c2: Math.max(pa.c, pb.c) };
    });
    const coverKey = (r, c) => r + ':' + c;
    const covered = new Set();
    const spanOf = new Map(); // "r:c" -> {rs, cs}
    for (const mg of merges) {
      spanOf.set(coverKey(mg.r1, mg.c1), { rs: mg.r2 - mg.r1 + 1, cs: mg.c2 - mg.c1 + 1 });
      for (let r = mg.r1; r <= mg.r2; r++) for (let c = mg.c1; c <= mg.c2; c++) if (!(r === mg.r1 && c === mg.c1)) covered.add(coverKey(r, c));
    }

    // column-header rows (shaded + repeated on page breaks) = rows containing "DESCRIPTION";
    // block-start rows (each begins its own A4 page, e.g. RE) = rows containing "Date of Measurement"
    const headerRows = new Set();
    const blockStarts = [];
    for (let r = 1; r <= nRows; r++) {
      for (let c = 1; c <= nCols; c++) {
        const t = plainText(ws.getCell(r, c).value);
        if (typeof t === 'string') {
          if (/description/i.test(t)) headerRows.add(r);
          if (/date of measurement/i.test(t)) { blockStarts.push(r); break; }
        }
      }
    }
    const firstHeaderRow = headerRows.size ? Math.min(...headerRows) : -1;

    // build grid of resolved cells
    const grid = [];
    for (let r = 1; r <= nRows; r++) {
      const rowCells = [];
      for (let c = 1; c <= nCols; c++) {
        if (covered.has(coverKey(r, c))) { rowCells.push(null); continue; }
        const cell = ws.getCell(r, c);
        const v = cell.value;
        const isFormula = v && typeof v === 'object' && (v.formula !== undefined || v.sharedFormula !== undefined);
        let display;
        if (isFormula) {
          const resolved = evaluate(ws.name, cell.address.replace(/\$/g, ''));
          display = typeof resolved === 'number' ? formatNumber(resolved, cell.numFmt) : String(resolved ?? '');
        } else {
          const pv = plainText(v);
          display = typeof pv === 'number' ? formatNumber(pv, cell.numFmt) : String(pv ?? '');
        }
        const span = spanOf.get(coverKey(r, c)) || { rs: 1, cs: 1 };
        const al = cell.alignment || {};
        const numeric = typeof (isFormula ? evaluate(ws.name, cell.address.replace(/\$/g, '')) : plainText(v)) === 'number';
        // honor the workbook's own borders so the PDF matches Excel (signature/spacer
        // rows stay borderless, the table body keeps its grid)
        const bd = cell.border || {};
        const border = {
          top: !!(bd.top && bd.top.style), left: !!(bd.left && bd.left.style),
          bottom: !!(bd.bottom && bd.bottom.style), right: !!(bd.right && bd.right.style),
        };
        rowCells.push({
          text: display,
          bold: !!(cell.font && cell.font.bold),
          align: al.horizontal || (numeric ? 'right' : 'left'),
          wrap: al.wrapText !== false,
          rs: span.rs, cs: span.cs, border,
        });
      }
      grid.push(rowCells);
    }

    sheets.push({ name: ws.name, nCols, nRows, colWpt, grid, headerRows, firstHeaderRow, blockStarts });
  }
  return sheets;
}

// ---- render one sheet to a portrait A4 PDF ---------------------------------
function renderSheetToPdf(sheet) {
  return new Promise((resolve, reject) => {
    const MARGIN = 34;
    const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: MARGIN });
    const chunks = [];
    doc.on('data', (d) => chunks.push(d));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width, pageH = doc.page.height;
    const left = MARGIN, right = pageW - MARGIN, top = MARGIN, bottom = pageH - MARGIN;
    const usableW = right - left;

    // scale columns uniformly so the whole table fits the page width (never cut a column)
    const natW = sheet.colWpt.reduce((s, w) => s + w, 0) || usableW;
    const scale = Math.min(1, usableW / natW);
    const colW = sheet.colWpt.map((w) => w * scale);
    const colX = [left];
    for (let i = 0; i < colW.length; i++) colX[i + 1] = colX[i] + colW[i];
    const tableW = colX[colW.length] - left;

    // font size: shrink a touch for very dense sheets, keep legible
    const FS = scale >= 0.8 ? 8 : scale >= 0.62 ? 7.2 : 6.6;
    const PAD = 2.5;
    const MINROW = FS + 2 * PAD;
    const GREY = '#E9E9E9';

    const spanW = (c, cs) => { let w = 0; for (let k = 0; k < cs; k++) w += colW[c + k] || 0; return w; };

    // measure one row's height given its resolved cells
    const rowHeight = (cells) => {
      let h = MINROW;
      for (let c = 0; c < cells.length; c++) {
        const cell = cells[c];
        if (!cell || !cell.text) continue;
        doc.font(cell.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FS);
        const w = spanW(c, cell.cs) - 2 * PAD;
        const hh = doc.heightOfString(String(cell.text), { width: Math.max(4, w) }) + 2 * PAD;
        if (hh > h) h = hh;
      }
      return Math.min(h, 300);
    };

    const drawRow = (cells, y, { shade = false } = {}) => {
      const h = rowHeight(cells);
      if (shade) { doc.save().rect(left, y, tableW, h).fill(GREY).restore(); }
      for (let c = 0; c < cells.length; c++) {
        const cell = cells[c];
        if (!cell) continue; // covered by a merge
        const x = colX[c], w = spanW(c, cell.cs);
        const bd = cell.border;
        if (bd && (bd.top || bd.left || bd.bottom || bd.right)) {
          doc.lineWidth(0.5).strokeColor('#333333');
          if (bd.top) doc.moveTo(x, y).lineTo(x + w, y).stroke();
          if (bd.bottom) doc.moveTo(x, y + h).lineTo(x + w, y + h).stroke();
          if (bd.left) doc.moveTo(x, y).lineTo(x, y + h).stroke();
          if (bd.right) doc.moveTo(x + w, y).lineTo(x + w, y + h).stroke();
        }
        if (cell.text !== '' && cell.text != null) {
          doc.font(cell.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FS).fillColor('#000000');
          doc.text(String(cell.text), x + PAD, y + PAD, { width: Math.max(4, w - 2 * PAD), align: cell.align, lineGap: 0 });
        }
      }
      return h;
    };

    // RE-style sheets paginate one measurement block per A4 page; other sheets
    // flow and repeat their single column header on each page break.
    const blockSet = new Set(sheet.blockStarts || []);
    const blockPaginated = blockSet.size > 0;
    let repeatHeader = (!blockPaginated && sheet.firstHeaderRow > 0) ? sheet.grid[sheet.firstHeaderRow - 1] : null;

    let y = top, seenBlock = false;
    for (let r = 1; r <= sheet.nRows; r++) {
      const cells = sheet.grid[r - 1] || [];
      const h = rowHeight(cells);
      if (blockSet.has(r)) {
        if (seenBlock) { doc.addPage(); y = top; } // each record entry on its own page
        seenBlock = true;
      } else if (y + h > bottom) {
        doc.addPage();
        y = top;
        if (repeatHeader && r > sheet.firstHeaderRow) y += drawRow(repeatHeader, y, { shade: true });
      }
      if (sheet.headerRows.has(r)) repeatHeader = cells; // this block's own column header
      y += drawRow(cells, y, { shade: sheet.headerRows.has(r) });
    }

    doc.end();
  });
}

// ---- public: workbook -> zip of per-sheet PDFs -----------------------------
async function renderWorkbookToZip(buffer, opts = {}) {
  const sheets = await loadModel(buffer);
  const wanted = opts.sheets && opts.sheets.length ? new Set(opts.sheets) : null;
  const zip = new AdmZip();
  const rendered = [];
  for (const sheet of sheets) {
    if (wanted && !wanted.has(sheet.name)) continue;
    // skip truly empty sheets
    const hasContent = sheet.grid.some((row) => row.some((c) => c && String(c.text || '').trim() !== ''));
    if (!hasContent) continue;
    const pdf = await renderSheetToPdf(sheet);
    const safe = sheet.name.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'sheet';
    zip.addFile(`${safe}.pdf`, pdf);
    rendered.push(sheet.name);
  }
  return { zipBuffer: zip.toBuffer(), sheets: rendered };
}

// list the sheet names in an uploaded workbook (for the UI checklist)
async function listSheetNames(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.worksheets.map((ws) => ws.name);
}

export { renderWorkbookToZip, renderSheetToPdf, loadModel, listSheetNames };
