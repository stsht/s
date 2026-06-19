// Pure, framework-free invoice container helpers extracted verbatim
// from InvoiceComposer.jsx (Pass 62). No hooks, no DOM, no refs, no
// React, no network, no localStorage — each is driven only by its
// arguments and the shared constants imported below. (emptyItem and
// makeDepositPayment use the crypto.randomUUID global, and
// nowDateParts reads the operator's system clock, exactly as before.)

import { DEFAULT_PACKAGES } from './invoiceConstants.js';

export function emptyItem(packages) {
  const option = (packages && packages[0]) || DEFAULT_PACKAGES[0];
  return {
    id: crypto.randomUUID(),
    packageId: String(option.id || ''),
    name: option.name,
    note: option.note || '',
    qty: 1,
    price: Number(option.price) || 0,
    discount: 0,
  };
}

export function cleanPackageRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      id: String(row.id || ''),
      name: String(row.name || '').trim(),
      note: String(row.note || '').trim(),
      price: Math.max(0, Math.round(Number(row.price) || 0)),
      is_default: !!row.is_default,
    }))
    .filter((row) => row.name);
}

// Local-time "YYYY-MM-DD" / "HH:MM" for a freshly created deposit
// payment row. Uses the operator's system clock (not toISOString,
// which is UTC) so a deposit recorded at 23:30 local time doesn't
// roll forward to the next calendar day.
export function nowDateParts() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

// Factory for a new deposit instalment row. Each row is a recorded
// deposit payment: { id, paid, paidAtDate, paidAtTime, amount }.
// Defaults are "paid now, for the current Invoice-tab deposit due"
// — a blank/zero due simply lands as 0, which reads like a
// placeholder via the shared selectAllIfZero focus behaviour.
export function makeDepositPayment(amountDefault) {
  const { date, time } = nowDateParts();
  return {
    id: crypto.randomUUID(),
    paid: true,
    paidAtDate: date,
    paidAtTime: time,
    amount: Math.max(0, Math.round(Number(amountDefault) || 0)),
  };
}
