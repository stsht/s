const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const SERVICES = [
  { key: 'gd', label: 'Google Drive' },
  { key: 'db', label: 'Dropbox' },
  { key: 'wt', label: 'WeTransfer' },
  { key: 'tn', label: 'TransferNow' }
];

// Generated short codes/passwords intentionally exclude lowercase l.
const SHORT_ALPHABET = '1236789abcdefghijkmnopqrstuvwxyz';
const SHORT_CODE_LENGTH = 12;
const LEGACY_SHORT_CODE_LENGTH = 7;
const GALLERY_PASSWORD_LENGTH = 7;
const PUBLIC_SITE = 'https://starshots.pages.dev';
const LOGO_PATH = '/logo-hero.png';
const ADMIN_SESSION_COOKIE = 'ss_admin_session';
const ADMIN_SESSION_MS = 15 * 60 * 1000;
const GALLERY_HASH_ALGO = 'pbkdf2_sha256';
const GALLERY_HASH_ITERATIONS = 100000;
const IP_INFO_CACHE = new Map();
const RATE_LIMITS = new Map();
let lastRateLimitSweep = 0;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', ...headers }
  });
}

function getSupabase(env) {
  // Defensive normalisation. PostgREST returns PGRST125 ("Invalid path
  // specified in request URL") whenever the request URL is malformed,
  // and the two malformations we have observed in deploys are:
  //   1. SUPABASE_URL with a trailing slash (or several) -> when our
  //      canonical "/rest/v1/..." paths are appended the resulting
  //      URL contains "//" after the host.
  //   2. SUPABASE_URL configured to already include the "/rest/v1"
  //      suffix -> appending "/rest/v1/..." again produces
  //      "/rest/v1/rest/v1/...", which PostgREST rejects.
  // Stripping both shapes here makes supabaseFetch robust regardless
  // of how SUPABASE_URL is set at deploy time.
  const raw = String(env.SUPABASE_URL || '').trim();
  const url = raw
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1(?:\/.*)?$/i, '');
  const key = env.SUPABASE_SECRET_KEY || '';
  if (!url || !key) throw new Error('Supabase environment variables are missing.');
  return { url, key };
}

