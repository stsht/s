import fs from 'node:fs';

const path = '_worker.js';
let text = fs.readFileSync(path, 'utf8');

if (text.includes('handlePaymentProofSubmit')) {
  console.log('payment proof worker patch already applied');
  process.exit(0);
}

const helpers = `
const PUBLIC_PAYMENT_PROOF_MAX_IMAGES = 3;
const PUBLIC_PAYMENT_PROOF_MAX_DATA_CHARS = 790000;

function cleanPublicProofImages(images = []) {
  const list = (Array.isArray(images) ? images : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .slice(0, PUBLIC_PAYMENT_PROOF_MAX_IMAGES);
  if (!list.length) throw new Error('Please upload at least one payment proof.');
  if (list.some((value) => !/^data:image\\/(png|jpe?g|webp);base64,/i.test(value))) {
    throw new Error('Payment proof must be an image.');
  }
  const totalLength = list.reduce((sum, value) => sum + value.length, 0);
  if (totalLength > PUBLIC_PAYMENT_PROOF_MAX_DATA_CHARS) {
    throw new Error('Payment proof images are too large. Please upload smaller screenshots.');
  }
  return list;
}

function paymentProofsFromInvoiceData(invoiceData = {}) {
  return Array.isArray(invoiceData.paymentProofs) ? invoiceData.paymentProofs : [];
}

function appendPendingPaymentProof(invoiceData = {}, images = []) {
  const proofs = paymentProofsFromInvoiceData(invoiceData);
  if (proofs.some((proof) => String(proof?.status || '').toLowerCase() === 'pending')) {
    throw new Error('A payment proof is already pending review.');
  }
  return {
    ...invoiceData,
    paymentProofs: [
      ...proofs,
      {
        id: \`proof-\${Date.now().toString(36)}\`,
        images,
        status: 'pending',
        createdAt: new Date().toISOString()
      }
    ]
  };
}
`;

const helperAnchor = 'let lastRateLimitSweep = 0;\n';
if (!text.includes(helperAnchor)) throw new Error('helper anchor not found');
text = text.replace(helperAnchor, helperAnchor + helpers + '\n');

const handler = `
async function handlePaymentProofSubmit(request, env) {
  const body = await request.json().catch(() => ({}));
  const lookup = String(body.slug || body.shortCode || '').trim();
  const password = String(body.password || '').trim();
  const images = cleanPublicProofImages(body.images);

  const delivery = await getDeliveryByLookup(env, lookup);
  if (!delivery) return json({ error: 'Delivery not found.' }, 404);

  const galleryBypass = await verifyGallerySessionCookie(request, env, delivery.id);
  const passwordOk = password ? await verifyGalleryPassword(delivery, password) : false;
  if (!galleryBypass && !passwordOk) return json({ error: 'Unauthorized.' }, 401);

  const invoice = await findInvoiceForDelivery(env, delivery);
  if (!invoice?.id) return json({ error: 'Invoice not found.' }, 404);
  if (String(invoice.status || '').toLowerCase() === 'paid') {
    return json({ error: 'Payment is already confirmed.' }, 409);
  }

  const currentData = invoice.invoice_data && typeof invoice.invoice_data === 'object' ? invoice.invoice_data : {};
  const nextData = appendPendingPaymentProof(currentData, images);
  const rows = await supabaseFetch(env, \`/rest/v1/invoices?id=eq.\${encodeURIComponent(invoice.id)}\`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ invoice_data: nextData })
  });
  const updatedInvoice = Array.isArray(rows) ? rows[0] : rows;
  await insertLog(env, request, delivery.id, 'payment_proof_uploaded', 'invoice');
  return json({ ok: true, invoice: invoiceSummary(updatedInvoice) });
}
`;

const handlerAnchor = 'async function handleClick(request, env) {';
if (!text.includes(handlerAnchor)) throw new Error('handler anchor not found');
text = text.replace(handlerAnchor, handler + '\n' + handlerAnchor);

const routeAnchor = "      if (request.method === 'POST' && url.pathname === '/api/unlock') return await handleUnlock(request, env);\n";
if (!text.includes(routeAnchor)) throw new Error('route anchor not found');
text = text.replace(routeAnchor, routeAnchor + "      if (request.method === 'POST' && url.pathname === '/api/payment-proof-submit') return await handlePaymentProofSubmit(request, env);\n");

fs.writeFileSync(path, text);
console.log('patched _worker.js payment proof endpoint');
