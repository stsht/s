import { dbg, dbgEnabled } from '../../../utils/debugLogger.js';

export { dbg, dbgEnabled };

// Local display / URL helpers used only by the /db Clients detail +
// event-row UI. These were lifted verbatim out of DatabasePage.jsx as
// part of the Clients split (mirroring the earlier Subs split) so the
// main page no longer carries client/event-only utilities. Behaviour
// is unchanged — same debug namespace, same URL building, same event
// key generation.

export function createRecordUrl(path, params) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return `${url.pathname}${url.search}`;
}

// Generate a fresh per-event grouping key. Used by the /db Create
// Events sheet so the "Create Links" and "Create Invoice" choices
// inside the same sheet land on the same /db row regardless of
// which one the operator opens first. Falls back to a timestamp +
// random suffix when crypto.randomUUID is unavailable (older
// browsers); the worker only requires a stable string ≤ 80 chars,
// not a real UUID.
export function generateEventKey() {
  try {
    const uuid = window.crypto?.randomUUID?.();
    if (uuid) return String(uuid).slice(0, 80);
  } catch {
    /* fall through */
  }
  const rand = Math.random().toString(36).slice(2, 10);
  return `evt-${Date.now().toString(36)}-${rand}`.slice(0, 80);
}

// Strip a leading client title prefix (Ms./Mr./Mrs./Family) so the
// vendor-side delivery/invoice hand-offs carry the bare person name
// rather than the client-facing titled form. Mirrors the inline
// regex that previously lived in the ClientDetail event-row map.
export function stripVendorName(rawName) {
  return String(rawName).replace(/^(Ms\.|Mr\.|Mrs\.|Family)\s+/i, '').trim();
}

// A row's stable identity is delivery.id ?? invoice.id ??
// vendorDelivery.id ?? vendorInvoice.id ?? date+index. Used both for
// the React key in the event list and for the row's `data-key` /
// armed-delete bookkeeping, so the two always agree.
export function clientEventRecordKey(row, index) {
  return row.delivery?.id
    || row.invoice?.id
    || row.vendorDelivery?.id
    || row.vendorInvoice?.id
    || `${row.date}-${index}`;
}
