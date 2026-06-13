import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { jakartaTodayISO, buildClientRecords } from '../dbHelpers.js';
import { generateEventKey, createRecordUrl } from './clientEventHelpers.js';
import { ClientHeader } from './ClientHeader.jsx';
import { ClientDetailRows } from './ClientDetailRows.jsx';
import { ClientEventList } from './ClientEventList.jsx';

// Client detail/edit view for the /db Clients tab.
//
// This orchestrator owns the page-level state for the detail panel —
// the Create Events sheet (open flag + pending event key) and the
// two-tap event-row delete arming — and derives the client's event
// records from the linked deliveries/invoices. The heading, the
// contact/detail rows, and the event list + Create Events footer
// render in their own focused components. Logic and markup were
// extracted verbatim from DatabasePage.jsx so /db behaviour is
// unchanged.
export function ClientDetail({ client, invoices, deliveries, onDeleteClient, onEditClient, onDeleteRecord, onViewLinks, onRefresh, onClose }) {
  const todayIso = useMemo(() => jakartaTodayISO(), []);
  const records = buildClientRecords(client, invoices, deliveries, todayIso);
  const title = client?.title ?? 'Ms.';
  const name = client?.name || client?.client_name || 'Client';
  const contact = client?.contact || client?.client_contact || '';

  // Create Events sheet. The big bottom "Create Events" pill from
  // earlier revisions is gone; pressing the (now compact) Create
  // Events trigger opens an inline sheet with two choices —
  // "Create Links" and "Create Invoice" — that share a single
  // freshly-generated event_key. Whichever side the operator
  // saves first stamps that event_key on its row, and the other
  // side groups onto the same /db row when it saves later.
  // Closing the sheet (cancel, or after picking an option)
  // discards the pending key so the next open starts a brand-new
  // event with its own grouping anchor.
  //
  // Event date is intentionally NOT defaulted here. /inv falls
  // through to an empty <input type="date"> when no eventDate
  // param is sent, /l keeps eventDateHandoff='' until the operator
  // types a folder, and the saved row carries event_date=''. Both
  // surfaces then read as "TBA" until the operator updates the
  // row. The spec is explicit that an unknown event date stays
  // TBA and never silently becomes today.
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingEventKey, setPendingEventKey] = useState('');
  const openCreateSheet = () => {
    setPendingEventKey(generateEventKey());
    setCreateOpen(true);
  };
  const closeCreateSheet = () => {
    setCreateOpen(false);
    setPendingEventKey('');
  };
  // Two-tap (arm → confirm) delete for the per-event row X. The X
  // is a small target that used to delete on a single tap — risky
  // on touch (easy to hit while reaching for the action pills). Now
  // the first tap only ARMS that row (the X repaints with a red
  // danger frame) and starts a ~3s auto-disarm timer; a second tap
  // on the SAME armed X performs the real delete. Tapping a
  // different row's X arms it and disarms the previous one (the
  // parent owns the armed id, so only one row can be armed at a
  // time). No modal / confirm() — the confirm affordance is the
  // inline armed X itself.
  const [armedDeleteKey, setArmedDeleteKey] = useState(null);
  const armedDeleteTimerRef = useRef(null);
  const clearArmedDeleteTimer = useCallback(() => {
    if (armedDeleteTimerRef.current) {
      clearTimeout(armedDeleteTimerRef.current);
      armedDeleteTimerRef.current = null;
    }
  }, []);
  const handleEventDelete = useCallback((key, row) => {
    if (!key) return;
    // Second tap on the already-armed row → delete for real.
    if (armedDeleteKey === key) {
      clearArmedDeleteTimer();
      setArmedDeleteKey(null);
      onDeleteRecord?.(row);
      return;
    }
    // First tap (or switching to a different row) → arm this row
    // and (re)start the auto-disarm timer so an accidental first
    // tap quietly resets after ~3s instead of lingering as a live
    // delete.
    clearArmedDeleteTimer();
    setArmedDeleteKey(key);
    armedDeleteTimerRef.current = setTimeout(() => {
      armedDeleteTimerRef.current = null;
      setArmedDeleteKey(null);
    }, 3000);
  }, [armedDeleteKey, clearArmedDeleteTimer, onDeleteRecord]);
  // Stable signature of the current event rows. Used only to detect
  // when the event list itself changes (a row added/removed) so we
  // can drop any armed-delete state that may now point at a row
  // that no longer exists. Mirrors the recordKey logic in the
  // event list so the two always agree.
  const recordsSignature = useMemo(
    () => records
      .map((row, index) => row.delivery?.id || row.invoice?.id || row.vendorDelivery?.id || row.vendorInvoice?.id || `${row.date}-${index}`)
      .join('|'),
    [records],
  );
  // Reset the armed delete whenever the selected client changes or
  // the event list changes. The unmount cleanup below additionally
  // covers the detail panel closing entirely.
  const clientIdentity = String(client?.client_id || client?.id || '');
  useEffect(() => {
    clearArmedDeleteTimer();
    setArmedDeleteKey(null);
  }, [clientIdentity, recordsSignature, clearArmedDeleteTimer]);
  useEffect(() => () => clearArmedDeleteTimer(), [clearArmedDeleteTimer]);
  // Thread the parent client's stable id into both Create Events
  // hand-offs. /l + /inv forward it on the API save body so the
  // worker attaches the new delivery / invoice to THIS exact
  // clients row rather than name+contact-matching its way to a
  // (possibly duplicate) sibling. Empty for legacy buckets — the
  // server keeps its name/contact fallback for those rows. Sits
  // alongside eventKey, which still controls per-event grouping.
  const parentClientId = String(client?.client_id || '').trim();
  const newEventLinkHref = createRecordUrl('/l/', {
    title,
    name,
    contact,
    eventKey: pendingEventKey,
    clientId: parentClientId,
  });
  const newEventInvoiceHref = createRecordUrl('/inv/', {
    title,
    name,
    contact,
    eventKey: pendingEventKey,
    clientId: parentClientId,
  });

  return (
    <>
      <ClientHeader
        name={name}
        onRefresh={onRefresh}
        onEdit={() => onEditClient?.(client)}
        onDelete={() => onDeleteClient?.(client)}
        onClose={onClose}
      >
        <ClientDetailRows contact={contact} />
      </ClientHeader>
      <ClientEventList
        records={records}
        title={title}
        name={name}
        contact={contact}
        parentClientId={parentClientId}
        newEventLinkHref={newEventLinkHref}
        newEventInvoiceHref={newEventInvoiceHref}
        todayIso={todayIso}
        armedDeleteKey={armedDeleteKey}
        onEventDelete={handleEventDelete}
        onViewLinks={onViewLinks}
        createOpen={createOpen}
        onOpenCreate={openCreateSheet}
        onCloseCreate={closeCreateSheet}
      />
    </>
  );
}
