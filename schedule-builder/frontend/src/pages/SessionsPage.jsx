import React, { useEffect, useRef, useState } from 'react';
import { useSession } from '../SessionContext.jsx';
import { sessionPackageUrl, sessionExportUrl, browserDownload } from '../api.js';

function fmtDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtBytes(n) {
  if (!n) return '0 KB';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

export default function SessionsPage() {
  const {
    sessions, dir, activeId, session, setActive,
    newSession, renameSession, removeSession, importSession, refreshList, reloadActive,
  } = useSession();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [renaming, setRenaming] = useState(null); // session id being renamed
  const [renameVal, setRenameVal] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const fileRef = useRef(null);

  useEffect(() => { refreshList(); reloadActive(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function doCreate() {
    const name = newName.trim() || 'Untitled tender';
    setBusy('create'); setErr('');
    try { await newSession(name); setCreating(false); setNewName(''); }
    catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  }

  async function doRename(id) {
    const name = renameVal.trim();
    if (!name) { setRenaming(null); return; }
    setBusy('rename'); setErr('');
    try { await renameSession(id, name); setRenaming(null); }
    catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  }

  async function doDelete(s) {
    if (!window.confirm(`Delete session “${s.name}”?\n\nThis permanently removes its saved work and all archived exports. This cannot be undone.`)) return;
    setBusy('del' + s.id); setErr('');
    try { await removeSession(s.id); }
    catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  }

  async function onImport(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy('import'); setErr('');
    try { await importSession(f); }
    catch (e2) { setErr(e2.message); }
    finally { setBusy(''); e.target.value = ''; }
  }

  return (
    <div className="page">
      <div className="actionbar">
        <div className="topbar-figs">
          <div className="fig"><span>Saved sessions</span><b>{sessions.length}</b></div>
          <div className="fig"><span>Active</span><b>{session ? session.name : '—'}</b></div>
        </div>
        <div className="topbar-actions">
          <button className="ghost" onClick={() => fileRef.current?.click()} disabled={busy === 'import'}>
            {busy === 'import' ? 'Importing…' : '⬆ Import session'}
          </button>
          <input ref={fileRef} type="file" accept=".dbill,.zip" onChange={onImport} hidden />
          <button className="primary" onClick={() => { setCreating(true); setNewName(''); }}>+ New session</button>
        </div>
      </div>

      {err && <div className="banner err">{err}</div>}

      <main className="sessions-main">
        <section className="card">
          <div className="card-head">
            <h2>Your tenders</h2>
            <span className="hint">Everything you do is saved automatically into the active tender.</span>
          </div>

          {creating && (
            <div className="new-session-row">
              <input
                autoFocus placeholder="Name this tender (e.g. Tubewell RA Bill, Ward-5 Road)"
                value={newName} onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') doCreate(); if (e.key === 'Escape') setCreating(false); }}
              />
              <button className="primary" onClick={doCreate} disabled={busy === 'create'}>Create</button>
              <button className="ghost" onClick={() => setCreating(false)}>Cancel</button>
            </div>
          )}

          {sessions.length === 0 && !creating && (
            <p className="empty">No sessions yet. Click <b>+ New session</b> to start a tender.</p>
          )}

          <div className="session-list">
            {sessions.map((s) => {
              const isActive = s.id === activeId;
              return (
                <div key={s.id} className={'session-row' + (isActive ? ' active' : '')}>
                  <div className="sr-main">
                    {renaming === s.id ? (
                      <div className="rename-row">
                        <input
                          autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') doRename(s.id); if (e.key === 'Escape') setRenaming(null); }}
                        />
                        <button className="secondary sm" onClick={() => doRename(s.id)}>Save</button>
                        <button className="ghost sm" onClick={() => setRenaming(null)}>Cancel</button>
                      </div>
                    ) : (
                      <>
                        <div className="sr-title">
                          {isActive && <span className="badge">ACTIVE</span>}
                          <b>{s.name}</b>
                        </div>
                        <div className="sr-meta">
                          Saved {fmtDate(s.updatedAt)} · {s.scheduleItems} schedule · {s.billItems} bill · {s.exports} export{s.exports === 1 ? '' : 's'}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="sr-actions">
                    {!isActive && <button className="secondary sm" onClick={() => setActive(s.id)}>Open</button>}
                    {isActive && <a className="btnlink sm" href="#/schedule">→ Schedule</a>}
                    {isActive && <a className="btnlink sm" href="#/bill">→ Bill</a>}
                    <button className="ghost sm" onClick={() => { setRenaming(s.id); setRenameVal(s.name); }}>Rename</button>
                    <button className="ghost sm" onClick={() => browserDownload(sessionPackageUrl(s.id))} title="Save this tender as a single .dbill file">Export</button>
                    <button className="ghost sm danger" onClick={() => doDelete(s)} disabled={busy === 'del' + s.id}>Delete</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {session && (
          <section className="card">
            <div className="card-head">
              <h2>Files in “{session.name}”</h2>
              <span className="hint">Archived copies of everything exported or imported in this tender.</span>
            </div>

            <h3 className="sub">Exported files ({(session.exports || []).length})</h3>
            {(session.exports || []).length === 0 ? (
              <p className="empty sm">No exports yet. Export a Schedule or Bill and a copy is kept here.</p>
            ) : (
              <table className="files-table">
                <thead><tr><th>File</th><th>From</th><th>Type</th><th>Size</th><th>When</th><th></th></tr></thead>
                <tbody>
                  {session.exports.map((e) => (
                    <tr key={e.id}>
                      <td className="fn">{e.filename}</td>
                      <td>{e.page === 'bill' ? 'Bill' : 'Schedule'}</td>
                      <td className="up">{e.kind}</td>
                      <td>{fmtBytes(e.bytes)}</td>
                      <td>{fmtDate(e.at)}</td>
                      <td><button className="secondary sm" onClick={() => browserDownload(sessionExportUrl(session.id, e.id))}>Download</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h3 className="sub">Imported files ({(session.imports || []).length})</h3>
            {(session.imports || []).length === 0 ? (
              <p className="empty sm">No imports. Uploading a schedule to the Bill page keeps a copy here.</p>
            ) : (
              <table className="files-table">
                <thead><tr><th>File</th><th>Rows</th><th>Size</th><th>When</th></tr></thead>
                <tbody>
                  {session.imports.map((im) => (
                    <tr key={im.id}>
                      <td className="fn">{im.filename}</td>
                      <td>{im.rows}</td>
                      <td>{fmtBytes(im.bytes)}</td>
                      <td>{fmtDate(im.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {dir && <p className="storage-note">Sessions are stored on this computer at <code>{dir}</code></p>}
      </main>
    </div>
  );
}
