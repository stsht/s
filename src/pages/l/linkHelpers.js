// Pure, side-effect-free helpers for the /l Link Generator.
//
// These were extracted verbatim from LinkGeneratorPage.jsx (Pass 69).
// They perform only string/date math and carry no hooks, state, refs,
// fetch/API, storage, clipboard, or router access. Slug/password/message
// generation, the invoice handoff reader, and the debug helpers stay in
// LinkGeneratorPage.jsx; this module is imported one-directionally so
// there is no circular dependency.

// Small string helpers used by /l so the client preview matches the
// payload sent to the worker.
export function cleanLinkText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function plainEventDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  // Already in YYYY-MM-DD form — pass through unchanged.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // Anything with a 'T' time component (ISO timestamp) is a
  // created_at/updated_at-style metadata field, not an event date.
  if (/T\d/.test(raw)) return '';
  return '';
}

// Today's date in Asia/Jakarta (UTC+7) as a bare YYYY-MM-DD string.
export function jakartaTodayISO() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

// Whole-day delta between two YYYY-MM-DD strings (target - reference).
export function daysBetweenIso(referenceIso, targetIso) {
  const ref = String(referenceIso || '');
  const tgt = String(targetIso || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ref) || !/^\d{4}-\d{2}-\d{2}$/.test(tgt)) return NaN;
  const [ay, am, ad] = ref.split('-').map(Number);
  const [by, bm, bd] = tgt.split('-').map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / 86400000);
}

// Tone class for a single event_date relative to today in WIB.
export function eventDateTone(eventDate, todayIso) {
  const date = plainEventDate(eventDate);
  if (!date) return 'tba';
  const diff = daysBetweenIso(todayIso, date);
  if (!Number.isFinite(diff)) return 'tba';
  if (diff < 0) return 'past';
  if (diff <= 2) return 'soon';
  return 'future';
}

// Compact label for the date pill. Examples: "1 Jun 2026", "TBA".
export function compactEventDateLabel(eventDate) {
  const date = plainEventDate(eventDate);
  if (!date) return 'TBA';
  const dt = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(dt.getTime())) return 'TBA';
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function normalizeFolderName(value) {
  return cleanLinkText(String(value || '').replace(/\s*\(/g, ' ( ').replace(/\s*\)/g, ' ) '));
}

export function stripBracketed(value) {
  return value.replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ');
}

export function normalizeLinkUrl(value) {
  let v = String(value || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v) && /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#].*)?$/i.test(v)) {
    v = `https://${v}`;
  }
  try {
    const url = new URL(v);
    if (!/^https?:$/i.test(url.protocol) || !url.hostname.includes('.')) return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function normalizeInvoiceTitleValue(value) {
  return /^mr\.?$/i.test(cleanLinkText(value)) ? 'Mr.' : 'Ms.';
}

export function folderCodeFromEventDate(value) {
  const raw = String(value || '').trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return iso[1].slice(2) + iso[2] + iso[3];
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return slash[3].slice(2) + slash[2].padStart(2, '0') + slash[1].padStart(2, '0');
  return '';
}
