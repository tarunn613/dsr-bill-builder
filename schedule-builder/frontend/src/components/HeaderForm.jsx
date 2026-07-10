import React from 'react';

const FIELDS = [
  ['organization', 'Organization', 'DELHI URBAN SHELTER IMPROVEMENT BOARD, GNCTD'],
  ['office', 'Office', 'OFFICE OF THE EXECUTIVE ENGINEER C-4'],
  ['division', 'Division / Sub-division', ''],
  ['subHead', 'Sub Head', 'Reboring of tube well bore at …'],
  ['nameOfWork', 'Name of Work', ''],
];

export default function HeaderForm({ header, setHeader }) {
  return (
    <section className="card">
      <div className="card-head"><h2>Project / Tender Details</h2></div>
      <div className="header-grid">
        {FIELDS.map(([key, label, ph]) => (
          <label key={key} className={'field' + (key === 'subHead' || key === 'nameOfWork' ? ' wide' : '')}>
            <span>{label}</span>
            {key === 'subHead' || key === 'nameOfWork' ? (
              <textarea rows={2} value={header[key] || ''} placeholder={ph}
                onChange={(e) => setHeader({ ...header, [key]: e.target.value })} />
            ) : (
              <input value={header[key] || ''} placeholder={ph}
                onChange={(e) => setHeader({ ...header, [key]: e.target.value })} />
            )}
          </label>
        ))}
      </div>
    </section>
  );
}
