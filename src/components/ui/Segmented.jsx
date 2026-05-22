/**
 * Segmented
 *
 * Right-aligned pill control used inside the PrivateWorkspaceFrame header
 * for contextual page modes (e.g. /db: Clients/Subs/Invoices,
 * /inv: Invoice/Deposit/Paid).
 *
 * Renders the existing .segmented styles defined in invcs.css.
 */
export function Segmented({ value, onChange, options, ariaLabel }) {
  return (
    <div className="segmented" role="tablist" aria-label={ariaLabel}>
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
