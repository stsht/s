// Shared vendor artifact state for /db event rows and left-list settlement.
// Existing artifacts participate independently: missing optional artifacts do
// not block completion, while any existing unfinished artifact takes priority.

export function invoicePaymentProofs(invoice = {}) {
  const storedEntries = Array.isArray(invoice?.payment_proofs) ? invoice.payment_proofs : [];
  const stored = storedEntries
    .map((entry, entryIndex) => ({
      id: String(entry?.id || `stored-payment-${entryIndex + 1}`),
      status: String(entry?.status || 'pending').toLowerCase(),
      paymentDate: String(entry?.payment_date || entry?.reported_payment_date || ''),
      paymentTime: String(entry?.payment_time || entry?.reported_payment_time || ''),
      paymentProvisional: ['pending', 'rejected'].includes(String(entry?.status || 'pending').toLowerCase()),
      uploadedAt: String(entry?.uploaded_at || entry?.created_at || ''),
      reviewedAt: String(entry?.reviewed_at || ''),
      filename: String(entry?.original_filename || `payment-proof-${entryIndex + 1}.jpg`),
      images: [String(entry?.image_url || '').trim()].filter(Boolean),
    }))
    .filter((entry) => entry.images.length);
  if (stored.length) return stored;

  const data = invoice?.invoice_data && typeof invoice.invoice_data === 'object' ? invoice.invoice_data : {};
  const legacyEntries = Array.isArray(data.paymentProofs) ? data.paymentProofs : [];
  return legacyEntries
    .map((entry, entryIndex) => ({
      id: String(entry?.id || `legacy-payment-${entryIndex + 1}`),
      status: String(entry?.status || 'pending').toLowerCase(),
      paymentDate: '',
      paymentTime: '',
      paymentProvisional: true,
      uploadedAt: String(entry?.createdAt || entry?.created_at || ''),
      reviewedAt: String(entry?.confirmedAt || entry?.confirmed_at || ''),
      filename: `payment-proof-${entryIndex + 1}.jpg`,
      images: Array.isArray(entry?.images)
        ? entry.images.map((image) => String(image || '').trim()).filter(Boolean)
        : [],
    }))
    .filter((entry) => entry.images.length);
}

// Preserve the existing payment-state semantics: the latest visible proof is
// complete only when its status is confirmed; otherwise it remains created.
export function paymentState(entries = []) {
  if (!entries.length) return '';
  const latest = entries[entries.length - 1];
  return String(latest?.status || '').toLowerCase() === 'confirmed' ? ' is-complete' : ' is-created';
}

export function vendorSummaryState(row = {}) {
  const vendorDelivery = row?.vendorDelivery || null;
  const vendorInvoice = row?.vendorInvoice || null;
  const paymentProofs = vendorInvoice?.id ? invoicePaymentProofs(vendorInvoice) : [];
  const artifactCompletion = [];

  if (vendorDelivery?.id) artifactCompletion.push(vendorDelivery.delivery_done === true);
  if (vendorInvoice?.id) {
    artifactCompletion.push(String(vendorInvoice.status || '').trim() === 'paid');
  }
  if (paymentProofs.length) artifactCompletion.push(paymentState(paymentProofs) === ' is-complete');

  return {
    stateClass: artifactCompletion.length
      ? (artifactCompletion.every(Boolean) ? ' is-complete' : ' is-created')
      : '',
    paymentProofs,
  };
}

// Client artifacts are authoritative whenever they genuinely exist. Vendor
// artifacts are considered only for vendor-only groups, preventing a paid
// vendor invoice from masking unfinished client delivery/invoice work.
export function eventGroupIsSettled(group = {}) {
  const hasClientArtifacts = !!group?.delivery || !!group?.invoice;
  if (hasClientArtifacts) {
    return group?.delivery?.delivery_done === true
      && String(group?.invoice?.status || '').trim() === 'paid';
  }
  return vendorSummaryState(group).stateClass === ' is-complete';
}
