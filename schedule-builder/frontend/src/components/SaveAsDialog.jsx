import React, { useEffect, useRef, useState } from 'react';

// A small "Save as" confirmation shown after an export is generated and
// before it's actually written to disk — lets the user rename the file
// instead of always getting the backend's auto-generated name. Deliberately
// a custom dialog rather than window.prompt(), which isn't reliably
// available in every environment this app runs in (desktop-packaged, etc.).
export default function SaveAsDialog({ defaultName, onConfirm, onCancel }) {
  const [name, setName] = useState(defaultName);
  const inputRef = useRef(null);

  // focus + pre-select just the base name (not the extension) so typing
  // immediately replaces it, like a native save-as dialog.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const dot = defaultName.lastIndexOf('.');
    if (dot > 0) el.setSelectionRange(0, dot);
    else el.select();
  }, [defaultName]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  function confirm() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const dot = defaultName.lastIndexOf('.');
    const ext = dot >= 0 ? defaultName.slice(dot) : '';
    const finalName = ext && !trimmed.toLowerCase().endsWith(ext.toLowerCase()) ? trimmed + ext : trimmed;
    onConfirm(finalName);
  }

  return (
    <div className="saveas-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="saveas-box" role="dialog" aria-modal="true">
        <div className="saveas-title">Save as</div>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }}
        />
        <div className="saveas-actions">
          <button className="ghost" onClick={onCancel}>Cancel</button>
          <button className="primary" disabled={!name.trim()} onClick={confirm}>Save</button>
        </div>
      </div>
    </div>
  );
}
