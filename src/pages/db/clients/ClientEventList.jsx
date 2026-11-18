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
    <>
      <div className="record-stack">
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
      {createOpen ? (
        <div className="create-event-sheet" role="group" aria-label="Create event">
          <p className="create-event-eyebrow">New Event</p>
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
          <button
            type="button"
            className="ghost-button compact create-event-cancel"
            onClick={onCloseCreate}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          className="ghost-button compact create-event-trigger"
          type="button"
          onClick={onOpenCreate}
        >
          Create Events
        </button>
      )}
    </>
  );
}
