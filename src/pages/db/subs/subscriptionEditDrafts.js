import { resolveBonusDays } from './subscriptionLogic.js';
import { addDays } from '../../../features/subscriptions/subscriptionUtils.js';

// Shared field-update helper for the subscription draft (used by
// both SubscriptionEdit and SubscriptionImport). Mirrors the auto-
// sync expiry behaviour of the extension form so the two surfaces
// respond identically when the operator types into Start / Access
// Period / Bonus:
//   • expiry = start + accessPeriodDays + bonusDays
//   • the next period/bonus/start edit intentionally overwrites any
//     previous expiry value
//   • expiry_time tracks start_time when start_time changes.
// Pure function so component-level setField wrappers stay tiny and
// the rule lives in one place.
export function applySubscriptionDraftUpdate(current, key, value) {
  const next = { ...current, [key]: value };
  // Req2: until the operator manually customizes Start, it mirrors the
  // Payment date/time. A manual Start edit latches `start_customized`
  // so subsequent Payment edits stop moving Start. Clearing Payment
  // (to '') while still following also clears the mirrored Start.
  if (key === 'start_date' || key === 'start_time') {
    next.start_customized = true;
  }
  const followingPayment = !current.start_customized
    && (key === 'payment_date' || key === 'payment_time');
  if (followingPayment) {
    if (key === 'payment_date') next.start_date = value;
    if (key === 'payment_time') next.start_time = value;
  }
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

// useState() seeds on mount — keeps "ready for next receipt" and
// "first open" visually identical.
export const INITIAL_SUBS_IMPORT_DRAFT = {
  client_title: 'Mr.',
  client_name: '',
  client_contact: '',
  service: '',
  storage_slot: '',
  rate_mode: 'normal',
  price: 0,
  status: 'paid',
  invoice_date: '',
  payment_date: '',
  payment_time: '',
  access_period: 30,
  bonus: 0,
  start_date: '',
  start_time: '',
  expiry_date: '',
  expiry_time: '',
  payment_proof: '',
  start_customized: false,
};

// Map a saved subscription row (worker-normalised field names) to the
// draft shape used by the editable form. Tolerates legacy/null values
// so the form's date/time inputs see "" instead of `null`. Used when
// prefilling SubscriptionEdit on /db Subs.
export function subscriptionToDraft(sub = {}) {
  const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  // Saved times come back as HH:MM:SS. <input type="time" step="1">
  // also accepts HH:MM:SS, but normalise so a stray "20:21" still
  // round-trips as "20:21:00".
  const padTime = (v) => {
    if (!v) return '';
    const m = String(v).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return '';
    return `${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}`;
  };
  const status = String(sub.status || 'paid').toLowerCase();
  return {
    client_title: String(sub.client_title || 'Mr.'),
    client_name: String(sub.client_name || ''),
    client_contact: String(sub.client_contact || ''),
    service: String(sub.service || ''),
    storage_slot: String(sub.storage_slot || ''),
    rate_mode: String(sub.rate_mode || 'normal'),
    price: num(sub.price, 0),
    status: status === 'paid' ? 'paid' : 'invoice',
    invoice_date: String(sub.invoice_date || ''),
    payment_date: String(sub.payment_date || ''),
    payment_time: padTime(sub.payment_time),
    access_period: Number.isFinite(Number(sub.access_period)) && Number(sub.access_period) > 0
      ? Number(sub.access_period)
      : 30,
    bonus: resolveBonusDays(sub),
    start_date: String(sub.start_date || ''),
    start_time: padTime(sub.start_time),
    expiry_date: String(sub.expiry_date || ''),
    expiry_time: padTime(sub.expiry_time),
    payment_proof: String(sub.payment_proof || ''),
    // Req2: an existing row with a start already set is treated as
    // customized (editing Payment won't move Start); a fresh draft
    // (no start) lets Start follow Payment until manually edited.
    start_customized: !!String(sub.start_date || ''),
  };
}
