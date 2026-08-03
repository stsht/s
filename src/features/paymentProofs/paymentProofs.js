export const PAYMENT_PROOF_MAX_IMAGES = 3;
export const PAYMENT_PROOF_STATUSES = new Set(['pending', 'partial', 'confirmed', 'rejected']);

export function paymentProofSpaymentProofStatetate(invoice = {}) {
  const data = invoice?.invoice_data && typeof invoice.invoice_data === 'object' ? invoice.invoice_data : {};
  const proofs = Array.isArray(data.paymentProofs) ? data.paymentProofs : [];
  const cleanProofs = proofs
    .map((proof, index) => ({
      id: String(proof?.id || `proof-${index + 1}`),
      images: Array.isArray(proof?.images) ? proof.images.filter(Boolean).slice(0, PAYMENT_PROOF_MAX_IMAGES) : [],
      status: PAYMENT_PROOF_STATUSES.has(String(proof?.status || '').toLowerCase())
        ? String(proof.status).toLowerCase()
        : 'pending',
      note: String(proof?.note || ''),
      createdAt: String(proof?.createdAt || proof?.created_at || ''),
      confirmedAt: String(proof?.confirmedAt || proof?.confirmed_at || ''),
      amount: Math.max(0, Math.round(Number(proof?.amount) || 0)),
    }))
    .filter((proof) => proof.images.length);
  const latest = cleanProofs[cleanProofs.length - 1] || null;
  const invoiceStatus = String(invoice?.status || '').toLowerCase();
  const depositAskOpen = data.depositAskOpen !== false;
  const fullyPaid = invoiceStatus === 'paid' || (invoiceStatus === 'deposit' && !depositAskOpen);
  const pending = latest?.status === 'pending';
  const canUpload = !fullyPaid && !pending;

  return {
    proofs: cleanProofs,
    latest,
    hasProof: cleanProofs.length > 0,
    fullyPaid,
    pending,
    canUpload,
    publicLabel: fullyPaid
      ? (invoiceStatus === 'paid' ? 'Payment confirmed' : 'Deposit received')
      : pending
      ? 'Pending review'
      : cleanProofs.length
      ? 'Payment requested'
      : 'Not uploaded yet',
    publicCta: canUpload ? 'Upload' : (cleanProofs.length > 0 ? 'View' : 'Pending'),
  };
}

export function appendPendingPaymentProof(invoiceData = {}, images = []) {
  const list = (Array.isArray(images) ? images : []).filter(Boolean).slice(0, PAYMENT_PROOF_MAX_IMAGES);
  if (!list.length) throw new Error('Please upload at least one payment proof.');
  const existing = Array.isArray(invoiceData.paymentProofs) ? invoiceData.paymentProofs : [];
  const hasPending = existing.some((proof) => String(proof?.status || '').toLowerCase() === 'pending');
  if (hasPending) throw new Error('A proof is already pending review.');
  return {
    ...invoiceData,
    paymentProofs: [
      ...existing,
      {
        id: `proof-${Date.now().toString(36)}`,
        images: list,
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

