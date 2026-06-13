import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WorkspacePanels } from '../../components/WorkspacePanels.jsx';
import { DatabaseList } from './DatabaseList.jsx';
import { DeleteIcon } from './RecordRow.jsx';
import { Segmented, EmptyState, Combobox, DateTimeField } from '../../components/ui/index.js';
import { toTitleCase, onBlurTitleCase } from '../../utils/titleCase.js';
import { selectAllIfZero, parseMoneyInput } from '../../utils/moneyInput.js';
import { rupiah } from '../../utils/rupiah.js';
import { useRemoteList } from './useRemoteList.js';
import {
  plainEventDate,
  jakartaTodayISO,
  classifyClientEvents,
  eventDateTone,
  compactEventDateLabel,
  buildClientRecords,
  subscriptionTone,
  applySubscriptionExtension,
  resolveBonusDays,
  pickLatestSubscriptionExtension,
  SUBSCRIPTION_STATUS_OPTIONS,
} from './dbHelpers.js';
import { EditIcon, CheckIcon, TrashIcon, RefreshIcon } from './dbIcons.jsx';
import { ProofField } from './ProofField.jsx';
import { SubscriptionDetail } from './subs/SubscriptionDetail.jsx';
import { ClientDetail } from './clients/ClientDetail.jsx';
// Subscription feature code now lives in src/features/subscriptions.
// SubscriptionsPage (the /subs route) moved out entirely; the symbols
// below are still consumed by the /db Subs import/edit flows that
// remain in this file, so they are imported back here.
import { SUBS_IMPORT_SERVICE_ALIASES } from '../../features/subscriptions/subscriptionConstants.js';
import {
  addDays,
  loadTesseract,
  parseOcrText,
} from '../../features/subscriptions/subscriptionUtils.js';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function PageChrome() {
  // Removed: legacy /admin dashboard chrome. /db is now the workspace home;
  // /l, /subs migrated to WorkspacePanels. Kept as a placeholder to
  // preserve historical export shape during cleanup but no longer rendered.
  return null;
}

function ToolCard({ tool }) {
  return (
    <a className="tool-card" href={tool.href}>
      <span>{tool.eyebrow}</span>
      <strong>{tool.title}</strong>
      <p>{tool.body}</p>
      <em>Open</em>
    </a>
  );
}

export function AdminDashboard() {
  // /admin route removed; _redirects sends /admin → /db/. This export is
  // retained as a no-op fallback so any stray import resolves cleanly.
  return null;
}

function ListRow({ title, meta, amount }) {
  return (
    <article className="list-row">
      <div>
        <strong>{title || 'Untitled'}</strong>
        <span>{meta || 'No details yet'}</span>
      </div>
      {amount ? <b>{amount}</b> : null}
    </article>
  );
}

const TITLE_OPTIONS = ['Mr.', 'Ms.', 'Mrs.', 'Family'];

function ClientForm({ draft, onChange, onCancel, onSave, status }) {
  return (
    <form className="client-form" onSubmit={onSave}>
      <div className="client-form-grid">
        <label>Title
          <Combobox
            value={draft.title}
            options={TITLE_OPTIONS}
            placeholder="Title"
            ariaLabel="Client title"
            onChange={(value) => onChange({ ...draft, title: value })}
          />
        </label>
        <label>Name
          <input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="Client name" />
        </label>
      </div>
      <label>Contact
        <input value={draft.contact} onChange={(event) => onChange({ ...draft, contact: event.target.value })} placeholder="Instagram / phone / email" />
      </label>
      <div className="client-actions">
        <button className="primary-button" type="submit">Save Client</button>
        <button className="ghost-button compact" type="button" onClick={onCancel}>Cancel</button>
      </div>
      {status ? <p className="client-status">{status}</p> : null}
    </form>
  );
}

