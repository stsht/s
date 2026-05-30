import { useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { GlobalBackground } from '../../components/GlobalBackground.jsx';
import { Combobox, DateTimeField } from '../../components/ui/index.js';
import { toTitleCase, maybeTitleCase, onBlurTitleCase } from '../../utils/titleCase.js';
import { selectAllIfZero } from '../../utils/moneyInput.js';

// Lightweight gated debug logger. Mirrors the helper in
// WorkspacePages.jsx so /db, /l, and /inv share one ?debug=1 flag
// (sticky for the tab via sessionStorage). Used to trace the
// event-grouping handoff: rowEventKey → URL ?eventKey= → composer
// state → /api/invoices-save body → /db row. No-op when the flag
// is off so the calls are safe to leave in production code paths.
function dbgEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    const url = new URLSearchParams(window.location.search);
    if (url.get('debug') === '1') {
      try { window.sessionStorage?.setItem('starshots_debug_grouping', '1'); } catch {}
      return true;
    }
    return window.sessionStorage?.getItem('starshots_debug_grouping') === '1';
  } catch {
    return false;
  }
}

function dbg(...args) {
  if (dbgEnabled()) console.log('[grouping]', ...args);
}

// Hardcoded fallback catalogue. The catalogue is normally fetched
// from the Supabase-backed /api/packages endpoint (see _worker.js
// handlePackagesGet) and these values are kept as a safety net so
// /inv keeps working when the API returns empty, fails, or is
// unreachable. Same shape as the API rows: { id, name, price, note,
// is_default }.
const DEFAULT_PACKAGES = [
  { id: 'school-basic',         name: 'School without Magician', price: 800000,  note: 'school celebration without magician',                is_default: true },
  { id: 'school-magician',      name: 'School with Magician',    price: 1000000, note: 'school celebration with magician',                   is_default: true },
  { id: 'studio-special',       name: 'Studio Special',          price: 800000,  note: 'up to 1 hour',                                       is_default: true },
  { id: 'intimate-party',       name: 'Intimate Party',          price: 1300000, note: 'up to 2 hours, suitable for family celebration',     is_default: true },
  { id: 'birthday-celebration', name: 'Birthday Celebration',    price: 1650000, note: 'up to 3.5 hours, suitable for Birthday Celebration', is_default: true },
];

// Bank transfer destination shown when the operator picks
// "Bank Transfer" instead of "QR" in the payment block. Centralised
// here so a future switch is a single-line change with no JSX/CSS
// edits.
const BANK_DETAILS = {
  bank: 'Mandiri',
  accountName: 'BELLY',
  accountNumber: '1050023197043',
  accountHolderLabel: 'BELLY',
};

// Available payment methods rendered inside .payment-box. The
// segmented control in the editor toggles between these; the
// preview/JPG renders exactly one — never both — so the exported
// invoice is always unambiguous about how the client should pay.
const PAYMENT_METHODS = [
  { value: 'qr',   label: 'QR' },
  { value: 'bank', label: 'Bank Transfer' },
];

// Title-case rules (small-words set, preserve list, regex token
// matcher) live in `src/utils/titleCase.js` so /subs and /inv share
// the exact same display normalisation. The composer used to carry
// a local `titleCasePackageText` helper here; that has been removed
// in favour of `toTitleCase` from the shared utility.

const today = new Date().toISOString().slice(0, 10);
// Live Preview is fit-to-width only — the sheet is scaled down so it
// always fits the preview column, then the panel scrolls vertically.
// There is intentionally no user-facing zoom (no Fit button, no
// +/- controls, no ctrl-wheel handler); the preview is stable and
// non-interactive beyond scrolling.
const INVOICE_PREVIEW_WIDTH = 1000;
const INVOICE_PREVIEW_MIN_HEIGHT = 707;

// Deposit defaults: 20% of grand total, but never less than IDR
// 200,000. The 200K floor is the operator's invoicing minimum;
// it is capped at the grand total so a tiny invoice (smaller than
// the floor itself) cannot ask for more than 100% deposit. The
// preset ladder is the short list of common ratios; "custom" lets
// the operator type a raw IDR override that bypasses the percent
// calculation entirely (still capped at the grand total).
const DEPOSIT_PRESETS = [20, 30, 50, 100];
const DEPOSIT_MIN_IDR = 200000;

function computeDepositDue(grandTotal, mode, customAmount) {
  const total = Math.max(0, Math.round(Number(grandTotal) || 0));
  if (total <= 0) return 0;
  if (mode === 'custom') {
    const raw = Math.max(0, Math.round(Number(customAmount) || 0));
    return Math.min(total, raw);
  }
  const percent = Number(mode) || 0;
  const fromPercent = Math.round((total * percent) / 100);
  // Apply the IDR floor only when the percent calculation falls
  // below it. Higher presets (30/50/100) skip the floor naturally
  // since they already exceed it for any realistic invoice.
  const floored = Math.max(fromPercent, DEPOSIT_MIN_IDR);
  return Math.min(total, floored);
}

// Inverse of computeDepositDue: for older invoice rows that only
// stored a flat deposit_amount, infer the matching preset (or fall
// back to 'custom') so the deposit selector hydrates predictably.
// Tolerance is ±1% of the grand total to absorb prior rounding.
function inferDepositMode(grandTotal, depositAmount) {
  const total = Math.max(0, Math.round(Number(grandTotal) || 0));
  const amount = Math.max(0, Math.round(Number(depositAmount) || 0));
  if (total <= 0 || amount <= 0) return { mode: '20', customAmount: '' };
  const tolerance = Math.max(1, Math.round(total * 0.01));
  for (const preset of DEPOSIT_PRESETS) {
    const expected = computeDepositDue(total, String(preset), '');
    if (Math.abs(expected - amount) <= tolerance) {
      return { mode: String(preset), customAmount: '' };
    }
  }
  return { mode: 'custom', customAmount: String(amount) };
}

// Most recent paid deposit instalment amount. Drives the Deposit
// tab's "Ask DP" auto-follow: when the operator opens Ask DP, the
// requested deposit due snaps to whatever the client most recently
// paid so the figure we ask for matches reality. "Latest" is by
// paid date+time, falling back to recording order (the last row
// added) when dates tie or are missing. Returns 0 when no paid
// instalment carries a positive amount, in which case the caller
// falls back to the 20% preset default.
function latestPaidDepositAmount(payments) {
  const paid = (payments || [])
    .map((payment, index) => ({
      index,
      amount: Math.max(0, Math.round(Number(payment?.amount) || 0)),
      paid: Boolean(payment?.paid),
      key: `${payment?.paidAtDate || ''} ${payment?.paidAtTime || ''}`,
    }))
    .filter((payment) => payment.paid && payment.amount > 0);
  if (!paid.length) return 0;
  paid.sort((a, b) => (a.key === b.key ? a.index - b.index : (a.key < b.key ? -1 : 1)));
  return paid[paid.length - 1].amount;
}

function rupiah(value) {
  const number = Number(value) || 0;
  return `Rp ${Math.round(number).toLocaleString('id-ID')}`;
}

// Whether the deposit is effectively the full grand total. Drives
// the "Deposit Due" vs "Payment Due" wording in both the editor's
// Payment fieldset and the preview/JPG payment caption: a 100%
// preset (or a custom amount that meets/exceeds the grand total)
// shouldn't be called a deposit. Returns false when grandTotal is
// zero so an empty draft never reads "Payment Due Rp 0".
function isFullPayment(totals) {
  const grand = Math.max(0, Math.round(Number(totals?.grandTotal) || 0));
  const due = Math.max(0, Math.round(Number(totals?.depositDue) || 0));
  return grand > 0 && due >= grand;
}

function prettyDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

// Combined "Event Date • Event Time" formatter used by the
// preview/JPG Details box. Renders `28 May 2026 • 18:30` when both
// are present, just the date when time is empty, and the existing
// dash when the date itself is empty so empty drafts don't
// suddenly read "•".
function prettyDateTime(date, time) {
  if (!date) return '-';
  const datePart = prettyDate(date);
  const raw = String(time || '').trim();
  const match = /^(\d{2}):(\d{2})/.exec(raw);
  if (!match) return datePart;
  return `${datePart} \u2022 ${match[1]}:${match[2]}`;
}

// Title options shown in the modernized Bill To selector. Searchable
// labels via Combobox so a /family/ event still types straight to
// the option without scrolling. Keeping these as plain strings so
// the same set works for a future custom title (the Combobox would
// only need a free-text override; today the catalogue is fixed).
const TITLE_OPTIONS = ['Ms.', 'Mr.', 'Mrs.', 'Family'];

function emptyItem(packages) {
  const option = (packages && packages[0]) || DEFAULT_PACKAGES[0];
  return {
    id: crypto.randomUUID(),
    packageId: String(option.id || ''),
    name: option.name,
    note: option.note || '',
    qty: 1,
    price: Number(option.price) || 0,
  };
}

function cleanPackageRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      id: String(row.id || ''),
      name: String(row.name || '').trim(),
      note: String(row.note || '').trim(),
      price: Math.max(0, Math.round(Number(row.price) || 0)),
      is_default: !!row.is_default,
    }))
    .filter((row) => row.name);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Local-time "YYYY-MM-DD" / "HH:MM" for a freshly created deposit
// payment row. Uses the operator's system clock (not toISOString,
// which is UTC) so a deposit recorded at 23:30 local time doesn't
// roll forward to the next calendar day.
function nowDateParts() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

// Factory for a new deposit instalment row. Each row is a recorded
// deposit payment: { id, paid, paidAtDate, paidAtTime, amount }.
// Defaults are "paid now, for the current Invoice-tab deposit due"
// — a blank/zero due simply lands as 0, which reads like a
// placeholder via the shared selectAllIfZero focus behaviour.
function makeDepositPayment(amountDefault) {
  const { date, time } = nowDateParts();
  return {
    id: crypto.randomUUID(),
    paid: true,
    paidAtDate: date,
    paidAtTime: time,
    amount: Math.max(0, Math.round(Number(amountDefault) || 0)),
  };
}

function imageFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = URL.createObjectURL(file);
  });
}

