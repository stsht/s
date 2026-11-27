// Pure data-derivation helpers for the /db page state hook.
// Extraction-only: these functions contain no React and mirror the exact
// logic previously inlined in useDatabasePageState.js.

import {
  plainEventDate,
  classifyClientEvents,
  daysBetweenIso,
  buildClientRecords,
} from './dbHelpers.js';
import { eventGroupIsSettled } from './vendorStatus.js';
import {
  accessLogEventLabel,
  accessLogTimeValue,
  formatAccessLogClock,
  formatAccessLogDay,
  groupAccessLogsByVisitor,
  isNoiseAccessLog,
  partitionAccessVisitors,
  summarizeAccessLogs,
} from './delivery/deliveryHelpers.js';

// Sort raw client list alphabetically by display name.
export function sortClientsByName(rawClients) {
  return [...(Array.isArray(rawClients) ? rawClients : [])].sort((a, b) => {
    const an = String(a?.name || a?.client_name || '').toLowerCase();
    const bn = String(b?.name || b?.client_name || '').toLowerCase();
    return an.localeCompare(bn);
  });
}

// Filter sorted clients down to those that belong in the CRM list.
export function filterCrmClients(clients) {
  return (Array.isArray(clients) ? clients : []).filter((c) => {
    const invoiceCount = Number(c?.invoice_count || 0);
    const deliveryCount = Number(c?.delivery_count || 0);
    const source = String(c?.source || '').toLowerCase();
    const hasInvoiceHistory =
      invoiceCount > 0 ||
      (Array.isArray(c?.invoice_ids) && c.invoice_ids.length > 0);
    const hasDeliveryHistory =
      deliveryCount > 0 ||
      (Array.isArray(c?.delivery_ids) && c.delivery_ids.length > 0);
    const hasCrmHistory = hasInvoiceHistory || hasDeliveryHistory;

    if (hasCrmHistory) return true;

    if (source === 'legacy') return false;

    return source === 'client';
  });
}


// Extract plain event dates for a client from invoices and deliveries.
export function getEventDatesByClient(client, invoices, deliveriesAll) {
  const cid = String(client?.id || '').trim();
  const cname = String(client?.name || client?.client_name || '').trim().toLowerCase();
  const matches = (rec) => {
    const rid = String(rec?.client_id || '').trim();
    const rname = String(rec?.client_name || rec?.name || '').trim().toLowerCase();
    if (cid && rid && cid === rid) return true;
    return !!cname && !!rname && cname === rname;
  };
  const dates = [];
  for (const rec of (Array.isArray(invoices) ? invoices : [])) {
    if (!matches(rec)) continue;
    const d = plainEventDate(rec?.event_date);
    if (d) dates.push(d);
  }
  for (const rec of (Array.isArray(deliveriesAll) ? deliveriesAll : [])) {
    if (!matches(rec)) continue;
    const d = plainEventDate(rec?.event_date);
    if (d) dates.push(d);
  }
  return dates;
}


// Apply the left Clients-list status rules to a date classification. Event
// groups come from buildClientRecords(), so settlement stays within the
// existing client-id + event_key/date grouping instead of using newest-record
// or client-name-only shortcuts.
export function applyClientListStatus({ classification, groups, todayIso }) {
  const cls = classification || {
    bucket: 'tba',
    tone: 'tba',
    sortKey: '',
    representativeDate: '',
  };

  if (cls.bucket === 'upcoming') {
    const diff = daysBetweenIso(todayIso, cls.representativeDate);
    if (diff === 0 && Array.isArray(groups) && groups.length > 0) {
      const hasFutureAfterToday = groups.some((group) => {
        const date = plainEventDate(group?.eventDate);
        return !!date && date > todayIso;
      });
      const dueEvents = groups.filter((group) => {
        const date = plainEventDate(group?.eventDate);
        return !!date && date <= todayIso;
      });
      if (!hasFutureAfterToday && dueEvents.length > 0
        && dueEvents.every((group) => eventGroupIsSettled(group))) {
        return { ...cls, bucket: 'past', tone: '' };
      }
    }
    return {
      ...cls,
      tone: Number.isFinite(diff) && diff >= 0 && diff <= 3 ? 'soon' : 'future',
    };
  }

  if (cls.bucket !== 'past') return cls;

  const relevantPastEvents = (Array.isArray(groups) ? groups : []).filter((group) => {
    const eventDate = plainEventDate(group?.eventDate);
    return !!eventDate && eventDate < todayIso;
  });
  const fullySettled = relevantPastEvents.length > 0
    && relevantPastEvents.every((group) => eventGroupIsSettled(group));

  return {
    ...cls,
    // Past/incomplete clients stay blue; fully settled clients are neutral.
    tone: fullySettled ? '' : 'soon',
  };
}


