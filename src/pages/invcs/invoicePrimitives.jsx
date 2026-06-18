// Pure leaf presentational primitives for the Invoice Composer.
//
// These were extracted verbatim from InvoiceComposer.jsx (Pass 51).
// They carry no state, hooks, or side effects — each renders fixed
// markup driven only by its props, so the composer and its panels can
// import them without behavior changes. Markup and class names are
// unchanged; icons pick up `currentColor` so the parent button's
// palette flows through.

// Diskette glyph for the Save / Update Status action (icon-only).
// It pulses while a save is in flight, keeping the action
// semantically "save" instead of looking like refresh.
export function SaveIcon({ saving = false }) {
  return (
    <svg
      className={`btn-icon${saving ? ' is-saving' : ''}`}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 3h12l2 2v16H5z" />
      <path d="M8 3v6h8V3" />
      <path d="M8 21v-7h8v7" />
      <path d="M14 6h1" />
    </svg>
  );
}

// Printer glyph for the Generate JPG action (icon-only). Mirrors the
// /db Subs PrintIcon so "print/export" reads identically across the
// app.
export function PrinterIcon() {
  return (
    <svg
      className="btn-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

export function Fieldset({ title, children }) {
  return <section className="form-section"><h2>{title}</h2>{children}</section>;
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

export function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}
