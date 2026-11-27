// Pure leaf presentational primitives for the /l Link Generator.
//
// These were extracted verbatim from LinkGeneratorPage.jsx (Pass 68).
// They carry no state, hooks, or side effects — each renders fixed
// markup driven only by its props, so the page can import them without
// behaviour changes. Markup and class names are unchanged; the icon
// picks up `currentColor` so the parent button's palette flows through.

export function ServiceField({ chip, label, value, placeholder, onChange, hint = '' }) {
  return (
    <label className="lg-service">
      <span className="lg-service-head">
        <span className="lg-service-chip">{chip}</span>
        <span className="lg-service-name">{label}</span>
        {hint ? <span className="lg-service-hint">{hint}</span> : null}
      </span>
      <input
        type="url"
        inputMode="url"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        spellCheck="false"
        autoCapitalize="off"
        autoComplete="off"
      />
    </label>
  );
}
