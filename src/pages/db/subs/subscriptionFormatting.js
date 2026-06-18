// Human-friendly date label used across the /db Subs detail views.
// Extracted verbatim from DatabasePage.jsx so the Subs detail module
// (src/pages/db/subs/*) and its period-history rows can share one
// formatter. Anchors bare YYYY-MM-DD strings at noon UTC so the en-GB
// "DD MMM YYYY" rendering doesn't drift one day in negative
// timezones. Values that already carry a time component (ISO
// timestamps from created_at, etc.) flow through new Date() unchanged.
export function dateLabel(value) {
  if (!value) return 'No date';
  const raw = String(value);
  const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const date = isoDate ? new Date(`${raw}T12:00:00Z`) : new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
