import { ClientEventRow } from './ClientEventRow.jsx';
import { clientEventRecordKey } from './clientEventHelpers.js';

// Event list for the /db Clients detail: the record-stack of per-event
// rows (each rendered by ClientEventRow) plus the empty state, followed
// by the inline "Create Events" footer (the New Event sheet with its
// Create Links / Create Invoice choices, or the compact trigger button
// when the sheet is closed).
//
// Extracted verbatim from ClientDetail. All state (the armed-delete id,
// the create-sheet open flag, the freshly-generated pending event key
// that drives the New Event hrefs) lives in the parent; this component
// only renders rows and forwards clicks so behaviour is unchanged.
export function ClientEventList({
  records,
  title,
  name,
  contact,
  parentClientId,
  newEventLinkHref,
  newEventInvoiceHref,
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
            <a
              className="ghost-button compact"
              href={newEventLinkHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onCloseCreate}
            >
              Create Links
            </a>
            <a
              className="ghost-button compact"
              href={newEventInvoiceHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onCloseCreate}
            >
              Create Invoice
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
