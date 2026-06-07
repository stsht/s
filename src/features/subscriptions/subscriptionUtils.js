// Pure subscription helpers extracted from WorkspacePages.jsx.
//
// These are shared between the /subs page (live preview + JPG) and
// the /db Subs detail/import flows that remain in WorkspacePages.jsx.
// Keeping them dependency-light (only the shared title-case util and
// the constants module) means WorkspacePages.jsx can import them back
// without a circular dependency.
import { toTitleCase } from '../../utils/titleCase.js';
import { SUBS_IMPORT_SERVICE_ALIASES, SUBS_NON_STORAGE_SERVICES } from './subscriptionConstants.js';

export function fmtSubsDate(value) {
  if (!value) return '-';
  const [y, m, d] = String(value).split('-').map(Number);
  if (!y || !m || !d) return '-';
  // Build a noon-UTC date so en-US localisation never drifts a day
  // on either side of midnight.
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function fmtSubsTime(value) {
  if (!value) return '-';
  // Reference card uses the European "HH.mm" form (e.g. 20.21).
  const [h = '00', mi = '00'] = String(value).split(':');
  return `${h.padStart(2, '0')}.${mi.padStart(2, '0')}`;
}

export function safeSubsToken(value) {
  return String(value || '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

export function todaySubs() {
  return new Date().toISOString().slice(0, 10);
}

export function nowSubsTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// addDays(date, n) — UTC-safe day arithmetic shared by invoice (due
// date) and paid (expiry) calculations. Returns "" when the input
// can't be parsed so the caller can fall back to "-" in the UI.
export function addDays(value, days) {
  if (!value) return '';
  const [y, m, d] = String(value).split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + (Number(days) || 0));
  return dt.toISOString().slice(0, 10);
}

export function loadTesseract() {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) {
      resolve(window.Tesseract);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.onload = () => {
      if (window.Tesseract) {
        resolve(window.Tesseract);
      } else {
        reject(new Error('Tesseract global object not found.'));
      }
    };
    script.onerror = () => {
      reject(new Error('Failed to load Tesseract.js from CDN.'));
    };
    document.head.appendChild(script);
  });
}

export function parseOcrText(text) {
  const result = {
    paymentDate: '',
    paymentTime: '',
    startDate: '',
    startTime: '',
    expiryDate: '',
    expiryTime: '',
    accessPeriod: 0,
    paidAmount: 0,
    service: '',
    status: '',
    hasMr: false
  };

  if (!text) return result;

  // Check if text suggests "Mr."
  if (/\bMr\.?\b/i.test(text)) {
    result.hasMr = true;
  }

  // Helper to normalize month names
  const months = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    january: '01', february: '02', march: '03', april: '04', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
  };

  // Find all dates in format "Month DD, YYYY" or "DD Month YYYY"
  const dateRegex = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/ig;
  const datesFound = [];
  let match;
  while ((match = dateRegex.exec(text)) !== null) {
    const monthName = match[1].toLowerCase();
    const month = months[monthName] || '01';
    const day = match[2].padStart(2, '0');
    const year = match[3];
    datesFound.push(`${year}-${month}-${day}`);
  }

  // Find all times in format "HH.MM" or "HH:MM"
  const timeRegex = /\b(\d{2})[.:](\d{2})\b/g;
  const timesFound = [];
  while ((match = timeRegex.exec(text)) !== null) {
    timesFound.push(`${match[1]}:${match[2]}`);
  }

  if (datesFound.length >= 1) result.paymentDate = datesFound[0];
  if (datesFound.length >= 2) result.startDate = datesFound[1];
  else if (datesFound.length === 1) result.startDate = datesFound[0]; // fallback
  if (datesFound.length >= 3) result.expiryDate = datesFound[2];

  if (timesFound.length >= 1) result.paymentTime = timesFound[0];
  if (timesFound.length >= 2) result.startTime = timesFound[1];
  else if (timesFound.length === 1) result.startTime = timesFound[0]; // fallback
  if (timesFound.length >= 3) result.expiryTime = timesFound[2];
  else if (result.startTime) result.expiryTime = result.startTime;

  const accessMatch = text.match(/Access\s+Period[\s\S]{0,50}?(\d{1,3})\s*Days?/i)
    || text.match(/\b(\d{1,3})\s*Days?\b/i);
  if (accessMatch) result.accessPeriod = Number(accessMatch[1]) || 0;

  const amountMatch = text.match(/Paid\s+Amount\s*[:\-\s]*\s*Rp\s*([\d.,]+)/i)
    || text.match(/Total\s*[:\-\s]*\s*Rp\s*([\d.,]+)/i);
  if (amountMatch) result.paidAmount = Number(String(amountMatch[1]).replace(/[.,]/g, '')) || 0;

  const serviceAlias = SUBS_IMPORT_SERVICE_ALIASES.find((item) => item.pattern.test(text));
  if (serviceAlias) result.service = serviceAlias.label;

  if (/Payment\s+Received|Subscription\s+Confirmed|\bPaid\b/i.test(text)) result.status = 'paid';

  return result;
}

// Map a saved subscription row to the props the print cards expect.
// Mirrors the derived view-model SubscriptionsPage builds from local
// state so the same JPG comes out whether you print from /subs (live
// preview) or from /db Subs detail (saved row).
export function subscriptionToCardProps(sub = {}) {
  const period = Number(sub?.access_period);
  const periodLabel = Number.isFinite(period) && period > 0 ? `${period} Days` : '';
  const service = String(sub?.service || 'Subscription');
  const storageRaw = String(sub?.storage_slot || '');
  // Storage is dropped for non-storage products (ChatGPT/Copilot) the
  // same way SubscriptionsPage drops it, so the invoice card stays
  // visually identical between live preview and re-print.
  const showStorage = !SUBS_NON_STORAGE_SERVICES.has(service) && Boolean(storageRaw);
  const showDuration = Number.isFinite(period) && period > 0;
  const durationLabel = showDuration ? `${period} Days` : '';
  const lineSubtitle = [showStorage ? storageRaw : '', durationLabel]
    .filter(Boolean)
    .join(' \u00b7 ');
  return {
    titlePrefix: String(sub?.client_title || ''),
    displayClient: toTitleCase(sub?.client_name || '') || 'Client',
    service,
    // Optional free-text reference/receipt note. Rendered on the paid
    // receipt only when present, so existing rows without a note are
    // unaffected. Reads the first non-empty of the tolerated aliases.
    note: String(sub?.note || sub?.receipt_note || sub?.reference || sub?.reference_note || '').trim(),
    price: Number.isFinite(Number(sub?.price)) ? Number(sub.price) : 0,
    paymentDate: sub?.payment_date || '',
    paymentTime: sub?.payment_time || '',
    startDate: sub?.start_date || '',
    startTime: sub?.start_time || '',
    // Saved expiry_time may equal start_time (worker's default
    // fallback when the receipt didn't carry a distinct expiry
    // time), but pass the saved value through so a row with a
    // distinct expiry time prints what was actually stored. The
    // start_time fallback is kept for legacy rows missing the
    // expiry_time column entirely.
    expiryDate: sub?.expiry_date || '',
    expiryTime: sub?.expiry_time || sub?.start_time || '',
    issuedDate: sub?.invoice_date || '',
    // Optional per-period payment proof (URL or short reference).
    // Surfaced as a subtle indicator on the receipt only when set.
    paymentProof: String(sub?.payment_proof || '').trim(),
    periodLabel,
    storage: storageRaw,
    showStorage,
    showDuration,
    durationLabel,
    lineSubtitle,
  };
}
