// In-app handoff of a built schedule from the DSR→Schedule page to the
// Schedule→Bill page (survives the hash navigation via localStorage).
const KEY = 'billHandoff';

export function sendScheduleToBill(data) {
  localStorage.setItem(KEY, JSON.stringify({ ...data, at: Date.now() }));
}

export function takeBillHandoff() {
  const s = localStorage.getItem(KEY);
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

export function clearBillHandoff() {
  localStorage.removeItem(KEY);
}
