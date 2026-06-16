import { rupiah } from '../../utils/rupiah.js';
import { fmtSubsDate, fmtSubsTime } from './subscriptionUtils.js';
import './subscriptionCards.css';

// Paid subscription receipt card. Presentational — same DOM tree
// /subs has always emitted, just driven by props instead of local
// state so /db Subs detail can re-render the receipt for an existing
// row without retyping. The cardRef prop is attached to the outer
// <article> so the caller can rasterise the laid-out element with
// html2canvas.
export function SubsPaidCard({
  cardRef,
  titlePrefix,
  displayClient,
  service,
  paymentDate,
  paymentTime,
  price,
  periodLabel,
  startDate,
  startTime,
  expiryDate,
  expiryTime,
  note,
  paymentProof,
}) {
  const noteText = String(note || '').trim();
  const proofText = String(paymentProof || '').trim();
  const proofLabel = proofText
    ? (/^https?:\/\//i.test(proofText) ? 'Attached' : proofText)
    : '';
  return (
    <article className="subs-card" ref={cardRef}>
      {/* Thin sky→cyan→soft-green brand accent pinned to the top edge.
          Decorative only; carries no text so the JPG re-import parser
          (which reads textContent in DOM order) is unaffected. */}
      <span className="subs-accent" aria-hidden="true" />
      {/* Oversized, low-opacity PAID watermark sitting behind the
          content — a luxury-receipt cue rather than a rubber stamp or
          pill badge. Decorative/aria-hidden; the "Payment received"
          line and the "Paid Amount" label remain the machine-readable
          paid markers for JPG re-import. */}
      <span className="subs-watermark" aria-hidden="true">PAID</span>
      <header className="subs-card-head">
        <div className="subs-head-top">
          <img src="/logo-hero.png" alt="StarShots" className="subs-logo" />
        </div>
        <div className="subs-head-title">
          <h1 className="subs-title">Subscription Receipt</h1>
          <p className="subs-greeting">
            Payment received for {titlePrefix ? titlePrefix + ' ' : ''}{displayClient}
          </p>
        </div>
      </header>
      {/* Hero — the strongest section: service + paid amount. The
          "Paid Amount" label is kept verbatim so the JPG re-import
          parser still extracts the amount from the rasterised text. */}
      <section className="subs-hero">
        <div className="subs-hero-cell">
          <span className="subs-hero-label">Service</span>
          <span className="subs-hero-service">{service}</span>
        </div>
        <div className="subs-hero-cell subs-hero-cell--amount">
          <span className="subs-hero-label">Paid Amount</span>
          <span className="subs-hero-amount">{rupiah(price)}</span>
        </div>
      </section>
      {/* Key-value details. Payment date appears here first, then
          start/expiry in the window below — the importer reads dates
          in document order (1st=payment, 2nd=start, 3rd=expiry). The
          "Access Period" label is kept verbatim for the parser. */}
      <section className="subs-rows">
        <div className="subs-row">
          <span className="subs-row-label">Payment Date</span>
          <span className="subs-row-value">{fmtSubsDate(paymentDate)}</span>
        </div>
        <div className="subs-row">
          <span className="subs-row-label">Payment Time</span>
          <span className="subs-row-value">{fmtSubsTime(paymentTime)}</span>
        </div>
        <div className="subs-row">
          <span className="subs-row-label">Access Period</span>
          <span className="subs-row-value">{periodLabel || '-'}</span>
        </div>
        {proofLabel ? (
          <div className="subs-row">
            <span className="subs-row-label">Payment Proof</span>
            <span className="subs-row-value">{proofLabel}</span>
          </div>
        ) : null}
      </section>
      {/* Access window — Start → Expiry with a thin progress
          connector (green start dot, hairline rule, arrow). */}
      <section className="subs-window">
        <span className="subs-window-title">Access Window</span>
        <div className="subs-window-track">
          <div className="subs-window-end">
            <span className="subs-window-label">Start</span>
            <span className="subs-window-date">{fmtSubsDate(startDate)}</span>
            <span className="subs-window-time">{fmtSubsTime(startTime)}</span>
          </div>
          <div className="subs-window-line" aria-hidden="true">
            <span className="subs-window-dot" />
            <span className="subs-window-rule" />
            <span className="subs-window-arrow" />
          </div>
          <div className="subs-window-end subs-window-end--right">
            <span className="subs-window-label">Expiry</span>
            <span className="subs-window-date">{fmtSubsDate(expiryDate)}</span>
            {/* Saved expiry time when present, else start time for
                legacy/live-preview rows. */}
            <span className="subs-window-time">{fmtSubsTime(expiryTime || startTime)}</span>
          </div>
        </div>
      </section>
      {noteText ? (
        <section className="subs-note">
          <span className="subs-row-label">Reference</span>
          <p className="subs-note-text">{noteText}</p>
        </section>
      ) : null}
      <footer className="subs-card-foot">
        <div className="subs-foot-meta">
          <span>Automatically generated &middot; valid without signature</span>
          <strong>@starshots.id</strong>
        </div>
      </footer>
    </article>
  );
}
