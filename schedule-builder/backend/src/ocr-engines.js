// OCR recognition engines (run in the local Node backend, on-device, offline).
//
//   • tesseract — Tesseract.js WASM. Light, universal, bundled language data.
//   • paddle    — PaddleOCR PP-OCRv4 (open weights) via onnxruntime-node.
//                 Detection-based → far more robust on skewed / noisy scans.
//
// Both are lazy-loaded and kept warm across requests, and both return the same
// token shape ({ words } or { regions }) consumed by the table parser in ocr.js.
// A vision/VLM provider (handwriting) plugs in behind the same contract later.
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFile, unlink } from 'fs/promises';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESSDATA = join(__dirname, '..', 'ocr-assets', 'tessdata'); // eng.traineddata.gz

// ---- Tesseract.js (WASM) ---------------------------------------------------
let tessWorker = null;
async function getTesseract() {
  if (!tessWorker) {
    const { createWorker } = await import('tesseract.js');
    tessWorker = await createWorker('eng', 1, {
      langPath: TESSDATA, cachePath: TESSDATA, gzip: true,
    });
    await tessWorker.setParameters({ tessedit_pageseg_mode: '6' }); // uniform block
  }
  return tessWorker;
}

async function tesseractRecognize(buffer) {
  const worker = await getTesseract();
  const { data } = await worker.recognize(buffer, {}, { blocks: true });
  const words = [];
  for (const b of data.blocks || [])
    for (const p of b.paragraphs || [])
      for (const l of p.lines || [])
        for (const w of l.words || []) {
          if (!w.text || !w.text.trim()) continue;
          words.push({
            text: w.text,
            x0: Math.round(w.bbox.x0), y0: Math.round(w.bbox.y0),
            x1: Math.round(w.bbox.x1), y1: Math.round(w.bbox.y1),
            conf: Math.round(w.confidence),
          });
        }
  return { words };
}

// ---- PaddleOCR (PP-OCRv4, onnxruntime-node) --------------------------------
let paddle = null;
let paddleError = null;
async function getPaddle() {
  if (paddleError) throw paddleError;
  if (!paddle) {
    try {
      const { default: Ocr } = await import('@gutenye/ocr-node');
      paddle = await Ocr.create(); // bundled @gutenye/ocr-models (PP-OCRv4)
    } catch (e) {
      paddleError = new Error('High-accuracy engine unavailable on this device (onnxruntime failed to load). Use the Built-in engine. Details: ' + (e.message || e));
      paddleError.code = 'PADDLE_UNAVAILABLE';
      throw paddleError;
    }
  }
  return paddle;
}

async function paddleRecognize(buffer) {
  const ocr = await getPaddle();
  // @gutenye/ocr-node reads an image file path; stage the page to a temp file.
  const tmp = join(tmpdir(), `dsr-ocr-${randomUUID()}.png`);
  await writeFile(tmp, buffer);
  try {
    const lines = await ocr.detect(tmp);
    const regions = [];
    for (const r of lines || []) {
      const box = r.box;
      const text = (r.text || '').trim();
      if (!text || !box || !box.length) continue;
      const xs = box.map((p) => p[0]);
      const ys = box.map((p) => p[1]);
      regions.push({
        text,
        x0: Math.round(Math.min(...xs)), y0: Math.round(Math.min(...ys)),
        x1: Math.round(Math.max(...xs)), y1: Math.round(Math.max(...ys)),
        conf: Math.round((r.mean || 0) * 100),
      });
    }
    return { regions };
  } finally {
    unlink(tmp).catch(() => {});
  }
}

// Recognise one page image buffer with the chosen engine → token boxes.
export async function recognizePage(engine, buffer) {
  if (engine === 'tesseract') return tesseractRecognize(buffer);
  if (engine === 'paddle') return paddleRecognize(buffer);
  throw new Error('unknown OCR engine: ' + engine);
}

// Report which engines can actually run here (the UI greys out the rest).
export async function engineStatus() {
  let paddleOk = true;
  try { await getPaddle(); } catch { paddleOk = false; }
  return { tesseract: true, paddle: paddleOk };
}