// Robust short-code resolver. Old delivery rows shipped with a
// variety of field names depending on which version of /l saved
// them: short_code/shortCode, short_url/shortUrl, short_link/
// shortLink, delivery_url, and per-link short_path on
// links[]/delivery_links[]. Worker /api/db now normalises most of
// these to short_code + short_url, but it still emits short_url
// "/" for legacy rows that have no short_code at all — that's the
// "https://sshots.pages.dev/" bug we fix here. Returns a 7- or
// 12-char lowercase code, or '' when none could be recovered.
function resolveDeliveryShortCode(delivery) {
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
function buildShortUrl(code) {
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
function synthesizeDeliveryMessageWa(title, clientName, folderName, eventDate, shortUrl, password, deliveryDone) {
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

With sincere appreciation, your StarShots delivery files have been prepared and are now ready for your kind attention.

Your *Delivery Files* and *Invoice* may be accessed through the details below:

*Folder:* ${f}
*Event Date:* ${ev}
*Link:* ${link}
*Password:* \`${pass}\`

Should you prefer a different password, please let us know and we will update it for you.

Kindly download the files within the stated availability period.

It has been our pleasure to serve you, and we look forward to welcoming you again.

Warm Regards,
StarShots ID`;
}

// Strip WhatsApp markdown markers (*bold*, _italic_, ~strike~,
// `mono`) so the Instagram DM is plain text with identical wording
// and order. Only the markers are removed, never the words.
function stripMessageFormatting(text) {
  return String(text || '').replace(/[*_~`]/g, '');
}

function synthesizeDeliveryMessageIg(title, clientName, folderName, eventDate, shortUrl, password, deliveryDone) {
  return stripMessageFormatting(synthesizeDeliveryMessageWa(title, clientName, folderName, eventDate, shortUrl, password, deliveryDone));
}

// Open-in-new-tab (external link) glyph for the short link card.
// Same 14x14 stroke-only family as RefreshIcon so the two right-edge
// card actions read as one icon set; picks up `currentColor` for the
// idle/hover palette from CSS.
function ExternalLinkIcon() {
  return (
    <svg
      className="btn-icon"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  );
}

function SaveIcon({ saving = false }) {
  return (
    <svg
      className={`btn-icon${saving ? ' is-saving' : ''}`}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 3h12l2 2v16H5z" />
      <path d="M8 3v6h8V3" />
      <path d="M8 21v-7h8v7" />
      <path d="M14 6h1" />
    </svg>
  );
}

function accessLogEventLabel(type = '', service = '') {
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

function accessLogDevice(userAgent = '') {
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

function accessLogPlace(log = {}) {
  return [log.city, log.country].map((item) => String(item || '').trim()).filter(Boolean).join(', ');
}

// ISP / network label, shown only when the log payload actually
// carries it (ASN/org/isp). The /db dashboard payload currently
// skips IP enrichment for speed, so this gracefully returns '' and
// the meta line simply omits the network rather than guessing.
function accessLogIsp(log = {}) {
  return String(log.isp || log.org || log.asn_org || '').trim();
}

// Mask an IP for the compact COLLAPSED subtitle so the card stays
// readable without leaking a full address at a glance. IPv4 keeps the
// first two octets ("103.109.xxx.xxx"); IPv6 keeps the first two
// hextets ("2404:c0:xxxx"). Expanded timeline rows still show the
// full IP for precise same-visitor / proxy correlation.
function maskIpAddress(ip = '') {
  const clean = String(ip || '').trim();
  if (!clean) return '';
  if (clean.includes(':')) {
    const head = clean.split(':').filter(Boolean).slice(0, 2).join(':');
    return head ? `${head}:xxxx` : clean;
  }
  const m = clean.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  return m ? `${m[1]}.${m[2]}.xxx.xxx` : clean;
}

function ipv4Octets(ip = '') {
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
function classifyAccessNetwork(log = {}) {
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
function isRealInAppBrowser(userAgent = '') {
  const ua = String(userAgent || '');
  if (!ua) return false;
  if (/facebookexternalhit|facebot|meta-externalagent/i.test(ua)) return false;
  return /Instagram|WhatsApp|FBAN|FBAV|FB_IAB|FBIOS|FB4A|\bLine\/|TikTok|musical_ly|Bytedance/i.test(ua);
}

// Generic crawler / link-preview scanner detection straight from the
// user-agent string. This complements classifyAccessNetwork (which
// works off IP/ASN ranges): a crawler hitting from an unrecognized IP
// would otherwise fall through to "Unknown". Returns a label key so
// the actor pill can read "Meta preview" / "WhatsApp preview" /
// "Crawler" without us ever blocking or dropping the log.
function crawlerUserAgentLabel(userAgent = '') {
  const ua = String(userAgent || '');
  if (!ua) return '';
  if (/facebookexternalhit|facebookcatalog|facebot|meta-externalagent/i.test(ua)) return 'Meta preview';
  if (/WhatsApp/i.test(ua) && !/Instagram|FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(ua) && /bot|preview|link/i.test(ua)) {
    return 'WhatsApp preview';
  }
  if (/\bbot\b|crawler|spider|crawl|preview|scrap|fetch|monitor|slurp|bingpreview|embedly|telegrambot|twitterbot|linkedinbot|discordbot|pinterest|googlebot|applebot/i.test(ua)) {
    return 'Crawler';
  }
  return '';
}

// Conservative actor classification for a grouped visitor/session.
// Strong human signals are an unlock (password_success) or a link
// click; a bare page view is weak. Known Meta infrastructure paired
// with a non-app (scanner/generic) UA reads as a preview, never as a
// confident client open.
//   { key, label } where label is one of:
//   "Likely Client" | "Meta Preview" | "Private Relay"
//   | "Proxy / Datacenter" | "Unknown"
function accessActorType(visitor = {}) {
  const rep = visitor.first || visitor.last || {};
  const net = classifyAccessNetwork(rep);
  const ua = rep.user_agent || visitor.last?.user_agent || '';
  const realApp = isRealInAppBrowser(ua);
  const types = new Set((visitor.events || []).map((e) => String(e.event_type || '').toLowerCase()));
  const strongSignal = types.has('password_success') || types.has('service_click') || types.has('button_click');
  if (net.key === 'meta' && !realApp) return { key: 'meta', label: 'Meta Preview' };
  if (net.key === 'apple_relay') return { key: 'relay', label: 'Private Relay' };
  if (net.key === 'cloudflare' || net.key === 'google' || net.key === 'aws' || net.key === 'datacenter') {
    return { key: 'proxy', label: 'Proxy / Datacenter' };
  }
  // Generic crawler/preview detection from the UA. Only trusted when
  // the visitor showed no strong human signal (an unlock or a link
  // click), so a real person whose UA merely contains a noisy token
  // is never mislabeled as a bot.
  if (!strongSignal && !realApp) {
    const crawler = crawlerUserAgentLabel(ua);
    if (crawler === 'Meta preview') return { key: 'meta', label: 'Meta preview' };
    if (crawler === 'WhatsApp preview') return { key: 'meta', label: 'WhatsApp preview' };
    if (crawler === 'Crawler') return { key: 'proxy', label: 'Crawler' };
  }
  if (strongSignal) return { key: 'client', label: 'Likely Client' };
  return { key: 'unknown', label: 'Unknown' };
}

// Muted per-event provenance line for the expanded timeline:
// "IP \u00b7 ISP/org \u00b7 City \u00b7 Browser/App". Lets the operator tell a real
// repeat visitor (same IP + app) from a proxy/scanner hit that shares
// the same delivery. Empty parts (e.g. no known network) drop out.
function accessLogRowDetail(event = {}) {
  const ip = String(event.ip_address || '').trim();
  const net = classifyAccessNetwork(event);
  const place = accessLogPlace(event);
  const device = accessLogDevice(event.user_agent);
  return [ip, net.name, place, device].filter(Boolean).join(' \u00b7 ');
}

// Time-only clock (e.g. "10:03") for the summary's "Last activity"
// and the same-day visitor status — keeps the panel compact.
function formatAccessLogClock(value = '') {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Short day label (e.g. "04 Jun") so a visitor card always shows
// WHEN the access happened, not just the clock time.
function formatAccessLogDay(value = '') {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

// Full timeline stamp (e.g. "04 Jun 22:20") for an expanded
// timeline row: day + clock together.
function formatAccessLogStamp(value = '') {
  return [formatAccessLogDay(value), formatAccessLogClock(value)].filter(Boolean).join(' ');
}

// Opens vs clicks for the Access Timeline summary. Opens = public
// page opens / unlocks / invoice views. Clicks = service-link
// clicks only. Admin events never reach here — the worker strips
// admin_* and admin-paired page views from stats.logs before the
// dashboard payload is built.
const ACCESS_OPEN_TYPES = new Set(['page_view', 'password_success', 'invoice_view', 'invoice_fullscreen']);
const ACCESS_CLICK_TYPES = new Set(['service_click', 'button_click']);

function accessLogTimeValue(value) {
  const t = new Date(value || 0).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// One visitor = same IP + same browser/device/platform signature.
// Grouping on the friendly device string (rather than the raw UA)
// folds minor UA noise into a single person so we don't show three
// near-identical rows for one phone.
function accessLogVisitorKey(log = {}) {
  const ip = String(log.ip_address || '').trim().toLowerCase();
  const device = accessLogDevice(log.user_agent).toLowerCase();
  return `${ip}|${device}`;
}

// Collapse the flat public access log into one card per visitor,
// keeping each visitor's events in chronological order so a single
// person's "opened -> unlocked -> clicked" journey reads as one
// story instead of a wall of duplicate IP rows.
function groupAccessLogsByVisitor(logs = []) {
  const groups = new Map();
  for (const log of Array.isArray(logs) ? logs : []) {
    const key = accessLogVisitorKey(log);
    if (!groups.has(key)) {
      groups.set(key, { key, ip: String(log.ip_address || '').trim(), logs: [] });
    }
    groups.get(key).logs.push(log);
  }
  const visitors = [...groups.values()].map((group) => {
    const events = [...group.logs].sort(
      (a, b) => accessLogTimeValue(a.created_at) - accessLogTimeValue(b.created_at)
    );
    const first = events[0] || {};
    const last = events[events.length - 1] || {};
    return {
      key: group.key,
      ip: group.ip,
      events,
      first,
      last,
      place: accessLogPlace(first) || accessLogPlace(last),
      device: accessLogDevice(first.user_agent) || accessLogDevice(last.user_agent),
      isp: accessLogIsp(first) || accessLogIsp(last),
    };
  });
  // Newest activity first: the visitor/session whose most-recent
  // event is the latest floats to the top, so the operator sees the
  // freshest session at a glance instead of scrolling past old ones.
  visitors.sort((a, b) => accessLogTimeValue(b.last.created_at) - accessLogTimeValue(a.last.created_at));
  return visitors;
}

function summarizeAccessLogs(logs = []) {
  let opens = 0;
  let clicks = 0;
  let last = 0;
  for (const log of Array.isArray(logs) ? logs : []) {
    const type = String(log.event_type || '').toLowerCase();
    if (ACCESS_OPEN_TYPES.has(type)) opens += 1;
    else if (ACCESS_CLICK_TYPES.has(type)) clicks += 1;
    const ts = accessLogTimeValue(log.created_at);
    if (ts > last) last = ts;
  }
  return {
    opens,
    clicks,
    lastActivity: last ? formatAccessLogClock(new Date(last).toISOString()) : '',
  };
}

function pluralCount(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// Distinct, meaningful actions for a visitor card's one-line
// summary. Plain "Page Opened" is implied by the card existing, so
// it's dropped here; unlocks, wrong passwords, link clicks and
// invoice actions are what the operator actually scans for.
function visitorActionSummary(events = []) {
  const seen = new Set();
  const out = [];
  for (const event of Array.isArray(events) ? events : []) {
    const type = String(event.event_type || '').toLowerCase();
    if (type === 'page_view') continue;
    const label = accessLogEventLabel(event.event_type, event.service);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

// One grouped visitor card. The headline prefers the ISP/org/network
// name when the payload carries it (e.g. "Telkomsel" / "Meta") and
// otherwise falls back to the device/app (e.g. "Safari iOS" /
// "WhatsApp Browser"); the supporting line carries place / app / IP,
// and a compact date-time status shows when the visit happened. The
// WHOLE card is the tap target: clicking or pressing Enter/Space
// toggles an inline timeline (newest-to-oldest). The right edge
// carries only a subtle clear (X) control — no expand arrow.
function visitorWhenLabel(visitor = {}) {
  const first = visitor.first || {};
  const last = visitor.last || {};
  const fDay = formatAccessLogDay(first.created_at);
  const fClock = formatAccessLogClock(first.created_at);
  const lDay = formatAccessLogDay(last.created_at);
  const lClock = formatAccessLogClock(last.created_at);
  if (!fDay && !fClock) return '';
  const singleMoment = (visitor.events?.length || 0) <= 1
    || accessLogTimeValue(first.created_at) === accessLogTimeValue(last.created_at);
  // Single event -> "04 Jun \u00b7 22:48".
  if (singleMoment) {
    return [fDay, fClock].filter(Boolean).join(' \u00b7 ');
  }
  // Same day span -> "04 Jun \u00b7 22:20-22:50".
  if (fDay === lDay) {
    const range = [fClock, lClock].filter(Boolean).join('-');
    return [fDay, range].filter(Boolean).join(' \u00b7 ');
  }
  // Across days -> "04 Jun 22:48 - 05 Jun 00:10".
  const start = [fDay, fClock].filter(Boolean).join(' ');
  const end = [lDay, lClock].filter(Boolean).join(' ');
  return [start, end].filter(Boolean).join(' - ');
}

function AccessLogVisitorCard({ visitor, onRequestDelete }) {
  const [open, setOpen] = useState(false);
  const actions = visitorActionSummary(visitor.events);
  const device = visitor.device;
  const rep = visitor.first || visitor.last || {};
  const network = classifyAccessNetwork(rep);
  const actor = accessActorType(visitor);
  const realApp = isRealInAppBrowser(rep.user_agent || visitor.last?.user_agent || '');
  // Title identity, in priority order:
  //   1. Meta link-preview/scanner  -> "Meta Preview" (never counted
  //      as a real in-app open).
  //   2. A GENUINE in-app browser   -> the app label ("Instagram
  //      Browser" / "WhatsApp Browser") even if it rode a Meta IP.
  //   3. A known ISP / network owner-> that name ("Telkomsel",
  //      "Cloudflare / Proxy", "Apple Private Relay", ...).
  //   4. Otherwise                  -> the device/browser label.
  let headline;
  if (actor.key === 'meta') headline = actor.label || 'Meta Preview';
  else if (actor.key === 'proxy' && actor.label === 'Crawler') headline = 'Crawler';
  else if (realApp && device) headline = device;
  else headline = network.name || device || 'Unknown device';
  // Supporting line is always "City, Country \u00b7 Browser/App \u00b7 IP"
  // (IP masked here; full IP lives in the expanded rows). Keeping the
  // browser/app here even when it is also the title gives the operator
  // a consistent, scannable identity strip on every card.
  const support = [visitor.place, device, maskIpAddress(visitor.ip)]
    .filter(Boolean)
    .join(' \u00b7 ');
  const whenLabel = visitorWhenLabel(visitor);
  // Expanded timeline reads newest-to-oldest to stay consistent with
  // the newest-first card ordering (events are stored chronological,
  // so reverse a copy here for display).
  const timelineRows = [...visitor.events].reverse();
  const toggle = () => setOpen((cur) => !cur);
  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      toggle();
    }
  };
  return (
    <article
      className={`dd-visitor-card${open ? ' is-open' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={toggle}
      onKeyDown={handleKeyDown}
    >
      {/* Summary row: the stacked text block on the left, and the
          clear (X) control on the right. align-items:center on the
          row keeps the X vertically centered against the WHOLE
          summary block (title + meta + when + actions), not just the
          title line — and it stays out of the expanded timeline. */}
      <div className="dd-visitor-head">
        <div className="dd-visitor-info">
          <div className="dd-visitor-titleline">
            <strong className="dd-visitor-name">{headline}</strong>
            {actor.label ? (
              <span className={`dd-visitor-pill is-${actor.key}`}>{actor.label}</span>
            ) : null}
          </div>
          {support ? <p className="dd-visitor-meta">{support}</p> : null}
          {whenLabel ? <p className="dd-visitor-when">{whenLabel}</p> : null}
          {actions.length ? <p className="dd-visitor-actions">{actions.join(' \u00b7 ')}</p> : null}
        </div>
        {/* Per-card clear: removes ONLY this visitor/session's log
            rows, immediately (no confirm). stopPropagation on click +
            Enter/Space keeps the whole-card expand/collapse gesture
            from also firing. No separate expand arrow. */}
        <button
          type="button"
          className="dd-visitor-delete"
          onClick={(event) => {
            event.stopPropagation();
            onRequestDelete?.();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
              event.stopPropagation();
            }
          }}
          title="Clear this log"
          aria-label="Clear this log"
        >
          <DeleteIcon />
        </button>
      </div>
      {open ? (
        <ol className="dd-visitor-timeline">
          {timelineRows.map((event, i) => {
            const type = String(event.event_type || '').toLowerCase();
            const strong = type === 'password_success' || type === 'service_click' || type === 'button_click';
            const weak = type === 'page_view';
            const detail = accessLogRowDetail(event);
            return (
              <li
                className={`dd-visitor-row${strong ? ' is-strong' : ''}${weak ? ' is-weak' : ''}`}
                key={`${event.id || i}-${event.created_at || ''}`}
              >
                <span className="dd-visitor-rowhead">
                  <span className="dd-visitor-stamp">{formatAccessLogStamp(event.created_at) || '\u2014'}</span>
                  <span className="dd-visitor-dot" aria-hidden="true">{'\u00b7'}</span>
                  <span className="dd-visitor-event">{accessLogEventLabel(event.event_type, event.service)}</span>
                </span>
                {detail ? <span className="dd-visitor-detail">{detail}</span> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </article>
  );
}

// Admin-only delivery detail rendered in /db's right panel after
// clicking "View Links" on a saved client event. Shows the
// operator everything needed to re-share a delivery without
// hopping to the public /{shortcode} page or digging through the
// database: client greeting, folder/gallery name, plain password,
// the full short link, any original Google Drive / Dropbox /
// WeTransfer URLs that were stored when the
// delivery was composed, plus tap-to-copy/share controls and the
// stored WhatsApp/Instagram message templates.
//
// Tap behaviour:
//   • Short Link card  → copies URL to clipboard.
//   • Password card    → copies password to clipboard.
//   • Service cards    → opens the original GD/DB/WT/TN link.
//   • Copy WA / Copy IG → copies the displayed message variant.
//
// Source-of-truth fields come from /api/db's `items[]` payload
// (handleDbSearch in _worker.js). When the row is too old to
// carry a 12-char short_code, the panel offers an admin repair
// action instead of showing a broken root URL.
function DeliveryDetail({ delivery, onClose, onRepaired, onDeleted, onRefresh }) {
  const [currentDelivery, setCurrentDelivery] = useState(delivery || {});
  const [variant, setVariant] = useState('whatsapp');
  const [flash, setFlash] = useState('');
  const [repairing, setRepairing] = useState(false);
  const [rotatingPassword, setRotatingPassword] = useState(false);
  const [editingLinks, setEditingLinks] = useState(false);
  const [linkDraft, setLinkDraft] = useState({});
  const [savingLinks, setSavingLinks] = useState(false);
  const [repairStatus, setRepairStatus] = useState('');
  // Refresh-in-flight flag for the detail-header Refresh button.
  // Refresh only re-pulls /api/db data (via onRefresh) and lets the
  // derived selectedDelivery rehydrate this panel — it never rotates
  // or regenerates the password.
  const [refreshing, setRefreshing] = useState(false);
  // Delete confirmation lives inside the detail panel only — the
  // left-panel client row and event-row X stay their existing
  // one-/two-tap controls. First click arms the Delete button (red
  // fill), a second click within ~4s issues the actual delete of
  // ONLY this delivery (links + access logs) via /api/db-delete —
  // the paired invoice on the same event row is untouched. Auto-
  // disarms on timeout or when the panel swaps to another delivery.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Mark-done toggle in-flight flag. The done state itself lives on
  // currentDelivery.delivery_done so it tracks the saved row and the
  // parent refetch; markingDone only gates the button while the
  // PATCH is resolving.
  const [markingDone, setMarkingDone] = useState(false);
  const [confirmRotatePassword, setConfirmRotatePassword] = useState(false);
  // Inline custom-password editor (pencil control on the password
  // card). editingPassword toggles the inline input; customPasswordValue
  // holds the in-flight value; passwordEditError surfaces client-side
  // validation before the request is sent.
  const [editingPassword, setEditingPassword] = useState(false);
  const [customPasswordValue, setCustomPasswordValue] = useState('');
  const [passwordEditError, setPasswordEditError] = useState('');
  // Per-card access-log clear in-flight gate. Clicking a visitor
  // card's X clears ONLY that session's log rows immediately (no
  // confirm dialog); deletingVisitor just prevents overlapping
  // requests while one delete is resolving.
  const [deletingVisitor, setDeletingVisitor] = useState(false);
  const noButtonRef = useRef(null);

  useEffect(() => {
    if (confirmRotatePassword && noButtonRef.current) {
      noButtonRef.current.focus();
    }
  }, [confirmRotatePassword]);

  useEffect(() => {
    if (!confirmRotatePassword) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') setConfirmRotatePassword(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [confirmRotatePassword]);

  // Hydrate the editable copy from the freshest delivery row the
  // parent hands down (selectedDelivery, derived from /api/db
  // data.items). Runs whenever that row changes — including after a
  // Refresh or a password regenerate refetch — so the open panel
  // never holds stale data and never needs a close/reopen. Guard:
  // a blank incoming password never overwrites a non-empty password
  // we already hold, so a transient empty row from /api/db (or a
  // refetch landing a tick before the repair write is visible) can't
  // blank a known-good password.
  useEffect(() => {
    const incoming = delivery || {};
    setCurrentDelivery((prev) => {
      const sameRow = String(prev?.id || '') === String(incoming.id || '');
      const incomingPwd = String(incoming.password || '').trim();
      const prevPwd = String(prev?.password || '').trim();
      if (sameRow && !incomingPwd && prevPwd) {
        return { ...incoming, password: prev.password };
      }
      return incoming;
    });
  }, [delivery]);

  // Reset transient panel UI only when the parent swaps to a
  // DIFFERENT delivery, so a same-row Refresh/regenerate keeps the
  // current status line (e.g. "Delivery refreshed.") and any open
  // editor instead of flickering them away on every data update.
  useEffect(() => {
    setRepairStatus('');
    setConfirmDelete(false);
    setConfirmRotatePassword(false);
    setEditingPassword(false);
    setCustomPasswordValue('');
    setPasswordEditError('');
  }, [delivery?.id]);

  // Auto-disarm the Delete confirm after ~4s so an accidental first
  // click never sits in a hot state.
  useEffect(() => {
    if (!confirmDelete) return undefined;
    const id = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(id);
  }, [confirmDelete]);

  const title = String(currentDelivery?.title ?? 'Ms.').trim() ?? 'Ms.';
  const clientName = String(currentDelivery?.client_name || 'Client').trim() || 'Client';
  const folder =
    String(currentDelivery?.folder_name || '').trim() ||
    String(currentDelivery?.gallery_code || '').trim() ||
    String(currentDelivery?.base_slug || '').trim();
  const password = String(currentDelivery?.password || '').trim();

  const shortCode = resolveDeliveryShortCode(currentDelivery);
  const shortUrl = buildShortUrl(shortCode);
  // Display-only label for the short link card. Strip the protocol
  // so a 12-char URL fits on one line at smaller widths.
  const shortDisplay = shortUrl.replace(/^https?:\/\//, '');

  const linkRows = Array.isArray(currentDelivery?.links) ? currentDelivery.links : [];
  const byService = new Map();
  for (const link of linkRows) {
    const service = String(link?.service || '').toLowerCase();
    const url = String(link?.original_url || '').trim();
    if (service && url && !byService.has(service)) {
      byService.set(service, url);
    }
  }
  // Display order matches the public delivery page service grid.
  const SERVICE_LABELS = [
    { key: 'gd', label: 'Google Drive' },
    { key: 'db', label: 'Dropbox' },
    { key: 'wt', label: 'WeTransfer' },
  ];
  const services = SERVICE_LABELS
    .filter(({ key }) => byService.has(key))
    .map((s) => ({
      ...s,
      url: byService.get(s.key),
    }));

  useEffect(() => {
    const next = {};
    for (const { key } of SERVICE_LABELS) {
      next[key] = byService.get(key) || '';
    }
    // Folder Name shares the same draft so a single Save Links
    // submission can ship both link rebuilds and a folder_name
    // PATCH in one request.
    next.folderName = String(currentDelivery?.folder_name || '').trim();
    next.eventDate = plainEventDate(currentDelivery?.event_date);
    setLinkDraft(next);
  }, [currentDelivery]);

  // Both WA and IG are synthesised from the CURRENT delivery fields
  // at display/copy time, so older saved rows (which may carry a
  // Folder line or stale formatting in generated_text_*) never leak
  // to the client. WA keeps markdown; IG is the same text stripped.
  const deliveryDone = !!currentDelivery?.delivery_done;
  const synthWa = synthesizeDeliveryMessageWa(title, clientName, folder, currentDelivery?.event_date, shortUrl, password, deliveryDone);
  const synthIg = synthesizeDeliveryMessageIg(title, clientName, folder, currentDelivery?.event_date, shortUrl, password, deliveryDone);
  const messageWa = synthWa;
  const messageIg = synthIg;

  const accessLogs = Array.isArray(currentDelivery?.stats?.logs)
    ? currentDelivery.stats.logs
    : [];
  // Group the flat public log into per-visitor cards and derive the
  // compact summary header (visitors / opens / clicks / last
  // activity). Memoised so re-renders from unrelated state (copy
  // flashes, variant toggles) don't re-walk the log array.
  const accessVisitors = useMemo(() => groupAccessLogsByVisitor(accessLogs), [accessLogs]);
  const accessStats = useMemo(() => summarizeAccessLogs(accessLogs), [accessLogs]);
  // Compact header summary. Always rendered (even at zero) so the
  // header reads "0 visitors \u00b7 0 opens \u00b7 0 clicks" both on a
  // delivery with no public activity yet AND immediately after the
  // operator deletes the logs. Last activity is appended only when
  // there is real public activity to point at.
  const accessSummaryText = [
        pluralCount(accessVisitors.length, 'visitor'),
        pluralCount(accessStats.opens, 'open'),
        pluralCount(accessStats.clicks, 'click'),
        accessStats.lastActivity ? `Last activity ${accessStats.lastActivity}` : '',
      ].filter(Boolean).join(' \u00b7 ');

  const flashTarget = (target) => {
    setFlash(target);
    setTimeout(() => setFlash((cur) => (cur === target ? '' : cur)), 700);
  };

  const messageText = variant === 'instagram' ? messageIg : messageWa;
  const hasAnyDetail = !!password || !!shortUrl || services.length > 0;

  async function handleShortLinkClick() {
    if (!shortUrl) return;
    await copyToClipboard(shortUrl);
    flashTarget('short');
  }
  async function handlePasswordClick() {
    if (!password) return;
    await copyToClipboard(password);
    flashTarget('pass');
  }
  async function handleCopyMessage(which) {
    const text = which === 'instagram' ? messageIg : messageWa;
    if (!text) return;
    await copyToClipboard(text);
    flashTarget(`msg-${which}`);
  }
  // Refresh ONLY: re-pull fresh /api/db data via the parent and let
  // the derived selectedDelivery rehydrate this open panel in place.
  // It never rotates/regenerates the password and never edits links
  // — if the password is still missing afterwards, the existing
  // "Generate Secure Password" action remains the repair path.
  async function handleRefresh() {
    if (refreshing || !currentDelivery?.id) return;
    setRefreshing(true);
    setRepairStatus('Refreshing\u2026');
    try {
      await onRefresh?.();
      setRepairStatus('Delivery refreshed.');
    } catch (error) {
      setRepairStatus(error?.message || 'Refresh failed.');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleRepairDelivery(options = {}) {
    if (!currentDelivery?.id) return;
    const rotatePassword = Boolean(options.rotatePassword);
    const customPassword = typeof options.customPassword === 'string' ? options.customPassword.trim() : '';
    if (rotatePassword || customPassword) setRotatingPassword(true);
    else setRepairing(true);
    setRepairStatus('');
    try {
      const response = await fetch('/api/db-repair-delivery', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: currentDelivery.id,
          rotatePassword,
          ...(customPassword ? { customPassword } : {}),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(json.error || `Repair failed (${response.status}).`);
      }
      const repaired = {
        ...currentDelivery,
        ...(json.delivery || {}),
        password: json.password || json.delivery?.password || currentDelivery.password || '',
        short_code: json.shortCode || json.delivery?.short_code || currentDelivery.short_code || '',
        short_url: json.shortUrl || json.delivery?.short_url || '',
        delivery_url: json.shortUrl || json.delivery?.delivery_url || '',
        generated_text_whatsapp: json.generatedText || json.delivery?.generated_text_whatsapp || currentDelivery.generated_text_whatsapp || '',
        generated_text_instagram: json.delivery?.generated_text_instagram || json.generatedText || currentDelivery.generated_text_instagram || '',
        needs_secure_repair: false,
      };
      setCurrentDelivery(repaired);
      if (customPassword) {
        setEditingPassword(false);
        setCustomPasswordValue('');
        setPasswordEditError('');
      }
      setRepairStatus(
        customPassword
          ? 'Custom password saved.'
          : (rotatePassword ? 'Password regenerated and hashed.' : 'Secure short link repaired.')
      );
      onRepaired?.(repaired);
    } catch (error) {
      setRepairStatus(error?.message || 'Repair failed.');
    } finally {
      setRepairing(false);
      setRotatingPassword(false);
    }
  }

  // Open the inline custom-password editor, seeding it with the
  // current password so a small tweak is a one-character edit.
  function startEditPassword() {
    setCustomPasswordValue(password);
    setPasswordEditError('');
    setEditingPassword(true);
  }

  function cancelEditPassword() {
    setEditingPassword(false);
    setCustomPasswordValue('');
    setPasswordEditError('');
  }

  // Validate then submit a custom password. Mirrors the worker's
  // bounds (trim, non-empty, <= 72 chars) so the operator gets
  // immediate feedback instead of a round-trip error.
  function submitCustomPassword() {
    const value = String(customPasswordValue || '').trim();
    if (!value) {
      setPasswordEditError('Password cannot be empty.');
      return;
    }
    if (value.length > 72) {
      setPasswordEditError('Use 72 characters or fewer.');
      return;
    }
    setPasswordEditError('');
    handleRepairDelivery({ customPassword: value });
  }

  async function handleSaveLinks(event) {
    event.preventDefault();
    if (!currentDelivery?.id) return;
    setSavingLinks(true);
    setRepairStatus('');
    try {
      const trimmedFolder = String(linkDraft.folderName || '').trim();
      const draftEventDate = String(linkDraft.eventDate || '').trim();
      const response = await fetch('/api/db-update-delivery', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: currentDelivery.id,
          // folderName is optional on the wire — when omitted the
          // worker leaves deliveries.folder_name untouched. We send
          // it whenever the operator left a non-empty value so a
          // rename takes effect without requiring fresh data.
          folderName: trimmedFolder,
          eventDate: /^\d{4}-\d{2}-\d{2}$/.test(draftEventDate) ? draftEventDate : '',
          links: SERVICE_LABELS.map(({ key }) => ({
            service: key,
            originalUrl: linkDraft[key] || '',
            link_done: !!currentDelivery?.delivery_done,
          })),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || `Save failed (${response.status}).`);
      const updated = {
        ...currentDelivery,
        ...(json.delivery || {}),
        links: Array.isArray(json.delivery?.links) ? json.delivery.links : currentDelivery.links,
      };
      setCurrentDelivery(updated);
      setEditingLinks(false);
      setRepairStatus('Delivery links updated.');
      onRepaired?.(updated);
    } catch (error) {
      setRepairStatus(error?.message || 'Save failed.');
    } finally {
      setSavingLinks(false);
    }
  }

  // Delete ONLY this delivery row (links + access logs) via the
  // existing /api/db-delete endpoint, which is keyed on the
  // delivery id and never touches the paired invoice. First click
  // arms the button; the second click within ~4s performs the
  // delete. On success we hand back to the parent client detail
  // (onDeleted -> back() + refetch) so the event row stays put when
  // an invoice still exists, now showing "Create Links" again.
  async function handleDeleteLinks() {
    if (!currentDelivery?.id || deleting) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setConfirmDelete(false);
    setDeleting(true);
    setRepairStatus('');
    try {
      const response = await fetch('/api/db-delete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentDelivery.id }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || `Delete failed (${response.status}).`);
      // Parent pops back to the client detail and refetches /api/db.
      onDeleted?.(currentDelivery);
    } catch (error) {
      setRepairStatus(error?.message || 'Delete failed.');
      setDeleting(false);
    }
  }

  // Permanently clear the access-log rows for ONE visitor/session
  // card via /api/db-clear-logs. Fires immediately on the card's X —
  // no confirm dialog, no native alert. We pass the explicit log ids
  // for that group; the worker scopes the delete to BOTH those ids AND
  // this delivery_id, so it can never touch another visitor card,
  // another delivery, or any invoice/client/subscription record. On
  // success we drop just those rows from the in-panel stats so the
  // card disappears and the summary counts recompute with no refetch.
  async function handleDeleteVisitor(target) {
    const logIds = (target?.events || []).map((event) => event.id).filter(Boolean);
    if (!currentDelivery?.id || !logIds.length) return;
    if (deletingVisitor) return;
    setDeletingVisitor(true);
    setRepairStatus('');
    try {
      const response = await fetch('/api/db-clear-logs', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentDelivery.id, logIds }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || `Delete failed (${response.status}).`);
      const removeSet = new Set(logIds);
      setCurrentDelivery((prev) => {
        const logs = Array.isArray(prev?.stats?.logs) ? prev.stats.logs : [];
        return { ...prev, stats: { ...(prev?.stats || {}), logs: logs.filter((log) => !removeSet.has(log.id)) } };
      });
    } catch (error) {
      setRepairStatus(error?.message || 'Delete failed.');
    } finally {
      setDeletingVisitor(false);
    }
  }

  // Toggle this delivery's completion flag via /api/db-update-delivery.
  // The worker mirrors the same state onto every existing delivery
  // link, so one top-level checkmark controls whether public links
  // show as CLICK or IN PROGRESS.
  async function handleToggleDone() {
    if (!currentDelivery?.id || markingDone) return;
    const nextDone = !currentDelivery.delivery_done;
    setMarkingDone(true);
    setRepairStatus('');
    try {
      const response = await fetch('/api/db-update-delivery', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentDelivery.id, deliveryDone: nextDone }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || `Update failed (${response.status}).`);
      const updated = {
        ...currentDelivery,
        ...(json.delivery || {}),
        delivery_done: json.delivery?.delivery_done ?? nextDone,
        links: Array.isArray(json.delivery?.links) ? json.delivery.links : currentDelivery.links,
      };
      setCurrentDelivery(updated);
      setRepairStatus(updated.delivery_done ? 'Delivery marked done.' : 'Delivery reopened.');
      // Refresh /db so the client event row reflects the new state.
      onRepaired?.(updated);
    } catch (error) {
      setRepairStatus(error?.message || 'Update failed.');
    } finally {
      setMarkingDone(false);
    }
  }


  return (
    <>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Delivery</p>
          <h2>Hello, {title} {clientName}</h2>
          {folder ? (
            <span className="dd-name-line">
              <span className="dd-folder-name">{folder}</span>
              <span className="dd-name-sep" aria-hidden="true">{'\u2022'}</span>
              <span
                className={`event-date-pill event-tone-${eventDateTone(currentDelivery?.event_date, jakartaTodayISO())} delivery-event-date-pill`}
                aria-label={`Event ${compactEventDateLabel(currentDelivery?.event_date)}`}
              >
                {compactEventDateLabel(currentDelivery?.event_date)}
              </span>
            </span>
          ) : (
            <span
              className={`event-date-pill event-tone-${eventDateTone(currentDelivery?.event_date, jakartaTodayISO())} delivery-event-date-pill`}
              aria-label={`Event ${compactEventDateLabel(currentDelivery?.event_date)}`}
            >
              {compactEventDateLabel(currentDelivery?.event_date)}
            </span>
          )}
        </div>
        <div className="dd-heading-side">
          <div className="detail-actions subs-detail-actions">
            <button
              type="button"
              className="toolbar-icon-btn"
              onClick={handleRefresh}
              disabled={refreshing || !currentDelivery?.id}
              aria-label="Refresh delivery detail"
              title="Refresh"
            >
              <RefreshIcon />
            </button>
            <button
              type="button"
              className={`toolbar-icon-btn delivery-done-button${deliveryDone ? ' is-complete' : ''}`}
              onClick={handleToggleDone}
              disabled={markingDone || !currentDelivery?.id}
              aria-pressed={deliveryDone}
              aria-label={deliveryDone ? 'Reopen delivery' : 'Mark delivery done'}
              title={deliveryDone ? 'Done \u2014 click to reopen' : 'Mark Done'}
            >
              <CheckIcon />
            </button>
            <button
              type="button"
              className="toolbar-icon-btn"
              onClick={() => setEditingLinks((value) => !value)}
              aria-pressed={editingLinks}
              aria-label="Edit links"
              title="Edit Links"
            >
              <EditIcon />
            </button>
            <button
              type="button"
              className={`ghost-button compact db-delete-button icon-button${confirmDelete ? ' armed' : ''}`}
              onClick={handleDeleteLinks}
              disabled={deleting || !currentDelivery?.id}
              aria-pressed={confirmDelete}
              aria-label={confirmDelete ? 'Confirm delete links' : 'Delete links'}
              title={confirmDelete ? 'Confirm Delete' : 'Delete'}
            >
              <TrashIcon />
              <span>{deleting ? 'Deleting\u2026' : (confirmDelete ? 'Confirm' : 'Delete')}</span>
            </button>
            <button
              type="button"
              className="db-close-button"
              onClick={onClose}
              aria-label="Close detail view"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      {!hasAnyDetail ? (
        <p className="empty-state">No delivery details available.</p>
      ) : (
        <div className="dd-stack">
          <div className="dd-grid-2">
            {shortUrl ? (
              /* Short link card: the tile body is a tap-to-copy
                 button (.dd-card-tap) and a dedicated icon-only
                 "open in new tab" anchor sits on the right edge —
                 same wrapper pattern as the password card so an
                 accidental tap on the body never triggers the open
                 action and vice versa. The wrapper div is non-
                 interactive; the inner button owns the copy tap. */
              <div
                className={`dd-card dd-card--shortlink${flash === 'short' ? ' is-flash' : ''}`}
                aria-label="Short link actions"
              >
                <button
                  type="button"
                  className="dd-card-tap"
                  onClick={handleShortLinkClick}
                  aria-label="Copy short link"
                >
                  <span className="dd-eyebrow">Short Link</span>
                  <strong className="dd-card-strong">{shortDisplay}</strong>
                  <span className="dd-card-hint">Tap to Copy</span>
                </button>
                <a
                  className="dd-icon-button dd-open-button"
                  href={shortUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  aria-label="Open short link in new tab"
                  title="Open in New Tab"
                >
                  <ExternalLinkIcon />
                </a>
              </div>
            ) : (
              <div className="dd-card dd-card--muted" aria-label="Legacy short link unavailable">
                <span className="dd-eyebrow">Short Link</span>
                <strong className="dd-card-strong dd-card-strong--muted">Legacy Link Unavailable</strong>
                <span className="dd-card-hint">No 12-char short code on this row.</span>
                {currentDelivery?.id ? (
                  <button
                    type="button"
                    className="ghost-button compact dd-repair-button"
                    onClick={() => handleRepairDelivery()}
                    disabled={repairing}
                  >
                    {repairing ? 'Repairing...' : 'Repair Secure Link'}
                  </button>
                ) : null}
                {repairStatus ? <span className="dd-card-hint">{repairStatus}</span> : null}
              </div>
            )}
            {password ? (
              /* Password card: the whole tile is a tap-to-copy
                 button. The regenerate action is a separate icon-
                 only refresh control absolutely positioned on the
                 right edge of the tile so an accidental tap on the
                 card body never rotates the password. The wrapper
                 div is non-interactive (the inner button owns the
                 tap target) which lets the refresh button live as
                 a sibling without nesting buttons. */
              <div
                className={`dd-card dd-card--password${flash === 'pass' ? ' is-flash' : ''}`}
                aria-label="Password actions"
              >
                {editingPassword ? (
                  <div className="dd-password-edit">
                    <span className="dd-eyebrow">Set Custom Password</span>
                    <input
                      type="text"
                      className="dd-password-input"
                      value={customPasswordValue}
                      onChange={(event) => setCustomPasswordValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') { event.preventDefault(); submitCustomPassword(); }
                        if (event.key === 'Escape') { event.preventDefault(); cancelEditPassword(); }
                      }}
                      placeholder="Enter a custom password"
                      aria-label="Custom password"
                      autoFocus
                      spellCheck="false"
                      autoComplete="off"
                    />
                    <div className="dd-password-edit-actions">
                      <button
                        type="button"
                        className="ghost-button compact"
                        onClick={submitCustomPassword}
                        disabled={rotatingPassword}
                      >
                        {rotatingPassword ? 'Saving\u2026' : 'Save'}
                      </button>
                      <button
                        type="button"
                        className="ghost-button compact"
                        onClick={cancelEditPassword}
                        disabled={rotatingPassword}
                      >
                        Cancel
                      </button>
                    </div>
                    {passwordEditError ? <span className="dd-card-hint">{passwordEditError}</span> : null}
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="dd-card-tap"
                      onClick={handlePasswordClick}
                      aria-label="Copy password to clipboard"
                    >
                      <span className="dd-eyebrow">Password</span>
                      <strong className="dd-card-strong">{password}</strong>
                      <span className="dd-card-hint">Tap to Copy</span>
                    </button>
                    <div className="dd-card-actions">
                      <button
                        type="button"
                        className="dd-icon-button dd-edit-button"
                        onClick={startEditPassword}
                        disabled={rotatingPassword}
                        aria-label="Set custom password"
                        title="Set Custom Password"
                      >
                        <EditIcon />
                      </button>
                      <button
                        type="button"
                        className="dd-icon-button dd-refresh-button"
                        onClick={() => setConfirmRotatePassword(true)}
                        disabled={rotatingPassword}
                        aria-label={rotatingPassword ? 'Regenerating Password' : 'Regenerate Password'}
                        title={rotatingPassword ? 'Regenerating Password' : 'Regenerate Password'}
                      >
                        <RefreshIcon />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="dd-card dd-card--muted" aria-label="No password">
                <span className="dd-eyebrow">Password</span>
                <strong className="dd-card-strong dd-card-strong--muted">&mdash;</strong>
                <span className="dd-card-hint">No password on this row.</span>
                {currentDelivery?.id ? (
                  <button
                    type="button"
                    className="ghost-button compact dd-repair-button"
                    onClick={() => handleRepairDelivery({ rotatePassword: true })}
                    disabled={rotatingPassword}
                  >
                    {rotatingPassword ? 'Regenerating...' : 'Generate Secure Password'}
                  </button>
                ) : null}
              </div>
            )}
            {confirmRotatePassword && (
              <div
                className="dd-confirm-overlay"
                style={{
                  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  zIndex: 9999,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '16px'
                }}
                onClick={() => setConfirmRotatePassword(false)}
              >
                <div
                  className="dd-confirm-modal"
                  style={{
                    backgroundColor: 'var(--bg, #fff)',
                    padding: '24px',
                    borderRadius: '16px',
                    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
                    minWidth: '280px',
                    maxWidth: '100%'
                  }}
                  onClick={(e) => e.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="confirm-title"
                >
                  <h3 id="confirm-title" style={{ margin: '0 0 24px', fontSize: '1.25rem', color: 'var(--ink)' }}>Change Password?</h3>
                  <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="ghost-button compact"
                      onClick={() => setConfirmRotatePassword(false)}
                      disabled={rotatingPassword}
                      ref={noButtonRef}
                    >
                      No
                    </button>
                    <button
                      type="button"
                      className="ghost-button compact"
                      style={{ color: 'var(--accent-2, red)', borderColor: 'var(--accent-2, red)' }}
                      onClick={() => {
                        setConfirmRotatePassword(false);
                        handleRepairDelivery({ rotatePassword: true });
                      }}
                      disabled={rotatingPassword}
                    >
                      Change
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {editingLinks ? (
            <form className="dd-link-editor" onSubmit={handleSaveLinks}>
              <p className="eyebrow">Edit Links</p>
              <div className="dd-link-fields">
                <label key="folderName">
                  <span>Folder Name</span>
                  <input
                    type="text"
                    value={linkDraft.folderName || ''}
                    onChange={(event) => setLinkDraft((draft) => ({ ...draft, folderName: event.target.value }))}
                    placeholder="e.g. 260524 Sahputra, Mr. ( Birthday )"
                  />
                </label>
                <label key="eventDate">
                  <span>Event Date</span>
                  <DateTimeField
                    value={linkDraft.eventDate || ''}
                    onChange={(value) => setLinkDraft((draft) => ({ ...draft, eventDate: value }))}
                    ariaLabel="Event date"
                  />
                </label>
                {SERVICE_LABELS.map(({ key, label }) => (
                  <div key={key} className="dd-link-field-row" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ color: 'var(--muted)', fontSize: '11px', fontWeight: 900 }}>{label}</span>
                    <input
                      type="url"
                      value={linkDraft[key] || ''}
                      onChange={(event) => setLinkDraft((draft) => ({ ...draft, [key]: event.target.value }))}
                      placeholder="https://..."
                    />
                  </div>
                ))}
              </div>
              <div className="dd-message-actions">
                <button type="submit" className="ghost-button compact" disabled={savingLinks}>
                  {savingLinks ? 'Saving...' : 'Save Links'}
                </button>
                <button type="button" className="ghost-button compact" onClick={() => setEditingLinks(false)}>
                  Cancel
                </button>
              </div>
              {repairStatus ? <span className="dd-card-hint">{repairStatus}</span> : null}
            </form>
          ) : services.length ? (
            <div className="dd-services">
              {services.map(({ key, label, url }) => (
                <a
                  key={key}
                  className="dd-card dd-card--action dd-service-card"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="dd-service-head">
                    <span className="dd-chip">{key.toUpperCase()}</span>
                    <span className="dd-service-label">{label}</span>
                  </span>
                  <span className="dd-service-url">{url}</span>
                </a>
              ))}
            </div>
          ) : null}

          <div className={`dd-message${(flash === 'msg-whatsapp' || flash === 'msg-instagram') ? ' is-flash' : ''}`}>
            <div className="dd-message-head">
              <p className="eyebrow">Message</p>
              <div className="dd-segmented" role="tablist" aria-label="Message variant">
                <button
                  type="button"
                  role="tab"
                  aria-selected={variant === 'whatsapp'}
                  className={variant === 'whatsapp' ? 'active' : ''}
                  onClick={() => setVariant('whatsapp')}
                >
                  WhatsApp
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={variant === 'instagram'}
                  className={variant === 'instagram' ? 'active' : ''}
                  onClick={() => setVariant('instagram')}
                >
                  Instagram
                </button>
              </div>
            </div>
            <textarea
              className="dd-message-output"
              value={messageText}
              readOnly
              spellCheck="false"
            />
            <div className="dd-message-actions">
              <button
                type="button"
                className={`ghost-button compact${flash === 'msg-whatsapp' ? ' is-flash' : ''}`}
                onClick={() => handleCopyMessage('whatsapp')}
              >
                Copy WA
              </button>
              <button
                type="button"
                className={`ghost-button compact${flash === 'msg-instagram' ? ' is-flash' : ''}`}
                onClick={() => handleCopyMessage('instagram')}
              >
                Copy IG
              </button>
            </div>
          </div>

          <section className="dd-access-log" aria-label="Delivery access activity">
            <div className="dd-access-log-head">
              <p className="eyebrow">Access Activity</p>
              {accessSummaryText ? <span>{accessSummaryText}</span> : null}
            </div>
            {accessVisitors.length ? (
              <div className="dd-visitor-list">
                {accessVisitors.map((visitor, index) => (
                  <AccessLogVisitorCard
                    key={visitor.key || index}
                    visitor={visitor}
                    onRequestDelete={() => handleDeleteVisitor(visitor)}
                  />
                ))}
              </div>
            ) : (
              <p className="dd-access-log-empty">No activity yet.</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}

// Polished drag-and-drop upload zone used by SubscriptionImport.
// Wraps a visually-hidden <input type="file"> so the same control
// handles three input modes:
//   • click anywhere on the zone       → opens the file picker
//   • drag a file over the zone        → highlights drop target
//   • drop a file onto the zone        → handed to onFile(File)
// The native input also stays keyboard-focusable: pressing Enter
// or Space while focused opens the picker, matching link/button
// affordances. The dragCounter ref is what keeps the highlight
// stable when the pointer crosses child elements (each enter/leave
// nests, and naive boolean state would flicker).
function SubsImportDropZone({ busy, fileName, onFile }) {
  const inputRef = useRef(null);
  const dragCounter = useRef(0);
  const [dragActive, setDragActive] = useState(false);

  function pickFile() {
    if (busy) return;
    inputRef.current?.click();
  }

  function onKeyDown(event) {
    if (busy) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pickFile();
    }
  }

  function onChange(event) {
    const file = event.target?.files?.[0];
    if (file) onFile(file);
    // Reset so re-selecting the same file fires another change.
    if (event.target) event.target.value = '';
  }

  function onDragEnter(event) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    dragCounter.current += 1;
    if (event.dataTransfer?.items?.length) setDragActive(true);
  }

  function onDragOver(event) {
    // Required to make the element a valid drop target — without
    // this the browser cancels the drop before our handler runs.
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  function onDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragActive(false);
  }

  function onDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current = 0;
    setDragActive(false);
    if (busy) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) onFile(file);
  }

  const stateClass = busy
    ? ' subs-drop--busy'
    : dragActive
      ? ' subs-drop--active'
      : '';

  return (
    <div className="subs-drop-wrap">
      <span className="qr-upload-label">Receipt JPG</span>
      <div
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-disabled={busy}
        aria-label="Drop a StarShots receipt JPG here, or click to browse"
        className={`subs-drop${stateClass}`}
        onClick={pickFile}
        onKeyDown={onKeyDown}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onChange}
          disabled={busy}
          tabIndex={-1}
          aria-hidden="true"
        />
        <svg className="subs-drop-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M12 16V4m0 0l-4 4m4-4l4 4M5 20h14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <strong className="subs-drop-title">
          {busy
            ? 'Reading image\u2026'
            : dragActive
              ? 'Drop to extract fields'
              : 'Drop a StarShots receipt here'}
        </strong>
        <span className="subs-drop-hint">
          {fileName
            ? fileName
            : 'or click to browse \u00b7 JPG, PNG, or WebP'}
        </span>
      </div>
    </div>
  );
}

function completeImportTime(value) {
  const match = String(value || '').trim().replace(/\./g, ':').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return '';
  return `${match[1].padStart(2, '0')}:${match[2]}:${match[3] || '00'}`;
}

function normalizeImportService(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const found = SUBS_IMPORT_SERVICE_ALIASES.find((item) => item.pattern.test(normalized));
  return found ? found.label : toTitleCase(normalized);
}

function parseImportFilename(fileName = '') {
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
  let serviceRaw = '';
  let clientRaw = '';
  const aliases = SUBS_IMPORT_SERVICE_ALIASES.flatMap((item) => item.aliases.map((alias) => ({ alias, label: item.label })));
  const found = aliases
    .sort((a, b) => b.alias.length - a.alias.length)
    .find(({ alias }) => tail === alias || tail.startsWith(`${alias}-`));
  if (found) {
    serviceRaw = found.label;
    clientRaw = tail.slice(found.alias.length).replace(/^-+/, '');
  } else {
    const pieces = tail.split('-').filter(Boolean);
    serviceRaw = pieces.shift() || '';
    clientRaw = pieces.join(' ');
  }
  const titleMatch = clientRaw.match(/^(mr|ms|mrs|family)-(.+)$/i);
  return {
    client_title: titleMatch
      ? (titleMatch[1].toLowerCase() === 'mrs' ? 'Mrs.' : titleMatch[1].toLowerCase() === 'ms' ? 'Ms.' : titleMatch[1].toLowerCase() === 'family' ? 'Family' : 'Mr.')
      : '',
    client_name: toTitleCase((titleMatch ? titleMatch[2] : clientRaw).replace(/[-_]+/g, ' ')),
    service: normalizeImportService(serviceRaw),
    status,
  };
}

function parseReceiptGreeting(text = '') {
  const match = String(text || '').match(/Hello,\s*(?:(Mr\.?|Ms\.?|Mrs\.?|Family)\s+)?([A-Za-z][A-Za-z0-9 .'-]{1,80})!?/i);
  if (!match) return {};
  const rawTitle = String(match[1] || '').trim();
  const clientTitle = /^mrs\.?$/i.test(rawTitle)
    ? 'Mrs.'
    : /^ms\.?$/i.test(rawTitle)
      ? 'Ms.'
      : /^family$/i.test(rawTitle)
        ? 'Family'
        : rawTitle
          ? 'Mr.'
          : '';
  return {
    client_title: clientTitle,
    client_name: toTitleCase(String(match[2] || '').trim()),
  };
}

function mergeImportParsed(...sources) {
  return sources.reduce((merged, source) => {
    Object.entries(source || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== '') merged[key] = value;
    });
    return merged;
  }, {});
}

function hasUsefulImport(parsed = {}) {
  return !!(
    parsed.client_name ||
    parsed.service ||
    parsed.payment_date ||
    parsed.start_date ||
    parsed.expiry_date
  );
}

function missingCoreImportFields(parsed = {}) {
  return !parsed.client_name || !parsed.service || !parsed.payment_date || !parsed.start_date || !parsed.expiry_date;
}

async function extractSubscriptionReceiptInBrowser(file, setStatus) {
  const filenameParsed = parseImportFilename(file?.name || '');
  try {
    setStatus?.('Server could not read it. Trying browser OCR...');
    const Tesseract = await loadTesseract();
    setStatus?.('Reading receipt text...');
    let data;
    if (typeof Tesseract.recognize === 'function') {
      const result = await Tesseract.recognize(file, 'eng');
      data = result?.data || {};
    } else {
      const worker = await Tesseract.createWorker();
      const result = await worker.recognize(file);
      data = result?.data || {};
      await worker.terminate();
    }
    const text = String(data?.text || '');
    const extracted = parseOcrText(text);
    const parsed = mergeImportParsed(filenameParsed, {
      ...parseReceiptGreeting(text),
      service: normalizeImportService(extracted.service || filenameParsed.service),
      status: extracted.status || filenameParsed.status,
      payment_date: extracted.paymentDate,
      payment_time: completeImportTime(extracted.paymentTime),
      access_period: extracted.accessPeriod,
      start_date: extracted.startDate,
      start_time: completeImportTime(extracted.startTime),
      expiry_date: extracted.expiryDate,
      expiry_time: completeImportTime(extracted.expiryTime),
      price: extracted.paidAmount,
    });
    return {
      parsed,
      confidence: Number(data?.confidence || 0),
      usedBrowserOcr: true,
    };
  } catch (error) {
    console.warn('[subs-import] browser OCR failed:', error);
    return {
      parsed: filenameParsed,
      confidence: 0,
      usedBrowserOcr: false,
      error,
    };
  }
}

// Right-panel "Import JPG" flow for /db Subs. Step 1 is a file
// picker; step 2 is the editable preview that shows extracted
// fields and lets the operator correct anything before Save.
//
// On Save we POST to /api/subscriptions-save with the matched
// existing-subscription id (when present) so the row is updated
// rather than duplicated for the same client+service+payment+start.
//
// Failure is graceful: if the server returns ok:false (or the
// vision provider is unavailable), the form opens with empty
// fields so the operator can type the receipt manually. The
// uploaded image is never stored — the request body is consumed
// once and dropped on the server.
// Initial draft for the JPG importer. Defined at module scope so
// the post-save reset path can reuse the exact same shape that
// Shared field-update helper for the subscription draft (used by
// both SubscriptionEdit and SubscriptionImport). Mirrors the auto-
// sync expiry behaviour of setExtensionField above so the two
// surfaces respond identically when the operator types into Start /
// Access Period / Bonus:
//   • expiry = start + accessPeriodDays + bonusDays
//   • the next period/bonus/start edit intentionally overwrites any
//     previous expiry value
//   • expiry_time tracks start_time when start_time changes.
// Pure function so the component-level setField wrappers stay tiny
// and the rule lives in one place.
function applySubscriptionDraftUpdate(current, key, value) {
  const next = { ...current, [key]: value };
  // Req2: until the operator manually customizes Start, it mirrors the
  // Payment date/time. A manual Start edit latches `start_customized`
  // so subsequent Payment edits stop moving Start. Clearing Payment
  // (to '') while still following also clears the mirrored Start.
  if (key === 'start_date' || key === 'start_time') {
    next.start_customized = true;
  }
  const followingPayment = !current.start_customized
    && (key === 'payment_date' || key === 'payment_time');
  if (followingPayment) {
    if (key === 'payment_date') next.start_date = value;
    if (key === 'payment_time') next.start_time = value;
  }
  if (key === 'start_date' || key === 'access_period' || key === 'bonus'
    || (followingPayment && key === 'payment_date')) {
    const nextPeriod = Number(next.access_period) || 0;
    const nextBonus = Number(next.bonus) || 0;
    const nextStart = next.start_date || '';
    const totalDays = nextPeriod + nextBonus;
    if (nextStart && totalDays > 0) {
      const computed = addDays(nextStart, totalDays);
      if (computed) next.expiry_date = computed;
    }
  }
  if (key === 'start_time' || (followingPayment && key === 'payment_time')) {
    next.expiry_time = next.start_time;
  }
  return next;
}

// useState() seeds on mount — keeps "ready for next receipt" and
// "first open" visually identical.
const INITIAL_SUBS_IMPORT_DRAFT = {
  client_title: 'Mr.',
  client_name: '',
  client_contact: '',
  service: '',
  storage_slot: '',
  rate_mode: 'normal',
  price: 0,
  status: 'paid',
  invoice_date: '',
  payment_date: '',
  payment_time: '',
  access_period: 30,
  bonus: 0,
  start_date: '',
  start_time: '',
  expiry_date: '',
  expiry_time: '',
  payment_proof: '',
  notes: '',
  start_customized: false,
};

function SubscriptionImport({ onSaved, onCancel }) {
  const [stage, setStage] = useState('upload'); // 'upload' | 'edit'
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState('');
  const [existingId, setExistingId] = useState('');
  const [fileName, setFileName] = useState('');
  // All date/time fields start blank. The spec is explicit: do NOT
  // default to today when extraction fails — leave them empty so the
  // operator visibly sees what wasn't read instead of silently
  // saving "today" for a receipt the OCR never matched.
  const [draft, setDraft] = useState(INITIAL_SUBS_IMPORT_DRAFT);

  function setField(key, value) {
    setDraft((current) => applySubscriptionDraftUpdate(current, key, value));
  }

  // Merge server-parsed fields into the draft. Empty/null values
  // fall back to the current draft so a partial extraction still
  // leaves any defaults the operator already saw.
  function applyParsed(parsed = {}) {
    // Resolve the price field across the aliases the server prompt
    // and any local OCR fallback might use. Subs only has a single
    // `price` column on disk, but the parser shape isn't a hard
    // contract — keep this lenient so a Rp 50.000 on the receipt
    // lands in the draft regardless of which key the JSON used.
    const parsedPriceCandidates = [
      parsed.price,
      parsed.paid_amount,
      parsed.paidAmount,
      parsed.amount,
      parsed.total,
    ];
    let parsedPrice = NaN;
    for (const candidate of parsedPriceCandidates) {
      if (candidate === undefined || candidate === null || candidate === '') continue;
      const digits = String(candidate).replace(/[^0-9]/g, '');
      if (!digits) continue;
      const num = Number(digits);
      if (Number.isFinite(num) && num > 0) { parsedPrice = num; break; }
    }
    setDraft((current) => ({
      ...current,
      client_title: parsed.client_title || current.client_title,
      client_name: parsed.client_name || current.client_name,
      client_contact: parsed.client_contact || current.client_contact,
      service: parsed.service || current.service,
      storage_slot: parsed.storage_slot || current.storage_slot,
      rate_mode: parsed.rate_mode || current.rate_mode,
      price: Number.isFinite(parsedPrice) ? parsedPrice : current.price,
      status: parsed.status || current.status,
      invoice_date: parsed.invoice_date || current.invoice_date,
      payment_date: parsed.payment_date || current.payment_date,
      payment_time: parsed.payment_time || current.payment_time,
      access_period: Number.isFinite(Number(parsed.access_period)) && Number(parsed.access_period) > 0
        ? Number(parsed.access_period)
        : current.access_period,
      bonus: Number.isFinite(Number(parsed.bonus)) && Number(parsed.bonus) >= 0
        ? Number(parsed.bonus)
        : current.bonus,
      start_date: parsed.start_date || current.start_date,
      start_time: parsed.start_time || current.start_time,
      expiry_date: parsed.expiry_date || current.expiry_date,
      expiry_time: parsed.expiry_time || current.expiry_time,
      // If OCR extracted a start date, latch it as customized so a
      // later Payment edit in the review stage won't overwrite the
      // start the receipt actually shows (Req2 follow-until-custom).
      start_customized: !!parsed.start_date || current.start_customized,
    }));
  }

  // Receives a File instance from either the hidden <input
  // type="file"> click-picker or a drag-and-drop onto the upload
  // zone — both code paths funnel through here.
  async function handleFile(file) {
    if (!file) return;
    if (!/^image\//i.test(file.type || '')) {
      setStatus('Please drop a JPG, PNG, or WebP receipt image.');
      setStatusTone('error');
      return;
    }
    setFileName(file.name || '');
    setBusy(true);
    setStatus('Reading image\u2026');
    setStatusTone('');
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/subscriptions-import', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        const local = await extractSubscriptionReceiptInBrowser(file, setStatus);
        if (hasUsefulImport(local.parsed)) {
          applyParsed(local.parsed);
          setStatus(missingCoreImportFields(local.parsed)
            ? 'Needs review. Some fields were restored from filename/OCR, but blanks remain.'
            : 'Fields restored in-browser. Review and Save to create the row.');
          setStatusTone(missingCoreImportFields(local.parsed) ? '' : 'success');
        } else {
          // Spec requires the friendly message — fall through to the
          // edit stage so the operator can still type the fields. We
          // intentionally do NOT pre-fill any date/time field with
          // today(); the empty state itself signals "not extracted".
          setStatus(json.error || 'Could not read image, please enter manually.');
          setStatusTone('error');
        }
        setStage('edit');
        setExistingId('');
        return;
      }
      let parsed = json.parsed || {};
      if (json.needs_review || missingCoreImportFields(parsed)) {
        const local = await extractSubscriptionReceiptInBrowser(file, setStatus);
        parsed = mergeImportParsed(parsed, local.parsed);
      }
      applyParsed(parsed);
      setExistingId(String(json.existing?.id || ''));
      setStatus(missingCoreImportFields(parsed)
        ? (json.message || 'Needs review. Some fields could not be read.')
        : json.existing?.id
          ? 'Read OK. Existing subscription found \u2014 Save will update it.'
          : 'Read OK. Review and Save to create the row.');
      setStatusTone(missingCoreImportFields(parsed) ? '' : 'success');
      setStage('edit');
    } catch (error) {
      setStatus(error?.message || 'Could not read image, please enter manually.');
      setStatusTone('error');
      setStage('edit');
      setExistingId('');
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!String(draft.client_name || '').trim()) {
      setStatus('Client name is required.');
      setStatusTone('error');
      return;
    }
    if (!String(draft.service || '').trim()) {
      setStatus('Service is required.');
      setStatusTone('error');
      return;
    }
    setBusy(true);
    setStatus('Saving\u2026');
    setStatusTone('');
    try {
      const payload = { ...draft };
      // Pass id through when we matched an existing row so
      // /api/subscriptions-save runs as an update rather than an
      // insert — this is the duplicate-suppression contract.
      if (existingId) payload.id = existingId;
      const response = await fetch('/api/subscriptions-save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: payload, id: existingId || undefined }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(json.error || `Save failed (${response.status}).`);
      }
      // Save succeeded — return the panel to the upload step so the
      // operator can drop the next receipt without re-navigating.
      // We reset every piece of importer state (stage, fileName,
      // status, existingId, draft) so the next render is visually
      // indistinguishable from a fresh open. The parent only needs
      // to refresh its Subs list; it must NOT clear `selected` or
      // we'd unmount this component and leave a blank panel.
      setStage('upload');
      setFileName('');
      setExistingId('');
      setStatus('');
      setStatusTone('');
      setDraft(INITIAL_SUBS_IMPORT_DRAFT);
      onSaved?.();
    } catch (error) {
      setStatus(error?.message || 'Save failed.');
      setStatusTone('error');
    } finally {
      setBusy(false);
    }
  }

  // Step 1 — pick a file. The operator can also click "Enter
  // manually" to skip the upload entirely (for cases where the
  // vision provider is offline and they already know the values).
  if (stage === 'upload') {
    return (
      <>
        <div className="detail-heading">
          <div>
            <p className="eyebrow">Subscription</p>
            <h2>Import JPG</h2>
            <span>Upload a StarShots receipt to auto-fill the subscription fields.</span>
          </div>
          <div className="detail-actions">
            <button
              type="button"
              className="db-close-button"
              onClick={onCancel}
              aria-label="Close importer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        <form className="form-stack subs-import-upload" onSubmit={(e) => e.preventDefault()}>
          <SubsImportDropZone
            busy={busy}
            fileName={fileName}
            onFile={handleFile}
          />
          {status ? (
            <p className={`download-status${statusTone ? ` lg-status-${statusTone}` : ''}`}>{status}</p>
          ) : null}
          <div className="client-actions">
            <button
              type="button"
              className="ghost-button compact"
              onClick={() => {
                // Manual subscription entry lives on /subs (the
                // dedicated invoice / receipt composer). The /db
                // Subs panel only handles JPG import + listing.
                window.location.assign('/subs/');
              }}
            >
              Enter manually
            </button>
            <button type="button" className="ghost-button compact" onClick={onCancel}>Cancel</button>
          </div>
        </form>
      </>
    );
  }

  // Step 2 — editable preview. Uses the same field grid the rest
  // of the dashboard uses; the operator can edit anything before
  // Save. "Re-upload" sends them back to step 1 to try a different
  // image without losing the open editor.
  return (
    <>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Subscription</p>
          <h2>
            Import JPG
            {existingId ? <span className="sub-badge sub-badge-active">Update</span> : null}
          </h2>
          <span>Review the extracted fields and Save.</span>
        </div>
        <div className="detail-actions">
          <button
            type="button"
            className="ghost-button compact"
            onClick={() => {
              setStage('upload');
              setStatus('');
              setStatusTone('');
              setExistingId('');
            }}
          >
            Re-upload
          </button>
          <button
            type="button"
            className="db-close-button"
            onClick={onCancel}
            aria-label="Close importer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      <form className="form-stack" onSubmit={handleSave}>
        <div className="two-col">
          <label>Title
            <Combobox
              value={draft.client_title}
              options={TITLE_OPTIONS}
              placeholder="Title"
              ariaLabel="Subscription client title"
              onChange={(value) => setField('client_title', value)}
            />
          </label>
          <label>Client Name
            <input
              value={draft.client_name}
              onChange={(e) => setField('client_name', e.target.value)}
              onBlur={onBlurTitleCase((v) => setField('client_name', v))}
              placeholder="Client name"
            />
          </label>
        </div>
        <label>Service
          <input
            value={draft.service}
            onChange={(e) => setField('service', e.target.value)}
            placeholder="ChatGPT, iCloud, Google Drive\u2026"
          />
        </label>
        <div className="two-col">
          <label>Status
            <Combobox
              value={draft.status}
              options={SUBSCRIPTION_STATUS_OPTIONS}
              placeholder="Status"
              ariaLabel="Subscription status"
              onChange={(value) => setField('status', value)}
            />
          </label>
          <label>Access Period (Days)
            <input
              type="number"
              min="0"
              value={draft.access_period}
              onChange={(e) => setField('access_period', Number(e.target.value) || 0)}
            />
          </label>
        </div>
        <label>Bonus (Days)
          <input
            type="number"
            min="0"
            step="1"
            value={draft.bonus}
            onChange={(e) => setField('bonus', Number(e.target.value) || 0)}
            aria-label="Subscription bonus days"
          />
        </label>
        <label>Payment
          <DateTimeField
            value={draft.payment_date}
            onChange={(value) => setField('payment_date', value)}
            timeValue={draft.payment_time}
            onTimeChange={(value) => setField('payment_time', value)}
            withTime
            ariaLabel="Payment date and time"
          />
        </label>
        <label>Start
          <DateTimeField
            value={draft.start_date}
            onChange={(value) => setField('start_date', value)}
            timeValue={draft.start_time}
            onTimeChange={(value) => setField('start_time', value)}
            withTime
            ariaLabel="Start date and time"
          />
        </label>
        <label>Expiry
          <DateTimeField
            value={draft.expiry_date}
            onChange={(value) => setField('expiry_date', value)}
            timeValue={draft.expiry_time}
            onTimeChange={(value) => setField('expiry_time', value)}
            withTime
            ariaLabel="Expiry date and time"
          />
        </label>
        <label>Price (IDR)
          <input
            type="number"
            min="0"
            value={draft.price}
            onFocus={selectAllIfZero}
            onChange={(e) => setField('price', parseMoneyInput(e.target.value))}
          />
        </label>
        {status ? (
          <p className={`download-status${statusTone ? ` lg-status-${statusTone}` : ''}`}>{status}</p>
        ) : null}
        <div className="client-actions">
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? 'Saving\u2026' : (existingId ? 'Save (Update Existing)' : 'Save Subscription')}
          </button>
          <button className="ghost-button compact" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </>
  );
}

// Right-panel "Edit Subscription" flow for /db Subs. Shares the same
// editable form shape as SubscriptionImport's preview step, but
// prefilled from a saved subscription row and wired straight to
// /api/subscriptions-save with the row's id so saving updates the
// existing row instead of inserting. On success the parent swaps
// the right panel back to the read-only detail view.
//
// Doubles as the "New Subscription" composer when invoked with no
// `subscription` prop (or a freshly-shaped empty draft). In create
// mode the heading, eyebrow, and submit-button copy switch over and
// the save POST flows through the same /api/subscriptions-save
// endpoint without an `id`, so the worker treats it as an insert.
// Subs/Clients separation is preserved server-side: handleSubscription
// Save explicitly does not auto-create a public.clients row from a
// subscription save (see comment block in _worker.js), so manual
// creation here keeps the two systems independent.
function SubscriptionEdit({ subscription, onSaved, onCancel, mode = 'edit' }) {
  const id = String(subscription?.id || '');
  const isCreate = mode === 'create' || !id;
  const [draft, setDraft] = useState(() => subscriptionToDraft(subscription || {}));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState('');

  // If the parent re-selects a different subscription while this
  // form is still mounted (rare, but possible after a refetch where
  // the same client now points at a different subscription row),
  // re-seed the draft so the inputs reflect the new row.
  useEffect(() => {
    setDraft(subscriptionToDraft(subscription || {}));
    setStatus('');
    setStatusTone('');
  }, [subscription?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function setField(key, value) {
    setDraft((current) => applySubscriptionDraftUpdate(current, key, value));
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!String(draft.client_name || '').trim()) {
      setStatus('Client name is required.');
      setStatusTone('error');
      return;
    }
    if (!String(draft.service || '').trim()) {
      setStatus('Service is required.');
      setStatusTone('error');
      return;
    }
    setBusy(true);
    setStatus('Saving\u2026');
    setStatusTone('');
    try {
      const payload = { ...draft };
      if (id) payload.id = id;
      const response = await fetch('/api/subscriptions-save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: payload, id: id || undefined }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(json.error || `Save failed (${response.status}).`);
      }
      // The row saved, but the worker dropped the `notes` column
      // because db-migration-part-11 isn't applied yet. Keep the
      // editor open and surface a clear warning instead of routing
      // back as if the note persisted. (Empty notes never hit this.)
      if (json.migrationMissing && String(json.migrationMissing).includes('notes')) {
        setStatus('Notes column missing. Run db-migration-part-11.sql.');
        setStatusTone('error');
        return;
      }
      // Hand the freshly-saved row back to the parent so it can
      // refetch the list and route the right panel back to the
      // (now updated) detail view in one transition.
      onSaved?.(json.subscription || null);
    } catch (error) {
      setStatus(error?.message || 'Save failed.');
      setStatusTone('error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Subscription</p>
          <h2>{isCreate ? 'New Subscription' : 'Edit Subscription'}</h2>
          <span>
            {isCreate
              ? 'Fill in the details and Save to add a subscription. This does not create a Clients record.'
              : 'Update the saved fields and Save to apply changes.'}
          </span>
        </div>
        <div className="detail-actions">
          <button
            type="button"
            className="db-close-button"
            onClick={onCancel}
            aria-label={isCreate ? 'Cancel new subscription' : 'Cancel edit'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      <form className="form-stack" onSubmit={handleSave}>
        <div className="two-col">
          <label>Title
            <Combobox
              value={draft.client_title}
              options={TITLE_OPTIONS}
              placeholder="Title"
              ariaLabel="Subscription client title"
              onChange={(value) => setField('client_title', value)}
            />
          </label>
          <label>Client Name
            <input
              value={draft.client_name}
              onChange={(e) => setField('client_name', e.target.value)}
              onBlur={onBlurTitleCase((v) => setField('client_name', v))}
              placeholder="Client name"
            />
          </label>
        </div>
        <label>Service
          <input
            value={draft.service}
            onChange={(e) => setField('service', e.target.value)}
            placeholder="ChatGPT, iCloud, Google Drive\u2026"
          />
        </label>
        <div className="two-col">
          <label>Status
            <Combobox
              value={draft.status}
              options={SUBSCRIPTION_STATUS_OPTIONS}
              placeholder="Status"
              ariaLabel="Subscription status"
              onChange={(value) => setField('status', value)}
            />
          </label>
          <label>Access Period (Days)
            <input
              type="number"
              min="0"
              value={draft.access_period}
              onChange={(e) => setField('access_period', Number(e.target.value) || 0)}
            />
          </label>
        </div>
        <label>Bonus (Days)
          <input
            type="number"
            min="0"
            step="1"
            value={draft.bonus}
            onFocus={selectAllIfZero}
            onChange={(e) => setField('bonus', Number(e.target.value) || 0)}
            aria-label="Subscription bonus days"
          />
        </label>
        <label>Notes (Optional)
          <textarea
            value={draft.notes || ''}
            onChange={(e) => setField('notes', e.target.value)}
            rows={2}
            placeholder="Internal note for this period"
            aria-label="Subscription notes"
          />
        </label>
        <label>Payment
          <DateTimeField
            value={draft.payment_date}
            onChange={(value) => setField('payment_date', value)}
            timeValue={draft.payment_time}
            onTimeChange={(value) => setField('payment_time', value)}
            withTime
            ariaLabel="Payment date and time"
          />
        </label>
        <label>Start
          <DateTimeField
            value={draft.start_date}
            onChange={(value) => setField('start_date', value)}
            timeValue={draft.start_time}
            onTimeChange={(value) => setField('start_time', value)}
            withTime
            ariaLabel="Start date and time"
          />
        </label>
        <label>Expiry
          <DateTimeField
            value={draft.expiry_date}
            onChange={(value) => setField('expiry_date', value)}
            timeValue={draft.expiry_time}
            onTimeChange={(value) => setField('expiry_time', value)}
            withTime
            ariaLabel="Expiry date and time"
          />
        </label>
        <label>Price (IDR)
          <input
            type="text"
            inputMode="numeric"
            // Show a real "0" when no price is set (not just a
            // placeholder) so the field reads as a concrete value;
            // selectAllIfZero selects that "0" on focus so the first
            // keystroke replaces it cleanly, and parseMoneyInput
            // collapses any leading zero on the way back in.
            value={String(Number(draft.price) || 0)}
            placeholder="0"
            onFocus={selectAllIfZero}
            onChange={(e) => setField('price', parseMoneyInput(e.target.value))}
            aria-label="Subscription price in rupiah"
          />
        </label>
        <ProofField
          value={draft.payment_proof}
          onChange={(v) => setField('payment_proof', v)}
          ariaLabel="Subscription payment proof"
        />
        {status ? (
          <p className={`download-status${statusTone ? ` lg-status-${statusTone}` : ''}`}>{status}</p>
        ) : null}
        <div className="client-actions">
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? 'Saving\u2026' : (isCreate ? 'Create Subscription' : 'Save Subscription')}
          </button>
          <button className="ghost-button compact" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </>
  );
}

export function DatabasePage() {
  const [tab, setTab] = useState('clients');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({ title: 'Ms.', name: '', contact: '' });
  const [saveStatus, setSaveStatus] = useState('');
  const [mobileView, setMobileView] = useState('left');
  const endpoint = `/api/db${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`;
  const { data, status, refetch, refresh } = useRemoteList(endpoint);
  const rawClients = data?.clients || [];
  const invoices = data?.invoices || [];
  const subscriptions = data?.subscriptions || [];

  // Apply the latest extension on top of the base subscription so
  // the visible expiry/status/period/price/service reflect the
  // most recent renewal. Thin wrapper around the module-scope
  // helper so the dependency list is stable.
  const effectiveSubscription = useCallback((sub) => {
    if (!sub || typeof sub !== 'object') return sub;
    const ext = sub.latest_extension || pickLatestSubscriptionExtension(sub.extensions);
    return applySubscriptionExtension(sub, ext);
  }, []);

  // Sort clients alphabetically (case-insensitive) by display name
  // for the Clients tab. Search/query filtering still happens server
  // side via /api/db?q=... so the alphabetical ordering composes
  // naturally with the filtered subset returned.
  const clients = useMemo(() => {
    return [...rawClients].sort((a, b) => {
      const an = String(a?.name || a?.client_name || '').toLowerCase();
      const bn = String(b?.name || b?.client_name || '').toLowerCase();
      return an.localeCompare(bn);
    });
  }, [rawClients]);

  // Subs tab data source. The Subs roster is driven directly by
  // the `subscriptions` array — NOT by joined client summaries —
  // so an edited subscription's client_name shows up immediately
  // and a deleted subscription disappears without leaving a
  // stub Clients row behind. Each row's stable id is the
  // subscription id (used for selection and delete), and the
  // subscription record itself rides along on `row.subscription`
  // so downstream lookups don't need a separate query.
  const subRows = useMemo(() => {
    return (Array.isArray(subscriptions) ? subscriptions : []).map((sub) => ({
      id: String(sub.id || ''),
      client_name: String(sub.client_name || '').trim(),
      client_title: String(sub.client_title || '').trim(),
      client_contact: String(sub.client_contact || '').trim(),
      subscription: sub,
    }));
  }, [subscriptions]);

  // CRM Clients tab: real client rows + any client with invoice/delivery
  // history. Subscription data is intentionally NOT included so the
  // Clients tab stays a pure CRM view (invoices + deliveries only).
  // Cross-leaks from Subs into Clients are handled server-side
  // (handleSubscriptionSave no longer creates client rows; orphan
  // client rows are reaped on subscription delete; buildClientSummaries
  // filters out subscription-only client rows). This filter is the
  // last line of defence so any stragglers from older runs don't
  // surface here.
  const crmClients = useMemo(() => {
    return clients.filter((c) => {
      const invoiceCount = Number(c?.invoice_count || 0);
      const deliveryCount = Number(c?.delivery_count || 0);
      const subscriptionCount = Number(c?.subscription_count || 0);
      const source = String(c?.source || '').toLowerCase();
      const hasInvoiceHistory =
        invoiceCount > 0 ||
        (Array.isArray(c?.invoice_ids) && c.invoice_ids.length > 0);
      const hasDeliveryHistory =
        deliveryCount > 0 ||
        (Array.isArray(c?.delivery_ids) && c.delivery_ids.length > 0);
      const hasCrmHistory = hasInvoiceHistory || hasDeliveryHistory;

      // Real CRM history wins regardless of source state.
      if (hasCrmHistory) return true;

      // Drop legacy / subscription-derived summaries — these are
      // remnants from before the Subs/Clients decoupling.
      const isLegacyOrSubscriptionSource =
        source === 'legacy' ||
        source === 'subscription' ||
        source === 'subscriptions';
      if (isLegacyOrSubscriptionSource) return false;

      // Subscription-only orphan: a public.clients row that exists
      // ONLY because an older handleSubscriptionSave auto-created
      // it (no invoices, no deliveries, but a subscription points
      // at it). The Subs tab is the canonical surface for these
      // people, so hide them from Clients. Fresh CRM clients with
      // no history yet (operator just clicked Create Client and
      // hasn't created any invoices/links) still pass because
      // their subscription_count is zero.
      if (subscriptionCount > 0) return false;

      // Otherwise include real client rows.
      return source === 'client';
    });
  }, [clients]);

  // Resolve a subscription by id (used by SubscriptionDetail /
  // SubscriptionEdit when the parent's selection points at a Subs
  // row). Falls back to the row's bundled subscription if the list
  // hasn't been refreshed yet, so the right panel never goes blank
  // mid-transition.
  const getSubscriptionById = useCallback((id) => {
    const cleanId = String(id || '').trim();
    if (!cleanId) return null;
    return subscriptions.find((sub) => String(sub?.id || '') === cleanId) || null;
  }, [subscriptions]);

  // Resolve all real event_dates a CRM client owns by walking the
  // /api/db payload (invoices + deliveries). Match on client_id
  // first, fall back to a case-insensitive name match so rows that
  // pre-date the typed client_id column still associate. Mirrors
  // the matching used in buildClientRecords so the Clients tab
  // tone and the right-panel records read off the same definition.
  // Subs are resolved separately by subscription id (subRows /
  // getSubscriptionById) so this helper stays Clients-only.
  const deliveriesAll = data?.items || [];
  const todayIso = useMemo(() => jakartaTodayISO(), []);
  const eventDatesByClient = useCallback((client) => {
    const cid = String(client?.id || '').trim();
    const cname = String(client?.name || client?.client_name || '').trim().toLowerCase();
    const matches = (rec) => {
      const rid = String(rec?.client_id || '').trim();
      const rname = String(rec?.client_name || rec?.name || '').trim().toLowerCase();
      if (cid && rid && cid === rid) return true;
      return !!cname && !!rname && cname === rname;
    };
    const dates = [];
    for (const rec of invoices) {
      if (!matches(rec)) continue;
      const d = plainEventDate(rec?.event_date);
      if (d) dates.push(d);
    }
    for (const rec of deliveriesAll) {
      if (!matches(rec)) continue;
      const d = plainEventDate(rec?.event_date);
      if (d) dates.push(d);
    }
    return dates;
  }, [invoices, deliveriesAll]);

  // Clients-tab list ordering + tone. Three buckets, each annotated
  // with a date-tone class that drives the row colour and the
  // compact date pill rendered on the right side of the row. The
  // tone palette is muted (not neon) and pulled from the shared
  // --evt-* design tokens in invcs.css so light/dark themes pick
  // the right shade automatically:
  //   • upcoming — at least one event today or future. Sorted by
  //                nearest upcoming event first.
  //                tone='soon'   (muted blue)  when nearest is
  //                              today / +1 / +2 days WIB.
  //                tone='future' (muted green) when nearest is 3+
  //                              days out.
  //   • tba      — no real event_date at all. Pinned BELOW any
  //                upcoming clients so a concrete event always
  //                outranks an undated one. Sorted alphabetically.
  //                tone='tba'    (muted amber).
  //   • past     — all event_dates are in the past. Pinned to the
  //                bottom and sorted by most recent past event
  //                (newest-expired first so a recently-finished
  //                gig is easy to find).
  //                tone='past'   (muted red).
  // TBA never becomes "today" — plainEventDate strips timestamps,
  // and classifyClientEvents only treats real YYYY-MM-DD dates as
  // upcoming.
  const sortedCrmClients = useMemo(() => {
    const bucketOrder = { upcoming: 0, tba: 1, past: 2 };
    const annotated = crmClients.map((client) => {
      const dates = eventDatesByClient(client);
      const cls = classifyClientEvents(dates, todayIso);
      const records = buildClientRecords(client, invoices, deliveriesAll, todayIso);
      // Completion (and therefore the left-list neutral tone) tracks
      // ONLY the universal delivery done/check state — the same
      // top-level checkmark that flips deliveries.delivery_done. A
      // missing or unpaid client invoice must NOT keep the row red;
      // invoice status drives the invoice button/pill alone. Records
      // without a delivery (invoice-only events) stay incomplete, so
      // a client only goes neutral once every event with a delivery
      // has that delivery marked done.
      const deliveryRecords = records.filter((row) => !!row.delivery?.id);
      const clientWorkflowComplete =
        deliveryRecords.length > 0 &&
        deliveryRecords.every((row) => !!row.delivery?.delivery_done);
      const name = String(client?.name || client?.client_name || '').toLowerCase();
      return {
        client,
        ...cls,
        tone: clientWorkflowComplete ? '' : cls.tone,
        name,
      };
    });
    annotated.sort((a, b) => {
      const ba = bucketOrder[a.bucket] ?? 9;
      const bb = bucketOrder[b.bucket] ?? 9;
      if (ba !== bb) return ba - bb;
      if (a.bucket === 'upcoming') {
        // Nearest upcoming event first.
        return a.sortKey.localeCompare(b.sortKey);
      }
      if (a.bucket === 'past') {
        // Most recent past event first.
        return b.sortKey.localeCompare(a.sortKey);
      }
      // TBA bucket: alphabetical.
      return a.name.localeCompare(b.name);
    });
    return annotated;
  }, [crmClients, eventDatesByClient, invoices, deliveriesAll, todayIso]);

  const clientToneByRowId = useMemo(() => {
    const map = new Map();
    for (const entry of sortedCrmClients) {
      map.set(entry.client?.id, {
        tone: entry.tone,
        representativeDate: entry.representativeDate,
      });
    }
    return map;
  }, [sortedCrmClients]);

  // Subs-tab list ordering. Two-bucket sort:
  //   • bucket A — active + warning rows: newest first by
  //                expiry_date (primary), then payment_date,
  //                then start_date, then created_at.
  //   • bucket B — expired rows: pinned to the bottom regardless
  //                of how recently they expired. Within the
  //                expired bucket we still keep newest-first so
  //                the most recently lapsed reads first.
  // Tone is computed against the EFFECTIVE subscription so a
  // recent extension's expiry can flip an "expired" base row back
  // to active without a separate codepath. The recency key is an
  // ISO/YYYY-MM-DD string, so a plain reverse localeCompare is
  // sufficient — no Date parsing needed.
  const sortedSubRows = useMemo(() => {
    function recencyKey(sub) {
      return String(
        sub?.expiry_date
        || sub?.payment_date
        || sub?.start_date
        || sub?.created_at
        || ''
      );
    }
    const annotated = subRows.map((row) => {
      const sub = row.subscription || null;
      const effective = sub ? effectiveSubscription(sub) : null;
      const tone = effective ? subscriptionTone(effective) : 'active';
      return {
        row,
        bucket: tone === 'expired' ? 1 : 0,
        key: recencyKey(effective || sub),
      };
    });
    annotated.sort((a, b) => {
      if (a.bucket !== b.bucket) return a.bucket - b.bucket;
      // Newer first within the same bucket.
      return b.key.localeCompare(a.key);
    });
    return annotated.map((entry) => entry.row);
  }, [subRows, effectiveSubscription]);

  const activeRows = tab === 'subs'
    ? sortedSubRows
    : sortedCrmClients.map((entry) => entry.client);
  const selectedClient = selected?.type === 'client' ? clients.find((client) => client.id === selected.id) || selected.data : null;
  // For Subs tab selections, resolve the actual subscription row by
  // its id. Both 'subscription' and 'subs-edit' selection branches
  // carry the subscription id directly (Subs rows are subscription-
  // backed now), so a single getSubscriptionById lookup is enough.
  // Falls back to the row's bundled subscription if the list
  // hasn't been refreshed yet (e.g. mid-transition right after a
  // save) so the right panel never goes blank.
  const selectedSubscription = (selected?.type === 'subscription' || selected?.type === 'subs-edit')
    ? (getSubscriptionById(selected.id) || selected.data?.subscription || null)
    : null;

  // Fresh delivery row for the open Delivery detail panel. Prefer the
  // latest /api/db row (data.items) matched by id so a Refresh or a
  // password repair/regenerate rehydrates the panel in place without
  // closing/reopening. Falls back to the captured selected.data only
  // until the first fresh row for this id is available, so the panel
  // never goes blank mid-transition. Memoised on data.items + the
  // selection so its reference stays stable between renders (the
  // detail panel keys its hydration effect off this reference).
  const selectedDelivery = useMemo(() => {
    if (selected?.type !== 'delivery') return null;
    const id = String(selected.id || '');
    const fresh = (data?.items || []).find((d) => String(d?.id || '') === id);
    return fresh || selected.data || null;
  }, [selected, data]);

  // Walk back one level through the selection's parent chain.
  // Used by both the global Esc handler and every X / Cancel
  // control inside the right-panel detail views so they all share
  // a single "go back to where I came from" semantic:
  //   - opened from a list row -> close = clear selection (list).
  //   - opened from a parent detail view (e.g. View Links from
  //     a client detail row, or Edit from a subscription detail)
  //     -> close = restore the parent detail view, NOT the list.
  // Mobile mirrors the same rule: pop to a parent keeps the right
  // panel visible; pop to null falls back to the left list.
  const back = useCallback(() => {
    setSelected((cur) => {
      if (!cur) {
        setMobileView('left');
        return null;
      }
      if (cur.parent) {
        // Stay on the right panel — operator returns to a parent
        // detail view, not the list.
        return cur.parent;
      }
      setMobileView('left');
      return null;
    });
  }, []);

  // Escape walks back one level through the parent chain, mirroring
  // the X buttons. The handler used to unconditionally nuke
  // selection, which dropped operators back to "Choose A Client"
  // even when they were two levels deep (e.g. Client -> View Links
  // -> Esc would lose the client context). The parent chain on
  // selected.parent now keeps the breadcrumb intact.
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') back();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [back]);

  // Auto-switch to the right panel on mobile when a row is selected.
  useEffect(() => {
    if (selected) setMobileView('right');
  }, [selected]);

  async function saveClient(event) {
    event.preventDefault();
    if (!draft.name.trim()) {
      setSaveStatus('Client name required.');
      return;
    }

    // Edit-existing flow: when the right panel is the edit form
    // (selected.type === 'client-edit'), forward the row's id so
    // the worker PATCHes the existing client + cascades updates
    // through linked invoices/deliveries (handleClientSave already
    // does both when body.id is present and not legacy:*). New
    // clients still POST without an id and reload the page so the
    // freshly-inserted row is selectable from the list.
    const isEdit = selected?.type === 'client-edit';
    const editSource = isEdit ? (selected?.data || {}) : {};
    const editId = isEdit ? String(editSource.id || editSource.client_id || '') : '';
    const groupedInvoiceIds = Array.isArray(editSource.invoice_ids) ? editSource.invoice_ids : [];
    const groupedDeliveryIds = Array.isArray(editSource.delivery_ids) ? editSource.delivery_ids : [];

    setSaveStatus('Saving...');
    try {
      const payload = isEdit
        ? {
            ...draft,
            ...(editId && !editId.startsWith('legacy:') ? { id: editId } : {}),
            invoiceIds: groupedInvoiceIds,
            deliveryIds: groupedDeliveryIds,
          }
        : draft;
      const response = await fetch('/api/clients-save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || 'Save failed.');
      if (isEdit) {
        // Walk back to the parent client detail view so the right
        // panel re-renders against the now-updated row, and refetch
        // /api/db so the left list + the right panel pick up the
        // saved name/contact immediately. selectedClient is computed
        // via clients.find(id === selected.id), so the new payload
        // automatically flows through both panels — no manual patch
        // of selected.data needed.
        setSaveStatus('');
        back();
        refetch();
      } else {
        window.location.reload();
      }
    } catch (error) {
      setSaveStatus(error.message || 'Save failed.');
    }
  }

  function openNewClient() {
    setTab('clients');
    setDraft({ title: 'Ms.', name: query.trim(), contact: '' });
    setSaveStatus('');
    setSelected({ type: 'new' });
  }

  // /db Subs → "Import JPG". Opens the right-panel importer (file
  // upload + editable preview + Save) without picking a row from
  // the list. The actual extraction is fired when the operator
  // chooses a file inside SubscriptionImport.
  function openImportSubscription() {
    setTab('subs');
    setSelected({ type: 'subs-import' });
  }

  // /db Subs → "New Subscription". Opens the same editable form
  // SubscriptionEdit uses but in create mode (no id), so saving
  // POSTs through /api/subscriptions-save as a fresh insert. Subs
  // and Clients stay separate: handleSubscriptionSave never auto-
  // creates a public.clients row from this path, and the new row
  // shows up only on the Subs tab — never as a TBA Clients row.
  function openCreateSubscription() {
    setTab('subs');
    setSelected({ type: 'subs-create' });
    setMobileView('right');
  }

  // The earlier top-level "Create Events" button on the client
  // detail panel has been folded into an inline sheet inside
  // ClientDetail (see the createOpen/pendingEventKey flow). The
  // sheet's two choices share a single freshly-generated event_key
  // so the resulting Links + Invoice rows merge into one /db row.
  // This removes the previous helper that opened /inv/ directly
  // with no shared event context.

  // Cascade-delete a client and every record bucketed under them.
  // The legacy:<normalized> id case has no real client row to drop
  // but still cleans the denormalized invoice/delivery/subscription
  // rows the dashboard groups under that name.
  async function deleteClient(client) {
    if (!client) return;
    const id = String(client.id || client.client_id || '');
    const name = String(client.name || client.client_name || '');
    if (!id && !name) return;
    try {
      const response = await fetch('/api/clients-delete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || 'Delete failed.');
      setSelected(null);
      setMobileView('left');
      refetch();
    } catch (error) {
      console.warn('[db] client delete failed:', error);
      setSaveStatus(error?.message || 'Delete failed.');
    }
  }

  // Delete a single subscription / invoice / delivery row. Used by
  // the Subs and Invoices list and by record rows inside the client
  // detail. After a successful delete we clear the selection if it
  // pointed at the deleted row, then refetch.
  async function deleteRecord({ kind, id, deliveryId, invoiceId }) {
    let endpointPath = '';
    let body = null;
    if (kind === 'subscription') {
      endpointPath = '/api/subscriptions-delete';
      body = { id };
    } else if (kind === 'invoice') {
      endpointPath = '/api/invoices-delete';
      body = { id };
    } else if (kind === 'delivery') {
      endpointPath = '/api/db-delete';
      body = { id };
    } else if (kind === 'event') {
      // A unified event row that may carry both a delivery and an
      // invoice. Issue both deletes in series; ignore individual
      // failures so a partial cleanup still progresses.
      if (deliveryId) {
        await fetch('/api/db-delete', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: deliveryId }),
        }).catch((error) => console.warn('[db] event delivery delete failed:', error));
      }
      if (invoiceId) {
        await fetch('/api/invoices-delete', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: invoiceId }),
        }).catch((error) => console.warn('[db] event invoice delete failed:', error));
      }
      refetch();
      return;
    } else {
      return;
    }

    try {
      const response = await fetch(endpointPath, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || 'Delete failed.');
      if (selected?.id === id) setSelected(null);
      refetch();
    } catch (error) {
      console.warn('[db] record delete failed:', error);
    }
  }

  const tabs = [
    { value: 'clients', label: 'Clients' },
    { value: 'subs', label: 'Subs' },
  ];

  const tabHeading =
    tab === 'subs' ? 'Subscriptions' : 'Choose A Client';

  // Row selection logic stays parent-owned; DatabaseList calls
  // this with the clicked/keyboard-activated row. Mirrors the
  // previous inline handleSelect exactly (Subs → subscription
  // detail, Clients → client detail, fall through to the raw tab
  // type for any other tab).
  const handleSelectRow = (row) => {
    if (tab === 'subs') {
      // Subs tab → subscription detail. row.id IS the subscription
      // id (subRows builds it that way) so selectedSubscription
      // resolves directly. We keep the row in selected.data as a
      // fallback for the mid-transition window where the list
      // hasn't been refreshed yet.
      setSelected({ type: 'subscription', id: row.id, data: row });
    } else if (tab === 'clients') {
      setSelected({ type: 'client', id: row.id, data: row });
    } else {
      setSelected({ type: tab, id: row.id, data: row });
    }
  };

  // Row delete logic stays parent-owned. DatabaseList forwards the
  // row and the originating click event so we can stop it from
  // bubbling to the row's select handler, then run the same delete
  // path the inline handleDelete used.
  const handleDeleteRow = (row, event) => {
    event.stopPropagation();
    if (tab === 'subs') {
      // Deleting from the Subs list removes the subscription row
      // directly. The orphan-client cleanup is handled server-side
      // in handleSubscriptionDelete so a real CRM client (one with
      // invoices/deliveries) is never touched.
      if (row.id) {
        deleteRecord({ kind: 'subscription', id: row.id });
        if (selected?.type === 'subscription' && selected.id === row.id) {
          setSelected(null);
          setMobileView('left');
        }
      }
    } else if (tab === 'clients') {
      deleteClient(row);
    }
  };

  const left = (
    <DatabaseList
      tab={tab}
      query={query}
      onQueryChange={setQuery}
      status={status}
      activeRows={activeRows}
      selected={selected}
      clientToneByRowId={clientToneByRowId}
      effectiveSubscription={effectiveSubscription}
      onSelectRow={handleSelectRow}
      onDeleteRow={handleDeleteRow}
      onCreateClient={openNewClient}
      onCreateSubscription={openCreateSubscription}
      onImportSubscription={openImportSubscription}
    />
  );

  const right = (
    <>
      {status ? <EmptyState>{status}</EmptyState> : null}
      {!selected && !status ? <h2>{tabHeading}</h2> : null}
      {selected?.type === 'new' ? (
        <>
          <h2>Create Client</h2>
          <ClientForm
            draft={draft}
            onChange={setDraft}
            onCancel={back}
            onSave={saveClient}
            status={saveStatus}
          />
        </>
      ) : null}
      {selected?.type === 'client-edit' ? (
        <>
          <div className="detail-heading">
            <div>
              <p className="eyebrow">Edit Client</p>
              <h2>{draft.name || selected?.data?.name || selected?.data?.client_name || 'Client'}</h2>
            </div>
            <div className="detail-actions">
              <button
                type="button"
                className="db-close-button"
                onClick={back}
                aria-label="Close edit form"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
          <ClientForm
            draft={draft}
            onChange={setDraft}
            onCancel={back}
            onSave={saveClient}
            status={saveStatus}
          />
        </>
      ) : null}
      {selectedClient ? (
        <ClientDetail
          client={selectedClient}
          invoices={invoices}
          deliveries={data?.items || []}
          onDeleteClient={deleteClient}
          onEditClient={(clientRow) => {
            // Push the edit form onto the parent chain so closing
            // it (Cancel / X / Esc) walks back to the same client
            // detail view that launched it — same pattern used by
            // View Links and SubscriptionEdit. Prefilling the draft
            // here means the form mounts with the current name /
            // title / contact and the operator sees what they're
            // editing immediately. selected.data carries the row
            // so saveClient can read its id when patching.
            if (!clientRow) return;
            const parent = selected;
            setDraft({
              title: String((clientRow.title || clientRow.client_title) ?? 'Ms.'),
              name: String(clientRow.name || clientRow.client_name || ''),
              contact: String(clientRow.contact || clientRow.client_contact || ''),
            });
            setSaveStatus('');
            setSelected({
              type: 'client-edit',
              id: clientRow.id,
              data: clientRow,
              parent,
            });
          }}
          onDeleteRecord={(row) =>
            deleteRecord({
              kind: 'event',
              deliveryId: row?.delivery?.id || '',
              invoiceId: row?.invoice?.id || '',
            })
          }
          onViewLinks={(deliveryRow) => {
            // Push DeliveryDetail onto the parent chain so closing
            // it (X or Esc) returns to the same client detail view
            // — not back to the list. selected.parent stores the
            // currently-rendered client selection so back() can
            // restore it verbatim. The legacy `fromClient` field is
            // kept for backwards compatibility with any branch that
            // might still read it, but the parent chain is the
            // authoritative source of truth.
            if (!deliveryRow?.id) return;
            const parent = selected;
            setSelected({
              type: 'delivery',
              id: deliveryRow.id,
              data: deliveryRow,
              fromClient: selectedClient,
              parent,
            });
          }}
          onRefresh={refetch}
          onClose={back}
        />
      ) : null}
      {selected?.type === 'delivery' ? (
        <DeliveryDetail
          delivery={selectedDelivery || {}}
          onRepaired={(repaired) => {
            setSelected((cur) => cur?.type === 'delivery'
              ? { ...cur, data: repaired }
              : cur);
            refetch();
          }}
          onRefresh={refresh}
          onDeleted={() => {
            // The delivery row (links only) was deleted. Pop back to
            // the parent client detail and refetch /api/db so the
            // event row reflects the change immediately — if a paired
            // invoice still exists the row stays put and now offers
            // "Create Links" again; if not, the row drops out.
            back();
            refetch();
          }}
          onClose={back}
        />
      ) : null}
      {selected?.type === 'subscription' ? (
        <SubscriptionDetail
          client={selected.data || {}}
          subscription={selectedSubscription}
          onEdit={(sub) => {
            // Push SubscriptionEdit onto the parent chain. Closing
            // the editor (Cancel, Save, or Esc) walks back via
            // back() to the subscription detail view that launched
            // it — same pattern as View Links from ClientDetail.
            if (!sub?.id) return;
            const parent = selected;
            setSelected({
              type: 'subs-edit',
              id: selected.id,
              data: selected.data,
              parent,
            });
          }}
          onDeleteSubscription={(sub) => {
            if (!sub?.id) return;
            deleteRecord({ kind: 'subscription', id: sub.id });
            setSelected(null);
            setMobileView('left');
          }}
          onChanged={refetch}
          onClose={back}
        />
      ) : null}
      {selected?.type === 'subs-edit' ? (
        <SubscriptionEdit
          subscription={selectedSubscription}
          onSaved={(saved) => {
            // Refresh the list so any changed fields (status, dates,
            // service, etc.) reflect in both the row label and the
            // tone class.
            refetch();
            // Merge the freshly-saved row straight back into the
            // selection so the detail panel's service pill and notes
            // update IMMEDIATELY — without waiting on the async refetch
            // and without depending on the row still matching an active
            // search query. (A service rename can drop the row out of a
            // filtered /api/db?q= result, which would otherwise leave
            // getSubscriptionById returning null and the detail falling
            // back to the stale pre-edit snapshot — the reported "pill
            // doesn't update until reopen" bug.) Mirrors the subs-create
            // flow below. We rebuild the parent subscription-detail
            // selection (so back() still returns to wherever the editor
            // was launched from) but seed it with the saved subscription
            // as its bundled record.
            const parent = selected?.parent || null;
            const savedId = String(saved?.id || parent?.id || selected?.id || '');
            if (saved && savedId) {
              setSelected({
                type: 'subscription',
                id: savedId,
                data: {
                  ...(parent?.data || {}),
                  id: savedId,
                  client_name: String(saved.client_name ?? parent?.data?.client_name ?? ''),
                  client_title: String(saved.client_title ?? parent?.data?.client_title ?? ''),
                  client_contact: String(saved.client_contact ?? parent?.data?.client_contact ?? ''),
                  subscription: saved,
                },
                parent: parent?.parent || null,
              });
            } else {
              // No row echoed back (defensive) — fall back to the prior
              // behaviour of walking back up the parent chain.
              back();
            }
          }}
          onCancel={back}
        />
      ) : null}
      {selected?.type === 'subs-import' ? (
        <SubscriptionImport
          onSaved={() => {
            // Stay on /db Subs with the importer mounted — the
            // component itself resets back to its upload step so
            // the operator can drop the next receipt immediately.
            // We only refresh the list so the saved row appears.
            refetch();
          }}
          onCancel={back}
        />
      ) : null}
      {selected?.type === 'subs-create' ? (
        <SubscriptionEdit
          subscription={null}
          mode="create"
          onSaved={(saved) => {
            // Refresh the list so the new row is selectable, then
            // route the right panel into the freshly-created
            // subscription's detail view. Falls back to the list
            // view when the worker didn't echo back a row id.
            refetch();
            const newId = String(saved?.id || '');
            if (newId) {
              setSelected({
                type: 'subscription',
                id: newId,
                data: {
                  id: newId,
                  client_name: String(saved?.client_name || ''),
                  client_title: String(saved?.client_title || ''),
                  client_contact: String(saved?.client_contact || ''),
                  subscription: saved,
                },
              });
            } else {
              setSelected(null);
              setMobileView('left');
            }
          }}
          onCancel={back}
        />
      ) : null}
      {selected && !selectedClient && selected.type !== 'new' && selected.type !== 'client-edit' && selected.type !== 'subscription' && selected.type !== 'subs-import' && selected.type !== 'subs-edit' && selected.type !== 'subs-create' && selected.type !== 'delivery' ? (
        <>
          <div className="list-stack">
            <ListRow
              title={
                selected.data?.client_name ||
                selected.data?.name ||
                selected.data?.title ||
                selected.data?.service
              }
              meta={
                selected.data?.client_contact ||
                selected.data?.contact ||
                selected.data?.status ||
                selected.data?.updated_at
              }
              amount={
                selected.data?.total || selected.data?.grand_total || selected.data?.price
                  ? rupiah(
                      selected.data.total || selected.data.grand_total || selected.data.price,
                    )
                  : ''
              }
            />
          </div>
        </>
      ) : null}
    </>
  );

  return (
    <WorkspacePanels
      active="/db/"
      showNav={false}
      pills={
        <Segmented
          value={tab}
          onChange={(next) => {
            refetch();
            if (next !== tab) {
              setTab(next);
              setSelected(null);
              setMobileView('left');
            }
          }}
          options={tabs}
          ariaLabel="Database section"
        />
      }
      left={left}
      right={right}
      mobileView={mobileView}
      onMobileViewChange={(view) => {
        if (view === 'left') setSelected(null);
        setMobileView(view);
      }}
      mobileTabs={{ left: 'List', right: 'Detail' }}
    />
  );
}

async function copyToClipboard(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(String(text));
    return true;
  } catch {
    return false;
  }
}


// Map a saved subscription row (worker-normalised field names) to the
// draft shape used by the editable form. Tolerates legacy/null values
// so the form's date/time inputs see "" instead of `null`. Used both
// when prefilling SubscriptionEdit on /db Subs and when /db Subs
// detail needs to render the print card from saved values.
function subscriptionToDraft(sub = {}) {
  const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  // Saved times come back as HH:MM:SS. <input type="time" step="1">
  // also accepts HH:MM:SS, but normalise so a stray "20:21" still
  // round-trips as "20:21:00".
  const padTime = (v) => {
    if (!v) return '';
    const m = String(v).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return '';
    return `${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}`;
  };
  const status = String(sub.status || 'paid').toLowerCase();
  return {
    client_title: String(sub.client_title || 'Mr.'),
    client_name: String(sub.client_name || ''),
    client_contact: String(sub.client_contact || ''),
    service: String(sub.service || ''),
    storage_slot: String(sub.storage_slot || ''),
    rate_mode: String(sub.rate_mode || 'normal'),
    price: num(sub.price, 0),
    status: status === 'paid' ? 'paid' : 'invoice',
    invoice_date: String(sub.invoice_date || ''),
    payment_date: String(sub.payment_date || ''),
    payment_time: padTime(sub.payment_time),
    access_period: Number.isFinite(Number(sub.access_period)) && Number(sub.access_period) > 0
      ? Number(sub.access_period)
      : 30,
    bonus: resolveBonusDays(sub),
    start_date: String(sub.start_date || ''),
    start_time: padTime(sub.start_time),
    expiry_date: String(sub.expiry_date || ''),
    expiry_time: padTime(sub.expiry_time),
    payment_proof: String(sub.payment_proof || ''),
    notes: String(sub.notes || ''),
    // Req2: an existing row with a start already set is treated as
    // customized (editing Payment won't move Start); a fresh draft
    // (no start) lets Start follow Payment until manually edited.
    start_customized: !!String(sub.start_date || ''),
  };
}
