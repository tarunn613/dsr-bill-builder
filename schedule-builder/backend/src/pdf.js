// Build a print-ready Schedule of Work PDF using pdfkit (built-in Helvetica, no
// external font files). Renders a wrapping, page-breaking table + totals.
import PDFDocument from 'pdfkit';

const money = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const COLS = [
  { key: 'sno', label: 'S.No', w: 28, align: 'center' },
  { key: 'ref', label: 'DSR Ref', w: 52, align: 'center' },
  { key: 'description', label: 'Description of Item', w: 290, align: 'left' },
  { key: 'qty', label: 'Qty', w: 44, align: 'right', fmt: qtyFmt },
  { key: 'unit', label: 'Unit', w: 40, align: 'center' },
  { key: 'rate', label: 'Rate', w: 58, align: 'right', fmt: money },
  { key: 'rateWords', label: 'Rate (in words)', w: 150, align: 'left' },
  { key: 'amount', label: 'Amount', w: 70, align: 'right', fmt: money },
];
const TABLE_W = COLS.reduce((s, c) => s + c.w, 0);
const PAD = 3;
const FS = 8;

function buildSchedulePdf(computed, header = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;

    // ---- header block --------------------------------------------------------
    const centered = (text, size, bold) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size)
        .text(text, left, doc.y, { width: right - left, align: 'center' });
    };
    centered(header.organization || 'DELHI URBAN SHELTER IMPROVEMENT BOARD, GNCTD', 12, true);
    if (header.office) centered(header.office, 10, false);
    if (header.division) centered(header.division, 10, false);
    doc.moveDown(0.3);
    if (header.subHead) { doc.font('Helvetica').fontSize(9).text('Sub Head: ' + header.subHead, left, doc.y, { width: right - left, align: 'center' }); }
    if (header.nameOfWork) { doc.font('Helvetica').fontSize(9).text('Name of Work: ' + header.nameOfWork, left, doc.y, { width: right - left, align: 'center' }); }
    doc.moveDown(0.4);
    centered('Schedule of Work', 13, true);
    doc.moveDown(0.5);

    // ---- table helpers -------------------------------------------------------
    const drawHeaderRow = () => {
      const y0 = doc.y;
      doc.font('Helvetica-Bold').fontSize(FS);
      let h = 0;
      for (const c of COLS) h = Math.max(h, doc.heightOfString(c.label, { width: c.w - 2 * PAD }));
      h += 2 * PAD;
      let x = left;
      doc.save().rect(left, y0, TABLE_W, h).fill('#1F4E23').restore();
      doc.fillColor('#FFFFFF');
      for (const c of COLS) {
        doc.text(c.label, x + PAD, y0 + PAD, { width: c.w - 2 * PAD, align: c.align });
        x += c.w;
      }
      doc.fillColor('#000000');
      // vertical grid
      x = left;
      doc.lineWidth(0.4).strokeColor('#BFBFBF');
      for (const c of COLS) { doc.moveTo(x, y0).lineTo(x, y0 + h).stroke(); x += c.w; }
      doc.moveTo(x, y0).lineTo(x, y0 + h).stroke();
      doc.moveTo(left, y0 + h).lineTo(left + TABLE_W, y0 + h).stroke();
      doc.y = y0 + h;
    };

    const drawCells = (cells, { bold = false, fill = null } = {}) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FS);
      // measure
      let h = 0;
      for (const c of COLS) {
        const raw = cells[c.key];
        const txt = raw === null || raw === undefined ? '' : (c.fmt && raw !== '' ? c.fmt(raw) : String(raw));
        h = Math.max(h, doc.heightOfString(txt || ' ', { width: c.w - 2 * PAD }));
      }
      h += 2 * PAD;
      if (doc.y + h > bottom()) { doc.addPage(); drawHeaderRow(); }
      const y0 = doc.y;
      if (fill) { doc.save().rect(left, y0, TABLE_W, h).fill(fill).restore(); }
      let x = left;
      doc.fillColor('#000000');
      for (const c of COLS) {
        const raw = cells[c.key];
        const txt = raw === null || raw === undefined ? '' : (c.fmt && raw !== '' ? c.fmt(raw) : String(raw));
        doc.text(txt, x + PAD, y0 + PAD, { width: c.w - 2 * PAD, align: c.align });
        x += c.w;
      }
      // grid
      x = left;
      doc.lineWidth(0.4).strokeColor('#BFBFBF');
      for (const c of COLS) { doc.moveTo(x, y0).lineTo(x, y0 + h).stroke(); x += c.w; }
      doc.moveTo(x, y0).lineTo(x, y0 + h).stroke();
      doc.moveTo(left, y0 + h).lineTo(left + TABLE_W, y0 + h).stroke();
      doc.y = y0 + h;
    };

    // a summary line: right-aligned label across description cols, amount at end
    const summaryLine = (label, amount, note, bold = true) => {
      drawCells({
        sno: '', ref: '', description: label, qty: '', unit: '', rate: note || '',
        rateWords: '', amount,
      }, { bold, fill: '#EFEFEF' });
    };

    drawHeaderRow();
    for (const r of computed.dsrRows) drawCells(r.deviates ? { ...r, sno: r.sno + ' *' } : r);

    if (computed.dsrRows.length) {
      summaryLine('Total', computed.dsrSubtotal, '');
      summaryLine(`Multiplying factor @ ${computed.factor}`, computed.afterFactor, '', false);
      summaryLine(`Add @ ${computed.costIndexPct}% Cost Index on DSR 2023`, computed.costIndexAmount, '', false);
      summaryLine('Corrected DSR Total', computed.c1, 'C1');
    }
    for (const r of computed.marketRows) drawCells(r);
    summaryLine('Total', computed.grandTotal, 'C1');
    summaryLine('Say', computed.say, 'C2');

    doc.moveDown(0.5);
    doc.font('Helvetica-Oblique').fontSize(9)
      .text(computed.grandTotalWords, left, doc.y, { width: right - left });

    const devs = computed.dsrRows.filter((r) => r.deviates);
    if (devs.length) {
      doc.moveDown(0.5);
      doc.fillColor('#9B1C1C').font('Helvetica-Bold').fontSize(8)
        .text('* Rate overrides (deviating from DSR 2023):', left, doc.y, { width: right - left });
      doc.font('Helvetica').fontSize(8);
      for (const d of devs) {
        doc.text(`Item ${d.sno} (${d.ref}): used Rs ${money(d.rate)}  —  DSR book rate Rs ${money(d.bookRate)}`, left, doc.y, { width: right - left });
      }
      doc.fillColor('#000000');
    }

    doc.end();
  });
}

export { buildSchedulePdf };
