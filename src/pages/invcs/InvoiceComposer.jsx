import { useEffect, useMemo, useRef, useState } from 'react';
import { GlobalBackground } from '../../components/GlobalBackground.jsx';
import { Combobox, DateTimeField } from '../../components/ui/index.js';
import { toTitleCase, maybeTitleCase, onBlurTitleCase } from '../../utils/titleCase.js';
import { selectAllIfZero, parseMoneyInput } from '../../utils/moneyInput.js';
import { SaveIcon, PrinterIcon, TrashIcon, PlusIcon, Fieldset } from './invoicePrimitives.jsx';
import {
  DEFAULT_PACKAGES,
  BANK_DETAILS,
  PAYMENT_QR_SRC,
  INVOICE_TYPES,
  INVOICE_PREVIEW_WIDTH,
  INVOICE_PREVIEW_MIN_HEIGHT,
  DEPOSIT_PRESETS,
  TITLE_OPTIONS,
} from './invoiceConstants.js';
import { cleanPaymentMethod, rupiah, isFullPayment, prettyDate, prettyDateTime } from './invoiceFormat.js';
import { computeDepositDue, inferDepositMode, latestPaidDepositAmount } from './invoiceDeposit.js';
import { PaymentMethodPicker, PaymentMethodSummary, PaymentMethodFieldset, LockedDetails, PaidSummary, PackageCatalogEditor } from './invoiceSections.jsx';

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

// Hardcoded fallback catalogue lives in invoiceConstants.js as
// DEFAULT_PACKAGES; the composer imports it.

// Bank transfer destination lives in invoiceConstants.js as
// BANK_DETAILS, along with PAYMENT_QR_SRC, PAYMENT_METHODS, and
// INVOICE_TYPES. cleanPaymentMethod moved to invoiceFormat.js.

// Title-case rules (small-words set, preserve list, regex token
// matcher) live in `src/utils/titleCase.js` so /subs and /inv share
// the exact same display normalisation. The composer used to carry
// a local `titleCasePackageText` helper here; that has been removed
// in favour of `toTitleCase` from the shared utility.

const today = new Date().toISOString().slice(0, 10);
// Live Preview dimensions (INVOICE_PREVIEW_WIDTH /
// INVOICE_PREVIEW_MIN_HEIGHT) live in invoiceConstants.js.

// Deposit math helpers (computeDepositDue / inferDepositMode /
// latestPaidDepositAmount) moved to invoiceDeposit.js and are
// imported above.

// Pure display helpers (rupiah, isFullPayment, prettyDate,
// prettyDateTime) and TITLE_OPTIONS were moved to invoiceFormat.js /
// invoiceConstants.js and are imported above.

function emptyItem(packages) {
  const option = (packages && packages[0]) || DEFAULT_PACKAGES[0];
  return {
    id: crypto.randomUUID(),
    packageId: String(option.id || ''),
    name: option.name,
    note: option.note || '',
    qty: 1,
    price: Number(option.price) || 0,
    discount: 0,
  };
}

