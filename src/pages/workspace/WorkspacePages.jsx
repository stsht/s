import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { WorkspacePanels } from '../../components/WorkspacePanels.jsx';
import { Segmented, EmptyState, Combobox, DateTimeField } from '../../components/ui/index.js';
import { toTitleCase, onBlurTitleCase } from '../../utils/titleCase.js';
import { selectAllIfZero, parseMoneyInput, moneyInputValue } from '../../utils/moneyInput.js';
import { readProofFile, isProofViewable, isProofImage } from '../../utils/proofImage.js';
import { rupiah } from '../../utils/rupiah.js';
// Subscription feature code now lives in src/features/subscriptions.
// SubscriptionsPage (the /subs route) moved out entirely; the symbols
// below are still consumed by the /db Subs detail/import/edit flows
// that remain in this file, so they are imported back here.
import { SUBS_IMPORT_SERVICE_ALIASES } from '../../features/subscriptions/subscriptionConstants.js';
import {
  fmtSubsTime,
  safeSubsToken,
  todaySubs,
  addDays,
  loadTesseract,
  parseOcrText,
  subscriptionToCardProps,
} from '../../features/subscriptions/subscriptionUtils.js';
import { SubsPaidCard } from '../../features/subscriptions/SubsPaidCard.jsx';
import { SubsInvoiceCard } from '../../features/subscriptions/SubsInvoiceCard.jsx';

// Lightweight gated debug logger.
//
// Off by default in production. To enable: append ?debug=1 to any
// /db, /l, or /inv URL — the flag is sticky for the tab via
// sessionStorage so navigations between the three pages keep it
// hot. Used to trace the event-grouping handoff (rowEventKey →
// URL params → composer state → /api save body → /db row) when
// "Create Invoice from existing Links event" still produces a
// duplicate /db row. The function is a no-op when the flag is off
// so the calls are safe to leave in production code paths.
function dbgEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    const url = new URLSearchParams(window.location.search);
    if (url.get('debug') === '1') {
      try { window.sessionStorage?.setItem('starshots_debug_grouping', '1'); } catch {}
      return true;
    }
    return window.sessionStorage?.getItem('starshots_debug_grouping') === '1';
  } catch {
    return false;
  }
}

