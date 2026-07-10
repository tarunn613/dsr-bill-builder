import React, { useEffect, useState } from 'react';
import HomePage from './pages/HomePage.jsx';
import DsrToSchedulePage from './pages/DsrToSchedulePage.jsx';
import ScheduleToBillPage from './pages/ScheduleToBillPage.jsx';
import ExcelToPdfPage from './pages/ExcelToPdfPage.jsx';
import SessionsPage from './pages/SessionsPage.jsx';
import HelpPage from './pages/HelpPage.jsx';
import { useSession } from './SessionContext.jsx';

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

// left-drawer navigation (each entry carries a short description)
const NAV = [
  { to: '#/', id: 'home', label: 'Home', desc: 'Start a new tender or open a saved one' },
  { to: '#/schedule', id: 'schedule', label: 'DSR → Schedule', desc: 'Build a Schedule of Work from the DSR 2023 database' },
  { to: '#/bill', id: 'bill', label: 'Schedule → Bill', desc: 'Turn a Schedule into a full RA Bill' },
  { to: '#/topdf', id: 'topdf', label: 'Excel → PDF', desc: 'Convert a bill workbook into black-&-white A4 PDFs' },
  { to: '#/sessions', id: 'sessions', label: 'Sessions', desc: 'Create, rename, export or delete tenders' },
  { to: '#/help', id: 'help', label: 'Help', desc: 'A visual guide to using this software' },
];

// pages that only make sense inside a tender
const NEEDS_SESSION = new Set(['schedule', 'bill']);

// shown when a session-only page is opened with no active session
function SessionGate() {
  return (
    <div className="page">
      <div className="session-gate">
        <div className="session-gate-icon">📁</div>
        <h2>Create a session first</h2>
        <p>This step works inside a tender. Start a new session (give it a name) or open a
          saved one, then come back to this option.</p>
        <div className="session-gate-actions">
          <button className="primary" onClick={() => { window.location.hash = '#/'; }}>＋ Start / open a session</button>
          <button className="ghost" onClick={() => { window.location.hash = '#/sessions'; }}>Manage sessions</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const route = useHashRoute();
  const { session, ready } = useSession();
  const [drawer, setDrawer] = useState(false);

  const page = route.startsWith('#/schedule') ? 'schedule'
    : route.startsWith('#/bill') ? 'bill'
      : route.startsWith('#/topdf') ? 'topdf'
        : route.startsWith('#/sessions') ? 'sessions'
          : route.startsWith('#/help') ? 'help'
            : 'home';

  // close the drawer on any route change
  useEffect(() => { setDrawer(false); }, [route]);

  const gated = NEEDS_SESSION.has(page) && ready && !session;

  return (
    <div className="app">
      <header className="appbar">
        <button className="hamburger" onClick={() => setDrawer(true)} aria-label="Open menu">☰</button>
        <a href="#/" className="appbar-brand">DSR Bill Builder</a>
        <a href="#/sessions" className={'active-session' + (page === 'sessions' ? ' on' : '')} title="Active tender">
          <span className="dot" />
          <span className="lbl">{ready ? (session ? session.name : 'No session') : '…'}</span>
        </a>
      </header>

      {/* left sliding menu */}
      <div className={'drawer-scrim' + (drawer ? ' open' : '')} onClick={() => setDrawer(false)} />
      <aside className={'drawer' + (drawer ? ' open' : '')} aria-hidden={!drawer}>
        <div className="drawer-head">
          <span className="drawer-brand">Menu</span>
          <button className="drawer-close" onClick={() => setDrawer(false)} aria-label="Close menu">✕</button>
        </div>
        <div className="drawer-active">
          <span className="dot" />
          <span>{session ? session.name : 'No active session'}</span>
        </div>
        <nav className="drawer-nav">
          {NAV.map((n) => (
            <a key={n.id} href={n.to} className={'drawer-link' + (page === n.id ? ' active' : '')}>
              <span className="drawer-link-label">{n.label}</span>
              <span className="drawer-link-desc">{n.desc}</span>
            </a>
          ))}
        </nav>
      </aside>

      {/* pages: schedule/bill are remounted per session (key) and gated when none is active */}
      {page === 'home' && <HomePage />}
      {page === 'schedule' && (gated ? <SessionGate /> : <DsrToSchedulePage key={session?.id} />)}
      {page === 'bill' && (gated ? <SessionGate /> : <ScheduleToBillPage key={session?.id} />)}
      {page === 'topdf' && <ExcelToPdfPage />}
      {page === 'sessions' && <SessionsPage />}
      {page === 'help' && <HelpPage />}
    </div>
  );
}
