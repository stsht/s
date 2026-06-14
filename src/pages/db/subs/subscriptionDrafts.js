// Pure draft helpers for the /db Subs extension form.
//
// Extracted from DatabasePage.jsx as part of the Subs detail
// structure cleanup. Nothing here renders JSX or touches React state;
// the logic owns price/payment cascades, start-mirror, and expiry
// recompute for the inline extension form.
import { addDays } from '../../../features/subscriptions/subscriptionUtils.js';

// Build the extension form draft for a subscription period.
//   - `extension`: the row being edited (null for a brand-new one)
//   - `latestExtension`: the most recent extension in the chain,
//     used to seed Price / Payment Date defaults for a new row.
// Price cascade: extension price → latest extension price → base
// subscription price aliases (paid_amount / amount / total) → 0.
// 0 / NaN are treated as "missing" so a real saved price always
// shows through.
export function makeExtensionDraft(subscription, extension, latestExtension) {
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
    // Req2: an existing extension that already has a start date is
    // treated as "customized" so editing its payment date won't move
    // the start; a brand-new extension (no start yet) lets Start
    // follow Payment until the operator edits Start manually.
    start_customized: !!String(ext.start_date || ''),
  };
}

// Pure field-update transform for the extension draft. Returns a new
// draft with the edited field applied plus the dependent updates that
// kept the inline form's behaviour: Start mirrors Payment until the
// operator edits Start (latching start_customized), and period/bonus/
// start edits recompute the expiry from start + access period + bonus.
// Extracted verbatim from SubscriptionDetail.setExtensionField.
export function updateExtensionDraftField(current, key, value) {
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
}
