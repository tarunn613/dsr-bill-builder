// Tiny fetch wrapper for the local backend API.
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export async function searchDsr(q, limit = 25) {
  if (!q || !q.trim()) return [];
  const res = await fetch(`/api/dsr/search?q=${encodeURIComponent(q)}&limit=${limit}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.results || [];
}

export async function lookupDsr(code) {
  const res = await fetch(`/api/dsr/${encodeURIComponent(code)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.matches || [];
}

export async function computeSchedule(payload) {
  const res = await fetch('/api/schedule/compute', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('compute failed');
  return res.json();
}

export async function downloadSchedule(kind, payload) {
  const res = await fetch(`/api/schedule/${kind}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${kind} export failed`);
  const blob = await res.blob();
  const disp = res.headers.get('Content-Disposition') || '';
  const m = disp.match(/filename="?([^"]+)"?/);
  const filename = m ? m[1] : `schedule.${kind === 'xlsx' ? 'xlsx' : 'pdf'}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---- Phase 3: bill --------------------------------------------------------
export async function computeBill(payload) {
  const res = await fetch('/api/bill/compute', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('bill compute failed');
  return res.json();
}

export async function downloadBill(payload) {
  const res = await fetch('/api/bill/xlsx', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('bill export failed');
  const blob = await res.blob();
  const disp = res.headers.get('Content-Disposition') || '';
  const m = disp.match(/filename="?([^"]+)"?/);
  const filename = m ? m[1] : 'ra_bill.xlsx';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

export async function parseScheduleFile(file, sessionId) {
  const b64 = await fileToBase64(file);
  const res = await fetch('/api/bill/parse', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ fileBase64: b64, filename: file.name, sessionId }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || 'could not parse workbook');
  }
  return res.json();
}

// ---- Excel -> B&W A4 PDF (zip of per-sheet PDFs) --------------------------
export async function listXlsxSheets(file) {
  const b64 = await fileToBase64(file);
  const res = await fetch('/api/topdf/list', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ fileBase64: b64 }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || 'could not read workbook');
  }
  return (await res.json()).sheets || [];
}

export async function convertXlsxToPdf(file, sheets, sessionId) {
  const b64 = await fileToBase64(file);
  const res = await fetch('/api/topdf', {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({ fileBase64: b64, filename: file.name, sheets, sessionId }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || 'could not convert workbook');
  }
  const blob = await res.blob();
  const disp = res.headers.get('Content-Disposition') || '';
  const m = disp.match(/filename="?([^"]+)"?/);
  const filename = m ? m[1] : 'workbook_pdf.zip';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return filename;
}

export async function lookupCementCoeffs(codes) {
  try {
    const res = await fetch('/api/cement/coeffs', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ codes }),
    });
    if (!res.ok) return {};
    return (await res.json()).coeffs || {};
  } catch { return {}; }
}

// Fallback: search by description (for items whose DSR code isn't in the appendix)
export async function searchCementByDesc(desc, limit = 5) {
  try {
    const res = await fetch('/api/cement/search', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ desc, limit }),
    });
    if (!res.ok) return [];
    return (await res.json()).results || [];
  } catch { return []; }
}

// Search by DSR code (partial/prefix match in cement DB)
export async function searchCementByCode(code, limit = 10) {
  try {
    const res = await fetch('/api/cement/search-code', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ code, limit }),
    });
    if (!res.ok) return [];
    return (await res.json()).results || [];
  } catch { return []; }
}

// Combined search: searches both by code and description in cement DB
export async function searchCementCombined(query, limit = 10) {
  try {
    const res = await fetch('/api/cement/search-combined', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ query, limit }),
    });
    if (!res.ok) return [];
    return (await res.json()).results || [];
  } catch { return []; }
}

export async function getMeta() {
  try {
    const res = await fetch('/api/meta');
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}

// ---- Phase 4: sessions ----------------------------------------------------
export async function listSessions() {
  const res = await fetch('/api/sessions');
  if (!res.ok) throw new Error('could not list sessions');
  return res.json(); // { sessions, dir }
}

export async function createSession(name) {
  const res = await fetch('/api/sessions', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('could not create session');
  return res.json();
}

export async function getSession(id) {
  const res = await fetch(`/api/sessions/${id}`);
  if (!res.ok) return null;
  return res.json();
}

export async function updateSession(id, patch) {
  const res = await fetch(`/api/sessions/${id}`, {
    method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('could not save session');
  return res.json();
}

export async function deleteSession(id) {
  const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('could not delete session');
  return res.json();
}

// URLs for browser-driven downloads (backend sets Content-Disposition)
export function sessionPackageUrl(id) { return `/api/sessions/${id}/package`; }
export function sessionExportUrl(id, exportId) { return `/api/sessions/${id}/exports/${exportId}`; }

// trigger a browser download of a same-origin URL
export function browserDownload(url) {
  const a = document.createElement('a');
  a.href = url;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function importSessionFile(file) {
  const b64 = await fileToBase64(file);
  const res = await fetch('/api/sessions/import', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ fileBase64: b64 }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || 'could not import session');
  }
  return res.json();
}
