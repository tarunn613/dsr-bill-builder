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
    const name = newName.trim();
    if (!name) { setErr('Please enter a name for the tender first.'); return; }
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

  // "Other tenders" is everything except whichever session is active; when
  // nothing is active this is naturally just the full list.
  const others = sessions.filter((s) => s.id !== activeId);
  // the active session's list-summary row (counts), separate from the full
  // `session` detail object (which carries exports/imports as arrays, not counts).
  const activeSummary = sessions.find((s) => s.id === activeId);

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
        {creating && (
          <div className="card new-session-card">
            <div className="new-session-row">
              <input
                autoFocus placeholder="Name this tender (e.g. Tubewell RA Bill, Ward-5 Road)"
                value={newName} onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') doCreate(); if (e.key === 'Escape') setCreating(false); }}
              />
              <button className="primary" onClick={doCreate} disabled={busy === 'create' || !newName.trim()}>Create</button>
              <button className="ghost" onClick={() => setCreating(false)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="sessions-grid">
          {/* ---- left: every tender that isn't the active one ---- */}
          <section className="sessions-col-side">
            <h2 className="section-h">Other tenders</h2>
            {others.length === 0 ? (
              <p className="empty sm">
                {sessions.length === 0
                  ? <>No sessions yet. Click <b>+ New session</b> above to start a tender.</>
                  : 'No other tenders — everything you have is the active one.'}
              </p>
            ) : (
              <div className="tender-cards">
                {others.map((s) => (
                  <article key={s.id} className="tender-card">
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
                        <h3 className="tc-title">{s.name}</h3>
                        <p className="tc-meta">
                          Saved {fmtDate(s.updatedAt)}<br />
                          {s.scheduleItems} schedule · {s.billItems} bill · {s.exports} export{s.exports === 1 ? '' : 's'}
                        </p>
                        <div className="tc-actions">
                          <button className="primary sm" onClick={() => setActive(s.id)}>Open</button>
                          <div className="sr-manage">
                            <button className="icon-btn" title="Rename" onClick={() => { setRenaming(s.id); setRenameVal(s.name); }}>✎</button>
                            <button className="icon-btn" title="Save as a .dbill file" onClick={() => browserDownload(sessionPackageUrl(s.id))}>⬇</button>
                            <button className="icon-btn danger" title="Delete tender" onClick={() => doDelete(s)} disabled={busy === 'del' + s.id}>🗑</button>
                          </div>
                        </div>
                      </>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* ---- right: the active tender, plus its files ---- */}
          <div className="sessions-col-main">
            <section>
              <h2 className="section-h">Current active tender</h2>
              {session ? (
                <article className="active-hero">
                  <div className="active-hero-bar" />
                  {renaming === session.id ? (
                    <div className="rename-row">
                      <input
                        autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') doRename(session.id); if (e.key === 'Escape') setRenaming(null); }}
                      />
                      <button className="secondary sm" onClick={() => doRename(session.id)}>Save</button>
                      <button className="ghost sm" onClick={() => setRenaming(null)}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <div className="active-hero-top">
                        <div className="active-hero-head">
                          <span className="active-hero-eyebrow">Active session</span>
                          <h3 className="active-hero-title">{session.name}</h3>
                        </div>
                        <div className="active-hero-manage">
                          <button className="ghost sm" onClick={() => { setRenaming(session.id); setRenameVal(session.name); }}>✎ Rename</button>
                          <button className="ghost danger sm" onClick={() => doDelete(session)} disabled={busy === 'del' + session.id}>🗑 Delete</button>
                        </div>
                      </div>
                      <p className="active-hero-meta">
                        Saved {fmtDate(activeSummary?.updatedAt)} · {activeSummary?.scheduleItems ?? 0} schedule
                        {' '}· {activeSummary?.billItems ?? 0} bill · {activeSummary?.exports ?? 0} export{(activeSummary?.exports ?? 0) === 1 ? '' : 's'}
                      </p>
                      <div className="active-hero-actions">
                        <a className="hero-action" href="#/schedule">View Schedule</a>
                        <a className="hero-action" href="#/bill">View Bill</a>
                        <button type="button" className="hero-action" onClick={() => browserDownload(sessionPackageUrl(session.id))}>⬇ Export tender</button>
                      </div>
                    </>
                  )}
                </article>
              ) : (
                <div className="active-hero active-hero--empty">
                  <p className="empty">No active tender right now — open one from the list on the left, or click <b>+ New session</b> above.</p>
                </div>
              )}
            </section>

            {session && (
              <>
                <section>
                  <h2 className="section-h">Exported files <span className="section-count">({(session.exports || []).length})</span></h2>
                  {(session.exports || []).length === 0 ? (
                    <div className="files-empty">No exports yet. Export a Schedule or Bill and a copy is kept here.</div>
                  ) : (
                    <div className="files-card">
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
                              <td className="dl"><button className="icon-btn" title="Download" onClick={() => browserDownload(sessionExportUrl(session.id, e.id))}>⬇</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        </div>

        {dir && <p className="storage-note">Sessions are stored on this computer at <code>{dir}</code></p>}
      </main>
    </div>
  );
}
