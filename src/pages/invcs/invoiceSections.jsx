// Small presentational invoice sections extracted verbatim from
// InvoiceComposer.jsx (Pass 53). These are pure, props-only
// components — no hooks, local state, side effects, DOM refs,
// network, or localStorage. Markup, class names, and props are
// unchanged; they render fixed markup driven only by their props and
// the shared primitives/constants/helpers imported below.

import { Fieldset } from './invoicePrimitives.jsx';
import { BANK_DETAILS, PAYMENT_QR_SRC } from './invoiceConstants.js';
import { cleanPaymentMethod, rupiah, prettyDateTime } from './invoiceFormat.js';
import { toTitleCase, maybeTitleCase } from '../../utils/titleCase.js';

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
