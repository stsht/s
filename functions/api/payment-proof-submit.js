const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MAX_IMAGES = 3;
const MAX_DATA_CHARS = 790000;
const GALLERY_SESSION_COOKIE = 'ss_gallery_session';
const GALLERY_HASH_ALGO = 'pbkdf2_sha256';
const GALLERY_HASH_ITERATIONS = 100000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function getSupabase(env) {
  const raw = String(env.SUPABASE_URL || '').trim();
  const url = raw.replace(/\/+$/, '').replace(/\/rest\/v1(?:\/.*)?$/i, '');
  const key = env.SUPABASE_SECRET_KEY || '';
  if (!url || !key) throw new Error('Supabase environment variables are missing.');
  return { url, key };
}

async function supabaseFetch(env, path, options = {}) {
  const { url, key } = getSupabase(env);
  const cleanPath = String(path || '').startsWith('/') ? path : `/${path || ''}`;
  const target = `${url}${cleanPath}`.replace(/([^:])\/{2,}/g, '$1/');
  const response = await fetch(target, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Supabase error ${response.status}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function getCookie(request, name) {
  const cookies = String(request.headers.get('cookie') || '').split(';');
  const prefix = `${name}=`;
  const match = cookies.map((item) => item.trim()).find((item) => item.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : '';
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hmacSha256(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function safeEqual(a = '', b = '') {
  const left = String(a);
  const right = String(b);
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return diff === 0;
}

async function verifyGallerySessionCookie(request, env, deliveryId) {
  const expectedId = String(deliveryId || '').trim();
  const token = getCookie(request, GALLERY_SESSION_COOKIE);
  const parts = token.split('.');
  if (!expectedId || parts.length !== 4) return false;
  const [sessionDeliveryId, expiresAtRaw, nonce, signature] = parts;
  const expiresAt = Number(expiresAtRaw);
  if (sessionDeliveryId !== expectedId || !Number.isFinite(expiresAt) || expiresAt < Date.now() || !nonce || !signature) return false;
  const payload = `${sessionDeliveryId}.${expiresAtRaw}.${nonce}`;
  const expected = await hmacSha256(String(env.ADMIN_PASSWORD || '').trim(), payload);
  return safeEqual(signature, expected);
}

async function deriveGalleryPasswordDigest(password, salt, iterations = GALLERY_HASH_ITERATIONS) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(String(password || '')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(String(salt || '')), iterations, hash: 'SHA-256' }, keyMaterial, 256);
  return base64UrlEncode(new Uint8Array(bits));
}

async function verifyGalleryPassword(delivery, password) {
  const hash = String(delivery?.password_hash || '').trim();
  const salt = String(delivery?.password_salt || '').trim();
  if (hash && salt) {
    const parts = hash.split('$');
    const iterations = parts.length === 3 && parts[0] === GALLERY_HASH_ALGO ? Number(parts[1]) || GALLERY_HASH_ITERATIONS : GALLERY_HASH_ITERATIONS;
    const digest = parts.length === 3 ? parts[2] : hash;
    if (iterations > GALLERY_HASH_ITERATIONS) return false;
    return safeEqual(await deriveGalleryPasswordDigest(password, salt, iterations), digest);
  }
  return safeEqual(String(delivery?.password || ''), String(password || '').trim());
}

function cleanLookup(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

async function getDeliveryByLookup(env, lookup) {
  const clean = cleanLookup(lookup);
  if (!clean) return null;
  const rows = await supabaseFetch(env, `/rest/v1/deliveries?select=*&or=(short_code.eq.${encodeURIComponent(clean)},base_slug.eq.${encodeURIComponent(clean)})&order=created_at.desc&limit=1`).catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : rows || null;
}

function invoiceSummary(invoice = null) {
  if (!invoice?.id) return null;
  return {
    id: invoice.id,
    client_name: invoice.client_name || '',
    client_title: invoice.client_title || '',
    invoice_date: invoice.invoice_date || '',
    event_date: invoice.event_date || '',
    status: invoice.status || '',
    updated_at: invoice.updated_at || '',
  };
}

async function findInvoiceForDelivery(env, delivery = {}) {
  const deliveryId = String(delivery.id || '').trim();
  if (!deliveryId) return null;
  const exact = await supabaseFetch(env, `/rest/v1/invoices?select=*&invoice_data->>delivery_id=eq.${encodeURIComponent(deliveryId)}&order=updated_at.desc&limit=1`).catch(() => []);
  if (Array.isArray(exact) && exact[0]) return exact[0];
  const clientId = String(delivery.client_id || '').trim();
  if (clientId) {
    const byClient = await supabaseFetch(env, `/rest/v1/invoices?select=*&client_id=eq.${encodeURIComponent(clientId)}&order=updated_at.desc&limit=1`).catch(() => []);
    if (Array.isArray(byClient) && byClient[0]) return byClient[0];
  }
  const clientName = String(delivery.client_name || '').trim();
  if (clientName) {
    const byName = await supabaseFetch(env, `/rest/v1/invoices?select=*&client_name=eq.${encodeURIComponent(clientName)}&order=updated_at.desc&limit=1`).catch(() => []);
    if (Array.isArray(byName) && byName[0]) return byName[0];
  }
  return null;
}

function cleanImages(images = []) {
  const list = (Array.isArray(images) ? images : []).map((value) => String(value || '').trim()).filter(Boolean).slice(0, MAX_IMAGES);
  if (!list.length) throw new Error('Please upload at least one payment proof.');
  if (list.some((value) => !/^data:image\/(png|jpe?g|webp);base64,/i.test(value))) throw new Error('Payment proof must be an image.');
  if (list.reduce((sum, value) => sum + value.length, 0) > MAX_DATA_CHARS) throw new Error('Payment proof images are too large.');
  return list;
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders });
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const images = cleanImages(body.images);
    const delivery = await getDeliveryByLookup(env, body.slug || body.shortCode);
    if (!delivery) return json({ error: 'Delivery not found.' }, 404);

    const password = String(body.password || '').trim();
    const authorized = await verifyGallerySessionCookie(request, env, delivery.id) || (password && await verifyGalleryPassword(delivery, password));
    if (!authorized) return json({ error: 'Unauthorized.' }, 401);

    const invoice = await findInvoiceForDelivery(env, delivery);
    if (!invoice?.id) return json({ error: 'Invoice not found.' }, 404);
    if (String(invoice.status || '').toLowerCase() === 'paid') return json({ error: 'Payment is already confirmed.' }, 409);

    const data = invoice.invoice_data && typeof invoice.invoice_data === 'object' ? invoice.invoice_data : {};
    const proofs = Array.isArray(data.paymentProofs) ? data.paymentProofs : [];
    if (proofs.some((proof) => String(proof?.status || '').toLowerCase() === 'pending')) {
      return json({ error: 'A payment proof is already pending review.' }, 409);
    }

    const nextData = {
      ...data,
      paymentProofs: [
        ...proofs,
        { id: `proof-${Date.now().toString(36)}`, images, status: 'pending', createdAt: new Date().toISOString() },
      ],
    };
    const rows = await supabaseFetch(env, `/rest/v1/invoices?id=eq.${encodeURIComponent(invoice.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ invoice_data: nextData }),
    });
    const updated = Array.isArray(rows) ? rows[0] : rows;
    return json({ ok: true, invoice: invoiceSummary(updated) });
  } catch (error) {
    return json({ error: error?.message || 'Could not upload payment proof.' }, 500);
  }
}