async function supabaseFetch(env, path, options = {}) {
  const { url, key } = getSupabase(env);
  const cleanPath = String(path || '').startsWith('/') ? path : `/${path || ''}`;
  // Collapse any accidental "//" inside the path portion (anywhere
  // other than directly after the "https:" scheme separator).
  const target = `${url}${cleanPath}`.replace(/([^:])\/{2,}/g, '$1/');
  const response = await fetch(target, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch {}
    const error = new Error(parsed?.message || text || `Supabase error ${response.status}`);
    error.status = response.status;
    error.code = parsed?.code || '';
    error.supabase = true;
    throw error;
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function getAdminPassword(env) {
  const password = String(env.ADMIN_PASSWORD || '').trim();
  if (!password) {
    throw new Error('ADMIN_PASSWORD Cloudflare Secret is missing. Run: npx wrangler pages secret put ADMIN_PASSWORD --project-name=starshots');
  }
  return password;
}

async function verifyAdminPassword(env, password) {
  return safeEqual(String(password || '').trim(), getAdminPassword(env));
}

function safeEqual(a = '', b = '') {
  const left = String(a);
  const right = String(b);
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return diff === 0;
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomToken(byteLength = 16) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function sha256Bytes(value) {
  const data = new TextEncoder().encode(String(value || ''));
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

function codeFromBytes(bytes, length = SHORT_CODE_LENGTH) {
  let code = '';
  for (let i = 0; code.length < length; i += 1) {
    const byte = bytes[i % bytes.length] ^ ((i * 29 + length) & 255);
    code += SHORT_ALPHABET[byte % SHORT_ALPHABET.length];
  }
  return code;
}

function normalizeCodePart(value = '', max = 80) {
  return String(value || '')
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/["'’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function stripCodeBrackets(value = '') {
  return String(value || '').replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ');
}

function deliveryCodeContext(raw = {}) {
  const folder = normalizeCodePart(raw.folderName || raw.folder_name || raw.baseSlug || raw.base_slug, 160);
  const parts = stripCodeBrackets(folder).split(/\s+/).filter(Boolean);
  let yymmdd = '';
  let firstName = '';
  if (/^\d{6}$/.test(parts[0] || '')) {
    yymmdd = parts[0];
    firstName = parts[1] || '';
  } else if (/^\d{8}$/.test(parts[0] || '')) {
    yymmdd = parts[0].slice(2);
    firstName = parts[1] || '';
  } else {
    firstName = parts[0] || '';
  }
  const clientName = normalizeCodePart(raw.clientName || raw.client_name || raw.name, 160);
  return {
    yymmdd,
    firstName: firstName || clientName.split(' ')[0] || '',
    title: normalizeCodePart(raw.title || raw.client_title || 'Ms.', 20),
    clientName
  };
}

async function contextCode(purpose, length, raw = {}, extra = '') {
  const context = deliveryCodeContext(raw);
  const nonce = randomToken(24);
  const digest = await sha256Bytes([
    purpose,
    context.yymmdd,
    context.firstName,
    context.title,
    context.clientName,
    extra,
    Date.now(),
    nonce
  ].join('|'));
  return codeFromBytes(digest, length);
}

async function hmacSha256(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function getCookie(request, name) {
  const cookies = String(request.headers.get('cookie') || '').split(';');
  const prefix = `${name}=`;
  const match = cookies.map((item) => item.trim()).find((item) => item.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : '';
}

async function createAdminSessionCookie(env) {
  const expiresAt = Date.now() + ADMIN_SESSION_MS;
  const nonce = randomToken(12);
  const payload = `${expiresAt}.${nonce}`;
  const signature = await hmacSha256(getAdminPassword(env), payload);
  return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(`${payload}.${signature}`)}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

async function verifyAdminSessionCookie(request, env) {
  const token = getCookie(request, ADMIN_SESSION_COOKIE);
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expiresAtRaw, nonce, signature] = parts;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() || !nonce || !signature) return false;
  const payload = `${expiresAtRaw}.${nonce}`;
  const expected = await hmacSha256(getAdminPassword(env), payload);
  return safeEqual(signature, expected);
}

async function verifyAdminRequest(request, env, password = '') {
  if (await verifyAdminSessionCookie(request, env)) return true;
  return verifyAdminPassword(env, password);
}

async function deriveGalleryPasswordDigest(password, salt, iterations = GALLERY_HASH_ITERATIONS) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(String(password || '')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(String(salt || '')), iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return base64UrlEncode(new Uint8Array(bits));
}

async function hashGalleryPassword(password) {
  const salt = randomToken(16);
  const digest = await deriveGalleryPasswordDigest(password, salt);
  return {
    password_hash: `${GALLERY_HASH_ALGO}$${GALLERY_HASH_ITERATIONS}$${digest}`,
    password_salt: salt
  };
}

function parseGalleryHash(value = '') {
  const raw = String(value || '').trim();
  const parts = raw.split('$');
  if (parts.length === 3 && parts[0] === GALLERY_HASH_ALGO) {
    return { iterations: Number(parts[1]) || GALLERY_HASH_ITERATIONS, digest: parts[2], formatted: true };
  }
  return { iterations: GALLERY_HASH_ITERATIONS, digest: raw, formatted: false };
}

async function verifyGalleryPassword(delivery, password) {
  const hash = String(delivery?.password_hash || '').trim();
  const salt = String(delivery?.password_salt || '').trim();
  if (hash && salt) {
    const parsed = parseGalleryHash(hash);
    if (parsed.iterations > GALLERY_HASH_ITERATIONS) return false;
    const digest = await deriveGalleryPasswordDigest(password, salt, parsed.iterations);
    return safeEqual(digest, parsed.digest);
  }
  return safeEqual(String(delivery?.password || ''), String(password || '').trim());
}

function cleanSlug(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizeGalleryCode(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const match = normalized.match(/^(\d{6})\s*([a-z0-9].*)$/);
  if (!match) return '';
  const rest = match[2].trim().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return rest ? `${match[1]}-${rest}`.slice(0, 80) : '';
}


function titleCaseName(value) {
  return String(value || '')
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function galleryCodeFromSlug(slug) {
  const parts = String(slug || '').split('-').filter(Boolean);
  if (!parts.length) return '';
  return `${parts[0]} ${titleCaseName(parts.slice(1).join(' '))}`.trim();
}

function legacyShortCodeFrom(baseSlug, password = '', clientName = '') {
  const input = `${cleanSlug(baseSlug)}|${String(password || '').trim()}|${String(clientName || '').trim().toLowerCase()}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
  let n = hash || 1;
  let code = '';
  for (let i = 0; i < 7; i += 1) {
    code += alphabet[n % alphabet.length];
    n = (Math.floor(n / alphabet.length) ^ Math.imul(i + 17, 2654435761)) >>> 0;
  }
  return code;
}

function seededShortCodeFrom(seed, baseSlug, password = '', clientName = '', deliveryId = '') {
  const input = `${String(seed || '').trim()}|${String(deliveryId || '').trim()}|${cleanSlug(baseSlug)}|${String(password || '').trim()}|${String(clientName || '').trim().toLowerCase()}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  let n = hash || 1;
  let code = '';
  for (let i = 0; i < 7; i += 1) {
    code += SHORT_ALPHABET[n % SHORT_ALPHABET.length];
    n = (Math.floor(n / SHORT_ALPHABET.length) ^ Math.imul(i + 23, 2654435761)) >>> 0;
  }
  return code;
}



function randomShortCode(length = SHORT_CODE_LENGTH) {
  let code = '';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) code += SHORT_ALPHABET[byte % SHORT_ALPHABET.length];
  return code;
}

function cleanShortCode(value) {
  const code = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (code.length === LEGACY_SHORT_CODE_LENGTH) return /^[a-z0-9]{7}$/.test(code) ? code : '';
  if (code.length !== SHORT_CODE_LENGTH) return '';
  return /^[1236789abcdefghijklmnopqrstuvwxyz]+$/.test(code) ? code : '';
}

function shortCodeFromText(value = '') {
  const text = String(value || '');
  // Match the canonical `starshots.pages.dev/<short>` form first;
  // also accept the legacy host (`sshots.pages.dev`) and the legacy
  // `/g/<short>` path prefix so an existing stored generated_text
  // template (saved before the canonical short-form rollout) still
  // yields its short_code unchanged. We never rewrite the slug —
  // only canonicalize how it is displayed/copied.
  const match = text.match(
    /(?:https?:\/\/)?(?:www\.)?(?:starshots|sshots)\.pages\.dev\/(?:g\/)?([a-z0-9]{7}|[a-z0-9]{12})(?![a-z0-9-])/i,
  );
  return match ? cleanShortCode(match[1]) : '';
}

function deliveryPasswordForDisplay(delivery = {}) {
  const plain = String(delivery.password || '').trim();
  if (plain) return plain;
  const text = [delivery.generated_text_whatsapp, delivery.generated_text_instagram].filter(Boolean).join('\n');
  const match = text.match(/password\s*:\s*([^\n\r]+)/i);
  return match ? String(match[1] || '').trim() : '';
}

function deliveryShortCode(delivery = {}) {
  return cleanShortCode(delivery.short_code);
}

function deliveryMatchesShortCode(delivery, target, env) {
  const code = cleanShortCode(target);
  if (!code) return false;
  return deliveryShortCode(delivery) === code;
}

async function uniqueShortCode(env, context = {}) {
  for (let i = 0; i < 10; i += 1) {
    const candidate = await contextCode('short-code', SHORT_CODE_LENGTH, context, String(i));
    const existing = await getDeliveryByShortCode(env, candidate).catch(() => null);
    if (!existing) return candidate;
  }
  return randomShortCode();
}

async function generateGalleryPassword(context = {}, shortCode = '') {
  return contextCode('gallery-password', GALLERY_PASSWORD_LENGTH, context, `${shortCode}|${context.title || context.client_title || ''}`);
}

function buildDeliveryMessage(title, clientName, shortCode, password) {
  return `Dear ${String(title || 'Ms.').trim()} ${String(clientName || '').trim()},

With sincere appreciation, your StarShots delivery files have been prepared and are now ready for your kind attention.

You may access them through the details below:

• Link: ${PUBLIC_SITE}/${shortCode}
• Password: ${String(password || '').trim()}

Kindly download the files within the stated availability period.

It has been our pleasure to serve you, and we look forward to welcoming you again.

Warm regards,
StarShots`;
}

// Instagram DM variant. Same information as the WhatsApp template
// but reflowed into a single short paragraph: no bullet list, no
// hard line breaks, friendly DM tone. WhatsApp is read in a chat
// pane that wraps multi-line bodies cleanly; Instagram DM collapses
// repeated newlines and looks broken with bullet glyphs, so the
// IG variant ships as one continuous sentence chain instead.
function buildDeliveryMessageIg(title, clientName, shortCode, password) {
  const t = String(title || 'Ms.').trim() || 'Ms.';
  const n = String(clientName || '').trim();
  const link = `${PUBLIC_SITE}/${shortCode}`;
  const p = String(password || '').trim();
  return `Hi ${t} ${n}! Your StarShots delivery files are ready — access them at ${link} using password ${p}. Please download within the stated availability period. With love, StarShots.`;
}

async function getDeliveryByShortCode(env, code) {
  const target = cleanShortCode(code);
  if (!target) return null;
  try {
    const directRows = await supabaseFetch(
      env,
      `/rest/v1/deliveries?select=*&short_code=eq.${encodeURIComponent(target)}&order=created_at.desc&limit=1`
    );
    const direct = Array.isArray(directRows) ? directRows[0] : directRows;
    if (direct) return direct;
  } catch (error) {
    if (!isSchemaError(error)) throw error;
  }
  const rows = await supabaseFetch(
    env,
    '/rest/v1/deliveries?select=*&order=created_at.desc&limit=1000'
  );
  const deliveries = Array.isArray(rows) ? rows : [];
  return deliveries.find((d) => deliveryMatchesShortCode(d, target, env)) || null;
}

function cleanService(value) {
  const service = String(value || '').toLowerCase();
  return SERVICES.some((item) => item.key === service) ? service : '';
}

function normalizeUrl(value) {
  let v = String(value || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v) && /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#].*)?$/i.test(v)) v = `https://${v}`;
  try {
    const parsed = new URL(v);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    if (!parsed.hostname || !parsed.hostname.includes('.')) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function cleanText(value = '', max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeClientName(value = '') {
  return cleanText(value, 160)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeClientContact(value = '') {
  return cleanText(value, 240)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^\d+a-z@._-]/g, '')
    .trim();
}

function cleanClientTitle(value = '') {
  const title = cleanText(value, 20);
  return title || 'Ms.';
}

function cleanClientPayload(raw = {}) {
  const name = cleanText(raw.name ?? raw.client_name ?? raw.clientName, 160);
  return {
    title: cleanClientTitle(raw.title ?? raw.client_title),
    name,
    contact: cleanText(raw.contact ?? raw.client_contact ?? raw.clientContact, 240),
    normalized_name: normalizeClientName(name)
  };
}

function isSchemaError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('schema cache') || message.includes('column') || message.includes('relation') || message.includes('does not exist');
}

function uniqueIds(ids = []) {
  return [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean))];
}

function inFilter(ids = []) {
  return uniqueIds(ids).map((id) => encodeURIComponent(id)).join(',');
}

async function fetchClientById(env, id = '') {
  const cleanId = String(id || '').trim();
  if (!cleanId || cleanId.startsWith('legacy:')) return null;
  try {
    const rows = await supabaseFetch(env, `/rest/v1/clients?select=*&id=eq.${encodeURIComponent(cleanId)}&limit=1`);
    return Array.isArray(rows) ? rows[0] : rows;
  } catch (error) {
    if (isSchemaError(error)) return null;
    throw error;
  }
}

async function fetchClients(env) {
  try {
    const rows = await supabaseFetch(env, '/rest/v1/clients?select=*&order=updated_at.desc&limit=500');
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (isSchemaError(error)) return [];
    throw error;
  }
}

async function findDuplicateClient(env, fields, currentId = '') {
  if (!fields.normalized_name) return null;
  let rows = [];
  try {
    rows = await supabaseFetch(env, `/rest/v1/clients?select=*&normalized_name=eq.${encodeURIComponent(fields.normalized_name)}&limit=50`);
  } catch (error) {
    if (isSchemaError(error)) return null;
    throw error;
  }
  const cleanCurrent = String(currentId || '').trim();
  const contact = normalizeClientContact(fields.contact);
  return (Array.isArray(rows) ? rows : []).find((client) => {
    if (String(client.id || '') === cleanCurrent) return false;
    return normalizeClientContact(client.contact) === contact;
  }) || null;
}

async function findOrCreateClient(env, raw = {}, preferredId = '') {
  const preferred = await fetchClientById(env, preferredId).catch(() => null);
  if (preferred?.id) return preferred;

  const fields = cleanClientPayload(raw);
  if (!fields.normalized_name) return null;

  try {
    const existingRows = await supabaseFetch(env, `/rest/v1/clients?select=*&normalized_name=eq.${encodeURIComponent(fields.normalized_name)}&limit=50`);
    const contact = normalizeClientContact(fields.contact);
    const existingList = Array.isArray(existingRows) ? existingRows : [];
    const existing = existingList.find((client) => normalizeClientContact(client.contact) === contact)
      || (!contact ? existingList.find((client) => !normalizeClientContact(client.contact)) : null);
    if (existing?.id) return existing;

    const rows = await supabaseFetch(env, '/rest/v1/clients', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        title: fields.title,
        name: fields.name,
        contact: fields.contact,
        normalized_name: fields.normalized_name,
        updated_at: new Date().toISOString()
      })
    });
    return Array.isArray(rows) ? rows[0] : rows;
  } catch (error) {
    if (isSchemaError(error)) return null;
    throw error;
  }
}

function requestMeta(request) {
  return {
    ip_address: request.headers.get('cf-connecting-ip') || '',
    country: request.cf?.country || request.headers.get('cf-ipcountry') || '',
    city: request.cf?.city || '',
    user_agent: request.headers.get('user-agent') || ''
  };
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip')
    || String(request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || 'local';
}

function sweepRateLimits(now = Date.now()) {
  if (now - lastRateLimitSweep < 5 * 60 * 1000) return;
  lastRateLimitSweep = now;
  for (const [key, item] of RATE_LIMITS.entries()) {
    if ((item.blockedUntil || item.resetAt || 0) < now) RATE_LIMITS.delete(key);
  }
}

function checkRateLimit(request, scope, rule = {}) {
  const now = Date.now();
  sweepRateLimits(now);
  const limit = Number(rule.limit) || 30;
  const windowMs = Number(rule.windowMs) || 60 * 1000;
  const blockMs = Number(rule.blockMs) || 10 * 60 * 1000;
  const key = `${scope}:${clientIp(request)}`;
  const item = RATE_LIMITS.get(key) || { count: 0, resetAt: now + windowMs, blockedUntil: 0 };
  if (item.blockedUntil && item.blockedUntil > now) {
    return { limited: true, retryAfter: Math.ceil((item.blockedUntil - now) / 1000) };
  }
  if (!item.resetAt || item.resetAt <= now) {
    item.count = 0;
    item.resetAt = now + windowMs;
    item.blockedUntil = 0;
  }
  item.count += 1;
  if (item.count > limit) {
    item.blockedUntil = now + blockMs;
    RATE_LIMITS.set(key, item);
    return { limited: true, retryAfter: Math.ceil(blockMs / 1000) };
  }
  RATE_LIMITS.set(key, item);
  return { limited: false, retryAfter: 0 };
}

function rateLimitedResponse(retryAfter = 60, asJson = true) {
  const headers = { 'Retry-After': String(Math.max(1, retryAfter)) };
  return asJson
    ? json({ error: 'Too many attempts. Please try again later.' }, 429, headers)
    : new Response('Too many attempts. Please try again later.', { status: 429, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
}

function enforceRateLimit(request, scope, rule, asJson = true) {
  const result = checkRateLimit(request, scope, rule);
  return result.limited ? rateLimitedResponse(result.retryAfter, asJson) : null;
}

// Clear a rate-limit counter for a specific (scope, IP) pair. Used on
// successful auth so the owner doesn't accumulate failed-attempt
// pressure across legitimate sessions.
function clearRateLimit(request, scope) {
  RATE_LIMITS.delete(`${scope}:${clientIp(request)}`);
}

// Read-only lockout check. Returns whether (scope, IP) is currently
// blocked, WITHOUT incrementing the counter. Used so a successful
// password attempt never contributes toward its own lockout.
function checkLockout(request, scope) {
  const now = Date.now();
  const item = RATE_LIMITS.get(`${scope}:${clientIp(request)}`);
  if (!item || !item.blockedUntil || item.blockedUntil <= now) {
    return { limited: false, retryAfter: 0 };
  }
  return { limited: true, retryAfter: Math.ceil((item.blockedUntil - now) / 1000) };
}

// Record a single failed attempt against (scope, IP). Increments the
// in-window counter and arms the block window once the limit is
// exceeded. Successful attempts MUST NOT call this — see
// handleAdminCheck for the failure-only flow.
function recordFailure(request, scope, rule = {}) {
  const now = Date.now();
  sweepRateLimits(now);
  const limit = Number(rule.limit) || 30;
  const windowMs = Number(rule.windowMs) || 60 * 1000;
  const blockMs = Number(rule.blockMs) || 30 * 1000;
  const key = `${scope}:${clientIp(request)}`;
  const item = RATE_LIMITS.get(key) || { count: 0, resetAt: now + windowMs, blockedUntil: 0 };
  if (!item.resetAt || item.resetAt <= now) {
    item.count = 0;
    item.resetAt = now + windowMs;
    item.blockedUntil = 0;
  }
  item.count += 1;
  if (item.count > limit) {
    item.blockedUntil = now + blockMs;
  }
  RATE_LIMITS.set(key, item);
}

function cleanIspName(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

async function lookupIpIsp(ip) {
  const cleanIp = String(ip || '').trim();
  if (!cleanIp) return '';

  const cached = IP_INFO_CACHE.get(cleanIp);
  if (cached && cached.expiresAt > Date.now()) return cached.isp;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  let isp = '';
  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(cleanIp)}?fields=success,connection`, {
      signal: controller.signal
    });
    if (response.ok) {
      const data = await response.json();
      if (data?.success !== false) {
        isp = cleanIspName(data?.connection?.isp || data?.connection?.org || data?.connection?.domain || '');
      }
    }
  } catch (error) {
    isp = '';
  } finally {
    clearTimeout(timer);
  }

  IP_INFO_CACHE.set(cleanIp, { isp, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
  return isp;
}

// IP/ISP enrichment helper. No longer called by /api/db (the
// dashboard payload now skips this enrichment to keep first-paint
// fast — see the comment block in handleDbSearch). Kept here so a
// future per-delivery details endpoint can lazy-load ISP lookups
// for an expanded log view without re-deriving the cache /
// timeout / fan-out cap.
async function enrichLogsWithIpInfo(logs = []) {
  if (!Array.isArray(logs) || !logs.length) return [];
  const ips = [...new Set(logs.map((log) => String(log.ip_address || '').trim()).filter(Boolean))].slice(0, 40);
  const entries = await Promise.all(ips.map(async (ip) => [ip, await lookupIpIsp(ip)]));
  const ispByIp = new Map(entries);
  return logs.map((log) => ({
    ...log,
    isp: ispByIp.get(String(log.ip_address || '').trim()) || ''
  }));
}

async function insertLog(env, request, deliveryId, eventType, service = null) {
  if (!deliveryId || !eventType) return;
  const meta = requestMeta(request);
  await supabaseFetch(env, '/rest/v1/delivery_access_logs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      delivery_id: deliveryId,
      event_type: eventType,
      service,
      ...meta
    })
  }).catch(() => {});
}


async function getLatestDeliveryBySlug(env, slug) {
  const clean = cleanSlug(slug);
  if (!clean) return null;
  const rows = await supabaseFetch(
    env,
    `/rest/v1/deliveries?select=*&base_slug=eq.${encodeURIComponent(clean)}&order=created_at.desc&limit=1`
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function getDeliveryByLookup(env, value) {
  const shortCode = cleanShortCode(value);
  if (shortCode) return getDeliveryByShortCode(env, shortCode);
  return getLatestDeliveryBySlug(env, value);
}

function explicitShortCode(delivery = {}) {
  return cleanShortCode(delivery.short_code)
    || shortCodeFromText(delivery.generated_text_whatsapp)
    || shortCodeFromText(delivery.generated_text_instagram);
}

function shouldBlockFolderSlug(delivery = {}) {
  if (!delivery) return false;
  const hasPassword = String(delivery.password_hash || delivery.password || '').trim()
    || deliveryPasswordForDisplay(delivery);
  return !!(explicitShortCode(delivery) && hasPassword);
}

async function getLinksByDeliveryId(env, deliveryId) {
  if (!deliveryId) return [];
  const rows = await supabaseFetch(
    env,
    `/rest/v1/delivery_links?select=*&delivery_id=eq.${encodeURIComponent(deliveryId)}&order=created_at.asc`
  );
  return Array.isArray(rows) ? rows : [];
}

function buildClientSummaries(clientRows = [], invoices = [], deliveries = [], subscriptions = [], q = '') {
  const byId = new Map();
  const byNormalized = new Map();
  const legacy = new Map();

  const makeSummary = (source, seed = {}) => ({
    id: source === 'client' ? String(seed.id || '') : `legacy:${seed.normalized_name || 'unknown'}`,
    client_id: source === 'client' ? String(seed.id || '') : '',
    source,
    title: cleanClientTitle(seed.title || seed.client_title),
    name: cleanText(seed.name || seed.client_name || 'Client', 160),
    contact: cleanText(seed.contact || seed.client_contact || '', 240),
    normalized_name: seed.normalized_name || normalizeClientName(seed.name || seed.client_name),
    updated_at: seed.updated_at || seed.created_at || '',
    invoice_count: 0,
    delivery_count: 0,
    subscription_count: 0,
    invoice_ids: [],
    delivery_ids: [],
    subscription_ids: []
  });

  (Array.isArray(clientRows) ? clientRows : []).forEach((client) => {
    const summary = makeSummary('client', client);
    if (!summary.client_id || !summary.normalized_name) return;
    byId.set(summary.client_id, summary);
    if (!byNormalized.has(summary.normalized_name)) byNormalized.set(summary.normalized_name, summary);
  });

  const bucketFor = (record, type) => {
    const clientId = String(record.client_id || '').trim();
    if (clientId && byId.has(clientId)) return byId.get(clientId);
    const normalized = normalizeClientName(record.client_name || record.name);
    if (!normalized) return null;
    if (byNormalized.has(normalized)) return byNormalized.get(normalized);
    if (!legacy.has(normalized)) legacy.set(normalized, makeSummary('legacy', { ...record, normalized_name: normalized }));
    const summary = legacy.get(normalized);
    if (!summary.contact && record.client_contact) summary.contact = cleanText(record.client_contact, 240);
    if (!summary.updated_at || new Date(record.updated_at || record.created_at || 0) > new Date(summary.updated_at || 0)) {
      summary.updated_at = record.updated_at || record.created_at || summary.updated_at;
    }
    return summary;
  };

  (Array.isArray(invoices) ? invoices : []).forEach((invoice) => {
    const summary = bucketFor(invoice, 'invoice');
    if (!summary) return;
    summary.invoice_count += 1;
    summary.invoice_ids.push(String(invoice.id));
    if (!summary.contact && invoice.client_contact) summary.contact = cleanText(invoice.client_contact, 240);
  });

  (Array.isArray(deliveries) ? deliveries : []).forEach((delivery) => {
    const summary = bucketFor(delivery, 'delivery');
    if (!summary) return;
    summary.delivery_count += 1;
    summary.delivery_ids.push(String(delivery.id));
  });

  (Array.isArray(subscriptions) ? subscriptions : []).forEach((sub) => {
    const summary = bucketFor(sub, 'subscription');
    if (!summary) return;
    summary.subscription_count += 1;
    summary.subscription_ids.push(String(sub.id));
    if (!summary.contact && sub.client_contact) summary.contact = cleanText(sub.client_contact, 240);
    if (!summary.updated_at || new Date(sub.updated_at || sub.created_at || 0) > new Date(summary.updated_at || 0)) {
      summary.updated_at = sub.updated_at || sub.created_at || summary.updated_at;
    }
  });

  const query = String(q || '').toLowerCase();
  return [...byId.values(), ...legacy.values()]
    .filter((client) => (
      client.source === 'client'
      || Number(client.invoice_count || 0) > 0
      || Number(client.delivery_count || 0) > 0
      || Number(client.subscription_count || 0) > 0
    ))
    .filter((client) => !query || [
      client.title,
      client.name,
      client.contact,
      client.normalized_name,
      client.invoice_count,
      client.delivery_count
    ].join(' ').toLowerCase().includes(query))
    .sort((a, b) => (Date.parse(b.updated_at || '') || 0) - (Date.parse(a.updated_at || '') || 0))
    .slice(0, 300);
}

function clientMatchKeys(record = {}) {
  const keys = [];
  const clientId = String(record.client_id || '').trim();
  const normalized = normalizeClientName(record.client_name || record.name);
  if (clientId) keys.push(`id:${clientId}`);
  if (normalized) keys.push(`name:${normalized}`);
  return keys;
}

function latestByClientKey(records = []) {
  const map = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    clientMatchKeys(record).forEach((key) => {
      if (!map.has(key)) map.set(key, record);
    });
  });
  return map;
}

function relatedByClientKey(record = {}, map = new Map()) {
  for (const key of clientMatchKeys(record)) {
    if (map.has(key)) return map.get(key);
  }
  return null;
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
    updated_at: invoice.updated_at || ''
  };
}

function deliverySummary(delivery = null) {
  if (!delivery?.id) return null;
  const shortCode = deliveryShortCode(delivery);
  const shortPath = shortCode ? `/${shortCode}` : '';
  return {
    id: delivery.id,
    client_name: delivery.client_name || '',
    folder_name: delivery.folder_name || '',
    delivery_year: delivery.delivery_year || '',
    delivery_month: delivery.delivery_month || '',
    base_slug: delivery.base_slug || '',
    short_code: shortCode,
    delivery_url: shortPath,
    short_url: shortPath
  };
}

async function patchRowsByIds(env, table, ids = [], payload = {}, clientId = '') {
  const cleanIds = uniqueIds(ids);
  if (!cleanIds.length) return [];
  const path = `/rest/v1/${table}?id=in.(${inFilter(cleanIds)})`;
  const withClient = clientId ? { ...payload, client_id: clientId } : payload;
  try {
    const rows = await supabaseFetch(env, path, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(withClient)
    });
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (!clientId || !isSchemaError(error)) throw error;
    const rows = await supabaseFetch(env, path, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    });
    return Array.isArray(rows) ? rows : [];
  }
}

async function patchRowsByClientId(env, table, clientId = '', payload = {}) {
  if (!clientId) return [];
  try {
    const rows = await supabaseFetch(env, `/rest/v1/${table}?client_id=eq.${encodeURIComponent(clientId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload)
    });
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (isSchemaError(error)) return [];
    throw error;
  }
}

function shellStyles() {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600;700&display=swap');
    :root{
      color-scheme:light;
      --bg:#F6F6F3;--bg2:#F6F6F3;--card:#FFFFFF;--solid:#ffffff;--field:#f8f8f6;
      --ink:#1f1a17;--soft:#69645f;--muted:#98928b;--line:#e4e2dc;--line2:#d6d3cc;
      --accent:#5f95f5;--accent2:#4f86ee;--accentSoft:rgba(95,149,245,.12);--disabled:#e5ded3;
      --green:#357f58;--danger:#bc3b42;--shadow:0 30px 90px rgba(30,30,28,.10);--shadow2:0 12px 34px rgba(30,30,28,.07);
      --glow1:rgba(255,255,255,.66);--glow2:rgba(212,205,188,.08);--grain:rgba(80,64,44,.028);
    }
    @media(prefers-color-scheme:dark){
      :root{
        color-scheme:dark;--bg:#11110F;--bg2:#11110F;--card:#171613;--solid:#1c1b17;--field:#141310;
        --ink:#f4eee5;--soft:#b8aea2;--muted:#8f8579;--line:#2b2823;--line2:#3a352e;
        --accent:#8ab4f8;--accent2:#5f95f5;--accentSoft:rgba(138,180,248,.16);--disabled:#2f2b26;
        --green:#77d5a4;--danger:#ff737a;--shadow:0 30px 90px rgba(0,0,0,.36);--shadow2:0 14px 40px rgba(0,0,0,.24);
        --glow1:rgba(138,180,248,.05);--glow2:rgba(66,133,244,.08);--grain:rgba(245,249,255,.026);
      }
    }
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;min-height:100%}
    body{
      min-height:100dvh;font-family:"Cormorant Garamond","Times New Roman",Georgia,serif;font-weight:500;color:var(--ink);
      background:var(--bg);
      padding:18px;overflow-x:hidden;
    }
    body:before{display:none}
    a{color:inherit}
    .wrap{position:relative;z-index:1;max-width:1160px;margin:0 auto}
    .center{display:grid;place-items:center;min-height:calc(100dvh - 36px)}
    .top{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:18px}
    .logo-link{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;background:transparent;border:0;border-radius:0;padding:0;box-shadow:none;transition:transform .15s ease,opacity .15s ease}
    .logo-link:hover{transform:translateY(-1px);opacity:.9}
    .logo{display:block;width:min(240px,66vw);height:auto;object-fit:contain}
    .logo.hero{width:min(480px,84vw)}
    .logo.compact{width:min(190px,48vw)}
    .top .logo{width:min(190px,48vw)}
    @media(prefers-color-scheme:dark){.logo,.home-logo{filter:brightness(0) invert(1) sepia(.08) saturate(.7);opacity:.92}}
    .pill{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:10px 14px;color:var(--soft);font-size:13px;font-weight:750}
    .panel,.card{background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow);border-radius:36px;padding:26px;backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);-webkit-backface-visibility:hidden;backface-visibility:hidden;-webkit-transform:translateZ(0);transform:translateZ(0)}
    .card{width:min(100%,560px);margin-inline:auto}
    .lift{transform:translateY(-18px)}
    h1,h2,h3{margin:0;letter-spacing:-.04em}
    h1{font-size:clamp(30px,5vw,48px);line-height:1.02;margin-bottom:10px}
    h2{font-size:25px}
    h3{font-size:16px}
    p{margin:0;color:var(--soft);line-height:1.55}
    .sub{margin-bottom:20px}
    .tiny{font-size:12px;color:var(--muted);margin-top:20px;text-align:center}
    .hero-card{text-align:center;width:min(100%,820px);padding:40px 34px}
    .hero-copy{font-size:17px;max-width:580px;margin:0 auto;color:var(--soft)}
    .cta-row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:26px}
    .micro{font-size:12px;color:var(--muted);margin-top:20px}
    .field{margin-top:18px}
    label{display:block;font-size:13px;font-weight:760;margin:0 0 8px;color:var(--ink)}
    input,textarea{width:100%;border:1px solid var(--line);background:var(--field);color:var(--ink);border-radius:20px;padding:15px 16px;font-size:16px;outline:none}
    input:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 5px var(--accentSoft)}
    .password-wrap{position:relative}
    .password-wrap input{padding-right:56px}
    .eye-btn{position:absolute;right:14px;top:50%;transform:translateY(-50%);width:24px;height:24px;min-height:24px;padding:0;border:0;border-radius:0;background:transparent;display:grid;place-items:center;cursor:pointer;color:var(--soft);box-shadow:none;-webkit-appearance:none;appearance:none}
    .eye-btn svg{width:24px;height:24px;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
    .eye-btn:hover{color:var(--ink);background:transparent}
    button:not(.eye-btn),.btn{border:0;border-radius:999px;min-height:54px;padding:15px 20px;font:800 16px/1 inherit;cursor:pointer;text-decoration:none;display:flex;align-items:center;justify-content:center;text-align:center;gap:8px;transition:transform .15s ease,opacity .15s ease,background .15s ease,box-shadow .15s ease}
    .primary{color:#fff;background:var(--accent);box-shadow:0 14px 28px rgba(30,30,28,.12)}
    .ghost{background:var(--solid);color:var(--ink);border:1px solid var(--line)}
    .danger{background:#a93f40;color:#fff;box-shadow:0 14px 28px rgba(169,63,64,.16)}
    button:not(.eye-btn):hover,.btn:hover{transform:translateY(-1px)}
    button:not(.eye-btn):active,.btn:active{transform:translateY(0) scale(.99)}
    .links{display:none;margin-top:18px;gap:12px;flex-direction:column}
    .links.ready{display:flex}
    .service{border:1px solid var(--line);background:var(--solid);color:var(--ink);justify-content:center;text-align:center;width:100%}
    .service.active{background:var(--accent);color:#fff}
    .service.disabled{cursor:not-allowed;background:var(--disabled);color:var(--muted);opacity:.78}
    .status{min-height:20px;margin-top:14px;font-size:13px;font-weight:750;color:var(--soft)}
    .status.ok{color:var(--green)}
    .status.err{color:var(--danger)}
    .hidden{display:none!important}
    .grid{display:grid;grid-template-columns:340px 1fr;gap:14px}
    .search{width:100%;margin-bottom:12px}
    .list{display:flex;flex-direction:column;gap:10px;max-height:calc(100dvh - 168px);overflow:auto;scrollbar-width:none}
    .list::-webkit-scrollbar{display:none}
    .item-row{display:grid;grid-template-columns:1fr 42px;gap:8px;align-items:stretch}
    .item{border:1px solid var(--line);background:var(--solid);border-radius:20px;padding:14px;text-align:left;cursor:pointer;color:var(--ink);width:100%;min-height:auto;display:block}
    .item.active{border-color:var(--accent);box-shadow:0 0 0 4px rgba(95,149,245,.12)}
    .item b{display:block;font-size:15px}
    .item span{font-size:12px;color:var(--soft)}
    .more{border:1px solid var(--line)!important;background:var(--solid)!important;color:var(--soft)!important;border-radius:18px!important;min-height:auto!important;padding:0!important;font-size:22px!important;line-height:1!important;box-shadow:none!important}
    .more:hover{color:var(--danger)!important;background:rgba(188,59,66,.08)!important}
    .copyable{cursor:pointer;transition:border-color .15s ease,box-shadow .15s ease,transform .15s ease}
    .copyable:hover{border-color:var(--accent);box-shadow:0 0 0 4px var(--accentSoft);transform:translateY(-1px)}
    .copy-note{font-size:11px;color:var(--muted);font-weight:750;margin-left:8px}
    .detail{min-height:calc(100dvh - 126px)}
    .chips{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}
    .chip{border:1px solid var(--line);background:var(--solid);border-radius:999px;padding:8px 11px;font-size:12px;color:var(--soft)}
    .chip.ok{color:var(--green)}
    .box{border:1px solid var(--line);background:var(--solid);border-radius:22px;padding:14px;margin-top:12px}
    .row{display:flex;gap:10px;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--line)}
    .row:last-child{border-bottom:0}
    .row small{color:var(--soft)}
    pre{white-space:pre-wrap;word-break:break-word;margin:0;color:var(--soft);font-family:"Cormorant Garamond","Times New Roman",Georgia,serif;font-weight:500;font-size:13px;line-height:1.45}
    .toolbar{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
    @media(max-width:800px){.grid{grid-template-columns:1fr}.detail{min-height:auto}.list{max-height:40dvh}.top{align-items:flex-start}.top .logo,.logo.compact{width:min(180px,54vw)}}
    @media(max-width:480px){body{padding:14px}.card,.panel{border-radius:30px;padding:22px}.hero-card{padding:30px 22px}.logo.hero{width:min(430px,88vw)}.cta-row .btn{width:100%}.lift{transform:translateY(-10px)}}
  `;
}

function animateAssets() {
  return `<link rel="stylesheet" href="/animate.css">
    <link rel="stylesheet" href="/gate.css">
    <script src="/animate.js"></script>
    <script src="/gate.js"></script>`;
}

// Tiny fallback shim. Runs ONLY if /animate.js failed to load. It must
// never write style.transitionDelay or otherwise fight the page's own
// intro staging — that mid-flight mutation was the iOS Safari bug.
function mobileSafeRevealScript() {
  return `
    (() => {
      if (window.StarShotsReveal) return;
      const scopeFor = (root) => (root && root.querySelectorAll ? root : document);
      const collect = (root) => {
        const scope = scopeFor(root);
        const sel = '[data-reveal],.reveal';
        const out = [];
        if (scope.matches && scope.matches(sel)) out.push(scope);
        scope.querySelectorAll(sel).forEach((el) => out.push(el));
        return out;
      };
      const show = (el) => { if (el) el.classList.add('is-visible'); };
      const start = (root) => collect(root).forEach(show);
      const reset = (root) => collect(root).forEach((el) => el.classList.remove('is-visible'));
      const mount = (card) => {
        if (!card || card.classList.contains('is-mounted')) return;
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('is-mounted')));
        } else {
          card.classList.add('is-mounted');
        }
      };
      const bounceLogos = (root) => {
        scopeFor(root).querySelectorAll('.ss-logo-hero').forEach((logo) => {
          logo.classList.remove('ss-bounce-in');
          void logo.offsetWidth;
          logo.classList.add('ss-bounce-in');
        });
      };
      window.StarShotsReveal = { start, reset, show, mount, bounceLogos, intro: () => {} };

      const boot = () => { bounceLogos(document); start(document); };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
      } else {
        boot();
      }
      window.addEventListener('pageshow', (e) => { if (e.persisted) bounceLogos(document); });
    })();
  `;
}

async function handleAdminCheck(request, env) {
  const body = await request.json().catch(() => ({}));
  const password = String(body.password || '').trim();

  // Empty-password POSTs are session-revalidation pings from the
  // PasswordGate useEffect (and the cross-tab cookie probe). They
  // can only succeed with a valid signed cookie, so they are not a
  // brute-force surface. They MUST NOT count toward the lockout —
  // routine page loads and tab refreshes would otherwise drain the
  // budget and lock the owner out.
  if (!password) {
    if (await verifyAdminSessionCookie(request, env)) {
      return json({ ok: true }, 200, { 'Set-Cookie': await createAdminSessionCookie(env) });
    }
    return json({ error: 'Unauthorized.' }, 401);
  }

  // If this IP is currently locked out, refuse the attempt without
  // verifying the password and without incrementing any counter.
  // Block window is capped at 30s (see recordFailure default).
  const lockout = checkLockout(request, 'admin-check');
  if (lockout.limited) return rateLimitedResponse(lockout.retryAfter);

  if (!(await verifyAdminPassword(env, password))) {
    // ONLY failed attempts count toward the lockout. A correct
    // password no longer increments the counter, so legitimate
    // re-authentication never trips the limiter.
    recordFailure(request, 'admin-check', { limit: 8, windowMs: 60 * 1000, blockMs: 30 * 1000 });
    return json({ error: 'Unauthorized.' }, 401);
  }

  // Correct password: drop the failure counter for this IP entirely.
  // Subsequent attempts in the same window start fresh.
  clearRateLimit(request, 'admin-check');
  return json({ ok: true }, 200, { 'Set-Cookie': await createAdminSessionCookie(env) });
}

async function handleSave(request, env) {
  const body = await request.json();
  const adminPassword = String(body.adminPassword || '').trim();
  if (!(await verifyAdminRequest(request, env, adminPassword))) return json({ error: 'Unauthorized.' }, 401);
  const links = Array.isArray(body.links) ? body.links : [];
  const cleanLinks = links
    .map((link) => ({ service: cleanService(link.service), originalUrl: normalizeUrl(link.originalUrl) }))
    .filter((link) => link.service && link.originalUrl);

  const baseSlug = cleanSlug(body.baseSlug);
  if (!body.clientName || !body.folderName || !baseSlug || !cleanLinks.length) {
    return json({ error: 'Missing required delivery data.' }, 400);
  }

  const deliveryYear = Number(body.deliveryYear) || new Date().getFullYear();
  const deliveryMonth = Number(body.deliveryMonth) || new Date().getMonth() + 1;
  const deliveryContext = { ...body, baseSlug };
  const shortCode = await uniqueShortCode(env, deliveryContext);
  const password = await generateGalleryPassword(deliveryContext, shortCode);
  const deliveryUrl = `/${shortCode}`;
  const generatedText = buildDeliveryMessage(body.title || 'Ms.', body.clientName, shortCode, password);
  const generatedTextIg = buildDeliveryMessageIg(body.title || 'Ms.', body.clientName, shortCode, password);
  const passwordSecurity = await hashGalleryPassword(password);
  const invoiceId = String(body.invoiceId || '').trim();
  let linkedInvoice = null;
  if (invoiceId) {
    linkedInvoice = await supabaseFetch(env, `/rest/v1/invoices?select=*&id=eq.${encodeURIComponent(invoiceId)}&limit=1`)
      .then((rows) => Array.isArray(rows) ? rows[0] : rows)
      .catch(() => null);
  }
  const client = await findOrCreateClient(env, {
    title: linkedInvoice?.client_title || body.title || 'Ms.',
    name: linkedInvoice?.client_name || body.clientName,
    contact: linkedInvoice?.client_contact || ''
  }, linkedInvoice?.client_id || '');
  const clientId = client?.id ? String(client.id) : '';
  if (linkedInvoice?.id && clientId && !linkedInvoice.client_id) {
    await patchRowsByIds(env, 'invoices', [linkedInvoice.id], {}, clientId).catch(() => []);
  }

  const baseRecord = {
    title: String(body.title || 'Ms.').slice(0, 12),
    client_name: String(body.clientName).trim(),
    folder_name: String(body.folderName).trim(),
    base_slug: baseSlug,
    password,
    delivery_year: deliveryYear,
    delivery_month: deliveryMonth,
    generated_text_whatsapp: generatedText,
    generated_text_instagram: generatedTextIg
  };
  // Optional event grouping fields. event_date stays a bare
  // YYYY-MM-DD (or empty for TBA); event_key is whatever the
  // frontend handed us (an existing row's event_key, the
  // anchor row's id used as a cross-ref, or a fresh UUID for
  // brand-new top-level events). Both are dropped at the
  // schema-fallback layer below if the columns don't exist on
  // a legacy schema.
  const eventDateRaw = String(body.eventDate || '').trim();
  const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(eventDateRaw) ? eventDateRaw : '';
  const eventKey = String(body.eventKey || '').trim().slice(0, 80);
  const eventFields = {};
  if (eventDate) eventFields.event_date = eventDate;
  if (eventKey) eventFields.event_key = eventKey;
  Object.assign(baseRecord, eventFields);
  const linkedRecord = clientId ? { ...baseRecord, client_id: clientId } : baseRecord;
  const stripEvent = (record) => {
    const next = { ...record };
    delete next.event_date;
    delete next.event_key;
    return next;
  };
  const recordVariants = [
    { record: { ...linkedRecord, password: '', ...passwordSecurity, short_code: shortCode }, stripped: false },
    { record: { ...stripEvent(linkedRecord), password: '', ...passwordSecurity, short_code: shortCode }, stripped: true },
    { record: { ...baseRecord, password: '', ...passwordSecurity, short_code: shortCode }, stripped: false },
    { record: { ...stripEvent(baseRecord), password: '', ...passwordSecurity, short_code: shortCode }, stripped: true },
    { record: { ...linkedRecord, password: '', ...passwordSecurity }, stripped: false },
    { record: { ...stripEvent(linkedRecord), password: '', ...passwordSecurity }, stripped: true },
    { record: { ...baseRecord, password: '', ...passwordSecurity }, stripped: false },
    { record: { ...stripEvent(baseRecord), password: '', ...passwordSecurity }, stripped: true },
    { record: linkedRecord, stripped: false },
    { record: stripEvent(linkedRecord), stripped: true },
    { record: baseRecord, stripped: false },
    { record: stripEvent(baseRecord), stripped: true }
  ];

  // Track whether we had to drop event_date/event_key to land the
  // delivery row. The frontend uses this to surface a clear
  // "DB migration part 6 not applied" warning instead of silently
  // saving a row that won't group on /db.
  const requestedEventGrouping = !!(eventDate || eventKey);
  let eventColumnsMissing = false;

  let deliveryRows;
  let lastDeliveryError = null;
  for (const variant of recordVariants) {
    try {
      deliveryRows = await supabaseFetch(env, '/rest/v1/deliveries', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(variant.record)
      });
      if (variant.stripped && requestedEventGrouping) eventColumnsMissing = true;
      break;
    } catch (error) {
      lastDeliveryError = error;
      if (!isSchemaError(error)) break;
    }
  }
  if (!deliveryRows && lastDeliveryError) throw lastDeliveryError;

  const delivery = Array.isArray(deliveryRows) ? deliveryRows[0] : deliveryRows;
  if (!delivery?.id) return json({ error: 'Delivery was not created.' }, 500);

  const rows = cleanLinks.map((link) => ({
    delivery_id: delivery.id,
    service: link.service,
    original_url: link.originalUrl,
    slug: baseSlug,
    short_path: `/${shortCode}`
  }));

  await supabaseFetch(env, '/rest/v1/delivery_links', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(rows)
  });

  // Cross-ref fallback: when there is a linked invoice, stamp its
  // invoice_data jsonb blob with delivery_id + event_key so /db can
  // recover the grouping even when the delivery row could not store
  // the event_key column itself (e.g. pre-part-6 schema). This is a
  // best-effort patch — failures here never block the save response.
  if (linkedInvoice?.id) {
    try {
      const existingData = (linkedInvoice.invoice_data && typeof linkedInvoice.invoice_data === 'object') ? linkedInvoice.invoice_data : {};
      const patchedData = { ...existingData };
      let dirty = false;
      if (!patchedData.delivery_id) {
        patchedData.delivery_id = delivery.id;
        dirty = true;
      }
      if (!patchedData.event_key && eventKey) {
        patchedData.event_key = eventKey;
        dirty = true;
      }
      if (dirty) {
        await supabaseFetch(env, `/rest/v1/invoices?id=eq.${encodeURIComponent(linkedInvoice.id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ invoice_data: patchedData })
        });
      }
    } catch (error) {
      console.warn('[deliveries-save] cross-ref invoice_data patch failed:', error?.message || error);
    }
  }

  if (eventColumnsMissing) {
    console.warn('[deliveries-save] event_date/event_key columns missing — apply db-migration-part-6.sql');
  }

  return json({
    ok: true,
    deliveryId: delivery.id,
    deliveryUrl,
    shortCode,
    shortUrl: `/${shortCode}`,
    shortLink: `${PUBLIC_SITE}/${shortCode}`,
    password,
    generatedText,
    savedLinks: rows.length,
    ...(eventColumnsMissing ? { migrationMissing: 'deliveries.event_key' } : {})
  });
}

