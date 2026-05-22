/**
 * Segmented
 *
 * Right-aligned pill control used inside the PrivateWorkspaceFrame header
 * for contextual page modes (e.g. /db: Clients/Subs/Invoices,
 * /inv: Invoice/Deposit/Paid).
 *
 * Renders the isolated .pf-pillset styles defined in
 * PrivateWorkspaceFrame.css (deliberately not .segmented so it does
 * not collide with legacy /inv .segmented / .mode-switch rules).
 */
export function Segmented({ value, onChange, options, ariaLabel }) {
  return (
    <div className="pf-pillset" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? 'active' : ''}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
