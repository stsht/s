import { compactEventDateLabel } from '../dbHelpers.js';


// Robust short-code resolver. Old delivery rows shipped with a
// variety of field names depending on which version of /l saved
// them: short_code/shortCode, short_url/shortUrl, short_link/
// shortLink, delivery_url, and per-link short_path on
// links[]/delivery_links[]. Worker /api/db now normalises most of
// these to short_code + short_url, but it still emits short_url
// "/" for legacy rows that have no short_code at all — that's the
// "https://sshots.pages.dev/" bug we fix here. Returns a 7- or
// 12-char lowercase code, or '' when none could be recovered.
export function resolveDeliveryShortCode(delivery) {
  const direct = (val) => {
    const c = String(val || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (c.length === 12 || c.length === 7) return c;
    return '';
  };
  const codeFromUrlString = (val) => {
    if (typeof val !== 'string') return '';
    const m = val.match(/(?:^|\/)([a-z0-9]{12}|[a-z0-9]{7})(?:[/?#]|$)/i);
    return m ? m[1].toLowerCase() : '';
  };

  // 1) Direct 12/7-char code fields the worker or composer might emit.
  for (const v of [delivery?.short_code, delivery?.shortCode]) {
    const c = direct(v);
    if (c) return c;
  }
  // 2) Full URL or path-shaped fields.
  for (const v of [
    delivery?.short_url,
    delivery?.shortUrl,
    delivery?.short_link,
    delivery?.shortLink,
    delivery?.delivery_url,
  ]) {
    const c = codeFromUrlString(v);
    if (c) return c;
  }
  // 3) Per-link short_path entries on links[] / delivery_links[].
  const arrays = [delivery?.links, delivery?.delivery_links].filter(Array.isArray);
  for (const arr of arrays) {
    for (const link of arr) {
      const c =
        direct(link?.short_code) ||
        codeFromUrlString(link?.short_path) ||
        codeFromUrlString(link?.shortPath) ||
        codeFromUrlString(link?.short_url);
      if (c) return c;
    }
  }
  return '';
}

// Build the canonical short URL the operator can paste/share.
// Returns '' if the row has no usable short_code (caller renders
// "Legacy link unavailable"). Origin defaults to the current page
// so the dashboard always copies a link on the same domain it was
// opened on.
export function buildShortUrl(code) {
  if (!code) return '';
  if (typeof window === 'undefined') return `/${code}`;
  try {
    return new URL(`/${code}`, window.location.origin).toString();
  } catch {
    return `/${code}`;
  }
}

// Synthesise a delivery message when the worker payload doesn't
// carry a stored generated_text_whatsapp / generated_text_instagram
// (e.g. older rows that pre-date the message-template change). Mirrors
// buildDeliveryMessage() / buildDeliveryMessageIg() in _worker.js so
// the operator-facing text is identical regardless of which path
// produced it. WhatsApp keeps the *bold* markdown; the Instagram
// variant is the exact same wording/order with the formatting
// markers stripped (see stripMessageFormatting + synthesizeDelivery
// MessageIg below).
export function synthesizeDeliveryMessageWa(title, clientName, folderName, eventDate, shortUrl, password, deliveryDone) {
  const t = String(title ?? 'Ms.').trim();
  const n = String(clientName || '').trim();
  // Mirror _worker.js buildDeliveryMessage: drop the honorific
  // cleanly when the title is blank (e.g. vendor deliveries, which
  // are saved with an empty title) so the greeting reads
  // "Dear *Name*" instead of "Dear * Name*" with a stray leading
  // space inside the bold markers. Without this the client-facing
  // copy/share message diverged from the worker's canonical text
  // for every title-less row.
  const namePart = t ? `${t} ${n}` : n;
  const f = String(folderName || '').trim() || 'TBA';
  // compactEventDateLabel returns "6 Jun 2026" for a real
  // YYYY-MM-DD and "TBA" for a blank/timestamp value, so the Event
  // Date line always renders and never leaks a bookkeeping date.
  const ev = compactEventDateLabel(eventDate);
  const link = shortUrl || '(link unavailable)';
  const pass = String(password || '').trim() || '(no password)';

  if (deliveryDone) {
    return `Dear *${namePart}*,

Your StarShots files are now ready.

You may access them here:
*Folder:* ${f}
*Event Date:* ${ev}
*Link:* ${link}
*Password:* \`${pass}\`

Thank you for your patience.
With love, StarShots`;
  }

  return `Dear *${namePart}*,

With sincere appreciation, your private StarShots delivery page has been prepared for your kind attention.

You may access your *Delivery Page* and *Invoice* through the details below:

*Folder:* ${f}
*Event Date:* ${ev}
*Link:* ${link}
*Password:* \`${pass}\`

Should you wish to use a different password, please feel free to let us know and we will be pleased to update it for you.

Kindly keep this link for your delivery updates. Your final files will be made available through the same page once they are ready.

Thank you once again for allowing StarShots ID to be part of your special moment.

Warm Regards,
StarShots ID`;
}

// Strip WhatsApp markdown markers (*bold*, _italic_, ~strike~,
// `mono`) so the Instagram DM is plain text with identical wording
// and order. Only the markers are removed, never the words.
export function stripMessageFormatting(text) {
  return String(text || '').replace(/[*_~`]/g, '');
}

export function synthesizeDeliveryMessageIg(title, clientName, folderName, eventDate, shortUrl, password, deliveryDone) {
  return stripMessageFormatting(synthesizeDeliveryMessageWa(title, clientName, folderName, eventDate, shortUrl, password, deliveryDone));
}

export function accessLogEventLabel(type = '', service = '') {
  const cleanType = String(type || '').toLowerCase();
  const cleanService = String(service || '').toLowerCase();
  const serviceLabel = {
    gd: 'Google Drive',
    db: 'Dropbox',
    wt: 'WeTransfer',
    invoice: 'Invoice',
    payment_bank: 'Bank Account',
    payment_qr: 'QR Payment',
  }[cleanService] || cleanService.replace(/_/g, ' ').trim();
  // Link-click events read as "Google Drive clicked" / "Dropbox
  // clicked" / "WeTransfer clicked" so the operator sees exactly
  // which delivery service the visitor opened. A plain link click
  // with no service falls back to "Link clicked".
  if (cleanType === 'service_click' || cleanType === 'button_click') {
    const nice = serviceLabel ? serviceLabel.replace(/\b\w/g, (c) => c.toUpperCase()) : '';
    return nice ? `${nice} clicked` : 'Link clicked';
  }
  // Friendly action labels. Both the canonical event types written by
  // the worker (password_success / payment_qr_download / ...) and the
  // shorter aliases from the task spec (unlock_success / payment_qr /
  // ...) map to the same display string so existing logged rows and
  // any future event names render identically.
  const labels = {
    password_success: 'Unlocked',
    unlock_success: 'Unlocked',
    password_failed: 'Password failed',
    unlock_failed: 'Password failed',
    admin_unlock: 'Admin Preview',
    admin_page_view: 'Admin Preview',
    page_view: 'Page Opened',
    invoice_view: 'Invoice viewed',
    invoice_fullscreen: 'Opened Full Invoice',
    invoice_download: 'Downloaded Invoice',
    payment_bank_copy: 'Bank copied',
    payment_bank: 'Bank copied',
    payment_qr_download: 'Payment QR downloaded',
    payment_qr: 'Payment QR downloaded',
  };
  return labels[cleanType] || cleanType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function accessLogDevice(userAgent = '') {
  const ua = String(userAgent || '');
  if (!ua) return '';
  // In-app browsers (social / messaging shells) expose themselves
  // through distinctive UA tokens. Surface the app as the "browser"
  // so the operator reads "Instagram Browser" instead of the generic
  // Safari/Chrome webview underneath. Order matters: Instagram's UA
  // also carries FBAV, so test Instagram before Facebook.
  const inApp = /Instagram/i.test(ua) ? 'Instagram Browser'
    : /(FBAN|FBAV|FB_IAB|FBIOS|FB4A)/i.test(ua) ? 'Facebook Browser'
      : /WhatsApp/i.test(ua) ? 'WhatsApp Browser'
        : /\bLine\//i.test(ua) ? 'LINE Browser'
          : /TikTok|musical_ly|BytedanceWebview/i.test(ua) ? 'TikTok Browser'
            : '';
  if (inApp) return inApp;
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
      : /CriOS|Chrome\//.test(ua) ? 'Chrome'
        : /FxiOS|Firefox\//.test(ua) ? 'Firefox'
          : /Safari\//.test(ua) ? 'Safari'
            : 'Browser';
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
      : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
        : /Windows/.test(ua) ? 'Windows'
          : '';
  return [browser, os].filter(Boolean).join(' ');
}

export function accessLogPlace(log = {}) {
  return [log.city, log.country].map((item) => String(item || '').trim()).filter(Boolean).join(', ');
}

// ISP / network label, shown only when the log payload actually
// carries it (ASN/org/isp). The /db dashboard payload currently
// skips IP enrichment for speed, so this gracefully returns '' and
// the meta line simply omits the network rather than guessing.
export function accessLogIsp(log = {}) {
  return String(log.isp || log.org || log.asn_org || '').trim();
}

// Mask an IP for the compact COLLAPSED subtitle so the card stays
// readable without leaking a full address at a glance. IPv4 keeps the
// first two octets ("103.109.xxx.xxx"); IPv6 keeps the first two
// hextets ("2404:c0:xxxx"). Expanded timeline rows still show the
// full IP for precise same-visitor / proxy correlation.
export function maskIpAddress(ip = '') {
  const clean = String(ip || '').trim();
  if (!clean) return '';
  if (clean.includes(':')) {
    const head = clean.split(':').filter(Boolean).slice(0, 2).join(':');
    return head ? `${head}:xxxx` : clean;
  }
  const m = clean.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  return m ? `${m[1]}.${m[2]}.xxx.xxx` : clean;
}

export function ipv4Octets(ip = '') {
  const m = String(ip || '').trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : null;
}

// Derive a well-known network / infrastructure owner from a log's
// metadata. We FIRST honour any explicit isp/org/asn_org string the
// payload carries (future-proof + lets a real ISP name like
// "Telkomsel" become the card title). When no org is stored — the
// current /db payload only persists ip/city/country/user_agent — we
// fall back to conservative IP-range matching for the handful of big
// infra owners that matter for spotting previews/proxies. Anything we
// can't confidently place returns an empty key/name so the UI quietly
// falls back to the browser/app label instead of guessing.
//   key: '' | 'isp' | 'meta' | 'apple_relay' | 'cloudflare' | 'google' | 'aws' | 'datacenter'
export function classifyAccessNetwork(log = {}) {
  const org = accessLogIsp(log);
  if (org) {
    const o = org.toLowerCase();
    if (/facebook|instagram|\bmeta\b/.test(o)) return { key: 'meta', name: 'Meta' };
    if (/apple|icloud|private relay/.test(o)) return { key: 'apple_relay', name: 'Apple Private Relay' };
    if (/cloudflare/.test(o)) return { key: 'cloudflare', name: 'Cloudflare / Proxy' };
    if (/google/.test(o)) return { key: 'google', name: 'Google' };
    if (/amazon|\baws\b/.test(o)) return { key: 'aws', name: 'Amazon AWS' };
    if (/microsoft|azure|digitalocean|\bovh\b|hetzner|linode|vultr|datacenter|hosting/.test(o)) {
      return { key: 'datacenter', name: org };
    }
    // A real residential / mobile ISP (e.g. Telkomsel, Indosat, Biznet).
    return { key: 'isp', name: org };
  }
  const ip = String(log.ip_address || '').trim();
  const ipl = ip.toLowerCase();
  if (!ipl) return { key: '', name: '' };
  if (ipl.includes(':')) {
    if (ipl.startsWith('2a03:2880') || ipl.startsWith('2a03:2887') || ipl.startsWith('2620:0:1c')) {
      return { key: 'meta', name: 'Meta' };
    }
    if (ipl.startsWith('2606:4700') || ipl.startsWith('2803:f800') || ipl.startsWith('2405:b500')
      || ipl.startsWith('2405:8100') || ipl.startsWith('2a06:98c0') || ipl.startsWith('2c0f:f248')) {
      return { key: 'cloudflare', name: 'Cloudflare / Proxy' };
    }
    if (ipl.startsWith('2607:f8b0') || ipl.startsWith('2001:4860')) return { key: 'google', name: 'Google' };
    if (ipl.startsWith('2600:1f') || ipl.startsWith('2600:9000') || ipl.startsWith('2406:da')) {
      return { key: 'aws', name: 'Amazon AWS' };
    }
    return { key: '', name: '' };
  }
  const octets = ipv4Octets(ip);
  if (octets) {
    const [a, b, c] = octets;
    const isMeta = (a === 31 && b === 13) || (a === 66 && b === 220) || (a === 69 && b === 63)
      || (a === 69 && b === 171) || (a === 74 && b === 119 && c >= 76 && c <= 79)
      || (a === 102 && b === 132) || (a === 103 && b === 4 && c >= 96 && c <= 99)
      || (a === 129 && b === 134) || (a === 157 && b === 240) || (a === 173 && b === 252)
      || (a === 179 && b === 60 && c >= 192 && c <= 195) || (a === 185 && b === 60 && c >= 216 && c <= 219)
      || (a === 204 && b === 15 && c >= 20 && c <= 23);
    if (isMeta) return { key: 'meta', name: 'Meta' };
    const isCloudflare = (a === 104 && b >= 16 && b <= 31) || (a === 172 && b >= 64 && b <= 71)
      || (a === 162 && (b === 158 || b === 159)) || (a === 173 && b === 245) || (a === 188 && b === 114)
      || (a === 190 && b === 93) || (a === 197 && b === 234) || (a === 198 && b === 41) || (a === 131 && b === 0);
    if (isCloudflare) return { key: 'cloudflare', name: 'Cloudflare / Proxy' };
    const isGoogle = (a === 8 && (b === 8 || b === 34 || b === 35)) || (a === 66 && b === 249)
      || (a === 64 && b === 233) || (a === 72 && b === 14) || (a === 74 && b === 125) || (a === 108 && b === 177)
      || (a === 142 && b === 250) || (a === 172 && b === 217) || (a === 173 && b === 194) || (a === 209 && b === 85)
      || (a === 216 && (b === 58 || b === 239)) || a === 34 || a === 35;
    if (isGoogle) return { key: 'google', name: 'Google' };
    const isAws = a === 3 || a === 13 || a === 15 || a === 16 || a === 18 || a === 52 || a === 54
      || (a === 99 && b >= 77 && b <= 88);
    if (isAws) return { key: 'aws', name: 'Amazon AWS' };
  }
  return { key: '', name: '' };
}

// A GENUINE in-app browser (a real person tapping a link inside
// Instagram / WhatsApp / Facebook / etc.). Meta's link-preview
// scanner (facebookexternalhit / Facebot / meta-externalagent) is
// explicitly NOT a real open, so we exclude it here — that case is
// surfaced as "Meta Preview" instead.
export function isRealInAppBrowser(userAgent = '') {
  const ua = String(userAgent || '');
  if (!ua) return false;
  if (/facebookexternalhit|facebot|meta-externalagent/i.test(ua)) return false;
  return /Instagram|WhatsApp|FBAN|FBAV|FB_IAB|FBIOS|FB4A|\bLine\/|TikTok|musical_ly|Bytedance/i.test(ua);
}
