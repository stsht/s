/**
 * dateTimeFieldUtils
 *
 * Pure constants + parsing/grid helpers shared by DateTimeField and
 * its calendar popover. Extracted verbatim from DateTimeField.jsx so
 * the field connector and the popover can both consume them without
 * duplicating logic. No behaviour change — same wire format, same
 * accepted paste shapes, same Monday-first month grid.
 */

// ── Calendar labels ─────────────────────────────────────────────
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const DOW_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

// ── Helpers ──────────────────────────────────────────────────────
export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Build the 6-week (42 cell) month grid that the popover renders.
// Monday-first so European week conventions line up with the rest
// of the operator UI. Every cell carries the ISO date it represents
// plus a `muted` flag for cells that fall outside the active month
// (so they can be styled greyer without computing a separate range).
export function buildMonthGrid(year, month) {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  // 0 = Mon, 6 = Sun (rotate JS's 0=Sun..6=Sat by 6).
  const dow = (firstOfMonth.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(year, month - 1, 1 - dow));
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    cells.push({
      iso,
      day: d.getUTCDate(),
      muted: d.getUTCMonth() !== month - 1,
    });
  }
  return cells;
}

// Strip seconds from an HH:MM:SS so the segments only ever store
// the canonical 'HH:mm' shape on the wire. Returns '' for unparsable
// input; the caller treats that as "leave the time empty".
export function normaliseHhmm(value) {
  const raw = String(value || '').trim();
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(raw);
  if (!match) return '';
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return '';
  return `${match[1]}:${match[2]}`;
}

// Parse a pasted blob into segment values. Accepts the common
// ways an operator might paste a date (with or without time):
//   28052026
//   28/05/2026   28-05-2026   28.05.2026
//   2026-05-28   2026/05/28
//   28/05/2026 18:30   2026-05-28T18:30:00
// Returns null when no recognisable date is present.
export function parsePastedDateTime(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  // Pattern 1: ISO-ish 'YYYY-MM-DD' optionally followed by a time
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::\d{2})?)?/.exec(raw);
  if (m) {
    return packDateTime(m[3], m[2], m[1], m[4], m[5]);
  }

  // Pattern 2: 'DD/MM/YYYY' optionally followed by a time
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T\s](\d{1,2}):(\d{2})(?::\d{2})?)?/.exec(raw);
  if (m) {
    return packDateTime(m[1], m[2], m[3], m[4], m[5]);
  }

  // Pattern 3: bare 8-digit run 'DDMMYYYY' (optionally followed by 4
  // digits 'HHMM'). 12 digits collapse to date+time.
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 8) {
    const dd = digits.slice(0, 2);
    const mm = digits.slice(2, 4);
    const yyyy = digits.slice(4, 8);
    const hh = digits.length >= 10 ? digits.slice(8, 10) : '';
    const mn = digits.length >= 12 ? digits.slice(10, 12) : '';
    return packDateTime(dd, mm, yyyy, hh, mn);
  }
  return null;
}

export function packDateTime(dd, mm, yyyy, hh, mn) {
  const day = String(dd || '').padStart(2, '0');
  const month = String(mm || '').padStart(2, '0');
  const year = String(yyyy || '');
  if (!/^\d{2}$/.test(day) || !/^\d{2}$/.test(month) || !/^\d{4}$/.test(year)) return null;
  const dNum = Number(day);
  const mNum = Number(month);
  const yNum = Number(year);
  if (mNum < 1 || mNum > 12 || dNum < 1 || dNum > 31 || yNum < 1900 || yNum > 2999) return null;
  let hour = '';
  let minute = '';
  if (hh && mn) {
    const h = String(hh).padStart(2, '0');
    const mi = String(mn).padStart(2, '0');
    if (/^\d{2}$/.test(h) && /^\d{2}$/.test(mi) && Number(h) < 24 && Number(mi) < 60) {
      hour = h;
      minute = mi;
    }
  }
  return { day, month, year, hour, minute };
}
