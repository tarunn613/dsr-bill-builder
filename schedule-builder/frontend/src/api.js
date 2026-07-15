// Tiny fetch wrapper for the local backend API.
const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Triggers a browser save of `blob` under `filename`. Call this once the user
// has confirmed a name in <SaveAsDialog> (see components/SaveAsDialog.jsx) —
// these two are split so pages can show that dialog between fetching the
// export and actually saving it.
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Archive an export into a session under its final, user-chosen filename —
// called after saveBlob(), once <SaveAsDialog> has confirmed a name, so the
// copy shown on the Sessions page matches what was actually saved locally.
// A no-op with no active session; never throws (an archiving failure
// shouldn't undo the download the user already has).
export async function archiveExport(sessionId, { page, kind, filename, blob }) {
  if (!sessionId) return;
  try {
    const fileBase64 = await fileToBase64(blob);
    const res = await fetch(`/api/sessions/${sessionId}/exports`, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ page, kind, filename, fileBase64 }),
    });
    if (!res.ok) throw new Error(`archive failed (${res.status})`);
  } catch (e) {
    console.error('archiveExport failed:', e.message || e);
  }
}

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

// Fetches the export and returns { blob, defaultName } — the caller shows
// <SaveAsDialog> for the user to confirm/edit defaultName, then calls
// saveBlob(blob, chosenName).
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
  const defaultName = m ? m[1] : `schedule.${kind === 'xlsx' ? 'xlsx' : 'pdf'}`;
  return { blob, defaultName };
}

// ---- Phase 3: bill --------------------------------------------------------
export async function computeBill(payload) {
  const res = await fetch('/api/bill/compute', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('bill compute failed');
  return res.json();
}

// Fetches the export and returns { blob, defaultName } — see downloadSchedule.
export async function downloadBill(payload) {
  const res = await fetch('/api/bill/xlsx', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('bill export failed');
  const blob = await res.blob();
  const disp = res.headers.get('Content-Disposition') || '';
  const m = disp.match(/filename="?([^"]+)"?/);
  const defaultName = m ? m[1] : 'ra_bill.xlsx';
  return { blob, defaultName };
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

// Fetches the export and returns { blob, defaultName } — see downloadSchedule.
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
  const defaultName = m ? m[1] : 'workbook_pdf.zip';
  return { blob, defaultName };
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

// ---- JSON import (paste vision-AI JSON of a Schedule of Work) -------------
export async function parseJsonImport(text) {
  const res = await fetch('/api/json-import/parse', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'could not parse that JSON');
  return data;
}

// Award letter / work order JSON → Bill Header fields (Schedule → Bill page).
export async function parseTenderImport(text) {
  const res = await fetch('/api/tender-import/parse', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'could not parse that JSON');
  return data;
}

export async function rematchJsonRow(code, description) {
  try {
    const res = await fetch('/api/json-import/match', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ code, description }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
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