// Annotate and sort CRM clients by event bucket / recency.
export function buildSortedCrmClients({ crmClients, eventDatesByClient, invoices, deliveriesAll, todayIso }) {
  const bucketOrder = { upcoming: 0, tba: 1, past: 2 };
  const annotated = (Array.isArray(crmClients) ? crmClients : []).map((client) => {
    const dates = eventDatesByClient(client);
    const classification = classifyClientEvents(dates, todayIso);
    const needsSettlementCheck = classification.bucket === 'past'
      || (classification.bucket === 'upcoming' && classification.representativeDate === todayIso);
    const groups = needsSettlementCheck
      ? buildClientRecords(client, invoices, deliveriesAll, todayIso)
      : [];
    const cls = applyClientListStatus({ classification, groups, todayIso });
    const name = String(client?.name || client?.client_name || '').toLowerCase();
    return {
      client,
      ...cls,
      name,
    };
  });
  annotated.sort((a, b) => {
    const ba = bucketOrder[a.bucket] ?? 9;
    const bb = bucketOrder[b.bucket] ?? 9;
    if (ba !== bb) return ba - bb;
    if (a.bucket === 'upcoming') {
      return a.sortKey.localeCompare(b.sortKey);
    }
    if (a.bucket === 'past') {
      return b.sortKey.localeCompare(a.sortKey);
    }
    return a.name.localeCompare(b.name);
  });
  return annotated;
}

// Build a lookup of client tone / representative date keyed by client id.
export function buildClientToneByRowId(sortedCrmClients) {
  const map = new Map();
  for (const entry of (Array.isArray(sortedCrmClients) ? sortedCrmClients : [])) {
    map.set(entry.client?.id, {
      tone: entry.tone,
      representativeDate: entry.representativeDate,
    });
  }
  return map;
}

function latestLog(logs = []) {
  return [...(Array.isArray(logs) ? logs : [])].sort(
    (a, b) => accessLogTimeValue(b?.created_at) - accessLogTimeValue(a?.created_at),
  )[0] || null;
}

function activityWhen(value = '') {
  return [formatAccessLogDay(value), formatAccessLogClock(value)].filter(Boolean).join(' · ');
}

// Activity rows for the /db Activity tab. They reuse the logs already
// bundled into /api/db's delivery items, so the tab does not need a new
// backend read or an N+1 scan over individual deliveries.
export function buildActivityRows({ deliveriesAll, query }) {
  const q = String(query || '').trim().toLowerCase();
  const rows = (Array.isArray(deliveriesAll) ? deliveriesAll : []).map((delivery) => {
    const logs = Array.isArray(delivery?.stats?.logs) ? delivery.stats.logs : [];
    if (!logs.length) return null;
    const humanLogs = logs.filter((log) => !isNoiseAccessLog(log));
    const last = latestLog(humanLogs.length ? humanLogs : logs);
    if (!last) return null;
    const summary = summarizeAccessLogs(logs, { excludeNoise: true });
    const groupedVisitors = groupAccessLogsByVisitor(logs);
    const { human: visitors } = partitionAccessVisitors(groupedVisitors);
    const eventDate = plainEventDate(delivery?.event_date);
    const folderName = String(delivery?.folder_name || delivery?.base_slug || delivery?.gallery_code || '').trim();
    const name = String(delivery?.client_name || 'Delivery').trim();
    const lastActivityLabel = humanLogs.length
      ? accessLogEventLabel(last.event_type, last.service)
      : 'Link Preview Only';
    const row = {
      id: `activity:${delivery.id}`,
      deliveryId: delivery.id,
      client_name: name,
      folder_name: folderName,
      event_date: eventDate,
      deliveryType: delivery?.type || '',
      short_code: delivery?.short_code || '',
      short_url: delivery?.short_url || delivery?.delivery_url || '',
      logs,
      visitors: visitors.length,
      opens: summary.opens,
      clicks: summary.clicks,
      lastActivityAt: last.created_at || '',
      lastActivityDisplay: activityWhen(last.created_at),
      lastActivityLabel,
      delivery,
    };
    const haystack = [
      row.client_name,
      row.folder_name,
      row.event_date,
      row.deliveryType,
      row.short_code,
      row.lastActivityLabel,
      String(row.opens),
      String(row.clicks),
    ].join(' ').toLowerCase();
    if (q && !haystack.includes(q)) return null;
    return row;
  }).filter(Boolean);
  rows.sort((a, b) => accessLogTimeValue(b.lastActivityAt) - accessLogTimeValue(a.lastActivityAt));
  return rows;
}


// Resolve the currently selected client.
export function getSelectedClient(selected, clients) {
  if (selected?.type !== 'client') return null;
  return (Array.isArray(clients) ? clients : []).find((client) => client.id === selected.id) || selected.data || null;
}

// Resolve the currently selected delivery (preferring fresh data).
export function getSelectedDelivery(selected, data) {
  if (selected?.type !== 'delivery') return null;
  const id = String(selected.id || '');
  const fresh = (data?.items || []).find((d) => String(d?.id || '') === id);
  return fresh || selected.data || null;
}
