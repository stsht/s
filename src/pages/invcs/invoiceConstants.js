// Static invoice constants extracted from InvoiceComposer.jsx
// (Pass 52). Values are literal/static data only and are moved here
// verbatim so the composer shrinks without any behaviour change.
// Deposit math (computeDepositDue/inferDepositMode) continues to
// reference DEPOSIT_PRESETS/DEPOSIT_MIN_IDR via import.

// Hardcoded fallback catalogue. The catalogue is normally fetched
// from the Supabase-backed /api/packages endpoint (see _worker.js
// handlePackagesGet) and these values are kept as a safety net so
// /inv keeps working when the API returns empty, fails, or is
// unreachable. Same shape as the API rows: { id, name, price, note,
// is_default }.
export const DEFAULT_PACKAGES = [
  { id: 'school-basic',         name: 'School without Magician', price: 800000,  note: 'school celebration without magician',                is_default: true },
  { id: 'school-magician',      name: 'School with Magician',    price: 1000000, note: 'school celebration with magician',                   is_default: true },
  { id: 'studio-special',       name: 'Studio Special',          price: 800000,  note: 'up to 1 hour',                                       is_default: true },
  { id: 'intimate-party',       name: 'Intimate Party',          price: 1300000, note: 'up to 2 hours, suitable for family celebration',     is_default: true },
  { id: 'birthday-celebration', name: 'Birthday Celebration',    price: 1650000, note: 'up to 3.5 hours, suitable for Birthday Celebration', is_default: true },
];

// Bank transfer destination shown in the payment block. Centralised
// here so a future switch is a single-line change with no JSX/CSS
// edits.
export const BANK_DETAILS = {
  bank: 'Mandiri',
  accountName: 'BELLY',
  accountNumber: '1050023197043',
  accountHolderLabel: 'BELLY',
};

export const PAYMENT_QR_SRC = '/payment-qr.png';
export const PAYMENT_METHODS = ['bank', 'qr'];

export const INVOICE_TYPES = {
  CLIENT: 'client',
  VENDOR: 'vendor',
};

// Live Preview is fit-to-width only — the sheet is scaled down so it
// always fits the preview column, then the panel scrolls vertically.
// There is intentionally no user-facing zoom (no Fit button, no
// +/- controls, no ctrl-wheel handler); the preview is stable and
// non-interactive beyond scrolling.
export const INVOICE_PREVIEW_WIDTH = 1000;
export const INVOICE_PREVIEW_MIN_HEIGHT = 707;

// Deposit defaults: 20% of grand total, but never less than IDR
// 200,000. The 200K floor is the operator's invoicing minimum;
// it is capped at the grand total so a tiny invoice (smaller than
// the floor itself) cannot ask for more than 100% deposit. The
// preset ladder is the short list of common ratios; "custom" lets
// the operator type a raw IDR override that bypasses the percent
// calculation entirely (still capped at the grand total).
export const DEPOSIT_PRESETS = [20, 30, 50, 100];
export const DEPOSIT_MIN_IDR = 200000;

// Title options shown in the modernized Bill To selector. Searchable
// labels via Combobox so a /family/ event still types straight to
// the option without scrolling. Keeping these as plain strings so
// the same set works for a future custom title (the Combobox would
// only need a free-text override; today the catalogue is fixed).
export const TITLE_OPTIONS = ['Ms.', 'Mr.', 'Mrs.', 'Family'];
