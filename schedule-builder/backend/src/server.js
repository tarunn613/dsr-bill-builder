import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { load, search, lookup, meta } from './data.js';
import { computeSchedule } from './core.js';
import { buildScheduleWorkbook } from './excel.js';
import { buildSchedulePdf } from './pdf.js';
import { computeBill } from './bill-core.js';
import { buildBillWorkbook } from './bill-excel.js';
import { parseScheduleBuffer } from './bill-parse.js';
import { renderWorkbookToZip, listSheetNames } from './xlsx-pdf.js';
import { coeffsFor, searchByDesc, searchByCode, searchCombined } from './cement.js';
import { parseDocument, matchCode, visionExtract, visionConfigured } from './ocr.js';
import { recognizePage, engineStatus } from './ocr-engines.js';
import { parseJsonImport, matchJsonRow } from './json-import.js';
import {
  listSessions, createSession, getSession, updateSession, deleteSession,
  archiveExport, getExportFile, recordImport, packageSession, importSessionPackage,
  sessionsBaseDir,
} from './sessions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5175;

const info = load();
console.log(`Loaded DSR snapshot: ${info.count} items (${info.carriage_count} carriage).`);

const app = express();
app.use(cors());
app.use(express.json({ limit: '30mb' })); // session packages travel as base64 in the body

// ---- API -------------------------------------------------------------------
app.get('/api/meta', (req, res) => res.json(meta()));

app.get('/api/dsr/search', (req, res) => {
  const q = req.query.q || '';
  const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
  res.json({ query: q, results: search(q, limit) });
});

app.get('/api/dsr/:code', (req, res) => {
  const rows = lookup(req.params.code);
  if (!rows.length) return res.status(404).json({ error: 'code not found', code: req.params.code });
  res.json({ code: req.params.code, matches: rows });
});

// ---- OCR import: scanned Schedule of Work -> matched DSR rows --------------
// The frontend rasterises the scanned PDF and posts page images here one at a
// time (so it can show real progress); we OCR each with the chosen on-device
// engine, then reconstruct the table and match every code against the DSR DB.
app.get('/api/ocr/engines', async (req, res) => {
  try { res.json(await engineStatus()); }
  catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// OCR a single page image → token boxes for the parser.
app.post('/api/ocr/recognize', async (req, res) => {
  try {
    const { engine = 'paddle', page } = req.body || {};
    if (!page || !page.dataUrl) return res.status(400).json({ error: 'no page image' });
    const buffer = Buffer.from(String(page.dataUrl).replace(/^data:.*;base64,/, ''), 'base64');
    const tokens = await recognizePage(engine, buffer);
    res.json({ index: page.index, width: page.width, height: page.height, ...tokens });
  } catch (e) {
    console.error('ocr recognize:', e.message);
    const code = e && e.code === 'PADDLE_UNAVAILABLE' ? 501 : 500;
    res.status(code).json({ error: String(e.message || e), code: e && e.code });
  }
});

// Reconstruct the table from all pages' tokens and match against the DSR DB.
app.post('/api/ocr/parse', (req, res) => {
  try {
    const pages = (req.body && req.body.pages) || [];
    if (!Array.isArray(pages) || !pages.length) return res.status(400).json({ error: 'no pages' });
    res.json(parseDocument(pages));
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: 'could not parse OCR output: ' + String(e.message || e) });
  }
});

