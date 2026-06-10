// Pure helper functions for the /db (DatabasePage) surface.
//
// This module holds only side-effect-free date/tone/grouping and
// subscription helpers extracted verbatim from DatabasePage.jsx as
// part of the route/component structure cleanup. Nothing here renders
// JSX or uses React hooks/state; the function bodies are unchanged so
// the /db sorting, tone, date-pill, and grouping behaviour stays
// identical. JSX components and panels remain in DatabasePage.jsx.

// Accept only bare YYYY-MM-DD date strings as a real event date.
// Timestamp-shaped values (e.g. created_at/updated_at "2026-05-17
// T13:08:21.123Z") are rejected so they don't leak into the
// /inv?eventDate= handoff URL where the type=date input would
// silently render blank. Returns the YYYY-MM-DD on hit, '' on miss.
export function plainEventDate(value) {
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
export function jakartaTodayISO() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

// Whole-day delta between two YYYY-MM-DD strings (target - reference).
// Returns 0 for the same day, positive when target is later, negative
// when earlier. Used by the Clients tab to bucket event dates into
// "today/+2 = green", ">2 = normal", and "all past = expired".
export function daysBetweenIso(referenceIso, targetIso) {
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
export function classifyClientEvents(eventDates, todayIso) {
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
export function eventDateTone(eventDate, todayIso) {
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
export function compactEventDateLabel(eventDate) {
  const date = plainEventDate(eventDate);
  if (!date) return 'TBA';
  const dt = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(dt.getTime())) return 'TBA';
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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

export function buildClientRecords(client, invoices, deliveries, todayIso) {
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
