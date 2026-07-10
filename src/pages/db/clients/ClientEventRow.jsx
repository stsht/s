import { eventDateTone } from '../dbHelpers.js';
import { RecordRow } from '../RecordRow.jsx';
import {
  createRecordUrl,
  dbg,
  stripVendorName,
  clientEventRecordKey,
} from './clientEventHelpers.js';

// A single event row inside the Clients detail. Owns the per-event
// link/grouping/href computation that previously lived inline in the
// ClientDetail records.map() loop, then hands the presentational row
// (date+price meta, compact Links + Invoice pills, vendor add-ons,
// and the two-tap delete X) off to the shared RecordRow component.
//
// The arm/disarm bookkeeping for the delete X (single-armed-row rule
// + auto-disarm timeout) stays in the ClientDetail parent — this row
// only reflects `armedDeleteKey` and forwards each press through
// onEventDelete. Logic and markup were extracted verbatim so /db
// Clients behaviour is unchanged.
export function ClientEventRow({
  row,
  index,
  title,
  name,
  contact,
  parentClientId,
  newEventLinkHref,
  todayIso,
  armedDeleteKey,
  onEventDelete,
  onViewLinks,
}) {
  // Stable per-event grouping key. Priority:
  //   1. row.eventKey (already populated by buildClientRecords
  //      when any record on the row carried event_key).
  //   2. delivery.id (the delivery acts as the cross-ref
  //      anchor — when /inv saves it stores delivery.id as
  //      its event_key, and on re-render they group).
  //   3. invoice.id (same idea for invoice-anchored rows).
  // The Create Events sheet always passes a fresh UUID so brand-new
  // events never collide with these anchor IDs.
  const rowEventKey = row.eventKey || row.delivery?.id || row.invoice?.id || row.vendorDelivery?.id || row.vendorInvoice?.id || '';
  const eventLinkHref = row.delivery?.id
    ? row.delivery.short_url || row.delivery.delivery_url || newEventLinkHref
    : createRecordUrl('/l/', {
        title: row.title || title,
        name: row.name || name,
        contact,
        eventDate: row.eventDate,
        eventKey: rowEventKey,
        // Forward the row's existing invoice id (when this
        // row is invoice-only). The /l worker reads it to
        // (a) patch the linked invoice's client_id when
        // missing, and (b) stamp invoice_data.delivery_id
        // for /db's cross-ref recovery when the new
        // delivery row's event_key column was stripped.
        invoiceId: row.invoice?.id || '',
        // Stable parent client id — keeps the new delivery
        // attached to THIS clients row instead of letting
        // the worker name/contact-match its way to a
        // duplicate sibling.
        clientId: parentClientId,
        folderName: row.delivery?.folder_name,
      });
  const eventInvoiceHref = row.invoice?.id
    ? createRecordUrl('/inv/', { invoiceId: row.invoice.id })
    : createRecordUrl('/inv/', {
        title: row.title || title,
        name: row.name || name,
        contact,
        eventDate: row.eventDate,
        eventKey: rowEventKey,
        clientId: parentClientId,
        folderName: row.delivery?.folder_name,
      });
  const eventVendorInvoiceHref = row.vendorInvoice?.id
    ? createRecordUrl('/inv/', { invoiceId: row.vendorInvoice.id, type: 'vendor' })
    : createRecordUrl('/inv/', {
        title: '',
        name: row.vendorName || stripVendorName(row.name || name),
        contact,
        eventDate: row.eventDate,
        eventKey: rowEventKey,
        clientId: parentClientId,
        type: 'vendor',
        folderName: row.delivery?.folder_name,
        items: (() => {
          try {
            const data = row.invoice?.invoice_data && typeof row.invoice.invoice_data === 'object' ? row.invoice.invoice_data : {};
            const itemsArr = Array.isArray(data.items) ? data.items : null;
            if (itemsArr && itemsArr.length) {
              return JSON.stringify(itemsArr.map((i) => ({ name: i.name, note: i.note, qty: i.qty })));
            }
          } catch {}
          return undefined;
        })(),
      });
  const hasVendorDelivery = !!row.vendorDelivery?.id;
  const eventVendorDeliveryHref = hasVendorDelivery
    ? row.vendorDelivery.short_url || row.vendorDelivery.delivery_url || newEventLinkHref
    : createRecordUrl('/l/', {
        title: '',
        name: row.vendorName || stripVendorName(row.name || name),
        contact,
        eventDate: row.eventDate,
        eventKey: rowEventKey,
        clientId: parentClientId,
        invoiceId: row.vendorInvoice?.id || '',
        type: 'vendor',
        folderName: row.delivery?.folder_name,
      });
  dbg('ClientDetail row', {
    recordKey: row.delivery?.id || row.invoice?.id || `${row.date}-${index}`,
    rowEventKey,
    rowEventDate: row.eventDate,
    hasDelivery: !!row.delivery?.id,
    hasInvoice: !!row.invoice?.id,
    eventLinkHref,
    eventInvoiceHref,
  });
  // A row's stable identity is delivery.id ?? invoice.id ?? date —
  // we use it to drive both the React key and the mobile "armed"
  // state (parent owns the armed-id so only one row at a time
  // can show its delete button on touch devices).
  const recordKey = clientEventRecordKey(row, index);
  return (
    <RecordRow
      recordKey={recordKey}
      row={row}
      tone={eventDateTone(row.eventDate, todayIso)}
      eventLinkHref={eventLinkHref}
      eventInvoiceHref={eventInvoiceHref}
      eventVendorInvoiceHref={eventVendorInvoiceHref}
      eventVendorDeliveryHref={eventVendorDeliveryHref}
      armed={armedDeleteKey === recordKey}
      onDelete={() => onEventDelete(recordKey, row)}
      onViewLinks={onViewLinks}
    />
  );
}
