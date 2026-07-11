// Rasterise a scanned PDF (File) to page canvases with pdf.js. The scanned
// Schedule of Work has no embedded text, so every page is an image we must OCR.
import * as pdfjs from 'pdfjs-dist';

// Worker is vendored into public/ocr so the app runs offline once packaged.
pdfjs.GlobalWorkerOptions.workerSrc = '/ocr/pdf.worker.min.mjs';

// Target a consistent OUTPUT pixel width regardless of the source page's point
// size. A flat scale multiplier (the old approach) assumes every page is
// ~595pt A4; scanned-PDF pages vary wildly — a phone-camera scan can declare a
// page 1800-2100pt wide (vs. A4's 595pt), and a flat 2.75x would render it at
// ~5000-6000px, ~13x the pixel area, which is needlessly slow/heavy for both
// OCR engines without improving accuracy. targetWidth=1800 matches the ~220
// DPI that worked well on a real A4 scan; minScale/maxScale keep any single
// page from rendering absurdly small or large regardless of its declared size.
export async function renderPdf(file, { targetWidth = 1800, minScale = 0.3, maxScale = 4, onPage } = {}) {
  const data = await file.arrayBuffer();
  // destroy() lives on the loading task, not the resolved PDFDocumentProxy —
  // keep the task itself so cleanup actually works (a prior version called
  // `pdf.destroy()` on the proxy, which has no such method, and threw).
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;
  const pages = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const nativeWidth = page.getViewport({ scale: 1 }).width;
      const scale = Math.min(maxScale, Math.max(minScale, targetWidth / nativeWidth));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      await page.render({ canvasContext: ctx, viewport }).promise;
      page.cleanup();
      pages.push({ index: i - 1, canvas, width: canvas.width, height: canvas.height });
      onPage?.(i, pdf.numPages);
    }
  } finally {
    // Release the pdf.js worker's document resources — without this, repeated
    // imports in the same session leak memory and eventually stall rendering.
    loadingTask.destroy();
  }
  return pages;
}