// Clamp a per-item discount to a non-negative integer that never
// exceeds the item's gross line total (qty * price). Blank/NaN → 0.
function clampItemDiscount(rawDiscount, qty, price) {
  const gross = Math.max(0, Math.round((Number(qty) || 0) * (Number(price) || 0)));
  const value = Math.max(0, Math.round(Number(rawDiscount) || 0));
  return Math.min(value, gross);
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
      title: params.has('title') ? (params.get('title') || '').trim() : undefined,
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
      type: (params.get('type') || '').trim().toLowerCase(),
      items: (() => {
        try {
          const raw = params.get('items');
          return raw ? JSON.parse(raw) : undefined;
        } catch {
          return undefined;
        }
      })(),
      folderName: (params.get('folderName') || '').trim(),
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
  const [title, setTitle] = useState(initial.title ?? (initial.type === INVOICE_TYPES.VENDOR ? '' : 'Ms.'));
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
  const [invoiceType, setInvoiceType] = useState(initial.type === INVOICE_TYPES.VENDOR ? INVOICE_TYPES.VENDOR : INVOICE_TYPES.CLIENT);
  const [issuedDate, setIssuedDate] = useState(today);
  // Legacy overall discount. New invoices use per-item discounts
  // (item.discount) instead; this holds the old top-level discount
  // value ONLY when loading a pre-item-discount invoice whose items
  // carry no per-item discount, so old totals never break. It is no
  // longer directly editable — see the derived effective discount in
  // `totals`. Defaults to 0 for fresh drafts.
  const [legacyDiscount, setLegacyDiscount] = useState(0);
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
  const [items, setItems] = useState(() => {
    if (initial.items && initial.items.length) {
      return initial.items.map((item) => ({
        id: crypto.randomUUID(),
        packageId: '',
        name: String(item.name || ''),
        note: String(item.note || ''),
        qty: Number(item.qty) || 1,
        price: 0,
        discount: 0,
      }));
    }
    return [emptyItem(DEFAULT_PACKAGES)];
  });
  const [folderName, setFolderName] = useState(initial.folderName || '');
  // Payment Method shown inside the .payment-box. 'bank' renders the
  // BANK_DETAILS block (default for unpaid invoices); 'qr' replaces it
  // with the QR image. Persisted in invoice_data so reopening a saved
  // invoice restores whatever the operator picked; new drafts default
  // to Bank Transfer.
  const [paymentMethod, setPaymentMethod] = useState('bank');
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
  // Delete-invoice confirm/in-flight state. The Delete control only
  // appears once the invoice is persisted (savedId set). First click
  // arms the button, a second click within ~4s issues the delete of
  // ONLY this invoice via /api/invoices-delete — the paired delivery
  // links and the client row are never touched. Auto-disarms after
  // the timeout so an accidental press doesn't sit hot.
  const [confirmDeleteInvoice, setConfirmDeleteInvoice] = useState(false);
  const [deletingInvoice, setDeletingInvoice] = useState(false);
  const documentRef = useRef(null);
  const previousModeRef = useRef(mode);

  useEffect(() => {
    if (!confirmDeleteInvoice) return undefined;
    const timer = setTimeout(() => setConfirmDeleteInvoice(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmDeleteInvoice]);

  // Disarm the delete confirm if the persisted id changes out from
  // under us (e.g. a fresh save assigns a new id, or hydration loads
  // a different invoice).
  useEffect(() => {
    setConfirmDeleteInvoice(false);
  }, [savedId]);

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

        if (row.invoice_type === INVOICE_TYPES.VENDOR || data.invoiceType === INVOICE_TYPES.VENDOR) {
          setTitle('');
        } else if (row.client_title) {
          setTitle(String(row.client_title));
        }
        if (row.client_name != null) setClientName(String(row.client_name || ''));
        if (row.client_contact != null) setContact(String(row.client_contact || ''));
        if (data.venue != null || row.venue != null) setVenue(String(data.venue ?? row.venue ?? 'TBA'));
        if (row.event_date != null) setEventDate(String(row.event_date || ''));
        // Event Time hydration. Prefer the typed column; fall back
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
        if (row.invoice_type === INVOICE_TYPES.VENDOR || data.invoiceType === INVOICE_TYPES.VENDOR) setInvoiceType(INVOICE_TYPES.VENDOR);
        // Same idea for client_id: when reopening an existing
        // invoice without a URL-supplied clientId, adopt the row's
        // own client_id so subsequent saves stay attached to that
        // clients row. The worker's findOrCreateClient validates
        // the id (fetchClientById) before using it.
        if (row.client_id && !initial.clientId) setLinkedClientId(String(row.client_id));
        if (row.invoice_date) setIssuedDate(String(row.invoice_date));
        if (row.status === 'invoice' || row.status === 'deposit' || row.status === 'paid') setMode(row.status);

        // Discount: per-item discounts are the source of truth for
        // new invoices. The blob's top-level `discount` is only kept
        // as a legacy fallback below when the items carry none.
        const blobDiscount = Number(data.discount);

        // Items: the blob is the source of truth when present; fall
        // back to a single synthetic line carrying the row's
        // grand_total so the preview never renders empty.
        const blobItems = Array.isArray(data.items) ? data.items : null;
        if (blobItems && blobItems.length) {
          const hydratedItems = blobItems.map((item) => {
            const qty = Number(item.qty) || 1;
            const price = Math.max(0, Math.round(Number(item.price) || 0));
            return {
              id: String(item.id || crypto.randomUUID()),
              packageId: String(item.packageId || item.package_id || ''),
              name: String(item.name || ''),
              note: String(item.note || ''),
              qty,
              price,
              discount: clampItemDiscount(item.discount ?? item.discount_amount, qty, price),
            };
          });
          setItems(hydratedItems);
          // Backward compatibility: if this is an old invoice that has
          // a top-level discount but no per-item discounts, retain the
          // overall value so the loaded totals stay correct. Once the
          // operator edits item discounts (or the invoice already used
          // them), the legacy value stays 0 to avoid double-counting.
          const itemsHaveDiscount = hydratedItems.some((item) => item.discount > 0);
          if (!itemsHaveDiscount && Number.isFinite(blobDiscount) && blobDiscount > 0) {
            setLegacyDiscount(blobDiscount);
          }
        } else if (Number.isFinite(Number(row.grand_total)) && Number(row.grand_total) > 0) {
          const fallbackPrice = Math.max(0, Math.round(Number(row.grand_total) + (Number.isFinite(blobDiscount) ? blobDiscount : 0)));
          setItems([{
            id: crypto.randomUUID(),
            name: 'Package',
            note: '',
            qty: 1,
            price: fallbackPrice,
            discount: 0,
          }]);
          if (Number.isFinite(blobDiscount) && blobDiscount > 0) setLegacyDiscount(blobDiscount);
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
        if (typeof data.depositAskOpen === 'boolean') {
          setDepositAskOpen(data.depositAskOpen);
        }
        if (data.folderName != null) {
          setFolderName(String(data.folderName || ''));
        }

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
        // Payment Method: older rows pre-dating this field default
        // to Bank Transfer; explicit saved QR rows restore QR.
        setPaymentMethod(cleanPaymentMethod(data.paymentMethod));

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
    // Per-item discounts are the source of truth. The legacy overall
    // discount only contributes when no item carries a discount (old
    // invoices), so the two can never double-subtract.
    const itemDiscountTotal = items.reduce(
      (sum, item) => sum + clampItemDiscount(item.discount, item.qty, item.price),
      0,
    );
    const discount = itemDiscountTotal > 0
      ? itemDiscountTotal
      : Math.max(0, Math.round(Number(legacyDiscount) || 0));
    const grandTotal = Math.max(0, subtotal - discount);
    const depositDue = computeDepositDue(grandTotal, depositMode, depositCustomAmount);
    return { subtotal, discount, grandTotal, depositDue };
  }, [legacyDiscount, depositMode, depositCustomAmount, items]);

  // Sum of the deposit instalments currently marked paid. This is the
  // figure persisted to paid_amount in deposit mode, and the basis for
  // the balance still owed. Toggled-off (unpaid) rows are excluded so
  // the operator can stage a row before confirming it landed.
  const depositPaidTotal = depositPayments.reduce(
    (sum, payment) => sum + (payment.paid ? Math.max(0, Math.round(Number(payment.amount) || 0)) : 0),
    0,
  );
  const balanceDue = Math.max(0, Math.round(Number(totals.grandTotal) || 0) - depositPaidTotal);
  // The figure we ask the client to pay. In the Paid tab this is the
  // REMAINING balance to settle in full (grand total minus deposits
  // already paid) — never the grand total again. A 100% deposit
  // request resolves to the same remaining. When nothing has been
  // paid the remaining equals the grand total, so a plain full
  // payment with no deposit is unchanged. Deposit-tab partials still
  // use the requested deposit due.
  const requestedDue = mode === 'paid' || (mode === 'deposit' && isFullPayment(totals))
    ? balanceDue
    : totals.depositDue;

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

  async function saveInvoice() {
    const trimmedName = String(clientName || '').trim();
    if (!trimmedName) {
      setStatus('Client Name is required to Save.');
      return;
    }
    setSaving(true);
    setStatus('Saving invoice\u2026');
    try {
      const grandTotal = Math.max(0, Math.round(Number(totals.grandTotal) || 0));
      const depositDue = Math.max(0, Math.round(Number(requestedDue) || 0));
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
        client_title: invoiceType === 'vendor' ? String(title || '') : String(title || 'Ms.'),
        client_name: trimmedName,
        client_contact: String(contact || ''),
        invoice_date: String(issuedDate || ''),
        event_date: String(eventDate || ''),
        event_time: String(eventTime || ''),
        event_key: String(eventKey || ''),
        venue: String(venue || ''),
        status: mode,
        invoice_type: invoiceType,
        grand_total: grandTotal,
        deposit_amount: depositDue,
        paid_amount: paidAmount,
        balance_due: balanceDueAmount,
        invoice_data: {
          invoiceType,
          discount: Math.max(0, Math.round(Number(totals.discount) || 0)),
          items: items.map((item) => ({
            id: String(item.id || ''),
            packageId: String(item.packageId || ''),
            name: String(item.name || ''),
            note: String(item.note || ''),
            qty: Number(item.qty) || 1,
            price: Math.max(0, Math.round(Number(item.price) || 0)),
            discount: clampItemDiscount(item.discount, item.qty, item.price),
          })),
          depositMode: String(depositMode || ''),
          depositCustomAmount: String(depositCustomAmount || ''),
          depositAskOpen: !!depositAskOpen,
          paymentMethod: cleanPaymentMethod(paymentMethod),
          venue: String(venue || ''),
          eventTime: String(eventTime || ''),
          folderName: String(folderName || ''),
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

  // Delete ONLY the currently saved invoice via /api/invoices-delete
  // (keyed on the invoice id). The paired delivery links and the
  // client row are intentionally left untouched — this is not an
  // event-level delete. First click arms the button; a second click
  // within ~4s performs the delete. On success we clear savedId so
  // the toolbar reverts to "Save Status" and the Delete button
  // hides, and surface a confirmation in the status line.
  async function deleteInvoice() {
    if (!savedId || deletingInvoice) return;
    if (!confirmDeleteInvoice) {
      setConfirmDeleteInvoice(true);
      return;
    }
    setConfirmDeleteInvoice(false);
    setDeletingInvoice(true);
    setStatus('Deleting invoice\u2026');
    try {
      const response = await fetch('/api/invoices-delete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: savedId }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(json.error || `Delete failed (${response.status}).`);
      }
      setSavedId('');
      setStatus('Invoice deleted.');
    } catch (error) {
      setStatus(error?.message || 'Delete failed.');
    } finally {
      setDeletingInvoice(false);
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
      // html2canvas is a heavy dependency only needed when the operator
      // actually exports a JPG. Load it on demand so it stays out of the
      // /inv composer's initial bundle (faster first paint, less memory
      // on mobile Safari / tablet Firefox).
      const { default: html2canvas } = await import('html2canvas');
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
          invoiceType={invoiceType}
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
          requestedDue={requestedDue}
          depositAskOpen={depositAskOpen}
          setDepositAskOpen={setDepositAskOpen}
          paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod}
          paidConfirmed={paidConfirmed}
          setPaidConfirmed={setPaidConfirmed}
          paidAtDate={paidAtDate}
          setPaidAtDate={setPaidAtDate}
          paidAtTime={paidAtTime}
          setPaidAtTime={setPaidAtTime}
                                                  hydrating={hydrating}
        />
        <PreviewPanel
          invoiceType={invoiceType}
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
                              depositPayments={depositPayments}
          depositAskOpen={depositAskOpen}
          balanceDue={balanceDue}
          requestedDue={requestedDue}
          paymentMethod={paymentMethod}
          paidConfirmed={paidConfirmed}
          paidAtDate={paidAtDate}
          status={status}
          documentRef={documentRef}
          downloadJpg={downloadJpg}
          saveInvoice={saveInvoice}
          deleteInvoice={deleteInvoice}
          deletingInvoice={deletingInvoice}
          confirmDeleteInvoice={confirmDeleteInvoice}
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
            {props.invoiceType !== 'vendor' && <label>Title<Combobox value={props.title} onChange={props.setTitle} options={TITLE_OPTIONS} ariaLabel="Title" placeholder="Title" /></label>}
            <label>Client Name<input value={props.clientName} onChange={(event) => props.setClientName(event.target.value)} onBlur={onBlurTitleCase(props.setClientName)} placeholder="Client Name" /></label>
          </div>
          <label>Contact<input value={props.contact} onChange={(event) => props.setContact(event.target.value)} onBlur={onBlurTitleCase(props.setContact)} placeholder="Instagram / Phone / Email" /></label>
        </div>
      </Fieldset>

      <Fieldset title="Details">
        <div className="field-stack">
          <label>Venue<input value={props.venue} onChange={(event) => props.setVenue(event.target.value)} onBlur={onBlurTitleCase(props.setVenue)} placeholder="Venue" /></label>
          <div className="event-date-row">
            <label>Event Date
              <DateTimeField
                value={props.eventDate}
                onChange={props.setEventDate}
                timeValue={props.eventTime}
                onTimeChange={props.setEventTime}
                withTime
                ariaLabel="Event Date and time"
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
              <label>Package Discount<input
                className="no-spinner"
                type="number"
                min="0"
                inputMode="numeric"
                value={item.discount || 0}
                onFocus={selectAllIfZero}
                onChange={(event) => props.updateItem(item.id, { discount: parseMoneyInput(event.target.value) })}
                onBlur={(event) => {
                  const clamped = clampItemDiscount(parseMoneyInput(event.target.value), item.qty, item.price);
                  if (clamped !== (Number(item.discount) || 0)) props.updateItem(item.id, { discount: clamped });
                }}
                placeholder="0"
              /></label>
              <div className="invoice-item-controls">
                <div className="qty-control" aria-label="Quantity">
                  <span>Qty</span>
                  <span className="qty-stepper">
                    <button type="button" aria-label="Decrease quantity" onClick={() => props.updateItem(item.id, { qty: Math.max(1, Math.round(Number(item.qty) || 1) - 1) })}>-</button>
                    <strong>{Math.max(1, Math.round(Number(item.qty) || 1))}</strong>
                    <button type="button" aria-label="Increase quantity" onClick={() => props.updateItem(item.id, { qty: Math.max(1, Math.round(Number(item.qty) || 1) + 1) })}>+</button>
                  </span>
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
                Custom Amount (IDR)
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
          
          <PaymentMethodPicker
            paymentMethod={props.paymentMethod}
            setPaymentMethod={props.setPaymentMethod}
          />
          <PaymentMethodSummary paymentMethod={props.paymentMethod} />
          <div className="total-card"><span>Grand Total</span><strong>{rupiah(props.totals.grandTotal)}</strong></div>
          <div className="total-card"><span>{isFullPayment(props.totals) ? 'Full Payment Due' : 'Deposit Due'}</span><strong>{rupiah(props.totals.depositDue)}</strong></div>
        </div>
      </Fieldset>
        </>
      ) : (
        <>
          <LockedDetails
            invoiceType={props.invoiceType}
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
            <PaymentMethodFieldset
              paymentMethod={props.paymentMethod}
              setPaymentMethod={props.setPaymentMethod}
            />
          ) : null}
          {props.mode === 'deposit' || (props.mode === 'paid' && props.depositPayments && props.depositPayments.length > 0) ? (
            <DepositLedger
              mode={props.mode}
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
              requestedDue={props.requestedDue}
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

// PaymentMethodPicker, PaymentMethodSummary, PaymentMethodFieldset,
// and LockedDetails were moved to invoiceSections.jsx (Pass 53) and
// are imported above. They are pure, props-only sections.

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
function DepositLedger({ mode, payments, addPayment, updatePayment, removePayment, depositMode, setDepositMode, depositCustomAmount, setDepositCustomAmount, depositPaidTotal, balanceDue, requestedDue, totals, depositAskOpen, setDepositAskOpen }) {
  const fullPayment = isFullPayment(totals);
  // In the Paid tab the requested figure is always the remaining
  // balance, so it reads as "Full Payment" regardless of preset. The
  // Deposit tab keeps its existing wording (full vs partial deposit).
  const requestLabel = mode === 'paid'
    ? 'Full Payment'
    : (fullPayment ? 'Requested Full Payment' : 'Requested Deposit Due');
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
            <span>{requestLabel}</span>
            <strong>{rupiah(requestedDue)}</strong>
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

// PaidSummary moved to invoiceSections.jsx (Pass 54); imported above.

// Toolbar icons for the Live Preview header. Same minimalist 2D
// stroke-only family as the /db Subs detail toolbar (viewBox 0 0 24
// 24, fill:none, stroke:currentColor, round caps/joins, className
// "btn-icon") so the two surfaces read as one icon system. They pick
// up the parent .toolbar-icon-btn's currentColor for hover/disabled
// palettes without per-icon overrides.

function PreviewPanel({ mode, clientName, title, contact, venue, eventDate, issuedDate, eventTime, items, totals, depositPayments, depositAskOpen, balanceDue, requestedDue, paymentMethod, paidConfirmed, paidAtDate, status, documentRef, downloadJpg, saveInvoice, deleteInvoice, deletingInvoice, confirmDeleteInvoice, saving, savedId, hydrating, invoiceType }) {
  // Deposit instalments actually marked paid — these are what the
  // Deposit Invoice JPG itemises in the totals area.
  const paidDeposits = (mode === 'deposit' || mode === 'paid')
    ? (depositPayments || []).filter((payment) => payment.paid)
    : [];
  // Payment caption shown in the .payment-box beside Terms &
  // Conditions. In every requesting mode (Draft Invoice / Deposit
  // Invoice "Ask DP") the canvas advertises the REQUESTED deposit
  // due — never the Balance Due — so the Bank Transfer amount always
  // matches exactly what we are currently asking the client to pay.
  // When the requested amount is the full grand total (100% preset
  // or a custom amount >= total) the wording switches to "Full
  // Payment Due" instead of calling it a deposit.
  const dueLabel = isFullPayment(totals) ? 'Full Payment Due' : 'Deposit Due';
  const dueAmount = Math.max(0, Math.round(Number(requestedDue) || 0));
  const selectedPaymentMethod = cleanPaymentMethod(paymentMethod);
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
            <SaveIcon saving={saving} />
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
          {savedId ? (
            <button
              className={`ghost-button compact db-delete-button icon-button${confirmDeleteInvoice ? ' armed' : ''}`}
              type="button"
              onClick={deleteInvoice}
              disabled={deletingInvoice}
              aria-pressed={confirmDeleteInvoice}
              aria-label={confirmDeleteInvoice ? 'Confirm delete invoice' : 'Delete invoice'}
              title={confirmDeleteInvoice ? 'Confirm Delete' : 'Delete'}
            >
              <TrashIcon />
              <span>{deletingInvoice ? 'Deleting\u2026' : (confirmDeleteInvoice ? 'Confirm' : 'Delete')}</span>
            </button>
          ) : null}
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
                  <div className="meta-row"><dt>Client</dt><dd>{invoiceType === 'vendor' ? (clientName ? toTitleCase(clientName) : 'Client') : `${title} ${clientName ? toTitleCase(clientName) : 'Client'}`.trim()}</dd></div>
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
              {items.map((item) => {
                const lineDiscount = clampItemDiscount(item.discount, item.qty, item.price);
                return (
                  <div key={item.id} className={`line-row${lineDiscount > 0 ? ' line-row--has-discount' : ''}`}>
                    <div><strong>{toTitleCase(item.name)}</strong><small>{toTitleCase(item.note)}</small></div>
                    <span>{item.qty || 1}</span>
                    <span>{rupiah((Number(item.qty) || 0) * (Number(item.price) || 0))}</span>
                    {lineDiscount > 0 ? (
                      <>
                        <div className="line-discount-label"><small>Package Discount</small></div>
                        <span aria-hidden="true"></span>
                        <span className="line-discount-amount">-{rupiah(lineDiscount)}</span>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </section>
            <section className="summary-box">
              <p><span>Subtotal</span><strong>{rupiah(totals.subtotal)}</strong></p>
              {Number(totals.discount) > 0 ? (
                <p><span>Discount</span><strong>-{rupiah(totals.discount)}</strong></p>
              ) : null}
              {paidDeposits.map((payment) => (
                <p className="deposit-paid" key={payment.id}>
                  <span>Deposit Paid on {prettyDate(payment.paidAtDate)}</span>
                  <strong>{rupiah(payment.amount)}</strong>
                </p>
              ))}
              <p className="grand"><span>Grand Total</span><strong>{rupiah(totals.grandTotal)}</strong></p>
              {mode === 'paid' && paidConfirmed ? (
                <p className="paid-in-full-row"><span>{paidDeposits.length ? 'Full Payment on' : 'Fully Paid on'} {prettyDate(paidAtDate)}</span><strong>{rupiah(paidDeposits.length ? balanceDue : totals.grandTotal)}</strong></p>
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
                    {selectedPaymentMethod === 'qr' ? (
                      <img src={PAYMENT_QR_SRC} alt="Payment QR" />
                    ) : (
                      <div className="bank-details">
                        <p className="bank-details-heading">Bank Transfer</p>
                        <dl className="bank-details-list">
                          <div className="bank-details-row"><dt>Bank</dt><dd>{BANK_DETAILS.bank}</dd></div>
                          <div className="bank-details-row"><dt>Account No.</dt><dd>{BANK_DETAILS.accountNumber}</dd></div>
                          <div className="bank-details-row"><dt>Account Name</dt><dd>{BANK_DETAILS.accountHolderLabel}</dd></div>
                        </dl>
                      </div>
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

// PackageCatalogEditor moved to invoiceSections.jsx (Pass 54);
// imported above. Its inline catalogue-edit local state lives inside
// the component; save/delete remain prop-driven.