async function handleUnlock(request, env) {
  // Body is parsed up-front so we can branch on whether this is a real
  // password attempt (counts toward the gallery rate limit) or an
  // empty-password probe (does not — see below).
  const body = await request.json().catch(() => ({}));
  const lookup = String(body.slug || body.shortCode || '').trim();
  const password = String(body.password || '').trim();

  // Admin-session bypass.
  //
  // /db opens View Links straight to /<short>, which lands on the
  // gallery page. Authenticated admins should not need to remember
  // each delivery's gallery password; if the request carries a valid
  // signed admin session cookie (HttpOnly, set by /api/admin-check),
  // we skip gallery-password verification and the per-IP gallery
  // lockout entirely. The cookie is HttpOnly so it never reaches the
  // frontend — the server is the only thing that can read it.
  //
  // Public visitors are unaffected: with no admin cookie they go down
  // the existing password / rate-limit path.
  const adminBypass = await verifyAdminSessionCookie(request, env);

  // Rate-limit only real password attempts. Two reasons:
  //   1. The gallery page now does an empty-password probe on mount
  //      so an authenticated admin auto-unlocks. We do not want
  //      legitimate page loads to drain the public 12/min budget.
  //   2. Empty-password requests cannot succeed (verifyGalleryPassword
  //      always rejects them), so they are not a brute-force surface.
  // Real password attempts still consume the budget exactly as before.
  if (!adminBypass && password) {
    const limited = enforceRateLimit(request, 'gallery-unlock', { limit: 12, windowMs: 60 * 1000, blockMs: 15 * 60 * 1000 });
    if (limited) return limited;
  }

  const delivery = await getDeliveryByLookup(env, lookup);
  if (!delivery) return json({ error: 'Delivery not found.' }, 404);

  if (adminBypass) {
    // Distinct event so admin previews don't pollute the
    // password_success / opens stats with operator-side traffic.
    await insertLog(env, request, delivery.id, 'admin_unlock');
  } else {
    if (!password || !(await verifyGalleryPassword(delivery, password))) {
      // Only count an attempt as failed when a password was actually
      // submitted. Empty-password probes return the same 401 shape
      // but don't add a password_failed row.
      if (password) await insertLog(env, request, delivery.id, 'password_failed');
      return json({ error: 'Wrong password.' }, 401);
    }
    await insertLog(env, request, delivery.id, 'password_success');
  }

  const rows = await getLinksByDeliveryId(env, delivery.id);
  const links = SERVICES.map((service) => {
    const row = rows.find((item) => item.service === service.key);
    return { service: service.key, label: service.label, url: row?.original_url || '' };
  });

  return json({
    ok: true,
    delivery: {
      id: delivery.id,
      title: delivery.title,
      clientName: delivery.client_name,
      folderName: delivery.folder_name,
      baseSlug: delivery.base_slug
    },
    links
  });
}

