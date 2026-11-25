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

// The latest visible proof determines the payment pill: confirmed is complete,
// rejected is explicitly rejected, and pending/other submissions remain created.
export function paymentState(entries = []) {
  if (!entries.length) return '';
  const latestStatus = String(entries[entries.length - 1]?.status || '').toLowerCase();
  if (latestStatus === 'confirmed') return ' is-complete';
  if (latestStatus === 'rejected') return ' is-rejected';
  return ' is-created';
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


// Client delivery state is independent from payment and vendor completion.
export function bookingDeliveryState(group = {}) {
  const rows = Array.isArray(group.deliveries) ? group.deliveries.filter((d) => d && d.type !== 'vendor') : (group.delivery ? [group.delivery] : []);
  const sessions = (Array.isArray(group.sessions) ? group.sessions : []).filter((s) => String(s?.status || s?.state || '').toLowerCase() !== 'cancelled');
  const shared = rows.filter((d) => d?.session_id == null || d.session_id === '');
  const dedicated = rows.filter((d) => d?.session_id != null && d.session_id !== '');
  const done = (d) => d?.delivery_done === true;
  if (!rows.length) return 'processing';
  if (!dedicated.length) return shared.every(done) ? 'delivered' : shared.some(done) ? 'partial' : 'processing';
  if (!shared.length) {
    const states = sessions.length ? sessions.map((s) => { const item = dedicated.find((d) => String(d.session_id) === String(s.id)); return !!item && done(item); }) : dedicated.map(done);
    const n = states.filter(Boolean).length;
    return n === states.length ? 'delivered' : n ? 'partial' : 'processing';
  }
  const uncovered = sessions.filter((s) => !dedicated.some((d) => String(d.session_id) === String(s.id)));
  if (rows.every(done) && (uncovered.length === 0 || shared.every(done))) return 'delivered';
  return rows.some(done) ? 'partial' : 'processing';
}
