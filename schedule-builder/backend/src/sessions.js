// File-based session store.
//
// A "session" is one tender/project. It holds the full working state of both
// pages (DSR -> Schedule and Schedule -> Bill), plus an on-disk archive of every
// file the user exported, so no work is ever lost.
//
// Layout (one folder per session):
//   <base>/<id>/session.json      metadata + saved page state
//   <base>/<id>/exports/*         archived .xlsx / .pdf the user exported
//
// An older session (or an imported .dbill made before this) may still carry an
// imports/ subfolder on disk from a since-removed "upload a schedule" feature —
// importSessionPackage() preserves it verbatim rather than discarding it.
//
// The base folder is process.env.SESSIONS_DIR when set (the desktop app points
// this at the OS user-data dir), otherwise backend/data/sessions for plain dev.
//
// Everything is plain files + JSON so there are no native modules to compile
// (keeps the Windows/Mac desktop build clean) and a session is trivially
// portable: zip the folder -> a single .dbill file that imports on any machine.

import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
  renameSync, rmSync, statSync,
} from 'fs';
import { randomUUID } from 'crypto';
import AdmZip from 'adm-zip';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_EXT = '.dbill'; // a session package is a zip with this extension

// ---- paths -----------------------------------------------------------------

function baseDir() {
  const dir = process.env.SESSIONS_DIR || join(__dirname, '..', 'data', 'sessions');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertId(id) {
  if (!ID_RE.test(String(id || ''))) throw new Error('invalid session id');
  return id;
}

function sessionDir(id) {
  return join(baseDir(), assertId(id));
}

function sessionFile(id) {
  return join(sessionDir(id), 'session.json');
}

// strip any path parts / unsafe chars from a user-supplied filename
function safeFile(name, fallback) {
  const clean = basename(String(name || '')).replace(/[^\w.\- ]+/g, '_').trim();
  return clean || fallback;
}

// filesystem-safe version of a session name, for the exported package filename
function safeName(name) {
  const s = String(name || '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return s || 'session';
}

// ---- read / write ----------------------------------------------------------

function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, file); // atomic replace so an interrupted autosave can't corrupt it
}

