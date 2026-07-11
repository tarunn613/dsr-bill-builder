// Vendor the front-end OCR asset (pdf.js worker) into public/ocr so the app
// rasterises scanned PDFs offline. The OCR *engines* run in the backend:
//   • PaddleOCR models ship inside backend/node_modules/@gutenye/ocr-models
//   • Tesseract language data lives in backend/ocr-assets/tessdata
// so nothing else needs vendoring here. Safe to re-run; skips existing files.
//
//   node scripts/setup-ocr-assets.mjs
import { cpSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const FE = join(here, '..');
const NM = join(FE, 'node_modules');
const OUT = join(FE, 'public', 'ocr');

const copy = (from, to) => {
  if (!existsSync(from)) { console.warn('  ! missing (skipped):', from); return; }
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  console.log('  +', to.replace(FE, '.'));
};

console.log('Vendoring pdf.js worker → public/ocr');
copy(join(NM, 'pdfjs-dist/build/pdf.worker.min.mjs'), join(OUT, 'pdf.worker.min.mjs'));
console.log('Done.');
