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

export default function HomePage() {
  const {
    ready, sessions, session, activeId, newSession, setActive, refreshList, reloadActive,
  } = useSession();
  const [mode, setMode] = useState(null); // null | 'new' | 'previous'
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // keep the list + active session fresh whenever we land on Home
  useEffect(() => { refreshList(); reloadActive(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function createNew() {
    const nm = name.trim() || 'Untitled tender';
    setBusy(true); setErr('');
    try {
      await newSession(nm); // makes a blank session and switches to it
      setName(''); setMode(null);
      go('#/schedule'); // start the fresh tender at the beginning of the flow
    } catch (e) {
      setErr(e.message || 'Could not create the session.');
    } finally { setBusy(false); }
  }

  function openPrevious(id) {
    setActive(id); // switch the active tender…
    go('#/schedule'); // …and drop into its workspace
  }

  return (
    <div className="home">
      <div className="home-hero">
        <div className="home-greet">{greeting()} 👋</div>
        <h1>DSR Bill Builder</h1>
        <p>Build a government tender bill from the DSR 2023 database — start a fresh tender or pick up where you left off.</p>
      </div>

      {/* which tender is currently active */}
      {ready && (
        <div className={'current-session' + (session ? '' : ' none')}>
          <div className="cs-info">
            <span className="cs-label">Current session</span>
            {session ? (
              <>
                <span className="cs-name">{session.name}</span>
                <span className="cs-hint">Everything you do is saved into this tender automatically.</span>
              </>
            ) : (
              <span className="cs-hint">No active tender yet — start a new one or open a previous session below.</span>
            )}
          </div>
          {session && (
            <div className="cs-links">
              <a className="btnlink sm" href="#/schedule">→ Schedule</a>
              <a className="btnlink sm" href="#/bill">→ Bill</a>
            </div>
          )}
        </div>
      )}

      {/* the two choices */}
      <div className="home-choices">
        <button
          className={'choice-card' + (mode === 'new' ? ' selected' : '')}
          onClick={() => { setMode('new'); setErr(''); }}
        >
          <div className="choice-icon">＋</div>
          <h3>Start a new session</h3>
          <p>Begin a fresh tender with a clean slate. Give it a name, then start entering DSR items and quantities.</p>
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

      {/* new-session panel */}
      {mode === 'new' && (
        <div className="home-panel">
          <label className="panel-label">Name your new tender</label>
          <div className="new-session-row">
            <input
              autoFocus placeholder="e.g. Tubewell RA Bill, Ward-5 Road"
              value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createNew(); if (e.key === 'Escape') setMode(null); }}
            />
            <button className="primary" onClick={createNew} disabled={busy}>{busy ? 'Creating…' : 'Create & start'}</button>
            <button className="ghost" onClick={() => setMode(null)}>Cancel</button>
          </div>
          <p className="hint">A new session starts completely blank. Everything you enter afterwards is saved into it automatically.</p>
        </div>
      )}

      {/* previous-session panel */}
      {mode === 'previous' && (
        <div className="home-panel">
          <label className="panel-label">Choose a session to open</label>
          {sessions.length === 0 ? (
            <p className="empty">No saved tenders yet. Start a new session to create your first one.</p>
          ) : (
            <div className="session-list">
              {sessions.map((s) => {
                const isActive = s.id === activeId;
                return (
                  <div key={s.id} className={'session-row' + (isActive ? ' active' : '')}>
                    <div className="sr-main">
                      <div className="sr-title">
                        {isActive && <span className="badge">ACTIVE</span>}
                        <b>{s.name}</b>
                      </div>
                      <div className="sr-meta">
                        Saved {fmtDate(s.updatedAt)} · {s.scheduleItems} schedule · {s.billItems} bill
                      </div>
                    </div>
                    <div className="sr-actions">
                      <button className="primary sm" onClick={() => openPrevious(s.id)}>{isActive ? 'Continue' : 'Open'}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="hint">Rename, export or delete tenders on the <a href="#/sessions">Sessions</a> page.</p>
        </div>
      )}

      <div className="home-flow">
        <span>DSR database</span> → <span>Schedule of Work</span> → <span>RA Bill (Schedule · RE · Abstract)</span>
      </div>
    </div>
  );
}
