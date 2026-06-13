import { RefreshIcon, EditIcon } from '../dbIcons.jsx';

// Client detail heading: eyebrow, client name, the contact/detail
// rows slot (rendered as children — see ClientDetailRows), and the
// toolbar action row (Refresh / Edit / Delete Client / Close).
//
// Extracted verbatim from the inline ClientDetail markup in
// DatabasePage.jsx. All state lives in the parent; the header only
// renders and forwards clicks so behaviour is unchanged.
export function ClientHeader({ name, onRefresh, onEdit, onDelete, onClose, children }) {
  return (
    <div className="detail-heading">
      <div>
        <p className="eyebrow">Client</p>
        <h2>{name}</h2>
        {children}
      </div>
      <div className="detail-actions">
        <button
          type="button"
          className="toolbar-icon-btn"
          onClick={onRefresh}
          aria-label="Refresh client detail"
          title="Refresh"
        >
          <RefreshIcon />
        </button>
        <button
          type="button"
          className="toolbar-icon-btn"
          onClick={onEdit}
          aria-label="Edit client"
          title="Edit"
        >
          <EditIcon />
        </button>
        <button
          type="button"
          className="ghost-button compact db-delete-button"
          onClick={onDelete}
        >
          Delete Client
        </button>
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
