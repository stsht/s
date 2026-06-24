import { compactEventDateLabel } from './dbHelpers.js';
import { rupiah } from '../../utils/rupiah.js';

// Inline X glyph used by every list/row delete control on /db.
// Stroke-only path so the icon picks up `currentColor`, which lets
// CSS swap idle/hover palettes without touching the SVG markup.
export function DeleteIcon() {
  return (
    <svg
      className="row-delete-icon"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4 4 L12 12 M12 4 L4 12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg
      className="btn-icon"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function PaperIcon() {
  return (
    <svg
      className="btn-icon"
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

// One event row inside the client detail. The delete control is a
// permanent X glyph at the far right of the row — no hover/tap-to-
// reveal flow. The row's grid lays out date+price (left meta) /
// View Links / View Invoice / X in that order; the X column is a
// fixed width so the inner action anchors shift left and never
// overlap the X. The
// row itself stays a plain shell (no click handler) so taps inside
// it never accidentally arm a delete; only the explicit X press
// triggers onDelete.
//
// The X is a two-tap (arm → confirm) control: a first press never
// deletes — it asks the parent to arm this row (`armed` prop flips
// on, painting the X with a red danger frame). A second press on
// the same armed X confirms the delete. The arm/disarm bookkeeping
// (single-armed-row rule + auto-disarm timeout) lives in the
// ClientDetail parent; RecordRow only reflects `armed` and forwards
// each press through onDelete.
//
// View Links: when the row already has a saved delivery, the action
// is a button that swaps the right panel to the admin DeliveryDetail
// view (greeting + folder + password + short link + original GD/DB/
// WT/TN URLs). When there is no delivery yet, the action stays an
// anchor that opens /l/ to compose one. Styling for both shapes
// lives under .record-row a, .record-row button.record-row-link in
// invcs.css so they read as a single pill family.
//
// `tone` ('past' | 'tba' | 'soon' | 'future') is the Asia/Jakarta
// status of the event_date. It drives the row's date pill colour
// and a subtle accent on the row border so a row's status reads at
// a glance. The tone palette mirrors the four tones used on the
// /db Clients left list so both surfaces stay visually consistent.
export function RecordRow({ recordKey, row, tone, eventLinkHref, eventInvoiceHref, eventVendorInvoiceHref, eventVendorDeliveryHref, onDelete, onViewLinks, armed = false }) {
  const hasDelivery = !!row.delivery?.id;
  const hasInvoice = !!row.invoice?.id;
  const hasVendorInvoice = !!row.vendorInvoice?.id;
  const linkLabel = hasDelivery ? 'View Links' : 'Create Links';
  // Client Invoice handles public-facing retail pricing for the client.
  // Vendor Invoice / Vendor PO (to be implemented) will handle internal
  // cost/vendor pricing separately and must never be exposed on /g.
  const invoiceLabel = hasInvoice ? 'View Client Invoice' : 'No Client Invoice';
  // Compact date pill on the row. row.eventDate is populated by
  // buildClientRecords from real event_date columns only
  // (plainEventDate strips ISO timestamps), so a created_at /
  // updated_at can never leak into this label — the fallback is
  // always literal "TBA", never today's date or the row's
  // bookkeeping timestamp.
  const dateText = compactEventDateLabel(row.eventDate);
  // Plain-text price beside the event name. Pulled off the linked
  // invoice when there is one — invoices carry the priced columns
  // (total / grand_total / price), deliveries don't. Same column
  // priority used by the legacy ListRow rendering further down so
  // /db consistently surfaces the same field across surfaces.
  // Rendered as plain text (not a pill/badge) and only when a
  // non-zero numeric value is present, so events that genuinely
  // have no price stay clean.
  const rawPrice = hasInvoice
    ? (row.invoice.total || row.invoice.grand_total || row.invoice.price)
    : '';
  const priceNumber = Number(rawPrice) || 0;
  const priceText = priceNumber > 0 ? rupiah(priceNumber) : '';
  // Green ("already created") vs blue ("complete") state for the
  // right-side action buttons.
  //   - delivery exists + not done  -> green  View Links  (is-created)
  //   - delivery exists + done      -> blue   View Links  (is-complete)
  //   - invoice  exists + not paid  -> green  View Invoice(is-created)
  //   - invoice  exists + paid      -> blue   View Invoice(is-complete)
  //   - missing invoice             -> disabled grey invoice chip
  // "done" comes from deliveries.delivery_done (db-migration-part-8);
  // "paid" from the invoice's own status. The two states are mutually
  // exclusive on a button so the CSS never has to fight specificity.
  const deliveryDone = !!row.delivery?.delivery_done;
  const invoicePaid = String(row.invoice?.status || '').toLowerCase() === 'paid';
  const linkStateClass = hasDelivery ? (deliveryDone ? ' is-complete' : ' is-created') : '';
  const invoiceStateClass = hasInvoice ? (invoicePaid ? ' is-complete' : ' is-created') : ' is-disabled';
  const linkClassName = `record-row-link${linkStateClass} record-row-pill record-row-pill--links`;
  const invoiceClassName = `record-row-link-anchor${invoiceStateClass} record-row-pill record-row-pill--invoice`;
  const linkAnchorClass = `record-row-link-anchor${linkStateClass} record-row-pill record-row-pill--links`;
  const vendorInvoicePaid = String(row.vendorInvoice?.status || '').toLowerCase() === 'paid';
  const vendorInvoiceStateClass = hasVendorInvoice ? (vendorInvoicePaid ? ' is-complete' : ' is-created') : ' is-disabled';
  const vendorInvoiceClassName = `record-row-link-anchor${vendorInvoiceStateClass}`;

  const hasVendorDelivery = !!row.vendorDelivery?.id;
  const vendorDeliveryDone = !!row.vendorDelivery?.delivery_done;
  const vendorDeliveryStateClass = hasVendorDelivery ? (vendorDeliveryDone ? ' is-complete' : ' is-created') : ' is-neutral';
  const vendorDeliveryClassName = `record-row-link-anchor${vendorDeliveryStateClass}`;

  // Row tone (and the date-pill colour) tracks ONLY the universal
  // delivery done/check state. When the top-level checkmark marks
  // the delivery done the event row goes neutral, regardless of
  // whether the client invoice is paid — invoice status drives the
  // invoice button/pill (is-complete) alone and never forces the
  // row red. An incomplete row keeps its soon/future colour, or
  // falls back to past/red.
  const isDeliveryComplete = deliveryDone;
  let rowTone = tone;
  if (isDeliveryComplete) {
    rowTone = '';
  } else if (tone !== 'soon' && tone !== 'future') {
    rowTone = 'past';
  }
  const toneClass = rowTone ? `event-tone-${rowTone}` : '';

  return (
    <article className={`record-row${toneClass ? ` ${toneClass}` : ''}`} data-key={recordKey}>
      <div className="record-row-meta">
        <span className={`event-date-pill${toneClass ? ` ${toneClass}` : ''}`}>{dateText}</span>
        {priceText ? <span className="record-row-price">{priceText}</span> : null}
      </div>
      <div className="record-row-action-group">
        {hasDelivery ? (
          <button
            type="button"
            className={linkClassName}
            onClick={(event) => {
              event.stopPropagation();
              onViewLinks?.(row.delivery);
            }}
          >
            {linkLabel}
          </button>
        ) : (
          <a className={linkAnchorClass} href={eventLinkHref} target="_blank" rel="noopener noreferrer">
            {linkLabel}
          </a>
        )}
        {hasVendorDelivery ? (
          <button
            type="button"
            className={`${vendorDeliveryClassName} record-row-vendor-addon`}
            onClick={(event) => {
              event.stopPropagation();
              onViewLinks?.(row.vendorDelivery);
            }}
            aria-label="View vendor links"
            title="View Vendor Links"
          >
            <LinkIcon />
          </button>
        ) : (
          <a
            className={`${vendorDeliveryClassName} record-row-vendor-addon`}
            href={eventVendorDeliveryHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Create vendor links"
            title="Create Vendor Links"
          >
            <LinkIcon />
          </a>
        )}
      </div>
      <div className="record-row-action-group">
        {hasInvoice ? (
          <a className={invoiceClassName} href={eventInvoiceHref} target="_blank" rel="noopener noreferrer">
            {invoiceLabel}
          </a>
        ) : (
          <button type="button" className={invoiceClassName} disabled aria-disabled="true" title="No Client Invoice">
            {invoiceLabel}
          </button>
        )}
        {hasVendorInvoice ? (
          <a
            className={`${vendorInvoiceClassName} record-row-vendor-addon`}
            href={eventVendorInvoiceHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View vendor invoice"
            title="View Vendor Invoice"
          >
            <PaperIcon />
          </a>
        ) : (
          <button
            type="button"
            className={`${vendorInvoiceClassName} record-row-vendor-addon`}
            disabled
            aria-disabled="true"
            aria-label="No vendor invoice yet"
            title="No Vendor Invoice"
          >
            <PaperIcon />
          </button>
        )}
      </div>
      <button
        type="button"
        className={`row-delete-x${armed ? ' is-armed' : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          // Two-tap delete: the parent decides whether this press
          // arms the row or (when already armed) performs the
          // delete. We never delete on a bare first tap here.
          onDelete?.();
        }}
        aria-label={armed ? 'Confirm delete event' : 'Delete event'}
        aria-pressed={armed}
        title={armed ? 'Tap again to delete' : 'Delete event'}
      >
        <DeleteIcon />
      </button>
    </article>
  );
}
