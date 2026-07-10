import React, { useEffect, useState } from 'react';
import { useSession } from '../SessionContext.jsx';

function fmtDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function go(hash) { window.location.hash = hash; }

// the four things you can do inside a tender (shown after naming/opening a session)
const HUB = [
  { to: '#/schedule', icon: '📋', title: 'DSR → Schedule', desc: 'Build a Schedule of Work from the DSR 2023 rate database — enter codes and quantities.' },
  { to: '#/bill', icon: '🧾', title: 'Schedule → Bill', desc: 'Turn a Schedule into a full RA Bill — Schedule, RE, Abstract and Cement sheets.' },
  { to: '#/topdf', icon: '📄', title: 'Excel → PDF', desc: 'Convert a bill workbook into clean black-&-white, A4-fit PDFs, one per sheet.' },
  { to: '#/sessions', icon: '🗂️', title: 'Session management', desc: 'Rename, export (.dbill), import or delete your saved tenders.' },
];

export default function HomePage() {
  const { ready, sessions, session, newSession, setActive, refreshList, reloadActive } = useSession();
  const [mode, setMode] = useState(null); // null | 'new' | 'previous'
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // keep the list + active session fresh whenever we land on Home
  useEffect(() => { refreshList(); reloadActive(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function createNew() {
    const nm = name.trim();
    if (!nm) { setErr('Please enter a name for the tender first.'); return; }
    setBusy(true); setErr('');
    try {
      await newSession(nm);   // creates + activates → the hub below renders
      setName(''); setMode(null);
    } catch (e) {
      setErr(e.message || 'Could not create the session.');
    } finally { setBusy(false); }
  }

  function openPrevious(id) { setActive(id); } // activates → the hub renders

  // ===== a session is active → the "what do you want to do" hub =====
  if (ready && session) {
    return (
      <div className="home">
        <div className="hub-hero">
          <div className="hub-eyebrow">Active tender</div>
          <h1>{session.name}</h1>
          <p>What would you like to do?</p>
        </div>
        <div className="hub-grid">
          {HUB.map((c) => (
            <button key={c.to} className="hub-card" onClick={() => go(c.to)}>
              <div className="hub-card-icon">{c.icon}</div>
              <h3>{c.title}</h3>
              <p>{c.desc}</p>
            </button>
          ))}
        </div>
        <div className="hub-foot">
          <button className="ghost" onClick={() => setActive(null)}>Close tender</button>
          <span className="hint">Everything you do is saved into this tender automatically.</span>
        </div>
      </div>
    );
  }

  // ===== no active session → start a new one or open a saved one =====
  return (
    <div className="home">
      <div className="home-hero">
        <div className="home-greet">{greeting()} 👋</div>
        <h1>DSR Bill Builder</h1>
        <p>Start a new tender or open a saved one to begin. Nothing is created until you name it.</p>
      </div>

      <div className="home-choices">
        <button
          className={'choice-card' + (mode === 'new' ? ' selected' : '')}
          onClick={() => { setMode('new'); setErr(''); }}
        >
          <div className="choice-icon">＋</div>
          <h3>Start a new session</h3>
          <p>Begin a fresh tender. Give it a name, then choose what to do.</p>
        </button>

        <button
          className={'choice-card' + (mode === 'previous' ? ' selected' : '')}
          onClick={() => { setMode('previous'); setErr(''); }}
        >
          <div className="choice-icon">↻</div>
          <h3>Open a previous session</h3>
          <p>{sessions.length
            ? `Continue one of your ${sessions.length} saved tender${sessions.length === 1 ? '' : 's'}.`
            : 'You have no saved tenders yet — start a new one first.'}</p>
        </button>
      </div>

      {err && <div className="home-err">{err}</div>}

      {mode === 'new' && (
        <div className="home-panel">
          <label className="panel-label">Name your new tender</label>
          <div className="new-session-row">
            <input
              autoFocus placeholder="e.g. Tubewell RA Bill, Ward-5 Road"
              value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createNew(); if (e.key === 'Escape') setMode(null); }}
            />
            <button className="primary" onClick={createNew} disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create & continue'}</button>
            <button className="ghost" onClick={() => setMode(null)}>Cancel</button>
          </div>
          <p className="hint">A name is required. After naming, you’ll choose what to do — Schedule, Bill, Excel → PDF, or manage sessions.</p>
        </div>
      )}

      {mode === 'previous' && (
        <div className="home-panel">
          <label className="panel-label">Choose a session to open</label>
          {sessions.length === 0 ? (
            <p className="empty">No saved tenders yet. Start a new session to create your first one.</p>
          ) : (
            <div className="session-list">
              {sessions.map((s) => (
                <div key={s.id} className="session-row">
                  <div className="sr-main">
                    <div className="sr-title"><b>{s.name}</b></div>
                    <div className="sr-meta">
                      Saved {fmtDate(s.updatedAt)} · {s.scheduleItems} schedule · {s.billItems} bill
                    </div>
                  </div>
                  <div className="sr-actions">
                    <button className="primary sm" onClick={() => openPrevious(s.id)}>Open</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="hint">Rename, export or delete tenders on the <a href="#/sessions">Sessions</a> page.</p>
        </div>
      )}
    </div>
  );
}
