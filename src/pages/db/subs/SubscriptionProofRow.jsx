// Top-card "Payment Proof" detail row for the current/active period.
//
// Extracted verbatim from SubscriptionDetail's list-stack. Renders a
// tappable thumbnail for an image proof (opening the lightbox via
// onPreview), a "View proof" link for a non-image viewable URL, or
// the raw proof string otherwise. Returns null when there is no proof
// so the parent can drop the row entirely.
export function SubscriptionProofRow({ proofValue, proofIsImage, proofIsUrl, onPreview }) {
  if (!proofValue) return null;
  return (
    <article className="list-row" key="PaymentProof">
      <div>
        <strong>Payment Proof</strong>
        {proofIsImage ? (
          <button
            type="button"
            className="subs-proof-thumb"
            onClick={() => onPreview(proofValue)}
            aria-label="View payment proof image"
            title="View payment proof"
          >
            <img src={proofValue} alt="Payment proof" loading="lazy" />
          </button>
        ) : proofIsUrl ? (
          <a
            className="subs-proof-link"
            href={proofValue}
            target="_blank"
            rel="noopener noreferrer"
          >
            View proof
          </a>
        ) : (
          <span>{proofValue}</span>
        )}
      </div>
    </article>
  );
}
