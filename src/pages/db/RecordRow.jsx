import { useState } from 'react';
import { compactEventDateLabel } from './dbHelpers.js';
import { rupiah } from '../../utils/rupiah.js';
import './RecordRowPolish.css';

export function DeleteIcon() {
  return (
    <svg className="row-delete-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg className="btn-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function PaperIcon() {
  return (
    <svg className="btn-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function invoicePaymentProofs(invoice = {}) {
  const storedEntries = Array.isArray(invoice?.payment_proofs) ? invoice.payment_proofs : [];
  const stored = storedEntries
    .map((entry, entryIndex) => ({
      id: String(entry?.id || `stored-payment-${entryIndex + 1}`),
      status: String(entry?.status || 'pending').toLowerCase(),
      createdAt: String(entry?.uploaded_at || entry?.created_at || ''),
      filename: String(entry?.original_filename || `payment-proof-${entryIndex + 1}.jpg`),
      images: [String(entry?.image_url || '').trim()].filter(Boolean),
    }))
    .filter((entry) => entry.images.length);
  if (stored.length) return stored;

  const data = invoice?.invoice_data && typeof invoice.invoice_data === 'object' ? invoice.invoice_data : {};
  const legacyEntries = Array.isArray(data.paymentProofs) ? data.paymentProofs : [];
  return legacyEntries
    .map((entry, entryIndex) => ({
      id: String(entry?.id || `legacy-payment-${entryIndex + 1}`),
      status: String(entry?.status || 'pending').toLowerCase(),
      createdAt: String(entry?.createdAt || entry?.created_at || ''),
      filename: `payment-proof-${entryIndex + 1}.jpg`,
      images: Array.isArray(entry?.images)
        ? entry.images.map((image) => String(image || '').trim()).filter(Boolean)
        : [],
    }))
    .filter((entry) => entry.images.length);
}

function eventPaymentProofs(row = {}) {
  const sourceInvoices = Array.isArray(row?.paymentInvoices) && row.paymentInvoices.length
    ? row.paymentInvoices
    : (row?.invoice ? [row.invoice] : []);
  const seen = new Set();
  return sourceInvoices
    .flatMap((invoice) => invoicePaymentProofs(invoice))
    .filter((entry) => {
      const key = String(entry?.id || entry?.images?.[0] || '').trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (Date.parse(a?.createdAt || '') || 0) - (Date.parse(b?.createdAt || '') || 0));
}

function PaymentProofViewer({ entries, onClose }) {
  return (
    <div className="payment-proof-viewer" role="dialog" aria-modal="true" aria-label="Payment proofs" onClick={onClose}>
      <div className="payment-proof-viewer-card" onClick={(event) => event.stopPropagation()}>
        <header className="payment-proof-viewer-head">
          <div>
            <p>Payment Proof</p>
            <strong>{entries.length} image{entries.length > 1 ? 's' : ''}</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="Close payment proofs">×</button>
        </header>
        <div className="payment-proof-viewer-body">
          {entries.map((entry, entryIndex) => (
            <section className="payment-proof-entry" key={entry.id || entryIndex}>
              <div className="payment-proof-entry-head">
                <strong>Payment {entryIndex + 1}</strong>
                <span className={`payment-proof-status is-${entry.status || 'pending'}`}>{entry.status || 'pending'}</span>
              </div>
              {entry.createdAt ? <p className="payment-proof-entry-date">Uploaded {entry.createdAt.slice(0, 10)}</p> : null}
              <div className="payment-proof-image-grid">
                {entry.images.map((image, imageIndex) => (
                  <div className="payment-proof-image-item" key={`${entry.id || entryIndex}-${imageIndex}`}>
                    <a href={image} target="_blank" rel="noopener noreferrer" className="payment-proof-image-link">
                      <img src={image} alt={`Payment proof ${entryIndex + 1}.${imageIndex + 1}`} />
                    </a>
                    <a className="payment-proof-save" href={image} download={entry.filename || `payment-proof-${entryIndex + 1}-${imageIndex + 1}.jpg`}>
                      Save Image
                    </a>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export function RecordRow({
  recordKey,
  row,
  tone,
  eventLinkHref,
  eventInvoiceHref,
  eventVendorInvoiceHref,
  eventVendorDeliveryHref,
  onDelete,
  onViewLinks,
  armed = false,
}) {
  const [proofViewerOpen, setProofViewerOpen] = useState(false);
  const [vendorOpen, setVendorOpen] = useState(false);

  const hasDelivery = !!row.delivery?.id;
  const hasInvoice = !!row.invoice?.id;
  const hasVendorDelivery = !!row.vendorDelivery?.id;
  const hasVendorInvoice = !!row.vendorInvoice?.id;

  const dateText = compactEventDateLabel(row.eventDate);
  const rawPrice = hasInvoice ? (row.invoice.total || row.invoice.grand_total || row.invoice.price) : '';
  const priceNumber = Number(rawPrice) || 0;
  const priceText = priceNumber > 0 ? rupiah(priceNumber) : '';

  const deliveryDone = !!row.delivery?.delivery_done;
  const invoicePaid = String(row.invoice?.status || '').toLowerCase() === 'paid';
  const vendorDeliveryDone = !!row.vendorDelivery?.delivery_done;
  const vendorInvoicePaid = String(row.vendorInvoice?.status || '').toLowerCase() === 'paid';

  const linkStateClass = hasDelivery ? (deliveryDone ? ' is-complete' : ' is-created') : '';
  const invoiceStateClass = hasInvoice ? (invoicePaid ? ' is-complete' : ' is-created') : ' is-disabled';
  const vendorDeliveryStateClass = hasVendorDelivery ? (vendorDeliveryDone ? ' is-complete' : ' is-created') : '';
  const vendorInvoiceStateClass = hasVendorInvoice ? (vendorInvoicePaid ? ' is-complete' : ' is-created') : '';

  const linkClassName = `record-row-link${linkStateClass} record-row-pill record-row-pill--links`;
  const linkAnchorClass = `record-row-link-anchor${linkStateClass} record-row-pill record-row-pill--links`;
  const invoiceClassName = `record-row-link-anchor${invoiceStateClass} record-row-pill record-row-pill--invoice`;

  const paymentProofs = eventPaymentProofs(row);
  const hasPaymentProofs = paymentProofs.length > 0;
  const latestPaymentStatus = paymentProofs[paymentProofs.length - 1]?.status || 'pending';
  const paymentStateClass = hasPaymentProofs
    ? (latestPaymentStatus === 'confirmed' ? ' is-complete' : ' is-created')
    : ' is-disabled';
  const paymentClassName = `record-row-link-anchor${paymentStateClass} record-row-pill record-row-pill--payments`;

  const vendorHasData = hasVendorDelivery || hasVendorInvoice;
  const vendorToggleClassName = `record-row-link-anchor record-row-pill record-row-vendor-toggle${vendorHasData ? ' is-created' : ''}`;
  const vendorDeliveryClassName = `record-row-link-anchor${vendorDeliveryStateClass} record-row-vendor-action`;
  const vendorInvoiceClassName = `record-row-link-anchor${vendorInvoiceStateClass} record-row-vendor-action`;

  let rowTone = tone;
  if (deliveryDone) rowTone = '';
  else if (tone !== 'soon' && tone !== 'future') rowTone = 'past';
  const toneClass = rowTone ? `event-tone-${rowTone}` : '';

  return (
    <>
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
              View Links
            </button>
          ) : (
            <a className={linkAnchorClass} href={eventLinkHref} target="_blank" rel="noopener noreferrer">
              Create Links
            </a>
          )}
        </div>

        <div className="record-row-action-group record-row-action-group--invoice">
          {hasInvoice ? (
            <a className={invoiceClassName} href={eventInvoiceHref} target="_blank" rel="noopener noreferrer">
              View Invoice
            </a>
          ) : (
            <button type="button" className={invoiceClassName} disabled aria-disabled="true" title="No Invoice">
              No Invoice
            </button>
          )}

          <button
            type="button"
            className={paymentClassName}
            disabled={!hasPaymentProofs}
            aria-disabled={!hasPaymentProofs}
            title={hasPaymentProofs ? 'View payment history' : 'No payment proofs uploaded'}
            onClick={(event) => {
              event.stopPropagation();
              if (hasPaymentProofs) setProofViewerOpen(true);
            }}
          >
            {hasPaymentProofs ? `View Payments (${paymentProofs.length})` : 'No Payments'}
          </button>

          <button
            type="button"
            className={vendorToggleClassName}
            aria-expanded={vendorOpen}
            onClick={(event) => {
              event.stopPropagation();
              setVendorOpen((open) => !open);
            }}
          >
            Vendor <span aria-hidden="true">{vendorOpen ? '▴' : '▾'}</span>
          </button>
        </div>

        {vendorOpen ? (
          <div className="record-row-vendor-panel" role="group" aria-label="Vendor actions">
            {hasVendorDelivery ? (
              <button
                type="button"
                className={vendorDeliveryClassName}
                onClick={(event) => {
                  event.stopPropagation();
                  onViewLinks?.(row.vendorDelivery);
                }}
              >
                <LinkIcon /> View Vendor Links
              </button>
            ) : (
              <a className={vendorDeliveryClassName} href={eventVendorDeliveryHref} target="_blank" rel="noopener noreferrer">
                <LinkIcon /> Create Vendor Links
              </a>
            )}

            {hasVendorInvoice ? (
              <a className={vendorInvoiceClassName} href={eventVendorInvoiceHref} target="_blank" rel="noopener noreferrer">
                <PaperIcon /> View Vendor Invoice
              </a>
            ) : (
              <a className={vendorInvoiceClassName} href={eventVendorInvoiceHref} target="_blank" rel="noopener noreferrer">
                <PaperIcon /> Create Vendor Invoice
              </a>
            )}
          </div>
        ) : null}

        <button
          type="button"
          className={`row-delete-x${armed ? ' is-armed' : ''}`}
          onClick={(event) => {
            event.stopPropagation();
            onDelete?.();
          }}
          aria-label={armed ? 'Confirm delete event' : 'Delete event'}
          aria-pressed={armed}
          title={armed ? 'Tap again to delete' : 'Delete event'}
        >
          <DeleteIcon />
        </button>
      </article>

      {proofViewerOpen ? <PaymentProofViewer entries={paymentProofs} onClose={() => setProofViewerOpen(false)} /> : null}
    </>
  );
}
