import { RefreshIcon, CheckIcon, EditIcon, TrashIcon } from '../dbIcons.jsx';
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
  return (
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Delivery</p>
          <h2>Hello, {title} {clientName}</h2>
          {folder ? (
            <span className="dd-name-line">
              <span className="dd-folder-name">{folder}</span>
              <span className="dd-name-sep" aria-hidden="true">{'\u2022'}</span>
              <span
                className={`event-date-pill event-tone-${eventDateTone(currentDelivery?.event_date, jakartaTodayISO())} delivery-event-date-pill`}
                aria-label={`Event ${compactEventDateLabel(currentDelivery?.event_date)}`}
              >
                {compactEventDateLabel(currentDelivery?.event_date)}
              </span>
            </span>
          ) : (
            <span
              className={`event-date-pill event-tone-${eventDateTone(currentDelivery?.event_date, jakartaTodayISO())} delivery-event-date-pill`}
              aria-label={`Event ${compactEventDateLabel(currentDelivery?.event_date)}`}
            >
              {compactEventDateLabel(currentDelivery?.event_date)}
            </span>
          )}
        </div>
        <div className="dd-heading-side">
          <div className="detail-actions subs-detail-actions">
            <button
              type="button"
              className="toolbar-icon-btn"
              onClick={handleRefresh}
              disabled={refreshing || !currentDelivery?.id}
              aria-label="Refresh delivery detail"
              title="Refresh"
            >
              <RefreshIcon />
            </button>
            <button
              type="button"
              className={`toolbar-icon-btn delivery-done-button${deliveryDone ? ' is-complete' : ''}`}
              onClick={handleToggleDone}
              disabled={markingDone || !currentDelivery?.id}
              aria-pressed={deliveryDone}
              aria-label={deliveryDone ? 'Reopen delivery' : 'Mark delivery done'}
              title={deliveryDone ? 'Done \u2014 click to reopen' : 'Mark Done'}
            >
              <CheckIcon />
            </button>
            <button
              type="button"
              className="toolbar-icon-btn"
              onClick={() => setEditingLinks((value) => !value)}
              aria-pressed={editingLinks}
              aria-label="Edit links"
              title="Edit Links"
            >
              <EditIcon />
            </button>
            <button
              type="button"
              className={`ghost-button compact db-delete-button icon-button${confirmDelete ? ' armed' : ''}`}
              onClick={handleDeleteLinks}
              disabled={deleting || !currentDelivery?.id}
              aria-pressed={confirmDelete}
              aria-label={confirmDelete ? 'Confirm delete links' : 'Delete links'}
              title={confirmDelete ? 'Confirm Delete' : 'Delete'}
            >
              <TrashIcon />
              <span>{deleting ? 'Deleting\u2026' : (confirmDelete ? 'Confirm' : 'Delete')}</span>
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
      </div>
  );
}