function dbg(...args) {
  if (dbgEnabled()) console.log('[grouping]', ...args);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dateLabel(value) {
  if (!value) return 'No date';
  const raw = String(value);
  // Anchor bare YYYY-MM-DD strings at noon UTC so the en-GB "DD MMM
  // YYYY" rendering doesn't drift one day in negative timezones.
  // Values that already carry a time component (ISO timestamps from
  // created_at, etc.) flow through new Date() unchanged.
  const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const date = isoDate ? new Date(`${raw}T12:00:00Z`) : new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Whether a string is a contact value worth showing under a client
// row. Used by /db's left list to scrub raw timestamps (e.g.
// "2026-05-17T13:08:21.123Z") and other non-contact metadata that
// previously leaked into the visible meta line. Accepts only the
// three shapes the design calls out: phone, Instagram handle/URL,
// or email. Anything else (ISO dates, normalized slugs, empty
// strings) is rejected and the meta line is hidden.
function isHumanReadableContact(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  // Discard timestamp-shaped strings outright. Both the full ISO
  // form and bare YYYY-MM-DD count — the dashboard never wants
  // these on a client card.
  if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(v)) return false;
  // Email — at least one '@' separating two non-empty halves.
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return true;
  // Instagram — handle (@name) or full instagram.com URL.
  if (/^@[a-zA-Z0-9._]+$/.test(v)) return true;
  if (/instagram\.com\//i.test(v)) return true;
  // Bare IG handles from existing rows, e.g. "lisofan". Require at
  // least one letter so numeric IDs/dates do not masquerade as contact.
  if (/^(?=.*[a-zA-Z])[a-zA-Z0-9._]{2,30}$/.test(v)) return true;
  // Phone — digits with optional +, spaces, dashes, parens. At
  // least 6 digits in total so 4-digit years can't masquerade.
  const digits = v.replace(/[^\d]/g, '');
  if (digits.length >= 6 && /^\+?[\d\s\-().]+$/.test(v)) return true;
  return false;
}

// Inline X glyph used by every list/row delete control on /db.
// Stroke-only path so the icon picks up `currentColor`, which lets
// CSS swap idle/hover palettes without touching the SVG markup.
function DeleteIcon() {
  return (
    <svg
      className="row-delete-icon"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4 4 L12 12 M12 4 L4 12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

// 2D stroke-only icons for the Subs detail action row. Sized to
// match the existing 14×14 close X so they read as a single icon
// family. Each icon picks up `currentColor` so the parent button's
// hover/armed palette flows through without per-icon overrides.
function EditIcon() {
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
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

// Checkmark glyph for the delivery "done" toggle. Same 14x14
// stroke-only family as EditIcon/TrashIcon so the header reads as
// one icon group; picks up the parent button's currentColor so the
// neutral (muted) and complete (blue) states flow through from CSS.
function CheckIcon() {
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
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function PrintIcon() {
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
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

function TrashIcon() {
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
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

// Plus glyph for the Subs detail "Add Extension" toolbar action.
// Same 14x14 stroke-only family as Edit/Print/Delete so the top
// action bar reads as one icon group.
function PlusIcon() {
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
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg
      className="btn-icon"
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
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M5 20h14" />
    </svg>
  );
}

function PaperIcon() {
  return (
    <svg
      className="btn-icon"
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function createRecordUrl(path, params) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return `${url.pathname}${url.search}`;
}

// Accept only bare YYYY-MM-DD date strings as a real event date.
// Timestamp-shaped values (e.g. created_at/updated_at "2026-05-17
// T13:08:21.123Z") are rejected so they don't leak into the
// /inv?eventDate= handoff URL where the type=date input would
// silently render blank. Returns the YYYY-MM-DD on hit, '' on miss.
function plainEventDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  // Already in YYYY-MM-DD form — pass through unchanged.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // Anything with a 'T' time component (ISO timestamp) is a
  // created_at/updated_at-style metadata field, not an event date.
  if (/T\d/.test(raw)) return '';
  return '';
}

// Today's date in Asia/Jakarta (UTC+7) as a bare YYYY-MM-DD string.
// /db Clients sorting and tone classify rows against the operator's
// local-Indonesia date so an event "today" in Jakarta reads the
// same regardless of which timezone the browser happens to be in.
// We can't rely on toLocaleDateString('en-CA', { timeZone: ... })
// in every target environment, so the calculation is done in plain
// UTC arithmetic: shift `now` by the WIB offset, then slice the
// ISO date portion. TBA / undated events never match this string,
// so a missing event_date is treated as neutral (not "today").
function jakartaTodayISO() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

// Whole-day delta between two YYYY-MM-DD strings (target - reference).
// Returns 0 for the same day, positive when target is later, negative
// when earlier. Used by the Clients tab to bucket event dates into
// "today/+2 = green", ">2 = normal", and "all past = expired".
function daysBetweenIso(referenceIso, targetIso) {
  const ref = String(referenceIso || '');
  const tgt = String(targetIso || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ref) || !/^\d{4}-\d{2}-\d{2}$/.test(tgt)) return NaN;
  const [ay, am, ad] = ref.split('-').map(Number);
  const [by, bm, bd] = tgt.split('-').map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / 86400000);
}

// Classify a client's event timeline into a list-row bucket + tone
// for the Clients tab. Rules (Asia/Jakarta date semantics):
//   - upcoming: at least one real event_date today or in the future.
//                  Sub-tones split the upcoming bucket so the row
//                  can colour-code how soon it is:
//                    'soon'   = nearest event today, +1, or +2 days
//                               (muted blue — needs imminent action),
//                    'future' = nearest event 3+ days out
//                               (muted green — scheduled, on track).
//                  sortKey   = nearest upcoming event_date (string).
//   - tba:      no real event_date present at all (TBA / undated).
//                  tone = 'tba'   (muted amber — needs scheduling).
//                  sortKey       = '' (alpha order applied later).
//   - past:     at least one event_date and ALL of them are past.
//                  tone = 'past'  (muted red — work is over).
//                  sortKey       = most recent past event_date.
//
// TBA / undated events are never coerced into "today" — they stay
// in the 'tba' bucket so a missing date doesn't accidentally turn
// blue or green. The four tones map 1:1 onto the date pill colours
// rendered next to the client name on the left list rows.
function classifyClientEvents(eventDates, todayIso) {
  const dates = Array.from(new Set((eventDates || [])
    .map(plainEventDate)
    .filter(Boolean)))
    .sort();
  if (dates.length === 0) {
    return { bucket: 'tba', tone: 'tba', sortKey: '', representativeDate: '' };
  }
  const upcoming = dates.filter((d) => d >= todayIso);
  if (upcoming.length === 0) {
    const last = dates[dates.length - 1];
    return { bucket: 'past', tone: 'past', sortKey: last, representativeDate: last };
  }
  const nearest = upcoming[0];
  const diff = daysBetweenIso(todayIso, nearest);
  const tone = Number.isFinite(diff) && diff >= 0 && diff <= 2 ? 'soon' : 'future';
  return { bucket: 'upcoming', tone, sortKey: nearest, representativeDate: nearest };
}

// Tone class for a single event_date relative to today in WIB.
// Mirrors the four tones produced by classifyClientEvents but for
// per-row use on the event-row (RecordRow) surface inside the
// client detail panel. Same palette, same semantics:
//   - 'past'   already happened          (muted red)
//   - 'tba'    no real date set          (muted amber)
//   - 'soon'   today/+1/+2 days WIB      (muted blue)
//   - 'future' more than 2 days out      (muted green)
//
// Accepts whatever shape the caller has (raw event_date column,
// already-sanitised YYYY-MM-DD, or empty); plainEventDate scrubs
// timestamp/garbage values to '' so they read as 'tba' instead of
// silently appearing as the current day.
function eventDateTone(eventDate, todayIso) {
  const date = plainEventDate(eventDate);
  if (!date) return 'tba';
  const diff = daysBetweenIso(todayIso, date);
  if (!Number.isFinite(diff)) return 'tba';
  if (diff < 0) return 'past';
  if (diff <= 2) return 'soon';
  return 'future';
}

// Compact label for the date pill on /db client rows + event rows.
// Examples: "1 Jun 2026", "29 May 2026", "TBA". Uses
// day:'numeric' (no leading zero) so the single-digit days read
// as "1 Jun" instead of "01 Jun" and the pill stays narrow.
function compactEventDateLabel(eventDate) {
  const date = plainEventDate(eventDate);
  if (!date) return 'TBA';
  const dt = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(dt.getTime())) return 'TBA';
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Generate a fresh per-event grouping key. Used by the /db Create
// Events sheet so the "Create Links" and "Create Invoice" choices
// inside the same sheet land on the same /db row regardless of
// which one the operator opens first. Falls back to a timestamp +
// random suffix when crypto.randomUUID is unavailable (older
// browsers); the worker only requires a stable string ≤ 80 chars,
// not a real UUID.
function generateEventKey() {
  try {
    const uuid = window.crypto?.randomUUID?.();
    if (uuid) return String(uuid).slice(0, 80);
  } catch {
    /* fall through */
  }
  const rand = Math.random().toString(36).slice(2, 10);
  return `evt-${Date.now().toString(36)}-${rand}`.slice(0, 80);
}

// Map a subscription row to one of three visual states.
//
// active  - currently in good standing — green.
// expired - expiry_date has already passed — red.
// warning - expiry_date within the next 3 days AND the row hasn't been
//           settled (status is anything other than paid/solved/closed
//           or one of the "recurring" status hints) — orange so
//           renewal stays visible.
//
// Recurring/renew/active/paid statuses always read as green when the
// subscription is not yet expired, even inside the 3-day warning
// window — the operator has already confirmed the row is being
// kept alive.
//
// The rule intentionally checks `expiry_date` only — `start_date`
// without an expiry is treated as still active. Returning a stable
// className lets the styling live in CSS.
const SUBS_SETTLED_STATUS_PATTERN = /recurring|renew|active|paid|solved|closed/;

function subscriptionTone(sub = {}) {
  const status = String(sub.status || '').toLowerCase();
  const isSettled = SUBS_SETTLED_STATUS_PATTERN.test(status);

  const expiryRaw = sub.expiry_date || '';
  if (!expiryRaw) return isSettled ? 'active' : 'warning';

  let expiryTimeRaw = String(sub.expiry_time || '23:59').trim() || '23:59';
  if (expiryTimeRaw.length === 5) expiryTimeRaw += ':00';

  const isoString = `${expiryRaw}T${expiryTimeRaw}+07:00`;
  const expiry = new Date(isoString);

  if (Number.isNaN(expiry.getTime())) return isSettled ? 'active' : 'warning';

  const now = Date.now();
  const diffDays = (expiry.getTime() - now) / 86400000;

  if (diffDays < 0 || status === 'revoked') return 'expired';

  if (!isSettled) return 'warning';

  return 'active';
}

// Apply an extension on top of a base subscription so the visible
// expiry/status/period/price/service reflect the most recent
// renewal. The base row keeps its own values for the printed
// receipt; only the *active* surface is overridden. Returns the
// subscription unchanged when no extension is supplied. Pure
// function so module-scope callers (SubscriptionDetail, the Subs
// list memos) can share it without prop drilling.
function applySubscriptionExtension(sub, extension) {
  if (!sub || typeof sub !== 'object') return sub;
  if (!extension || typeof extension !== 'object') return sub;
  return {
    ...sub,
    service: String(extension.service || '').trim() || sub.service,
    status: extension.status || sub.status,
    access_period: Number.isFinite(Number(extension.access_period)) && Number(extension.access_period) > 0
      ? Number(extension.access_period)
      : sub.access_period,
    bonus: Number.isFinite(Number(extension.bonus)) ? Number(extension.bonus) : (Number(sub.bonus) || 0),
    price: Number.isFinite(Number(extension.price)) ? Number(extension.price) : sub.price,
    start_date: extension.start_date || sub.start_date,
    start_time: extension.start_time || sub.start_time,
    expiry_date: extension.expiry_date || sub.expiry_date,
    expiry_time: extension.expiry_time || sub.expiry_time,
    // Payment date/time and proof follow the extension when it
    // carries them, so a per-extension (and the current/effective)
    // receipt prints the renewal's own payment moment rather than
    // the base subscription's. payment_proof is strictly per-period:
    // it is the extension's own proof (empty when the extension has
    // none) and never inherits the base proof.
    payment_date: extension.payment_date || sub.payment_date,
    payment_time: extension.payment_time || sub.payment_time,
    payment_proof: extension.payment_proof != null ? extension.payment_proof : '',
    // Notes are strictly per-period too: the effective view shows the
    // active period's own note (empty when the extension carries none)
    // and never inherits the base note.
    notes: extension.notes != null ? extension.notes : '',
  };
}

// Reconstruct a subscription's bonus days from its persisted dates:
//   bonus = (expiry_date - start_date) - access_period   (clamped >= 0)
// Used only as a fallback for rows that come back WITHOUT a stored
// bonus value — e.g. rows written before the `bonus` column existed,
// or on backends where a schema-cache fallback stripped the column on
// write (in which case the recomputed expiry_date still persists, so
// the bonus is recoverable from it). Because the edit form derives
// expiry = start + access_period + bonus, this inference is exact and
// idempotent: re-saving an inferred row reproduces the same expiry
// without stacking another day. access_period falls back to 30 to
// mirror the draft default so the arithmetic stays consistent.
function inferBonusDaysFromDates(sub = {}) {
  const start = plainEventDate(sub?.start_date);
  const expiry = plainEventDate(sub?.expiry_date);
  if (!start || !expiry) return 0;
  const periodRaw = Number(sub?.access_period);
  const period = Number.isFinite(periodRaw) && periodRaw > 0 ? periodRaw : 30;
  const span = daysBetweenIso(start, expiry);
  if (!Number.isFinite(span)) return 0;
  const bonus = span - period;
  return bonus > 0 ? bonus : 0;
}

// Resolve the bonus-days value for a subscription (or effective
// subscription / extension) row. The stored `bonus` field is the
// source of truth whenever it is present — an explicit value,
// including a deliberate 0, is always honoured and never overridden.
// Only when `bonus` is genuinely missing (null/undefined/'') do we
// fall back to inferring it from the persisted dates. This keeps the
// detail view and the edit draft showing the same persisted bonus and
// fixes the case where a saved bonus of 1 read back as 0.
function resolveBonusDays(sub = {}) {
  const raw = sub?.bonus;
  if (raw !== null && raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return inferBonusDaysFromDates(sub);
}

// Build a sortable "YYYY-MM-DDTHH:MM:SS" key for an extension so
// ties on the same expiry_date are broken by expiry_time. Falls
// back to start_date/time when the extension has no expiry yet,
// and to created_at as a last resort. Mixing date-only strings
// with ISO timestamps in the same key would mis-order rows, so
// every branch returns the same shape.
function subscriptionExtensionSortKey(ext) {
  const e = ext || {};
  if (e.expiry_date) {
    return `${e.expiry_date}T${e.expiry_time || '00:00:00'}`;
  }
  if (e.start_date) {
    return `${e.start_date}T${e.start_time || '00:00:00'}`;
  }
  return String(e.created_at || '');
}

// Pick the latest extension out of a list. Priority is:
//   1. expiry_date + expiry_time (highest wins — extends furthest
//      into the future)
//   2. start_date + start_time (fallback for extensions still
//      missing an expiry — operator typed only the start)
//   3. created_at (last resort so a fresh row still surfaces).
// See .kiro/steering/subscription-extensions.md for the full
// "next extension chains off the latest expiry" requirement.
function pickLatestSubscriptionExtension(list) {
  const arr = Array.isArray(list) ? list.slice() : [];
  if (!arr.length) return null;
  arr.sort((a, b) => {
    const aKey = subscriptionExtensionSortKey(a);
    const bKey = subscriptionExtensionSortKey(b);
    return bKey.localeCompare(aKey);
  });
  return arr[0];
}

// Initial draft shape used by the Subs detail panel's "Add /
// Edit Extension" form. Defined at module scope so the form can
// be re-seeded from the same source after a save / cancel /
// subscription swap.
//
// `latestExtension` is an optional 3rd parameter used purely for
// the Price autofill cascade when opening a brand-new extension
// (i.e. `extension` is null). The fallback chain is:
//   1. The `price` of the extension being edited (if any)
//   2. The `price` of the latest existing extension (if any)
//   3. The base subscription's `price` / `paid_amount` /
//      `amount` / `total` (whichever non-zero alias lands first)
//   4. Default to 0
// This keeps a fresh extension inheriting the most recent known
// price so the operator doesn't have to re-type Rp 50.000 on every
// renewal — manual overrides still win and propagate forward.
function makeExtensionDraft(subscription, extension, latestExtension) {
  const sub = subscription || {};
  const ext = extension || {};
  const latest = latestExtension || {};
  const period = Number(ext.access_period || sub.access_period || 30);
  const bonusRaw = ext.bonus != null ? Number(ext.bonus) : Number(sub.bonus);
  const bonus = Number.isFinite(bonusRaw) && bonusRaw >= 0 ? bonusRaw : 0;

  // Price cascade — see header comment above. We treat 0 / NaN as
  // "missing" so a real saved price always shows through.
  const extPrice = Number(ext.price);
  const latestPrice = Number(latest.price);
  const subPrice = Number(sub.price)
    || Number(sub.paid_amount)
    || Number(sub.amount)
    || Number(sub.total);
  let resolvedPrice = 0;
  if (Number.isFinite(extPrice) && extPrice > 0) {
    resolvedPrice = extPrice;
  } else if (Number.isFinite(latestPrice) && latestPrice > 0) {
    resolvedPrice = latestPrice;
  } else if (Number.isFinite(subPrice) && subPrice > 0) {
    resolvedPrice = subPrice;
  }

  return {
    service: String(ext.service || sub.service || '').trim(),
    status: String(ext.status || 'paid').toLowerCase(),
    access_period: Number.isFinite(period) && period > 0 ? period : 30,
    bonus,
    price: resolvedPrice,
    start_date: String(ext.start_date || ''),
    start_time: String(ext.start_time || ''),
    expiry_date: String(ext.expiry_date || ''),
    expiry_time: String(ext.expiry_time || ''),
    // Payment Date cascade — mirrors the Price cascade above. When
    // editing an existing extension we keep its own payment date;
    // for a brand-new extension the default follows the latest
    // payment in the chain (latest extension → base subscription),
    // so consecutive renewals inherit a midway-changed payment date.
    // The base subscription's own (Initial) payment date is never
    // mutated here — it stays the receipt of record.
    payment_date: String(ext.payment_date || latest.payment_date || sub.payment_date || ''),
    payment_time: String(ext.payment_time || latest.payment_time || sub.payment_time || ''),
    // Payment proof is strictly per-period: an edited extension keeps
    // its own proof; a brand-new extension starts blank (never
    // inherits the base/prior proof).
    payment_proof: String(ext.payment_proof || ''),
    // Notes are per-period (admin-facing); an edited extension keeps
    // its own note, a fresh extension starts blank.
    notes: String(ext.notes || ''),
    // Req2: an existing extension that already has a start date is
    // treated as "customized" so editing its payment date won't move
    // the start; a brand-new extension (no start yet) lets Start
    // follow Payment until the operator edits Start manually.
    start_customized: !!String(ext.start_date || ''),
  };
}

// Format the Subs-tab list meta from a subscription row. Produces
// just the service name, e.g. "ChatGPT" / "iCloud" / "Google Drive".
// The row already communicates state via two parallel surfaces — a
// tone-driven left-edge tint (subscriptionTone → .sub-active /
// .sub-warning / .sub-expired / .sub-tba) and the right-aligned
// expiry-date pill — so repeating the status word in the subtitle
// would be redundant. Falls back to "Subscription" when the row
// has no service name set, matching the empty-state language used
// elsewhere in the dashboard.
function formatSubscriptionMeta(sub = {}) {
  const service = String(sub.service || 'Subscription').trim();
  return service || 'Subscription';
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

function friendlyDbError(message) {
  const text = String(message || '').trim();
  if (!text) return 'Database request failed. Check API configuration.';
  // Map raw PostgREST/Supabase payloads (e.g. "{\"code\":\"PGRST125\",
  // \"message\":\"Invalid path specified in request URL\"}") onto a
  // short user-facing message. Anything that looks like a JSON blob
  // or carries a PGRSTxxx code is treated as backend noise and
  // redacted. Plain operator messages (e.g. "Unauthorized.") pass
  // through unchanged.
  if (/PGRST\d+/i.test(text)) return 'Database request failed. Check API configuration.';
  if (/^\s*\{[\s\S]*\}\s*$/.test(text)) return 'Database request failed. Check API configuration.';
  return text;
}

// useRemoteList: fetch the /api/db payload and expose a refetch hook
// so delete actions can refresh the dashboard without a full page
// reload. The `version` counter triggers re-runs of the effect on
// demand; the endpoint string is still the primary dependency so
// switching tabs / search query also re-fetches.
function useRemoteList(endpoint) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('Loading...');
  const [version, setVersion] = useState(0);
  const refetch = useCallback(() => setVersion((v) => v + 1), []);

  // Awaitable refresh. Performs the same /api/db fetch as the
  // mount/version effect below but returns a promise so callers
  // (e.g. the Delivery detail Refresh button) can surface
  // success/failure and know exactly when fresh data has landed.
  // It updates the shared `data`, so every panel derived from it
  // (selectedDelivery, the Clients/Subs lists) self-heals in place.
  const refresh = useCallback(async () => {
    const response = await fetch(endpoint, { credentials: 'same-origin' });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.ok === false) {
      const message = friendlyDbError(json.error || `Unable to load (${response.status}).`);
      setStatus(message);
      throw new Error(message);
    }
    setData(json);
    setStatus('');
    return json;
  }, [endpoint]);

  useEffect(() => {
    let alive = true;
    fetch(endpoint, { credentials: 'same-origin' })
      .then(async (response) => {
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          return { ok: false, error: json.error || `Unable to load (${response.status}).`, code: json.code };
        }
        return json;
      })
      .then((json) => {
        if (!alive) return;
        setData(json);
        if (json?.ok === false) {
          if (json.error) console.warn('[db] api error:', json.error, json.code || '');
          setStatus(friendlyDbError(json.error));
        } else {
          setStatus('');
        }
      })
      .catch((error) => {
        if (!alive) return;
        console.warn('[db] fetch error:', error);
        if (import.meta.env.DEV) {
          setStatus('API unavailable in Vite dev. Production data loads on Pages.');
        } else {
          setStatus(friendlyDbError(error?.message));
        }
      });
    return () => { alive = false; };
  }, [endpoint, version]);

  return { data, status, refetch, refresh };
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
const SUBSCRIPTION_STATUS_OPTIONS = [
  { value: 'paid', label: 'Paid' },
  { value: 'invoice', label: 'Invoice' },
];
const ACCESS_PERIOD_OPTIONS = [
  { value: '7', label: '7' },
  { value: '15', label: '15' },
  { value: '30', label: '30' },
];

function buildClientRecords(client, invoices, deliveries, todayIso) {
  // One real event = one row. Records are merged into a group when
  // any of these axes match a sibling already in the group:
  //   1. event_key matches event_key (preferred — the stable
  //      grouping key written by /l and /inv when launched from
  //      an existing /db row).
  //   2. one record's event_key === another record's id (cross-ref
  //      anchor: when the second tool was launched from a row that
  //      had no event_key yet, the new record carries the existing
  //      record's id as its event_key).
  //   3. both records have a non-empty event_date and they match —
  //      AND neither side already has a (different) event_key.
  //      event_key is authoritative: two records with conflicting
  //      event_keys must never merge just because they share a
  //      date, and conversely a TBA event (event_date='') stays in
  //      its own group even if another event for the same client
  //      happens to land on a real date.
  // No match -> a fresh group keyed by the record's own id.
  //
  // event_date and event_key are pulled per-record so a TBA event
  // (event_date='') can still group its delivery + invoice via
  // event_key alone, without inventing a date for grouping.
  //
  // The sort at the bottom is tone-aware (Asia/Jakarta date logic)
  // so the rendered row order matches the /db Clients list:
  //   1. upcoming events first, nearest event date ascending,
  //   2. TBA events next (alphabetical-stable by group order),
  //   3. past events last, most recent past first.
  // This puts the operator's next gig at the top of the client
  // detail panel and pushes already-finished events out of sight,
  // matching the same Asia/Jakarta semantics used on the left list.
  const groups = [];
  const clientId = String(client?.client_id || client?.id || '').trim();
  const clientName = String(client?.name || client?.client_name || '').trim().toLowerCase();
  const matches = (record) => {
    const recordClientId = String(record?.client_id || '').trim();
    const recordName = String(record?.client_name || record?.name || '').trim().toLowerCase();
    if (clientId && recordClientId && clientId === recordClientId) return true;
    return !!clientName && !!recordName && clientName === recordName;
  };

  function recordIdentifiers(record) {
    return {
      eventKey: String(record?.event_key || '').trim(),
      eventDate: plainEventDate(record?.event_date),
      recordId: String(record?.id || '').trim(),
    };
  }

  function findGroup({ eventKey, eventDate, recordId }) {
    return groups.find((g) => {
      const datesCompatible = !eventDate || !g.eventDates.size || g.eventDates.has(eventDate);
      // 1. Direct event_key match — the strongest signal.
      if (eventKey && g.eventKeys.has(eventKey)) return datesCompatible;
      // 2. Cross-ref: this record's event_key points at the
      //    sibling record's id (or vice versa). Used when one tool
      //    was launched from a row that did not yet carry an
      //    event_key, so the new save stamped the existing row's
      //    id as its event_key.
      if (eventKey && g.recordIds.has(eventKey)) return datesCompatible;
      if (recordId && g.eventKeys.has(recordId)) return datesCompatible;
      // 3. Date fallback — but only when event_key cannot
      //    adjudicate. If both sides carry a (different) event_key
      //    they are explicitly different events, and a coincidental
      //    same-day match must not merge them. event_key wins over
      //    date grouping, per the /db spec.
      if (eventDate && g.eventDates.has(eventDate)) {
        const recordHasKey = !!eventKey;
        const groupHasKey = g.eventKeys.size > 0;
        if (!recordHasKey || !groupHasKey) return true;
      }
      return false;
    });
  }

  function attach(record, kind) {
    const ids = recordIdentifiers(record);
    let group = findGroup(ids);
    if (!group) {
      group = {
        eventKey: '',
        eventDate: '',
        date: '',
        name: '',
        vendorName: '',
        title: '',
        contact: '',
        delivery: null,
        invoice: null,
        eventKeys: new Set(),
        eventDates: new Set(),
        recordIds: new Set(),
      };
      groups.push(group);
    }
    if (ids.eventKey) {
      group.eventKeys.add(ids.eventKey);
      if (!group.eventKey) group.eventKey = ids.eventKey;
    }
    if (ids.eventDate) {
      group.eventDates.add(ids.eventDate);
      if (!group.eventDate) group.eventDate = ids.eventDate;
    }
    if (ids.recordId) group.recordIds.add(ids.recordId);

    // Sort timestamp: prefer real event_date, then invoice_date,
    // then created_at. Take the latest seen so a delivery+invoice
    // pair sorts on the most recent activity. NOTE: this drives
    // ROW ORDER only — `group.eventDate` (the displayed value) is
    // populated separately above from real event_date columns
    // alone, so created_at/updated_at never leak into the visible
    // "TBA / DD MMM YYYY" label.
    const ts = record?.event_date || record?.invoice_date || record?.created_at || '';
    if (ts && (!group.date || (Date.parse(ts) || 0) > (Date.parse(group.date) || 0))) {
      group.date = ts;
    }
    const cName = String(record?.client_name || record?.name || '').trim();
    const cTitle = String(record?.client_title || record?.title || '').trim();
    const cContact = String(record?.client_contact || record?.contact || '').trim();
    const likelyVendorDelivery =
      kind === 'delivery'
      && !cTitle
      && !!clientName
      && !!cName
      && cName.toLowerCase() !== clientName;
    const isVendor = record?.type === 'vendor'
      || record?.invoice_type === 'vendor'
      || record?.invoice_data?.invoiceType === 'vendor'
      || likelyVendorDelivery;

    if (cName) {
      if (isVendor) {
        if (!group.vendorName) group.vendorName = cName;
      } else if (!group.name) {
        group.name = cName;
      }
    }
    if (!isVendor && cTitle && !group.title) {
      group.title = cTitle;
    }
    if (!isVendor && cContact && !group.contact) {
      group.contact = cContact;
    }

    if (kind === 'delivery') {
      if (record?.type === 'vendor') group.vendorDelivery = record;
      else group.delivery = record;
    }
    else if (record?.invoice_type === 'vendor' || record?.type === 'vendor' || record?.invoice_data?.invoiceType === 'vendor') group.vendorInvoice = record;
    else group.invoice = record;
  }

  // Process invoices first. Invoices tend to be the side that
  // carries an explicit event_key (operators set the event date in
  // /inv before they ever press Create Links), so by attaching
  // them first we seed each group with its event_key. A subsequent
  // delivery whose own event_key column was stripped — e.g. on a
  // pre-part-6 schema — can then still merge via the cross-ref
  // axis (delivery.recordId === invoice.eventKey or invoice.event
  // _data.delivery_id === delivery.id, both already surfaced as
  // effectiveEventKey by the worker's handleDbSearch).
  invoices.filter(matches).forEach((invoice) => attach(invoice, 'invoice'));
  deliveries.filter(matches).forEach((delivery) => attach(delivery, 'delivery'));

  return groups
    .map(({ eventKeys, eventDates, recordIds, ...rest }) => rest)
    .sort((a, b) => {
      // Tone-aware sort. Buckets:
      //   0 = upcoming (today/future event_date) — nearest first.
      //   1 = TBA (no real event_date at all) — preserve insertion
      //       order so a freshly-created TBA event stays put.
      //   2 = past (event_date already passed) — most recent past
      //       first so a recently-finished gig is easy to find.
      const today = todayIso || jakartaTodayISO();
      const bucketOf = (record) => {
        const d = plainEventDate(record.eventDate);
        if (!d) return 1;
        if (d >= today) return 0;
        return 2;
      };
      const ba = bucketOf(a);
      const bb = bucketOf(b);
      if (ba !== bb) return ba - bb;
      if (ba === 0) {
        // Upcoming: nearest event_date first (ascending).
        return String(a.eventDate || '').localeCompare(String(b.eventDate || ''));
      }
      if (ba === 2) {
        // Past: most recent past first (descending).
        return String(b.eventDate || '').localeCompare(String(a.eventDate || ''));
      }
      // TBA: fall back to the activity timestamp so the most
      // recently touched TBA event sits on top, and keep the
      // pre-existing newest-first order for stable presentation.
      return (Date.parse(b.date || '') || 0) - (Date.parse(a.date || '') || 0);
    });
}

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

function ClientDetail({ client, invoices, deliveries, onDeleteClient, onEditClient, onDeleteRecord, onViewLinks, onRefresh, onClose }) {
  const todayIso = useMemo(() => jakartaTodayISO(), []);
  const records = buildClientRecords(client, invoices, deliveries, todayIso);
  const title = client?.title ?? 'Ms.';
  const name = client?.name || client?.client_name || 'Client';
  const contact = client?.contact || client?.client_contact || '';

  // Create Events sheet. The big bottom "Create Events" pill from
  // earlier revisions is gone; pressing the (now compact) Create
  // Events trigger opens an inline sheet with two choices —
  // "Create Links" and "Create Invoice" — that share a single
  // freshly-generated event_key. Whichever side the operator
  // saves first stamps that event_key on its row, and the other
  // side groups onto the same /db row when it saves later.
  // Closing the sheet (cancel, or after picking an option)
  // discards the pending key so the next open starts a brand-new
  // event with its own grouping anchor.
  //
  // Event date is intentionally NOT defaulted here. /inv falls
  // through to an empty <input type="date"> when no eventDate
  // param is sent, /l keeps eventDateHandoff='' until the operator
  // types a folder, and the saved row carries event_date=''. Both
  // surfaces then read as "TBA" until the operator updates the
  // row. The spec is explicit that an unknown event date stays
  // TBA and never silently becomes today.
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingEventKey, setPendingEventKey] = useState('');
  const openCreateSheet = () => {
    setPendingEventKey(generateEventKey());
    setCreateOpen(true);
  };
  const closeCreateSheet = () => {
    setCreateOpen(false);
    setPendingEventKey('');
  };
  // Thread the parent client's stable id into both Create Events
  // hand-offs. /l + /inv forward it on the API save body so the
  // worker attaches the new delivery / invoice to THIS exact
  // clients row rather than name+contact-matching its way to a
  // (possibly duplicate) sibling. Empty for legacy buckets — the
  // server keeps its name/contact fallback for those rows. Sits
  // alongside eventKey, which still controls per-event grouping.
  const parentClientId = String(client?.client_id || '').trim();
  const newEventLinkHref = createRecordUrl('/l/', {
    title,
    name,
    contact,
    eventKey: pendingEventKey,
    clientId: parentClientId,
  });
  const newEventInvoiceHref = createRecordUrl('/inv/', {
    title,
    name,
    contact,
    eventKey: pendingEventKey,
    clientId: parentClientId,
  });

  return (
    <>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Client</p>
          <h2>{name}</h2>
          {contact ? <span>{contact}</span> : null}
        </div>
        <div className="detail-actions">
          <button
            type="button"
            className="toolbar-icon-btn"
            onClick={onRefresh}
            aria-label="Refresh client detail"
            title="Refresh"
          >
            <RefreshIcon />
          </button>
          <button
            type="button"
            className="toolbar-icon-btn"
            onClick={() => onEditClient?.(client)}
            aria-label="Edit client"
            title="Edit"
          >
            <EditIcon />
          </button>
          <button
            type="button"
            className="ghost-button compact db-delete-button"
            onClick={() => onDeleteClient?.(client)}
          >
            Delete Client
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
      <div className="record-stack">
        {records.map((row, index) => {
          // Stable per-event grouping key. Priority:
          //   1. row.eventKey (already populated by buildClientRecords
          //      when any record on the row carried event_key).
          //   2. delivery.id (the delivery acts as the cross-ref
          //      anchor — when /inv saves it stores delivery.id as
          //      its event_key, and on re-render they group).
          //   3. invoice.id (same idea for invoice-anchored rows).
          // The Create Events sheet above always passes a fresh
          // UUID so brand-new events never collide with these
          // anchor IDs.
          const rowEventKey = row.eventKey || row.delivery?.id || row.invoice?.id || row.vendorDelivery?.id || row.vendorInvoice?.id || '';
          const eventLinkHref = row.delivery?.id
            ? row.delivery.short_url || row.delivery.delivery_url || newEventLinkHref
            : createRecordUrl('/l/', {
                title: row.title || title,
                name: row.name || name,
                contact,
                eventDate: row.eventDate,
                eventKey: rowEventKey,
                // Forward the row's existing invoice id (when this
                // row is invoice-only). The /l worker reads it to
                // (a) patch the linked invoice's client_id when
                // missing, and (b) stamp invoice_data.delivery_id
                // for /db's cross-ref recovery when the new
                // delivery row's event_key column was stripped.
                invoiceId: row.invoice?.id || '',
                // Stable parent client id — keeps the new delivery
                // attached to THIS clients row instead of letting
                // the worker name/contact-match its way to a
                // duplicate sibling.
                clientId: parentClientId,
                folderName: row.delivery?.folder_name,
              });
          const eventInvoiceHref = row.invoice?.id
            ? createRecordUrl('/inv/', { invoiceId: row.invoice.id })
            : createRecordUrl('/inv/', {
                title: row.title || title,
                name: row.name || name,
                contact,
                eventDate: row.eventDate,
                eventKey: rowEventKey,
                clientId: parentClientId,
                folderName: row.delivery?.folder_name,
              });
          const eventVendorInvoiceHref = row.vendorInvoice?.id
            ? createRecordUrl('/inv/', { invoiceId: row.vendorInvoice.id, type: 'vendor' })
            : createRecordUrl('/inv/', {
                title: '',
                name: row.vendorName || String(row.name || name).replace(/^(Ms\.|Mr\.|Mrs\.|Family)\s+/i, '').trim(),
                contact,
                eventDate: row.eventDate,
                eventKey: rowEventKey,
                clientId: parentClientId,
                type: 'vendor',
                folderName: row.delivery?.folder_name,
                items: (() => {
                  try {
                    const data = row.invoice?.invoice_data && typeof row.invoice.invoice_data === 'object' ? row.invoice.invoice_data : {};
                    const itemsArr = Array.isArray(data.items) ? data.items : null;
                    if (itemsArr && itemsArr.length) {
                      return JSON.stringify(itemsArr.map((i) => ({ name: i.name, note: i.note, qty: i.qty })));
                    }
                  } catch {}
                  return undefined;
                })(),
              });
          const hasVendorDelivery = !!row.vendorDelivery?.id;
          const eventVendorDeliveryHref = hasVendorDelivery
            ? row.vendorDelivery.short_url || row.vendorDelivery.delivery_url || newEventLinkHref
            : createRecordUrl('/l/', {
                title: '',
                name: row.vendorName || String(row.name || name).replace(/^(Ms\.|Mr\.|Mrs\.|Family)\s+/i, '').trim(),
                contact,
                eventDate: row.eventDate,
                eventKey: rowEventKey,
                clientId: parentClientId,
                invoiceId: row.vendorInvoice?.id || '',
                type: 'vendor',
                folderName: row.delivery?.folder_name,
              });
          dbg('ClientDetail row', {
            recordKey: row.delivery?.id || row.invoice?.id || `${row.date}-${index}`,
            rowEventKey,
            rowEventDate: row.eventDate,
            hasDelivery: !!row.delivery?.id,
            hasInvoice: !!row.invoice?.id,
            eventLinkHref,
            eventInvoiceHref,
          });
          // A row's stable identity is delivery.id ?? invoice.id ?? date —
          // we use it to drive both the React key and the mobile "armed"
          // state (parent owns the armed-id so only one row at a time
          // can show its delete button on touch devices).
          const recordKey = row.delivery?.id || row.invoice?.id || row.vendorDelivery?.id || row.vendorInvoice?.id || `${row.date}-${index}`;
          return (
            <RecordRow
              key={recordKey}
              recordKey={recordKey}
              row={row}
              fallbackName={name}
              tone={eventDateTone(row.eventDate, todayIso)}
              eventLinkHref={eventLinkHref}
              eventInvoiceHref={eventInvoiceHref}
              eventVendorInvoiceHref={eventVendorInvoiceHref}
              eventVendorDeliveryHref={eventVendorDeliveryHref}
              onDelete={() => onDeleteRecord?.(row)}
              onViewLinks={onViewLinks}
            />
          );
        })}
        {!records.length ? <p className="empty-state">No events yet.</p> : null}
      </div>
      {createOpen ? (
        <div className="create-event-sheet" role="group" aria-label="Create event">
          <p className="create-event-eyebrow">New Event</p>
          <div className="create-event-choices">
            <a
              className="ghost-button compact"
              href={newEventLinkHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={closeCreateSheet}
            >
              Create Links
            </a>
            <a
              className="ghost-button compact"
              href={newEventInvoiceHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={closeCreateSheet}
            >
              Create Invoice
            </a>
          </div>
          <button
            type="button"
            className="ghost-button compact create-event-cancel"
            onClick={closeCreateSheet}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          className="ghost-button compact create-event-trigger"
          type="button"
          onClick={openCreateSheet}
        >
          Create Events
        </button>
      )}
    </>
  );
}

// One event row inside the client detail. The delete control is a
// permanent X glyph at the far right of the row — no hover/tap-to-
// reveal flow. The row's grid lays out date / name / View Links /
// View Invoice / X in that order; the X column is a fixed width so
// the inner action anchors shift left and never overlap the X. The
// row itself stays a plain shell (no click handler) so taps inside
// it never accidentally arm a delete; only the explicit X press
// triggers onDelete.
//
// View Links: when the row already has a saved delivery, the action
// is a button that swaps the right panel to the admin DeliveryDetail
// view (greeting + folder + password + short link + original GD/DB/
// WT/TN URLs). When there is no delivery yet, the action stays an
// anchor that opens /l/ to compose one. Styling for both shapes
// lives under .record-row a, .record-row button.record-row-link in
// invcs.css so they read as a single pill family.
//
// `tone` ('past' | 'tba' | 'soon' | 'future') is the Asia/Jakarta
// status of the event_date. It drives the row's date pill colour
// and a subtle accent on the row border so a row's status reads at
// a glance. The tone palette mirrors the four tones used on the
// /db Clients left list so both surfaces stay visually consistent.
function RecordRow({ recordKey, row, fallbackName, tone, eventLinkHref, eventInvoiceHref, eventVendorInvoiceHref, eventVendorDeliveryHref, onDelete, onViewLinks }) {
  const hasDelivery = !!row.delivery?.id;
  const hasInvoice = !!row.invoice?.id;
  const hasVendorInvoice = !!row.vendorInvoice?.id;
  const linkLabel = hasDelivery ? 'View Links' : 'Create Links';
  // Client Invoice handles public-facing retail pricing for the client.
  // Vendor Invoice / Vendor PO (to be implemented) will handle internal
  // cost/vendor pricing separately and must never be exposed on /g.
  const invoiceLabel = hasInvoice ? 'View Client Invoice' : 'Create Client Invoice';
  // Compact date pill on the row. row.eventDate is populated by
  // buildClientRecords from real event_date columns only
  // (plainEventDate strips ISO timestamps), so a created_at /
  // updated_at can never leak into this label — the fallback is
  // always literal "TBA", never today's date or the row's
  // bookkeeping timestamp.
  const dateText = compactEventDateLabel(row.eventDate);
  // Plain-text price beside the event name. Pulled off the linked
  // invoice when there is one — invoices carry the priced columns
  // (total / grand_total / price), deliveries don't. Same column
  // priority used by the legacy ListRow rendering further down so
  // /db consistently surfaces the same field across surfaces.
  // Rendered as plain text (not a pill/badge) and only when a
  // non-zero numeric value is present, so events that genuinely
  // have no price stay clean.
  const rawPrice = hasInvoice
    ? (row.invoice.total || row.invoice.grand_total || row.invoice.price)
    : '';
  const priceNumber = Number(rawPrice) || 0;
  const priceText = priceNumber > 0 ? rupiah(priceNumber) : '';
  // Green ("already created") vs blue ("complete") state for the
  // right-side action buttons.
  //   - delivery exists + not done  -> green  View Links  (is-created)
  //   - delivery exists + done      -> blue   View Links  (is-complete)
  //   - invoice  exists + not paid  -> green  View Invoice(is-created)
  //   - invoice  exists + paid      -> blue   View Invoice(is-complete)
  //   - missing record              -> neutral Create … pill (unchanged)
  // "done" comes from deliveries.delivery_done (db-migration-part-8);
  // "paid" from the invoice's own status. The two states are mutually
  // exclusive on a button so the CSS never has to fight specificity.
  const deliveryDone = !!row.delivery?.delivery_done;
  const invoicePaid = String(row.invoice?.status || '').toLowerCase() === 'paid';
  const linkStateClass = hasDelivery ? (deliveryDone ? ' is-complete' : ' is-created') : '';
  const invoiceStateClass = hasInvoice ? (invoicePaid ? ' is-complete' : ' is-created') : '';
  const linkClassName = `record-row-link${linkStateClass} record-row-pill record-row-pill--links`;
  const invoiceClassName = `record-row-link-anchor${invoiceStateClass} record-row-pill record-row-pill--invoice`;
  const linkAnchorClass = `record-row-link-anchor${linkStateClass} record-row-pill record-row-pill--links`;
  const vendorInvoicePaid = String(row.vendorInvoice?.status || '').toLowerCase() === 'paid';
  const vendorInvoiceStateClass = hasVendorInvoice ? (vendorInvoicePaid ? ' is-complete' : ' is-created') : ' is-neutral';
  const vendorInvoiceClassName = `record-row-link-anchor${vendorInvoiceStateClass}`;

  const hasVendorDelivery = !!row.vendorDelivery?.id;
  const vendorDeliveryDone = !!row.vendorDelivery?.delivery_done;
  const vendorDeliveryStateClass = hasVendorDelivery ? (vendorDeliveryDone ? ' is-complete' : ' is-created') : ' is-neutral';
  const vendorDeliveryClassName = `record-row-link-anchor${vendorDeliveryStateClass}`;

  // Row tone (and the date-pill colour) tracks ONLY the universal
  // delivery done/check state. When the top-level checkmark marks
  // the delivery done the event row goes neutral, regardless of
  // whether the client invoice is paid — invoice status drives the
  // invoice button/pill (is-complete) alone and never forces the
  // row red. An incomplete row keeps its soon/future colour, or
  // falls back to past/red.
  const isDeliveryComplete = deliveryDone;
  let rowTone = tone;
  if (isDeliveryComplete) {
    rowTone = '';
  } else if (tone !== 'soon' && tone !== 'future') {
    rowTone = 'past';
  }
  const toneClass = rowTone ? `event-tone-${rowTone}` : '';

  return (
    <article className={`record-row${toneClass ? ` ${toneClass}` : ''}`} data-key={recordKey}>
      <span className={`event-date-pill${toneClass ? ` ${toneClass}` : ''}`}>{dateText}</span>
      <div className="record-row-title">
        <strong>{fallbackName || row.name || 'Client'}</strong>
        {priceText ? <span className="record-row-price">{priceText}</span> : null}
      </div>
      <div className="record-row-action-group">
        {hasDelivery ? (
          <button
            type="button"
            className={linkClassName}
            onClick={(event) => {
              event.stopPropagation();
              onViewLinks?.(row.delivery);
            }}
          >
            {linkLabel}
          </button>
        ) : (
          <a className={linkAnchorClass} href={eventLinkHref} target="_blank" rel="noopener noreferrer">
            {linkLabel}
          </a>
        )}
        {hasVendorDelivery ? (
          <button
            type="button"
            className={`${vendorDeliveryClassName} record-row-vendor-addon`}
            onClick={(event) => {
              event.stopPropagation();
              onViewLinks?.(row.vendorDelivery);
            }}
            aria-label="View vendor links"
            title="View Vendor Links"
          >
            <LinkIcon />
          </button>
        ) : (
          <a
            className={`${vendorDeliveryClassName} record-row-vendor-addon`}
            href={eventVendorDeliveryHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Create vendor links"
            title="Create Vendor Links"
          >
            <LinkIcon />
          </a>
        )}
      </div>
      <div className="record-row-action-group">
        <a className={invoiceClassName} href={eventInvoiceHref} target="_blank" rel="noopener noreferrer">
          {invoiceLabel}
        </a>
        <a
          className={`${vendorInvoiceClassName} record-row-vendor-addon`}
          href={eventVendorInvoiceHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={hasVendorInvoice ? 'View vendor invoice' : 'Create vendor invoice'}
          title={hasVendorInvoice ? 'View Vendor Invoice' : 'Create Vendor Invoice'}
        >
          <PaperIcon />
        </a>
      </div>
      <button
        type="button"
        className="row-delete-x"
        onClick={(event) => {
          event.stopPropagation();
          onDelete?.();
        }}
        aria-label="Delete event"
      >
        <DeleteIcon />
      </button>
    </article>
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
  const t = String(title ?? 'Ms.').trim() ?? 'Ms.';
  const n = String(clientName || '').trim();
  const f = String(folderName || '').trim() || 'TBA';
  // compactEventDateLabel returns "6 Jun 2026" for a real
  // YYYY-MM-DD and "TBA" for a blank/timestamp value, so the Event
  // Date line always renders and never leaks a bookkeeping date.
  const ev = compactEventDateLabel(eventDate);
  const link = shortUrl || '(link unavailable)';
  const pass = String(password || '').trim() || '(no password)';

  if (deliveryDone) {
    return `Dear *${t} ${n}*,

Your StarShots files are now ready.

You may access them here:
*Folder:* ${f}
*Event Date:* ${ev}
*Link:* ${link}
*Password:* \`${pass}\`

Thank you for your patience.
With love, StarShots`;
  }

  return `Dear *${t} ${n}*,

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

// Inline circular refresh icon for the password regeneration
// button. Stroke-only path so the icon picks up `currentColor`,
// keeping the idle/hover/disabled palettes in CSS.
function RefreshIcon() {
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
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
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

function LinkIcon() {
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
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
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
  // Link-click events read as "Clicked Google Drive" / "Clicked
  // Dropbox" / "Clicked WeTransfer" so the operator sees exactly
  // which delivery service the visitor opened. A plain link click
  // with no service falls back to "Clicked Link".
  if (cleanType === 'service_click' || cleanType === 'button_click') {
    const nice = serviceLabel ? serviceLabel.replace(/\b\w/g, (c) => c.toUpperCase()) : '';
    return nice ? `Clicked ${nice}` : 'Clicked Link';
  }
  const labels = {
    password_success: 'Unlocked',
    password_failed: 'Wrong Password',
    admin_unlock: 'Admin Preview',
    admin_page_view: 'Admin Preview',
    page_view: 'Page Opened',
    invoice_view: 'Viewed Invoice',
    invoice_fullscreen: 'Opened Full Invoice',
    invoice_download: 'Downloaded Invoice',
    payment_bank_copy: 'Copied Bank Account',
    payment_qr_download: 'Downloaded QR',
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
  if (actor.key === 'meta') headline = 'Meta Preview';
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
  const [confirmRestoreHash, setConfirmRestoreHash] = useState('');
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

  const restoreNoButtonRef = useRef(null);

  useEffect(() => {
    if (confirmRestoreHash && restoreNoButtonRef.current) {
      restoreNoButtonRef.current.focus();
    }
  }, [confirmRestoreHash]);

  useEffect(() => {
    if (!confirmRestoreHash) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') setConfirmRestoreHash('');
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [confirmRestoreHash]);

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
      const hasIncomingHistory = Array.isArray(incoming.password_history)
        ? incoming.password_history.length > 0
        : String(incoming.password_history || '').trim().replace(/^\[\]$/, '').length > 0;
      const hasPrevHistory = Array.isArray(prev?.password_history)
        ? prev.password_history.length > 0
        : String(prev?.password_history || '').trim().replace(/^\[\]$/, '').length > 0;
      if (sameRow && ((!incomingPwd && prevPwd) || (!hasIncomingHistory && hasPrevHistory))) {
        return {
          ...incoming,
          password: !incomingPwd && prevPwd ? prev.password : incoming.password,
          password_history: !hasIncomingHistory && hasPrevHistory ? prev.password_history : incoming.password_history,
        };
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
    setConfirmRestoreHash('');
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

  let passwordHistory = [];
  try {
    const rawHist = currentDelivery?.password_history;
    if (typeof rawHist === 'string') passwordHistory = JSON.parse(rawHist);
    else if (Array.isArray(rawHist)) passwordHistory = rawHist;
  } catch(e){}
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
    const restorePassword = options.restorePassword || null;
    if (rotatePassword) setRotatingPassword(true);
    else setRepairing(true);
    setRepairStatus('');
    try {
      const response = await fetch('/api/db-repair-delivery', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentDelivery.id, rotatePassword, restorePassword }),
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
      setRepairStatus(restorePassword ? 'Password restored.' : (rotatePassword ? 'Password regenerated and hashed.' : 'Secure short link repaired.'));
      onRepaired?.(repaired);
    } catch (error) {
      setRepairStatus(error?.message || 'Repair failed.');
    } finally {
      setRepairing(false);
      setRotatingPassword(false);
    }
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
                  className="dd-open-button"
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
                <button
                  type="button"
                  className="dd-refresh-button"
                  onClick={() => setConfirmRotatePassword(true)}
                  disabled={rotatingPassword}
                  aria-label={rotatingPassword ? 'Regenerating Password' : 'Regenerate Password'}
                  title={rotatingPassword ? 'Regenerating Password' : 'Regenerate Password'}
                >
                  <RefreshIcon />
                </button>
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

          {passwordHistory.length > 0 && (
            <div className="dd-password-history" style={{ marginTop: '32px' }}>
              <p className="eyebrow" style={{ margin: '0 0 16px 0' }}>Password History</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
                {passwordHistory.map((hist, i) => {
                  const isConfirming = confirmRestoreHash === hist.password_hash;
                  return (
                    <div key={i} className="dd-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', background: 'var(--field)', borderRadius: '12px', border: '1px solid var(--line)' }}>
                      <div style={{ overflow: 'hidden', flex: '1 1 auto', paddingRight: '12px' }}>
                        <strong style={{ fontSize: '0.9375rem', color: 'var(--ink)', display: 'block', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{hist.password}</strong>
                        <span style={{ fontSize: '0.75rem', color: 'var(--mute)' }}>
                          {hist.rotated_at ? new Date(hist.rotated_at).toLocaleDateString() : 'Previous'}
                        </span>
                      </div>
                      {isConfirming && (
                        <div
                          className="dd-confirm-overlay"
                          style={{
                            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                            backgroundColor: 'rgba(0,0,0,0.5)',
                            zIndex: 9999,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            padding: '16px'
                          }}
                          onClick={() => setConfirmRestoreHash('')}
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
                          >
                            <h3 style={{ margin: '0 0 24px', fontSize: '1.25rem', color: 'var(--ink)' }}>Restore Password?</h3>
                            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                className="ghost-button compact"
                                onClick={() => setConfirmRestoreHash('')}
                                ref={restoreNoButtonRef}
                              >
                                No
                              </button>
                              <button
                                type="button"
                                className="ghost-button compact"
                                style={{ color: 'var(--accent-2, red)', borderColor: 'var(--accent-2, red)' }}
                                onClick={() => {
                                  setConfirmRestoreHash('');
                                  handleRepairDelivery({ restorePassword: hist });
                                }}
                              >
                                Restore
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                      {!isConfirming && (
                        <button type="button" className="ghost-button compact" style={{ padding: '0 16px', minHeight: '32px', flexShrink: 0 }} onClick={() => setConfirmRestoreHash(hist.password_hash)}>
                          Restore
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <section className="dd-access-log" aria-label="Delivery access timeline">
            <div className="dd-access-log-head">
              <p className="eyebrow">Access Timeline</p>
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
              <p className="dd-access-log-empty">No public activity yet.</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}

// Right-panel detail view for the Subs tab. Mirrors ClientDetail's
// chrome (heading + delete + close X) but the body is a flat tile
// stack of subscription fields. Reusing ClientDetail here would have
// shown "No events yet" because subscription-only clients have no
// invoice/delivery rows — that mismatch was the bug this view fixes.
//
// Create Invoice / Create Links are intentionally omitted: a
// subscription is a recurring service, not a one-off event, so
// those CTAs don't apply. The Subs page (/subs) is the canonical
// entry for editing/regenerating a subscription bill or receipt.
function SubscriptionDetail({ client, subscription, onEdit, onDeleteSubscription, onChanged, onClose }) {
  const name = client?.name || client?.client_name || subscription?.client_name || 'Client';
  const contact = client?.contact || client?.client_contact || subscription?.client_contact || '';

  // Extensions ride along on the subscription record from /api/db.
  // Compute the EFFECTIVE subscription (base + latest extension)
  // so the heading badge reflects the current renewal state.
  const extensions = Array.isArray(subscription?.extensions) ? subscription.extensions : [];
  const latestExtension = subscription?.latest_extension || pickLatestSubscriptionExtension(extensions);
  const effective = subscription ? applySubscriptionExtension(subscription, latestExtension) : null;
  const tone = effective ? subscriptionTone(effective) : '';

  const [expireConfirmOpen, setExpireConfirmOpen] = useState(false);
  const [expireDate, setExpireDate] = useState('');
  const [expireTime, setExpireTime] = useState('');
  const [expireBusy, setExpireBusy] = useState(false);
  const [expireStatus, setExpireStatus] = useState('');

  function openExpireConfirm() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    setExpireDate(`${y}-${m}-${d}`);
    const h = String(now.getHours()).padStart(2, '0');
    const mn = String(now.getMinutes()).padStart(2, '0');
    setExpireTime(`${h}:${mn}`);
    setExpireConfirmOpen(true);
  }

  async function handleExpire(event) {
    if (event) event.preventDefault();
    if (!subscription?.id) return;
    setExpireBusy(true);
    setExpireStatus('');
    try {
      const isExt = !!latestExtension;
      const target = isExt ? latestExtension : subscription;
      const endpoint = isExt ? '/api/subscription-extensions-save' : '/api/subscriptions-save';
      const payloadKey = isExt ? 'extension' : 'subscription';

      const payload = {
        ...target,
        status: 'expired',
        expiry_date: expireDate,
        expiry_time: expireTime,
      };

      if (isExt) {
        payload.subscription_id = subscription.id;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [payloadKey]: payload }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(json.error || `Save failed (${response.status}).`);
      }
      setExpireConfirmOpen(false);
      onChanged?.();
    } catch (error) {
      console.warn('Expire failed:', error);
      setExpireStatus(error?.message || 'Failed to expire.');
    } finally {
      setExpireBusy(false);
    }
  }

  // Unified, newest-first transaction history. The base subscription
  // is folded into the same list as an extension-like row (isBase:
  // true) so the rendered timeline shows every period at a glance —
  // the latest renewal pinned at the very top and the original
  // "Initial Purchase" sitting at the bottom. Shares the same sort
  // key (subscriptionExtensionSortKey) as pickLatestSubscriptionExtension
  // so the row pinned at the top is always the same row that drives
  // the `effective` subscription rendered in the top card above.
  //
  // Sort priority (all descending): expiry_date + expiry_time →
  // start_date + start_time → created_at. The base row carries no
  // created_at, so on a tie it naturally falls below a real
  // extension and lands at the bottom of the timeline. Stays a memo
  // so re-renders don't re-sort an already-stable array.
  const allPeriods = useMemo(() => {
    const basePeriod = {
      id: 'base_subscription',
      service: subscription?.service || '',
      status: subscription?.status || '',
      price: Number(subscription?.price)
        || Number(subscription?.paid_amount)
        || Number(subscription?.amount)
        || Number(subscription?.total)
        || 0,
      access_period: Number(subscription?.access_period) || 0,
      bonus: resolveBonusDays(subscription),
      start_date: subscription?.start_date || '',
      start_time: subscription?.start_time || '',
      expiry_date: subscription?.expiry_date || '',
      expiry_time: subscription?.expiry_time || '',
      payment_date: subscription?.payment_date || '',
      payment_time: subscription?.payment_time || '',
      payment_proof: subscription?.payment_proof || '',
      notes: subscription?.notes || '',
      isBase: true,
    };
    const rawExtensions = Array.isArray(subscription?.extensions) ? subscription.extensions : [];
    return [basePeriod, ...rawExtensions].sort((a, b) => {
      const aKey = subscriptionExtensionSortKey(a);
      const bKey = subscriptionExtensionSortKey(b);
      const cmp = bKey.localeCompare(aKey);
      if (cmp !== 0) return cmp;
      // Final tiebreak: created_at descending (newest first) so two
      // rows with identical expiry/start still land in a stable
      // newest-first order.
      const aCreated = String(a?.created_at || '');
      const bCreated = String(b?.created_at || '');
      return bCreated.localeCompare(aCreated);
    });
  }, [subscription]);

  // The top summary card already renders the CURRENT/active period
  // (base subscription + latest extension applied). Drop that exact
  // period from the history list below so the operator never sees the
  // same current period rendered twice (complaint #4). When an
  // extension is the latest, it's hidden here and shown only in the
  // top card; when there are no extensions the base row IS the card,
  // so the history collapses to "No extensions yet.".
  const currentPeriodId = latestExtension?.id || 'base_subscription';
  const visiblePeriods = useMemo(
    () => allPeriods.filter((p) => String(p.id) !== String(currentPeriodId)),
    [allPeriods, currentPeriodId],
  );

  // Top-card display reads from the EFFECTIVE subscription (base +
  // latest extension) so price, status, dates and access period
  // always reflect the current active/ongoing renewal rather than
  // stale base data. The base values stay visible at the bottom of
  // the transaction history (the isBase row in allPeriods).
  const statusRaw = String(effective?.status || '').trim();
  const statusLabel = statusRaw ? toTitleCase(statusRaw) : '';
  // Friendly tone label for the status badge — "Active" / "Expiring
  // Soon" / "Expired". Falls back to the raw status if no expiry-
  // derived tone applies.
  const toneLabel = tone === 'expired'
    ? 'Expired'
    : tone === 'warning'
      ? 'Expiring Soon'
      : tone === 'active'
        ? (statusLabel || 'Active')
        : '';
  const period = Number(effective?.access_period);
  const periodLabel = Number.isFinite(period) && period > 0 ? `${period} Days` : '';
  // Bonus is an integer add-on day count layered on top of the
  // access period (e.g. 30 + 1 → expiry stretches by one extra
  // day). Always shows in the detail panel (even at 0) so the
  // operator can see at a glance that no bonus was applied. Reads
  // from the effective subscription so a bonus carried by the
  // latest extension surfaces in the top card.
  const bonusDays = resolveBonusDays(effective);
  const bonusValue = Number.isFinite(bonusDays) && bonusDays >= 0 ? bonusDays : 0;
  const bonusLabel = `${bonusValue} ${bonusValue === 1 ? 'Day' : 'Days'}`;
  // Resolve the saved price defensively. The Subs schema only has
  // a single `price` column, but historical rows or other parsers
  // may have stamped the amount onto an alias (paid_amount /
  // amount / total) — read whichever non-zero value lands first
  // so a real Rp 50.000 shows up instead of "Rp 0". Mirrors the
  // formatting rule used by the extension list rows below
  // (`Number(ext.price) > 0 ? rupiah(...) : ''`) so the main
  // detail row drops out cleanly when no price was ever recorded.
  const priceValue = Number(effective?.price)
    || Number(effective?.paid_amount)
    || Number(effective?.amount)
    || Number(effective?.total)
    || 0;
  const priceLabel = priceValue > 0 ? rupiah(priceValue) : '';

  // Off-screen export card. We always render the appropriate card
  // for the saved subscription inside a .subs-export-host wrapper
  // (position:fixed at left:-10000px, ~760px wide for the paid card) so html2canvas
  // can rasterise a stable layout on Print without the operator
  // ever seeing the card on screen. cardProps mirrors what the
  // /subs live preview computes from local state, so the same JPG
  // comes out for both creation and re-print.
  const cardRef = useRef(null);
  // `printPeriod` selects which subscription period the off-screen
  // export card renders. null means the EFFECTIVE subscription (base
  // + latest extension) — i.e. the current active period — so the
  // toolbar Print button always prints the latest receipt. A specific
  // extension's effective subscription is swapped in when an
  // individual row's Print button is used. The export then captures
  // whatever the card currently shows.
  const [printPeriod, setPrintPeriod] = useState(null);
  const [printReq, setPrintReq] = useState(0);
  const [printStatus, setPrintStatus] = useState('');

  const exportSub = printPeriod || effective || subscription || {};
  const cardProps = useMemo(
    () => subscriptionToCardProps(exportSub),
    [exportSub],
  );
  const exportIsPaid = String(exportSub?.status || '').toLowerCase() === 'paid';

  // Queue a render-then-rasterise pass. Setting printPeriod swaps the
  // hidden export card's props; bumping printReq triggers the capture
  // effect AFTER React has committed the new card to the DOM, so the
  // JPG always matches the requested period.
  function requestPrint(periodSub) {
    setPrintPeriod(periodSub || null);
    setPrintReq((n) => n + 1);
  }

  function handlePrint() {
    // Toolbar print → current active period (effective subscription).
    requestPrint(null);
  }

  useEffect(() => {
    if (printReq === 0) return undefined;
    let cancelled = false;
    (async () => {
      if (!cardRef.current) return;
      setPrintStatus('Rendering JPG\u2026');
      if (document.fonts?.ready) {
        try { await document.fonts.ready; } catch {}
      }
      try {
        const canvas = await html2canvas(cardRef.current, {
          backgroundColor: '#ffffff',
          scale: Math.max(3, Math.min(4, (window.devicePixelRatio || 2) * 2)),
          useCORS: true,
          allowTaint: true,
          imageTimeout: 0,
          logging: false,
          // Paid receipt is a balanced ~4:3 card — pin a desktop
          // viewport so it never collapses into the <1024px mobile
          // layout during rasterisation. Invoice stays portrait.
          windowWidth: exportIsPaid ? 1120 : 800,
          windowHeight: exportIsPaid ? 840 : 1200,
        });
        if (cancelled) return;
        const filePrefix = exportIsPaid ? 'subscription-paid' : 'subscription-invoice';
        const link = document.createElement('a');
        link.download = `${filePrefix}-${safeSubsToken(exportSub?.service) || 'service'}-${safeSubsToken(exportSub?.client_name || subscription?.client_name) || 'client'}.jpg`;
        link.href = canvas.toDataURL('image/jpeg', 1.0);
        link.click();
        if (!cancelled) setPrintStatus('JPG ready.');
      } catch (error) {
        console.warn('[db/subs] print failed:', error);
        if (!cancelled) setPrintStatus(error?.message || 'Failed to render JPG.');
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printReq]);

  // Display-time format helpers. Detail rows use the en-GB short
  // date (now TZ-safe via dateLabel) and the receipt's HH.MM time
  // form so a single saved value reads the same in the detail
  // panel and on the printed card.
  const fmtTime = (v) => (v ? fmtSubsTime(v) : '');
  const fmtDate = (v) => (v ? dateLabel(v) : '');
  // Combined "date · time" formatter — produces "15 Apr 2026 · 19.09"
  // when both halves exist, or whichever half exists alone, or "" if
  // neither does. Returning an empty string lets the .filter() below
  // drop the row entirely instead of showing a stub line.
  const fmtDateTime = (date, time) => {
    const d = fmtDate(date);
    const t = fmtTime(time);
    if (d && t) return `${d} \u00b7 ${t}`;
    return d || t;
  };

  // Compact pills under the client name: Service · Status · Period.
  // Only non-empty values render so a partial row doesn't show empty
  // bubbles. The Expired/Active/Expiring Soon tone badge stays beside
  // the <h2> name (rendered separately above).
  const headingPills = [
    effective?.service ? String(effective.service).trim() : '',
    // statusLabel intentionally omitted — the colored status badge
    // beside the <h2> name already conveys Paid/Unpaid, so repeating
    // it as a colorless pill in the meta bar below is redundant.
    periodLabel,
  ].filter(Boolean);

  // Delete confirmation lives inside the detail panel only — the
  // left-panel row X stays a one-tap delete per spec. First click
  // arms the button (label + tone change), a second click within
  // ~4s issues the delete via the parent. Auto-disarms on timeout
  // or close so an accidental press doesn't sit in a hot state.
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!confirmDelete) return undefined;
    const id = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(id);
  }, [confirmDelete]);
  // Reset the armed state if the parent swaps to a different
  // subscription while this component stays mounted.
  useEffect(() => {
    setConfirmDelete(false);
  }, [subscription?.id]);

  function handleDeleteClick() {
    if (!subscription?.id) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setConfirmDelete(false);
    onDeleteSubscription?.(subscription);
  }

  // ── Extensions state ───────────────────────────────────────────
  // Subs-side renewal history. Each extension is its own row in
  // public.subscription_extensions; the latest one drives the
  // Subs-list visible status/expiry. The base subscription's
  // own Payment / Start / Expiry stay as the receipt of record.
  const [extensionFormOpen, setExtensionFormOpen] = useState(false);
  const [editingExtensionId, setEditingExtensionId] = useState('');
  const [extensionDraft, setExtensionDraft] = useState(() => makeExtensionDraft(subscription, latestExtension, latestExtension));
  const [extensionBusy, setExtensionBusy] = useState(false);
  const [extensionStatus, setExtensionStatus] = useState('');
  const [extensionStatusTone, setExtensionStatusTone] = useState('');
  // Req6: which period/extension row is expanded inline. Empty = all
  // collapsed (compact). Toggled by clicking the row body — no arrow
  // affordance; the whole summary acts as the expand/collapse target.
  const [expandedPeriodId, setExpandedPeriodId] = useState('');

  // Reset the extension form whenever the parent swaps to a
  // different subscription so it doesn't carry stale draft state
  // across rows.
  useEffect(() => {
    setExtensionFormOpen(false);
    setEditingExtensionId('');
    setExtensionDraft(makeExtensionDraft(subscription, latestExtension, latestExtension));
    setExtensionStatus('');
    setExtensionStatusTone('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscription?.id]);

  function setExtensionField(key, value) {
    setExtensionDraft((current) => {
      const next = { ...current, [key]: value };
      // Req2 (extensions): Start mirrors Payment date/time until the
      // operator manually edits Start, which latches start_customized.
      if (key === 'start_date' || key === 'start_time') {
        next.start_customized = true;
      }
      const followingPayment = !current.start_customized
        && (key === 'payment_date' || key === 'payment_time');
      if (followingPayment) {
        if (key === 'payment_date') next.start_date = value;
        if (key === 'payment_time') next.start_time = value;
      }
      // Period/bonus/start edits are authoritative: recompute expiry
      // from start + access period + bonus immediately. Manual expiry
      // edits still work, but the next period/bonus/start edit resets
      // it to the formula the operator is asking for. A Payment edit
      // that is mirrored into Start recomputes expiry the same way.
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
    });
  }

  function openAddExtension() {
    // Seed the new extension off the EFFECTIVE subscription so a
    // renewal chains to the latest known expiry. `effective`
    // already merges the latest extension into the base row (via
    // applySubscriptionExtension), so `effective.expiry_*` is
    // automatically:
    //   1. latest extension expiry, if any extension exists, else
    //   2. base subscription expiry, else
    //   3. empty — and we fall back to today.
    // See .kiro/steering/subscription-extensions.md for the full
    // requirement. Operators can still override every field.
    //
    // Price is resolved through the same cascade makeExtensionDraft
    // implements (latest extension price → base subscription price
    // aliases → 0) so a fresh extension inherits the most recent
    // known price without manual retyping. Bonus defaults to 0 for
    // a new extension; the operator can layer extra days on top.
    const seedDraft = makeExtensionDraft(subscription, null, latestExtension);
    const seedStart = effective?.expiry_date || todaySubs();
    const seedStartTime = effective?.expiry_date ? (effective?.expiry_time || '') : '';
    const period = Number(effective?.access_period) || 30;
    const bonus = 0;
    const seedExpiry = addDays(seedStart, period + bonus) || '';
    // Payment Date default follows the latest payment in the chain:
    // latest extension's payment date → base subscription's payment
    // date → today. seedDraft already resolves the cascade; we only
    // add today as a final fallback so a fresh extension never opens
    // with an empty Payment Date. The base (Initial) payment date is
    // never changed — this only seeds the NEW extension's default.
    const seedPaymentDate = seedDraft.payment_date || todaySubs();
    const seedPaymentTime = seedDraft.payment_date ? seedDraft.payment_time : '';
    setExtensionDraft({
      ...seedDraft,
      service: effective?.service || seedDraft.service || '',
      status: 'paid',
      access_period: period,
      bonus,
      start_date: seedStart,
      start_time: seedStartTime,
      expiry_date: seedExpiry,
      expiry_time: seedStartTime,
      payment_date: seedPaymentDate,
      payment_time: seedPaymentTime,
    });
    setEditingExtensionId('');
    setExtensionStatus('');
    setExtensionStatusTone('');
    setExtensionFormOpen(true);
  }

  function openEditExtension(ext) {
    setExtensionDraft(makeExtensionDraft(subscription, ext, latestExtension));
    setEditingExtensionId(String(ext?.id || ''));
    setExtensionStatus('');
    setExtensionStatusTone('');
    setExtensionFormOpen(true);
  }

  function closeExtensionForm() {
    setExtensionFormOpen(false);
    setEditingExtensionId('');
    setExtensionStatus('');
    setExtensionStatusTone('');
  }

  async function saveExtension(event) {
    event.preventDefault();
    if (!subscription?.id) return;
    setExtensionBusy(true);
    setExtensionStatus('Saving\u2026');
    setExtensionStatusTone('');
    try {
      const payload = {
        ...extensionDraft,
        subscription_id: subscription.id,
        ...(editingExtensionId ? { id: editingExtensionId } : {}),
      };
      const response = await fetch('/api/subscription-extensions-save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extension: payload }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(json.error || `Save failed (${response.status}).`);
      }
      setExtensionFormOpen(false);
      setEditingExtensionId('');
      setExtensionStatus('');
      onChanged?.();
    } catch (error) {
      setExtensionStatus(error?.message || 'Save failed.');
      setExtensionStatusTone('error');
    } finally {
      setExtensionBusy(false);
    }
  }

  async function deleteExtension(ext) {
    if (!ext?.id) return;
    try {
      const response = await fetch('/api/subscription-extensions-delete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ext.id }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(json.error || `Delete failed (${response.status}).`);
      }
      onChanged?.();
    } catch (error) {
      console.warn('[subs/ext] delete failed:', error);
    }
  }

  // Build the per-field values needed by the explicit JSX layout
  // below. Storage and Contact stay as standalone rows because they
  // don't participate in the date/price grid groups. Title is no
  // longer rendered as its own row — the prefix (Mr./Ms.) is woven
  // directly into the <h2> heading instead, matching the "Ms. Linda"
  // shape called out in the spec.
  const storageValue = String(subscription?.storage_slot || subscription?.storage || '').trim();
  // Payment Date on the top card reflects the CURRENT/active period:
  // the latest extension's payment date when one exists, otherwise
  // the base subscription's (Initial) payment date. The base row's
  // own payment date is never mutated — it stays visible as the
  // Initial receipt of record in the history below. Start/Expiry
  // likewise read from the effective subscription so the top card
  // shows the current active window.
  const paymentValue = fmtDateTime(
    latestExtension?.payment_date || subscription?.payment_date,
    latestExtension?.payment_date ? latestExtension?.payment_time : subscription?.payment_time,
  );
  const startValue = fmtDateTime(effective?.start_date, effective?.start_time);
  const expiryValue = fmtDateTime(effective?.expiry_date, effective?.expiry_time);
  // Payment proof for the CURRENT/active period: latest extension's
  // proof when extended, else the base subscription's. Only rendered
  // when present so the panel stays clean for proof-less records.
  const proofValue = String(effective?.payment_proof || '').trim();
  const proofIsUrl = isProofViewable(proofValue);
  // Admin-facing note for the current/active period (per-period; the
  // effective view already resolves the latest extension's own note).
  const notesValue = String(effective?.notes || '').trim();
  // Composed h2 label: "<title> <client_name>" — e.g. "Ms. Linda" or
  // "Mr. Fenny Sofian". Falls back to the client name alone when no
  // title prefix is set, so a row missing a title prefix still reads
  // cleanly without a leading space.
  const titlePrefix = String(subscription?.client_title || '').trim();
  const headingName = titlePrefix ? `${titlePrefix} ${name}` : name;
  // Whether any of the row groups have at least one populated cell.
  // If every grouped field is empty we fall through to the "No
  // subscription details available." copy so the panel doesn't show
  // a stack of blank label boxes.
  const hasAnyDetailRow = Boolean(
    storageValue || priceLabel || paymentValue || startValue || expiryValue || periodLabel || contact || proofValue || notesValue
  );

  return (
    <>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Subscription</p>
          <h2>
            {headingName}
            {tone && toneLabel ? (
              <span className={`sub-badge sub-badge-${tone}`}>{toneLabel}</span>
            ) : null}
          </h2>
          {headingPills.length ? (
            <div className="sub-meta-pills">
              {headingPills.map((label) => (
                <span className="sub-pill" key={label}>{label}</span>
              ))}
            </div>
          ) : null}
          {contact ? <span>{contact}</span> : null}
        </div>
        <div className="detail-actions subs-detail-actions">
          <button
            type="button"
            className="toolbar-icon-btn"
            onClick={onChanged}
            aria-label="Refresh subscription detail"
            title="Refresh"
          >
            <RefreshIcon />
          </button>
          {subscription?.id && !extensionFormOpen ? (
            <button
              type="button"
              className="toolbar-icon-btn"
              onClick={openAddExtension}
              aria-label="Add extension"
              title="Add Extension"
            >
              <PlusIcon />
            </button>
          ) : null}
          {subscription?.id ? (
            <button
              type="button"
              className="toolbar-icon-btn"
              onClick={() => onEdit?.(subscription)}
              aria-label="Edit subscription"
              title="Edit"
            >
              <EditIcon />
            </button>
          ) : null}
          {subscription?.id ? (
            <button
              type="button"
              className="toolbar-icon-btn"
              onClick={handlePrint}
              aria-label="Print subscription"
              title="Print"
            >
              <PrintIcon />
            </button>
          ) : null}
          {subscription?.id ? (
            <button
              type="button"
              className={`toolbar-icon-btn toolbar-icon-btn--danger${confirmDelete ? ' armed' : ''}`}
              onClick={handleDeleteClick}
              aria-pressed={confirmDelete}
              aria-label={confirmDelete ? 'Confirm delete subscription' : 'Delete subscription'}
              title={confirmDelete ? 'Confirm Delete' : 'Delete'}
            >
              <TrashIcon />
            </button>
          ) : null}
          {subscription?.id && tone !== 'expired' ? (
            <button
              type="button"
              className="toolbar-icon-btn toolbar-icon-btn--danger"
              onClick={openExpireConfirm}
              aria-label="Expire subscription now"
              title="Expire Now"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="6" x2="12" y2="12" />
                <line x1="12" y1="12" x2="16" y2="14" />
              </svg>
            </button>
          ) : null}
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
      {expireConfirmOpen ? (
        <form className="expire-confirm-form" onSubmit={handleExpire}>
          <p className="expire-confirm-title">Expire access now?</p>
          <div className="two-col">
            <label>Expiry Date
              <input type="date" value={expireDate} onChange={(e) => setExpireDate(e.target.value)} required />
            </label>
            <label>Expiry Time
              <input type="time" value={expireTime} onChange={(e) => setExpireTime(e.target.value)} required />
            </label>
          </div>
          {expireStatus ? <p className="download-status lg-status-error">{expireStatus}</p> : null}
          <div className="client-actions">
            <button type="submit" className="primary-button" disabled={expireBusy} style={{ background: 'var(--sub-expired)', borderColor: 'var(--sub-expired)' }}>
              {expireBusy ? 'Expiring\u2026' : 'Expire'}
            </button>
            <button type="button" className="ghost-button compact" onClick={() => { setExpireConfirmOpen(false); setExpireStatus(''); }} disabled={expireBusy}>Cancel</button>
          </div>
        </form>
      ) : null}
      {!subscription ? (
        <p className="empty-state">No subscription details available.</p>
      ) : (
        <div className={`list-stack${tone ? ` sub-${tone}` : ''}`}>
          {/* Storage stays as a standalone full-width row; it isn't
              part of any natural pair and only renders when set. */}
          {storageValue ? (
            <article className="list-row" key="Storage">
              <div>
                <strong>Storage</strong>
                <span>{storageValue}</span>
              </div>
            </article>
          ) : null}
          {/* Row 1 — Price + Payment Date. Renamed from "Paid Amount"
              and "Payment" so the labels read consistently on both
              invoice and paid-mode rows. */}
          {(priceLabel || paymentValue) ? (
            <div className="subs-detail-row-group" key="row-price-payment">
              <article className="list-row">
                <div>
                  <strong>Price</strong>
                  <span>{priceLabel || '—'}</span>
                </div>
              </article>
              <article className="list-row">
                <div>
                  <strong>Payment Date</strong>
                  <span>{paymentValue || '—'}</span>
                </div>
              </article>
            </div>
          ) : null}
          {/* Row 2 — Start Date + Expiry Date. Both share the same
              datetime format helper so the cells line up neatly on
              desktop and stack as a single column on mobile. */}
          {(startValue || expiryValue) ? (
            <div className="subs-detail-row-group" key="row-start-expiry">
              <article className="list-row">
                <div>
                  <strong>Start Date</strong>
                  <span>{startValue || '—'}</span>
                </div>
              </article>
              <article className="list-row">
                <div>
                  <strong>Expiry Date</strong>
                  <span>{expiryValue || '—'}</span>
                </div>
              </article>
            </div>
          ) : null}
          {/* Row 3 — Access Period + Bonus. Both are always shown
              (even at 0 days) so the operator can see at a glance
              that no bonus was applied and the renewal is using the
              raw access period only. */}
          <div className="subs-detail-row-group" key="row-period-bonus">
            <article className="list-row">
              <div>
                <strong>Access Period</strong>
                <span>{periodLabel || '0 Days'}</span>
              </div>
            </article>
            <article className="list-row">
              <div>
                <strong>Bonus</strong>
                <span>{bonusLabel}</span>
              </div>
            </article>
          </div>
          {contact ? (
            <article className="list-row" key="Contact">
              <div>
                <strong>Contact</strong>
                <span>{contact}</span>
              </div>
            </article>
          ) : null}
          {proofValue ? (
            <article className="list-row" key="PaymentProof">
              <div>
                <strong>Payment Proof</strong>
                {proofIsUrl ? (
                  <a
                    className="subs-proof-link"
                    href={proofValue}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View proof
                  </a>
                ) : (
                  <span>{proofValue}</span>
                )}
              </div>
            </article>
          ) : null}
          {notesValue ? (
            <article className="list-row" key="Notes">
              <div>
                <strong>Notes</strong>
                <span className="subs-detail-notes">{notesValue}</span>
              </div>
            </article>
          ) : null}
          {!hasAnyDetailRow ? <p className="empty-state">No subscription details available.</p> : null}
        </div>
      )}
      {subscription?.id ? (
        <section className="subs-extensions" aria-label="Subscription extensions">
          <div className="subs-extensions-head">
            <p className="eyebrow">Extensions</p>
          </div>
          {extensionFormOpen ? (
            <form className="form-stack subs-extension-form" onSubmit={saveExtension}>
              <p className="subs-extension-form-eyebrow">
                {editingExtensionId ? 'Edit Extension' : 'New Extension'}
              </p>
              <label>Service
                <input
                  value={extensionDraft.service}
                  onChange={(e) => setExtensionField('service', e.target.value)}
                  placeholder={subscription?.service || 'ChatGPT, iCloud, Google Drive\u2026'}
                />
              </label>
              <div className="two-col">
                <label>Status
                  <Combobox
                    value={extensionDraft.status}
                    options={SUBSCRIPTION_STATUS_OPTIONS}
                    placeholder="Status"
                    ariaLabel="Extension status"
                    onChange={(value) => setExtensionField('status', value)}
                  />
                </label>
                <label>Access Period (Days)
                  <Combobox
                    value={String(extensionDraft.access_period)}
                    options={[...ACCESS_PERIOD_OPTIONS, ...([7, 15, 30].includes(Number(extensionDraft.access_period))
                      ? []
                      : [{ value: String(extensionDraft.access_period), label: `${extensionDraft.access_period} (custom)` }])]}
                    placeholder="Days"
                    ariaLabel="Extension access period"
                    onChange={(value) => setExtensionField('access_period', Number(value) || 0)}
                  />
                </label>
              </div>
              <label>Bonus (Days)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={extensionDraft.bonus}
                  onChange={(e) => setExtensionField('bonus', Number(e.target.value) || 0)}
                  aria-label="Extension bonus days"
                />
              </label>
              <div className="two-col">
                <label>Start
                  <DateTimeField
                    value={extensionDraft.start_date}
                    onChange={(value) => setExtensionField('start_date', value)}
                    timeValue={extensionDraft.start_time}
                    onTimeChange={(value) => setExtensionField('start_time', value)}
                    withTime
                    ariaLabel="Extension start"
                  />
                </label>
                <label>Expiry
                  <DateTimeField
                    value={extensionDraft.expiry_date}
                    onChange={(value) => setExtensionField('expiry_date', value)}
                    timeValue={extensionDraft.expiry_time}
                    onTimeChange={(value) => setExtensionField('expiry_time', value)}
                    withTime
                    ariaLabel="Extension expiry"
                  />
                </label>
              </div>
              <label>Notes (Optional)
                <textarea
                  value={extensionDraft.notes || ''}
                  onChange={(e) => setExtensionField('notes', e.target.value)}
                  rows={2}
                  placeholder="Internal note for this period (optional)"
                  aria-label="Extension notes"
                />
              </label>
              <div className="two-col">
                <label>Payment Date
                  <DateTimeField
                    value={extensionDraft.payment_date}
                    onChange={(value) => setExtensionField('payment_date', value)}
                    timeValue={extensionDraft.payment_time}
                    onTimeChange={(value) => setExtensionField('payment_time', value)}
                    withTime
                    ariaLabel="Extension payment date"
                  />
                </label>
                <label>Price (IDR)
                  <input
                    type="text"
                    inputMode="numeric"
                    value={moneyInputValue(extensionDraft.price)}
                    placeholder="0"
                    onChange={(e) => setExtensionField('price', parseMoneyInput(e.target.value))}
                    aria-label="Extension price in rupiah"
                  />
                </label>
              </div>
              <ProofField
                value={extensionDraft.payment_proof}
                onChange={(v) => setExtensionField('payment_proof', v)}
                ariaLabel="Extension payment proof"
              />
              {extensionStatus ? (
                <p className={`download-status${extensionStatusTone ? ` lg-status-${extensionStatusTone}` : ''}`}>
                  {extensionStatus}
                </p>
              ) : null}
              <div className="client-actions">
                <button className="primary-button" type="submit" disabled={extensionBusy}>
                  {extensionBusy ? 'Saving\u2026' : (editingExtensionId ? 'Save Changes' : 'Save Extension')}
                </button>
                <button className="ghost-button compact" type="button" onClick={closeExtensionForm}>Cancel</button>
              </div>
            </form>
          ) : null}
          {visiblePeriods.length ? (
            <div className="list-stack subs-extension-list">
              {visiblePeriods.map((ext) => {
                const extEffective = applySubscriptionExtension(subscription, ext);
                const extToneCls = subscriptionTone(extEffective);
                const startLabel = ext.start_date ? `${dateLabel(ext.start_date)}${ext.start_time ? ` \u00b7 ${fmtSubsTime(ext.start_time)}` : ''}` : '';
                const expiryLabel = ext.expiry_date ? `${dateLabel(ext.expiry_date)}${ext.expiry_time ? ` \u00b7 ${fmtSubsTime(ext.expiry_time)}` : ''}` : '';
                const periodLabel = Number(ext.access_period) > 0 ? `${ext.access_period} Days` : '';
                const priceLabelExt = Number(ext.price) > 0 ? rupiah(ext.price) : '';
                const statusLabelExt = ext.status ? toTitleCase(ext.status) : '';
                // Bonus segment: only render when > 0 so the row stays
                // clean when no bonus was applied. Singular "Day" for
                // 1, plural "Days" otherwise.
                const bonusDaysExt = Number(ext.bonus);
                const bonusLabelExt = Number.isFinite(bonusDaysExt) && bonusDaysExt > 0
                  ? `Bonus ${bonusDaysExt} ${bonusDaysExt === 1 ? 'Day' : 'Days'}`
                  : '';
                // Base subscription gets a trailing "Initial" chip so
                // the bottom row of the timeline reads as the original
                // purchase rather than a renewal.
                const baseTag = ext.isBase ? 'Initial' : '';
                const meta = [ext.service, statusLabelExt, periodLabel, bonusLabelExt, priceLabelExt, baseTag]
                  .filter(Boolean)
                  .join(' \u00b7 ');
                const noRange = !startLabel && !expiryLabel;
                const expanded = String(expandedPeriodId) === String(ext.id);
                const toggleExpand = () => setExpandedPeriodId((cur) => (String(cur) === String(ext.id) ? '' : String(ext.id)));
                const paymentLabelExt = ext.payment_date
                  ? `${dateLabel(ext.payment_date)}${ext.payment_time ? ` \u00b7 ${fmtSubsTime(ext.payment_time)}` : ''}`
                  : '';
                const proofExt = String(ext.payment_proof || '').trim();
                const proofViewableExt = isProofViewable(proofExt);
                const notesExt = String(ext.notes || '').trim();
                const bonusDetailExt = Number.isFinite(bonusDaysExt) && bonusDaysExt > 0
                  ? `${bonusDaysExt} ${bonusDaysExt === 1 ? 'Day' : 'Days'}`
                  : '0 Days';
                return (
                  <article
                    className={`list-row subs-extension-row sub-${extToneCls}${ext.isBase ? ' subs-period-base' : ''}${expanded ? ' is-expanded' : ''}`}
                    key={ext.id}
                  >
                    <div
                      className="subs-extension-body"
                      role="button"
                      tabIndex={0}
                      aria-expanded={expanded}
                      onClick={toggleExpand}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(); }
                      }}
                    >
                      {/* Clean Start / Expiry pair — two columns on
                          desktop, stacked on mobile. No "->" arrow on
                          any surface; the labelled rows carry the range
                          so it reads on a phone without horizontal cram. */}
                      {noRange ? (
                        <div className="subs-extension-dates">
                          <span className="subs-extension-date-value">
                            {ext.isBase ? 'Initial Purchase' : 'Extension'}
                          </span>
                        </div>
                      ) : (
                        <div className="subs-extension-dates">
                          <span className="subs-extension-date">
                            <span className="subs-extension-date-label">Start</span>
                            <span className="subs-extension-date-value">{startLabel || '\u2014'}</span>
                          </span>
                          <span className="subs-extension-date">
                            <span className="subs-extension-date-label">Expiry</span>
                            <span className="subs-extension-date-value">{expiryLabel || '\u2014'}</span>
                          </span>
                        </div>
                      )}
                      {meta ? <span className="subs-extension-meta">{meta}</span> : null}
                      <span className="subs-extension-toggle">
                        {expanded ? 'Hide details' : 'View details'}
                        {!expanded && (proofExt || notesExt) ? (
                          <span className="subs-extension-toggle-dot" aria-hidden="true" />
                        ) : null}
                      </span>
                    </div>
                    {/* Action column is rendered on EVERY row so the
                        Start/Expiry grid and right edge line up across
                        the whole list. Every row gets its OWN Print
                        button so the operator can re-issue the receipt
                        for that exact period (the row's effective
                        subscription). The base subscription is still
                        edited via the main "Edit" button at the top of
                        the panel, so its row exposes Print only — no
                        edit/delete — keeping the "base is edited up top"
                        data rule intact. Actions are icon-only and
                        vertically centered. */}
                    <div className="subs-extension-row-actions">
                      <button
                        type="button"
                        className="row-icon-btn"
                        onClick={() => requestPrint(extEffective)}
                        aria-label={ext.isBase ? 'Print initial receipt' : 'Print extension receipt'}
                        title="Print"
                      >
                        <PrintIcon />
                      </button>
                      {!ext.isBase ? (
                        <>
                          <button
                            type="button"
                            className="row-icon-btn"
                            onClick={() => openEditExtension(ext)}
                            aria-label="Edit extension"
                            title="Edit"
                          >
                            <EditIcon />
                          </button>
                          <button
                            type="button"
                            className="row-delete-x"
                            onClick={() => deleteExtension(ext)}
                            aria-label="Delete extension"
                            title="Delete"
                          >
                            <DeleteIcon />
                          </button>
                        </>
                      ) : null}
                    </div>
                    {expanded ? (
                      <div className="subs-extension-detail">
                        {paymentLabelExt ? (
                          <div className="subs-extension-detail-row"><span>Payment</span><strong>{paymentLabelExt}</strong></div>
                        ) : null}
                        {startLabel ? (
                          <div className="subs-extension-detail-row"><span>Start</span><strong>{startLabel}</strong></div>
                        ) : null}
                        {expiryLabel ? (
                          <div className="subs-extension-detail-row"><span>Expiry</span><strong>{expiryLabel}</strong></div>
                        ) : null}
                        {priceLabelExt ? (
                          <div className="subs-extension-detail-row"><span>Price</span><strong>{priceLabelExt}</strong></div>
                        ) : null}
                        <div className="subs-extension-detail-row"><span>Access Period</span><strong>{periodLabel || '0 Days'}</strong></div>
                        <div className="subs-extension-detail-row"><span>Bonus</span><strong>{bonusDetailExt}</strong></div>
                        {statusLabelExt ? (
                          <div className="subs-extension-detail-row"><span>Status</span><strong>{statusLabelExt}</strong></div>
                        ) : null}
                        {ext.service ? (
                          <div className="subs-extension-detail-row"><span>Service</span><strong>{toTitleCase(ext.service)}</strong></div>
                        ) : null}
                        {proofExt ? (
                          <div className="subs-extension-detail-row">
                            <span>Payment Proof</span>
                            {proofViewableExt ? (
                              <a className="subs-proof-link" href={proofExt} target="_blank" rel="noopener noreferrer">View proof</a>
                            ) : (
                              <strong className="subs-extension-detail-proof-text">{proofExt}</strong>
                            )}
                          </div>
                        ) : null}
                        {notesExt ? (
                          <div className="subs-extension-detail-row subs-extension-detail-notes-row">
                            <span>Notes</span>
                            <strong className="subs-detail-notes">{notesExt}</strong>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            !extensionFormOpen ? <p className="empty-state subs-extensions-empty">No extensions yet.</p> : null
          )}
        </section>
      ) : null}
      {printStatus ? <p className="download-status">{printStatus}</p> : null}
      {/* Off-screen export host. The card is always rendered (just
          hidden via the .subs-export-host wrapper styling) so Print
          can rasterise a fully laid-out 720px article without an
          extra mount step. */}
      {subscription ? (
        <div className="subs-export-host" aria-hidden="true">
          {exportIsPaid ? (
            <SubsPaidCard cardRef={cardRef} {...cardProps} />
          ) : (
            <SubsInvoiceCard cardRef={cardRef} {...cardProps} />
          )}
        </div>
      ) : null}
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
// Optional payment-proof control for /db Subs (main form + extension
// form). Supports uploading a receipt image (stored inline as a
// downscaled data URL in the existing per-period `payment_proof`
// string field) and stays backward compatible with any previously
// saved http(s) proof link. Shows a compact indicator with a View
// action (when openable) and a Remove control. Per-period: each main
// subscription period and each extension carries its own proof.
function ProofField({ value, onChange, label = 'Payment Proof (optional)', ariaLabel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const proof = String(value || '').trim();
  const hasProof = !!proof;
  const viewable = isProofViewable(proof);
  const isImage = isProofImage(proof);

  async function handleFile(file) {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const dataUrl = await readProofFile(file);
      onChange(dataUrl);
    } catch (err) {
      setError(err?.message || 'Could not read that image.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="subs-proof-field">
      <span className="subs-proof-field-label">{label}</span>
      <div className="subs-proof-field-controls">
        <label className="subs-proof-upload">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => handleFile(e.target.files && e.target.files[0])}
            aria-label={ariaLabel || 'Upload payment proof image'}
          />
          <span className="subs-proof-upload-pill">
            {busy ? 'Uploading\u2026' : (hasProof ? 'Replace' : 'Upload proof')}
          </span>
        </label>
        {hasProof ? (
          <span className="subs-proof-chip">
            {isImage ? <span className="subs-proof-chip-tag">Image</span> : null}
            {viewable ? (
              <a className="subs-proof-chip-view" href={proof} target="_blank" rel="noopener noreferrer">View</a>
            ) : (
              <span className="subs-proof-chip-text" title={proof}>{proof}</span>
            )}
            <button
              type="button"
              className="subs-proof-chip-remove"
              onClick={() => onChange('')}
              aria-label="Remove payment proof"
            >
              Remove
            </button>
          </span>
        ) : (
          <span className="subs-proof-empty">No proof attached</span>
        )}
      </div>
      {error ? <span className="subs-proof-error">{error}</span> : null}
    </div>
  );
}

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
            onChange={(e) => setField('bonus', Number(e.target.value) || 0)}
            aria-label="Subscription bonus days"
          />
        </label>
        <label>Notes (Optional)
          <textarea
            value={draft.notes || ''}
            onChange={(e) => setField('notes', e.target.value)}
            rows={2}
            placeholder="Internal note for this period (optional)"
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
            value={moneyInputValue(draft.price)}
            placeholder="0"
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

  const left = (
    <>
      <div className="pf-list-tools">
        <input
          className="pf-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          type="search"
          aria-label="Search database"
        />
        {tab === 'clients' ? (
          <button className="add-client-button" type="button" onClick={openNewClient}>
            Create Client
          </button>
        ) : null}
        {tab === 'subs' ? (
          <div className="subs-list-actions">
            <button className="add-client-button" type="button" onClick={openCreateSubscription}>
              New Subscription
            </button>
            <button className="subs-import-icon-button" type="button" onClick={openImportSubscription} aria-label="Import JPG" title="Import JPG">
              <UploadIcon />
            </button>
          </div>
        ) : null}
      </div>
      {status ? <EmptyState>{status}</EmptyState> : null}
      <div className="db-list">
        {activeRows.slice(0, 80).map((row, index) => {
          const isClient = tab === 'clients';
          const isSub = tab === 'subs';
          const title = row.client_name || row.name || row.title || row.slug;
          // Subs row tone reads off the EFFECTIVE subscription so a
          // recent extension can flip an "expired" base row back to
          // active. row.subscription is the canonical subscription
          // record that came down on /api/db.
          const subRecord = isSub ? (row.subscription || null) : null;
          const subEffective = subRecord ? effectiveSubscription(subRecord) : null;
          const subTone = subEffective ? subscriptionTone(subEffective) : '';
          // Subs row right-aligned expiry pill. Mirrors the Clients
          // date pill: same chrome / event-tone-* palette, same
          // {pill, X} grid column. effectiveSubscription has already
          // merged the latest extension on top of the base row, so
          // its expiry_date is the renewal-aware "current" expiry.
          // No extension → base subscription expiry. No expiry on
          // either → 'tba'. The compact label produces "14 Jun 2026"
          // and "TBA" so the column reads identically to Clients.
          const subExpiry = isSub ? String(subEffective?.expiry_date || '') : '';
          const subPillTone = isSub
            ? (subTone === 'expired' ? 'past' : subTone === 'active' ? 'future' : 'tba')
            : '';
          // Clients tab tone is computed above in sortedCrmClients
          // by walking the row's event_dates against today (WIB).
          // The tone drives both the row text colour and the small
          // date pill rendered on the right side of the row, with
          // four states (soon/future/tba/past) mapped through CSS.
          const clientToneInfo = isClient ? (clientToneByRowId.get(row.id) || null) : null;
          const clientTone = clientToneInfo?.tone || '';
          const clientToneClass = clientTone ? `event-tone-${clientTone}` : '';
          const clientPillDate = clientToneInfo?.representativeDate || '';
          const clientPillTone = clientTone || (clientPillDate ? '' : 'tba');
          let meta = '';
          if (isClient) {
            const contact = row.contact || row.client_contact || '';
            meta = isHumanReadableContact(contact) ? contact : '';
          } else if (isSub && subEffective) {
            meta = formatSubscriptionMeta(subEffective);
          }
          const rowId = row.id || `row-${index}`;
          const className = [
            'db-list-row',
            selected?.id === row.id ? 'active' : '',
            subTone ? `sub-${subTone}` : '',
            clientToneClass,
            isClient ? 'has-event-pill' : '',
            isSub ? 'has-event-pill' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const handleSelect = () => {
            // Delete X is now a permanent control on every row, so
            // taps just select. The previous arm/disarm dance was
            // removed along with armedRowId state in PR #56.
            if (isSub) {
              // Subs tab → subscription detail. row.id IS the
              // subscription id (subRows builds it that way) so
              // selectedSubscription resolves directly. We keep
              // the row in selected.data as a fallback for the
              // mid-transition window where the list hasn't been
              // refreshed yet.
              setSelected({ type: 'subscription', id: row.id, data: row });
            } else if (isClient) {
              setSelected({ type: 'client', id: row.id, data: row });
            } else {
              setSelected({ type: tab, id: row.id, data: row });
            }
          };
          const handleDelete = (event) => {
            event.stopPropagation();
            if (isSub) {
              // Deleting from the Subs list removes the subscription
              // row directly. The orphan-client cleanup is handled
              // server-side in handleSubscriptionDelete so a real
              // CRM client (one with invoices/deliveries) is never
              // touched.
              if (row.id) {
                deleteRecord({ kind: 'subscription', id: row.id });
                if (selected?.type === 'subscription' && selected.id === row.id) {
                  setSelected(null);
                  setMobileView('left');
                }
              }
            } else if (isClient) {
              deleteClient(row);
            }
          };
          return (
            <div
              className={className}
              key={rowId}
              onClick={handleSelect}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleSelect();
                }
              }}
            >
              <div className="db-list-row-text">
                <strong>{title || 'Untitled'}</strong>
                {meta ? <span>{meta}</span> : null}
              </div>
              {isClient ? (
                <span
                  className={`event-date-pill${clientPillTone ? ` event-tone-${clientPillTone}` : ''}`}
                  aria-label={`Event ${compactEventDateLabel(clientPillDate)}`}
                >
                  {compactEventDateLabel(clientPillDate)}
                </span>
              ) : null}
              {isSub ? (
                <span
                  className={`event-date-pill event-tone-${subPillTone || 'tba'}`}
                  aria-label={`Expiry ${compactEventDateLabel(subExpiry)}`}
                >
                  {compactEventDateLabel(subExpiry)}
                </span>
              ) : null}
              <button
                type="button"
                className="row-delete-x"
                onClick={handleDelete}
                aria-label={`Delete ${title || 'record'}`}
              >
                <DeleteIcon />
              </button>
            </div>
          );
        })}
        {!status && activeRows.length === 0 ? <EmptyState>No records yet.</EmptyState> : null}
      </div>
    </>
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
          onSaved={() => {
            // Refresh the list so any changed fields (status, dates,
            // service, etc.) reflect in both the row label and the
            // tone class, then walk back to the parent subscription
            // detail. The parent chain guarantees we land on the
            // same row the operator was editing.
            refetch();
            back();
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
