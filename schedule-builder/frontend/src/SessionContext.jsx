import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import {
  listSessions, createSession, getSession, updateSession, deleteSession, importSessionFile,
} from './api.js';

const ACTIVE_KEY = 'activeSessionId';
const SessionContext = createContext(null);

// A session is NOT created automatically. The user explicitly starts a new tender
// (naming it) or opens a saved one from the Home screen; until then there is no
// active session. Once active, pages hydrate from its saved state and push changes
// back via saveSlice() (debounced) as the user works.
export function SessionProvider({ children }) {
  const [sessions, setSessions] = useState([]);
  const [dir, setDir] = useState('');
  const [activeId, setActiveIdState] = useState(null);
  const [session, setSession] = useState(null); // full active session
  const [ready, setReady] = useState(false);

  const activeIdRef = useRef(null);
  const saveTimers = useRef({});
  const booted = useRef(false);

  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  const setActive = useCallback((id) => {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
    activeIdRef.current = id;
    setActiveIdState(id);
  }, []);

  const refreshList = useCallback(async () => {
    try {
      const d = await listSessions();
      setSessions(d.sessions || []);
      if (d.dir) setDir(d.dir);
      return d.sessions || [];
    } catch { return []; }
  }, []);

  // ---- bootstrap: just load the list; do NOT auto-create or auto-select ----
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      await refreshList();
      // No session is opened automatically — the user starts or opens one on Home.
      localStorage.removeItem(ACTIVE_KEY);
      setReady(true);
    })();
  }, [refreshList]);

  // ---- load full active session whenever the active id changes ----
  useEffect(() => {
    if (!activeId) { setSession(null); return; }
    if (session && session.id === activeId) return; // already loaded
    let alive = true;
    getSession(activeId).then((s) => {
      if (!alive) return;
      if (s) setSession(s);
      else setActive(null); // stale id
    });
    return () => { alive = false; };
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- debounced autosave of one page's slice into the active session ----
  const saveSlice = useCallback((slice, state) => {
    const id = activeIdRef.current;
    if (!id) return;
    clearTimeout(saveTimers.current[slice]);
    saveTimers.current[slice] = setTimeout(async () => {
      try {
        const updated = await updateSession(id, { state: { [slice]: state } });
        setSession((prev) => (prev && prev.id === updated.id
          ? { ...prev, state: updated.state, updatedAt: updated.updatedAt } : prev));
        setSessions((prev) => prev.map((s) => (s.id === updated.id
          ? { ...s, updatedAt: updated.updatedAt } : s)));
      } catch { /* keep trying on next change */ }
    }, 700);
  }, []);

  const reloadActive = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id) return null;
    const s = await getSession(id);
    if (s) setSession(s);
    return s;
  }, []);

  const newSession = useCallback(async (name) => {
    const s = await createSession(name);
    setActive(s.id);
    setSession(s);
    await refreshList();
    return s;
  }, [refreshList, setActive]);

  const renameSession = useCallback(async (id, name) => {
    const updated = await updateSession(id, { name });
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, name: updated.name, updatedAt: updated.updatedAt } : s)));
    setSession((prev) => (prev && prev.id === id ? { ...prev, name: updated.name } : prev));
    return updated;
  }, []);

  const removeSession = useCallback(async (id) => {
    await deleteSession(id);
    await refreshList();
    // deleting the active tender just clears it — never auto-create a replacement
    if (activeIdRef.current === id) { setActive(null); setSession(null); }
  }, [refreshList, setActive]);

  const importSession = useCallback(async (file) => {
    const s = await importSessionFile(file);
    await refreshList();
    setActive(s.id);
    setSession(s);
    return s;
  }, [refreshList, setActive]);

  const value = {
    ready, sessions, dir, activeId, session,
    setActive, refreshList, reloadActive,
    saveSlice, newSession, renameSession, removeSession, importSession,
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