function cropBoundsToSquare(bounds, width, height, marginRatio = 0.06) {
  const side = Math.max(bounds.width, bounds.height);
  const margin = side * marginRatio;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const cropSide = clamp(side + margin * 2, 24, Math.min(width, height));
  const x = clamp(centerX - cropSide / 2, 0, width - cropSide);
  const y = clamp(centerY - cropSide / 2, 0, height - cropSide);
  return { x, y, width: cropSide, height: cropSide };
}

// Center-square crop with a small inward padding so neither dimension
// of the source spills off the canvas. Used as the safety fallback
// whenever automatic QR detection fails — it guarantees we ship a
// square crop instead of stretching the entire screenshot into a
// 1:1 box. The crop side is min(width, height) so a tall mobile
// screenshot loses the top/bottom UI bands but keeps the centred
// QR (which is where operators tend to paste them); the inward
// inset trims a sliver of the very edge so a bezel-thin border
// doesn't dominate the output.
function centerSquareCrop(width, height, insetRatio = 0.02) {
  const side = Math.min(width, height);
  const inset = Math.round(side * insetRatio);
  const cropSide = Math.max(24, side - inset * 2);
  const x = Math.round((width - cropSide) / 2);
  const y = Math.round((height - cropSide) / 2);
  return { x, y, width: cropSide, height: cropSide };
}

// Heuristic QR-code locator. Used as a fallback when the platform
// has no BarcodeDetector (e.g. Safari pre-17) or the detector
// returns nothing. QR codes are bimodal: roughly half of their
// pixels are near-black and half near-white, with very few mid-
// tones. We exploit that by computing per-window dark- and light-
// pixel density at low resolution and scoring candidate squares
// by:
//
//   1. dark + light coverage > 0.65 (strongly bimodal — most
//      pixels are either near-black or near-white, not mid-grey),
//   2. dark density between 0.20 and 0.70 (matches the printable
//      QR range across version sizes + error-correction levels),
//   3. closeness of the dark/light split to 50/50 (the closer a
//      QR module distribution is to balanced, the higher the
//      score).
//
// The score is then weighted by the candidate side length so the
// algorithm prefers larger valid windows (a QR code) over equally
// bimodal but smaller patches (e.g. a checkerbox icon). The
// returned bounds are scaled back to the original image's
// coordinate space.
function findDenseSquare(ctx, width, height) {
  const maxSide = 720;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const sampleWidth = Math.max(1, Math.round(width * scale));
  const sampleHeight = Math.max(1, Math.round(height * scale));
  const sample = document.createElement('canvas');
  sample.width = sampleWidth;
  sample.height = sampleHeight;
  const sampleCtx = sample.getContext('2d', { willReadFrequently: true });
  sampleCtx.drawImage(ctx.canvas, 0, 0, sampleWidth, sampleHeight);
  const pixels = sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const stride = sampleWidth + 1;
  const darkInt = new Uint32Array(stride * (sampleHeight + 1));
  const lightInt = new Uint32Array(stride * (sampleHeight + 1));

  for (let y = 0; y < sampleHeight; y += 1) {
    let rowDark = 0;
    let rowLight = 0;
    for (let x = 0; x < sampleWidth; x += 1) {
      const index = (y * sampleWidth + x) * 4;
      const alpha = pixels[index + 3];
      const lum = pixels[index] + pixels[index + 1] + pixels[index + 2];
      if (alpha > 32) {
        if (lum < 360) rowDark += 1;
        else if (lum > 600) rowLight += 1;
      }
      darkInt[(y + 1) * stride + x + 1] = darkInt[y * stride + x + 1] + rowDark;
      lightInt[(y + 1) * stride + x + 1] = lightInt[y * stride + x + 1] + rowLight;
    }
  }

  function rectSum(integral, x, y, side) {
    const x2 = x + side;
    const y2 = y + side;
    return integral[y2 * stride + x2] - integral[y * stride + x2] - integral[y2 * stride + x] + integral[y * stride + x];
  }

  let best = null;
  const minDimension = Math.min(sampleWidth, sampleHeight);
  const minSide = Math.max(60, Math.round(minDimension * 0.16));
  const maxQrSide = Math.round(minDimension * 0.92);
  const sideStep = Math.max(8, Math.round(minDimension / 40));

  for (let side = maxQrSide; side >= minSide; side -= sideStep) {
    const stepStride = Math.max(6, Math.round(side / 16));
    const area = side * side;
    for (let y = 0; y <= sampleHeight - side; y += stepStride) {
      for (let x = 0; x <= sampleWidth - side; x += stepStride) {
        const dRatio = rectSum(darkInt, x, y, side) / area;
        if (dRatio < 0.20 || dRatio > 0.70) continue;
        const lRatio = rectSum(lightInt, x, y, side) / area;
        if (lRatio < 0.20 || lRatio > 0.78) continue;
        const coverage = dRatio + lRatio;
        if (coverage < 0.65) continue;
        const balance = 1 - Math.abs(dRatio - 0.5) * 1.6;
        if (balance <= 0) continue;
        const score = side * balance * Math.min(1, coverage);
        if (!best || score > best.score) best = { x, y, width: side, height: side, score };
      }
    }
  }

  if (!best) return null;
  return {
    x: best.x / scale,
    y: best.y / scale,
    width: best.width / scale,
    height: best.height / scale,
  };
}

// Crop an uploaded payment screenshot down to a square 1:1 image
// of the QR code itself. Three strategies in priority order:
//
//   1. BarcodeDetector — the best signal when the browser ships
//      it (Chromium/Edge, Safari 17+). The detector returns the
//      QR's exact boundingBox, which we square-pad slightly so a
//      tight crop still includes the quiet zone.
//   2. findDenseSquare — bimodal-density heuristic that locates
//      the QR by its black/white module distribution. Used when
//      the detector is absent or returned nothing.
//   3. centerSquareCrop — last-resort "safe" crop. Never falls
//      through to "use the entire image": surrounding payment-
//      page UI ("Dicetak Oleh", margins, full screenshot) must
//      not bleed into the QR canvas. A center square with a tiny
//      inset is always smaller than the whole page and keeps the
//      QR readable when it's near the centre, which is how
//      operators frame their screenshots.
//
// The final output is a 720x720 PNG with a flat white background
// so the invoice sheet's QR slot renders consistently regardless
// of the source image's aspect ratio.
async function cropQrImage(file) {
  const image = await imageFromFile(file);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);

  let bounds = null;
  if ('BarcodeDetector' in window) {
    try {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const [barcode] = await detector.detect(image);
      if (barcode?.boundingBox) bounds = barcode.boundingBox;
    } catch {}
  }

  if (!bounds) bounds = findDenseSquare(ctx, canvas.width, canvas.height);

  // Reject "detections" that essentially span the entire image.
  // Both BarcodeDetector and findDenseSquare can misfire on a
  // full-page screenshot by reporting the whole frame as the QR
  // — applying that crop would still ship the whole page. When
  // the detected bounds cover ~the full source we treat it as
  // no detection and fall through to the center-square fallback.
  const minDim = Math.min(canvas.width, canvas.height);
  if (bounds && Math.max(bounds.width, bounds.height) > minDim * 0.94) {
    bounds = null;
  }

  const crop = bounds
    ? cropBoundsToSquare(bounds, canvas.width, canvas.height)
    : centerSquareCrop(canvas.width, canvas.height);
  const output = document.createElement('canvas');
  output.width = 720;
  output.height = 720;
  const outputCtx = output.getContext('2d');
  outputCtx.imageSmoothingEnabled = false;
  outputCtx.fillStyle = '#fff';
  outputCtx.fillRect(0, 0, output.width, output.height);
  outputCtx.drawImage(canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, output.width, output.height);
  URL.revokeObjectURL(image.src);
  return output.toDataURL('image/png');
}

// Read the URL search params once on mount. Two flows:
//   1. invoiceId=<id> -> fetch /api/invoices-get and hydrate the
//      whole composer (title/name/contact/venue/dates/items/discount/
//      deposit/QR) from the row + invoice_data blob.
//   2. title/name/contact/eventDate (no invoiceId) -> just pre-fill
//      Bill-To / Details for a fresh invoice draft created from /db.
//
// `eventDate` is sanitised to a bare YYYY-MM-DD; older /db builds
// occasionally passed a created_at/updated_at timestamp here, which
// the <input type="date"> binding silently rejects (rendering the
// field blank instead of the typed date). Anything that isn't a
// pure YYYY-MM-DD string is dropped so the form falls back to the
// empty default the operator can edit.
function readInitialQuery() {
  if (typeof window === 'undefined') return {};
  try {
    const params = new URLSearchParams(window.location.search);
    const rawEventDate = (params.get('eventDate') || '').trim();
    const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(rawEventDate) ? rawEventDate : '';
    return {
      invoiceId: (params.get('invoiceId') || '').trim(),
      title: (params.get('title') || '').trim(),
      name: (params.get('name') || '').trim(),
      contact: (params.get('contact') || '').trim(),
      eventDate,
      // Stable per-event grouping key handed off from /db. Empty
      // when /inv is opened standalone or via top-level "Create
      // Invoice" with no event selected, in which case the saved
      // invoice carries no event_key and behaves as a brand-new
      // event. When non-empty it is the existing event row's
      // event_key (or the cross-ref anchor id when the row has no
      // event_key yet) and is persisted on save so /db's grouping
      // pass merges this invoice with its sibling delivery.
      eventKey: (params.get('eventKey') || '').trim().slice(0, 80),
      // Stable parent clients.id forwarded by /db's Create Events
      // sheet. Empty for top-level Create Invoice / legacy buckets
      // — the worker still has its name+contact fallback. When set
      // it is forwarded on save so handleInvoiceSave attaches the
      // invoice to THIS exact clients row instead of name+contact-
      // matching its way to a duplicate sibling.
      clientId: (params.get('clientId') || '').trim().slice(0, 80),
    };
  } catch {
    return {};
  }
}

