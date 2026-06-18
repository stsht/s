// Pure display/normalization helpers extracted from
// InvoiceComposer.jsx (Pass 52). These are side-effect free: no
// hooks, no DOM, no localStorage, no network. Function bodies are
// moved here verbatim.

import { PAYMENT_METHODS } from './invoiceConstants.js';

export function cleanPaymentMethod(value) {
  return PAYMENT_METHODS.includes(String(value || '').toLowerCase())
    ? String(value || '').toLowerCase()
    : 'bank';
}

export function rupiah(value) {
  const number = Number(value) || 0;
  return `Rp ${Math.round(number).toLocaleString('id-ID')}`;
}

// Whether the deposit is effectively the full grand total. Drives
// the "Deposit Due" vs "Payment Due" wording in both the editor's
// Payment fieldset and the preview/JPG payment caption: a 100%
// preset (or a custom amount that meets/exceeds the grand total)
// shouldn't be called a deposit. Returns false when grandTotal is
// zero so an empty draft never reads "Payment Due Rp 0".
export function isFullPayment(totals) {
  const grand = Math.max(0, Math.round(Number(totals?.grandTotal) || 0));
  const due = Math.max(0, Math.round(Number(totals?.depositDue) || 0));
  return grand > 0 && due >= grand;
}

export function prettyDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

// Combined "Event Date • Event Time" formatter used by the
// preview/JPG Details box. Renders `28 May 2026 • 18:30` when both
// are present, just the date when time is empty, and the existing
// dash when the date itself is empty so empty drafts don't
// suddenly read "•".
export function prettyDateTime(date, time) {
  if (!date) return '-';
  const datePart = prettyDate(date);
  const raw = String(time || '').trim();
  const match = /^(\d{2}):(\d{2})/.exec(raw);
  if (!match) return datePart;
  return `${datePart} \u2022 ${match[1]}:${match[2]}`;
}


// Clamp a per-item discount to a non-negative integer that never
// exceeds the item's gross line total (qty * price). Blank/NaN → 0.
export function clampItemDiscount(rawDiscount, qty, price) {
  const gross = Math.max(0, Math.round((Number(qty) || 0) * (Number(price) || 0)));
  const value = Math.max(0, Math.round(Number(rawDiscount) || 0));
  return Math.min(value, gross);
}