async function handleClick(request, env) {
  const body = await request.json();
  const service = cleanService(body.service);
  if (!body.deliveryId || !service) return json({ ok: false }, 400);
  await insertLog(env, request, String(body.deliveryId), 'button_click', service);
  return json({ ok: true });
}

async function handleDbSearch(request, env) {
  const url = new URL(request.url);
  const password = url.searchParams.get('password') || '';
  if (!(await verifyAdminRequest(request, env, password))) return json({ error: 'Unauthorized.' }, 401);

  const q = (url.searchParams.get('q') || '').trim().toLowerCase();

  // Parallelize the four independent top-level reads. Each call hits
  // a different Supabase table and none depend on each other, so the
  // total wall time drops from sum-of-latencies to max-of-latencies.
  const tolerantSupabase = async (path) => {
    try {
      const rows = await supabaseFetch(env, path);
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      if (isSchemaError(error)) return [];
      throw error;
    }
  };

  const [allDeliveries, allInvoices, allSubscriptions, clientRows] = await Promise.all([
    supabaseFetch(env, '/rest/v1/deliveries?select=*&order=created_at.desc&limit=200')
      .then((rows) => Array.isArray(rows) ? rows : []),
    tolerantSupabase('/rest/v1/invoices?select=*&order=updated_at.desc&limit=200'),
    tolerantSupabase('/rest/v1/subscriptions?select=*&order=created_at.desc&limit=200'),
    fetchClients(env),
  ]);

  // Delivery-scoped reads (links + access logs) depend on the
  // delivery id list, so they wait on the deliveries query — but
  // the two queries themselves run in parallel.
  const ids = allDeliveries.map((d) => d.id);
  let links = [];
  let logs = [];
  if (ids.length) {
    const inList = ids.join(',');
    [links, logs] = await Promise.all([
      supabaseFetch(env, `/rest/v1/delivery_links?select=*&delivery_id=in.(${inList})&order=created_at.asc`)
        .then((rows) => Array.isArray(rows) ? rows : []),
      supabaseFetch(env, `/rest/v1/delivery_access_logs?select=*&delivery_id=in.(${inList})&order=created_at.desc&limit=1000`)
        .then((rows) => Array.isArray(rows) ? rows : []),
    ]);
  }

  // External IP/ISP enrichment dropped from the dashboard load payload entirely;
  // logs still carry ip_address / country / city verbatim.

  // Group links and logs by delivery_id once so the items.map below is O(N)
  const linksByDelivery = new Map();
  for (const link of links) {
    const id = String(link?.delivery_id || '');
    if (!id) continue;
    let bucket = linksByDelivery.get(id);
    if (!bucket) { bucket = []; linksByDelivery.set(id, bucket); }
    bucket.push(link);
  }
  const logsByDelivery = new Map();
  for (const log of logs) {
    const id = String(log?.delivery_id || '');
    if (!id) continue;
    let bucket = logsByDelivery.get(id);
    if (!bucket) { bucket = []; logsByDelivery.set(id, bucket); }
    bucket.push(log);
  }

  const invoiceRows = q
    ? allInvoices.filter((inv) => [inv.client_name, inv.client_contact, inv.status, inv.invoice_date, inv.event_date, inv.venue, inv.created_at, inv.updated_at].join(' ').toLowerCase().includes(q))
    : allInvoices;

  const latestInvoiceByClient = latestByClientKey(allInvoices);
  const latestDeliveryByClient = latestByClientKey(allDeliveries);

  const items = allDeliveries.map((d) => {
    const key = String(d.id);
    const dl = linksByDelivery.get(key) || [];
    const lg = logsByDelivery.get(key) || [];
    let clicks = 0;
    let opens = 0;
    for (const log of lg) {
      const type = log?.event_type;
      if (type === 'button_click') clicks += 1;
      else if (type === 'page_view' || type === 'password_success') opens += 1;
    }
    const shortCode = deliveryShortCode(d);
    const shortPath = shortCode ? `/${shortCode}` : '';
    const displayPassword = deliveryPasswordForDisplay(d);
    const generatedText = d.generated_text_whatsapp || (displayPassword && shortCode ? buildDeliveryMessage(d.title || 'Ms.', d.client_name, shortCode, displayPassword) : '');
    // IG fallback: prefer the stored IG text when present, otherwise
    // synthesise the IG variant directly. We intentionally do NOT
    // fall back to the WA text here — older rows that only have the
    // WA template would otherwise expose bullets in the Instagram
    // copy panel, which is the bug the channel split is meant to
    // resolve. When neither is available we leave the field empty
    // so the client side can synth its own copy.
    const generatedTextIg = d.generated_text_instagram
      || (displayPassword && shortCode ? buildDeliveryMessageIg(d.title || 'Ms.', d.client_name, shortCode, displayPassword) : '');
    // Effective event grouping key.
    //
    // Preferred source is the typed column (deliveries.event_key,
    // populated when db-migration-part-6.sql is applied). If the
    // column is missing/empty we recover the link via the cross-ref
    // we stamped into the linked invoice's invoice_data jsonb on
    // save (handleSave below): any invoice whose invoice_data
    // .delivery_id matches this delivery contributes its own id as
    // the effective event_key, so /db's grouping pass on the client
    // can still merge the invoice + delivery into a single row.
    let effectiveEventKey = String(d.event_key || '').trim();
    if (!effectiveEventKey) {
      const xref = allInvoices.find((inv) => {
        const data = (inv?.invoice_data && typeof inv.invoice_data === 'object') ? inv.invoice_data : {};
        return String(data.delivery_id || '') === key;
      });
      if (xref?.id) effectiveEventKey = String(xref.id);
    }
    return {
      id: d.id,
      title: d.title,
      client_id: d.client_id || '',
      client_name: d.client_name,
      folder_name: d.folder_name,
      base_slug: d.base_slug,
      password: displayPassword,
      delivery_year: d.delivery_year,
      delivery_month: d.delivery_month,
      generated_text_whatsapp: generatedText,
      generated_text_instagram: generatedTextIg,
      created_at: d.created_at,
      event_date: d.event_date || '',
      event_key: effectiveEventKey,
      delivery_url: shortPath,
      short_code: shortCode,
      short_url: shortPath,
      needs_secure_repair: !shortCode,
      gallery_code: galleryCodeFromSlug(d.base_slug),
      related_invoice: invoiceSummary(relatedByClientKey(d, latestInvoiceByClient)),
      links: dl,
      stats: { opens, clicks, logs: lg.slice(0, 50) }
    };
  });

  const invoicesWithRelated = invoiceRows.map((inv) => {
    // Effective event grouping key for invoices. Same priority as
    // deliveries above: the typed column wins, falling back to the
    // jsonb mirror that normalizeInvoicePayload writes on every
    // save. This keeps /db grouping correct even when the
    // invoices.event_key column has been stripped at save time
    // (pre-part-6 schemas).
    const data = (inv?.invoice_data && typeof inv.invoice_data === 'object') ? inv.invoice_data : {};
    const effectiveEventKey = String(inv.event_key || data.event_key || '').trim();
    return {
      ...inv,
      event_key: effectiveEventKey,
      related_delivery: deliverySummary(relatedByClientKey(inv, latestDeliveryByClient))
    };
  });

  const subscriptionRows = q
    ? allSubscriptions.filter((sub) => [
        sub.client_name,
        sub.client_contact,
        sub.service,
        sub.storage_slot,
        sub.status,
        sub.invoice_date,
        sub.payment_date,
        sub.start_date,
        sub.expiry_date,
        sub.created_at,
        sub.updated_at
      ].join(' ').toLowerCase().includes(q))
    : allSubscriptions;

  const clients = buildClientSummaries(clientRows, allInvoices, allDeliveries, allSubscriptions, q);

  return json({ ok: true, items, invoices: invoicesWithRelated, subscriptions: subscriptionRows, clients });
}


async function handleClientSave(request, env) {
  const body = await request.json().catch(() => ({}));
  const password = String(body.password || '').trim();
  if (!(await verifyAdminRequest(request, env, password))) return json({ error: 'Unauthorized.' }, 401);

  const currentId = String(body.id || body.client_id || '').trim();
  const fields = cleanClientPayload(body);
  if (!fields.name || !fields.normalized_name) return json({ error: 'Client name is required.' }, 400);

  const duplicate = await findDuplicateClient(env, fields, currentId);
  if (duplicate) {
    return json({
      error: `A client already exists for ${duplicate.title || ''} ${duplicate.name || 'this name'}${duplicate.contact ? ` (${duplicate.contact})` : ''}.`,
      duplicate
    }, 409);
  }

  const clientBody = {
    title: fields.title,
    name: fields.name,
    contact: fields.contact,
    normalized_name: fields.normalized_name,
    updated_at: new Date().toISOString()
  };

  let clientRows;
  if (currentId && !currentId.startsWith('legacy:')) {
    clientRows = await supabaseFetch(env, `/rest/v1/clients?id=eq.${encodeURIComponent(currentId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(clientBody)
    });
  } else {
    clientRows = await supabaseFetch(env, '/rest/v1/clients', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(clientBody)
    });
  }

  const client = Array.isArray(clientRows) ? clientRows[0] : clientRows;
  if (!client?.id) return json({ error: 'Client was not saved.' }, 500);
  const clientId = String(client.id);

  const invoicePayload = {
    client_title: fields.title,
    client_name: fields.name,
    client_contact: fields.contact
  };
  const deliveryPayload = {
    title: fields.title,
    client_name: fields.name
  };

  const invoiceByClient = await patchRowsByClientId(env, 'invoices', clientId, invoicePayload);
  const deliveryByClient = await patchRowsByClientId(env, 'deliveries', clientId, deliveryPayload);
  const invoiceByIds = await patchRowsByIds(env, 'invoices', body.invoiceIds, invoicePayload, clientId);
  const deliveryByIds = await patchRowsByIds(env, 'deliveries', body.deliveryIds, deliveryPayload, clientId);

  const invoiceIds = new Set([...invoiceByClient, ...invoiceByIds].map((row) => String(row.id || '')).filter(Boolean));
  const deliveryIds = new Set([...deliveryByClient, ...deliveryByIds].map((row) => String(row.id || '')).filter(Boolean));

  return json({
    ok: true,
    client,
    updated: {
      invoices: invoiceIds.size,
      deliveries: deliveryIds.size
    }
  });
}

async function handleDbDelete(request, env) {
  const body = await request.json();
  const password = String(body.password || '').trim();
  const id = String(body.id || '').trim();
  if (!(await verifyAdminRequest(request, env, password))) return json({ error: 'Unauthorized.' }, 401);
  if (!id) return json({ error: 'Missing record id.' }, 400);

  await supabaseFetch(env, `/rest/v1/delivery_access_logs?delivery_id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  }).catch(() => {});
  await supabaseFetch(env, `/rest/v1/delivery_links?delivery_id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  }).catch(() => {});
  await supabaseFetch(env, `/rest/v1/deliveries?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  });

  return json({ ok: true });
}

