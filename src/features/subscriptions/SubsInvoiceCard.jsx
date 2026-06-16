import { rupiah } from '../../utils/rupiah.js';
import { fmtSubsDate } from './subscriptionUtils.js';
import './subscriptionCards.css';

// Subscription invoice card. Sibling of SubsPaidCard with the same
// 720px white-sheet design and shared footer. Driven by the same
// props derivation so /db Subs detail can re-render an invoice
// without retyping.
export function SubsInvoiceCard({
  cardRef,
  titlePrefix,
  displayClient,
  service,
  showStorage,
  storage,
  showDuration,
  durationLabel,
  lineSubtitle,
  price,
  issuedDate,
}) {
  return (
    <article className="subs-invoice-card" ref={cardRef}>
      <header className="subs-card-head">
        <div className="subs-head-top">
          <span className="subs-brand">StarShots</span>
          {/* Neutral "Invoice" chip — slate counterpart to the paid
              receipt's green "Paid" chip so the two read as one family. */}
          <span className="subs-invoice-chip">Invoice</span>
        </div>
        <h1 className="subs-title">Subscription Invoice</h1>
        <p className="subs-greeting">
          Billed to {titlePrefix ? titlePrefix + ' ' : ''}{displayClient}
        </p>
      </header>
      {/* Detail ledger — shares the paid receipt's label/value rows. */}
      <section className="subs-rows">
        <div className="subs-row">
          <span className="subs-row-label">Service</span>
          <span className="subs-row-value">{service}</span>
        </div>
        {showStorage ? (
          <div className="subs-row">
            <span className="subs-row-label">Storage</span>
            <span className="subs-row-value">{storage}</span>
          </div>
        ) : null}
        {showDuration ? (
          <div className="subs-row">
            <span className="subs-row-label">Duration</span>
            <span className="subs-row-value">{durationLabel}</span>
          </div>
        ) : null}
        <div className="subs-row">
          <span className="subs-row-label">Issued</span>
          <span className="subs-row-value">{fmtSubsDate(issuedDate)}</span>
        </div>
      </section>
      <section className="subs-invoice-line">
        <div className="subs-invoice-line-desc">
          <strong>{service} Subscription</strong>
          {lineSubtitle ? <small>{lineSubtitle}</small> : null}
        </div>
        <span className="subs-invoice-line-amt">{rupiah(price)}</span>
      </section>
      <section className="subs-invoice-total">
        <span className="subs-row-label">Total Due</span>
        <strong className="subs-invoice-total-amt">{rupiah(price)}</strong>
      </section>
      <section className="subs-invoice-pay">
        <img src="/payment-qr.png" alt="Payment QR" className="subs-invoice-qr" />
        <div className="subs-invoice-pay-copy">
          <span className="subs-row-label">Scan to Pay</span>
          <p>Complete payment using the QR above to activate your subscription.</p>
        </div>
      </section>
      <footer className="subs-card-foot">
        <p className="subs-foot-note">
          Thanks for trusting StarShots — please complete payment to keep your subscription active.
        </p>
        <div className="subs-foot-meta">
          <span>Automatically generated &middot; valid without signature</span>
          <strong>@starshots.id</strong>
        </div>
      </footer>
    </article>
  );
}
