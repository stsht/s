import { useRef, useState } from 'react';
import { readProofFile, isProofViewable, isProofImage } from '../../utils/proofImage.js';

// Payment-proof upload/preview control shared by the Subs detail
// extension form (src/pages/db/subs) and the SubscriptionEdit form
// in DatabasePage.jsx. Extracted verbatim so both can import it
// without a circular dependency. Reads a selected image into a data
// URL via readProofFile and surfaces a Replace/Remove/View chip for
// an attached proof.
export function ProofField({ value, onChange, label = 'Payment Proof (optional)', ariaLabel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const proof = String(value || '').trim();
  const hasProof = !!proof;
  const viewable = isProofViewable(proof);
  const isImage = isProofImage(proof);

  async function handleFile(file) {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const dataUrl = await readProofFile(file);
      onChange(dataUrl);
    } catch (err) {
      setError(err?.message || 'Could not read that image.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
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
            disabled={busy}
            onChange={(e) => handleFile(e.target.files && e.target.files[0])}
            aria-label={ariaLabel || 'Upload payment proof image'}
          />
          <span className="subs-proof-upload-pill">
            {busy ? 'Uploading\u2026' : (hasProof ? 'Replace' : 'Upload proof')}
          </span>
        </label>
        {hasProof ? (
          <span className="subs-proof-chip">
            {isImage ? <span className="subs-proof-chip-tag">Image</span> : null}
            {viewable ? (
              <a className="subs-proof-chip-view" href={proof} target="_blank" rel="noopener noreferrer">View</a>
            ) : (
              <span className="subs-proof-chip-text" title={proof}>{proof}</span>
            )}
            <button
              type="button"
              className="subs-proof-chip-remove"
              onClick={() => onChange('')}
              aria-label="Remove payment proof"
            >
              Remove
            </button>
          </span>
        ) : (
          <span className="subs-proof-empty">No proof attached</span>
        )}
      </div>
      {error ? <span className="subs-proof-error">{error}</span> : null}
    </div>
  );
}
