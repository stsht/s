// Pure data-derivation helpers for the /db page state hook.
// Extraction-only: these functions contain no React and mirror the exact
// logic previously inlined in useDatabasePageState.js.

import {
  plainEventDate,
  classifyClientEvents,
} from './dbHelpers.js';
import {
  subscriptionTone,
  applySubscriptionExtension,
  pickLatestSubscriptionExtension,
} from './subs/subscriptionLogic.js';

// Sort raw client list alphabetically by display name.
export function sortClientsByName(rawClients) {
  return [...(Array.isArray(rawClients) ? rawClients : [])].sort((a, b) => {
    const an = String(a?.name || a?.client_name || '').toLowerCase();
    const bn = String(b?.name || b?.client_name || '').toLowerCase();
    return an.localeCompare(bn);
  });
}

// Build the lightweight subscription rows used by the list.
export function buildSubRows(subscriptions) {
  return (Array.isArray(subscriptions) ? subscriptions : []).map((sub) => ({
    id: String(sub.id || ''),
    client_name: String(sub.client_name || '').trim(),
    client_title: String(sub.client_title || '').trim(),
    client_contact: String(sub.client_contact || '').trim(),
    subscription: sub,
  }));
}


// Filter sorted clients down to those that belong in the CRM list.
export function filterCrmClients(clients) {
  return (Array.isArray(clients) ? clients : []).filter((c) => {
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

    if (hasCrmHistory) return true;

    const isLegacyOrSubscriptionSource =
      source === 'legacy' ||
      source === 'subscription' ||
      source === 'subscriptions';
    if (isLegacyOrSubscriptionSource) return false;

    if (subscriptionCount > 0) return false;

    return source === 'client';
  });
}


// Resolve the effective subscription, applying the latest extension if any.
export function getEffectiveSubscription(sub) {
  if (!sub || typeof sub !== 'object') return sub;
  const ext = sub.latest_extension || pickLatestSubscriptionExtension(sub.extensions);
  return applySubscriptionExtension(sub, ext);
}

// Find a subscription by id within a list.
export function getSubscriptionById(subscriptions, id) {
  const cleanId = String(id || '').trim();
  if (!cleanId) return null;
  return (Array.isArray(subscriptions) ? subscriptions : [])
    .find((sub) => String(sub?.id || '') === cleanId) || null;
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


// Annotate and sort CRM clients by event bucket / recency.
export function buildSortedCrmClients({ crmClients, eventDatesByClient, invoices, deliveriesAll, todayIso }) {
  const bucketOrder = { upcoming: 0, tba: 1, past: 2 };
  const annotated = (Array.isArray(crmClients) ? crmClients : []).map((client) => {
    const dates = eventDatesByClient(client);
    const cls = classifyClientEvents(dates, todayIso);
    const name = String(client?.name || client?.client_name || '').toLowerCase();
    return {
      client,
      ...cls,
      // The left Clients list is navigation only. Keep the displayed
      // event date pill neutral there, even when the representative
      // event is past/upcoming or only one side of the workflow exists.
      // Detail rows still carry their event-date tone/action state.
      tone: '',
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


// Annotate and sort subscription rows: active first, then by recency.
export function buildSortedSubRows({ subRows, effectiveSubscription }) {
  function recencyKey(sub) {
    return String(
      sub?.expiry_date
      || sub?.payment_date
      || sub?.start_date
      || sub?.created_at
      || ''
    );
  }
  const annotated = (Array.isArray(subRows) ? subRows : []).map((row) => {
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
    return b.key.localeCompare(a.key);
  });
  return annotated.map((entry) => entry.row);
}

// Resolve the currently selected client.
export function getSelectedClient(selected, clients) {
  if (selected?.type !== 'client') return null;
  return (Array.isArray(clients) ? clients : []).find((client) => client.id === selected.id) || selected.data || null;
}

// Resolve the currently selected subscription.
export function getSelectedSubscription(selected, subscriptions) {
  if (selected?.type !== 'subscription' && selected?.type !== 'subs-edit') return null;
  return getSubscriptionById(subscriptions, selected.id) || selected.data?.subscription || null;
}

// Resolve the currently selected delivery (preferring fresh data).
export function getSelectedDelivery(selected, data) {
  if (selected?.type !== 'delivery') return null;
  const id = String(selected.id || '');
  const fresh = (data?.items || []).find((d) => String(d?.id || '') === id);
  return fresh || selected.data || null;
}
