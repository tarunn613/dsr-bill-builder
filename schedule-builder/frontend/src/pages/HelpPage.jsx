import React, { useState } from 'react';

const TABS = [
  ['overview', 'Overview'],
  ['sessions', 'Sessions'],
  ['schedule', 'DSR → Schedule'],
  ['bill', 'Schedule → Bill'],
  ['topdf', 'Excel → PDF'],
  ['tips', 'Tips & FAQ'],
];

// ---- small visual building blocks ------------------------------------------
function FlowDiagram({ steps }) {
  return (
    <div className="flow-row">
      {steps.map((s, i) => (
        <React.Fragment key={s.title}>
          <div className="flow-card">
            <div className="flow-card-icon">{s.icon}</div>
            <div className="flow-card-title">{s.title}</div>
            <div className="flow-card-desc">{s.desc}</div>
          </div>
          {i < steps.length - 1 && <div className="flow-arrow">→</div>}
        </React.Fragment>
      ))}
    </div>
  );
}

function ChainDiagram({ steps }) {
  return (
    <div className="chain-row">
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          <div className="chain-pill">{s}</div>
          {i < steps.length - 1 && <div className="chain-arrow">→</div>}
        </React.Fragment>
      ))}
    </div>
  );
}

function StepList({ items }) {
  return (
    <ol className="help-steps">
      {items.map((it, i) => (
        <li key={i} className="help-step">
          <span className="help-step-num">{i + 1}</span>
          <span className="help-step-body">
            <b>{it.title}</b>
            {it.desc && <span className="help-step-desc"> — {it.desc}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Legend({ items }) {
  return (
    <div className="legend-row">
      {items.map((it) => (
        <div key={it.label} className="legend-item">
          <span className="legend-swatch" style={{ background: it.color, borderColor: it.border || it.color }} />
          <span><b>{it.label}</b>{it.desc ? ` — ${it.desc}` : ''}</span>
        </div>
      ))}
    </div>
  );
}

function MiniGrid({ items }) {
  return (
    <div className="mini-grid">
      {items.map((it) => (
        <div key={it.title} className="mini-card">
          <div className="mini-card-top"><span className="mini-card-icon">{it.icon}</span><h4>{it.title}</h4></div>
          <p>{it.desc}</p>
          {it.bullets && (
            <ul className="mini-card-list">{it.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
          )}
        </div>
      ))}
    </div>
  );
}

function Callout({ tone = 'gold', title, children }) {
  return (
    <div className={'callout ' + tone}>
      <div className="callout-title">{title}</div>
      <div className="callout-body">{children}</div>
    </div>
  );
}

// ---- tab content -------------------------------------------------------------
function Overview() {
  return (
    <>
      <p className="help-lede">
        DSR Bill Builder turns the DSR 2023 rate database into a <b>Schedule of Work</b>,
        then into a full <b>RA Bill</b>, and can turn any of those Excel sheets into clean
        print-ready PDFs. Everything runs locally on this computer — nothing is uploaded
        anywhere.
      </p>

      <h3 className="help-h3">The four things you can do</h3>
      <FlowDiagram
        steps={[
          { icon: '🗂️', title: 'Session', desc: 'Name a tender — everything below lives inside it' },
          { icon: '📋', title: 'DSR → Schedule', desc: 'Pick items from the DSR book, get a Schedule of Work' },
          { icon: '🧾', title: 'Schedule → Bill', desc: 'Add measurements, get the RA Bill' },
          { icon: '📄', title: 'Excel → PDF', desc: 'Print-ready, black-&-white A4 sheets' },
        ]}
      />
      <p className="hint" style={{ marginTop: 10 }}>
        Start on <b>Home</b> — name a new tender or open a saved one — then the same
        screen shows these four options as cards.
      </p>

      <h3 className="help-h3">The one rule that matters most</h3>
      <Callout tone="gold" title="The DSR rate database is never changed">
        If a rate you need genuinely differs from the book, don't edit the database —
        use the <b>rate override</b> on that one line instead (Schedule page). The book
        rate stays visible next to it, and every override is flagged everywhere it
        appears: on screen, in the exported Excel, and in the PDF. This keeps the
        database trustworthy for every tender that uses it.
      </Callout>
    </>
  );
}

function SessionsHelp() {
  return (
    <>
      <p className="help-lede">
        A <b>Session</b> is one tender. It holds your Schedule, your Bill, and a copy of
        every file you've exported or imported for it. The app saves as you type —
        there is no Save button.
      </p>

      <h3 className="help-h3">What's inside a session</h3>
      <div className="session-box">
        <div className="session-box-title">🗂️ “Ward-5 Road, 1st RA Bill”</div>
        <div className="session-box-grid">
          <div className="session-box-item">📋 Schedule state</div>
          <div className="session-box-item">🧾 Bill state (Schedule / RE / Abstract / Cement)</div>
          <div className="session-box-item">⬇ Exported files (Excel / PDF / zip)</div>
          <div className="session-box-item">⬆ Imported files</div>
        </div>
      </div>

      <h3 className="help-h3">What you can do on the Sessions page</h3>
      <StepList
        items={[
          { title: 'Start a new session', desc: 'give it a clear name — a name is required, nothing is created until you type one' },
          { title: 'Open a previous session', desc: 'switches the whole app to that tender instantly' },
          { title: 'Rename', desc: 'change a tender’s name any time' },
          { title: 'Export', desc: 'saves the whole tender as one portable .dbill file — use this to back up or move it to another computer' },
          { title: 'Import session', desc: 'opens a .dbill file as a brand-new tender — it never overwrites an existing one' },
          { title: 'Delete', desc: 'permanently removes a tender and its files — cannot be undone' },
        ]}
      />

      <Callout tone="blue" title="Some screens need an active session">
        <b>DSR → Schedule</b> and <b>Schedule → Bill</b> work inside a tender, so
        you'll be asked to create or open a session first if none is active.{' '}
        <b>Excel → PDF</b> and the <b>Sessions</b> page itself don't need one.
      </Callout>

      <p className="hint">
        Your data stays on this computer only. The exact folder is shown at the bottom
        of the Sessions page.
      </p>
    </>
  );
}

function ScheduleHelp() {
  return (
    <>
      <p className="help-lede">
        Builds the <b>Schedule of Work</b> — the priced list of items for your tender —
        from the DSR 2023 database.
      </p>

      <h3 className="help-h3">The flow</h3>
      <StepList
        items={[
          { title: 'Fill in the project details', desc: 'name of work, sub-head, etc.' },
          { title: 'Set item counts and click "Create rows"', desc: 'blank rows appear for DSR items and market items' },
          { title: 'Pick each DSR item', desc: 'type a code or keyword — description, unit and rate autofill from the database' },
          { title: 'Enter quantities', desc: 'the live preview on the right updates as you type' },
          { title: 'Set the multiplying factor and cost index %', desc: 'applied to DSR items only — market items are added at par' },
          { title: 'Export Excel / PDF, or Send to Bill →', desc: 'carries these items straight into the Bill builder' },
        ]}
      />

      <h3 className="help-h3">Import from a scanned PDF (OCR)</h3>
      <p>
        Already have a printed or scanned <b>Schedule of Work</b>? Click{' '}
        <b>⤓ Import from PDF</b> at the top. The app reads each page, pulls out the
        DSR codes and quantities, and matches every code against the database — so you
        can rebuild a schedule from an old bill in seconds instead of retyping it.
      </p>
      <StepList
        items={[
          { title: 'Choose the PDF and a recognition engine', desc: 'High accuracy (PaddleOCR, open-source) suits most scans; Built-in (Tesseract) is lighter; AI Vision is for handwriting once a local model server is set up' },
          { title: 'Watch it recognise each page', desc: 'a progress bar covers rendering, reading text, then matching to the DSR database' },
          { title: 'Review every row', desc: 'green “Matched” rows are confident; amber rows need a look — click the page number to see the original scan' },
          { title: 'Fix anything the scan got wrong', desc: 'edit the code, quantity or description inline; ambiguous codes offer a dropdown of the likely options' },
          { title: 'Add to schedule', desc: 'the selected rows drop straight into the item list, and a factor / cost index detected on the sheet is filled in for you' },
        ]}
      />
      <Callout tone="blue" title="Always cross-check before adding">
        OCR is a big time-saver but not perfect — especially on faint or skewed scans.
        Amber rows, and any quantity that looks off, should be checked against the page
        (use the page-number link) before you add them. Every field stays editable.
      </Callout>

      <h3 className="help-h3">Import from JSON (vision AI)</h3>
      <p>
        Already ran a scanned or digital Schedule of Work through your own vision AI
        model (Claude, GPT-4V, Gemini…)? Click <b>{'{ }'} Import from JSON</b> at the
        top and paste its output straight in — no file upload, no on-device OCR.
      </p>
      <StepList
        items={[
          { title: 'Copy the built-in prompt', desc: 'expand “Prompt to generate this JSON…” in the modal and give it to your vision model together with the PDF/images' },
          { title: 'Paste the JSON it returns', desc: 'the exact shape the prompt asks for — standard_items (type "DSR") and special_items (type "MKT" or "Appd.")' },
          { title: 'Click “Parse JSON”', desc: 'DSR items are matched against the database the same way OCR import does; Appd./MKT items keep the description, unit and rate straight from the JSON, since those aren’t in any book' },
          { title: 'Review every row', desc: 'green “Matched” rows are confident; amber rows were guessed by description (no code) or ambiguous — fix the code or pick from the dropdown' },
          { title: 'Add to schedule', desc: 'rows are added in the JSON’s own s_no order, so the schedule comes out in the same sequence as the source document' },
        ]}
      />
      <p className="hint">
        Works alongside <b>Import from PDF</b> — use whichever is easier to get a JSON
        reading of your sheet from; both land in the same review table before anything
        touches the schedule.
      </p>

      <h3 className="help-h3">Item types</h3>
      <Legend
        items={[
          { color: '#e8f3e8', border: '#2e6b34', label: 'DSR', desc: 'looked up from the database, description/unit/rate are read-only' },
          { color: '#eef2ee', border: '#9ca3af', label: 'Appd. / NS', desc: 'not in the book — rate entered by hand, still inside the factored total' },
          { color: '#eef6ff', border: '#0b6bcb', label: 'MKT', desc: 'market-rate items, added at par (no factor or cost index)' },
        ]}
      />
      <p className="hint">
        Carriage items (code 1.1.x etc.) have a rate per lead distance — pick the lead
        from the dropdown rather than typing one rate.
      </p>

      <h3 className="help-h3">Rate override</h3>
      <div className="override-demo">
        <span className="override-demo-chip">₹ 2,571.05 ✎</span>
        <span className="override-demo-note">⚠ book rate ₹ 2,102.25</span>
      </div>
      <p>
        Click the ✎ next to any DSR rate to override it for this tender only. The book
        rate stays visible, and the deviation is flagged on screen, in the exported
        Excel (highlighted cell + footnote) and in the PDF (asterisk + footnote) — see
        the golden rule on the Overview tab.
      </p>

      <h3 className="help-h3">How the total is calculated</h3>
      <ChainDiagram steps={['Σ (qty × rate)', '× factor', '+ cost index %', 'Corrected DSR Total', '+ MKT (at par)', 'Grand Total', 'Say (rounded)']} />
    </>
  );
}

function BillHelp() {
  return (
    <>
      <p className="help-lede">
        Turns a Schedule into a full <b>RA Bill</b> — four linked sheets that update
        each other live. Arrives here automatically via "Send to Bill →" from the
        DSR → Schedule page.
      </p>

      <MiniGrid
        items={[
          {
            icon: '📋', title: 'Schedule', desc: 'The priced item list — same as the Schedule page.',
            bullets: ['Arrives from DSR → Schedule via "Send to Bill →"', 'Editing a rate here flows into RE and Abstract'],
          },
          {
            icon: '📐', title: 'RE — Measurements', desc: 'Record actual measurements against each item.',
            bullets: [
              'Qty = Nos × Factor × Length × Width × Height (blanks count as 1)',
              'A negative "Nos" makes a "less" deduction row',
              'One measurement block per item — one A4 page each when exported',
              'Signature line (A.E. / J.E. / Cont.) sits below the table, not inside it',
            ],
          },
          {
            icon: '🧮', title: 'Abstract', desc: 'Measured quantity × Schedule rate = amount, for every item.',
            bullets: [
              'Quantity comes from RE (for DSR/Appd.) or the Schedule (for MKT/Recovery, at par)',
              'Runs the same factor + cost-index chain as the Schedule',
              'Ends with the quoted rate % (e.g. 18.50% below) → Gross Amount Payable',
            ],
          },
          {
            icon: '🧱', title: 'Cement', desc: 'Cement consumption statement for the bill.',
            bullets: [
              '"Fetch" mode: coefficient looked up automatically from the DSR Vol-2 appendix by item code',
              '"Manual" mode: an independent statement you fill in yourself',
              '1 Quintal = 100 kg = 2 bags of 50 kg',
            ],
          },
        ]}
      />

      <h3 className="help-h3">Item categories in the Bill</h3>
      <Legend
        items={[
          { color: '#e8f3e8', border: '#2e6b34', label: 'DSR / Appd.', desc: 'main items — factored, measured in RE' },
          { color: '#eef6ff', border: '#0b6bcb', label: 'MKT', desc: 'added at par (no factor / cost index) — still measured in RE' },
          { color: '#fef3f2', border: '#b91c1c', label: 'Recovery', desc: 'subtracted from the total — shown in red' },
        ]}
      />

      <h3 className="help-h3">Exporting</h3>
      <p>
        <b>⬇ Export Bill (.xlsx)</b> produces one workbook with all four sheets,
        cross-linked with live formulas — editing a measurement after export still
        recalculates the Abstract in Excel, because the links are real formulas, not
        fixed numbers.
      </p>
    </>
  );
}

function TopdfHelp() {
  return (
    <>
      <p className="help-lede">
        Converts any bill workbook — from this app or elsewhere — into clean,
        <b> black-&-white</b>, <b>A4-portrait</b> PDFs, one file per sheet, zipped
        together. No session is required, though a converted file is archived into the
        active session if one is open.
      </p>

      <FlowDiagram
        steps={[
          { icon: '⬆', title: 'Upload', desc: 'drag or choose an .xlsx file' },
          { icon: '☑', title: 'Pick sheets', desc: 'choose which worksheets to convert' },
          { icon: '⬇', title: 'Convert', desc: 'downloads a .zip of one PDF per sheet' },
        ]}
      />

      <h3 className="help-h3">What it does under the hood</h3>
      <StepList
        items={[
          { title: 'Drops all colour', desc: 'fills and shading become plain black text on white for clean printing' },
          { title: 'Scales every column to fit', desc: 'the page width is shared out so nothing is ever cut off — text wraps instead' },
          { title: 'Repeats headers on page breaks', desc: 'a long sheet keeps its column headings on every new page' },
          { title: 'One Record Entry per page', desc: 'for RE-style sheets, each measurement block starts a fresh A4 page, with the signature line kept outside the table — matching the Excel layout' },
          { title: 'Computes any missing totals', desc: 'even a fresh export with unopened formulas still shows correct numbers' },
        ]}
      />
    </>
  );
}

function Tips() {
  return (
    <>
      <h3 className="help-h3">Frequently asked</h3>
      <div className="faq-list">
        <div className="faq-item">
          <div className="faq-q">I closed the app without saving — did I lose my work?</div>
          <div className="faq-a">No. Everything autosaves as you type. Reopen the app and open the same session — it's exactly as you left it.</div>
        </div>
        <div className="faq-item">
          <div className="faq-q">How do I move a tender to another computer?</div>
          <div className="faq-a">Sessions → <b>Export</b> gives you a single <code>.dbill</code> file. On the other computer, Sessions → <b>Import session</b> → pick that file.</div>
        </div>
        <div className="faq-item">
          <div className="faq-q">Can two people work on the same tender at once?</div>
          <div className="faq-a">Not at the same time — but you can hand it over as a <code>.dbill</code> file for the other person to import.</div>
        </div>
        <div className="faq-item">
          <div className="faq-q">I need an old Excel or PDF I exported earlier.</div>
          <div className="faq-a">Sessions → open that tender → the <b>Files</b> box lists every export with a Download button.</div>
        </div>
        <div className="faq-item">
          <div className="faq-q">A DSR rate looks wrong for my tender — can I fix it?</div>
          <div className="faq-a">Don't edit the database. Use the rate <b>override</b> on that line (Schedule page) — see the Overview tab for why.</div>
        </div>
        <div className="faq-item">
          <div className="faq-q">Can I build a schedule from a scanned or printed bill?</div>
          <div className="faq-a">Yes — on <b>DSR → Schedule</b>, click <b>⤓ Import from PDF</b>. It reads the pages, matches DSR codes and quantities, and lets you review and fix everything before adding. It works offline; nothing is uploaded. Always cross-check amber rows against the scan.</div>
        </div>
        <div className="faq-item">
          <div className="faq-q">The scan is handwritten — will OCR read it?</div>
          <div className="faq-a">Printed schedules read well. For handwriting, the <b>AI Vision</b> engine is the right tool, but it needs a local AI model server configured on the device first (a future setup step) — until then it's shown as “Setup required”.</div>
        </div>
        <div className="faq-item">
          <div className="faq-q">I already used ChatGPT/Claude/Gemini to read my schedule — can I skip OCR?</div>
          <div className="faq-a">Yes — on <b>DSR → Schedule</b>, click <b>{'{ }'} Import from JSON</b>. Copy the built-in prompt to your vision model of choice, paste the JSON it returns, and review the matched rows before adding. It never leaves your device beyond whatever tool you pasted the JSON from.</div>
        </div>
      </div>

      <h3 className="help-h3">Where is my data kept?</h3>
      <p>
        Everything stays on this computer — nothing is sent over the internet. The
        exact folder is shown at the bottom of the <b>Sessions</b> page. To back
        everything up, copy that folder, or export each tender as a{' '}
        <code>.dbill</code> file to a pen-drive.
      </p>
    </>
  );
}

export default function HelpPage() {
  const [tab, setTab] = useState('overview');
  return (
    <div className="page">
      <div className="page-pad">
      <div className="page-head">
        <h1>Help</h1>
        <p className="page-sub">A visual guide to every part of DSR Bill Builder — what each screen does and how the pieces fit together.</p>
      </div>

      <div className="tabs">
        {TABS.map(([k, l]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      <section className="card help-card">
        {tab === 'overview' && <Overview />}
        {tab === 'sessions' && <SessionsHelp />}
        {tab === 'schedule' && <ScheduleHelp />}
        {tab === 'bill' && <BillHelp />}
        {tab === 'topdf' && <TopdfHelp />}
        {tab === 'tips' && <Tips />}
      </section>
      </div>
    </div>
  );
}
