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

const SHORT_ALPHABET = '1236789abcdefghijklmnopqrstuvwxyz';
const SHORT_CODE_LENGTH = 12;
const LEGACY_SHORT_CODE_LENGTH = 7;
const GALLERY_PASSWORD_LENGTH = 6;
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
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SECRET_KEY || '';
  if (!url || !key) throw new Error('Supabase environment variables are missing.');
  return { url, key };
}

async function supabaseFetch(env, path, options = {}) {
  const { url, key } = getSupabase(env);
  const response = await fetch(`${url}${path}`, {
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
    throw new Error(text || `Supabase error ${response.status}`);
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
  return new RegExp(`^[${SHORT_ALPHABET}]+$`).test(code) ? code : '';
}

function shortCodeFromText(value = '') {
  const text = String(value || '');
  const match = text.match(/(?:https?:\/\/)?(?:www\.)?starshots\.pages\.dev\/([a-z0-9]{7}|[a-z0-9]{12})(?![a-z0-9-])/i);
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
  const stored = cleanShortCode(delivery.short_code);
  if (stored) return stored;
  const fromText = shortCodeFromText(delivery.generated_text_whatsapp) || shortCodeFromText(delivery.generated_text_instagram);
  if (fromText) return fromText;
  const displayPassword = deliveryPasswordForDisplay(delivery);
  return legacyShortCodeFrom(delivery.base_slug, displayPassword, delivery.client_name);
}

function deliveryMatchesShortCode(delivery, target, env) {
  const code = cleanShortCode(target);
  if (!code) return false;
  if (deliveryShortCode(delivery) === code) return true;
  const plainPassword = deliveryPasswordForDisplay(delivery);
  if (plainPassword && legacyShortCodeFrom(delivery.base_slug, plainPassword, delivery.client_name) === code) return true;
  const legacySeed = String(env.LEGACY_SHORT_SEED || '').trim();
  return !!legacySeed && seededShortCodeFrom(legacySeed, delivery.base_slug, plainPassword, delivery.client_name, delivery.id) === code;
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
  });

  const query = String(q || '').toLowerCase();
  return [...byId.values(), ...legacy.values()]
    .filter((client) => !query || [
      client.title,
      client.name,
      client.contact,
      client.normalized_name,
      client.invoice_count,
      client.delivery_count,
      client.subscription_count
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
  return {
    id: delivery.id,
    client_name: delivery.client_name || '',
    folder_name: delivery.folder_name || '',
    delivery_year: delivery.delivery_year || '',
    delivery_month: delivery.delivery_month || '',
    base_slug: delivery.base_slug || '',
    short_code: shortCode,
    delivery_url: shouldBlockFolderSlug(delivery) ? `/${shortCode}` : `/g/${delivery.base_slug}`,
    short_url: `/${shortCode}`
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
      --accent:#b88468;--accent2:#9a6f50;--accentSoft:rgba(184,132,104,.09);--disabled:#e5ded3;
      --green:#357f58;--danger:#bc3b42;--shadow:0 30px 90px rgba(30,30,28,.10);--shadow2:0 12px 34px rgba(30,30,28,.07);
      --glow1:rgba(255,255,255,.66);--glow2:rgba(212,205,188,.08);--grain:rgba(80,64,44,.028);
    }
    @media(prefers-color-scheme:dark){
      :root{
        color-scheme:dark;--bg:#11110F;--bg2:#11110F;--card:#171613;--solid:#1c1b17;--field:#141310;
        --ink:#f4eee5;--soft:#b8aea2;--muted:#8f8579;--line:#2b2823;--line2:#3a352e;
        --accent:#ca9876;--accent2:#ad7f5d;--accentSoft:rgba(202,152,118,.14);--disabled:#2f2b26;
        --green:#77d5a4;--danger:#ff737a;--shadow:0 30px 90px rgba(0,0,0,.36);--shadow2:0 14px 40px rgba(0,0,0,.24);
        --glow1:rgba(255,239,216,.045);--glow2:rgba(202,152,118,.06);--grain:rgba(255,245,230,.026);
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
    .item.active{border-color:var(--accent);box-shadow:0 0 0 4px rgba(184,132,104,.09)}
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

function privateAccessStyles() {
  return `
    body{
      --ease-out:cubic-bezier(.22,1,.36,1);
      --ease-spring:cubic-bezier(.16,1.1,.3,1);
      --dur-card:1100ms;
      --dur-item:760ms;
      --dur-switch:500ms;
      --gold:#d0bb99;
      --gold-2:#a79074;
      background:
        radial-gradient(1100px 620px at 18% 8%, var(--glow2), transparent 60%),
        radial-gradient(900px 560px at 82% 92%, rgba(212,205,188,.06), transparent 55%),
        var(--bg);
      background-attachment:fixed;
      padding:max(24px, env(safe-area-inset-top)) 18px max(24px, env(safe-area-inset-bottom));
      overflow-x:hidden;
    }
    @media(prefers-color-scheme:dark){
      body{
        background:
          radial-gradient(1100px 620px at 18% 8%, rgba(202,152,118,.09), transparent 60%),
          radial-gradient(900px 560px at 82% 92%, rgba(202,152,118,.05), transparent 55%),
          var(--bg);
      }
    }
    .aurora{
      position:fixed;inset:-10vmax;z-index:0;pointer-events:none;opacity:.55;
      background:
        radial-gradient(38vmax 28vmax at 28% 38%, rgba(212,205,188,.20), transparent 60%),
        radial-gradient(34vmax 26vmax at 72% 70%, rgba(200,192,175,.13), transparent 60%),
        radial-gradient(28vmax 20vmax at 50% 18%, rgba(247,244,237,.22), transparent 55%);
      filter:blur(60px) saturate(108%);
      animation:drift 28s ease-in-out infinite alternate;
      will-change:transform;
    }
    @media(prefers-color-scheme:dark){.aurora{opacity:.5;filter:blur(72px) saturate(115%)}}
    @keyframes drift{
      0%{transform:translate3d(-2%,-1%,0) scale(1)}
      50%{transform:translate3d(2%,1.5%,0) scale(1.04)}
      100%{transform:translate3d(-1%,2%,0) scale(1.02)}
    }
    .access-shell{position:relative;z-index:1;max-width:1160px;margin:0 auto;min-height:calc(100dvh - max(48px, calc(env(safe-area-inset-top) + env(safe-area-inset-bottom))))}
    .access-stage{position:relative;z-index:2;width:100%;display:grid;place-items:center;min-height:calc(100dvh - max(48px, calc(env(safe-area-inset-top) + env(safe-area-inset-bottom))))}
    .access-card{
      position:relative;width:min(100%,480px);margin:0;
      min-height:min(460px, calc(100dvh - 48px));
      padding:clamp(28px,5vw,44px);border-radius:28px;
      -webkit-backface-visibility:hidden;backface-visibility:hidden;
      background:
        linear-gradient(90deg, transparent 12%, var(--gold) 50%, transparent 88%) top/100% 1px no-repeat,
        linear-gradient(180deg, var(--card), var(--card));
      background:
        linear-gradient(90deg, transparent 12%, var(--gold) 50%, transparent 88%) top/100% 1px no-repeat,
        linear-gradient(180deg, color-mix(in srgb, var(--card) 96%, white 4%), var(--card));
      border:1px solid var(--line);
      box-shadow:
        0 1px 0 rgba(255,255,255,.60) inset,
        0 40px 90px -30px rgba(30,30,28,.22),
        0 18px 40px -20px rgba(30,30,28,.11);
      opacity:0;
      -webkit-transform:translateY(14px) translateZ(0);transform:translateY(14px) translateZ(0);
      display:flex;flex-direction:column;justify-content:flex-start;
      will-change:opacity;
      -webkit-transition:opacity var(--dur-card) var(--ease-out),-webkit-transform var(--dur-card) var(--ease-out);
      transition:opacity var(--dur-card) var(--ease-out),transform var(--dur-card) var(--ease-out);
    }
    .access-card.is-mounted{opacity:1;-webkit-transform:translateY(0) translateZ(0);transform:translateY(0) translateZ(0)}
    .access-card.is-leaving{opacity:0;-webkit-transform:translateY(-6px) translateZ(0);transform:translateY(-6px) translateZ(0);pointer-events:none;-webkit-transition-duration:var(--dur-switch);transition-duration:var(--dur-switch)}
    @media(prefers-color-scheme:dark){
      .access-card{
        background:
          linear-gradient(90deg, transparent 12%, var(--gold) 50%, transparent 88%) top/100% 1px no-repeat,
          linear-gradient(180deg, var(--card), var(--card));
        background:
          linear-gradient(90deg, transparent 12%, var(--gold) 50%, transparent 88%) top/100% 1px no-repeat,
          linear-gradient(180deg, color-mix(in srgb, var(--card) 94%, white 3%), var(--card));
        box-shadow:
          0 1px 0 rgba(255,239,216,.05) inset,
          0 40px 100px -30px rgba(0,0,0,.55),
          0 18px 48px -20px rgba(0,0,0,.36);
      }
    }
    .brand{display:flex;align-items:center;justify-content:center;margin-bottom:14px}
    .brand .logo-link{display:inline-flex}
    .brand .logo,.brand .ss-logo-hero{width:min(200px,52vw);height:auto;margin:0 auto 0;display:block}
    .eyebrow{
      display:flex;align-items:center;gap:10px;justify-content:center;
      font-size:11px;font-weight:800;letter-spacing:.24em;text-transform:uppercase;
      color:var(--soft);margin:0 0 11px;
    }
    .eyebrow .dot{width:5px;height:5px;border-radius:50%;background:var(--gold);box-shadow:0 0 0 3px rgba(212,205,188,.14)}
    .eyebrow .rule{flex:0 0 22px;height:1px;background:linear-gradient(90deg,transparent,var(--line2),transparent)}
    .mask-reveal{display:block;overflow:hidden}
    .mask-reveal > span{display:block;transform:translateY(110%);transition:transform var(--dur-item) var(--ease-spring)}
    .mask-reveal.is-visible > span{transform:translateY(0)}
    .reveal,[data-reveal]{
      opacity:0;
      -webkit-transform:translate3d(0,18px,0);transform:translate3d(0,18px,0);
      -webkit-transition:opacity 700ms cubic-bezier(.22,1,.36,1),-webkit-transform 700ms cubic-bezier(.22,1,.36,1);
      transition:opacity 700ms cubic-bezier(.22,1,.36,1),transform 700ms cubic-bezier(.22,1,.36,1);
      will-change:opacity;
    }
    .reveal.is-visible,[data-reveal].is-visible{opacity:1;-webkit-transform:translate3d(0,0,0);transform:translate3d(0,0,0)}
    .stagger-1{-webkit-transition-delay:90ms;transition-delay:90ms}.stagger-2{-webkit-transition-delay:180ms;transition-delay:180ms}.stagger-3{-webkit-transition-delay:270ms;transition-delay:270ms}.stagger-4{-webkit-transition-delay:360ms;transition-delay:360ms}.stagger-5{-webkit-transition-delay:450ms;transition-delay:450ms}.stagger-6{-webkit-transition-delay:540ms;transition-delay:540ms}
    .access-card h1{
      font-size:clamp(26px,4.6vw,36px);
      font-weight:900;line-height:1.04;letter-spacing:-.035em;
      text-align:center;margin:0 0 clamp(16px,3vw,20px);color:var(--ink);
    }
    .access-card .sub{max-width:340px;margin:0 auto 22px;text-align:center;font-size:14.5px;line-height:1.55;color:var(--soft)}
    .access-card .field{margin-top:0}
    .access-card label{font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;text-align:left}
    .access-card input{
      height:54px;border-radius:16px;padding:15px 56px 15px 18px;
      font-size:16px;font-weight:400;font-style:normal;text-decoration:none;text-transform:none;letter-spacing:0;
      background:var(--field);border:1px solid var(--line);
      transition:border-color .2s var(--ease-out),box-shadow .25s var(--ease-out),background .2s var(--ease-out);
    }
    .access-card input::placeholder{color:var(--muted);font-weight:400;font-style:normal;text-decoration:none;text-transform:none;letter-spacing:0}
    .access-card input:focus{
      border-color:var(--gold);
      box-shadow:0 0 0 4px rgba(212,205,188,.14),0 12px 30px -18px rgba(212,205,188,.24);
      background:var(--field);
      background:color-mix(in srgb, var(--field) 96%, var(--gold) 4%);
    }
    .access-card .eye-btn{right:18px;color:var(--muted);transition:color .2s var(--ease-out),transform .15s var(--ease-out)}
    .access-card .eye-btn:hover{color:var(--ink)}
    .access-card .eye-btn svg{width:20px;height:20px;stroke-width:2}
    .access-card .primary{
      position:relative;overflow:hidden;isolation:isolate;contain:paint;
      width:100%;margin-top:18px;min-height:56px;border-radius:16px;
      background:var(--ink);
      background:linear-gradient(180deg, var(--ink), color-mix(in srgb, var(--ink) 92%, black 8%));
      color:var(--card);
      box-shadow:
        0 1px 0 rgba(255,255,255,.12) inset,
        0 14px 30px -12px rgba(26,26,26,.45),
        0 4px 10px -4px rgba(26,26,26,.28);
      font-weight:800;letter-spacing:.01em;font-size:15.5px;gap:10px;
      transition:transform .25s var(--ease-out),box-shadow .25s var(--ease-out),opacity .25s var(--ease-out);
    }
    @media(prefers-color-scheme:dark){
      .access-card .primary{
        background:var(--ink);
        background:linear-gradient(180deg, var(--ink), color-mix(in srgb, var(--ink) 88%, black 12%));
        color:#171511;
        box-shadow:0 1px 0 rgba(255,255,255,.25) inset,0 14px 36px -12px rgba(0,0,0,.7);
      }
    }
    .access-card .primary:before{
      content:"";position:absolute;top:0;bottom:0;left:-58%;z-index:0;width:58%;pointer-events:none;
      background:linear-gradient(115deg,transparent 18%,rgba(255,255,255,.34) 50%,transparent 82%);
      -webkit-transform:translate3d(0,0,0);transform:translate3d(0,0,0);
    }
    @-webkit-keyframes gateButtonSheen{
      from{-webkit-transform:translate3d(0,0,0);transform:translate3d(0,0,0)}
      to{-webkit-transform:translate3d(274%,0,0);transform:translate3d(274%,0,0)}
    }
    @keyframes gateButtonSheen{
      from{-webkit-transform:translate3d(0,0,0);transform:translate3d(0,0,0)}
      to{-webkit-transform:translate3d(274%,0,0);transform:translate3d(274%,0,0)}
    }
    .access-card .primary.is-sheen:before{-webkit-animation:gateButtonSheen 4.2s var(--ease-out) both;animation:gateButtonSheen 4.2s var(--ease-out) both}
    .access-card .primary > *{position:relative;z-index:1}
    @media(hover:hover) and (pointer:fine){
      .access-card .primary:hover{transform:translateY(-2px);box-shadow:0 1px 0 rgba(255,255,255,.16) inset,0 22px 40px -14px rgba(26,26,26,.48),0 6px 14px -6px rgba(26,26,26,.32)}
    }
    .access-card .primary:active{transform:translateY(0) scale(.992)}
    .access-card .primary:disabled{opacity:.75;cursor:progress;transform:none}
    .access-card .primary .spin{width:18px;height:18px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;display:none;animation:spin .8s linear infinite}
    .access-card .primary.is-loading .spin{display:inline-block}
    .access-card .primary.is-loading .label{opacity:.75}
    @keyframes spin{to{transform:rotate(360deg)}}
    .access-card .status{margin-top:14px;min-height:18px;text-align:center;font-size:12.5px;font-weight:700;letter-spacing:.02em;color:var(--muted)}
    .access-card .status.ok{color:var(--green)}
    .access-card .status.err{color:var(--danger)}
    .compact-pill{
      display:inline-flex;align-items:center;gap:8px;
      padding:6px 12px;border-radius:999px;border:1px solid var(--line);
      background:var(--card);
      background:color-mix(in srgb, var(--card) 82%, transparent);
      color:var(--soft);font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;
    }
    .compact-pill:before{content:"";width:6px;height:6px;border-radius:50%;background:var(--gold);box-shadow:0 0 0 3px rgba(212,205,188,.12)}
    @media(max-width:560px){
      .access-card{border-radius:26px}
      .brand .logo,.brand .ss-logo-hero{width:min(180px,56vw)}
      .access-card h1{font-size:clamp(25px,7.2vw,32px)}
      .access-card .sub{font-size:14px;max-width:300px}
      .access-card input{height:52px;border-radius:14px}
      .access-card .primary{min-height:54px;border-radius:14px;font-size:15px}
      .aurora{opacity:.35;filter:blur(80px)}
    }
    @media(max-width:560px),(pointer:coarse){
      body{--dur-card:720ms;--dur-item:460ms;--dur-switch:360ms}
      .access-card{-webkit-transition-duration:var(--dur-card);transition-duration:var(--dur-card)}
      .reveal,[data-reveal],.mask-reveal > span{-webkit-transition-duration:var(--dur-item);transition-duration:var(--dur-item)}
    }
    @media(max-width:380px){
      .access-card{padding:26px 22px}
      .brand .logo,.brand .ss-logo-hero{width:min(170px,58vw)}
    }
    @media(prefers-reduced-motion:reduce){
      html:not(.ss-force-motion) *{-webkit-animation:none!important;animation:none!important;-webkit-transition:none!important;transition:none!important;scroll-behavior:auto!important}
      .aurora{display:none}
      html:not(.ss-force-motion) .access-card{opacity:1!important;-webkit-filter:none!important;filter:none!important;-webkit-transform:none!important;transform:none!important}
      html:not(.ss-force-motion) .mask-reveal > span{-webkit-transform:none!important;transform:none!important}
      html:not(.ss-force-motion) .reveal,html:not(.ss-force-motion) [data-reveal]{opacity:1!important;-webkit-transform:none!important;transform:none!important;-webkit-transition:opacity 200ms ease!important;transition:opacity 200ms ease!important;will-change:auto!important}
    }
  `;
}

// Shared <link>/<script> tags that load the external animation and gate engines.
// Used by /admin, /db and /g/<slug> so the intro animation stays consistent on iOS Safari and Brave.
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

function deliveryPageHtml(slug, delivery = null) {
  const safeSlug = escapeHtml(slug);
  const displayTitle = delivery ? `${escapeHtml(delivery.title || '')} ${escapeHtml(delivery.client_name || '')}`.trim() : 'your session';
  const greeting = delivery && displayTitle ? `Hello, ${displayTitle}` : 'Hello';
  return `<!DOCTYPE html>
<html lang="en" class="ss-force-motion">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="theme-color" content="#F6F6F3" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#11110F" media="(prefers-color-scheme: dark)" />
  <title>StarShots · Private Delivery</title>
  <style>${shellStyles()}
    /* ---- Page tokens ---- */
    body{
      --ease-out:cubic-bezier(.22,1,.36,1);
      --ease-spring:cubic-bezier(.16,1.1,.3,1);
      --dur-card:1100ms;
      --dur-item:760ms;
      --dur-switch:500ms;
      --gold:#d0bb99;
      --gold-2:#a79074;
      background:
        radial-gradient(1100px 620px at 18% 8%, var(--glow2), transparent 60%),
        radial-gradient(900px 560px at 82% 92%, rgba(212,205,188,.06), transparent 55%),
        var(--bg);
      background-attachment:fixed;
      overflow-x:hidden;
    }
    @media(prefers-color-scheme:dark){
      body{
        background:
          radial-gradient(1100px 620px at 18% 8%, rgba(202,152,118,.09), transparent 60%),
          radial-gradient(900px 560px at 82% 92%, rgba(202,152,118,.05), transparent 55%),
          var(--bg);
      }
    }

    /* ---- Ambient aurora behind the card ---- */
    .aurora{
      position:fixed;inset:-10vmax;z-index:0;pointer-events:none;opacity:.55;
      background:
        radial-gradient(38vmax 28vmax at 28% 38%, rgba(212,205,188,.20), transparent 60%),
        radial-gradient(34vmax 26vmax at 72% 70%, rgba(200,192,175,.13), transparent 60%),
        radial-gradient(28vmax 20vmax at 50% 18%, rgba(247,244,237,.22), transparent 55%);
      filter:blur(60px) saturate(108%);
      animation:drift 28s ease-in-out infinite alternate;
      will-change:transform;
    }
    @media(prefers-color-scheme:dark){ .aurora{opacity:.5;filter:blur(72px) saturate(115%)} }
    @keyframes drift{
      0%  { transform:translate3d(-2%,-1%,0)  scale(1);    }
      50% { transform:translate3d(2%,1.5%,0)  scale(1.04); }
      100%{ transform:translate3d(-1%,2%,0)   scale(1.02); }
    }

    /* ---- Page layout ---- */
    body{padding:max(24px, env(safe-area-inset-top)) 18px max(24px, env(safe-area-inset-bottom))}
    .wrap.center{min-height:calc(100dvh - max(48px, calc(env(safe-area-inset-top) + env(safe-area-inset-bottom))));align-items:center}
    .stage{position:relative;z-index:2;width:100%;display:grid;place-items:center}

    /* ---- Delivery card ---- */
    .delivery-card{
      position:relative;
      width:min(100%, 480px);
      min-height:min(460px, calc(100dvh - 48px));
      margin:0;padding:clamp(28px, 5vw, 44px);
      border-radius:28px;
      -webkit-backface-visibility:hidden;backface-visibility:hidden;
      background:
        linear-gradient(90deg, transparent 12%, var(--gold) 50%, transparent 88%) top/100% 1px no-repeat,
        linear-gradient(180deg, var(--card), var(--card));
      background:
        linear-gradient(90deg, transparent 12%, var(--gold) 50%, transparent 88%) top/100% 1px no-repeat,
        linear-gradient(180deg, color-mix(in srgb, var(--card) 96%, white 4%), var(--card));
      border:1px solid var(--line);
      box-shadow:
        0 1px 0 rgba(255,255,255,.60) inset,
        0 40px 90px -30px rgba(30,30,28,.22),
        0 18px 40px -20px rgba(30,30,28,.11);
      opacity:0;
      -webkit-transform:translateY(14px) translateZ(0);transform:translateY(14px) translateZ(0);
      display:flex;flex-direction:column;justify-content:flex-start;
      will-change:opacity;
      -webkit-transition:opacity var(--dur-card) var(--ease-out),-webkit-transform var(--dur-card) var(--ease-out);
      transition:opacity var(--dur-card) var(--ease-out),transform var(--dur-card) var(--ease-out);
    }
    .delivery-card.is-mounted{opacity:1;-webkit-transform:translateY(0) translateZ(0);transform:translateY(0) translateZ(0)}
    @media(prefers-color-scheme:dark){
      .delivery-card{
        background:
          linear-gradient(90deg, transparent 12%, var(--gold) 50%, transparent 88%) top/100% 1px no-repeat,
          linear-gradient(180deg, var(--card), var(--card));
        background:
          linear-gradient(90deg, transparent 12%, var(--gold) 50%, transparent 88%) top/100% 1px no-repeat,
          linear-gradient(180deg, color-mix(in srgb, var(--card) 94%, white 3%), var(--card));
        box-shadow:
          0 1px 0 rgba(255,239,216,.05) inset,
          0 40px 100px -30px rgba(0,0,0,.55),
          0 18px 48px -20px rgba(0,0,0,.36);
      }
    }

    /* ---- Brand ---- */
    .brand{display:flex;align-items:center;justify-content:center;margin-bottom:14px}
    .brand .logo-link{display:inline-flex}
    .brand .logo,.brand .ss-logo-hero{width:min(200px,52vw);height:auto;margin:0 auto 0;display:block}

    /* ---- Eyebrow ---- */
    .eyebrow{
      display:flex;align-items:center;gap:10px;justify-content:center;
      font-size:11px;font-weight:800;letter-spacing:.24em;text-transform:uppercase;
      color:var(--soft);margin:0 0 11px;
    }
    .eyebrow .dot{width:5px;height:5px;border-radius:50%;background:var(--gold);box-shadow:0 0 0 3px rgba(212,205,188,.14)}
    .eyebrow .rule{flex:0 0 22px;height:1px;background:linear-gradient(90deg,transparent,var(--line2),transparent)}

    /* ---- Heading ---- */
    .delivery-card h1{
      font-size:clamp(26px, 4.6vw, 36px);
      font-weight:900;line-height:1.04;letter-spacing:-.035em;
      text-align:center;margin:0 0 clamp(16px,3vw,20px);color:var(--ink);
    }
    .delivery-card .sub{
      max-width:340px;margin:0 auto 22px;text-align:center;
      font-size:14.5px;line-height:1.55;color:var(--soft);
    }
    #opened h1{font-size:clamp(24px, 4vw, 32px);letter-spacing:-.03em;margin-bottom:10px}

    /* ---- Field ---- */
    .delivery-card .field{margin-top:0}
    .delivery-card label{font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;text-align:left}
    .delivery-card input{
      height:54px;border-radius:16px;padding:15px 56px 15px 18px;
      font-size:16px;font-weight:400;font-style:normal;text-decoration:none;text-transform:none;letter-spacing:0;
      background:var(--field);border:1px solid var(--line);
      transition:border-color .2s var(--ease-out), box-shadow .25s var(--ease-out), background .2s var(--ease-out);
    }
    .delivery-card input::placeholder{color:var(--muted);font-weight:400;font-style:normal;text-decoration:none;text-transform:none;letter-spacing:0}
    .delivery-card input:focus{
      border-color:var(--gold);
      box-shadow:0 0 0 4px rgba(212,205,188,.14), 0 12px 30px -18px rgba(212,205,188,.24);
      background:var(--field);
      background:color-mix(in srgb, var(--field) 96%, var(--gold) 4%);
    }
    .delivery-card .eye-btn{right:18px;color:var(--muted);transition:color .2s var(--ease-out), transform .15s var(--ease-out)}
    .delivery-card .eye-btn:hover{color:var(--ink)}
    .delivery-card .eye-btn svg{width:20px;height:20px;stroke-width:2}

    /* ---- Primary CTA ---- */
    .delivery-card #unlockBtn{
      position:relative;overflow:hidden;isolation:isolate;contain:paint;
      width:100%;margin-top:18px;min-height:56px;border-radius:16px;
      background:var(--ink);
      background:linear-gradient(180deg, var(--ink), color-mix(in srgb, var(--ink) 92%, black 8%));
      color:var(--card);
      box-shadow:
        0 1px 0 rgba(255,255,255,.12) inset,
        0 14px 30px -12px rgba(26,26,26,.45),
        0 4px 10px -4px rgba(26,26,26,.28);
      font-weight:800;letter-spacing:.01em;font-size:15.5px;gap:10px;
      transition:transform .25s var(--ease-out), box-shadow .25s var(--ease-out), opacity .25s var(--ease-out);
    }
    @media(prefers-color-scheme:dark){
      .delivery-card #unlockBtn{
        background:var(--ink);
        background:linear-gradient(180deg, var(--ink), color-mix(in srgb, var(--ink) 88%, black 12%));
        color:#171511;
        box-shadow:
          0 1px 0 rgba(255,255,255,.25) inset,
          0 14px 36px -12px rgba(0,0,0,.7);
      }
    }
    .delivery-card #unlockBtn:before{
      content:"";position:absolute;top:0;bottom:0;left:-58%;z-index:0;width:58%;pointer-events:none;
      background:linear-gradient(115deg, transparent 18%, rgba(255,255,255,.34) 50%, transparent 82%);
      -webkit-transform:translate3d(0,0,0);transform:translate3d(0,0,0);
    }
    @-webkit-keyframes gateButtonSheen{
      from{-webkit-transform:translate3d(0,0,0);transform:translate3d(0,0,0)}
      to{-webkit-transform:translate3d(274%,0,0);transform:translate3d(274%,0,0)}
    }
    @keyframes gateButtonSheen{
      from{-webkit-transform:translate3d(0,0,0);transform:translate3d(0,0,0)}
      to{-webkit-transform:translate3d(274%,0,0);transform:translate3d(274%,0,0)}
    }
    .delivery-card #unlockBtn.is-sheen:before{-webkit-animation:gateButtonSheen 4.2s var(--ease-out) both;animation:gateButtonSheen 4.2s var(--ease-out) both}
    .delivery-card #unlockBtn > *{position:relative;z-index:1}
    @media(hover:hover) and (pointer:fine){
      .delivery-card #unlockBtn:hover{transform:translateY(-2px);box-shadow:0 1px 0 rgba(255,255,255,.16) inset, 0 22px 40px -14px rgba(26,26,26,.48), 0 6px 14px -6px rgba(26,26,26,.32)}
    }
    .delivery-card #unlockBtn:active{transform:translateY(0) scale(.992)}
    .delivery-card #unlockBtn:disabled{opacity:.75;cursor:progress;transform:none}
    .delivery-card #unlockBtn .spin{width:18px;height:18px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;display:none;animation:spin .8s linear infinite}
    .delivery-card #unlockBtn.is-loading .spin{display:inline-block}
    .delivery-card #unlockBtn.is-loading .label{opacity:.75}
    @keyframes spin{to{transform:rotate(360deg)}}

    /* ---- Status ---- */
    .delivery-card #status{
      text-align:center;margin-top:14px;min-height:18px;
      font-size:12.5px;font-weight:700;letter-spacing:.02em;color:var(--muted);
      transition:color .2s var(--ease-out), opacity .2s var(--ease-out);
    }
    .delivery-card #status.ok{color:var(--green)}
    .delivery-card #status.err{color:var(--danger)}
    .delivery-card .tiny{margin-top:24px;color:var(--muted);font-weight:700;font-size:12px;letter-spacing:.04em;text-align:center}

    /* ---- Gate / Opened transitions ---- */
    #gate, #opened{
      -webkit-transition:opacity var(--dur-switch) var(--ease-out),-webkit-transform var(--dur-switch) var(--ease-out);
      transition:opacity var(--dur-switch) var(--ease-out),transform var(--dur-switch) var(--ease-out);
    }
    #gate.is-leaving{opacity:0;-webkit-transform:translateY(-6px);transform:translateY(-6px);pointer-events:none}
    #opened{opacity:0;-webkit-transform:translateY(10px);transform:translateY(10px)}
    #opened.is-visible{opacity:1;-webkit-transform:translateY(0);transform:translateY(0)}

    /* ---- Reveal primitive ---- */
    .reveal,[data-reveal]{
      opacity:0;
      -webkit-transform:translate3d(0,18px,0);transform:translate3d(0,18px,0);
      -webkit-transition:opacity 700ms cubic-bezier(.22,1,.36,1),-webkit-transform 700ms cubic-bezier(.22,1,.36,1);
      transition:opacity 700ms cubic-bezier(.22,1,.36,1),transform 700ms cubic-bezier(.22,1,.36,1);
      will-change:opacity;
    }
    .reveal.is-visible,[data-reveal].is-visible{opacity:1;-webkit-transform:translate3d(0,0,0);transform:translate3d(0,0,0)}

    /* Clip-path mask reveal for the headline */
    .mask-reveal{display:block;overflow:hidden}
    .mask-reveal > span{
      display:block;transform:translateY(110%);
      transition:transform var(--dur-item) var(--ease-spring);
    }
    .mask-reveal.is-visible > span{transform:translateY(0)}

    /* ---- Service buttons ---- */
    .links{display:flex;flex-direction:column;gap:10px;margin-top:6px}
    .service-btn{
      position:relative;
      display:flex;align-items:center;gap:14px;
      width:100%;min-height:58px;padding:12px 18px;
      border-radius:16px;border:1px solid var(--line);
      background:var(--solid);color:var(--ink);
      font-weight:750;font-size:15px;letter-spacing:.005em;
      text-decoration:none;cursor:pointer;overflow:hidden;
      opacity:0;-webkit-transform:translateY(14px);transform:translateY(14px);
      -webkit-transition:opacity 640ms var(--ease-spring) var(--svc-delay, 0ms),-webkit-transform 640ms var(--ease-spring) var(--svc-delay, 0ms),border-color .25s var(--ease-out),box-shadow .3s var(--ease-out),background .3s var(--ease-out),color .25s var(--ease-out);
      transition:opacity 640ms var(--ease-spring) var(--svc-delay, 0ms),transform 640ms var(--ease-spring) var(--svc-delay, 0ms),border-color .25s var(--ease-out),box-shadow .3s var(--ease-out),background .3s var(--ease-out),color .25s var(--ease-out);
    }
    .service-btn.is-in{opacity:1;-webkit-transform:translateY(0);transform:translateY(0)}
    .service-btn .svc-icon{
      width:34px;height:34px;border-radius:10px;display:grid;place-items:center;
      background:rgba(31,26,23,.06);
      background:color-mix(in srgb, var(--ink) 6%, transparent);
      color:var(--ink);flex:0 0 auto;
      transition:background .3s var(--ease-out), color .3s var(--ease-out);
    }
    @media(prefers-color-scheme:dark){.service-btn .svc-icon{background:rgba(244,238,229,.10);background:color-mix(in srgb, var(--ink) 10%, transparent)}}
    .service-btn .svc-icon svg{width:18px;height:18px;fill:currentColor}
    .service-btn .svc-label{flex:1 1 auto;text-align:left}
    .service-btn .svc-chev{width:16px;height:16px;color:var(--muted);transition:transform .25s var(--ease-out), color .25s var(--ease-out);flex:0 0 auto}
    .service-btn:before{
      content:"";position:absolute;left:0;top:0;bottom:0;width:3px;
      background:linear-gradient(180deg, var(--gold), var(--gold-2));
      transform:scaleY(0);transform-origin:center;
      transition:transform .3s var(--ease-spring);
    }
    @media(hover:hover) and (pointer:fine){
      .service-btn.active:hover{
        transform:translateY(-2px);
        border-color:color-mix(in srgb, var(--gold) 55%, var(--line));
        box-shadow:0 20px 40px -22px rgba(200,192,175,.24), 0 6px 14px -8px rgba(200,192,175,.14);
        background:color-mix(in srgb, var(--solid) 94%, var(--gold) 6%);
      }
      .service-btn.active:hover:before{transform:scaleY(1)}
      .service-btn.active:hover .svc-chev{transform:translateX(3px);color:var(--ink)}
      .service-btn.active:hover .svc-icon{background:var(--gold);color:#fff}
    }
    .service-btn.active:active{transform:translateY(0) scale(.992)}
    .service-btn.disabled{
      cursor:not-allowed;opacity:.78;
      background:transparent;border-color:var(--line);color:var(--muted);
    }
    .service-btn.disabled .svc-icon{background:transparent;color:var(--muted);border:1px dashed var(--line2)}
    .service-btn.disabled .svc-tag{margin-left:auto;font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}

    /* ---- Success pill ---- */
    .success-wrap{display:flex;justify-content:center;margin:0 0 14px}
    .success-pill{
      display:inline-flex;align-items:center;gap:8px;
      padding:6px 12px;border-radius:999px;
      background:rgba(53,127,88,.14);
      background:color-mix(in srgb, var(--green) 14%, transparent);
      color:var(--green);font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;
      border:1px solid rgba(53,127,88,.35);
      border:1px solid color-mix(in srgb, var(--green) 35%, transparent);
    }
    .success-pill .pulse{
      width:6px;height:6px;border-radius:50%;background:var(--green);
      box-shadow:0 0 0 0 rgba(53,127,88,.60);
      box-shadow:0 0 0 0 color-mix(in srgb, var(--green) 60%, transparent);
      -webkit-animation:pulse 2s var(--ease-out) infinite;animation:pulse 2s var(--ease-out) infinite;
    }
    @keyframes pulse{
      0%  {box-shadow:0 0 0 0 rgba(53,127,88,.55);box-shadow:0 0 0 0 color-mix(in srgb, var(--green) 55%, transparent)}
      70% {box-shadow:0 0 0 10px rgba(0,0,0,0)}
      100%{box-shadow:0 0 0 0 rgba(0,0,0,0)}
    }

    /* ---- Responsive tweaks ---- */
    @media(max-width:560px){
      .delivery-card{border-radius:26px}
      .brand .logo,.brand .ss-logo-hero{width:min(180px,56vw)}
      .delivery-card h1{font-size:clamp(25px, 7.2vw, 32px)}
      #opened h1{font-size:clamp(23px, 6.6vw, 29px)}
      .delivery-card .sub{font-size:14px;max-width:300px}
      .delivery-card input{height:52px;border-radius:14px}
      .delivery-card #unlockBtn{min-height:54px;border-radius:14px;font-size:15px}
      .service-btn{min-height:56px;border-radius:14px;padding:10px 14px}
      .service-btn .svc-icon{width:32px;height:32px;border-radius:9px}
      .aurora{opacity:.35;filter:blur(80px)}
    }
    @media(max-width:560px),(pointer:coarse){
      body{--dur-card:720ms;--dur-item:460ms;--dur-switch:360ms}
      .delivery-card{-webkit-transition-duration:var(--dur-card);transition-duration:var(--dur-card)}
      .reveal,[data-reveal]{-webkit-transition-duration:var(--dur-item);transition-duration:var(--dur-item)}
      .mask-reveal > span{-webkit-transition-duration:var(--dur-item);transition-duration:var(--dur-item)}
      #gate,#opened{-webkit-transition-duration:var(--dur-switch);transition-duration:var(--dur-switch)}
      .service-btn{-webkit-transition-duration:640ms;transition-duration:640ms}
    }
    @media(max-width:380px){
      .delivery-card{padding:26px 22px}
      .brand .logo,.brand .ss-logo-hero{width:min(170px,58vw)}
    }

    /* ---- Reduced motion ---- */
    @media(prefers-reduced-motion:reduce){
      html:not(.ss-force-motion) *{-webkit-animation:none!important;animation:none!important;-webkit-transition:none!important;transition:none!important}
      html:not(.ss-force-motion) .delivery-card{opacity:1!important;-webkit-filter:none!important;filter:none!important;-webkit-transform:none!important;transform:none!important}
      html:not(.ss-force-motion) .mask-reveal > span{-webkit-transform:none!important;transform:none!important}
      html:not(.ss-force-motion) .reveal,html:not(.ss-force-motion) [data-reveal]{opacity:1!important;-webkit-transform:none!important;transform:none!important;-webkit-transition:opacity 200ms ease!important;transition:opacity 200ms ease!important;will-change:auto!important}
      html:not(.ss-force-motion) .service-btn{opacity:1!important;-webkit-transform:none!important;transform:none!important}
      html:not(.ss-force-motion) #opened{opacity:1!important;-webkit-transform:none!important;transform:none!important;-webkit-filter:none!important;filter:none!important}
      .aurora{display:none}
    }
  </style>
  ${animateAssets()}
</head>
<body>
  <div class="aurora" aria-hidden="true"></div>
  <div class="wrap center">
    <div class="stage">
      <main class="card delivery-card ss-gate-card" data-ss-gate-card role="main">
        <div class="brand ss-gate-brand reveal" data-reveal>
          <a class="logo-link" href="/" aria-label="Back to StarShots homepage">
            <img class="logo ss-gate-logo ss-logo-hero" src="${LOGO_PATH}" alt="StarShots" />
          </a>
        </div>

        <section id="gate" aria-labelledby="gate-title">
          <p class="eyebrow ss-gate-eyebrow reveal" data-reveal><span class="rule"></span><span class="dot" aria-hidden="true"></span>Private Workspace<span class="rule"></span></p>
          <h1 id="gate-title" class="mask-reveal ss-gate-title reveal" data-reveal><span>${greeting}</span></h1>
          <div class="field ss-gate-field reveal" data-reveal>
            <label class="ss-gate-label" for="password">Access key</label>
            <div class="password-wrap">
              <input id="password" type="password" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="status" data-ss-gate-input />
              <button id="togglePass" class="eye-btn" type="button" aria-label="Show access key">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.75 12S5.5 5.5 12 5.5 22.25 12 22.25 12 18.5 18.5 12 18.5 1.75 12 1.75 12Z"/><circle cx="12" cy="12" r="3.25"/></svg>
              </button>
            </div>
          </div>
          <button id="unlockBtn" type="button" class="ss-gate-button reveal" data-ss-gate-button data-reveal>
            <span class="spin" aria-hidden="true"></span>
            <span class="label">Sign In</span>
          </button>
          <div id="status" class="ss-gate-status reveal" data-reveal role="status" aria-live="polite"></div>
        </section>

        <section id="opened" class="hidden" aria-labelledby="opened-title">
          <h1 id="opened-title" class="mask-reveal reveal" data-reveal><span>Your files are ready</span></h1>
          <p class="sub reveal" data-reveal>Choose your preferred delivery option below</p>
          <div class="links" id="links"></div>
          <p class="tiny reveal" data-reveal>With love, StarShots</p>
        </section>
      </main>
    </div>
  </div>

  <script>
    ${mobileSafeRevealScript()}
    const slug = ${JSON.stringify(slug)};
    const card = document.querySelector('.delivery-card');
    const brandBlock = document.querySelector('.brand');
    const gate = document.getElementById('gate');
    const opened = document.getElementById('opened');
    const passwordInput = document.getElementById('password');
    const unlockBtn = document.getElementById('unlockBtn');
    const togglePass = document.getElementById('togglePass');
    const statusEl = document.getElementById('status');
    const linksEl = document.getElementById('links');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches && !document.documentElement.classList.contains('ss-force-motion');
    const labels = { gd:'Google Drive', db:'Dropbox', wt:'WeTransfer', tn:'TransferNow' };
    const icons = {
      gd:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 3h7l5.5 9.5-3.5 6h-11L3 12.5 8.5 3Zm1.2 2-4.2 7.3h4.2L13.9 5H9.7Zm8.6 8.3-2.8 4.7H9.8l2.8-4.7h5.7Zm-11.6 0h4.1L7.9 18 5 13.3h2.7Z"/></svg>',
      db:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3 12 6.3 6.5 9.6 1 6.3 6.5 3Zm11 0L23 6.3 17.5 9.6 12 6.3 17.5 3Zm-11 7.6L12 13.9l-5.5 3.3L1 13.9l5.5-3.3Zm11 0L23 13.9l-5.5 3.3L12 13.9l5.5-3.3ZM6.8 18.3 12 15l5.2 3.3L12 21.6l-5.2-3.3Z"/></svg>',
      wt:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5.75.75 0 0 0-1.5 0 7 7 0 1 1-7-7 .75.75 0 0 0 0-1.5Zm.75 2.75v8.19l2.72-2.72a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06l2.72 2.72V6.25a.75.75 0 0 1 1.5 0Z"/></svg>',
      tn:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.53 14.47a.75.75 0 0 1 0-1.06l1.72-1.72H9.75a.75.75 0 0 1 0-1.5h4.5l-1.72-1.72a.75.75 0 1 1 1.06-1.06l3 3a.75.75 0 0 1 0 1.06l-3 3a.75.75 0 0 1-1.06 0ZM6.5 18A4.5 4.5 0 0 1 6 9.03 6 6 0 0 1 18 10a4 4 0 0 1 0 8h-1.5a.75.75 0 0 1 0-1.5H18a2.5 2.5 0 0 0 0-5h-.75V10a4.5 4.5 0 0 0-9-.1.75.75 0 0 1-.72.65A3 3 0 0 0 6.5 16.5H10a.75.75 0 0 1 0 1.5H6.5Z"/></svg>'
    };
    const chevSvg = '<svg class="svc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
    const eyeSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.75 12S5.5 5.5 12 5.5 22.25 12 22.25 12 18.5 18.5 12 18.5 1.75 12 1.75 12Z"/><circle cx="12" cy="12" r="3.25"/></svg>';
    const eyeOffSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 2.5 21.5 21.5"/><path d="M9.9 5.9A13.2 13.2 0 0 1 12 5.5c6.5 0 10.25 6.5 10.25 6.5a18 18 0 0 1-3.45 4.38"/><path d="M6.03 8.03C3.56 9.96 1.75 12 1.75 12S5.5 18.5 12 18.5c1.87 0 3.53-.38 4.98-1.04"/><path d="M10.59 10.59A3.25 3.25 0 0 0 15.18 15.18"/></svg>';

    function setPassVisibility(){
      const show = passwordInput.type === 'password';
      passwordInput.type = show ? 'text' : 'password';
      togglePass.innerHTML = show ? eyeOffSvg : eyeSvg;
      togglePass.setAttribute('aria-label', show ? 'Hide access key' : 'Show access key');
      focusPassword(true);
    }

    function isTouchViewport(){
      return window.matchMedia('(max-width: 640px), (pointer: coarse)').matches;
    }

    function focusPassword(allowTouch = false){
      if(!allowTouch && isTouchViewport()) return;
      try{ passwordInput.focus({preventScroll:true}); }catch(e){}
    }

    function revealIn(el, delay){
      if(!el) return;
      setTimeout(() => el.classList.add('is-visible'), delay);
    }

    function stageIntro(){
      const isMobile = window.matchMedia('(max-width: 640px), (pointer: coarse)').matches;
      const gateReveals = Array.from(gate.querySelectorAll('.reveal'));
      const introReveals = [brandBlock].concat(gateReveals).filter(Boolean);
      if(window.StarShotsGate && window.StarShotsGate.intro){
        const handled = window.StarShotsGate.intro(card, {root:card,reveals:introReveals,button:unlockBtn,input:passwordInput});
        if(handled || card.dataset.ssGateIntro === 'running' || card.dataset.introState === 'running' || card.classList.contains('is-mounted') || card.classList.contains('is-visible')) return;
      }
      if(card.classList.contains('is-mounted') || card.dataset.introState === 'running') return;
      card.dataset.introState = 'running';
      card.classList.remove('is-mounted', 'is-leaving');
      introReveals.forEach(el => el.classList.remove('is-visible'));
      if(reduceMotion){
        card.classList.add('is-mounted');
        introReveals.forEach(el => el.classList.add('is-visible'));
        card.dataset.introState = 'done';
        focusPassword();
        return;
      }
      requestAnimationFrame(() => {
        void card.offsetWidth;
        requestAnimationFrame(() => {
          card.classList.add('is-mounted');
          if(window.StarShotsReveal && window.StarShotsReveal.bounceLogos) window.StarShotsReveal.bounceLogos(card);
          const stagger = isMobile ? 75 : 90;
          const startAt = isMobile ? 180 : 320;
          introReveals.forEach((el, i) => revealIn(el, startAt + i * stagger));
          const doneAt = startAt + introReveals.length * stagger + 300;
          setTimeout(() => {
            card.dataset.introState = 'done';
            unlockBtn.classList.add('is-sheen');
            setTimeout(() => unlockBtn.classList.remove('is-sheen'), 3600);
          }, doneAt);
          setTimeout(() => {
            focusPassword();
          }, isMobile ? 900 : 720);
        });
      });
    }

    function renderLinks(linkData){
      linksEl.innerHTML = '';
      const isMobile = window.matchMedia('(max-width: 640px), (pointer: coarse)').matches;
      ['gd','db','wt','tn'].forEach((service, index) => {
        const item = (linkData || []).find(x => x.service === service);
        const isActive = !!(item && item.url);
        const el = document.createElement(isActive ? 'a' : 'button');
        el.className = 'service-btn ' + (isActive ? 'active' : 'disabled');
        el.style.setProperty('--svc-delay', (index * (isMobile ? 120 : 85)) + 'ms');
        el.innerHTML =
          '<span class="svc-icon" aria-hidden="true">' + (icons[service] || '') + '</span>' +
          '<span class="svc-label">' + labels[service] + '</span>' +
          (isActive ? chevSvg : '<span class="svc-tag">Unavailable</span>');
        if(isActive){
          el.href = item.url;
          el.target = '_blank';
          el.rel = 'noopener noreferrer';
          el.addEventListener('click', () => {
            try{
              fetch('/api/click', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ deliveryId: (window.__delivery_id__ || null), service })
              }).catch(() => {});
            }catch(e){}
          });
        } else {
          el.type = 'button';
          el.disabled = true;
        }
        linksEl.appendChild(el);
      });
    }

    function showOpened(){
      const isMobile = window.matchMedia('(max-width: 640px), (pointer: coarse)').matches;
      const switchDelay = isMobile ? 540 : 420;
      const revealStagger = isMobile ? 110 : 85;
      if(reduceMotion){
        gate.classList.add('hidden');
        opened.classList.remove('hidden');
        opened.classList.add('is-visible');
        opened.querySelectorAll('.reveal').forEach(el => el.classList.add('is-visible'));
        linksEl.querySelectorAll('.service-btn').forEach(el => el.classList.add('is-in'));
        return;
      }
      if(window.StarShotsReveal) window.StarShotsReveal.reset(opened);
      gate.classList.add('is-leaving');
      setTimeout(() => {
        gate.classList.add('hidden');
        opened.classList.remove('hidden');
        void opened.offsetWidth;
        opened.classList.add('is-visible');
        if(window.StarShotsReveal) window.StarShotsReveal.start(opened);
        const reveals = opened.querySelectorAll('.reveal');
        reveals.forEach((el, i) => revealIn(el, 140 + i * revealStagger));
        requestAnimationFrame(() => {
          linksEl.querySelectorAll('.service-btn').forEach(el => el.classList.add('is-in'));
        });
      }, switchDelay);
    }

    function shakeCard(){
      if(reduceMotion || !card.animate) return;
      card.animate(
        [
          {transform:'translateX(0)'},
          {transform:'translateX(-6px)'},
          {transform:'translateX(6px)'},
          {transform:'translateX(-4px)'},
          {transform:'translateX(0)'}
        ],
        { duration: 360, easing: 'cubic-bezier(.36,.07,.19,.97)' }
      );
    }

    async function unlock(){
      if(unlockBtn.classList.contains('is-loading')) return;
      const value = passwordInput.value.trim();
      if(!value){
        statusEl.textContent = 'Please enter your access key.';
        statusEl.className = 'err';
        focusPassword(true);
        return;
      }
      unlockBtn.classList.add('is-loading');
      unlockBtn.disabled = true;
      statusEl.className = '';
      statusEl.textContent = 'Opening your delivery…';
      try{
        const res = await fetch('/api/unlock', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ slug, password: value })
        });
        const data = await res.json();
        if(!res.ok || !data.ok) throw new Error(data.error || 'Wrong access key.');
        window.__delivery_id__ = data.delivery && data.delivery.id;
        renderLinks(data.links);
        statusEl.textContent = '';
        showOpened();
      }catch(e){
        statusEl.textContent = e.message || 'Unable to open.';
        statusEl.className = 'err';
        shakeCard();
      }finally{
        unlockBtn.classList.remove('is-loading');
        unlockBtn.disabled = false;
      }
    }

    unlockBtn.addEventListener('click', unlock);
    togglePass.addEventListener('click', setPassVisibility);
    passwordInput.addEventListener('keydown', e => { if(e.key === 'Enter') unlock(); });
    passwordInput.addEventListener('input', () => {
      if(statusEl.className === 'err'){
        statusEl.textContent = '';
        statusEl.className = '';
      }
    });

    if(document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', stageIntro, { once:true });
    } else {
      stageIntro();
    }
    // Safety net: if anything stalls, ensure the card is visible.
    setTimeout(() => {
      if(!card.classList.contains('is-mounted')){
        card.classList.add('is-mounted');
        document.querySelectorAll('.delivery-card .reveal').forEach(el => el.classList.add('is-visible'));
      }
    }, 2500);
  </script>
</body>
</html>`;
}

async function handleAdminCheck(request, env) {
  const limited = enforceRateLimit(request, 'admin-check', { limit: 8, windowMs: 60 * 1000, blockMs: 15 * 60 * 1000 });
  if (limited) return limited;
  const body = await request.json().catch(() => ({}));
  const password = String(body.password || '').trim();
  if (!password && await verifyAdminSessionCookie(request, env)) return json({ ok: true }, 200, { 'Set-Cookie': await createAdminSessionCookie(env) });
  if (!(await verifyAdminPassword(env, password))) return json({ error: 'Unauthorized.' }, 401);
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
    generated_text_instagram: generatedText
  };
  const linkedRecord = clientId ? { ...baseRecord, client_id: clientId } : baseRecord;
  const recordVariants = [
    { ...linkedRecord, password: '', ...passwordSecurity, short_code: shortCode },
    { ...baseRecord, password: '', ...passwordSecurity, short_code: shortCode },
    { ...linkedRecord, password: '', ...passwordSecurity },
    { ...baseRecord, password: '', ...passwordSecurity },
    linkedRecord,
    baseRecord
  ];

  let deliveryRows;
  let lastDeliveryError = null;
  for (const record of recordVariants) {
    try {
      deliveryRows = await supabaseFetch(env, '/rest/v1/deliveries', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(record)
      });
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

  return json({ ok: true, deliveryId: delivery.id, deliveryUrl, shortCode, shortUrl: `/${shortCode}`, shortLink: `${PUBLIC_SITE}/${shortCode}`, password, generatedText, savedLinks: rows.length });
}

async function handleUnlock(request, env) {
  const limited = enforceRateLimit(request, 'gallery-unlock', { limit: 12, windowMs: 60 * 1000, blockMs: 15 * 60 * 1000 });
  if (limited) return limited;
  const body = await request.json();
  const lookup = String(body.slug || body.shortCode || '').trim();
  const password = String(body.password || '').trim();
  const delivery = await getDeliveryByLookup(env, lookup);
  if (!delivery) return json({ error: 'Delivery not found.' }, 404);
  if (!(await verifyGalleryPassword(delivery, password))) {
    await insertLog(env, request, delivery.id, 'password_failed');
    return json({ error: 'Wrong password.' }, 401);
  }

  await insertLog(env, request, delivery.id, 'password_success');
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
  const deliveries = await supabaseFetch(
    env,
    '/rest/v1/deliveries?select=*&order=created_at.desc&limit=200'
  );
  const allDeliveries = Array.isArray(deliveries) ? deliveries : [];
  const filtered = allDeliveries;

  const ids = filtered.map((d) => d.id);
  let links = [];
  let logs = [];
  if (ids.length) {
    const inList = ids.join(',');
    links = await supabaseFetch(env, `/rest/v1/delivery_links?select=*&delivery_id=in.(${inList})&order=created_at.asc`);
    logs = await supabaseFetch(env, `/rest/v1/delivery_access_logs?select=*&delivery_id=in.(${inList})&order=created_at.desc&limit=1000`);
  }
	  links = Array.isArray(links) ? links : [];
	  logs = Array.isArray(logs) ? logs : [];
	  logs = await enrichLogsWithIpInfo(logs);

  let invoiceRows = [];
  let allInvoices = [];
  try {
    const rawInvoices = await supabaseFetch(env, '/rest/v1/invoices?select=*&order=updated_at.desc&limit=200');
    allInvoices = Array.isArray(rawInvoices) ? rawInvoices : [];
    invoiceRows = q
      ? allInvoices.filter((inv) => [inv.client_name, inv.client_contact, inv.status, inv.invoice_date, inv.event_date, inv.venue, inv.created_at, inv.updated_at].join(' ').toLowerCase().includes(q))
      : allInvoices;
  } catch (error) {
    invoiceRows = [];
    allInvoices = [];
  }

  let subscriptionRows = [];
  let allSubscriptions = [];
  try {
    const rawSubs = await supabaseFetch(env, '/rest/v1/subscriptions?select=*&order=created_at.desc&limit=200');
    allSubscriptions = Array.isArray(rawSubs) ? rawSubs : [];
    subscriptionRows = q
      ? allSubscriptions.filter((sub) => [sub.client_name, sub.service, sub.storage_slot, sub.status, sub.invoice_date, sub.created_at].join(' ').toLowerCase().includes(q))
      : allSubscriptions;
  } catch (error) {
    subscriptionRows = [];
    allSubscriptions = [];
  }

  const latestInvoiceByClient = latestByClientKey(allInvoices);
  const latestDeliveryByClient = latestByClientKey(allDeliveries);

	  const items = filtered.map((d) => {
    const dl = links.filter((l) => l.delivery_id === d.id);
    const lg = logs.filter((l) => l.delivery_id === d.id);
    const clicks = lg.filter((l) => l.event_type === 'button_click').length;
    const opens = lg.filter((l) => l.event_type === 'page_view' || l.event_type === 'password_success').length;
    const shortCode = deliveryShortCode(d);
    const displayPassword = deliveryPasswordForDisplay(d);
    const generatedText = d.generated_text_whatsapp || (displayPassword ? buildDeliveryMessage(d.title || 'Ms.', d.client_name, shortCode, displayPassword) : '');
    const folderSlugBlocked = shouldBlockFolderSlug(d);
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
      generated_text_instagram: d.generated_text_instagram || generatedText,
      created_at: d.created_at,
      delivery_url: folderSlugBlocked ? `/${shortCode}` : `/g/${d.base_slug}`,
      short_code: shortCode,
      short_url: `/${shortCode}`,
      gallery_code: galleryCodeFromSlug(d.base_slug),
      related_invoice: invoiceSummary(relatedByClientKey(d, latestInvoiceByClient)),
      links: dl,
      stats: { opens, clicks, logs: lg.slice(0, 50) }
    };
  });

  invoiceRows = invoiceRows.map((inv) => ({
    ...inv,
    related_delivery: deliverySummary(relatedByClientKey(inv, latestDeliveryByClient))
  }));

  const clientRows = await fetchClients(env);
  const clients = buildClientSummaries(clientRows, allInvoices, allDeliveries, allSubscriptions, q);

  return json({ ok: true, items, invoices: invoiceRows, clients, subscriptions: subscriptionRows });
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

async function handleDbPasswordChange(request, env) {
  const body = await request.json().catch(() => ({}));
  const password = String(body.password || '').trim();
  const nextPassword = String(body.newPassword || '').trim();
  if (!(await verifyAdminRequest(request, env, password))) return json({ error: 'Unauthorized.' }, 401);
  if (nextPassword.length < 4) return json({ error: 'Use at least 4 characters.' }, 400);
  if (nextPassword.length > 72) return json({ error: 'Use 72 characters or fewer.' }, 400);
  return json({ error: 'Admin password is managed by Cloudflare Secret. Run: npx wrangler pages secret put ADMIN_PASSWORD --project-name=starshots' }, 400);
}


function normalizeInvoicePayload(raw = {}) {
  const data = raw.invoice_data && typeof raw.invoice_data === 'object' ? raw.invoice_data : {};
  const status = ['invoice', 'deposit', 'paid'].includes(String(raw.status || '').toLowerCase()) ? String(raw.status).toLowerCase() : 'invoice';
  const cleanMoney = (v) => Math.max(0, Math.round(Number(v) || 0));
  return {
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

  if (id) {
    let rows;
    try {
      rows = await supabaseFetch(env, `/rest/v1/invoices?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(linkedInvoice)
      });
    } catch (error) {
      if (!linkedInvoice.client_id || !isSchemaError(error)) throw error;
      rows = await supabaseFetch(env, `/rest/v1/invoices?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(invoiceWithoutClient)
      });
    }
    const saved = Array.isArray(rows) ? rows[0] : rows;
    return json({ ok: true, invoice: saved });
  }

  let rows;
  try {
    rows = await supabaseFetch(env, '/rest/v1/invoices', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(linkedInvoice)
    });
  } catch (error) {
    if (!linkedInvoice.client_id || !isSchemaError(error)) throw error;
    rows = await supabaseFetch(env, '/rest/v1/invoices', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(invoiceWithoutClient)
    });
  }
  const saved = Array.isArray(rows) ? rows[0] : rows;
  return json({ ok: true, invoice: saved });
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

async function handleSubscriptionSave(request, env) {
  const body = await request.json();
  const password = String(body.password || '').trim();
  if (!(await verifyAdminRequest(request, env, password))) return json({ error: 'Unauthorized.' }, 401);

  const sub = body.subscription || {};
  const clientName = cleanText(sub.client_name || '', 160);
  if (!clientName) return json({ error: 'Client name is required.' }, 400);
  if (!sub.service) return json({ error: 'Service is required.' }, 400);

  const id = String(sub.id || '').trim();
  let existingSub = null;
  if (id) {
    existingSub = await supabaseFetch(env, `/rest/v1/subscriptions?select=*&id=eq.${encodeURIComponent(id)}&limit=1`)
      .then((rows) => Array.isArray(rows) ? rows[0] : rows)
      .catch(() => null);
  }

  const client = await findOrCreateClient(env, {
    title: sub.client_title || 'Ms.',
    name: clientName,
    contact: sub.client_contact || ''
  }, existingSub?.client_id || '');

  const payload = {
    client_name: clientName,
    client_title: cleanClientTitle(sub.client_title || 'Ms.'),
    client_contact: cleanText(sub.client_contact || '', 240),
    service: cleanText(sub.service, 80),
    storage_slot: sub.storage_slot ? cleanText(sub.storage_slot, 80) : null,
    access_period: Number(sub.access_period) || 30,
    rate_mode: sub.rate_mode || 'normal',
    price: Number(sub.price) || 0,
    manual_override: !!sub.manual_override,
    status: sub.status || 'invoice',
    invoice_date: sub.invoice_date || new Date().toISOString().slice(0, 10),
    payment_date: sub.payment_date || null,
    payment_time: sub.payment_time || null,
    start_date: sub.start_date || null,
    start_time: sub.start_time || null,
    expiry_date: sub.expiry_date || null,
    expiry_time: sub.expiry_time || null
  };

  const linked = client?.id ? { ...payload, client_id: String(client.id) } : payload;
  const unlinked = { ...payload };

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
        body: JSON.stringify(unlinked)
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
      body: JSON.stringify(unlinked)
    });
  }
  const saved = Array.isArray(rows) ? rows[0] : rows;
  return json({ ok: true, subscription: saved });
}

async function handleSubscriptionGet(request, env) {
  const url = new URL(request.url);
  const id = String(url.searchParams.get('id') || '').trim();
  if (!id) return json({ error: 'Missing subscription id.' }, 400);
  try {
    const rows = await supabaseFetch(env, `/rest/v1/subscriptions?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
    const subscription = Array.isArray(rows) ? rows[0] : rows;
    if (!subscription) return json({ error: 'Subscription not found.' }, 404);
    return json({ ok: true, subscription });
  } catch (error) {
    if (isSchemaError(error)) return json({ error: 'Subscription not found.' }, 404);
    throw error;
  }
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

function adminPage() {
  return `<!DOCTYPE html>
<html lang="en" class="ss-force-motion">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow">
  <title>StarShots Admin</title>
  <style>${shellStyles()}${privateAccessStyles()}
    .admin-shell{display:flex;flex-direction:column;gap:20px}
    .admin-top{margin-bottom:4px}
    .admin-top .logo{width:min(168px,44vw)}
    .admin-actions{display:flex;align-items:center;gap:12px}
    .admin-stage{width:100%}
    .admin-gate{max-height:calc(100dvh - max(48px, calc(env(safe-area-inset-top) + env(safe-area-inset-bottom))));overflow:auto}
    .admin-gate .field{margin-top:0}
    .admin-status{margin-top:14px}
    .dashboard{display:flex;flex-direction:column;gap:20px;padding-bottom:6px}
    .dash-head{
      display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,420px);
      align-items:end;gap:18px;margin-top:4px;
    }
    .dash-eyebrow{justify-content:flex-start;margin-bottom:14px}
    .dash-head h1{
      font-size:clamp(28px,4.8vw,40px);
      font-weight:900;line-height:1.04;letter-spacing:-.035em;margin:0;color:var(--ink);
    }
    .dash-head p{max-width:420px;margin:0;color:var(--soft);font-size:14.5px;line-height:1.55}
    .tool-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:4px}
    .tool-card{
      position:relative;min-height:178px;display:flex;flex-direction:column;justify-content:space-between;gap:18px;
      text-decoration:none;border:1px solid var(--line);border-radius:16px;padding:18px;
      -webkit-backface-visibility:hidden;backface-visibility:hidden;-webkit-transform:translateZ(0);transform:translateZ(0);
      background:var(--solid);
      background:linear-gradient(180deg, color-mix(in srgb, var(--solid) 96%, white 4%), var(--solid));
      color:var(--ink);overflow:hidden;
      box-shadow:0 24px 55px -34px rgba(30,30,28,.22),0 1px 0 rgba(255,255,255,.5) inset;
      transition:
        opacity var(--dur-item) var(--ease-out),
        transform var(--dur-item) var(--ease-out),
        border-color .25s var(--ease-out),
        box-shadow .3s var(--ease-out),
        background .3s var(--ease-out);
    }
    .tool-card:before{
      content:"";position:absolute;left:0;top:0;bottom:0;width:3px;
      background:linear-gradient(180deg,var(--gold),var(--gold-2));
      transform:scaleY(0);transform-origin:center;transition:transform .3s var(--ease-spring);
    }
    .tool-card small{font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
    .tool-card strong{display:block;margin-top:12px;font-size:clamp(20px,2vw,25px);font-weight:900;line-height:1.05;letter-spacing:-.035em;color:var(--ink)}
    .tool-card p{color:var(--soft);font-size:14px;line-height:1.45;max-width:240px}
    .tool-action{
      display:inline-flex;align-items:center;justify-content:center;align-self:flex-start;
      border:1px solid var(--line);border-radius:999px;padding:6px 12px;
      color:var(--soft);font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;
      background:var(--card);
      background:color-mix(in srgb, var(--card) 82%, transparent);
      transition:background .25s var(--ease-out),color .25s var(--ease-out),border-color .25s var(--ease-out);
    }
    @media(hover:hover) and (pointer:fine){
      .tool-card:hover{
        transform:translateY(-2px);
        border-color:color-mix(in srgb, var(--gold) 55%, var(--line));
        box-shadow:0 30px 62px -36px rgba(200,192,175,.23),0 8px 18px -14px rgba(200,192,175,.15);
        background:color-mix(in srgb, var(--solid) 94%, var(--gold) 6%);
      }
      .tool-card:hover:before{transform:scaleY(1)}
      .tool-card:hover .tool-action{border-color:transparent;background:var(--gold);color:#fff}
    }
    .tool-card:active{transform:translateY(0) scale(.992)}
    .admin-gate.is-settled .reveal,.dashboard.is-settled .reveal,.admin-top.is-settled{transition-delay:0ms!important}
    .dashboard.is-settled .tool-card{transition:transform .25s var(--ease-out),border-color .25s var(--ease-out),box-shadow .3s var(--ease-out),background .3s var(--ease-out)}
    @media(max-width:980px){
      .dash-head{grid-template-columns:1fr;align-items:start}
      .tool-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
    }
    @media(max-width:560px){
      .tool-grid{grid-template-columns:1fr}
      .tool-card{min-height:156px;border-radius:14px}
      .admin-top{align-items:flex-start}
      .admin-actions{align-self:flex-start}
    }
  </style>
  ${animateAssets()}
</head>
<body>
  <div class="aurora" aria-hidden="true"></div>
  <div class="access-shell admin-shell">
    <header id="adminTop" class="top admin-top hidden reveal stagger-1" data-reveal>
      <a class="logo-link" href="/admin" aria-label="StarShots admin dashboard"><img class="logo compact ss-logo-top" src="${LOGO_PATH}" alt="StarShots logo"></a>
      <div class="admin-actions"><div class="compact-pill">Private</div></div>
    </header>

    <div id="adminStage" class="access-stage admin-stage">
      <section id="adminGate" class="access-card admin-gate ss-gate-card" data-ss-gate-card aria-labelledby="admin-gate-title">
        <div class="brand ss-gate-brand reveal" data-reveal>
          <a class="logo-link" href="/" aria-label="Back to StarShots homepage">
            <img class="logo ss-gate-logo ss-logo-hero" src="${LOGO_PATH}" alt="StarShots">
          </a>
        </div>
        <p class="eyebrow ss-gate-eyebrow reveal" data-reveal><span class="rule"></span><span class="dot" aria-hidden="true"></span>Private Workspace<span class="rule"></span></p>
        <h1 id="admin-gate-title" class="mask-reveal ss-gate-title reveal" data-reveal><span>Dashboard</span></h1>
        <div class="field ss-gate-field reveal" data-reveal>
          <label class="ss-gate-label" for="adminPassword">Access key</label>
          <div class="password-wrap">
            <input id="adminPassword" type="password" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" data-ss-gate-input>
            <button id="toggleAdminPass" class="eye-btn" type="button" aria-label="Show access key">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.75 12S5.5 5.5 12 5.5 22.25 12 22.25 12 18.5 18.5 12 18.5 1.75 12 1.75 12Z"/><circle cx="12" cy="12" r="3.25"/></svg>
            </button>
          </div>
        </div>
        <button id="adminOpen" class="primary ss-gate-button reveal" data-ss-gate-button data-reveal type="button">
          <span class="spin" aria-hidden="true"></span>
          <span class="label">Sign In</span>
        </button>
        <p id="adminStatus" class="status admin-status ss-gate-status reveal" data-reveal role="status" aria-live="polite"></p>
      </section>
    </div>

    <main id="dashboard" class="dashboard hidden">
      <section class="dash-head reveal stagger-2" data-reveal>
        <div>
          <p class="eyebrow dash-eyebrow"><span class="dot" aria-hidden="true"></span>StarShots Private</p>
          <h1>Dashboard</h1>
        </div>
        <p>Studio tools for delivery links, activity tracking, invoices, and client gallery access.</p>
      </section>

      <section class="tool-grid" aria-label="StarShots tools">
        <a class="tool-card reveal stagger-3" data-reveal href="/inv">
          <span><small>Billing</small><strong>Invoice Generator</strong></span>
          <p>Create invoice, deposit, and paid documents.</p>
          <span class="tool-action">Open</span>
        </a>
        <a class="tool-card reveal stagger-4" data-reveal href="/l">
          <span><small>Delivery</small><strong>Create Links</strong></span>
          <p>Prepare short links and delivery messages.</p>
          <span class="tool-action">Open</span>
        </a>
        <a class="tool-card reveal stagger-5" data-reveal href="/db">
          <span><small>Activity</small><strong>Database & Activity</strong></span>
          <p>Review saved links, invoices, and access logs.</p>
          <span class="tool-action">Open</span>
        </a>
        <a class="tool-card reveal stagger-6" data-reveal href="/g">
          <span><small>Client</small><strong>Client Gallery Access</strong></span>
          <p>Open the client-facing gallery access route.</p>
          <span class="tool-action">Open</span>
        </a>
      </section>
    </main>
  </div>
  <script>
    ${mobileSafeRevealScript()}
    const ADMIN_SESSION_KEY='starshots_admin_session_v1';
    const ADMIN_SESSION_MS=15*60*1000;
    const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches&&!document.documentElement.classList.contains('ss-force-motion');
    const adminStage=document.getElementById('adminStage');
    const topBar=document.getElementById('adminTop');
    const gate=document.getElementById('adminGate');
    const dashboard=document.getElementById('dashboard');
    const pass=document.getElementById('adminPassword');
    const toggleAdminPass=document.getElementById('toggleAdminPass');
    const openBtn=document.getElementById('adminOpen');
    const openLabel=openBtn.querySelector('.label');
    const statusEl=document.getElementById('adminStatus');
    const eyeSvg='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.75 12S5.5 5.5 12 5.5 22.25 12 22.25 12 18.5 18.5 12 18.5 1.75 12 1.75 12Z"/><circle cx="12" cy="12" r="3.25"/></svg>';
    const eyeOffSvg='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 2.5 21.5 21.5"/><path d="M9.9 5.9A13.2 13.2 0 0 1 12 5.5c6.5 0 10.25 6.5 10.25 6.5a18 18 0 0 1-3.45 4.38"/><path d="M6.03 8.03C3.56 9.96 1.75 12 1.75 12S5.5 18.5 12 18.5c1.87 0 3.53-.38 4.98-1.04"/><path d="M10.59 10.59A3.25 3.25 0 0 0 15.18 15.18"/></svg>';
    function isTouchViewport(){return window.matchMedia('(max-width: 640px), (pointer: coarse)').matches}
    function focusSoon(el,options={}){if(!el)return;const{allowTouch=false,delay=60}=options;if(!allowTouch&&isTouchViewport())return;setTimeout(()=>el.focus({preventScroll:true}),delay)}
    function revealIn(el,delay){if(!el)return;setTimeout(()=>el.classList.add('is-visible'),delay);}
    function showReveals(root){requestAnimationFrame(()=>root.querySelectorAll('[data-reveal],.reveal').forEach(el=>el.classList.add('is-visible')))}
    function stageAccessIntro(){
      if(window.StarShotsGate&&window.StarShotsGate.intro){
        const handled=window.StarShotsGate.intro(gate,{root:gate,button:openBtn,input:pass});
        if(handled||gate.dataset.ssGateIntro==='running'||gate.dataset.introState==='running'||gate.classList.contains('is-mounted')||gate.classList.contains('is-visible')) return;
      }
      if(gate.classList.contains('is-mounted') || gate.dataset.introState === 'running') return;
      gate.dataset.introState = 'running';
      const isMobile=window.matchMedia('(max-width: 640px), (pointer: coarse)').matches;
      const reveals=Array.from(gate.querySelectorAll('.reveal'));
      gate.classList.remove('is-mounted','is-leaving');
      reveals.forEach(el=>el.classList.remove('is-visible'));
      if(reduceMotion){
        gate.classList.add('is-mounted');
        reveals.forEach(el=>el.classList.add('is-visible'));
        gate.dataset.introState='done';
        focusSoon(pass);
        return;
      }
      requestAnimationFrame(()=>{
        void gate.offsetWidth;
        requestAnimationFrame(()=>{
          gate.classList.add('is-mounted');
          if(window.StarShotsReveal&&window.StarShotsReveal.bounceLogos) window.StarShotsReveal.bounceLogos(gate);
          const stagger=isMobile?75:90;
          const startAt=isMobile?180:300;
          reveals.forEach((el,i)=>revealIn(el,startAt+i*stagger));
          const doneAt=startAt+reveals.length*stagger+260;
          setTimeout(()=>{gate.dataset.introState='done';openBtn.classList.add('is-sheen');setTimeout(()=>openBtn.classList.remove('is-sheen'),3600);},doneAt);
          setTimeout(()=>focusSoon(pass),isMobile?900:720);
          setTimeout(()=>gate.classList.add('is-settled'),doneAt+520);
        });
      });
    }
    function rememberAdminPassword(){localStorage.removeItem(ADMIN_SESSION_KEY);sessionStorage.setItem(ADMIN_SESSION_KEY,JSON.stringify({expiresAt:Date.now()+ADMIN_SESSION_MS}));}
    function clearAdminPassword(){sessionStorage.removeItem(ADMIN_SESSION_KEY);localStorage.removeItem(ADMIN_SESSION_KEY);sessionStorage.removeItem('starshots_admin_password');sessionStorage.removeItem('ss_admin_password');}
    function rememberedAdminPassword(){localStorage.removeItem(ADMIN_SESSION_KEY);try{const raw=sessionStorage.getItem(ADMIN_SESSION_KEY);const saved=raw?JSON.parse(raw):null;if(saved&&Number(saved.expiresAt)>Date.now())return true;if(raw){clearAdminPassword();return false;}}catch(e){clearAdminPassword();return false;}return false;}
    function revealDashboard(){
      adminStage.classList.add('hidden');
      dashboard.classList.remove('hidden');
      topBar.classList.remove('hidden');
      dashboard.classList.remove('is-settled');
      topBar.classList.remove('is-settled');
      if(window.StarShotsReveal){window.StarShotsReveal.reset(dashboard);window.StarShotsReveal.reset(topBar);}
      requestAnimationFrame(()=>{
        topBar.classList.add('is-visible');
        if(window.StarShotsReveal){window.StarShotsReveal.start(topBar);window.StarShotsReveal.start(dashboard);}
        showReveals(dashboard);
      });
      statusEl.textContent='';
      setTimeout(()=>{dashboard.classList.add('is-settled');topBar.classList.add('is-settled');},reduceMotion?0:1500);
      focusSoon(dashboard.querySelector('a'));
    }
    function showDashboard(){
      if(adminStage.classList.contains('hidden')){revealDashboard();return;}
      gate.classList.add('is-leaving');
      setTimeout(()=>{
        gate.classList.remove('is-mounted','is-leaving','is-settled');
        revealDashboard();
      },reduceMotion?0:500);
    }
    async function checkAdmin(value){
      const res=await fetch('/api/admin-check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:value})});
      const data=await res.json().catch(()=>({}));
      if(!res.ok||!data.ok)throw new Error(data.error||'Unauthorized.');
    }
    async function openAdmin(){
      const value=pass.value.trim();
      if(!value){statusEl.textContent='Access key required.';statusEl.className='status err admin-status';focusSoon(pass,{allowTouch:true});return;}
      statusEl.textContent='Checking...';
      statusEl.className='status admin-status';
      openBtn.disabled=true;
      openBtn.classList.add('is-loading');
      const original=openLabel.textContent;
      openLabel.textContent='Opening...';
      try{await checkAdmin(value);rememberAdminPassword();showDashboard();}
      catch(e){clearAdminPassword();statusEl.textContent=e.message||'Unauthorized.';statusEl.className='status err admin-status';focusSoon(pass,{allowTouch:true});}
      finally{openBtn.disabled=false;openBtn.classList.remove('is-loading');openLabel.textContent=original;}
    }
    function toggleGatePassword(){const show=pass.type==='password';pass.type=show?'text':'password';toggleAdminPass.innerHTML=show?eyeOffSvg:eyeSvg;toggleAdminPass.setAttribute('aria-label',show?'Hide password':'Show password');focusSoon(pass,{allowTouch:true});}
    openBtn.onclick=openAdmin;
    toggleAdminPass.onclick=toggleGatePassword;
    pass.onkeydown=e=>{if(e.key==='Enter')openAdmin();};
    (async()=>{const saved=rememberedAdminPassword();if(saved){try{await checkAdmin('');rememberAdminPassword();revealDashboard();return;}catch(e){clearAdminPassword();}}stageAccessIntro();})();
  </script>
</body>
</html>`;
}

// dbPage() removed — /db is now served as a static file from db/index.html


export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    const url = new URL(request.url);

    try {
	      if (request.method === 'GET' && url.pathname === '/') {
	        return new Response(rootHomepage(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
	      }
	      if (request.method === 'GET' && ['/admin', '/admin/'].includes(url.pathname)) {
	        return new Response(adminPage(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
	      }
	      if (request.method === 'GET' && ['/inv', '/inv/', '/invoice', '/invoice/', '/inv/index.html'].includes(url.pathname)) {
        const assetUrl = new URL(request.url);
        assetUrl.pathname = '/inv/';
        return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
      }
      if (request.method === 'GET' && ['/db', '/db/', '/db/index.html'].includes(url.pathname)) {
        const assetUrl = new URL(request.url);
        assetUrl.pathname = '/db/';
        return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
      }
      if (request.method === 'POST' && url.pathname === '/api/admin-check') return await handleAdminCheck(request, env);
      if (request.method === 'POST' && url.pathname === '/api/invoices-save') return await handleInvoiceSave(request, env);
      if (request.method === 'GET' && url.pathname === '/api/invoices-get') return await handleInvoiceGet(request, env);
      if (request.method === 'POST' && url.pathname === '/api/invoices-delete') return await handleInvoiceDelete(request, env);
      if (request.method === 'POST' && url.pathname === '/api/subscriptions-save') return await handleSubscriptionSave(request, env);
      if (request.method === 'GET' && url.pathname === '/api/subscriptions-get') return await handleSubscriptionGet(request, env);
      if (request.method === 'POST' && url.pathname === '/api/subscriptions-delete') return await handleSubscriptionDelete(request, env);
      if (request.method === 'POST' && url.pathname === '/api/save') return await handleSave(request, env);
      if (request.method === 'POST' && url.pathname === '/api/unlock') return await handleUnlock(request, env);
      if (request.method === 'POST' && url.pathname === '/api/click') return await handleClick(request, env);
	      if (request.method === 'GET' && url.pathname === '/api/db') return await handleDbSearch(request, env);
	      if (request.method === 'POST' && url.pathname === '/api/clients-save') return await handleClientSave(request, env);
	      if (request.method === 'POST' && url.pathname === '/api/db-password') return await handleDbPasswordChange(request, env);
	      if (request.method === 'POST' && url.pathname === '/api/db-delete') return await handleDbDelete(request, env);
	      if (request.method === 'POST' && url.pathname === '/api/db-clear-logs') return await handleDbClearLogs(request, env);

      const shortAliasMatch = url.pathname.match(/^\/([a-z0-9]{7}|[a-z0-9]{12})\/?$/i);
      if (request.method === 'GET' && shortAliasMatch) {
        const limited = enforceRateLimit(request, 'short-alias', { limit: 40, windowMs: 60 * 1000, blockMs: 10 * 60 * 1000 }, false);
        if (limited) return limited;
        const shortCode = cleanShortCode(shortAliasMatch[1]);
        const delivery = shortCode ? await getDeliveryByShortCode(env, shortCode) : null;
        if (delivery) {
          await insertLog(env, request, delivery.id, 'page_view');
          return new Response(deliveryPageHtml(shortCode, delivery), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
        // Unknown short code: serve a real 404 so the address bar
        // keeps the URL the visitor typed (a 302 to "/" hid that)
        // and the browser marks the response as an error. Bots
        // walking the short-code space hit both this 404 and the
        // 40/min rate limit we already consumed above.
        return new Response(notFoundPage(url.pathname), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
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
          return new Response(notFoundPage(url.pathname), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
        if (delivery) await insertLog(env, request, delivery.id, 'page_view');
        return new Response(deliveryPageHtml(slug, delivery), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }

      const oldDeliveryMatch = url.pathname.match(/^\/l\/([^/]+)\/?$/i);
      if (request.method === 'GET' && oldDeliveryMatch) {
        const slug = normalizeGalleryCode(decodeURIComponent(oldDeliveryMatch[1])) || cleanSlug(oldDeliveryMatch[1]);
        return Response.redirect(`${url.origin}/g/${slug}`, 302);
      }
    } catch (error) {
      if (url.pathname.startsWith('/api/')) return json({ error: error.message || 'Server error.' }, 500);
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
