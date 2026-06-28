import { isProofImage, isProofViewable, parseProofList } from '../../../utils/proofImage.js';

// Top-card "Payment Proof" detail row for the current/active period.
// Renders every stored proof: legacy single values remain supported,
// while new multi-proof strings render as Proof 1 / Proof 2 / ...
export function SubscriptionProofRow({ proofValue, proofIsImage, proofIsUrl, onPreview }) {
  const proofs = parseProofList(proofValue);
  if (!proofs.length) return null;
  return (
    <article className="list-row" key="PaymentProof">
      <div>
        <strong>Payment Proof{proofs.length > 1 ? 's' : ''}</strong>
        <div className="subs-proof-detail-list">
          {proofs.map((proof, index) => {
            const image = proofs.length === 1 ? proofIsImage : isProofImage(proof);
            const url = proofs.length === 1 ? proofIsUrl : isProofViewable(proof);
            return image ? (
              <button
                type="button"
                className="subs-proof-thumb"
                onClick={() => onPreview(proof)}
                aria-label={`View payment proof image ${index + 1}`}
                title="View payment proof"
                key={`${proof.slice(0, 24)}-${index}`}
              >
                <img src={proof} alt={`Payment proof ${index + 1}`} loading="lazy" />
                {proofs.length > 1 ? <span>Proof {index + 1}</span> : null}
              </button>
            ) : url ? (
              <a
                className="subs-proof-link"
                href={proof}
                target="_blank"
                rel="noopener noreferrer"
                key={`${proof.slice(0, 24)}-${index}`}
              >
                View proof{proofs.length > 1 ? ` ${index + 1}` : ''}
              </a>
            ) : (
              <span key={`${proof.slice(0, 24)}-${index}`}>{proof}</span>
            );
          })}
        </div>
      </div>
    </article>
  );
}
