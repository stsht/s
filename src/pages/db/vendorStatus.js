// Shared artifact state for /db event rows and left-list settlement.
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

function appendInvoiceArtifacts(artifactCompletion, invoice) {
  if (!invoice?.id) return [];
  artifactCompletion.push(String(invoice.status || '').trim() === 'paid');
  const paymentProofs = invoicePaymentProofs(invoice);
  if (paymentProofs.length) {
    artifactCompletion.push(paymentState(paymentProofs) === ' is-complete');
  }
  return paymentProofs;
}

export function vendorSummaryState(row = {}) {
  const vendorDelivery = row?.vendorDelivery || null;
  const vendorInvoice = row?.vendorInvoice || null;
  const artifactCompletion = [];

  if (vendorDelivery?.id) artifactCompletion.push(vendorDelivery.delivery_done === true);
  const paymentProofs = appendInvoiceArtifacts(artifactCompletion, vendorInvoice);

  return {
    stateClass: artifactCompletion.length
      ? (artifactCompletion.every(Boolean) ? ' is-complete' : ' is-created')
      : '',
    paymentProofs,
  };
}

// A past event is settled when at least one confidently linked artifact exists
// and every existing artifact is complete. Missing optional Links, Invoice, or
// Payments records do not count as unfinished work. Client and vendor artifacts
// in the same event group are all evaluated, so completed vendor work cannot
// hide an unfinished client artifact (or vice versa).
export function eventGroupIsSettled(group = {}) {
  const artifactCompletion = [];

  if (group?.delivery?.id) artifactCompletion.push(group.delivery.delivery_done === true);
  appendInvoiceArtifacts(artifactCompletion, group?.invoice);
  if (group?.vendorDelivery?.id) artifactCompletion.push(group.vendorDelivery.delivery_done === true);
  appendInvoiceArtifacts(artifactCompletion, group?.vendorInvoice);

  return artifactCompletion.length > 0 && artifactCompletion.every(Boolean);
}