async function handleDbClearLogs(request, env) {
  const body = await request.json();
  const password = String(body.password || '').trim();
  const id = String(body.id || '').trim();
  if (!(await verifyAdminRequest(request, env, password))) return json({ error: 'Unauthorized.' }, 401);
  if (!id) return json({ error: 'Missing record id.' }, 400);

  await supabaseFetch(env, `/rest/v1/delivery_access_logs?delivery_id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  });

  return json({ ok: true });
}

async function handleDbRepairDelivery(request, env) {
  const body = await request.json().catch(() => ({}));
  const password = String(body.password || '').trim();
  const id = String(body.id || body.deliveryId || '').trim();
  const rotatePassword = Boolean(body.rotatePassword);
  if (!(await verifyAdminRequest(request, env, password))) return json({ error: 'Unauthorized.' }, 401);
  if (!id) return json({ error: 'Missing delivery id.' }, 400);

  const rows = await supabaseFetch(
    env,
    `/rest/v1/deliveries?select=*&id=eq.${encodeURIComponent(id)}&limit=1`
  );
  const delivery = Array.isArray(rows) ? rows[0] : rows;
  if (!delivery?.id) return json({ error: 'Delivery not found.' }, 404);

  const existingCode = deliveryShortCode(delivery) || explicitShortCode(delivery);
  const shortCode = existingCode.length === SHORT_CODE_LENGTH
    ? existingCode
    : await uniqueShortCode(env, {
        deliveryId: delivery.id,
        baseSlug: delivery.base_slug || '',
        folderName: delivery.folder_name || '',
        clientName: delivery.client_name || '',
        title: delivery.title || ''
      });

  let displayPassword = rotatePassword ? '' : deliveryPasswordForDisplay(delivery);
  const hasStoredHash = !!(String(delivery.password_hash || '').trim() && String(delivery.password_salt || '').trim());
  if (!displayPassword && hasStoredHash && !rotatePassword) {
    return json({
      error: 'This delivery already has a hashed password but no recoverable display password. Create a fresh delivery link instead.'
    }, 409);
  }
  if (!displayPassword) {
    displayPassword = await generateGalleryPassword({
      deliveryId: delivery.id,
      baseSlug: delivery.base_slug || '',
      folderName: delivery.folder_name || '',
      clientName: delivery.client_name || '',
      title: delivery.title || ''
    }, shortCode);
  }

  const generatedText = buildDeliveryMessage(delivery.title || 'Ms.', delivery.client_name || '', shortCode, displayPassword);
  const generatedTextIg = buildDeliveryMessageIg(delivery.title || 'Ms.', delivery.client_name || '', shortCode, displayPassword);
  const patch = {
    short_code: shortCode,
    password: '',
    generated_text_whatsapp: generatedText,
    generated_text_instagram: generatedTextIg
  };

  if (!hasStoredHash || rotatePassword) {
    Object.assign(patch, await hashGalleryPassword(displayPassword));
  }

  const repairedRows = await supabaseFetch(
    env,
    `/rest/v1/deliveries?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch)
    }
  );
  const repaired = Array.isArray(repairedRows) ? repairedRows[0] : repairedRows;

  await supabaseFetch(
    env,
    `/rest/v1/delivery_links?delivery_id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ short_path: `/${shortCode}` })
    }
  ).catch((error) => {
    if (!isSchemaError(error)) throw error;
  });

  return json({
    ok: true,
    shortCode,
    shortUrl: `/${shortCode}`,
    shortLink: `${PUBLIC_SITE}/${shortCode}`,
    password: displayPassword,
    generatedText,
    delivery: {
      ...delivery,
      ...(repaired || {}),
      password: displayPassword,
      short_code: shortCode,
      delivery_url: `/${shortCode}`,
      short_url: `/${shortCode}`,
      generated_text_whatsapp: generatedText,
      generated_text_instagram: generatedTextIg,
      needs_secure_repair: false
    }
  });
}

async function handleDbUpdateDelivery(request, env) {
  const body = await request.json().catch(() => ({}));
  const password = String(body.password || '').trim();
  const id = String(body.id || body.deliveryId || '').trim();
  if (!(await verifyAdminRequest(request, env, password))) return json({ error: 'Unauthorized.' }, 401);
  if (!id) return json({ error: 'Missing delivery id.' }, 400);

  const rows = await supabaseFetch(
    env,
    `/rest/v1/deliveries?select=*&id=eq.${encodeURIComponent(id)}&limit=1`
  );
  const delivery = Array.isArray(rows) ? rows[0] : rows;
  if (!delivery?.id) return json({ error: 'Delivery not found.' }, 404);

  // Optional delivery metadata PATCH. Folder and event date edits
  // do not regenerate base_slug, short_code, or password — those are
  // owned by Repair Secure Link / Regenerate Password. If a column
  // is missing on a legacy schema we swallow the schema error so
  // the link rebuild still succeeds.
  let updatedFolderName = String(delivery.folder_name || '');
  let updatedEventDate = String(delivery.event_date || '');
  const deliveryPatch = {};
  const folderNameRaw = body.folderName ?? body.folder_name;
  if (folderNameRaw !== undefined && folderNameRaw !== null) {
    const trimmedFolder = String(folderNameRaw).trim();
    if (trimmedFolder && trimmedFolder !== String(delivery.folder_name || '').trim()) {
      deliveryPatch.folder_name = trimmedFolder;
      updatedFolderName = trimmedFolder;
    }
  }
  const eventDateRaw = body.eventDate ?? body.event_date;
  if (eventDateRaw !== undefined && eventDateRaw !== null) {
    const trimmedEventDate = String(eventDateRaw).trim();
    if (trimmedEventDate && !/^\d{4}-\d{2}-\d{2}$/.test(trimmedEventDate)) {
      return json({ error: 'Event Date must be YYYY-MM-DD.' }, 400);
    }
    const nextEventDate = trimmedEventDate || null;
    if (String(nextEventDate || '') !== String(delivery.event_date || '').trim()) {
      deliveryPatch.event_date = nextEventDate;
      updatedEventDate = String(nextEventDate || '');
    }
  }

  if (Object.keys(deliveryPatch).length) {
    try {
      const patched = await supabaseFetch(env, `/rest/v1/deliveries?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(deliveryPatch)
      });
      const patchedRow = Array.isArray(patched) ? patched[0] : patched;
      if (patchedRow) {
        updatedFolderName = String(patchedRow.folder_name || updatedFolderName || '');
        updatedEventDate = String(patchedRow.event_date || updatedEventDate || '');
      }
    } catch (error) {
      if (!isSchemaError(error)) throw error;
      // Column missing on a legacy schema. If event_date was the
      // incompatible field, retry a plain folder rename so older DBs
      // keep the behaviour this endpoint already supported.
      if (deliveryPatch.folder_name) {
        try {
          const patched = await supabaseFetch(env, `/rest/v1/deliveries?id=eq.${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ folder_name: deliveryPatch.folder_name })
          });
          const patchedRow = Array.isArray(patched) ? patched[0] : patched;
          updatedFolderName = String(patchedRow?.folder_name || deliveryPatch.folder_name || delivery.folder_name || '');
        } catch (retryError) {
          if (!isSchemaError(retryError)) throw retryError;
          updatedFolderName = String(delivery.folder_name || '');
        }
      } else {
        updatedFolderName = String(delivery.folder_name || '');
      }
      // Drop the event-date edit and continue with the link rebuild.
      updatedEventDate = String(delivery.event_date || '');
    }
  }

  const links = Array.isArray(body.links) ? body.links : [];
  const cleanLinks = links
    .map((link) => ({ service: cleanService(link.service), originalUrl: normalizeUrl(link.originalUrl || link.original_url || link.url) }))
    .filter((link) => link.service && link.originalUrl);

  await supabaseFetch(env, `/rest/v1/delivery_links?delivery_id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  }).catch(() => {});

  const shortCode = deliveryShortCode(delivery) || explicitShortCode(delivery);
  const insertedLinks = cleanLinks.length ? await supabaseFetch(env, '/rest/v1/delivery_links', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(cleanLinks.map((link) => ({
      delivery_id: id,
      service: link.service,
      original_url: link.originalUrl,
      slug: delivery.base_slug || '',
      short_path: shortCode ? `/${shortCode}` : ''
    })))
  }) : [];

  return json({
    ok: true,
    delivery: {
      ...delivery,
      folder_name: updatedFolderName,
      event_date: updatedEventDate,
      links: Array.isArray(insertedLinks) ? insertedLinks : [],
    },
  });
}

async function handleDbPasswordChange(request, env) {
  const body = await request.json().catch(() => ({}));
  const password = String(body.password || '').trim();
  const nextPassword = String(body.newPassword || '').trim();
  if (!(await verifyAdminRequest(request, env, password))) return json({ error: 'Unauthorized.' }, 401);
  if (nextPassword.length < 4) return json({ error: 'Use at least 4 characters.' }, 400);
  if (nextPassword.length > 72) return json({ error: 'Use 72 characters or fewer.' }, 400);
  return json({ error: 'Admin password is managed by Cloudflare Secret. Run: npx wrangler pages secret put ADMIN_PASSWORD --project-name=starshots' }, 400);
}

// Cascade-delete a client and every record that belongs to them.
//
// Body shape (JSON):
//   { id: "<uuid> | legacy:<normalized>", name?: "<display name>", password?: "..." }
//
// Match strategy mirrors how /api/db buckets records into client
// summaries: a real client_id wins; otherwise we fall back to the
// denormalized client_name string. We delete by both filters when
// available so legacy rows missing client_id (older imports) are not
// left orphaned. Slug, password-hash, and salt logic are untouched —
// this handler only issues PostgREST DELETEs.
async function handleClientDelete(request, env) {
  const body = await request.json().catch(() => ({}));
  const password = String(body.password || '').trim();
  if (!(await verifyAdminRequest(request, env, password))) return json({ error: 'Unauthorized.' }, 401);

  const rawId = String(body.id || body.client_id || '').trim();
  const clientName = String(body.name || body.client_name || '').trim();
  const isRealId = !!rawId && !rawId.startsWith('legacy:');
  if (!isRealId && !clientName) return json({ error: 'Missing client id or name.' }, 400);

  const filters = [];
  if (isRealId) filters.push(`client_id=eq.${encodeURIComponent(rawId)}`);
  if (clientName) filters.push(`client_name=eq.${encodeURIComponent(clientName)}`);

  // Step 1: collect all delivery ids that match any filter so we can
  // clean their dependent rows (delivery_links, delivery_access_logs)
  // before deleting the deliveries themselves. delivery_links and
  // delivery_access_logs only carry delivery_id, not client_id, so we
  // cannot delete them by client filter directly.
  const deliveryIds = new Set();
  for (const filter of filters) {
    try {
      const rows = await supabaseFetch(env, `/rest/v1/deliveries?select=id&${filter}`);
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        if (row?.id) deliveryIds.add(String(row.id));
      });
    } catch (error) {
      if (!isSchemaError(error)) throw error;
    }
  }

  if (deliveryIds.size > 0) {
    const inList = [...deliveryIds].map((id) => encodeURIComponent(id)).join(',');
    await supabaseFetch(env, `/rest/v1/delivery_access_logs?delivery_id=in.(${inList})`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    }).catch(() => {});
    await supabaseFetch(env, `/rest/v1/delivery_links?delivery_id=in.(${inList})`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    }).catch(() => {});
    await supabaseFetch(env, `/rest/v1/deliveries?id=in.(${inList})`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    }).catch(() => {});
  }

  // Step 2: invoices and subscriptions both denormalize client_name,
  // so we issue one DELETE per filter on each table. Schema-cache
  // tolerance mirrors the rest of the worker (subscriptions table may
  // not exist in older deploys).
  for (const filter of filters) {
    await supabaseFetch(env, `/rest/v1/invoices?${filter}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    }).catch(() => {});
  }
  for (const filter of filters) {
    try {
      await supabaseFetch(env, `/rest/v1/subscriptions?${filter}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
    } catch (error) {
      if (!isSchemaError(error)) throw error;
    }
  }

  // Step 3: drop the canonical client row last so the per-record
  // FK ON DELETE SET NULL doesn't dirty the records we've already
  // queued for deletion. Legacy buckets have no client row to drop.
  if (isRealId) {
    await supabaseFetch(env, `/rest/v1/clients?id=eq.${encodeURIComponent(rawId)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    }).catch(() => {});
  }

  return json({ ok: true });
}


function normalizeInvoicePayload(raw = {}) {
  const data = raw.invoice_data && typeof raw.invoice_data === 'object' ? { ...raw.invoice_data } : {};
  const status = ['invoice', 'deposit', 'paid'].includes(String(raw.status || '').toLowerCase()) ? String(raw.status).toLowerCase() : 'invoice';
  const cleanMoney = (v) => Math.max(0, Math.round(Number(v) || 0));
  const eventKeyRaw = String(raw.event_key || raw.eventKey || '').trim().slice(0, 80);
  // Belt-and-suspenders: also mirror the event grouping key into the
  // invoice_data jsonb blob. The blob has always existed on the
  // invoices table, so it survives a stripped event_key column on
  // pre-part-6 schemas. handleDbSearch reads invoice_data.event_key
  // as a fallback when the column is missing/null, keeping the /db
  // grouping pass functional even when the migration hasn't been
  // applied yet. We never overwrite a non-empty existing value.
  if (eventKeyRaw && !data.event_key) data.event_key = eventKeyRaw;
  const payload = {
    client_title: String(raw.client_title || 'Ms.').slice(0, 20),
    client_name: String(raw.client_name || '').trim().slice(0, 160),
    client_contact: String(raw.client_contact || '').trim().slice(0, 240),
    invoice_date: String(raw.invoice_date || '').trim().slice(0, 40),
    event_date: String(raw.event_date || '').trim().slice(0, 40),
    event_time: String(raw.event_time || '').trim().slice(0, 40),
    venue: String(raw.venue || '').trim().slice(0, 240),
    status,
    grand_total: cleanMoney(raw.grand_total),
    deposit_amount: cleanMoney(raw.deposit_amount),
    paid_amount: cleanMoney(raw.paid_amount),
    balance_due: cleanMoney(raw.balance_due),
    invoice_data: data
  };
  if (eventKeyRaw) payload.event_key = eventKeyRaw;
  return payload;
}

async function handleInvoiceSave(request, env) {
  const body = await request.json();
  const password = String(body.password || '').trim();
  if (!(await verifyAdminRequest(request, env, password))) return json({ error: 'Unauthorized.' }, 401);

  const invoice = normalizeInvoicePayload(body.invoice || {});
  if (!invoice.client_name) return json({ error: 'Client name is required.' }, 400);
  const id = String((body.invoice || {}).id || '').trim();
  let existingInvoice = null;
  if (id) {
    existingInvoice = await supabaseFetch(env, `/rest/v1/invoices?select=*&id=eq.${encodeURIComponent(id)}&limit=1`)
      .then((rows) => Array.isArray(rows) ? rows[0] : rows)
      .catch(() => null);
  }
  const client = await findOrCreateClient(env, {
    title: invoice.client_title,
    name: invoice.client_name,
    contact: invoice.client_contact
  }, existingInvoice?.client_id || '');
  const linkedInvoice = client?.id ? { ...invoice, client_id: String(client.id) } : invoice;
  const invoiceWithoutClient = { ...invoice };
  // Schema-tolerant retry layers: stripping event_key (missing on
  // pre-part-6 schemas) and stripping client_id (missing on the
  // earliest schemas). We try the richest payload first and fall
  // back step by step on isSchemaError.
  //
  // The retained event_key still lives in invoice_data.event_key
  // (set by normalizeInvoicePayload), so even when the column is
  // stripped here the grouping key is preserved on disk and
  // handleDbSearch can recover it for /db's merge pass.
  const stripEventKey = (record) => {
    const next = { ...record };
    delete next.event_key;
    return next;
  };
  // Track whether the event_key column had to be dropped to land
  // the row. The frontend uses this to surface a clear "DB
  // migration part 6 not applied" warning instead of silently
  // creating a row that won't group on /db.
  const requestedEventKey = !!invoice.event_key;
  let eventKeyColumnMissing = false;
  // Tagged variants: each pair carries the payload + whether the
  // event_key column was stripped from it. We test all column-
  // present variants first so the column gets used whenever the
  // schema supports it.
  const variants = [
    { record: linkedInvoice, stripped: false },
    { record: stripEventKey(linkedInvoice), stripped: true },
    { record: invoiceWithoutClient, stripped: false },
    { record: stripEventKey(invoiceWithoutClient), stripped: true }
  ];

  if (id) {
    let rows;
    let lastError = null;
    for (const variant of variants) {
      try {
        rows = await supabaseFetch(env, `/rest/v1/invoices?id=eq.${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(variant.record)
        });
        if (variant.stripped && requestedEventKey) eventKeyColumnMissing = true;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (!isSchemaError(error)) throw error;
      }
    }
    if (lastError) throw lastError;
    const saved = Array.isArray(rows) ? rows[0] : rows;
    if (eventKeyColumnMissing) {
      console.warn('[invoices-save] event_key column missing — apply db-migration-part-6.sql');
    }
    return json({ ok: true, invoice: saved, ...(eventKeyColumnMissing ? { migrationMissing: 'invoices.event_key' } : {}) });
  }

  let rows;
  let lastError = null;
  for (const variant of variants) {
    try {
      rows = await supabaseFetch(env, '/rest/v1/invoices', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(variant.record)
      });
      if (variant.stripped && requestedEventKey) eventKeyColumnMissing = true;
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (!isSchemaError(error)) throw error;
    }
  }
  if (lastError) throw lastError;
  const saved = Array.isArray(rows) ? rows[0] : rows;
  if (eventKeyColumnMissing) {
    console.warn('[invoices-save] event_key column missing — apply db-migration-part-6.sql');
  }
  return json({ ok: true, invoice: saved, ...(eventKeyColumnMissing ? { migrationMissing: 'invoices.event_key' } : {}) });
}

