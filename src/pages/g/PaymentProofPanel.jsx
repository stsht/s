import { useRef, useState } from 'react';
import { PAYMENT_PROOF_MAX_IMAGES, paymentProofState } from '../../features/paymentProofs/paymentProofs.js';
import { readProofFile } from '../../utils/proofImage.js';

export function PaymentProofPanel({ invoice, onSubmitProof, onPreviewProof }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const state = paymentProofState(invoice);
  const disabled = !state.canUpload;

  async function submitFiles(fileList) {
    const files = Array.from(fileList || []).slice(0, PAYMENT_PROOF_MAX_IMAGES);
    if (!files.length || disabled) return;
    setBusy(true);
    setError('');
    try {
      const images = [];
      for (const file of files) images.push(await readProofFile(file));
      await onSubmitProof?.(images);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(err?.message || 'Could not upload proof.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`payment-proof-panel${disabled ? ' is-locked' : ''}`} aria-label="Payment proof">
      <div className="payment-proof-head">
        <div>
          <p className="payment-proof-eyebrow">Payment Proof</p>
          <strong>{state.publicLabel}</strong>
        </div>
        {state.hasProof ? (
          <button type="button" className="payment-proof-view" onClick={() => onPreviewProof?.(state.latest)}>
            View Proof
          </button>
        ) : null}
      </div>
      {state.fullyPaid ? (
        <p className="payment-proof-note">Payment has been confirmed. Upload is now closed.</p>
      ) : state.pending ? (
        <p className="payment-proof-note">Your proof has been received and is waiting for review.</p>
      ) : (
        <>
          <label className="payment-proof-upload">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              disabled={busy || disabled}
              onChange={(event) => submitFiles(event.target.files)}
              aria-label="Upload transfer proof"
            />
            <span>{busy ? 'Uploading…' : 'Upload Transfer Proof'}</span>
          </label>
          <p className="payment-proof-note">Upload up to 3 transfer screenshots.</p>
        </>
      )}
      {error ? <p className="payment-proof-error">{error}</p> : null}
    </section>
  );
}