export function InvoiceComposer() {
  const initial = useMemo(() => readInitialQuery(), []);
  // Mount-time visibility into the URL handoff so operators can
  // confirm /db sent eventKey/eventDate when "Create Invoice" was
  // pressed on an existing event row. Only emits when ?debug=1 is
  // active (see dbg helper at top of file).
  useEffect(() => {
    dbg('/inv readInitialQuery', initial);
    // Mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [mobileView, setMobileView] = useState('edit');
  const [mode, setMode] = useState('invoice');
  const [title, setTitle] = useState(initial.title || 'Ms.');
  const [clientName, setClientName] = useState(initial.name || '');
  const [contact, setContact] = useState(initial.contact || '');
  const [venue, setVenue] = useState('TBA');
  const [eventDate, setEventDate] = useState(initial.eventDate || '');
  // Event-of-day time stored as the native HTML "HH:MM" 24-hour
  // string (matches <input type=time>'s wire format). Persisted on
  // the typed event_time column AND mirrored into invoice_data
  // for older rows that may not have the column yet, so reopening
  // a saved invoice always restores whichever path the worker took.
  const [eventTime, setEventTime] = useState('');
  // Per-event grouping key. Sourced from the URL handoff or
  // hydrated from the saved row (row.event_key) so that subsequent
  // saves reuse it and /db's grouping pass merges this invoice
  // with its sibling delivery. Empty for a standalone /inv session
  // (top-level Create Invoice with no event context).
  const [eventKey, setEventKey] = useState(initial.eventKey || '');
  // Parent clients.id from the /db Create Events handoff. Sticky
  // for the session so subsequent saves keep targeting the same
  // bucket, but the worker re-validates the id (fetchClientById)
  // and falls back to name+contact when it's stale or unknown.
  const [linkedClientId, setLinkedClientId] = useState(initial.clientId || '');
  const [issuedDate, setIssuedDate] = useState(today);
  // Discount defaults to 0 — never auto-prefill a value. If the
  // operator wants a discount they type it; loaded invoices restore
  // whatever was saved on the row.
  const [discount, setDiscount] = useState(0);
  // Deposit mode is one of '20' | '30' | '50' | '100' | 'custom'.
  // Default '20' picks the 20% preset; computeDepositDue() then
  // applies the IDR-200,000 floor (capped at the grand total) so
  // small invoices never silently produce a 0 deposit.
  const [depositMode, setDepositMode] = useState('20');
  const [depositCustomAmount, setDepositCustomAmount] = useState('');
  const [depositAskOpen, setDepositAskOpen] = useState(true);
  const [paidConfirmed, setPaidConfirmed] = useState(true);
  const [{ date: initialPaidDate, time: initialPaidTime }] = useState(() => nowDateParts());
  const [paidAtDate, setPaidAtDate] = useState(initialPaidDate);
  const [paidAtTime, setPaidAtTime] = useState(initialPaidTime);
  // Deposit-mode payment ledger. Lives ONLY inside invoice_data —
  // no new DB columns. Each entry is a recorded deposit instalment
  // { id, paid, paidAtDate, paidAtTime, amount }. The Deposit tab is
  // where these are added/edited; the Invoice tab stays the source
  // of truth for identity, packages, discount and the requested
  // deposit due. `requestBalanceDue` used to gate the "Balance Due"
  // line on the Deposit Invoice JPG via an operator checkbox. The
  // Balance Due line is now ALWAYS shown in deposit mode (placed
  // right after Grand Total), so the flag is retained only for
  // backward-compatible data shape — it is persisted/hydrated but
  // no longer drives rendering. Defaults to true to reflect the
  // always-on behaviour for fresh drafts.
  const [depositPayments, setDepositPayments] = useState([]);
  const [requestBalanceDue, setRequestBalanceDue] = useState(true);
  const [packages, setPackages] = useState(DEFAULT_PACKAGES);
  const [items, setItems] = useState(() => [emptyItem(DEFAULT_PACKAGES)]);
  const [qrSrc, setQrSrc] = useState('/payment-qr.png');
  const [qrFileName, setQrFileName] = useState('');
  // Payment method shown inside the .payment-box. 'qr' renders the
  // QR image (default, original behaviour); 'bank' replaces the QR
  // with the BANK_DETAILS block above so the client can transfer
  // directly to BCA. Persisted in invoice_data so reopening a saved
  // invoice restores whatever the operator picked.
  const [paymentMethod, setPaymentMethod] = useState('qr');
  const [status, setStatus] = useState('');
  const [hydrating, setHydrating] = useState(Boolean(initial.invoiceId));
  // Save Status: when /inv is opened with ?invoiceId= we treat that
  // row as already-persisted so the toolbar button reads "Update
  // Status" and subsequent saves PATCH the same row instead of
  // creating duplicates. New drafts opened from /db Create Invoice
  // (with title/name/contact/eventDate handoff but no invoiceId)
  // start with savedId='' and the button reads "Save Status";
  // after the first successful save we capture json.invoice.id
  // here so further presses become updates.
  const [savedId, setSavedId] = useState(initial.invoiceId || '');
  const [saving, setSaving] = useState(false);
  const documentRef = useRef(null);
  const previousModeRef = useRef(mode);

  useEffect(() => {
    if (hydrating) {
      previousModeRef.current = mode;
      return;
    }
    if (mode === 'paid' && previousModeRef.current !== 'paid') {
      const { date, time } = nowDateParts();
      setPaidConfirmed(true);
      setPaidAtDate(date);
      setPaidAtTime(time);
    }
    previousModeRef.current = mode;
  }, [mode, hydrating]);

  // Load the package catalogue from Supabase on mount. If the API
  // returns at least one row we use it; otherwise we keep the
  // hardcoded defaults already in state. Network or schema errors
  // are swallowed so a momentary outage never blanks the dropdown.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/packages', { credentials: 'same-origin' });
        if (!response.ok) return;
        const json = await response.json().catch(() => null);
        const rows = Array.isArray(json?.packages) ? json.packages : [];
        if (cancelled) return;
        const cleaned = cleanPackageRows(rows);
        if (cleaned.length) setPackages(cleaned);
      } catch {
        // Keep DEFAULT_PACKAGES already in state.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Hydrate from /api/invoices-get when ?invoiceId= is present. We
  // read both the typed columns (client_title/name/contact/...) and
  // the loose invoice_data blob, since older rows may only have the
  // typed columns. Items default to a single line containing the
  // grand_total when the blob has no item array. Deposit hydration
  // prefers an explicit invoice_data.depositMode; otherwise it
  // reverse-engineers the closest preset from deposit_amount via
  // inferDepositMode().
  useEffect(() => {
    if (!initial.invoiceId) return;
    let cancelled = false;
    (async () => {
      try {
        setHydrating(true);
        const response = await fetch(
          `/api/invoices-get?id=${encodeURIComponent(initial.invoiceId)}`,
          { credentials: 'same-origin' },
        );
        if (!response.ok) return;
        const payload = await response.json().catch(() => null);
        const row = payload?.invoice;
        if (!row || cancelled) return;
        const data = (row.invoice_data && typeof row.invoice_data === 'object') ? row.invoice_data : {};

        if (row.client_title) setTitle(String(row.client_title));
        if (row.client_name != null) setClientName(String(row.client_name || ''));
        if (row.client_contact != null) setContact(String(row.client_contact || ''));
        if (data.venue != null || row.venue != null) setVenue(String(data.venue ?? row.venue ?? 'TBA'));
        if (row.event_date != null) setEventDate(String(row.event_date || ''));
        // Event time hydration. Prefer the typed column; fall back
        // to invoice_data.eventTime for older rows where the
        // column was empty. Anything that doesn't look like the
        // canonical HH:MM (or HH:MM:SS) shape is dropped so the
        // <input type=time> binding doesn't render a stray string.
        const rawEventTime = String(row.event_time || data.eventTime || '').trim();
        const matchEventTime = /^(\d{2}:\d{2})(?::\d{2})?$/.exec(rawEventTime);
        if (matchEventTime) setEventTime(matchEventTime[1]);
        // Adopt the row's event_key when the URL handoff didn't
        // already supply one. This way reopening an existing
        // invoice from /db keeps it grouped with its sibling
        // delivery on subsequent saves, even after the URL no
        // longer carries the eventKey query param.
        if (row.event_key && !initial.eventKey) setEventKey(String(row.event_key));
        // Same idea for client_id: when reopening an existing
        // invoice without a URL-supplied clientId, adopt the row's
        // own client_id so subsequent saves stay attached to that
        // clients row. The worker's findOrCreateClient validates
        // the id (fetchClientById) before using it.
        if (row.client_id && !initial.clientId) setLinkedClientId(String(row.client_id));
        if (row.invoice_date) setIssuedDate(String(row.invoice_date));
        if (row.status === 'invoice' || row.status === 'deposit' || row.status === 'paid') setMode(row.status);

        // Discount: explicit blob value wins; otherwise stay at 0.
        const blobDiscount = Number(data.discount);
        if (Number.isFinite(blobDiscount) && blobDiscount >= 0) setDiscount(blobDiscount);

        // Items: the blob is the source of truth when present; fall
        // back to a single synthetic line carrying the row's
        // grand_total so the preview never renders empty.
        const blobItems = Array.isArray(data.items) ? data.items : null;
        if (blobItems && blobItems.length) {
          setItems(blobItems.map((item) => ({
            id: String(item.id || crypto.randomUUID()),
            packageId: String(item.packageId || item.package_id || ''),
            name: String(item.name || ''),
            note: String(item.note || ''),
            qty: Number(item.qty) || 1,
            price: Math.max(0, Math.round(Number(item.price) || 0)),
          })));
        } else if (Number.isFinite(Number(row.grand_total)) && Number(row.grand_total) > 0) {
          const fallbackPrice = Math.max(0, Math.round(Number(row.grand_total) + (Number.isFinite(blobDiscount) ? blobDiscount : 0)));
          setItems([{
            id: crypto.randomUUID(),
            name: 'Package',
            note: '',
            qty: 1,
            price: fallbackPrice,
          }]);
        }

        // Deposit: trust the explicit blob mode if it looks valid,
        // otherwise reverse-engineer from the stored deposit_amount.
        const blobMode = String(data.depositMode || '');
        const validBlobMode = blobMode === 'custom'
          || DEPOSIT_PRESETS.some((preset) => String(preset) === blobMode);
        if (validBlobMode) {
          setDepositMode(blobMode);
          setDepositCustomAmount(String(data.depositCustomAmount || ''));
        } else {
          const inferred = inferDepositMode(row.grand_total, row.deposit_amount);
          setDepositMode(inferred.mode);
          setDepositCustomAmount(inferred.customAmount);
        }

        // Deposit instalment ledger + balance-due request. Both live
        // only in invoice_data (no DB columns). Backward compatible:
        // a legacy deposit row (status 'deposit', paid_amount > 0)
        // with no depositPayments array is surfaced as ONE synthesized
        // paid instalment so the historical deposit is visible instead
        // of an empty ledger. Malformed/missing data never crashes —
        // it falls through to an empty ledger.
        const blobPayments = Array.isArray(data.depositPayments) ? data.depositPayments : null;
        if (blobPayments && blobPayments.length) {
          setDepositPayments(blobPayments.map((payment) => {
            const rawDate = String(payment?.paidAtDate || '').trim();
            const rawTime = String(payment?.paidAtTime || '').trim();
            const timeMatch = /^(\d{2}:\d{2})/.exec(rawTime);
            return {
              id: String(payment?.id || crypto.randomUUID()),
              paid: payment?.paid !== false,
              paidAtDate: /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : '',
              paidAtTime: timeMatch ? timeMatch[1] : '',
              amount: Math.max(0, Math.round(Number(payment?.amount) || 0)),
            };
          }));
        } else if (row.status === 'deposit' && Math.round(Number(row.paid_amount) || 0) > 0) {
          const legacyDate = /^\d{4}-\d{2}-\d{2}$/.test(String(row.invoice_date || ''))
            ? String(row.invoice_date)
            : '';
          setDepositPayments([{
            id: crypto.randomUUID(),
            paid: true,
            paidAtDate: legacyDate,
            paidAtTime: '',
            amount: Math.max(0, Math.round(Number(row.paid_amount) || 0)),
          }]);
        }
        // Balance-due request flag: explicit blob value wins. For a
        // legacy deposit row that recorded a positive balance_due but
        // no flag, surface the Balance Due line by default so the
        // regenerated invoice keeps showing what the client still owes.
        if (typeof data.requestBalanceDue === 'boolean') {
          setRequestBalanceDue(data.requestBalanceDue);
        } else if (row.status === 'deposit' && Math.round(Number(row.balance_due) || 0) > 0) {
          setRequestBalanceDue(true);
        }

        if (typeof data.qrSrc === 'string' && data.qrSrc) setQrSrc(data.qrSrc);
        if (typeof data.qrFileName === 'string' && data.qrFileName) setQrFileName(data.qrFileName);
        if (data.paidReceipt && typeof data.paidReceipt === 'object') {
          setPaidConfirmed(data.paidReceipt.paid !== false);
          const rawPaidDate = String(data.paidReceipt.paidAtDate || '').trim();
          const rawPaidTime = String(data.paidReceipt.paidAtTime || '').trim();
          const paidTimeMatch = /^(\d{2}:\d{2})/.exec(rawPaidTime);
          if (/^\d{4}-\d{2}-\d{2}$/.test(rawPaidDate)) setPaidAtDate(rawPaidDate);
          if (paidTimeMatch) setPaidAtTime(paidTimeMatch[1]);
        } else if (row.status === 'paid' && row.invoice_date) {
          setPaidAtDate(String(row.invoice_date || '').slice(0, 10));
        }
        // Payment method: only adopt the saved value when it matches
        // a known option, otherwise stay on the default 'qr'. Older
        // rows pre-dating this field land here without a value and
        // keep behaving exactly as before.
        if (PAYMENT_METHODS.some((m) => m.value === data.paymentMethod)) {
          setPaymentMethod(String(data.paymentMethod));
        }
      } catch (error) {
        // Silently keep blank/defaults; the user can always re-fill.
        if (!cancelled) console.warn('[inv] hydrate failed:', error);
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => { cancelled = true; };
  }, [initial.invoiceId]);

  const totals = useMemo(() => {
    const subtotal = items.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.price) || 0), 0);
    const grandTotal = Math.max(0, subtotal - (Number(discount) || 0));
    const depositDue = computeDepositDue(grandTotal, depositMode, depositCustomAmount);
    return { subtotal, grandTotal, depositDue };
  }, [discount, depositMode, depositCustomAmount, items]);

  // Sum of the deposit instalments currently marked paid. This is the
  // figure persisted to paid_amount in deposit mode, and the basis for
  // the balance still owed. Toggled-off (unpaid) rows are excluded so
  // the operator can stage a row before confirming it landed.
  const depositPaidTotal = depositPayments.reduce(
    (sum, payment) => sum + (payment.paid ? Math.max(0, Math.round(Number(payment.amount) || 0)) : 0),
    0,
  );
  const balanceDue = Math.max(0, Math.round(Number(totals.grandTotal) || 0) - depositPaidTotal);

  function updateItem(id, patch) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function applyPackage(id, packageName) {
    const option = packages.find((pkg) => pkg.name === packageName);
    updateItem(id, option ? { packageId: String(option.id || ''), name: option.name, note: option.note || '', price: Number(option.price) || 0 } : { packageId: '', name: packageName });
  }

  async function savePackage(packageDraft, previousName = '') {
    const payload = {
      id: String(packageDraft?.id || ''),
      name: maybeTitleCase(String(packageDraft?.name || '').trim()),
      note: maybeTitleCase(String(packageDraft?.note || '').trim()),
      price: Math.max(0, Math.round(Number(packageDraft?.price) || 0)),
    };
    if (!payload.name) {
      setStatus('Package name is required.');
      return null;
    }
    if (!payload.price) {
      setStatus('Package price is required.');
      return null;
    }

    setStatus(payload.id ? 'Updating package...' : 'Adding package...');
    try {
      const response = await fetch('/api/packages-save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: payload }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || 'Package save failed.');
      const saved = cleanPackageRows([json.package])[0];
      if (!saved) throw new Error('Package save failed.');
      setPackages((current) => {
        const exists = current.some((pkg) => pkg.id && saved.id && pkg.id === saved.id);
        const next = exists
          ? current.map((pkg) => (pkg.id === saved.id ? saved : pkg))
          : [...current.filter((pkg) => pkg.name !== saved.name), saved];
        return next.sort((a, b) => a.name.localeCompare(b.name));
      });
      setItems((current) => current.map((item) => {
        const sameRow = saved.id && item.packageId === saved.id;
        const sameName = item.name === previousName || item.name === saved.name;
        return sameRow || sameName
          ? { ...item, packageId: saved.id, name: saved.name, note: saved.note || '', price: saved.price }
          : item;
      }));
      setStatus('Package saved.');
      return saved;
    } catch (error) {
      setStatus(error.message || 'Package save failed.');
      return null;
    }
  }

  async function deletePackage(packageId) {
    const id = String(packageId || '').trim();
    if (!id) return;
    const target = packages.find((pkg) => pkg.id === id);
    setStatus('Deleting package...');
    try {
      const response = await fetch('/api/packages-delete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || 'Package delete failed.');
      const nextPackages = packages.filter((pkg) => pkg.id !== id);
      const fallbackPackage = emptyItem(nextPackages.length ? nextPackages : DEFAULT_PACKAGES);
      setPackages(nextPackages);
      setItems((rows) => rows.map((item) => (
        item.packageId === id || item.name === target?.name
          ? { ...item, ...fallbackPackage, id: item.id }
          : item
      )));
      setStatus('Package deleted.');
    } catch (error) {
      setStatus(error.message || 'Package delete failed.');
    }
  }

  function addItem() {
    setItems((current) => [...current, emptyItem(packages)]);
  }

  function removeItem(id) {
    setItems((current) => current.length === 1 ? current : current.filter((item) => item.id !== id));
  }

  // Deposit ledger mutators. addDepositPayment seeds the new row with
  // the current system date/time and the Invoice-tab deposit due (see
  // makeDepositPayment). update/remove are the usual id-keyed patches.
  function addDepositPayment() {
    setDepositPayments((current) => [...current, makeDepositPayment(totals.depositDue)]);
  }

  function updateDepositPayment(id, patch) {
    setDepositPayments((current) => current.map((payment) => payment.id === id ? { ...payment, ...patch } : payment));
  }

  function removeDepositPayment(id) {
    setDepositPayments((current) => current.filter((payment) => payment.id !== id));
  }

  async function uploadQr(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setQrFileName(file.name);
    setStatus('Cropping QR...');
    try {
      setQrSrc(await cropQrImage(file));
      setStatus('QR ready.');
    } catch (error) {
      // cropQrImage already does both detection + center-square
      // fallback, so the only reason we land here is a hard failure
      // (e.g. unreadable file, decode error). Surface that instead
      // of silently shipping the raw screenshot — using the file as
      // the QR source would re-introduce the "whole payment page
      // shows up inside the QR slot" bug. Keep the previous QR (or
      // the default) and leave the operator to retry with a clearer
      // image.
      console.warn('[inv] QR crop failed:', error?.message || error);
      setStatus('Could not read that image. Try another QR screenshot.');
    }
  }

  async function saveInvoice() {
    const trimmedName = String(clientName || '').trim();
    if (!trimmedName) {
      setStatus('Client name is required to Save.');
      return;
    }
    setSaving(true);
    setStatus('Saving invoice\u2026');
    try {
      const grandTotal = Math.max(0, Math.round(Number(totals.grandTotal) || 0));
      const depositDue = Math.max(0, Math.round(Number(totals.depositDue) || 0));
      // paid_amount / balance_due are mode-driven:
      //   • paid    — invoice settled in full: paid = grand, balance 0.
      //   • deposit — paid = sum of the recorded *paid* instalments
      //               (depositPaidTotal); balance = whatever remains
      //               of the grand total.
      //   • invoice — draft: nothing collected yet.
      // deposit_amount always stores the *requested* deposit due so the
      // figure survives independently of what has actually been paid.
      const paidAmount = mode === 'paid'
        ? grandTotal
        : mode === 'deposit'
          ? depositPaidTotal
          : 0;
      const balanceDueAmount = mode === 'paid'
        ? 0
        : Math.max(0, grandTotal - paidAmount);
      // Mirror the /subs Save shape (see WorkspacePages.jsx
      // saveSubscription) so the worker's handleInvoiceSave gets the
      // typed columns it expects, plus the loose invoice_data blob
      // that the hydrate effect at the top of this component reads
      // back via /api/invoices-get.
      const invoice = {
        client_title: String(title || 'Ms.'),
        client_name: trimmedName,
        client_contact: String(contact || ''),
        invoice_date: String(issuedDate || ''),
        event_date: String(eventDate || ''),
        event_time: String(eventTime || ''),
        event_key: String(eventKey || ''),
        venue: String(venue || ''),
        status: mode,
        grand_total: grandTotal,
        deposit_amount: depositDue,
        paid_amount: paidAmount,
        balance_due: balanceDueAmount,
        invoice_data: {
          discount: Math.max(0, Math.round(Number(discount) || 0)),
          items: items.map((item) => ({
            id: String(item.id || ''),
            packageId: String(item.packageId || ''),
            name: String(item.name || ''),
            note: String(item.note || ''),
            qty: Number(item.qty) || 1,
            price: Math.max(0, Math.round(Number(item.price) || 0)),
          })),
          depositMode: String(depositMode || ''),
          depositCustomAmount: String(depositCustomAmount || ''),
          venue: String(venue || ''),
          qrSrc: String(qrSrc || ''),
          qrFileName: String(qrFileName || ''),
          paymentMethod: String(paymentMethod || 'qr'),
          eventTime: String(eventTime || ''),
          // Deposit-mode workflow state — read back by the hydrate
          // effect. Persisted in every mode so switching invoice ↔
          // deposit ↔ paid never silently drops a recorded ledger
          // (e.g. a paid invoice keeps the deposits that led to it).
          depositPayments: depositPayments.map((payment) => ({
            id: String(payment.id || ''),
            paid: !!payment.paid,
            paidAtDate: String(payment.paidAtDate || ''),
            paidAtTime: String(payment.paidAtTime || ''),
            amount: Math.max(0, Math.round(Number(payment.amount) || 0)),
          })),
          paidReceipt: {
            paid: !!paidConfirmed,
            paidAtDate: String(paidAtDate || ''),
            paidAtTime: String(paidAtTime || ''),
            amount: grandTotal,
          },
          requestBalanceDue: !!requestBalanceDue,
        },
      };
      if (savedId) invoice.id = savedId;
      dbg('/inv save body', {
        eventKey: invoice.event_key,
        eventDate: invoice.event_date,
        invoiceId: invoice.id || '(new)',
        clientName: invoice.client_name,
        linkedClientId,
      });
      const response = await fetch('/api/invoices-save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice,
          // Top-level handoff so the worker can use it as the
          // preferredId in findOrCreateClient. Sits alongside the
          // invoice payload — the invoice itself never carries
          // client_id directly (the worker writes it after
          // resolving the bucket), but this hint guarantees the
          // resolution lands on the chosen /db client.
          clientId: linkedClientId || '',
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(json.error || `Save failed (${response.status}).`);
      }
      const newId = String(json.invoice?.id || savedId || '');
      if (newId) setSavedId(newId);
      dbg('/inv save response', {
        invoiceId: newId,
        savedEventKey: json.invoice?.event_key || '',
        migrationMissing: json.migrationMissing || null,
      });
      // The event_key column is now part of the applied schema
      // (db-migration-part-6.sql). The worker still returns
      // `migrationMissing` if it ever has to fall back to the
      // schema-tolerant insert path, but we no longer surface that
      // as a scary user-facing warning. Instead we log to the
      // console and only embed it in the visible status when the
      // operator has the debug flag on (?debug=1) — admin-only.
      if (json.migrationMissing) {
        console.warn(
          '[inv] schema fallback engaged on save — event_key dropped, mirrored into invoice_data jsonb. Apply db-migration-part-6.sql.',
          json.migrationMissing,
        );
      }
      const baseMsg = savedId ? 'Invoice updated.' : 'Invoice saved.';
      if (json.migrationMissing && dbgEnabled()) {
        setStatus(`${baseMsg} [admin] schema fallback: event_key dropped, jsonb cross-ref written.`);
      } else {
        setStatus(baseMsg);
      }
    } catch (error) {
      setStatus(error?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function downloadJpg() {
    if (!documentRef.current) return;
    setStatus('Rendering JPG...');
    if (document.fonts?.ready) {
      try { await document.fonts.ready; } catch {}
    }
    // Stable export artboard. The preview panel renders the sheet
    // at min(100%, A4 landscape) which scales with viewport, but the
    // exported JPG must always come out at the same paper size
    // regardless of how the preview happened to be sized when the
    // operator pressed Generate JPG. We clone the live invoice-
    // sheet into an off-screen host fixed at INVOICE_EXPORT_WIDTH
    // so html2canvas captures only the sheet (no preview-panel
    // chrome, scrollbar, toolbar, or panel padding) at a known
    // pixel width, then rasterise it at a higher scale.
    //
    // Lay the export sheet out directly at 3000px wide. html2canvas
    // stays at scale=1 so the JPG dimensions come from the artboard
    // itself, not from post-layout scaling.
    const exportHost = document.createElement('div');
    exportHost.className = 'invoice-export-host';
    const exportSheet = documentRef.current.cloneNode(true);
    exportHost.appendChild(exportSheet);
    document.body.appendChild(exportHost);
    try {
      const canvas = await html2canvas(exportSheet, {
        backgroundColor: '#ffffff',
        scale: 1,
        useCORS: true,
        allowTaint: true,
        imageTimeout: 0,
        logging: false,
        // Match the export host so html2canvas lays out the
        // sheet at exactly the intended width, with no
        // wrap/overflow induced by the simulated window's narrower
        // default. Height is generous so a long content column
        // doesn't get clipped by the simulated viewport.
        windowWidth: 3000,
        windowHeight: 9000,
      });
      const link = document.createElement('a');
      const safeClient = (clientName || 'Client').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
      link.download = `${new Date().toISOString().slice(0, 10)}_${safeClient}_${mode}.jpg`;
      link.href = canvas.toDataURL('image/jpeg', 0.95);
      link.click();
      setStatus('JPG ready.');
    } catch (error) {
      setStatus(error.message || 'Failed to render JPG.');
    } finally {
      exportHost.remove();
    }
  }

  return (
    <main className="composer-page scroll-root">
      <GlobalBackground />
      <section className={`composer-shell ${mobileView === 'preview' ? 'show-preview' : ''}`}>
        <EditorPanel
          mode={mode}
          setMode={setMode}
          title={title}
          setTitle={setTitle}
          clientName={clientName}
          setClientName={setClientName}
          contact={contact}
          setContact={setContact}
          venue={venue}
          setVenue={setVenue}
          eventDate={eventDate}
          setEventDate={setEventDate}
          eventTime={eventTime}
          setEventTime={setEventTime}
          issuedDate={issuedDate}
          setIssuedDate={setIssuedDate}
          items={items}
          packages={packages}
          savePackage={savePackage}
          deletePackage={deletePackage}
          applyPackage={applyPackage}
          updateItem={updateItem}
          addItem={addItem}
          removeItem={removeItem}
          discount={discount}
          setDiscount={setDiscount}
          depositMode={depositMode}
          setDepositMode={setDepositMode}
          depositCustomAmount={depositCustomAmount}
          setDepositCustomAmount={setDepositCustomAmount}
          totals={totals}
          depositPayments={depositPayments}
          addDepositPayment={addDepositPayment}
          updateDepositPayment={updateDepositPayment}
          removeDepositPayment={removeDepositPayment}
          depositPaidTotal={depositPaidTotal}
          balanceDue={balanceDue}
          depositAskOpen={depositAskOpen}
          setDepositAskOpen={setDepositAskOpen}
          paidConfirmed={paidConfirmed}
          setPaidConfirmed={setPaidConfirmed}
          paidAtDate={paidAtDate}
          setPaidAtDate={setPaidAtDate}
          paidAtTime={paidAtTime}
          setPaidAtTime={setPaidAtTime}
          uploadQr={uploadQr}
          qrFileName={qrFileName}
          paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod}
          hydrating={hydrating}
        />
        <PreviewPanel
          mode={mode}
          clientName={clientName}
          title={title}
          contact={contact}
          venue={venue}
          eventDate={eventDate}
          issuedDate={issuedDate}
          eventTime={eventTime}
          items={items}
          totals={totals}
          qrSrc={qrSrc}
          paymentMethod={paymentMethod}
          depositPayments={depositPayments}
          depositAskOpen={depositAskOpen}
          balanceDue={balanceDue}
          paidConfirmed={paidConfirmed}
          paidAtDate={paidAtDate}
          paidAtTime={paidAtTime}
          status={status}
          documentRef={documentRef}
          downloadJpg={downloadJpg}
          saveInvoice={saveInvoice}
          saving={saving}
          savedId={savedId}
          hydrating={hydrating}
        />
      </section>
      <nav className="mobile-tabs" aria-label="Invoice view">
        <button className={mobileView === 'edit' ? 'active' : ''} type="button" onClick={() => setMobileView('edit')}>Edit Details</button>
        <button className={mobileView === 'preview' ? 'active' : ''} type="button" onClick={() => setMobileView('preview')}>Preview Invoice</button>
      </nav>
    </main>
  );
}

function EditorPanel(props) {
  return (
    <aside className="editor-panel panel">
      <div className="editor-panel-scroll scroll-surface-y">
        <header className="panel-header">
          <img src="/logo-hero.png" alt="StarShots" />
          <div className="mode-switch">
            {['invoice', 'deposit', 'paid'].map((value) => (
              <button key={value} className={props.mode === value ? 'active' : ''} type="button" onClick={() => props.setMode(value)}>
                {value}
              </button>
            ))}
          </div>
        </header>

      {props.mode === 'invoice' ? (
        <>
      <Fieldset title="Bill To">
        <div className="field-stack">
          <div className="two-col">
            <label>Title<Combobox value={props.title} onChange={props.setTitle} options={TITLE_OPTIONS} ariaLabel="Title" placeholder="Title" /></label>
            <label>Client name<input value={props.clientName} onChange={(event) => props.setClientName(event.target.value)} onBlur={onBlurTitleCase(props.setClientName)} placeholder="Client Name" /></label>
          </div>
          <label>Contact<input value={props.contact} onChange={(event) => props.setContact(event.target.value)} onBlur={onBlurTitleCase(props.setContact)} placeholder="Instagram / Phone / Email" /></label>
        </div>
      </Fieldset>

      <Fieldset title="Details">
        <div className="field-stack">
          <label>Venue<input value={props.venue} onChange={(event) => props.setVenue(event.target.value)} onBlur={onBlurTitleCase(props.setVenue)} placeholder="Venue" /></label>
          <div className="event-date-row">
            <label>Event date
              <DateTimeField
                value={props.eventDate}
                onChange={props.setEventDate}
                timeValue={props.eventTime}
                onTimeChange={props.setEventTime}
                withTime
                ariaLabel="Event date and time"
              />
            </label>
            <label>Issued
              <DateTimeField
                value={props.issuedDate}
                onChange={props.setIssuedDate}
                ariaLabel="Issued date"
              />
            </label>
          </div>
        </div>
      </Fieldset>

      <Fieldset title="Packages">
        <PackageCatalogEditor
          packages={props.packages}
          savePackage={props.savePackage}
          deletePackage={props.deletePackage}
        />
        <div className="item-list">
          {props.items.map((item) => (
            <div className="item-editor" key={item.id}>
              <label>Package
                <Combobox
                  value={item.name}
                  onChange={(value) => props.applyPackage(item.id, value)}
                  options={[
                    ...(!props.packages.some((pkg) => pkg.name === item.name) && item.name
                      ? [{ value: item.name, label: toTitleCase(item.name) }]
                      : []),
                    ...props.packages.map((pkg) => ({ value: pkg.name, label: toTitleCase(pkg.name) })),
                  ]}
                  ariaLabel="Package"
                  placeholder="Package"
                />
              </label>
              <label>Note<input value={item.note} onChange={(event) => props.updateItem(item.id, { note: event.target.value })} onBlur={(event) => {
                const next = maybeTitleCase(event.target.value.trim());
                if (next !== item.note) props.updateItem(item.id, { note: next });
              }} placeholder="Optional note" /></label>
              <div className="invoice-item-controls">
                <div className="qty-control" aria-label="Quantity">
                  <span>Qty</span>
                  <button type="button" aria-label="Decrease quantity" onClick={() => props.updateItem(item.id, { qty: Math.max(1, Math.round(Number(item.qty) || 1) - 1) })}>-</button>
                  <strong>{Math.max(1, Math.round(Number(item.qty) || 1))}</strong>
                  <button type="button" aria-label="Increase quantity" onClick={() => props.updateItem(item.id, { qty: Math.max(1, Math.round(Number(item.qty) || 1) + 1) })}>+</button>
                </div>
                <div className="package-price-readonly" aria-label="Package price">
                  <span>Price</span>
                  <strong>{rupiah(item.price)}</strong>
                </div>
                <button className="icon-danger-button" type="button" aria-label="Delete package row" title="Delete row" onClick={() => props.removeItem(item.id)}>
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))}
        </div>
        <button className="ghost-button add-package-button" type="button" onClick={props.addItem}><PlusIcon /> Add Package</button>
      </Fieldset>

      <Fieldset title="Payment">
        <div className="field-stack">
          <label>Discount<input type="number" min="0" value={props.discount} onFocus={selectAllIfZero} onChange={(event) => props.setDiscount(event.target.value)} placeholder="0" /></label>
          <div className="deposit-block">
            <span className="deposit-label">Deposit</span>
            <div className="deposit-presets" role="radiogroup" aria-label="Deposit preset">
              {DEPOSIT_PRESETS.map((preset) => {
                const value = String(preset);
                const active = props.depositMode === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={active ? 'active' : ''}
                    onClick={() => props.setDepositMode(value)}
                  >
                    {preset}%
                  </button>
                );
              })}
              <button
                type="button"
                role="radio"
                aria-checked={props.depositMode === 'custom'}
                className={props.depositMode === 'custom' ? 'active' : ''}
                onClick={() => props.setDepositMode('custom')}
              >
                Custom
              </button>
            </div>
            {props.depositMode === 'custom' ? (
              <label className="deposit-custom">
                Custom amount (IDR)
                <input
                  type="number"
                  min="0"
                  value={props.depositCustomAmount}
                  onFocus={selectAllIfZero}
                  onChange={(event) => props.setDepositCustomAmount(event.target.value)}
                  placeholder="e.g. 500000"
                />
              </label>
            ) : null}
          </div>
          <div className="payment-method-block" role="radiogroup" aria-label="Payment method">
            <span className="payment-method-label">Payment Method</span>
            <div className="payment-method-switch">
              {PAYMENT_METHODS.map((method) => {
                const active = props.paymentMethod === method.value;
                return (
                  <button
                    key={method.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={active ? 'active' : ''}
                    onClick={() => props.setPaymentMethod(method.value)}
                  >
                    {method.label}
                  </button>
                );
              })}
            </div>
          </div>
          {props.paymentMethod === 'qr' ? (
            <QrUploadField onChange={props.uploadQr} fileName={props.qrFileName} />
          ) : (
            <div className="bank-details-summary" aria-label="Bank transfer destination">
              <span className="payment-method-label">Bank Transfer</span>
              <dl className="bank-details-summary-list">
                <div><dt>Bank</dt><dd>{BANK_DETAILS.bank}</dd></div>
                <div><dt>Account No.</dt><dd>{BANK_DETAILS.accountNumber}</dd></div>
                <div><dt>Account Name</dt><dd>{BANK_DETAILS.accountHolderLabel}</dd></div>
              </dl>
            </div>
          )}
          <div className="total-card"><span>Grand Total</span><strong>{rupiah(props.totals.grandTotal)}</strong></div>
          <div className="total-card"><span>{isFullPayment(props.totals) ? 'Full Payment Due' : 'Deposit Due'}</span><strong>{rupiah(props.totals.depositDue)}</strong></div>
        </div>
      </Fieldset>
        </>
      ) : (
        <>
          <LockedDetails
            mode={props.mode}
            title={props.title}
            clientName={props.clientName}
            contact={props.contact}
            venue={props.venue}
            eventDate={props.eventDate}
            eventTime={props.eventTime}
            totals={props.totals}
          />
          {props.mode === 'deposit' ? (
            <DepositLedger
              payments={props.depositPayments}
              addPayment={props.addDepositPayment}
              updatePayment={props.updateDepositPayment}
              removePayment={props.removeDepositPayment}
              depositMode={props.depositMode}
              setDepositMode={props.setDepositMode}
              depositCustomAmount={props.depositCustomAmount}
              setDepositCustomAmount={props.setDepositCustomAmount}
              depositPaidTotal={props.depositPaidTotal}
              balanceDue={props.balanceDue}
              totals={props.totals}
              depositAskOpen={props.depositAskOpen}
              setDepositAskOpen={props.setDepositAskOpen}
            />
          ) : (
            <PaidSummary
              totals={props.totals}
              paidConfirmed={props.paidConfirmed}
              setPaidConfirmed={props.setPaidConfirmed}
              paidAtDate={props.paidAtDate}
              setPaidAtDate={props.setPaidAtDate}
              paidAtTime={props.paidAtTime}
              setPaidAtTime={props.setPaidAtTime}
            />
          )}
        </>
      )}
      </div>
    </aside>
  );
}

// Read-only identity + event recap shown on the Deposit and Paid
// tabs. The Invoice tab is the single source of truth for these
// fields (client_title/name/contact, venue, event date+time) and
// the grand total — the Deposit/Paid tabs deliberately cannot edit
// them, they only display the locked snapshot so the operator has
// context while recording payments. Preserves client_id / event_key
// / client_name / event_date grouping inputs untouched.
function LockedDetails({ mode, title, clientName, contact, venue, eventDate, eventTime, totals }) {
  return (
    <Fieldset title="Invoice Details (locked)">
      <dl className="locked-list">
        <div className="locked-row"><dt>Client</dt><dd>{title} {clientName ? toTitleCase(clientName) : 'Client'}</dd></div>
        <div className="locked-row"><dt>Contact</dt><dd>{contact ? maybeTitleCase(contact) : '-'}</dd></div>
        <div className="locked-row"><dt>Venue</dt><dd>{venue ? toTitleCase(venue) : 'TBA'}</dd></div>
        <div className="locked-row"><dt>Event</dt><dd>{prettyDateTime(eventDate, eventTime)}</dd></div>
        <div className="locked-row"><dt>Grand Total</dt><dd>{rupiah(totals.grandTotal)}</dd></div>
      </dl>
    </Fieldset>
  );
}

// Deposit-tab ledger + workflow menu. Two clearly separated actions:
//
//   • "Ask DP"        — set the deposit you request from the client.
//                       Toggles the Requested Deposit Due editor: the
//                       20/30/50/100/Custom preset ladder plus a manual
//                       IDR override field. Shares the Invoice tab's
//                       depositMode / depositCustomAmount state so the
//                       requested-deposit figure stays in sync.
//   • "+ Add DP Paid" — record one paid deposit instalment.
//
// The running Deposit Paid / Balance Due totals and a per-deposit
// "Deposit Paid on <date>" recap (same wording as the live preview /
// JPG summary box) sit below. The old "Show Balance Due on invoice"
// checkbox was removed — the Balance Due line is now always shown on
// the invoice (see PreviewPanel). All state lives in invoice_data;
// no new DB columns are introduced.
function DepositLedger({ payments, addPayment, updatePayment, removePayment, depositMode, setDepositMode, depositCustomAmount, setDepositCustomAmount, depositPaidTotal, balanceDue, totals, depositAskOpen, setDepositAskOpen }) {
  const fullPayment = isFullPayment(totals);
  const paidRows = payments.filter((payment) => payment.paid);
  // Opening "Ask DP" auto-follows the requested deposit due to the
  // latest recorded paid DP, so the amount we ask for matches what
  // the client most recently paid. With no paid DP yet it falls back
  // to the 20% preset default. Tied to the open action only —
  // hydrating a saved invoice keeps the persisted requested deposit
  // untouched until the operator explicitly reopens Ask DP.
  const handleAskToggle = () => {
    const willOpen = !depositAskOpen;
    setDepositAskOpen(willOpen);
    if (!willOpen) return;
    const latest = latestPaidDepositAmount(payments);
    if (latest > 0) {
      setDepositMode('custom');
      setDepositCustomAmount(String(latest));
    } else {
      setDepositMode('20');
      setDepositCustomAmount('');
    }
  };
  return (
    <Fieldset title="Deposit Payments">
      {/* Workflow menu — "Ask DP" reveals the requested-deposit
          editor; "Add DP Paid" logs a recorded instalment. */}
      <div className="dp-menu" role="group" aria-label="Deposit workflow">
        <button
          type="button"
          className={`dp-menu-btn${depositAskOpen ? ' active' : ''}`}
          aria-expanded={depositAskOpen}
          onClick={handleAskToggle}
        >
          Ask DP
        </button>
        <button type="button" className="dp-menu-btn dp-menu-btn--primary" onClick={addPayment}>
          + Add DP Paid
        </button>
      </div>

      {depositAskOpen ? (
        <div className="dp-ask">
          <div className="dp-context">
            <span>{fullPayment ? 'Requested Full Payment' : 'Requested Deposit Due'}</span>
            <strong>{rupiah(totals.depositDue)}</strong>
          </div>
          <div className="deposit-presets" role="radiogroup" aria-label="Requested deposit preset">
            {DEPOSIT_PRESETS.map((preset) => {
              const value = String(preset);
              const active = depositMode === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={active ? 'active' : ''}
                  onClick={() => setDepositMode(value)}
                >
                  {preset}%
                </button>
              );
            })}
            <button
              type="button"
              role="radio"
              aria-checked={depositMode === 'custom'}
              className={depositMode === 'custom' ? 'active' : ''}
              onClick={() => setDepositMode('custom')}
            >
              Custom
            </button>
          </div>
          <label className="deposit-custom">
            Manual amount (IDR) — overrides preset
            <input
              type="number"
              min="0"
              value={depositMode === 'custom' ? depositCustomAmount : ''}
              onFocus={selectAllIfZero}
              onChange={(event) => {
                setDepositCustomAmount(event.target.value);
                setDepositMode('custom');
              }}
              placeholder="e.g. 500000"
            />
          </label>
        </div>
      ) : null}

      <div className="dp-list">
        {payments.length === 0 ? (
          <p className="dp-empty">No deposit payments recorded yet. Use the + Add DP Paid button to log one.</p>
        ) : payments.map((payment) => (
          <div className="dp-row" key={payment.id}>
            <label className="dp-paid-toggle">
              <input
                type="checkbox"
                checked={!!payment.paid}
                onChange={(event) => updatePayment(payment.id, { paid: event.target.checked })}
              />
              <span>DP Paid</span>
            </label>
            <label className="dp-field">Paid on
              <DateTimeField
                value={payment.paidAtDate}
                onChange={(value) => updatePayment(payment.id, { paidAtDate: value })}
                timeValue={payment.paidAtTime}
                onTimeChange={(value) => updatePayment(payment.id, { paidAtTime: value })}
                withTime
                ariaLabel="Deposit paid date and time"
              />
            </label>
            <div className="dp-amount-row">
              <label className="dp-field">Amount
                <input
                  type="number"
                  min="0"
                  value={payment.amount}
                  onFocus={selectAllIfZero}
                  onChange={(event) => updatePayment(payment.id, { amount: event.target.value })}
                  placeholder="0"
                />
              </label>
              <button className="remove" type="button" onClick={() => removePayment(payment.id)}>Remove</button>
            </div>
          </div>
        ))}
      </div>

      <div className="dp-totals">
        <div className="dp-total-row"><span>Deposit Paid</span><strong>{rupiah(depositPaidTotal)}</strong></div>
        <div className="dp-total-row dp-total-balance"><span>Balance Due</span><strong>{rupiah(balanceDue)}</strong></div>
      </div>

      {/* Per-deposit recap — each paid instalment listed separately
          with the same "Deposit Paid on <date>" wording the live
          preview / JPG summary box uses. */}
      {paidRows.length ? (
        <div className="dp-list dp-list--readonly">
          <p className="dp-context-label">{paidRows.length > 1 ? 'Deposits paid' : 'Deposit paid'}</p>
          {paidRows.map((payment) => (
            <div className="dp-readonly-row" key={payment.id}>
              <span>Deposit Paid on {prettyDate(payment.paidAtDate)}</span>
              <strong>{rupiah(payment.amount)}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </Fieldset>
  );
}

// Paid-tab summary. Paid means one final receipt state: the invoice
// is settled in full, paid_amount = grand total, and balance_due = 0.
// The single editable timestamp feeds both the operator recap and the
// JPG summary line.
function PaidSummary({ totals, paidConfirmed, setPaidConfirmed, paidAtDate, setPaidAtDate, paidAtTime, setPaidAtTime }) {
  return (
    <Fieldset title="Mark as Paid">
      <div className="dp-row paid-row">
        <label className="dp-paid-toggle">
          <input
            type="checkbox"
            checked={!!paidConfirmed}
            onChange={(event) => setPaidConfirmed(event.target.checked)}
          />
          <span>Fully Paid</span>
        </label>
        <label className="dp-field">Paid on
          <DateTimeField
            value={paidAtDate}
            onChange={setPaidAtDate}
            timeValue={paidAtTime}
            onTimeChange={setPaidAtTime}
            withTime
            ariaLabel="Fully paid date and time"
          />
        </label>
      </div>
      <div className="dp-totals">
        <div className="dp-total-row"><span>Grand Total</span><strong>{rupiah(totals.grandTotal)}</strong></div>
        {paidConfirmed ? (
          <div className="dp-total-row paid-in-full-row">
            <span>Fully Paid on {prettyDateTime(paidAtDate, paidAtTime)}</span>
            <strong>{rupiah(totals.grandTotal)}</strong>
          </div>
        ) : null}
        <div className="dp-total-row dp-total-balance"><span>Balance Due</span><strong>{rupiah(0)}</strong></div>
      </div>
    </Fieldset>
  );
}

// Modern upload pill that hides the native browser file input. The
// label wraps a visually-hidden <input type="file"> so a click on
// the pill, or a keyboard activation on the input itself, both
// trigger the picker. On selection the filename is shown subtly
// underneath so the operator has feedback without affecting the
// invoice JPG layout (the QR image inside the sheet is the only
// thing that visually changes on export).
function QrUploadField({ onChange, fileName }) {
  return (
    <div className="qr-upload">
      <span className="qr-upload-label">Custom QR</span>
      <label className="qr-upload-control">
        <input type="file" accept="image/*" onChange={onChange} />
        <span className="qr-upload-pill">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 16V4M12 4l-4 4M12 4l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="qr-upload-text">Click to upload QR</span>
        </span>
      </label>
      {fileName ? <span className="qr-upload-filename" title={fileName}>{fileName}</span> : null}
    </div>
  );
}

// Toolbar icons for the Live Preview header. Same minimalist 2D
// stroke-only family as the /db Subs detail toolbar (viewBox 0 0 24
// 24, fill:none, stroke:currentColor, round caps/joins, className
// "btn-icon") so the two surfaces read as one icon system. They pick
// up the parent .toolbar-icon-btn's currentColor for hover/disabled
// palettes without per-icon overrides.

// Circular-arrows refresh glyph for the Save / Update Status action
// (icon-only). When `spinning` is true (a save is in flight) the
// .is-spinning class drives a slow rotation via CSS.
function RefreshIcon({ spinning = false }) {
  return (
    <svg
      className={`btn-icon${spinning ? ' is-spinning' : ''}`}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}

// Printer glyph for the Generate JPG action (icon-only). Mirrors the
// /db Subs PrintIcon so "print/export" reads identically across the
// app.
function PrinterIcon() {
  return (
    <svg
      className="btn-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

function PreviewPanel({ mode, clientName, title, contact, venue, eventDate, issuedDate, eventTime, items, totals, qrSrc, paymentMethod, depositPayments, depositAskOpen, balanceDue, paidConfirmed, paidAtDate, paidAtTime, status, documentRef, downloadJpg, saveInvoice, saving, savedId, hydrating }) {
  // Deposit instalments actually marked paid — these are what the
  // Deposit Invoice JPG itemises in the totals area.
  const paidDeposits = mode === 'deposit'
    ? (depositPayments || []).filter((payment) => payment.paid)
    : [];
  // Payment caption shown in the .payment-box beside Terms &
  // Conditions. In every requesting mode (Draft Invoice / Deposit
  // Invoice "Ask DP") the canvas advertises the REQUESTED deposit
  // due — never the Balance Due — so the QR/Bank amount always
  // matches exactly what we are currently asking the client to pay.
  // When the requested amount is the full grand total (100% preset
  // or a custom amount >= total) the wording switches to "Full
  // Payment Due" instead of calling it a deposit.
  const dueLabel = isFullPayment(totals) ? 'Full Payment Due' : 'Deposit Due';
  const dueAmount = totals.depositDue;
  const previewCanvasRef = useRef(null);
  const [previewMetrics, setPreviewMetrics] = useState({
    fitScale: 1,
    width: INVOICE_PREVIEW_WIDTH,
    height: INVOICE_PREVIEW_MIN_HEIGHT,
  });
  // Fit-to-width only: scale the 1000px sheet down so it fits the
  // preview column. No user zoom — see the note on INVOICE_PREVIEW_*.
  const previewScale = previewMetrics.fitScale;

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    const sheet = documentRef.current;
    if (!canvas || !sheet) return undefined;

    let frame = 0;
    const readPx = (value, fallback) => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };
    const updatePreviewScale = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const canvasStyle = window.getComputedStyle(canvas);
        const sheetStyle = window.getComputedStyle(sheet);
        const horizontalPadding =
          readPx(canvasStyle.paddingLeft, 0) + readPx(canvasStyle.paddingRight, 0);
        const availableWidth = Math.max(1, canvas.clientWidth - horizontalPadding);
        const sheetWidth = readPx(sheetStyle.getPropertyValue('--invoice-page-width'), INVOICE_PREVIEW_WIDTH);
        const sheetHeight = Math.max(
          readPx(sheetStyle.getPropertyValue('--invoice-page-min-height'), INVOICE_PREVIEW_MIN_HEIGHT),
          sheet.scrollHeight,
          sheet.offsetHeight,
        );
        const scale = Math.min(1, availableWidth / sheetWidth);
        const nextMetrics = {
          fitScale: Number(scale.toFixed(4)),
          width: Math.ceil(sheetWidth),
          height: Math.ceil(sheetHeight),
        };
        setPreviewMetrics((current) => (
          current.fitScale === nextMetrics.fitScale &&
          current.width === nextMetrics.width &&
          current.height === nextMetrics.height
            ? current
            : nextMetrics
        ));
      });
    };

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updatePreviewScale)
      : null;
    resizeObserver?.observe(canvas);
    resizeObserver?.observe(sheet);
    window.addEventListener('resize', updatePreviewScale, { passive: true });
    updatePreviewScale();

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updatePreviewScale);
    };
  }, [documentRef]);

  const previewStageStyle = {
    '--invoice-preview-scale': previewScale,
    '--invoice-preview-width': `${previewMetrics.width}px`,
    width: `${Math.ceil(previewMetrics.width * previewScale)}px`,
    height: `${Math.ceil(previewMetrics.height * previewScale)}px`,
  };

  return (
    <section className="preview-panel panel">
      <header className="preview-toolbar">
        <div>
          <p className="eyebrow">Live Preview</p>
          <h2>{mode === 'paid' ? 'Paid Receipt' : mode === 'deposit' ? 'Deposit Invoice' : 'Draft Invoice'}</h2>
        </div>
        <div className="preview-toolbar-actions">
          <button
            className="toolbar-icon-btn"
            type="button"
            onClick={saveInvoice}
            disabled={saving || hydrating}
            aria-label={saving ? 'Saving status' : (savedId ? 'Update status' : 'Save status')}
            title={saving ? 'Saving\u2026' : (savedId ? 'Update status' : 'Save status')}
          >
            <RefreshIcon spinning={saving} />
          </button>
          <button
            className="toolbar-icon-btn"
            type="button"
            onClick={downloadJpg}
            aria-label="Generate JPG"
            title="Generate JPG"
          >
            <PrinterIcon />
          </button>
        </div>
      </header>
      <div className="preview-canvas scroll-surface" ref={previewCanvasRef}>
        <div className="invoice-preview-stage" style={previewStageStyle}>
          <article className="invoice-sheet" ref={documentRef}>
            <header className="sheet-top"><img src="/logo-hero.png" alt="StarShots" /></header>
            <section className="sheet-grid">
              <div className="sheet-box">
                <p className="eyebrow">Bill To</p>
                <dl className="meta-list">
                  <div className="meta-row"><dt>Client</dt><dd>{title} {clientName ? toTitleCase(clientName) : 'Client'}</dd></div>
                  <div className="meta-row"><dt>Contact</dt><dd>{contact ? maybeTitleCase(contact) : '-'}</dd></div>
                </dl>
              </div>
              <div className="sheet-box">
                <p className="eyebrow">Details</p>
                <dl className="meta-list">
                  <div className="meta-row"><dt>Venue</dt><dd>{venue ? toTitleCase(venue) : 'TBA'}</dd></div>
                  <div className="meta-row"><dt>Event Date</dt><dd>{prettyDateTime(eventDate, eventTime)}</dd></div>
                  <div className="meta-row"><dt>Issued</dt><dd>{prettyDate(issuedDate)}</dd></div>
                </dl>
              </div>
            </section>
            <section className="sheet-box line-table">
              <div className="line-head"><span>Package</span><span>Qty</span><span>Amount</span></div>
              {items.map((item) => (
                <div key={item.id} className="line-row">
                  <div><strong>{toTitleCase(item.name)}</strong><small>{toTitleCase(item.note)}</small></div>
                  <span>{item.qty || 1}</span>
                  <span>{rupiah((Number(item.qty) || 0) * (Number(item.price) || 0))}</span>
                </div>
              ))}
            </section>
            <section className="summary-box">
              <p><span>Subtotal</span><strong>{rupiah(totals.subtotal)}</strong></p>
              <p><span>Discount</span><strong>{rupiah(Number(totals.subtotal) - Number(totals.grandTotal))}</strong></p>
              {paidDeposits.map((payment) => (
                <p className="deposit-paid" key={payment.id}>
                  <span>Deposit Paid on {prettyDate(payment.paidAtDate)}</span>
                  <strong>{rupiah(payment.amount)}</strong>
                </p>
              ))}
              <p className="grand"><span>Grand Total</span><strong>{rupiah(totals.grandTotal)}</strong></p>
              {mode === 'paid' && paidConfirmed ? (
                <p className="paid-in-full-row"><span>Fully Paid on {prettyDateTime(paidAtDate, paidAtTime)}</span><strong>{rupiah(totals.grandTotal)}</strong></p>
              ) : null}
              {mode === 'deposit' ? (
                <p className="balance-due"><span>Balance Due</span><strong>{rupiah(balanceDue)}</strong></p>
              ) : null}
              {mode === 'paid' ? (
                <p className="balance-due"><span>Balance Due</span><strong>{rupiah(0)}</strong></p>
              ) : null}
            </section>
            <section className="bottom-grid">
              <div className="sheet-box payment-box">
                {mode !== 'paid' ? <p className="eyebrow">Payment</p> : null}
                {mode === 'paid' ? (
                  <div className="paid-stamp">
                    <span className="paid-stamp-badge">PAID</span>
                    <p className="paid-stamp-note">Thank You!<br />Your Invoice has been Paid in Full</p>
                  </div>
                ) : mode === 'deposit' && !depositAskOpen ? (
                  <div className="deposit-received-stamp">
                    <span>Deposit</span>
                    <span>Received</span>
                  </div>
                ) : (
                  <>
                    {paymentMethod === 'bank' ? (
                      <div className="bank-details">
                        <p className="bank-details-heading">Bank Transfer</p>
                        <dl className="bank-details-list">
                          <div className="bank-details-row"><dt>Bank</dt><dd>{BANK_DETAILS.bank}</dd></div>
                          <div className="bank-details-row"><dt>Account No.</dt><dd>{BANK_DETAILS.accountNumber}</dd></div>
                          <div className="bank-details-row"><dt>Account Name</dt><dd>{BANK_DETAILS.accountHolderLabel}</dd></div>
                        </dl>
                      </div>
                    ) : (
                      <img src={qrSrc} alt="Payment QR" />
                    )}
                    <div className="deposit-due">
                      <span>{dueLabel}</span>
                      <strong>{rupiah(dueAmount)}</strong>
                    </div>
                  </>
                )}
              </div>
              <div className="sheet-box terms-box">
                <p className="eyebrow">Terms & Conditions</p>
                <p>All final edited files will be uploaded to <strong>Google Drive</strong> or <strong>Dropbox</strong> and shared via a secure link within 2 to 5 working days after session</p>
                <p>Physical deliverables such as <strong>albums</strong> or <strong>USB</strong> flash drives are optional and available upon request at an additional cost</p>
                <p>For rescheduling, notice must be given <strong>at least 7 days (H-7)</strong> prior to the original session date, and rescheduled sessions must take place <strong>within 30 days</strong></p>
                <p>In the event of <strong>late arrival</strong>, the session may only be extended by a maximum of 10 minutes</p>
              </div>
            </section>
            <footer>This invoice is automatically generated and valid without signature. <strong>@starshots.id</strong></footer>
          </article>
        </div>
      </div>
      <p className="download-status">{status}</p>
    </section>
  );
}

function Fieldset({ title, children }) {
  return <section className="form-section"><h2>{title}</h2>{children}</section>;
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function PackageCatalogEditor({ packages, savePackage, deletePackage }) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState({ id: '', name: '', note: '', price: '' });

  function beginEdit(pkg = null) {
    setOpen(true);
    setEditingId(pkg?.id || '__new__');
    setDraft(pkg ? {
      id: String(pkg.id || ''),
      name: String(pkg.name || ''),
      note: String(pkg.note || ''),
      price: String(pkg.price || ''),
    } : { id: '', name: '', note: '', price: '' });
  }

  function cancelEdit() {
    setEditingId('');
    setDraft({ id: '', name: '', note: '', price: '' });
  }

  async function commitEdit() {
    const saved = await savePackage?.(draft, editingId === '__new__' ? '' : packages.find((pkg) => pkg.id === editingId)?.name || draft.name);
    if (saved) cancelEdit();
  }

  return (
    <div className={`package-catalog${open ? ' is-open' : ''}`}>
      <button className="package-catalog-toggle" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>Package Catalogue</span>
        <strong>{packages.length}</strong>
      </button>
      {open ? (
        <div className="package-catalog-list">
          {packages.map((pkg) => {
            const editing = editingId === pkg.id;
            return (
              <div className="package-catalog-row" key={pkg.id || pkg.name}>
                {editing ? (
                  <div className="package-catalog-edit">
                    <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Package name" />
                    <input value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Default note" />
                    <input className="no-spinner" type="number" min="0" value={draft.price} onFocus={selectAllIfZero} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} placeholder="Price" />
                    <div className="package-catalog-edit-actions">
                      <button type="button" onClick={commitEdit}>Save</button>
                      <button type="button" onClick={cancelEdit}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="package-catalog-main">
                      <strong>{toTitleCase(pkg.name)}</strong>
                      <span>{pkg.note ? toTitleCase(pkg.note) : 'No default note'}</span>
                    </div>
                    <span className="package-catalog-price">{rupiah(pkg.price)}</span>
                    <button className="icon-soft-button" type="button" aria-label={`Edit ${pkg.name}`} title="Edit package" onClick={() => beginEdit(pkg)}>
                      <PencilIcon />
                    </button>
                    <button className="icon-danger-button" type="button" aria-label={`Delete ${pkg.name}`} title="Delete package" onClick={() => deletePackage?.(pkg.id)}>
                      <TrashIcon />
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {editingId === '__new__' ? (
            <div className="package-catalog-row">
              <div className="package-catalog-edit">
                <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Package name" />
                <input value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Default note" />
                <input className="no-spinner" type="number" min="0" value={draft.price} onFocus={selectAllIfZero} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} placeholder="Price" />
                <div className="package-catalog-edit-actions">
                  <button type="button" onClick={commitEdit}>Save</button>
                  <button type="button" onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            </div>
          ) : null}
          <button className="package-catalog-add" type="button" onClick={() => beginEdit(null)}>
            <PlusIcon /> New Package
          </button>
        </div>
      ) : null}
    </div>
  );
}
