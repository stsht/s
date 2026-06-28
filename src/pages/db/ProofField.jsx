import { useRef, useState } from 'react';
import {
  readProofFile,
  isProofViewable,
  isProofImage,
  parseProofList,
  serializeProofList,
} from '../../utils/proofImage.js';

// Payment-proof upload/preview control shared by the Subs detail
// extension form (src/pages/db/subs) and the SubscriptionEdit form
// in DatabasePage.jsx. Reads selected images into data URLs via
// readProofFile and stores one proof as the legacy plain string, or
// multiple proofs as a compact tagged JSON string in the same
// payment_proof column.
export function ProofField({ value, onChange, label = 'Payment Proof (optional)', ariaLabel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const proofs = parseProofList(value);
  const hasProof = proofs.length > 0;

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setError('');
    setBusy(true);
    try {
      const uploaded = [];
      for (const file of files) {
        uploaded.push(await readProofFile(file));
      }
      onChange(serializeProofList([...proofs, ...uploaded]));
    } catch (err) {
      setError(err?.message || 'Could not read that image.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function removeProof(index) {
    onChange(serializeProofList(proofs.filter((_, i) => i !== index)));
  }

  return (
    <div className="subs-proof-field">
      <span className="subs-proof-field-label">{label}</span>
      <div className="subs-proof-field-controls">
        <label className="subs-proof-upload">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            disabled={busy}
            onChange={(e) => handleFiles(e.target.files)}
            aria-label={ariaLabel || 'Upload payment proof image'}
          />
          <span className="subs-proof-upload-pill">
            {busy ? 'Uploading…' : (hasProof ? 'Add proof' : 'Upload proof')}
          </span>
        </label>
        {hasProof ? (
          <span className="subs-proof-chip-list">
            {proofs.map((proof, index) => {
              const viewable = isProofViewable(proof);
              const image = isProofImage(proof);
              return (
                <span className="subs-proof-chip" key={`${proof.slice(0, 24)}-${index}`}>
                  {image ? <span className="subs-proof-chip-tag">Image {proofs.length > 1 ? index + 1 : ''}</span> : null}
                  {viewable ? (
                    <a className="subs-proof-chip-view" href={proof} target="_blank" rel="noopener noreferrer">View</a>
                  ) : (
                    <span className="subs-proof-chip-text" title={proof}>{proof}</span>
                  )}
                  <button
                    type="button"
                    className="subs-proof-chip-remove"
                    onClick={() => removeProof(index)}
                    aria-label={`Remove payment proof ${index + 1}`}
                  >
                    Remove
                  </button>
                </span>
              );
            })}
          </span>
        ) : (
          <span className="subs-proof-empty">No proof attached</span>
        )}
      </div>
      {error ? <span className="subs-proof-error">{error}</span> : null}
    </div>
  );
}
