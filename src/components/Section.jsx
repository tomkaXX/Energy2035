import { useId, useState } from 'react';

/** Expandable section (accordion row): ▶/▼ toggle, coloured left bar, title and a short summary. */
export default function Section({ title, summary, color = 'var(--accent)', defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={`acc ${open ? 'open' : ''}`} style={{ '--acc': color }}>
      <button type="button" className="acc-h" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <span className="acc-caret" aria-hidden="true">{open ? '▼' : '▶'}</span>
        <span className="acc-title">{title}</span>
        {summary && <span className="acc-sum">{summary}</span>}
      </button>
      {open && <div className="acc-body" id={id}>{children}</div>}
    </div>
  );
}
