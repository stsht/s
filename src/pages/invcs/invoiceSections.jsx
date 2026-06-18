// Small/medium invoice sections extracted verbatim from
// InvoiceComposer.jsx (Pass 53, Pass 54). Most are pure, props-only
// components — no side effects, DOM refs, network, or localStorage —
// rendering fixed markup driven only by their props and the shared
// primitives/constants/helpers imported below. PackageCatalogEditor
// (Pass 54) additionally carries self-contained local state for its
// inline catalogue-edit UX; its save/delete actions remain
// prop-driven. Markup, class names, and props are unchanged.

import { useState } from 'react';
import { Fieldset, TrashIcon, PencilIcon, PlusIcon } from './invoicePrimitives.jsx';
import { BANK_DETAILS, PAYMENT_QR_SRC } from './invoiceConstants.js';
import { cleanPaymentMethod, rupiah, prettyDate, prettyDateTime } from './invoiceFormat.js';
import { toTitleCase, maybeTitleCase } from '../../utils/titleCase.js';
import { DateTimeField } from '../../components/ui/index.js';
import { selectAllIfZero } from '../../utils/moneyInput.js';

export function PaymentMethodPicker({ paymentMethod, setPaymentMethod }) {
  const current = cleanPaymentMethod(paymentMethod);
  return (
    <div className="payment-method-block">
      <span className="payment-method-label">Payment Method</span>
      <div className="payment-method-switch" role="radiogroup" aria-label="Payment method">
        {[
          { value: 'bank', label: 'Bank' },
          { value: 'qr', label: 'QR' },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={current === option.value}
            className={current === option.value ? 'active' : ''}
            onClick={() => setPaymentMethod(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PaymentMethodSummary({ paymentMethod }) {
  const current = cleanPaymentMethod(paymentMethod);
  if (current === 'qr') {
    return (
      <div className="qr-details-summary" aria-label="QR payment destination">
        <span className="payment-method-label">Payment Details</span>
        <div className="qr-details-card">
          <img src={PAYMENT_QR_SRC} alt="Payment QR" />
          <strong>QR Payment</strong>
        </div>
      </div>
    );
  }
  return (
    <div className="bank-details-summary" aria-label="Bank transfer destination">
      <span className="payment-method-label">Payment Details</span>
      <dl className="bank-details-summary-list">
        <div><dt>Bank</dt><dd>{BANK_DETAILS.bank}</dd></div>
        <div><dt>Account No.</dt><dd>{BANK_DETAILS.accountNumber}</dd></div>
        <div><dt>Account Name</dt><dd>{BANK_DETAILS.accountHolderLabel}</dd></div>
      </dl>
    </div>
  );
}

export function PaymentMethodFieldset({ paymentMethod, setPaymentMethod }) {
  return (
    <Fieldset title="Payment Method">
      <div className="field-stack">
        <PaymentMethodPicker paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod} />
        <PaymentMethodSummary paymentMethod={paymentMethod} />
      </div>
    </Fieldset>
  );
}

// Read-only identity + event recap shown on the Deposit and Paid
// tabs. The Invoice tab is the single source of truth for these
// fields (client_title/name/contact, venue, event date+time) and
// the grand total — the Deposit/Paid tabs deliberately cannot edit
// them, they only display the locked snapshot so the operator has
// context while recording payments. Preserves client_id / event_key
// / client_name / event_date grouping inputs untouched.
export function LockedDetails({ mode, title, clientName, contact, venue, eventDate, eventTime, totals, invoiceType }) {
  return (
    <Fieldset title="Invoice Details (locked)">
      <dl className="locked-list">
        <div className="locked-row"><dt>Client</dt><dd>{invoiceType === 'vendor' ? (clientName ? toTitleCase(clientName) : 'Client') : `${title} ${clientName ? toTitleCase(clientName) : 'Client'}`.trim()}</dd></div>
        <div className="locked-row"><dt>Contact</dt><dd>{contact ? maybeTitleCase(contact) : '-'}</dd></div>
        <div className="locked-row"><dt>Venue</dt><dd>{venue ? toTitleCase(venue) : 'TBA'}</dd></div>
        <div className="locked-row"><dt>Event</dt><dd>{prettyDateTime(eventDate, eventTime)}</dd></div>
        <div className="locked-row"><dt>Grand Total</dt><dd>{rupiah(totals.grandTotal)}</dd></div>
      </dl>
    </Fieldset>
  );
}


// Paid-tab summary. Paid means one final receipt state: the invoice
// is settled in full, paid_amount = grand total, and balance_due = 0.
// The single editable timestamp feeds both the operator recap and the
// JPG summary line.
export function PaidSummary({ totals, paidConfirmed, setPaidConfirmed, paidAtDate, setPaidAtDate, paidAtTime, setPaidAtTime }) {
  return (
    <Fieldset title="Mark as Paid">
      <div className="dp-row paid-row">
        <label className="dp-paid-toggle">
          <input
            type="checkbox"
            checked={!!paidConfirmed}
            onChange={(event) => setPaidConfirmed(event.target.checked)}
          />
          <span>Fully Paid</span>
        </label>
        <label className="dp-field">Paid on
          <DateTimeField
            value={paidAtDate}
            onChange={setPaidAtDate}
            timeValue={paidAtTime}
            onTimeChange={setPaidAtTime}
            withTime
            ariaLabel="Fully paid date and time"
          />
        </label>
      </div>
      <div className="dp-totals">
        <div className="dp-total-row"><span>Grand Total</span><strong>{rupiah(totals.grandTotal)}</strong></div>
        {paidConfirmed ? (
          <div className="dp-total-row paid-in-full-row">
            <span>Fully Paid on {prettyDate(paidAtDate)}</span>
            <strong>{rupiah(totals.grandTotal)}</strong>
          </div>
        ) : null}
        <div className="dp-total-row dp-total-balance"><span>Balance Due</span><strong>{rupiah(0)}</strong></div>
      </div>
    </Fieldset>
  );
}

export function PackageCatalogEditor({ packages, savePackage, deletePackage }) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState({ id: '', name: '', note: '', price: '' });

  function beginEdit(pkg = null) {
    setOpen(true);
    setEditingId(pkg?.id || '__new__');
    setDraft(pkg ? {
      id: String(pkg.id || ''),
      name: String(pkg.name || ''),
      note: String(pkg.note || ''),
      price: String(pkg.price || ''),
    } : { id: '', name: '', note: '', price: '' });
  }

  function cancelEdit() {
    setEditingId('');
    setDraft({ id: '', name: '', note: '', price: '' });
  }

  async function commitEdit() {
    const saved = await savePackage?.(draft, editingId === '__new__' ? '' : packages.find((pkg) => pkg.id === editingId)?.name || draft.name);
    if (saved) cancelEdit();
  }

  function handleEditKeyDown(event) {
    if (event.nativeEvent?.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      commitEdit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  }

  return (
    <div className={`package-catalog${open ? ' is-open' : ''}`}>
      <button className="package-catalog-toggle" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>Package Catalogue</span>
        <strong>{packages.length}</strong>
      </button>
      {open ? (
        <>
          <div className="package-catalog-actions">
            <button className="package-catalog-add" type="button" onClick={() => beginEdit(null)}>
              <PlusIcon /> New Package
            </button>
            {editingId === '__new__' ? (
              <div className="package-catalog-row">
                <div className="package-catalog-edit" onKeyDown={handleEditKeyDown}>
                  <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Package name" />
                  <input value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Default note" />
                  <input className="no-spinner" type="number" min="0" value={draft.price} onFocus={selectAllIfZero} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} placeholder="Price" />
                  <div className="package-catalog-edit-actions">
                    <button className="package-catalog-save" type="button" onClick={commitEdit}>Save</button>
                    <button type="button" onClick={cancelEdit}>Cancel</button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          <div className="package-catalog-list">
          {packages.map((pkg) => {
            const editing = editingId === pkg.id;
            return (
              <div className="package-catalog-row" key={pkg.id || pkg.name}>
                {editing ? (
                  <div className="package-catalog-edit" onKeyDown={handleEditKeyDown}>
                    <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Package name" />
                    <input value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Default note" />
                    <input className="no-spinner" type="number" min="0" value={draft.price} onFocus={selectAllIfZero} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} placeholder="Price" />
                    <div className="package-catalog-edit-actions">
                      <button className="package-catalog-save" type="button" onClick={commitEdit}>Save</button>
                      <button type="button" onClick={cancelEdit}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="package-catalog-main">
                      <strong>{toTitleCase(pkg.name)}</strong>
                      <span>{pkg.note ? toTitleCase(pkg.note) : 'No default note'}</span>
                    </div>
                    <span className="package-catalog-price">{rupiah(pkg.price)}</span>
                    <button className="icon-soft-button" type="button" aria-label={`Edit ${pkg.name}`} title="Edit package" onClick={() => beginEdit(pkg)}>
                      <PencilIcon />
                    </button>
                    <button className="icon-danger-button" type="button" aria-label={`Delete ${pkg.name}`} title="Delete package" onClick={() => deletePackage?.(pkg.id)}>
                      <TrashIcon />
                    </button>
                  </>
                )}
              </div>
            );
          })}
          </div>
        </>
      ) : null}
    </div>
  );
}
