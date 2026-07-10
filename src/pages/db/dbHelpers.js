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
      // Assign vendor-vs-client deliveries with the SAME isVendor
      // determination used for the vendorName/name split above, not a
      // narrower `record.type === 'vendor'` check. The worker derives a
      // delivery's `type` from its LINKED invoice, so a vendor link
      // saved BEFORE any vendor invoice exists comes back as
      // type:'client'. The narrow check then dropped it into
      // group.delivery: the vendor link icon never turned green (and the
      // client link pill went green by mistake) until a vendor invoice
      // was saved. isVendor still recognises that title-less vendor row
      // via likelyVendorDelivery, so the two assignments stay in lockstep
      // and the saved state is correct immediately on the next refetch.
      if (isVendor) group.vendorDelivery = record;
      else group.delivery = record;
    }
    else if (record?.invoice_type === 'vendor' || record?.type === 'vendor' || record?.invoice_data?.invoiceType === 'vendor') group.vendorInvoice = record;
    else group.invoice = record;
  }

  // Process invoices first. Invoices tend to be the side that
  // carries an explicit event_key (operators set the event date in
  // /inv before they ever press Links), so by attaching
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
