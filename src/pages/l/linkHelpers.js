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

// Reverse of folderCodeFromEventDate: the YYMMDD (or YYYYMMDD) code that
// starts a folder name becomes a YYYY-MM-DD event date, e.g.
// "261110 Silvia" -> "2026-11-10". The code must be the first word and be a
// real calendar date; anything else returns '' so a typo never becomes a date.
export function eventDateFromFolderName(value) {
  const match = cleanLinkText(value).match(/^(\d{6}|\d{8})(?=\s|$)/);
  if (!match) return '';
  const code = match[1].length === 8 ? match[1].slice(2) : match[1];
  const year = 2000 + Number(code.slice(0, 2));
  const month = Number(code.slice(2, 4));
  const day = Number(code.slice(4, 6));
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// True when the folder's first word looks like a date code (6 or 8 digits)
// but is not a real calendar date, e.g. "261340 Silvia" (month 13). Folders
// with no date code at all are not flagged; they keep today's behaviour.
export function hasInvalidFolderDate(value) {
  const looksLikeCode = /^(\d{6}|\d{8})(?=\s|$)/.test(cleanLinkText(value));
  return looksLikeCode && !eventDateFromFolderName(value);
}

// Decides the Event Date once a folder name is entered. `source` says where
// the current date came from: '' (empty), 'auto' (filled from the folder
// earlier), 'manual' (picked or cleared by the operator) or 'locked' (handed
// off from /db or /inv, or the standalone default). Only '' and 'auto' may be
// filled or refreshed from the folder, so a chosen date is never overwritten.
export function resolveAutoEventDate({ source, current, folder }) {
  if (source === 'manual' || source === 'locked') return { value: current, source };
  const derived = eventDateFromFolderName(folder);
  if (derived) return { value: derived, source: 'auto' };
  if (source === 'auto') return { value: '', source: '' };
  return { value: current, source };
}
