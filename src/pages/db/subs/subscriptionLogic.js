// Subscription tone / extension / bonus helpers for the /db Subs surface.
// Extracted verbatim from dbHelpers.js — function bodies and comments are
// unchanged so the Subs tone, effective-extension, bonus, and latest-extension
// behaviour stays identical. Date primitives stay in dbHelpers.js and are
// imported here for inferBonusDaysFromDates.
import { plainEventDate, daysBetweenIso } from '../dbHelpers.js';

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
export const SUBS_SETTLED_STATUS_PATTERN = /recurring|renew|active|paid|solved|closed/;

export function subscriptionTone(sub = {}) {
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
export function applySubscriptionExtension(sub, extension) {
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
export function inferBonusDaysFromDates(sub = {}) {
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
export function resolveBonusDays(sub = {}) {
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
export function subscriptionExtensionSortKey(ext) {
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
export function pickLatestSubscriptionExtension(list) {
  const arr = Array.isArray(list) ? list.slice() : [];
  if (!arr.length) return null;
  arr.sort((a, b) => {
    const aKey = subscriptionExtensionSortKey(a);
    const bKey = subscriptionExtensionSortKey(b);
    return bKey.localeCompare(aKey);
  });
  return arr[0];
}
