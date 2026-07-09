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
    <svg className="btn-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function PaperIcon() {
  return (
    <svg className="btn-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function PaymentIcon() {
  return (
    <svg className="btn-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h3" />
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

function paymentState(entries = []) {
  if (!entries.length) return '';
  const latest = entries[entries.length - 1];
  return String(latest?.status || '').toLowerCase() === 'confirmed' ? ' is-complete' : ' is-created';
}

function PaymentProofViewer({ entries, title = 'Payment Proof', onClose }) {
  return (
    <div className="payment-proof-viewer" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="payment-proof-viewer-card" onClick={(event) => event.stopPropagation()}>
        <header className="payment-proof-viewer-head">
          <div>
            <p>{title}</p>
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
  const [proofViewer, setProofViewer] = useState(null);
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
  const invoiceStateClass = hasInvoice ? (invoicePaid ? ' is-complete' : ' is-created') : '';
  const vendorLinkStateClass = hasVendorDelivery ? (vendorDeliveryDone ? ' is-complete' : ' is-created') : '';
  const vendorInvoiceStateClass = hasVendorInvoice ? (vendorInvoicePaid ? ' is-complete' : ' is-created') : '';

  const paymentProofs = eventPaymentProofs(row);
  const vendorPaymentProofs = hasVendorInvoice ? invoicePaymentProofs(row.vendorInvoice) : [];
  const paymentStateClass = paymentState(paymentProofs);
  const vendorPaymentStateClass = paymentState(vendorPaymentProofs);

  const actionClass = (stateClass = '') => `record-row-link-anchor${stateClass} record-row-pill record-row-status-pill`;

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

        <div className="record-row-action-group record-row-primary-actions" aria-label="Client actions">
          {hasDelivery ? (
            <button
              type="button"
              className={actionClass(linkStateClass)}
              title={deliveryDone ? 'Links complete' : 'View Links'}
              onClick={(event) => {
                event.stopPropagation();
                onViewLinks?.(row.delivery);
              }}
            >
              <LinkIcon /> <span>Links</span>
            </button>
          ) : (
            <a className={actionClass()} href={eventLinkHref} target="_blank" rel="noopener noreferrer" title="Create Links">
              <LinkIcon /> <span>Links</span>
            </a>
          )}

          <a
            className={actionClass(invoiceStateClass)}
            href={eventInvoiceHref}
            target="_blank"
            rel="noopener noreferrer"
            title={hasInvoice ? (invoicePaid ? 'Invoice fully paid' : 'View Invoice') : 'Create Invoice'}
          >
            <PaperIcon /> <span>Invoice</span>
          </a>

          <button
            type="button"
            className={actionClass(paymentStateClass)}
            disabled={!paymentProofs.length}
            aria-disabled={!paymentProofs.length}
            title={paymentProofs.length ? 'View Payments' : 'No payment proofs'}
            onClick={(event) => {
              event.stopPropagation();
              if (paymentProofs.length) setProofViewer({ title: 'Client Payment Proof', entries: paymentProofs });
            }}
          >
            <PaymentIcon /> <span>Payments</span>
          </button>

          <button
            type="button"
            className="record-row-link-anchor record-row-pill record-row-vendor-toggle"
            aria-expanded={vendorOpen}
            onClick={(event) => {
              event.stopPropagation();
              setVendorOpen((open) => !open);
            }}
          >
            <span>Vendor</span> <span aria-hidden="true">{vendorOpen ? '▴' : '▾'}</span>
          </button>
        </div>

        {vendorOpen ? (
          <div className="record-row-vendor-panel" role="group" aria-label="Vendor actions">
            {hasVendorDelivery ? (
              <button
                type="button"
                className={actionClass(vendorLinkStateClass)}
                title={vendorDeliveryDone ? 'Vendor links complete' : 'View Vendor Links'}
                onClick={(event) => {
                  event.stopPropagation();
                  onViewLinks?.(row.vendorDelivery);
                }}
              >
                <LinkIcon /> <span>Links</span>
              </button>
            ) : (
              <a className={actionClass()} href={eventVendorDeliveryHref} target="_blank" rel="noopener noreferrer" title="Create Vendor Links">
                <LinkIcon /> <span>Links</span>
              </a>
            )}

            <a
              className={actionClass(vendorInvoiceStateClass)}
              href={eventVendorInvoiceHref}
              target="_blank"
              rel="noopener noreferrer"
              title={hasVendorInvoice ? (vendorInvoicePaid ? 'Vendor invoice fully paid' : 'View Vendor Invoice') : 'Create Vendor Invoice'}
            >
              <PaperIcon /> <span>Invoice</span>
            </a>

            <button
              type="button"
              className={actionClass(vendorPaymentStateClass)}
              disabled={!vendorPaymentProofs.length}
              aria-disabled={!vendorPaymentProofs.length}
              title={vendorPaymentProofs.length ? 'View Vendor Payments' : 'No vendor payment proofs'}
              onClick={(event) => {
                event.stopPropagation();
                if (vendorPaymentProofs.length) setProofViewer({ title: 'Vendor Payment Proof', entries: vendorPaymentProofs });
              }}
            >
              <PaymentIcon /> <span>Payments</span>
            </button>
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

      {proofViewer ? (
        <PaymentProofViewer title={proofViewer.title} entries={proofViewer.entries} onClose={() => setProofViewer(null)} />
      ) : null}
    </>
  );
}
