// Subscription form option lists shared by the Subs extension form
// (src/pages/db/subs) and the SubscriptionEdit / SubscriptionImport
// forms in DatabasePage.jsx. Plain data, no behaviour — kept here so
// both surfaces reference one source of truth.
export const SUBSCRIPTION_STATUS_OPTIONS = [
  { value: 'paid', label: 'Paid' },
  { value: 'invoice', label: 'Invoice' },
];
export const ACCESS_PERIOD_OPTIONS = [
  { value: '7', label: '7' },
  { value: '15', label: '15' },
  { value: '30', label: '30' },
];
