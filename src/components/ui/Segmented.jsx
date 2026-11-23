import './Segmented.css';

/**
 * Segmented
 *
 * Shared squircle segmented control with a smooth sliding thumb driven by
 * --pill-count and --pill-index. Used in /db (Clients | Activity) and
 * /inv (Details | Payments, Draft | Deposit | Paid).
 */
export function Segmented({ value, onChange, options, ariaLabel }) {
  const list = Array.isArray(options) ? options : [];
  const activeIndex = Math.max(0, list.findIndex((option) => option.value === value));

  return (
    <div
      className="pf-pillset"
      role="tablist"
      aria-label={ariaLabel}
      style={{ '--pill-count': Math.max(1, list.length), '--pill-index': activeIndex }}
    >
      <span className="pf-pillset-thumb" aria-hidden="true" />
      {list.map((option) => {
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
