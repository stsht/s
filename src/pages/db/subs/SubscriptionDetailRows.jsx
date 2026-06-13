import { SubscriptionProofRow } from './SubscriptionProofRow.jsx';

// Top-card detail rows for the current/active subscription period:
// Storage, the Price+Payment / Start+Expiry / Access Period+Bonus
// paired groups, Contact, Payment Proof, and Notes — falling through
// to the empty-state copy when no grouped field is populated.
//
// Extracted verbatim from SubscriptionDetail. Every className and the
// per-row render gating are unchanged; values arrive pre-formatted
// from the parent so the rendered text matches the prior inline JSX.
export function SubscriptionDetailRows({
  tone,
  storageValue,
  priceLabel,
  paymentValue,
  startValue,
  expiryValue,
  periodLabel,
  bonusLabel,
  contact,
  notesValue,
  hasAnyDetailRow,
  proofValue,
  proofIsImage,
  proofIsUrl,
  onProofPreview,
}) {
  return (
    <div className={`list-stack${tone ? ` sub-${tone}` : ''}`}>
      {/* Storage stays as a standalone full-width row; it isn't
          part of any natural pair and only renders when set. */}
      {storageValue ? (
        <article className="list-row" key="Storage">
          <div>
            <strong>Storage</strong>
            <span>{storageValue}</span>
          </div>
        </article>
      ) : null}
      {/* Row 1 — Price + Payment Date. Renamed from "Paid Amount"
          and "Payment" so the labels read consistently on both
          invoice and paid-mode rows. */}
      {(priceLabel || paymentValue) ? (
        <div className="subs-detail-row-group" key="row-price-payment">
          <article className="list-row">
            <div>
              <strong>Price</strong>
              <span>{priceLabel || '—'}</span>
            </div>
          </article>
          <article className="list-row">
            <div>
              <strong>Payment Date</strong>
              <span>{paymentValue || '—'}</span>
            </div>
          </article>
        </div>
      ) : null}
      {/* Row 2 — Start Date + Expiry Date. Both share the same
          datetime format helper so the cells line up neatly on
          desktop and stack as a single column on mobile. */}
      {(startValue || expiryValue) ? (
        <div className="subs-detail-row-group" key="row-start-expiry">
          <article className="list-row">
            <div>
              <strong>Start Date</strong>
              <span>{startValue || '—'}</span>
            </div>
          </article>
          <article className="list-row">
            <div>
              <strong>Expiry Date</strong>
              <span>{expiryValue || '—'}</span>
            </div>
          </article>
        </div>
      ) : null}
      {/* Row 3 — Access Period + Bonus. Both are always shown
          (even at 0 days) so the operator can see at a glance
          that no bonus was applied and the renewal is using the
          raw access period only. */}
      <div className="subs-detail-row-group" key="row-period-bonus">
        <article className="list-row">
          <div>
            <strong>Access Period</strong>
            <span>{periodLabel || '0 Days'}</span>
          </div>
        </article>
        <article className="list-row">
          <div>
            <strong>Bonus</strong>
            <span>{bonusLabel}</span>
          </div>
        </article>
      </div>
      {contact ? (
        <article className="list-row" key="Contact">
          <div>
            <strong>Contact</strong>
            <span>{contact}</span>
          </div>
        </article>
      ) : null}
      <SubscriptionProofRow
        proofValue={proofValue}
        proofIsImage={proofIsImage}
        proofIsUrl={proofIsUrl}
        onPreview={onProofPreview}
      />
      {notesValue ? (
        <article className="list-row" key="Notes">
          <div>
            <strong>Notes</strong>
            <span className="subs-detail-notes">{notesValue}</span>
          </div>
        </article>
      ) : null}
      {!hasAnyDetailRow ? <p className="empty-state">No subscription details available.</p> : null}
    </div>
  );
}