function readSession(id) {
  const f = sessionFile(id);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

function writeSession(session) {
  session.updatedAt = Date.now();
  writeJsonAtomic(sessionFile(session.id), session);
  return session;
}

function summarize(s) {
  return {
    id: s.id,
    name: s.name,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    scheduleItems: countItems(s.state?.schedule),
    billItems: Array.isArray(s.state?.bill?.rows) ? s.state.bill.rows.length : 0,
    exports: (s.exports || []).length,
  };
}

function countItems(schedule) {
  if (!schedule) return 0;
  const d = Array.isArray(schedule.dsrItems) ? schedule.dsrItems.length : 0;
  const m = Array.isArray(schedule.marketItems) ? schedule.marketItems.length : 0;
  return d + m;
}

// ---- public API ------------------------------------------------------------

export function listSessions() {
  const base = baseDir();
  const out = [];
  for (const entry of readdirSync(base)) {
    if (!ID_RE.test(entry)) continue;
    const s = readSession(entry);
    if (s && s.id) out.push(summarize(s));
  }
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return out;
}

// Every tender name must be unique (trimmed, case-insensitive) so the Sessions
// list, Home page and exported .dbill filenames are never ambiguous about which
// tender is which. `excludeId` lets a rename check every OTHER session without
// tripping over the session's own current name.
function nameTaken(name, excludeId) {
  const norm = String(name || '').trim().toLowerCase();
  if (!norm) return false;
  const base = baseDir();
  for (const entry of readdirSync(base)) {
    if (!ID_RE.test(entry) || entry === excludeId) continue;
    const s = readSession(entry);
    if (s && String(s.name || '').trim().toLowerCase() === norm) return true;
  }
  return false;
}

// Append " (2)", " (3)", ... until the name is free. Used only for imports,
// which have no interactive moment to ask the user for a different name — a
// clash there gets silently resolved instead of blocked, matching the rest of
// the app's "nothing is ever lost" behaviour.
function dedupeName(name) {
  const base = String(name || '').trim() || 'Untitled tender';
  if (!nameTaken(base)) return base;
  let n = 2;
  while (nameTaken(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

export function createSession(name) {
  const finalName = String(name || '').trim() || 'Untitled tender';
  if (nameTaken(finalName)) {
    throw new Error(`A tender named "${finalName}" already exists — please choose a different name.`);
  }
  const id = randomUUID();
  const dir = sessionDir(id);
  mkdirSync(join(dir, 'exports'), { recursive: true });
  const now = Date.now();
  const session = {
    id,
    name: finalName,
    app: 'dyanamic-bill-builder',
    version: 1,
    createdAt: now,
    updatedAt: now,
    state: { schedule: null, bill: null },
    exports: [],
  };
  writeSession(session);
  return session;
}

export function getSession(id) {
  return readSession(id);
}

export function updateSession(id, patch = {}) {
  const s = readSession(id);
  if (!s) return null;
  if (typeof patch.name === 'string' && patch.name.trim()) {
    const newName = patch.name.trim();
    if (nameTaken(newName, id)) {
      throw new Error(`A tender named "${newName}" already exists — please choose a different name.`);
    }
    s.name = newName;
  }
  if (patch.state && typeof patch.state === 'object') {
    s.state = { ...s.state, ...patch.state };
  }
  return writeSession(s);
}

export function deleteSession(id) {
  const dir = sessionDir(id);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

// Archive a generated export (buffer) into the session and record its metadata.
export function archiveExport(id, { page, kind, filename, buffer }) {
  const s = readSession(id);
  if (!s) return null;
  const exportId = randomUUID();
  const nice = safeFile(filename, `export.${kind || 'bin'}`);
  const storedAs = `${exportId}__${nice}`;
  const dir = join(sessionDir(id), 'exports');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, storedAs), buffer);
  const rec = {
    id: exportId,
    page: page || 'schedule',
    kind: kind || 'bin',
    filename: nice,
    storedAs,
    bytes: buffer.length,
    at: Date.now(),
  };
  s.exports = s.exports || [];
  s.exports.unshift(rec); // newest first
  writeSession(s);
  return rec;
}

// Resolve an archived export's absolute path + download name.
export function getExportFile(id, exportId) {
  const s = readSession(id);
  if (!s) return null;
  const rec = (s.exports || []).find((e) => e.id === exportId);
  if (!rec) return null;
  const path = join(sessionDir(id), 'exports', rec.storedAs);
  if (!existsSync(path)) return null;
  return { path, filename: rec.filename, kind: rec.kind };
}

// Zip the whole session folder into a single portable package.
export function packageSession(id) {
  const s = readSession(id);
  if (!s) return null;
  const zip = new AdmZip();
  zip.addLocalFolder(sessionDir(id));
  return { buffer: zip.toBuffer(), filename: `${safeName(s.name)}${PACKAGE_EXT}` };
}

// Import a .dbill package (zip) as a brand-new session (fresh id, no clashes).
export function importSessionPackage(buffer) {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry('session.json');
  if (!entry) throw new Error('not a valid session file (session.json missing)');
  let incoming;
  try {
    incoming = JSON.parse(zip.readAsText(entry));
  } catch {
    throw new Error('session file is corrupt');
  }
  const id = randomUUID();
  const dir = sessionDir(id);
  mkdirSync(dir, { recursive: true });
  zip.extractAllTo(dir, /* overwrite */ true);
  const s = readSession(id) || incoming;
  const now = Date.now();
  s.id = id;
  s.name = dedupeName(String(incoming.name || 'Imported tender').trim() || 'Imported tender');
  s.createdAt = incoming.createdAt || now;
  s.updatedAt = now;
  // ensure the archive subfolders exist even if the package had none
  mkdirSync(join(dir, 'exports'), { recursive: true });
  mkdirSync(join(dir, 'imports'), { recursive: true });
  writeSession(s);
  return s;
}

export function sessionsBaseDir() {
  return baseDir();
}
