import React, { useEffect, useState } from 'react';
import HomePage from './pages/HomePage.jsx';
import DsrToSchedulePage from './pages/DsrToSchedulePage.jsx';
import ScheduleToBillPage from './pages/ScheduleToBillPage.jsx';
import SessionsPage from './pages/SessionsPage.jsx';
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

export default function App() {
  const route = useHashRoute();
  const { session, ready } = useSession();
  const page = route.startsWith('#/schedule') ? 'schedule'
    : route.startsWith('#/bill') ? 'bill'
      : route.startsWith('#/sessions') ? 'sessions'
        : 'home';

  const NavLink = ({ to, id, children }) => (
    <a href={to} className={'navlink' + (page === id ? ' active' : '')}>{children}</a>
  );

  return (
    <div className="app">
      <nav className="topnav">
        <a href="#/" className="topnav-brand">DSR Bill Builder</a>
        <div className="topnav-links">
          <NavLink to="#/" id="home">Home</NavLink>
          <NavLink to="#/schedule" id="schedule">DSR → Schedule</NavLink>
          <NavLink to="#/bill" id="bill">Schedule → Bill</NavLink>
          <NavLink to="#/sessions" id="sessions">Sessions</NavLink>
        </div>
        <a href="#/sessions" className={'active-session' + (page === 'sessions' ? ' on' : '')} title="Active tender — click to manage sessions">
          <span className="dot" />
          <span className="lbl">{ready ? (session ? session.name : 'No session') : '…'}</span>
        </a>
      </nav>
      {page === 'home' && <HomePage />}
      {/* key on the active session id: switching sessions remounts the page so it
          re-initializes its form state from the newly active session's saved slice */}
      {page === 'schedule' && <DsrToSchedulePage key={session?.id || 'none'} />}
      {page === 'bill' && <ScheduleToBillPage key={session?.id || 'none'} />}
      {page === 'sessions' && <SessionsPage />}
    </div>
  );
}
