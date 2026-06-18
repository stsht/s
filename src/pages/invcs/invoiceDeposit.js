import { DEPOSIT_PRESETS, DEPOSIT_MIN_IDR } from './invoiceConstants.js';

// Deposit defaults (DEPOSIT_PRESETS / DEPOSIT_MIN_IDR) live in
// invoiceConstants.js. computeDepositDue applies the 20%/IDR-200K
// rules below: 20% of grand total, never less than the IDR floor,
// capped at the grand total. Higher presets (30/50/100) skip the
// floor naturally. "custom" lets the operator type a raw IDR
// override that bypasses the percent calculation (still capped).

export function computeDepositDue(grandTotal, mode, customAmount) {
  const total = Math.max(0, Math.round(Number(grandTotal) || 0));
  if (total <= 0) return 0;
  if (mode === 'custom') {
    const raw = Math.max(0, Math.round(Number(customAmount) || 0));
    return Math.min(total, raw);
  }
  const percent = Number(mode) || 0;
  const fromPercent = Math.round((total * percent) / 100);
  // Apply the IDR floor only when the percent calculation falls
  // below it. Higher presets (30/50/100) skip the floor naturally
  // since they already exceed it for any realistic invoice.
  const floored = Math.max(fromPercent, DEPOSIT_MIN_IDR);
  return Math.min(total, floored);
}

// Inverse of computeDepositDue: for older invoice rows that only
// stored a flat deposit_amount, infer the matching preset (or fall
// back to 'custom') so the deposit selector hydrates predictably.
// Tolerance is ±1% of the grand total to absorb prior rounding.
export function inferDepositMode(grandTotal, depositAmount) {
  const total = Math.max(0, Math.round(Number(grandTotal) || 0));
  const amount = Math.max(0, Math.round(Number(depositAmount) || 0));
  if (total <= 0 || amount <= 0) return { mode: '20', customAmount: '' };
  const tolerance = Math.max(1, Math.round(total * 0.01));
  for (const preset of DEPOSIT_PRESETS) {
    const expected = computeDepositDue(total, String(preset), '');
    if (Math.abs(expected - amount) <= tolerance) {
      return { mode: String(preset), customAmount: '' };
    }
  }
  return { mode: 'custom', customAmount: String(amount) };
}

// Most recent paid deposit instalment amount. Drives the Deposit
// tab's "Ask DP" auto-follow: when the operator opens Ask DP, the
// requested deposit due snaps to whatever the client most recently
// paid so the figure we ask for matches reality. "Latest" is by
// paid date+time, falling back to recording order (the last row
// added) when dates tie or are missing. Returns 0 when no paid
// instalment carries a positive amount, in which case the caller
// falls back to the 20% preset default.
export function latestPaidDepositAmount(payments) {
  const paid = (payments || [])
    .map((payment, index) => ({
      index,
      amount: Math.max(0, Math.round(Number(payment?.amount) || 0)),
      paid: Boolean(payment?.paid),
      key: `${payment?.paidAtDate || ''} ${payment?.paidAtTime || ''}`,
    }))
    .filter((payment) => payment.paid && payment.amount > 0);
  if (!paid.length) return 0;
  paid.sort((a, b) => (a.key === b.key ? a.index - b.index : (a.key < b.key ? -1 : 1)));
  return paid[paid.length - 1].amount;
}
