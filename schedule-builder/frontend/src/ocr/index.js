// OCR import orchestrator. The browser rasterises the scanned PDF (pdf.js) and
// streams page images to the local backend, which runs the chosen on-device
// engine and matches every code against the DSR database. Per-page requests let
// us drive a real progress bar. All engines return the same rows to review.
import { renderPdf } from './renderPdf.js';

export const ENGINES = [
  {
    id: 'paddle',
    label: 'High accuracy',
    sub: 'PaddleOCR · open weights',
    desc: 'Neural open-source model (bundled, offline). Best for skewed or noisy scans. Recommended.',
    recommended: true,
  },
  {
    id: 'tesseract',
    label: 'Built-in',
    sub: 'Tesseract · lightest',
    desc: 'Fast and light. Good for clean, straight printed schedules, or low-memory devices.',
  },
  {
    id: 'vision',
    label: 'AI Vision',
    sub: 'local model · handwriting',
    desc: 'For handwritten or very poor scans. Needs a local AI model server configured on this device.',
    setup: true,
  },
];

const toPng = (canvas) => canvas.toDataURL('image/png');
const toJpeg = (canvas) => canvas.toDataURL('image/jpeg', 0.6);

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(data.error || `Request failed (${res.status}).`); err.code = data.code; throw err; }
  return data;
}

// Run the full import. `onProgress({ phase, page, total, ratio, label })` fires
// throughout so the modal can show a live progress bar.
export async function runOcrImport({ file, engine = 'paddle', onProgress }) {
  const report = (phase, page, total, label) =>
    onProgress?.({ phase, page, total, ratio: total ? page / total : 0, label });

  report('render', 0, 1, 'Reading PDF…');
  const pages = await renderPdf(file, {
    onPage: (i, n) => report('render', i, n, `Rendering page ${i} of ${n}…`),
  });
  if (!pages.length) throw new Error('No pages found in this PDF.');
  const total = pages.length;

  if (engine === 'vision') {
    report('recognize', 0, total, 'Sending to local AI vision model…');
    const images = pages.map((p) => ({ index: p.index, width: p.width, height: p.height, dataUrl: toJpeg(p.canvas) }));
    const body = await postJson('/api/ocr/vision', { pages: images });
    return attachThumbs(body, pages);
  }

  const outPages = [];
  if (engine === 'paddle') report('recognize', 0, total, 'Loading recognition model…');
  for (const pg of pages) {
    report('recognize', pg.index, total, `Recognising page ${pg.index + 1} of ${total}…`);
    const tokens = await postJson('/api/ocr/recognize', {
      engine,
      page: { index: pg.index, width: pg.width, height: pg.height, dataUrl: toPng(pg.canvas) },
    });
    outPages.push(tokens);
    report('recognize', pg.index + 1, total, `Recognising page ${pg.index + 1} of ${total}…`);
  }

  report('match', 0, 1, 'Matching against DSR database…');
  const body = await postJson('/api/ocr/parse', { engine, pages: outPages });
  return attachThumbs(body, pages);
}

// Attach small page previews so the review table can show the source scan.
function attachThumbs(body, pages) {
  return { ...body, thumbs: pages.map((p) => ({ index: p.index, dataUrl: toJpeg(p.canvas), width: p.width, height: p.height })) };
}

// Re-match a single code the user edited in the review table.
export async function rematchCode(code, description) {
  try { return await postJson('/api/ocr/match', { code, description }); }
  catch { return null; }
}

// Which engines can actually run on this device (for the selector).
export async function fetchEngineStatus() {
  try { return await (await fetch('/api/ocr/engines')).json(); }
  catch { return { tesseract: true, paddle: false }; }
}

export async function visionConfigured() {
  try { return (await (await fetch('/api/ocr/vision/status')).json()).configured; }
  catch { return false; }
}
