import { useEffect, useRef, useState } from 'react';
import { RefreshIcon, CheckIcon, EditIcon } from '../dbIcons.jsx';
import { eventDateTone, jakartaTodayISO, compactEventDateLabel } from '../dbHelpers.js';

export function DeliveryHeader({
  title,
  clientName,
  folder,
  currentDelivery,
  deliveryDone,
  handleRefresh,
  refreshing,
  handleToggleDone,
  markingDone,
  editingLinks,
  setEditingLinks,
  handleDeleteLinks,
  confirmDelete,
  deleting,
  onClose,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const handleOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutside);
    return () => document.removeEventListener('pointerdown', handleOutside);
  }, [menuOpen]);

  const dateTone = eventDateTone(currentDelivery?.event_date, jakartaTodayISO());
  const dateLabel = compactEventDateLabel(currentDelivery?.event_date);

  return (
    <div className="detail-heading delivery-detail-heading">
      <div className="delivery-detail-identity">
        <p className="eyebrow">Delivery</p>
        <h2>Hello, {title} {clientName}</h2>
        <div className="dd-name-line">
          {folder ? <span className="dd-folder-name">{folder}</span> : null}
          <span
            className={`event-date-pill event-tone-${dateTone} delivery-event-date-pill`}
            aria-label={`Event ${dateLabel}`}
          >
            {dateLabel}
          </span>
        </div>
      </div>
      <div className="detail-actions delivery-detail-actions" ref={menuRef}>
        <button
          type="button"
          className="toolbar-icon-btn client-quiet-icon"
          onClick={handleRefresh}
          disabled={refreshing || !currentDelivery?.id}
          aria-label="Refresh delivery detail"
          title="Refresh"
        >
          <RefreshIcon />
        </button>
        <button
          type="button"
          className={`toolbar-icon-btn client-quiet-icon delivery-done-button${deliveryDone ? ' is-complete' : ''}`}
          onClick={handleToggleDone}
          disabled={markingDone || !currentDelivery?.id}
          aria-pressed={deliveryDone}
          aria-label={deliveryDone ? 'Reopen delivery' : 'Mark delivery done'}
          title={deliveryDone ? 'Done — click to reopen' : 'Mark Done'}
        >
          <CheckIcon />
        </button>
        <button
          type="button"
          className="toolbar-icon-btn client-quiet-icon"
          onClick={() => setEditingLinks((value) => !value)}
          aria-pressed={editingLinks}
          aria-label="Edit links"
          title="Edit Links"
        >
          <EditIcon />
        </button>
        <button
          type="button"
          className="toolbar-icon-btn client-quiet-icon"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-label="More delivery actions"
          title="More"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="1.2" />
            <circle cx="19" cy="12" r="1.2" />
            <circle cx="5" cy="12" r="1.2" />
          </svg>
        </button>
        <button
          type="button"
          className="db-close-button"
          onClick={onClose}
          aria-label="Close detail view"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        {menuOpen ? (
          <div className="client-overflow-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="client-overflow-item is-danger"
              disabled={deleting || !currentDelivery?.id}
              onClick={handleDeleteLinks}
            >
              {deleting ? 'Deleting…' : (confirmDelete ? 'Confirm Delete' : 'Delete Delivery')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
