import { ClientEventRow } from './ClientEventRow.jsx';
import { clientEventRecordKey } from './clientEventHelpers.js';

export function ClientEventList({
  records = [],
  title,
  name,
  contact,
  parentClientId,
  newEventLinkHref,
  newEventInvoiceHref,
  newEventVendorLinkHref,
  newEventVendorInvoiceHref,
  todayIso,
  armedDeleteKey,
  onEventDelete,
  onViewLinks,
  createOpen,
  onOpenCreate,
  onCloseCreate,
}) {
  return (
    <div className="client-events-section">
      <div className="client-events-bar">
        <span className="client-events-label">
          Events{records.length ? ` · ${records.length}` : ''}
        </span>
        {!createOpen ? (
          <button
            className="client-new-event-link"
            type="button"
            onClick={onOpenCreate}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>New Event</span>
          </button>
        ) : null}
      </div>

      {createOpen ? (
        <div className="create-event-sheet client-create-sheet" role="group" aria-label="Create event">
          <div className="client-create-sheet-head">
            <p className="create-event-eyebrow">New Event</p>
            <button
              type="button"
              className="client-create-cancel-link"
              onClick={onCloseCreate}
            >
              Cancel
            </button>
          </div>
          <div className="create-event-choices">
            <a className="ghost-button compact" href={newEventLinkHref} target="_blank" rel="noopener noreferrer">
              Create Client Links
            </a>
            <a className="ghost-button compact" href={newEventInvoiceHref} target="_blank" rel="noopener noreferrer">
              Create Client Invoice
            </a>
            <a className="ghost-button compact" href={newEventVendorLinkHref} target="_blank" rel="noopener noreferrer">
              Create Vendor Links
            </a>
            <a className="ghost-button compact" href={newEventVendorInvoiceHref} target="_blank" rel="noopener noreferrer">
              Create Vendor Invoice
            </a>
          </div>
        </div>
      ) : null}

      <div className="record-stack client-record-stack">
        {records.map((row, index) => (
          <ClientEventRow
            key={clientEventRecordKey(row, index)}
            row={row}
            index={index}
            title={title}
            name={name}
            contact={contact}
            parentClientId={parentClientId}
            newEventLinkHref={newEventLinkHref}
            todayIso={todayIso}
            armedDeleteKey={armedDeleteKey}
            onEventDelete={onEventDelete}
            onViewLinks={onViewLinks}
          />
        ))}
        {!records.length ? <p className="empty-state">No events yet.</p> : null}
      </div>
    </div>
  );
}
