// Subscription option lists and service-alias table.
//
// Extracted verbatim from WorkspacePages.jsx so the /subs page and
// the /db Subs detail/import/edit flows share one source of truth.
// Pure data only — no imports — so it can be consumed by both the
// feature components and WorkspacePages.jsx without creating a
// circular dependency.

export const SUBS_PERIOD_OPTIONS = [
  { value: 7, label: '7 Days' },
  { value: 15, label: '15 Days' },
  { value: 30, label: '30 Days' },
];

export const SUBS_SERVICE_OPTIONS = ['iCloud', 'Google Drive', 'Dropbox', 'ChatGPT', 'Copilot'];

export const SUBS_TITLE_OPTIONS = ['', 'Mr.', 'Ms.', 'Mrs.', 'Family'];

export const SUBS_MODE_OPTIONS = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'paid', label: 'Paid' },
];

// Storage is service-specific. Non-storage services (ChatGPT,
// Copilot) hide the storage input entirely and the generated card
// omits the storage line. Storage products keep the dropdown but
// allow blank — a blank value also drops the storage line from the
// JPG. The dropdown values include their unit so the card can
// render them verbatim ("200 GB", "1.5 TB") instead of stitching a
// number onto a static suffix.
export const SUBS_STORAGE_OPTIONS = ['200 GB', '400 GB', '500 GB', '1 TB', '1.5 TB', '2 TB'];
export const SUBS_NON_STORAGE_SERVICES = new Set(['ChatGPT', 'Copilot']);

// Duration dropdown for invoice mode. Includes a blank entry so a
// subscription bill that doesn't tie to a fixed term (e.g. ad-hoc
// access) can omit the duration line. Paid mode uses
// SUBS_PERIOD_OPTIONS unchanged because the expiry calculation
// always needs a non-blank period.
export const SUBS_DURATION_OPTIONS = [
  { value: '', label: '—' },
  { value: '7', label: '7 Days' },
  { value: '15', label: '15 Days' },
  { value: '30', label: '30 Days' },
];

export const SUBS_IMPORT_SERVICE_ALIASES = [
  { aliases: ['google-drive', 'googledrive', 'gdrive', 'drive'], label: 'Google Drive', pattern: /google\s*drive|gdrive/i },
  { aliases: ['chatgpt', 'gpt'], label: 'ChatGPT', pattern: /chat\s*gpt|chatgpt/i },
  { aliases: ['icloud', 'i-cloud'], label: 'iCloud', pattern: /icloud|i\s*cloud/i },
  { aliases: ['dropbox'], label: 'Dropbox', pattern: /dropbox/i },
  { aliases: ['copilot'], label: 'Copilot', pattern: /copilot/i },
];
