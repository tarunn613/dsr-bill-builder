import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { searchDsr } from '../api.js';

const fmt = (r) => (r == null || r === '' ? '' : Number(r).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// Autocomplete input: type a DSR code OR description keywords, pick a result.
//
// The results panel is portaled to <body> and positioned with `position: fixed`
// from the input's own live screen coordinates, rather than living inside the
// input's own DOM subtree. That makes it float cleanly above absolutely
// everything, however deep the input is nested — it can never be clipped by a
// scrollable ancestor (e.g. a review table's overflow wrapper) and never
// collides with unrelated UI below it (e.g. a modal's own footer buttons),
// because it no longer has to fight for room inside whatever cramped container
// the input happens to sit in.
export default function DsrCodeSearch({ value, onSelect, placeholder, onChange }) {
  const [q, setQ] = useState(value || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState(null);
  const boxRef = useRef(null);
  const panelRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => { setQ(value || ''); }, [value]);

  useEffect(() => {
    // The portaled panel is no longer a DOM descendant of boxRef, so a click
    // inside it must also count as "inside" here or it would be mistaken for
    // an outside click and close itself before the option's own click lands.
    function onDocClick(e) {
      if (boxRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Recompute the floating position whenever the dropdown opens (or its result
  // count changes its natural height), and keep it pinned to the input across
  // scrolling/resizing while open. Flips to open upward when there isn't
  // enough room below.
  useEffect(() => {
    if (!open) return;
    function reposition() {
      if (!boxRef.current) return;
      const r = boxRef.current.getBoundingClientRect();
      const width = Math.max(r.width, 420);
      const left = Math.min(r.left, window.innerWidth - width - 8);
      const spaceBelow = window.innerHeight - r.bottom;
      const openUp = spaceBelow < 200 && r.top > spaceBelow;
      setPos(openUp
        ? { left, width, bottom: window.innerHeight - r.top + 2, top: null }
        : { left, width, top: r.bottom + 2, bottom: null });
    }
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, results]);

  function runSearch(text) {
    clearTimeout(timer.current);
    if (!text || !text.trim()) { setResults([]); setOpen(false); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const r = await searchDsr(text, 25);
      setResults(r);
      setActive(0);
      setOpen(true);
      setLoading(false);
    }, 180);
  }

  function choose(row) {
    setQ(row.code);
    setOpen(false);
    onSelect(row);
  }

  function onKeyDown(e) {
    if (!open || !results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(results[active]); }
    else if (e.key === 'Escape') { setOpen(false); }
  }

  return (
    <div className="dsr-search" ref={boxRef}>
      <input
        className="dsr-search-input"
        value={q}
        placeholder={placeholder || 'code or keywords…'}
        onChange={(e) => {
          setQ(e.target.value);
          runSearch(e.target.value);
          if (onChange) onChange(e.target.value);
        }}
        onFocus={() => { if (results.length) setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {open && pos && createPortal(
        <div
          className="dsr-dropdown"
          ref={panelRef}
          style={{ left: pos.left, width: pos.width, top: pos.top ?? 'auto', bottom: pos.bottom ?? 'auto' }}
        >
          {loading && <div className="dsr-hint">searching…</div>}
          {!loading && results.length === 0 && <div className="dsr-hint">no matches</div>}
          {results.map((r, i) => (
            <div
              key={r.code + i}
              className={'dsr-option' + (i === active ? ' active' : '') + (r.carriage ? ' carriage' : '')}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); choose(r); }}
            >
              <div className="dsr-option-top">
                <span className="dsr-code">{r.code}</span>
                <span className="dsr-vol">{r.volume}</span>
                <span className="dsr-unit">{r.unit}</span>
                <span className="dsr-rate">{r.carriage ? 'carriage ▸ pick lead' : '₹ ' + fmt(r.rate)}</span>
              </div>
              <div className="dsr-desc">{r.description}</div>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