async function handleInvoiceGet(request, env) {
  const url = new URL(request.url);
  const id = String(url.searchParams.get('id') || '').trim();
  if (!id) return json({ error: 'Missing invoice id.' }, 400);
  const rows = await supabaseFetch(env, `/rest/v1/invoices?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  const invoice = Array.isArray(rows) ? rows[0] : rows;
  if (!invoice) return json({ error: 'Invoice not found.' }, 404);
  return json({ ok: true, invoice });
}

async function handleInvoiceDelete(request, env) {
  const body = await request.json();
  const password = String(body.password || '').trim();
  const id = String(body.id || '').trim();
  if (!(await verifyAdminRequest(request, env, password))) return json({ error: 'Unauthorized.' }, 401);
  if (!id) return json({ error: 'Missing invoice id.' }, 400);
  await supabaseFetch(env, `/rest/v1/invoices?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  });
  return json({ ok: true });
}

// ─── Subscriptions ────────────────────────────────────────────────
//
// Subscriptions live in their own table (db-migration-part-4.sql).
// We keep the same shape as invoices: a stable client record (created
// or matched on the fly via findOrCreateClient) plus a denormalized
// snapshot on the subscription row so listings stay readable even if
// the parent client is later renamed or deleted (FK is ON DELETE SET
// NULL, see the migration).

const SUBSCRIPTION_STATUSES = new Set(['invoice', 'paid']);
const SUBSCRIPTION_RATE_MODES = new Set(['normal', 'discount']);

function cleanIsoDate(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  // Accept either YYYY-MM-DD or full ISO strings; reject anything else.
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function cleanIsoTime(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const hh = match[1];
  const mm = match[2];
  const ss = match[3] || '00';
  return `${hh}:${mm}:${ss}`;
}

function addDaysIso(dateIso, days) {
  const base = cleanIsoDate(dateIso);
  if (!base || !Number.isFinite(Number(days))) return null;
  const d = new Date(`${base}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

function normalizeSubscriptionPayload(raw = {}) {
  const cleanInt = (v, fallback = 0) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const status = SUBSCRIPTION_STATUSES.has(String(raw.status || '').toLowerCase())
    ? String(raw.status).toLowerCase()
    : 'invoice';
  const rateMode = SUBSCRIPTION_RATE_MODES.has(String(raw.rate_mode || raw.rateMode || '').toLowerCase())
    ? String(raw.rate_mode || raw.rateMode).toLowerCase()
    : 'normal';

  const accessPeriod = cleanInt(raw.access_period ?? raw.accessPeriod, 30) || 30;
  const startDate = cleanIsoDate(raw.start_date ?? raw.startDate);
  const startTime = cleanIsoTime(raw.start_time ?? raw.startTime);
  // Persist an explicit expiry pair when status === 'paid' and we have a
  // start date — saves the dashboard from recomputing it on every render.
  let expiryDate = cleanIsoDate(raw.expiry_date ?? raw.expiryDate);
  if (!expiryDate && status === 'paid' && startDate) expiryDate = addDaysIso(startDate, accessPeriod);
  const expiryTime = cleanIsoTime(raw.expiry_time ?? raw.expiryTime) || (expiryDate ? startTime : null);

  return {
    client_title: String(raw.client_title || raw.clientTitle || 'Ms.').slice(0, 20),
    client_name: String(raw.client_name || raw.clientName || '').trim().slice(0, 160),
    client_contact: String(raw.client_contact || raw.clientContact || '').trim().slice(0, 240),
    service: String(raw.service || '').trim().slice(0, 60),
    storage_slot: String(raw.storage_slot || raw.storageSlot || '').trim().slice(0, 40) || null,
    access_period: accessPeriod,
    rate_mode: rateMode,
    price: cleanInt(raw.price, 0),
    manual_override: !!(raw.manual_override ?? raw.manualOverride ?? false),
    status,
    invoice_date: cleanIsoDate(raw.invoice_date ?? raw.invoiceDate) || new Date().toISOString().slice(0, 10),
    payment_date: cleanIsoDate(raw.payment_date ?? raw.paymentDate),
    payment_time: cleanIsoTime(raw.payment_time ?? raw.paymentTime),
    start_date: startDate,
    start_time: startTime,
    expiry_date: expiryDate,
    expiry_time: expiryTime
  };
}

async function handleSubscriptionSave(request, env) {
  const body = await request.json().catch(() => ({}));
  const password = String(body.password || '').trim();
  if (!(await verifyAdminRequest(request, env, password))) return json({ error: 'Unauthorized.' }, 401);

  const subscription = normalizeSubscriptionPayload(body.subscription || body);
  if (!subscription.client_name) return json({ error: 'Client name is required.' }, 400);
  if (!subscription.service) return json({ error: 'Service is required.' }, 400);

  const id = String((body.subscription || body).id || '').trim();
  let existing = null;
  if (id) {
    existing = await supabaseFetch(env, `/rest/v1/subscriptions?select=*&id=eq.${encodeURIComponent(id)}&limit=1`)
      .then((rows) => Array.isArray(rows) ? rows[0] : rows)
      .catch(() => null);
  }

  // Reuse or create a client record so the subscription joins the
  // same client bucket that drives the /db Clients tab.
  const client = await findOrCreateClient(env, {
    title: subscription.client_title,
    name: subscription.client_name,
    contact: subscription.client_contact
  }, existing?.client_id || '');

  const linked = client?.id ? { ...subscription, client_id: String(client.id) } : { ...subscription };
  const fallback = { ...subscription };

  if (id) {
    let rows;
    try {
      rows = await supabaseFetch(env, `/rest/v1/subscriptions?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(linked)
      });
    } catch (error) {
      if (!linked.client_id || !isSchemaError(error)) throw error;
      rows = await supabaseFetch(env, `/rest/v1/subscriptions?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(fallback)
      });
    }
    const saved = Array.isArray(rows) ? rows[0] : rows;
    return json({ ok: true, subscription: saved });
  }

  let rows;
  try {
    rows = await supabaseFetch(env, '/rest/v1/subscriptions', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(linked)
    });
  } catch (error) {
    if (!linked.client_id || !isSchemaError(error)) throw error;
    rows = await supabaseFetch(env, '/rest/v1/subscriptions', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(fallback)
    });
  }
  const saved = Array.isArray(rows) ? rows[0] : rows;
  return json({ ok: true, subscription: saved });
}

async function handleSubscriptionGet(request, env) {
  const url = new URL(request.url);
  const id = String(url.searchParams.get('id') || '').trim();
  if (!id) return json({ error: 'Missing subscription id.' }, 400);
  const rows = await supabaseFetch(env, `/rest/v1/subscriptions?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  const subscription = Array.isArray(rows) ? rows[0] : rows;
  if (!subscription) return json({ error: 'Subscription not found.' }, 404);
  return json({ ok: true, subscription });
}

async function handleSubscriptionDelete(request, env) {
  const body = await request.json();
  const password = String(body.password || '').trim();
  const id = String(body.id || '').trim();
  if (!(await verifyAdminRequest(request, env, password))) return json({ error: 'Unauthorized.' }, 401);
  if (!id) return json({ error: 'Missing subscription id.' }, 400);
  await supabaseFetch(env, `/rest/v1/subscriptions?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  });
  return json({ ok: true });
}

// ── Subscription receipt import (vision-backed) ────────────────────
// Reads a StarShots subscription receipt JPG and extracts structured
// fields the /db Subs editor can preview before saving. The image
// itself is never persisted: we consume the request body once,
// hand it to a vision model, and drop the bytes when the response
// returns.
//
// Provider priority:
//   1. Cloudflare Workers AI binding (env.AI) — primary, free on Pages
//      when the binding is added to wrangler.toml. Used with the
//      llama-3.2 vision model.
//   2. OpenAI Vision via env.OPENAI_API_KEY — fallback when CF AI is
//      not bound. Uses the gpt-4o-mini multimodal endpoint.
//   3. Otherwise → 503 with the friendly message the spec requires
//      so the UI can prompt the operator to enter fields manually.
//
// The model is asked to return a single JSON object matching the
// subscriptions schema. We also run a duplicate lookup keyed on
// client_name + service + payment_date + start_date so the UI can
// upsert by passing the matched id back to /api/subscriptions-save.

const SUBSCRIPTION_IMPORT_PROMPT = `You are reading a StarShots subscription receipt image. Extract these fields and return ONLY a single JSON object — no prose, no code fences.

{
  "client_title": "Mr. | Ms. | Mrs. | Family",
  "client_name": "<name from greeting>",
  "service": "<service name, e.g. ChatGPT, iCloud, Google Drive, Dropbox, Copilot>",
  "status": "paid | invoice | empty",
  "payment_date": "YYYY-MM-DD or null",
  "payment_time": "HH:MM:SS or null",
  "access_period": "<integer days, e.g. 30, or null>",
  "start_date": "YYYY-MM-DD or null",
  "start_time": "HH:MM:SS or null",
  "expiry_date": "YYYY-MM-DD or null",
  "expiry_time": "HH:MM:SS or null"
}

Hints:
- Greeting "Hello, Mr. medacandra!" → client_title="Mr.", client_name="Medacandra"
- Headline "Subscription Confirmed" or eyebrow "Payment Received" → status="paid"
- "30 Days" → access_period=30
- Times printed in HH.MM form (e.g. 18.41) → convert to HH:MM:SS (18:41:00)
- Dates printed as "May 13, 2026" → convert to ISO 2026-05-13
- Title-case the client name (e.g. "medacandra" → "Medacandra")
- Set a field to null if you cannot read it confidently. Do not guess.`;

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64 = '') {
  const stripped = String(b64).replace(/^data:[^,]+,/, '');
  const binary = atob(stripped);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function callVisionExtractor(env, imageBase64, mime) {
  // Prefer Cloudflare Workers AI when the binding is present.
  if (env && env.AI && typeof env.AI.run === 'function') {
    try {
      const bytes = base64ToBytes(imageBase64);
      const result = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
        prompt: SUBSCRIPTION_IMPORT_PROMPT,
        image: Array.from(bytes),
        max_tokens: 700
      });
      const text = String(result?.response || '').trim();
      if (text) return text;
    } catch (err) {
      console.warn('[subs-import] CF AI vision error:', err?.message || err);
    }
  }

  // Fallback: OpenAI vision via API key secret.
  const openaiKey = String(env?.OPENAI_API_KEY || '').trim();
  if (openaiKey) {
    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: env?.OPENAI_VISION_MODEL || 'gpt-4o-mini',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: SUBSCRIPTION_IMPORT_PROMPT },
                { type: 'image_url', image_url: { url: `data:${mime || 'image/jpeg'};base64,${imageBase64}` } }
              ]
            }
          ],
          max_tokens: 700,
          temperature: 0
        })
      });
      const data = await resp.json().catch(() => ({}));
      const text = String(data?.choices?.[0]?.message?.content || '').trim();
      if (text) return text;
    } catch (err) {
      console.warn('[subs-import] OpenAI vision error:', err?.message || err);
    }
  }

  return null;
}

function parseExtractorJson(raw) {
  if (!raw) return null;
  let text = String(raw).trim();
  // Strip code fences from the model's output if present.
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // Locate the first { ... } block; some models prefix with prose
  // even when asked not to.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function normalizeImportedSubscription(extracted = {}) {
  // Title may arrive as raw "Mr." / "mr" / "MR." / "family". Normalise
  // to the canonical four values the rest of the app uses.
  const titleRaw = String(extracted.client_title || '').trim();
  let titleClean = '';
  if (/^mrs\.?$/i.test(titleRaw)) titleClean = 'Mrs.';
  else if (/^mr\.?$/i.test(titleRaw)) titleClean = 'Mr.';
  else if (/^ms\.?$/i.test(titleRaw)) titleClean = 'Ms.';
  else if (/^family$/i.test(titleRaw)) titleClean = 'Family';
  else titleClean = titleRaw || 'Mr.';

  // Time fields might come in HH.MM (the receipt format) instead of
  // HH:MM:SS. Replace dots with colons and pad seconds.
  const normalizeTime = (raw) => {
    if (!raw) return null;
    const text = String(raw).replace(/\./g, ':');
    const m = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    return `${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}`;
  };

  // Period might be "30 Days" — extract the integer.
  const periodRaw = extracted.access_period;
  let accessPeriod = null;
  if (typeof periodRaw === 'number' && Number.isFinite(periodRaw)) {
    accessPeriod = Math.round(periodRaw);
  } else if (typeof periodRaw === 'string') {
    const m = periodRaw.match(/\d+/);
    if (m) accessPeriod = parseInt(m[0], 10);
  }

  // Title-case the client name so "medacandra" → "Medacandra"
  // matches what the rest of the dashboard expects.
  const nameRaw = String(extracted.client_name || '').trim();
  const clientName = nameRaw
    ? nameRaw.replace(/\b[a-z]/g, (c) => c.toUpperCase())
    : '';

  return {
    client_title: titleClean,
    client_name: clientName,
    service: String(extracted.service || '').trim(),
    status: /paid|confirmed|received/i.test(String(extracted.status || '')) ? 'paid' : '',
    payment_date: cleanIsoDate(extracted.payment_date),
    payment_time: normalizeTime(extracted.payment_time),
    access_period: accessPeriod,
    start_date: cleanIsoDate(extracted.start_date),
    start_time: normalizeTime(extracted.start_time),
    expiry_date: cleanIsoDate(extracted.expiry_date),
    expiry_time: normalizeTime(extracted.expiry_time)
  };
}

const SUBSCRIPTION_IMPORT_SERVICE_ALIASES = [
  { aliases: ['google-drive', 'googledrive', 'gdrive', 'drive'], label: 'Google Drive', pattern: /google\s*drive|gdrive/i },
  { aliases: ['chatgpt', 'gpt'], label: 'ChatGPT', pattern: /chat\s*gpt|chatgpt/i },
  { aliases: ['icloud', 'i-cloud'], label: 'iCloud', pattern: /icloud|i\s*cloud/i },
  { aliases: ['dropbox'], label: 'Dropbox', pattern: /dropbox/i },
  { aliases: ['copilot'], label: 'Copilot', pattern: /copilot/i }
];

function normalizeImportServiceName(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const found = SUBSCRIPTION_IMPORT_SERVICE_ALIASES.find((item) => item.pattern.test(normalized));
  return found ? found.label : titleCaseName(normalized);
}

function parseSubscriptionImportFilename(fileName = '') {
  const base = String(fileName || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  const match = base.match(/^subscription-(paid|invoice|confirmed)-(.+)$/i);
  if (!match) return {};
  const status = match[1] === 'invoice' ? 'invoice' : 'paid';
  const tail = match[2];
  const aliases = SUBSCRIPTION_IMPORT_SERVICE_ALIASES.flatMap((item) => item.aliases.map((alias) => ({ alias, label: item.label })));
  const found = aliases
    .sort((a, b) => b.alias.length - a.alias.length)
    .find(({ alias }) => tail === alias || tail.startsWith(`${alias}-`));
  let serviceRaw = '';
  let clientRaw = '';
  if (found) {
    serviceRaw = found.label;
    clientRaw = tail.slice(found.alias.length).replace(/^-+/, '');
  } else {
    const pieces = tail.split('-').filter(Boolean);
    serviceRaw = pieces.shift() || '';
    clientRaw = pieces.join(' ');
  }
  const titleMatch = clientRaw.match(/^(mr|ms|mrs|family)-(.+)$/i);
  const titleToken = titleMatch ? titleMatch[1].toLowerCase() : '';
  return {
    client_title: titleToken === 'mrs' ? 'Mrs.' : titleToken === 'ms' ? 'Ms.' : titleToken === 'family' ? 'Family' : titleToken ? 'Mr.' : '',
    client_name: titleCaseName((titleMatch ? titleMatch[2] : clientRaw).replace(/[-_]+/g, ' ')),
    service: normalizeImportServiceName(serviceRaw),
    status
  };
}

function mergeImportedSubscription(...sources) {
  return sources.reduce((merged, source) => {
    Object.entries(source || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== '') merged[key] = value;
    });
    return merged;
  }, {});
}

function hasUsefulImportedSubscription(parsed = {}) {
  return !!(parsed.client_name || parsed.service || parsed.payment_date || parsed.start_date || parsed.expiry_date);
}

async function findExistingSubscription(env, parsed) {
  const name = String(parsed?.client_name || '').trim();
  const service = String(parsed?.service || '').trim();
  if (!name || !service) return null;
  // PostgREST `ilike` filters give us case-insensitive matching for
  // both client_name and service, which lines up with how the rest
  // of the dashboard groups rows. payment_date and start_date are
  // exact matches when present so we don't false-merge across
  // monthly renewals.
  const filters = [
    `client_name=ilike.${encodeURIComponent(name)}`,
    `service=ilike.${encodeURIComponent(service)}`
  ];
  if (parsed.payment_date) filters.push(`payment_date=eq.${encodeURIComponent(parsed.payment_date)}`);
  if (parsed.start_date) filters.push(`start_date=eq.${encodeURIComponent(parsed.start_date)}`);
  const path = `/rest/v1/subscriptions?select=id,client_name,service,payment_date,start_date,status&${filters.join('&')}&limit=1`;
  try {
    const rows = await supabaseFetch(env, path);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch (err) {
    console.warn('[subs-import] dup lookup failed:', err?.message || err);
    return null;
  }
}

async function handleSubscriptionImport(request, env) {
  if (!(await verifyAdminRequest(request, env))) return json({ error: 'Unauthorized.' }, 401);

  // Accept either multipart/form-data with a `file` field or a JSON
  // body { image: "base64", mime: "image/jpeg" }. The multipart
  // path is what the /db Subs editor sends; the JSON path is
  // retained for direct API consumers.
  let imageBase64 = '';
  let mime = 'image/jpeg';
  let fileName = '';
  const contentType = String(request.headers.get('content-type') || '').toLowerCase();
  try {
    if (contentType.startsWith('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!file || typeof file.arrayBuffer !== 'function') {
        return json({ error: 'No image file uploaded.' }, 400);
      }
      mime = String(file.type || mime);
      fileName = String(file.name || '');
      const buf = new Uint8Array(await file.arrayBuffer());
      imageBase64 = bytesToBase64(buf);
    } else {
      const body = await request.json().catch(() => ({}));
      imageBase64 = String(body.image || '').replace(/^data:[^,]+,/, '');
      mime = String(body.mime || mime);
      fileName = String(body.fileName || body.filename || '');
    }
  } catch (err) {
    return json({ error: 'Could not read uploaded image.' }, 400);
  }
  if (!imageBase64) return json({ error: 'Missing image data.' }, 400);

  const filenameFallback = parseSubscriptionImportFilename(fileName);
  const responseText = await callVisionExtractor(env, imageBase64, mime);
  if (!responseText) {
    if (hasUsefulImportedSubscription(filenameFallback)) {
      return json({
        ok: true,
        parsed: filenameFallback,
        existing: null,
        needs_review: true,
        message: 'Server OCR unavailable. Filename fields restored; review the remaining fields.'
      });
    }
    return json({ ok: false, error: 'Could not read image, please enter manually.' }, 503);
  }
  const extracted = parseExtractorJson(responseText);
  if (!extracted) {
    if (hasUsefulImportedSubscription(filenameFallback)) {
      return json({
        ok: true,
        parsed: filenameFallback,
        existing: null,
        needs_review: true,
        message: 'Server OCR returned unreadable text. Filename fields restored; review the remaining fields.'
      });
    }
    return json({ ok: false, error: 'Could not read image, please enter manually.' }, 503);
  }

  const parsed = mergeImportedSubscription(filenameFallback, normalizeImportedSubscription(extracted));
  const existing = await findExistingSubscription(env, parsed);
  return json({
    ok: true,
    parsed,
    existing: existing ? { id: String(existing.id), status: existing.status || '' } : null
  });
}

// ── Invoice packages (item catalogue) ──────────────────────────────
// Powers the /inv autocomplete: 5 hardcoded defaults plus any custom
// packages saved from the invoice generator. Schema lives in
// db-migration-part-5.sql.

const DEFAULT_INVOICE_PACKAGES = [
  { id: 'school-basic',         name: 'School without Magician', price: 800000,  note: 'school celebration without magician',           is_default: true },
  { id: 'school-magician',      name: 'School with Magician',    price: 1000000, note: 'school celebration with magician',              is_default: true },
  { id: 'studio-special',       name: 'Studio Special',          price: 800000,  note: 'up to 1 hour',                                  is_default: true },
  { id: 'intimate-party',       name: 'Intimate Party',          price: 1300000, note: 'up to 2 hours, suitable for family celebration', is_default: true },
  { id: 'birthday-celebration', name: 'Birthday Celebration',    price: 1650000, note: 'up to 3.5 hours, suitable for Birthday Celebration', is_default: true }
];

function normalizeInvoicePackagePayload(raw = {}) {
  const cleanInt = (v, fallback = 0) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    name: String(raw.name || '').trim().slice(0, 160),
    price: cleanInt(raw.price, 0),
    note: String(raw.note || '').trim().slice(0, 400)
  };
}

async function handlePackagesGet(request, env) {
  if (!(await verifyAdminRequest(request, env))) return json({ error: 'Unauthorized.' }, 401);
  try {
    const rows = await supabaseFetch(
      env,
      '/rest/v1/invoice_packages?select=*&order=is_default.desc,name.asc'
    );
    const packages = Array.isArray(rows) ? rows : [];
    return json({ ok: true, packages });
  } catch (error) {
    // Schema-cache / missing-table tolerance, mirroring the subscription
    // pattern. Surface the hardcoded defaults so /inv keeps working even
    // before the migration is run.
    if (isSchemaError(error)) {
      return json({ ok: true, packages: DEFAULT_INVOICE_PACKAGES, fallback: true });
    }
    throw error;
  }
}

async function handlePackageSave(request, env) {
  const body = await request.json().catch(() => ({}));
  const password = String(body.password || '').trim();
  if (!(await verifyAdminRequest(request, env, password))) return json({ error: 'Unauthorized.' }, 401);

  const incoming = body.package || body;
  const payload = normalizeInvoicePackagePayload(incoming);
  if (!payload.name) return json({ error: 'Package name is required.' }, 400);
  if (!payload.price) return json({ error: 'Package price is required.' }, 400);

  const id = String(incoming.id || '').trim();

  // If the row exists and is flagged as default, preserve that flag on update
  // so we never accidentally lose a default's protection.
  let existing = null;
  if (id) {
    existing = await supabaseFetch(
      env,
      `/rest/v1/invoice_packages?select=*&id=eq.${encodeURIComponent(id)}&limit=1`
    )
      .then((rows) => Array.isArray(rows) ? rows[0] : rows)
      .catch(() => null);
  }

  if (id && existing) {
    const rows = await supabaseFetch(
      env,
      `/rest/v1/invoice_packages?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload)
      }
    );
    const saved = Array.isArray(rows) ? rows[0] : rows;
    return json({ ok: true, package: saved });
  }

  const rows = await supabaseFetch(env, '/rest/v1/invoice_packages', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...payload, is_default: false })
  });
  const saved = Array.isArray(rows) ? rows[0] : rows;
  return json({ ok: true, package: saved });
}

