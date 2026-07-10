import React, { useEffect, useRef, useState } from 'react';
import { searchDsr } from '../api.js';

const fmt = (r) => (r == null || r === '' ? '' : Number(r).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

// Autocomplete input: type a DSR code OR description keywords, pick a result.
export default function DsrCodeSearch({ value, onSelect, placeholder, onChange }) {
  const [q, setQ] = useState(value || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => { setQ(value || ''); }, [value]);

  useEffect(() => {
    function onDocClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

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
      {open && (
        <div className="dsr-dropdown">
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
        </div>
      )}
    </div>
  );
}