// Re-match a single (edited) code against the DSR DB — used when the user fixes
// a code in the review table and we want the canonical description/unit/rate.
app.post('/api/ocr/match', (req, res) => {
  try {
    const { code = '', description = '' } = req.body || {};
    res.json(matchCode(String(code), String(description)));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// Vision-model OCR seam (local VLM server / handwriting). Not active until a
// local endpoint is configured — see ocr.js. Kept here so the engine selector
// can offer it and fail with a clear, actionable message.
app.get('/api/ocr/vision/status', (req, res) => res.json({ configured: visionConfigured() }));
app.post('/api/ocr/vision', async (req, res) => {
  try {
    const out = await visionExtract((req.body && req.body.pages) || [], req.body || {});
    res.json(out);
  } catch (e) {
    const code = e && e.code === 'VISION_NOT_CONFIGURED' ? 501 : 500;
    res.status(code).json({ error: String(e.message || e), code: e && e.code });
  }
});

// ---- JSON import: paste vision-model JSON -> matched DSR rows -------------
// Companion to the OCR import above, for a "Schedule of Work" already read
// by a vision AI model (Claude / GPT-4V / Gemini) into the app's fixed JSON
// shape (see json-import.js). No file upload, no OCR — just DB matching.
app.post('/api/json-import/parse', (req, res) => {
  try {
    res.json(parseJsonImport((req.body && req.body.text) || ''));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// Re-match a single (edited) code against the DSR DB — same use as /api/ocr/match.
app.post('/api/json-import/match', (req, res) => {
  try {
    const { code = '', description = '' } = req.body || {};
    res.json(matchJsonRow(String(code), String(description)));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post('/api/schedule/compute', (req, res) => {
  try {
    res.json(computeSchedule(req.body || {}));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

function safeName(header = {}) {
  const base = (header.nameOfWork || header.workName || header.subHead || 'schedule').toString();
  return base.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'schedule';
}

app.post('/api/schedule/xlsx', async (req, res) => {
  try {
    const payload = req.body || {};
    const computed = computeSchedule(payload);
    const wb = buildScheduleWorkbook(computed, payload.header || {});
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const filename = `${safeName(payload.header)}_schedule.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.post('/api/schedule/pdf', async (req, res) => {
  try {
    const payload = req.body || {};
    const computed = computeSchedule(payload);
    const buf = await buildSchedulePdf(computed, payload.header || {});
    const filename = `${safeName(payload.header)}_schedule.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ---- Phase 3: Schedule -> RA Bill ------------------------------------------
app.post('/api/bill/compute', (req, res) => {
  try {
    res.json(computeBill(req.body || {}));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.post('/api/bill/xlsx', async (req, res) => {
  try {
    const payload = req.body || {};
    const wb = buildBillWorkbook(payload);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const filename = `${safeName(payload.meta || {})}_ra_bill.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// parse an uploaded schedule workbook (base64) -> normalized rows + meta
app.post('/api/bill/parse', async (req, res) => {
  try {
    const b64 = (req.body && req.body.fileBase64) || '';
    if (!b64) return res.status(400).json({ error: 'no file' });
    const buffer = Buffer.from(b64.replace(/^data:.*;base64,/, ''), 'base64');
    const out = await parseScheduleBuffer(buffer);
    // archive the uploaded file into the session, if one is active
    if (req.body.sessionId) {
      try {
        recordImport(req.body.sessionId, {
          filename: req.body.filename || 'schedule.xlsx', buffer, rows: (out.rows || []).length,
        });
      } catch (e) { console.error('recordImport failed:', e.message); }
    }
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: 'could not parse workbook: ' + String(e.message || e) });
  }
});

// cement coefficients for a set of DSR codes (RA Bill cement statement)
app.post('/api/cement/coeffs', (req, res) => {
  try { res.json({ coeffs: coeffsFor((req.body || {}).codes || []) }); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

// description-based fallback search (for codes not in the appendix)
app.post('/api/cement/search', (req, res) => {
  try {
    const { desc = '', limit = 5 } = req.body || {};
    res.json({ results: searchByDesc(String(desc), Math.min(Number(limit) || 5, 20)) });
  }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

// code-based search (search cement DB by DSR ref number)
app.post('/api/cement/search-code', (req, res) => {
  try {
    const { code = '', limit = 10 } = req.body || {};
    res.json({ results: searchByCode(String(code), Math.min(Number(limit) || 10, 20)) });
  }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

// combined search (searches both by code and description simultaneously)
app.post('/api/cement/search-combined', (req, res) => {
  try {
    const { query = '', limit = 10 } = req.body || {};
    res.json({ results: searchCombined(String(query), Math.min(Number(limit) || 10, 20)) });
  }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

// ---- Excel -> B&W A4 PDF (one PDF per sheet, zipped) -----------------------
// Decode a base64 (optionally data-URI) xlsx from the request body.
function xlsxFromBody(req) {
  const b64 = (req.body && req.body.fileBase64) || '';
  if (!b64) return null;
  return Buffer.from(b64.replace(/^data:.*;base64,/, ''), 'base64');
}

// list the worksheet names in an uploaded workbook (for the convert UI checklist)
app.post('/api/topdf/list', async (req, res) => {
  try {
    const buffer = xlsxFromBody(req);
    if (!buffer) return res.status(400).json({ error: 'no file' });
    res.json({ sheets: await listSheetNames(buffer) });
  } catch (e) {
    res.status(400).json({ error: 'could not read workbook: ' + String(e.message || e) });
  }
});

// convert selected sheets to B&W A4 PDFs, returned as a zip
app.post('/api/topdf', async (req, res) => {
  try {
    const buffer = xlsxFromBody(req);
    if (!buffer) return res.status(400).json({ error: 'no file' });
    const sheets = Array.isArray(req.body.sheets) ? req.body.sheets : null;
    const { zipBuffer, sheets: rendered } = await renderWorkbookToZip(buffer, { sheets });
    if (!rendered.length) return res.status(400).json({ error: 'no non-empty sheets to convert' });
    const base = String(req.body.filename || 'workbook').replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'workbook';
    const filename = `${base}_pdf.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(zipBuffer);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: 'could not convert workbook: ' + String(e.message || e) });
  }
});

// ---- Phase 4: sessions (named tender projects; no work lost) ---------------
app.get('/api/sessions', (req, res) => {
  try { res.json({ sessions: listSessions(), dir: sessionsBaseDir() }); }
  catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.post('/api/sessions', (req, res) => {
  try { res.status(201).json(createSession((req.body || {}).name)); }
  catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

app.get('/api/sessions/:id', (req, res) => {
  try {
    const s = getSession(req.params.id);
    if (!s) return res.status(404).json({ error: 'session not found' });
    res.json(s);
  } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

app.put('/api/sessions/:id', (req, res) => {
  try {
    const s = updateSession(req.params.id, req.body || {});
    if (!s) return res.status(404).json({ error: 'session not found' });
    res.json(s);
  } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

app.delete('/api/sessions/:id', (req, res) => {
  try {
    const ok = deleteSession(req.params.id);
    if (!ok) return res.status(404).json({ error: 'session not found' });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

// Archive an already-generated export under the session, once the user has
// confirmed its filename in the Save-as dialog (kept as a separate step from
// generating the file — see downloadSchedule/downloadBill/convertXlsxToPdf in
// api.js — so the archived copy's name matches what was actually saved, not
// whatever default the backend originally suggested).
app.post('/api/sessions/:id/exports', (req, res) => {
  try {
    const { page, kind, filename, fileBase64 } = req.body || {};
    if (!filename || !fileBase64) return res.status(400).json({ error: 'filename and fileBase64 are required' });
    const buffer = Buffer.from(String(fileBase64).replace(/^data:.*;base64,/, ''), 'base64');
    const rec = archiveExport(req.params.id, { page, kind, filename, buffer });
    if (!rec) return res.status(404).json({ error: 'session not found' });
    res.status(201).json(rec);
  } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

// re-download a previously archived export
app.get('/api/sessions/:id/exports/:exportId', (req, res) => {
  try {
    const f = getExportFile(req.params.id, req.params.exportId);
    if (!f) return res.status(404).json({ error: 'export not found' });
    const type = f.kind === 'pdf'
      ? 'application/pdf'
      : f.kind === 'zip'
        ? 'application/zip'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`);
    res.sendFile(f.path);
  } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

// export a whole session as one portable .dbill file
app.get('/api/sessions/:id/package', (req, res) => {
  try {
    const pkg = packageSession(req.params.id);
    if (!pkg) return res.status(404).json({ error: 'session not found' });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${pkg.filename}"`);
    res.send(pkg.buffer);
  } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

// import a .dbill package (base64) as a brand-new session
app.post('/api/sessions/import', (req, res) => {
  try {
    const b64 = (req.body && req.body.fileBase64) || '';
    if (!b64) return res.status(400).json({ error: 'no file' });
    const buffer = Buffer.from(b64.replace(/^data:.*;base64,/, ''), 'base64');
    res.status(201).json(importSessionPackage(buffer));
  } catch (e) { res.status(400).json({ error: 'could not import session: ' + String(e.message || e) }); }
});

// ---- serve built frontend (production) -------------------------------------
const dist = join(__dirname, '..', '..', 'frontend', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(join(dist, 'index.html')));
}

app.listen(PORT, '127.0.0.1', () => console.log(`Schedule Builder API on http://127.0.0.1:${PORT}`));