async function handlePackageDelete(request, env) {
  const body = await request.json().catch(() => ({}));
  const password = String(body.password || '').trim();
  const id = String(body.id || '').trim();
  if (!(await verifyAdminRequest(request, env, password))) return json({ error: 'Unauthorized.' }, 401);
  if (!id) return json({ error: 'Missing package id.' }, 400);

  // Look up the row first so we can refuse to delete a default.
  const existing = await supabaseFetch(
    env,
    `/rest/v1/invoice_packages?select=id,is_default&id=eq.${encodeURIComponent(id)}&limit=1`
  )
    .then((rows) => Array.isArray(rows) ? rows[0] : rows)
    .catch(() => null);

  if (!existing) return json({ error: 'Package not found.' }, 404);
  if (existing.is_default) return json({ error: 'Default packages cannot be deleted.' }, 400);

  await supabaseFetch(env, `/rest/v1/invoice_packages?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  });
  return json({ ok: true });
}

function rootHomepage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow">
  <title>StarShots</title>
  <style>${shellStyles()}
    .home-card{width:min(100%,720px);text-align:center;padding:42px 34px;opacity:0;-webkit-transform:translateY(-8px) scale(.992);transform:translateY(-8px) scale(.992);-webkit-transition:opacity 900ms cubic-bezier(.16,1,.3,1),-webkit-transform 900ms cubic-bezier(.16,1,.3,1);transition:opacity 900ms cubic-bezier(.16,1,.3,1),transform 900ms cubic-bezier(.16,1,.3,1)}
    .home-card.is-visible{opacity:1;-webkit-transform:translateY(-20px) scale(1);transform:translateY(-20px) scale(1)}
    .reveal{opacity:0;-webkit-transform:translateY(-10px);transform:translateY(-10px);-webkit-transition:opacity 820ms cubic-bezier(.16,1,.3,1),-webkit-transform 820ms cubic-bezier(.16,1,.3,1);transition:opacity 820ms cubic-bezier(.16,1,.3,1),transform 820ms cubic-bezier(.16,1,.3,1)}
    .reveal.is-visible{opacity:1;-webkit-transform:translateY(0);transform:translateY(0)}
    .stagger-1{-webkit-transition-delay:120ms;transition-delay:120ms}.stagger-2{-webkit-transition-delay:240ms;transition-delay:240ms}.stagger-3{-webkit-transition-delay:360ms;transition-delay:360ms}.stagger-4{-webkit-transition-delay:480ms;transition-delay:480ms}.stagger-5{-webkit-transition-delay:600ms;transition-delay:600ms}.stagger-6{-webkit-transition-delay:720ms;transition-delay:720ms}
    .construct{width:min(260px,58vw);margin:6px auto 22px;display:block;color:var(--accent)}
    .status-pill{display:inline-flex;align-items:center;gap:8px;margin:4px auto 18px;padding:8px 13px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.42);color:var(--soft);font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
    .ig-link{display:inline-flex;align-items:center;gap:10px;margin-top:24px;color:var(--ink);text-decoration:none;font-size:18px;font-weight:850}
    .ig-link svg{width:28px;height:28px;display:block}
    .ig-link:hover{opacity:.72}
    .ig-link:active{transform:scale(.985)}
    .intro-settled .reveal{transition-delay:0ms!important}
    @media(prefers-color-scheme:dark){.ss-logo-hero{filter:brightness(0) invert(1) sepia(.08) saturate(.7);opacity:.92}}
    @media(prefers-reduced-motion:reduce){*{-webkit-animation:none!important;animation:none!important;-webkit-transition:none!important;transition:none!important;scroll-behavior:auto!important}.home-card,.reveal{opacity:1!important;-webkit-transform:none!important;transform:none!important}}
    @media(max-width:520px){.home-card{padding:32px 22px}.construct{width:min(220px,70vw)}.ig-link{font-size:17px}}
  </style>
  ${animateAssets()}
</head>
<body>
  <div class="wrap center">
    <main class="card home-card">
      <a class="reveal stagger-1" href="/" aria-label="StarShots homepage" style="display:inline-block;text-decoration:none"><img class="ss-logo-hero" src="${LOGO_PATH}" alt="StarShots logo"></a>
      <svg class="construct reveal stagger-2" viewBox="0 0 320 180" aria-hidden="true">
        <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="8" opacity=".9">
          <path d="M56 142h208"/>
          <path d="M92 142l44-76h48l44 76"/>
          <path d="M118 112h84"/>
          <path d="M136 66l-18-28h84l-18 28"/>
          <path d="M160 66v76"/>
          <path d="M70 142l-22 26M250 142l22 26"/>
        </g>
        <g fill="currentColor" opacity=".18">
          <circle cx="54" cy="44" r="20"/><circle cx="268" cy="58" r="14"/><circle cx="242" cy="28" r="7"/>
        </g>
      </svg>
      <div class="status-pill reveal stagger-3">Private System</div>
      <h1 class="reveal stagger-4">We Are Refining This Space</h1>
      <p class="hero-copy reveal stagger-5">StarShots private delivery is being carefully polished for a cleaner, smoother client experience.</p>
      <a class="ig-link reveal stagger-6" href="https://instagram.com/starshots.id" target="_blank" rel="noopener" aria-label="Open StarShots Instagram">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="6.5" r="1.3" fill="currentColor"/></svg>
        <span>@starshots.id</span>
      </a>
    </main>
  </div>
  <script>
    (function(){
      var card=document.querySelector('.home-card');
      var reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      function show(){
        if(card) card.classList.add('is-visible');
        document.querySelectorAll('.reveal').forEach(function(el){el.classList.add('is-visible');});
        setTimeout(function(){document.body.classList.add('intro-settled');}, reduceMotion?0:1500);
      }
      requestAnimationFrame(function(){
        // Two rAFs so the first paint locks in the pre-mount state on iOS.
        requestAnimationFrame(show);
      });
      // Safety: even if rAF chain breaks, force-show after 1500ms.
      setTimeout(show, 1500);
    })();
  </script>
</body>
</html>`;
}

/**
 * Friendly "page not found" page for unknown URLs.
 *
 * Why this exists in this exact shape:
 *   - The previous build sent every unknown URL to "/" with a 302
 *     redirect. That kept the address bar showing whatever the user
 *     mistyped (`/in`, `/xx`, `/inva`...) which was confusing — the
 *     URL didn't match the page they ended up on.
 *   - We now serve a real 404 so the URL stays as-is and the browser
 *     marks it as an error response. That also tightens the rate
 *     limit story: scanners crawling the URL space hit a 404 wall
 *     plus a 3/min cap (see assetOrFallback), without us also having
 *     to rewrite the URL.
 *   - Visual identity matches the homepage card (same background,
 *     same logo, same hero spacing) so users land on something that
 *     still feels like StarShots.
 *   - Reserved paths (/inv, /l, /admin, /db, /g/<slug>, /<short>) are
 *     handled by their own routes earlier in fetch(); they never
 *     reach this 404 unless the underlying record is missing.
 */
function notFoundPage(path = '') {
  const safePath = escapeHtml(path || '/');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow">
  <title>StarShots · Not Found</title>
  <style>${shellStyles()}
    .home-card{width:min(100%,640px);text-align:center;padding:42px 34px;opacity:0;-webkit-transform:translateY(-8px) scale(.992);transform:translateY(-8px) scale(.992);-webkit-transition:opacity 900ms cubic-bezier(.16,1,.3,1),-webkit-transform 900ms cubic-bezier(.16,1,.3,1);transition:opacity 900ms cubic-bezier(.16,1,.3,1),transform 900ms cubic-bezier(.16,1,.3,1)}
    .home-card.is-visible{opacity:1;-webkit-transform:translateY(-20px) scale(1);transform:translateY(-20px) scale(1)}
    .reveal{opacity:0;-webkit-transform:translateY(-10px);transform:translateY(-10px);-webkit-transition:opacity 820ms cubic-bezier(.16,1,.3,1),-webkit-transform 820ms cubic-bezier(.16,1,.3,1);transition:opacity 820ms cubic-bezier(.16,1,.3,1),transform 820ms cubic-bezier(.16,1,.3,1)}
    .reveal.is-visible{opacity:1;-webkit-transform:translateY(0);transform:translateY(0)}
    .stagger-1{-webkit-transition-delay:120ms;transition-delay:120ms}.stagger-2{-webkit-transition-delay:240ms;transition-delay:240ms}.stagger-3{-webkit-transition-delay:360ms;transition-delay:360ms}.stagger-4{-webkit-transition-delay:480ms;transition-delay:480ms}.stagger-5{-webkit-transition-delay:600ms;transition-delay:600ms}.stagger-6{-webkit-transition-delay:720ms;transition-delay:720ms}
    .nf-code{font-family:"Cormorant Garamond","Times New Roman",serif;font-size:clamp(72px,18vw,128px);font-weight:300;line-height:.95;letter-spacing:-.04em;color:var(--ink);margin:0 0 4px}
    .status-pill{display:inline-flex;align-items:center;gap:8px;margin:6px auto 18px;padding:8px 13px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.42);color:var(--soft);font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
    .nf-path{display:inline-block;margin-top:14px;padding:6px 12px;border:1px solid var(--line);border-radius:999px;background:var(--solid);color:var(--soft);font-size:12px;font-weight:800;letter-spacing:.06em;font-family:ui-monospace,Menlo,Consolas,monospace;max-width:90%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle}
    .nf-actions{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:26px}
    .nf-btn{display:inline-flex;align-items:center;gap:8px;padding:13px 22px;border-radius:14px;border:1px solid var(--line);background:var(--solid);color:var(--ink);text-decoration:none;font-size:14px;font-weight:800;letter-spacing:.02em;transition:transform .25s cubic-bezier(.22,1,.36,1),box-shadow .25s cubic-bezier(.22,1,.36,1),background .25s cubic-bezier(.22,1,.36,1)}
    .nf-btn.primary{background:var(--ink);color:var(--card);border-color:transparent;box-shadow:0 14px 30px -12px rgba(26,26,26,.45),0 4px 10px -4px rgba(26,26,26,.28)}
    .nf-btn:hover{transform:translateY(-2px)}
    .nf-btn:active{transform:translateY(0) scale(.992)}
    .intro-settled .reveal{transition-delay:0ms!important}
    @media(prefers-color-scheme:dark){.ss-logo-hero{filter:brightness(0) invert(1) sepia(.08) saturate(.7);opacity:.92}}
    @media(prefers-reduced-motion:reduce){*{-webkit-animation:none!important;animation:none!important;-webkit-transition:none!important;transition:none!important;scroll-behavior:auto!important}.home-card,.reveal{opacity:1!important;-webkit-transform:none!important;transform:none!important}}
    @media(max-width:520px){.home-card{padding:32px 22px}.nf-actions{flex-direction:column}.nf-btn{width:100%;justify-content:center}}
  </style>
  ${animateAssets()}
</head>
<body>
  <div class="wrap center">
    <main class="card home-card" role="main">
      <a class="reveal stagger-1" href="/" aria-label="StarShots homepage" style="display:inline-block;text-decoration:none"><img class="ss-logo-hero" src="${LOGO_PATH}" alt="StarShots logo"></a>
      <p class="nf-code reveal stagger-2">404</p>
      <div class="status-pill reveal stagger-3">Page Not Found</div>
      <h1 class="reveal stagger-4">This Page Doesn't Exist</h1>
      <p class="hero-copy reveal stagger-5">The address you tried isn't part of StarShots. Double-check the link or head back to the homepage.</p>
      <p class="reveal stagger-5"><span class="nf-path">${safePath}</span></p>
      <div class="nf-actions reveal stagger-6">
        <a class="nf-btn primary" href="/">Go to Homepage</a>
        <a class="nf-btn" href="https://instagram.com/starshots.id" target="_blank" rel="noopener">@starshots.id</a>
      </div>
    </main>
  </div>
  <script>
    (function(){
      var card=document.querySelector('.home-card');
      var reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      function show(){
        if(card) card.classList.add('is-visible');
        document.querySelectorAll('.reveal').forEach(function(el){el.classList.add('is-visible');});
        setTimeout(function(){document.body.classList.add('intro-settled');}, reduceMotion?0:1500);
      }
      requestAnimationFrame(function(){requestAnimationFrame(show);});
      setTimeout(show, 1500);
    })();
  </script>
</body>
</html>`;
}

/**
 * Wrap the entry-HTML responses we serve from the Pages asset
 * bundle (and the inline rootHomepage / notFoundPage strings) with
 * cache headers that force the browser to revalidate every time.
 *
 * Background. The hashed JS/CSS bundles emitted by Vite are
 * content-addressed and can be cached forever — that part is fine.
 * The entry HTML (g/index.html, db/index.html, …) is the index
 * that pins which hashed bundle gets loaded; if a mobile browser
 * keeps a stale entry HTML it will render an old build forever.
 *
 * That is the exact failure mode behind the "Android still shows
 * the old `Hello, Title Name` UI after clearing site data" report
 * for /g/<slug> and /<short>: those routes are served by the same
 * /g/index.html as desktop (this worker rewrites both to /g/), but
 * Pages' default ETag-based revalidation is treated as
 * opportunistic by several Android engines (Firefox Focus and the
 * DuckDuckGo browser in particular), so the old entry sticks
 * around and pulls in stale CSS/JS.
 *
 * Forcing `Cache-Control: no-cache, must-revalidate, max-age=0`
 * on the entry HTML makes every reload hit the origin (or at
 * minimum validate against the ETag), and `Vary: Cookie` keeps
 * admin and public visitors on separate cache entries — the
 * gallery page POSTs an empty-password admin probe with
 * credentials, and the rendered state diverges by cookie. The
 * hashed bundles are unaffected (this only touches `text/html`
 * responses), so the immutable-cache benefit on the heavy assets
 * is preserved.
 */
function withFreshHtmlHeaders(response) {
  if (!response) return response;
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html')) return response;
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-cache, must-revalidate, max-age=0');
  const existingVary = headers.get('Vary');
  if (!existingVary) {
    headers.set('Vary', 'Cookie');
  } else if (!/\bcookie\b/i.test(existingVary)) {
    headers.set('Vary', `${existingVary}, Cookie`);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    const url = new URL(request.url);

    // Canonical-link redirect pass.
    //
    // Three legacy URL shapes still circulate in client inboxes
    // and stored templates from before the canonical short-form
    // rollout:
    //
    //   1. https://sshots.pages.dev/<short>
    //   2. https://sshots.pages.dev/g/<short>
    //   3. https://starshots.pages.dev/g/<short>
    //
    // All three must continue to work for clients who already
    // received them, but every navigation should land on the
    // canonical `starshots.pages.dev/<short>` URL so the public
    // delivery UI, address-bar share, and `Open in new tab` all
    // surface a single shape. We send a 301 (permanent) for GET so
    // browsers, link previewers, and chat apps collapse the old
    // form on first visit; non-GET requests fall through to the
    // existing API/asset routing so e.g. `/api/unlock` POSTs from a
    // legacy embed are not interrupted.
    //
    // Slug/password integrity is intentionally untouched here — we
    // only canonicalize the host and strip a leading `/g/` segment
    // when the next path component is a 7/12-char short code.
    if (request.method === 'GET') {
      const isLegacyHost = /^(?:www\.)?sshots\.pages\.dev$/i.test(url.hostname);
      const galleryShortMatch = url.pathname.match(/^\/g\/([a-z0-9]{7}|[a-z0-9]{12})\/?$/i);
      const needsHostRewrite = isLegacyHost;
      const needsPathRewrite = !!galleryShortMatch;
      if (needsHostRewrite || needsPathRewrite) {
        const target = new URL(url.toString());
        target.hostname = 'starshots.pages.dev';
        target.protocol = 'https:';
        target.port = '';
        if (galleryShortMatch) {
          // Collapse `/g/<short>` to `/<short>` regardless of host.
          target.pathname = `/${cleanShortCode(galleryShortMatch[1]) || galleryShortMatch[1].toLowerCase()}`;
        }
        return Response.redirect(target.toString(), 301);
      }
    }

    try {
	      if (request.method === 'GET' && url.pathname === '/') {
	        return withFreshHtmlHeaders(
	          new Response(rootHomepage(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
	        );
	      }
	      // /admin and /invcs were duplicate UI surfaces that we retired
	      // in the unified-frame migration. _redirects sends /admin → /db/
	      // and /invcs → /inv/. We intentionally do NOT short-circuit here
	      // so the static _redirects file owns the behaviour.
	      if (request.method === 'GET' && ['/inv', '/inv/', '/invoice', '/invoice/', '/inv/index.html'].includes(url.pathname)) {
        const assetUrl = new URL(request.url);
        assetUrl.pathname = '/inv/';
        return withFreshHtmlHeaders(await env.ASSETS.fetch(new Request(assetUrl.toString(), request)));
      }
      if (request.method === 'GET' && ['/l', '/l/', '/l/index.html'].includes(url.pathname)) {
        const assetUrl = new URL(request.url);
        assetUrl.pathname = '/l/';
        return withFreshHtmlHeaders(await env.ASSETS.fetch(new Request(assetUrl.toString(), request)));
      }
      if (request.method === 'GET' && ['/subs', '/subs/', '/subs/index.html'].includes(url.pathname)) {
        const assetUrl = new URL(request.url);
        assetUrl.pathname = '/subs/';
        return withFreshHtmlHeaders(await env.ASSETS.fetch(new Request(assetUrl.toString(), request)));
      }
      if (request.method === 'GET' && ['/db', '/db/', '/db/index.html'].includes(url.pathname)) {
        const assetUrl = new URL(request.url);
        assetUrl.pathname = '/db/';
        return withFreshHtmlHeaders(await env.ASSETS.fetch(new Request(assetUrl.toString(), request)));
      }
      if (request.method === 'GET' && ['/g', '/g/', '/g/index.html'].includes(url.pathname)) {
        const assetUrl = new URL(request.url);
        assetUrl.pathname = '/g/';
        return withFreshHtmlHeaders(await env.ASSETS.fetch(new Request(assetUrl.toString(), request)));
      }
      if (request.method === 'POST' && url.pathname === '/api/admin-check') return await handleAdminCheck(request, env);
      if (request.method === 'POST' && url.pathname === '/api/invoices-save') return await handleInvoiceSave(request, env);
      if (request.method === 'GET' && url.pathname === '/api/invoices-get') return await handleInvoiceGet(request, env);
      if (request.method === 'POST' && url.pathname === '/api/invoices-delete') return await handleInvoiceDelete(request, env);
      if (request.method === 'POST' && url.pathname === '/api/subscriptions-save') return await handleSubscriptionSave(request, env);
      if (request.method === 'GET' && url.pathname === '/api/subscriptions-get') return await handleSubscriptionGet(request, env);
      if (request.method === 'POST' && url.pathname === '/api/subscriptions-delete') return await handleSubscriptionDelete(request, env);
      if (request.method === 'POST' && url.pathname === '/api/subscriptions-import') return await handleSubscriptionImport(request, env);
      if (request.method === 'GET' && url.pathname === '/api/packages') return await handlePackagesGet(request, env);
      if (request.method === 'POST' && url.pathname === '/api/packages-save') return await handlePackageSave(request, env);
      if (request.method === 'POST' && url.pathname === '/api/packages-delete') return await handlePackageDelete(request, env);
      if (request.method === 'POST' && url.pathname === '/api/save') return await handleSave(request, env);
      if (request.method === 'POST' && url.pathname === '/api/unlock') return await handleUnlock(request, env);
      if (request.method === 'POST' && url.pathname === '/api/click') return await handleClick(request, env);
	      if (request.method === 'GET' && url.pathname === '/api/db') return await handleDbSearch(request, env);
	      if (request.method === 'POST' && url.pathname === '/api/clients-save') return await handleClientSave(request, env);
	      if (request.method === 'POST' && url.pathname === '/api/clients-delete') return await handleClientDelete(request, env);
	      if (request.method === 'POST' && url.pathname === '/api/db-password') return await handleDbPasswordChange(request, env);
	      if (request.method === 'POST' && url.pathname === '/api/db-delete') return await handleDbDelete(request, env);
	      if (request.method === 'POST' && url.pathname === '/api/db-clear-logs') return await handleDbClearLogs(request, env);
	      if (request.method === 'POST' && url.pathname === '/api/db-repair-delivery') return await handleDbRepairDelivery(request, env);
	      if (request.method === 'POST' && url.pathname === '/api/db-update-delivery') return await handleDbUpdateDelivery(request, env);

      const shortAliasMatch = url.pathname.match(/^\/([a-z0-9]{7}|[a-z0-9]{12})\/?$/i);
      if (request.method === 'GET' && shortAliasMatch) {
        const limited = enforceRateLimit(request, 'short-alias', { limit: 40, windowMs: 60 * 1000, blockMs: 10 * 60 * 1000 }, false);
        if (limited) return limited;
        const shortCode = cleanShortCode(shortAliasMatch[1]);
        const delivery = shortCode ? await getDeliveryByShortCode(env, shortCode) : null;
        if (delivery) {
          await insertLog(env, request, delivery.id, 'page_view');
          const assetUrl = new URL(request.url);
          assetUrl.pathname = '/g/';
          return withFreshHtmlHeaders(await env.ASSETS.fetch(new Request(assetUrl.toString(), request)));
        }
        // Unknown short code: serve a real 404 so the address bar
        // keeps the URL the visitor typed (a 302 to "/" hid that)
        // and the browser marks the response as an error. Bots
        // walking the short-code space hit both this 404 and the
        // 40/min rate limit we already consumed above.
        return withFreshHtmlHeaders(
          new Response(notFoundPage(url.pathname), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
        );
      }

      const galleryMatch = url.pathname.match(/^\/g\/([^/]+)\/?$/i);
      if (request.method === 'GET' && galleryMatch) {
        const limited = enforceRateLimit(request, 'gallery-slug', { limit: 60, windowMs: 60 * 1000, blockMs: 10 * 60 * 1000 }, false);
        if (limited) return limited;
        const slug = normalizeGalleryCode(decodeURIComponent(galleryMatch[1])) || cleanSlug(galleryMatch[1]);
        if (slug && cleanSlug(galleryMatch[1]) !== slug) return Response.redirect(`${url.origin}/g/${slug}`, 302);
        const delivery = await getLatestDeliveryBySlug(env, slug);
        if (shouldBlockFolderSlug(delivery)) {
          // Blocked-folder slugs (folders the admin marked
          // not-public) get a generic 404. Indistinguishable from a
          // slug that simply does not exist — an attacker can't tell
          // "blocked" from "never existed".
          return withFreshHtmlHeaders(
            new Response(notFoundPage(url.pathname), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
          );
        }
        if (delivery) await insertLog(env, request, delivery.id, 'page_view');
        const assetUrl = new URL(request.url);
        assetUrl.pathname = '/g/';
        return withFreshHtmlHeaders(await env.ASSETS.fetch(new Request(assetUrl.toString(), request)));
      }

      const oldDeliveryMatch = url.pathname.match(/^\/l\/([^/]+)\/?$/i);
      if (request.method === 'GET' && oldDeliveryMatch) {
        const slug = normalizeGalleryCode(decodeURIComponent(oldDeliveryMatch[1])) || cleanSlug(oldDeliveryMatch[1]);
        return Response.redirect(`${url.origin}/g/${slug}`, 302);
      }
    } catch (error) {
      if (url.pathname.startsWith('/api/')) {
        // Log full diagnostic detail (status, PostgREST code, message)
        // server-side, but return a short user-facing message so the
        // /db UI never paints a raw Supabase JSON blob across the
        // panel. The client maps this into "Database request failed.
        // Check API configuration."
        if (error?.supabase) {
          console.warn(`[api] ${url.pathname} supabase ${error.status || ''} ${error.code || ''} ${error.message || ''}`);
          return json({ error: 'Database request failed. Check API configuration.', code: error.code || undefined }, 500);
        }
        return json({ error: error.message || 'Server error.' }, 500);
      }
      return new Response(notFoundPage(url.pathname), { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    return await assetOrFallback(request, env);
  }
};

/**
 * Catch-all asset handler with a real 404 for unknown HTML pages.
 *
 * Behaviour:
 *   - Hands every unrouted request to env.ASSETS.fetch(...).
 *   - If the asset exists (any 2xx/3xx, or a 404 from a non-HTML
 *     request like `/missing.png`), pass it through unchanged. We
 *     never want to upgrade an <img> 404 to an HTML page.
 *   - If the asset is missing AND the visitor is asking for a page
 *     (Accept header includes text/html on a GET — true for every
 *     address-bar navigation), rate-limit the IP+scope
 *     'unknown-path', then serve a styled 404 (notFoundPage).
 *     The address bar keeps the URL the visitor typed (a redirect
 *     hid that and made `/in` show the homepage), and the browser
 *     sees a real 404 status.
 *   - Reserved paths (/, /admin, /db, /inv, /l, /g/<slug>, /<short>)
 *     are handled earlier in fetch() and never reach this code, so
 *     a legitimate visit there is never counted against this scope.
 *   - All other 404s (POST/PUT, fetch()/XHR without an explicit
 *     text/html Accept, missing /foo.png, missing /api/whatever)
 *     get the original 404 untouched.
 *
 * Rate limit: 3 attempts per minute, then block the IP for 5 min.
 * Tight on purpose — typing a wrong URL more than three times in a
 * minute is almost always a script walking the URL space looking
 * for short codes. Legitimate visitors rarely fat-finger that fast,
 * and if they do the existing-route limits (40/min on /<short>,
 * 60/min on /g/<slug>) stay generous because reserved paths never
 * spend this scope's budget.
 */
async function assetOrFallback(request, env) {
  const response = await env.ASSETS.fetch(request);
  if (response.status !== 404) return response;
  if (request.method !== 'GET') return response;

  const accept = request.headers.get('accept') || '';
  // Only synthesize an HTML 404 when the visitor is clearly asking
  // for a page. A bare `Accept: */*` or empty (typical of fetch()
  // and XHR without an explicit Accept) keeps the original 404 —
  // turning a missing JSON or image into HTML would be worse.
  if (!accept.includes('text/html')) return response;

  const limited = enforceRateLimit(
    request,
    'unknown-path',
    { limit: 3, windowMs: 60 * 1000, blockMs: 5 * 60 * 1000 },
    false
  );
  if (limited) return limited;

  const url = new URL(request.url);
  return new Response(notFoundPage(url.pathname), {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
