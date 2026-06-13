import { RefreshIcon, PlusIcon, EditIcon, PrintIcon, TrashIcon } from '../dbIcons.jsx';

// Subscription detail heading: eyebrow, composed name, status/tone +
// service/period pills, contact line, and the toolbar action row
// (Refresh / Add Extension / Edit / Print / Delete / Expire / Close).
//
// Extracted verbatim from SubscriptionDetail. All state (confirmDelete
// arming, extension form open, the latest-extension edit target)
// stays in the parent; the header only renders and forwards clicks so
// behaviour is unchanged.
//
//   onEditCurrent — edits the CURRENT/active period (latest extension
//                   when present, otherwise the base subscription);
//                   the parent owns that decision.
//   editLabel     — matching aria-label/title for the Edit button.
export function SubscriptionHeader({
  headingName,
  tone,
  toneLabel,
  headingPills,
  contact,
  hasId,
  showAddExtension,
  onAddExtension,
  onRefresh,
  onEditCurrent,
  editLabel,
  onPrint,
  confirmDelete,
  onDelete,
  showExpire,
  onExpire,
  onClose,
}) {
  return (
    <div className="detail-heading">
      <div>
        <p className="eyebrow">Subscription</p>
        <h2>{headingName}</h2>
        {(tone && toneLabel) || headingPills.length ? (
          <div className="sub-meta-pills">
            {tone && toneLabel ? (
              <span className={`sub-pill sub-pill-${tone}`}>{toneLabel}</span>
            ) : null}
            {headingPills.map((label) => (
              <span className="sub-pill" key={label}>{label}</span>
            ))}
          </div>
        ) : null}
        {contact ? <span>{contact}</span> : null}
      </div>
      <div className="detail-actions subs-detail-actions">
        <button
          type="button"
          className="toolbar-icon-btn"
          onClick={onRefresh}
          aria-label="Refresh subscription detail"
          title="Refresh"
        >
          <RefreshIcon />
        </button>
        {showAddExtension ? (
          <button
            type="button"
            className="toolbar-icon-btn"
            onClick={onAddExtension}
            aria-label="Add extension"
            title="Add Extension"
          >
            <PlusIcon />
          </button>
        ) : null}
        {/* The top card always renders the CURRENT/active period
            (base + latest extension), so its Edit button edits
            whatever is shown up top: the latest extension when one
            exists — so a bonus/date/price/status change lands on the
            ongoing period and the card + expiry update in lockstep —
            otherwise the base subscription. The base stays editable
            via its own Edit button on the "Initial" row below. */}
        {hasId ? (
          <button
            type="button"
            className="toolbar-icon-btn"
            onClick={onEditCurrent}
            aria-label={editLabel}
            title="Edit"
          >
            <EditIcon />
          </button>
        ) : null}
        {hasId ? (
          <button
            type="button"
            className="toolbar-icon-btn"
            onClick={onPrint}
            aria-label="Print subscription"
            title="Print"
          >
            <PrintIcon />
          </button>
        ) : null}
        {hasId ? (
          <button
            type="button"
            className={`toolbar-icon-btn toolbar-icon-btn--danger${confirmDelete ? ' armed' : ''}`}
            onClick={onDelete}
            aria-pressed={confirmDelete}
            aria-label={confirmDelete ? 'Confirm delete subscription' : 'Delete subscription'}
            title={confirmDelete ? 'Confirm Delete' : 'Delete'}
          >
            <TrashIcon />
          </button>
        ) : null}
        {showExpire ? (
          <button
            type="button"
            className="toolbar-icon-btn toolbar-icon-btn--danger"
            onClick={onExpire}
            aria-label="Expire subscription now"
            title="Expire Now"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="6" x2="12" y2="12" />
              <line x1="12" y1="12" x2="16" y2="14" />
            </svg>
          </button>
        ) : null}
        <button
          type="button"
          className="db-close-button"
          onClick={onClose}
          aria-label="Close detail view"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
