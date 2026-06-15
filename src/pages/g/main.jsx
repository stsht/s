import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GlobalBackground } from '../../components/GlobalBackground.jsx';
import { toTitleCase } from '../../utils/titleCase.js';
import '../../../animate.css';
import '../../styles/app-base.css';
import '../invcs/inv.css';

/**
 * Gallery (public delivery) entrypoint.
 *
 * Routing/slug logic is owned by _worker.js — this page only handles
 * the unlock POST and the rendered links. Slug parsing here just reads
 * whatever path the worker delivered us; it does NOT regenerate or
 * normalize the short-code so existing links keep working unchanged.
 */
function deliverySlug() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0]?.toLowerCase() === 'g') return parts[1] || '';
  return parts[0] || '';
}

const BANK_DETAILS = {
  bank: 'Mandiri',
  accountNumber: '1050023197043',
  accountHolderLabel: 'BELLY',
};
const PAYMENT_QR_SRC = '/payment-qr.png';
const PAYMENT_METHODS = ['bank', 'qr'];

function cleanPaymentMethod(value) {
  return PAYMENT_METHODS.includes(String(value || '').toLowerCase())
    ? String(value || '').toLowerCase()
    : 'bank';
}

// Official StarShots contact channels surfaced in the public payment
// area so clients can send proof of payment after transferring. Subtle
// inline links only — never a popup/alert and never blocking.
const CONTACT = {
  whatsapp: '6282260882006',
  instagram: 'https://www.instagram.com/starshots.id/',
};

// Estimate the real byte size of a base64 data URL. The data-URL string
// is ~33% larger than the encoded bytes because of base64, so enforcing a
// size budget on the raw string length would be wrong — we decode the
// payload length back to bytes instead.
function dataUrlByteSize(dataUrl) {
  const payload = String(dataUrl || '').split(',')[1] || '';
  return Math.ceil((payload.length * 3) / 4);
}

// Trigger a client-side download for a data/asset URL without leaving
// the page. Used by the QR payment-card export and the direct-QR
// fallback.
function triggerImageDownload(href, filename) {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// Small inline icons for the client-facing invoice toolbar. Kept as
// currentColor strokes so they inherit the button's primary/neutral
// colour. Icon + text labels (never icon-only) for client clarity.
function IconCopy() {
  return (
    <svg className="public-invoice-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M5 15.5V6a2 2 0 0 1 2-2h8.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function IconDownload() {
  return (
    <svg className="public-invoice-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4v10m0 0 3.5-3.5M12 14l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 19h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function IconClose() {
  return (
    <svg className="public-invoice-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconEye() {
  return (
    <svg className="public-invoice-action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2.2" />
    </svg>
  );
}

function rupiah(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(value || 0)).replace(/\s/g, ' ');
}

function prettyDate(value) {
  if (!value) return '-';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function prettyDateTime(date, time) {
  const base = prettyDate(date);
  const cleanTime = String(time || '').trim();
  return cleanTime ? `${base} ${cleanTime}` : base;
}

function isFullPayment(invoice) {
  const due = Math.max(0, Math.round(Number(invoice?.deposit_amount) || 0));
  const grand = Math.max(0, Math.round(Number(invoice?.grand_total) || 0));
  return grand > 0 && due >= grand;
}

function invoiceItems(invoice) {
  const data = invoice?.invoice_data && typeof invoice.invoice_data === 'object' ? invoice.invoice_data : {};
  const items = Array.isArray(data.items) ? data.items : [];
  return items.length ? items : [{
    id: 'invoice-line',
    name: 'Package',
    note: '',
    qty: 1,
    price: Number(invoice?.grand_total) || 0,
  }];
}

// Amount-due label + value for the payment area, mirroring the
// PublicInvoiceDocument payment box (full payment vs deposit). Totals
// logic is unchanged — this only reads the already-computed figures.
function paymentDueInfo(invoice) {
  const data = invoice?.invoice_data && typeof invoice.invoice_data === 'object' ? invoice.invoice_data : {};
  const grandTotal = Math.max(0, Math.round(Number(invoice?.grand_total) || 0));
  const requestedFullPayment = String(data.depositMode || '') === '100'
    || Math.max(0, Math.round(Number(data.depositCustomAmount) || 0)) >= grandTotal
    || isFullPayment(invoice);
  return {
    label: requestedFullPayment ? 'Full Payment Due' : 'Deposit Due',
    amount: Math.max(0, Math.round(Number(invoice?.deposit_amount) || 0)),
  };
}

// Whether the public page should present the intermediate payment gate
// (QR/bank + amount due). This is the inverse of "open the viewer
// directly" and mirrors the payment-panel visibility rule exactly, so the
// gate and the panel can never disagree: it is shown only when an amount
// is actually outstanding. Fully paid invoices and deposit invoices whose
// deposit ask has been closed (depositAskOpen === false → "Deposit
// Received") have nothing currently due, so they skip the gate and the
// viewer opens directly. depositAskOpen defaults to open (true) when
// unset, matching PublicInvoiceDocument.
function paymentGateNeeded(invoice) {
  if (!invoice) return false;
  const data = invoice.invoice_data && typeof invoice.invoice_data === 'object' ? invoice.invoice_data : {};
  const status = String(invoice.status || 'invoice').toLowerCase();
  if (status === 'paid') return false;
  if (status === 'deposit' && data.depositAskOpen === false) return false;
  return true;
}

function PublicInvoiceDocument({ invoice }) {
  const data = invoice?.invoice_data && typeof invoice.invoice_data === 'object' ? invoice.invoice_data : {};
  const items = invoiceItems(invoice);
  const status = String(invoice?.status || 'invoice').toLowerCase();
  const subtotal = items.reduce((sum, item) => sum + ((Number(item.qty) || 0) * (Number(item.price) || 0)), 0);
  const grandTotal = Math.max(0, Math.round(Number(invoice?.grand_total) || 0));
  const discount = Math.max(0, Math.round(Number(data.discount) || (subtotal - grandTotal) || 0));
  const paidDeposits = (status === 'deposit' || status === 'paid')
    ? (Array.isArray(data.depositPayments) ? data.depositPayments : []).filter((payment) => payment?.paid)
    : [];
  // Remaining balance settled by the final payment = grand total minus
  // the deposits already paid. When there is no deposit this equals the
  // grand total, so a plain paid-in-full receipt is unchanged.
  const paidDepositTotal = paidDeposits.reduce(
    (sum, payment) => sum + Math.max(0, Math.round(Number(payment?.amount) || 0)),
    0,
  );
  const remainingPaid = Math.max(0, grandTotal - paidDepositTotal);
  const paidReceipt = data.paidReceipt && typeof data.paidReceipt === 'object' ? data.paidReceipt : {};
  const paymentMethod = cleanPaymentMethod(data.paymentMethod);
  const invoiceType = String(invoice?.invoice_type || data.invoiceType || '').trim().toLowerCase() === 'vendor' ? 'vendor' : 'client';
  const displayName = invoice?.client_name ? toTitleCase(invoice.client_name) : 'Client';
  const billToName = invoiceType === 'vendor'
    ? displayName
    : `${invoice?.client_title || 'Ms.'} ${displayName}`.trim();
  const requestedFullPayment = String(data.depositMode || '') === '100'
    || Math.max(0, Math.round(Number(data.depositCustomAmount) || 0)) >= grandTotal
    || isFullPayment(invoice);
  const dueLabel = requestedFullPayment ? 'Full Payment Due' : 'Deposit Due';
  const depositAskOpen = data.depositAskOpen !== false;

  return (
    <article className="invoice-sheet">
      <header className="sheet-top"><img src="/logo-hero.png" alt="StarShots" /></header>
      <section className="sheet-grid">
        <div className="sheet-box">
          <p className="eyebrow">Bill To</p>
          <dl className="meta-list">
            <div className="meta-row"><dt>Client</dt><dd>{billToName}</dd></div>
            <div className="meta-row"><dt>Contact</dt><dd>{invoice?.client_contact || '-'}</dd></div>
          </dl>
        </div>
        <div className="sheet-box">
          <p className="eyebrow">Details</p>
          <dl className="meta-list">
            <div className="meta-row"><dt>Venue</dt><dd>{invoice?.venue ? toTitleCase(invoice.venue) : 'TBA'}</dd></div>
            <div className="meta-row"><dt>Event Date</dt><dd>{prettyDateTime(invoice?.event_date, invoice?.event_time || data.eventTime)}</dd></div>
            <div className="meta-row"><dt>Issued</dt><dd>{prettyDate(invoice?.invoice_date)}</dd></div>
          </dl>
        </div>
      </section>
      <section className="sheet-box line-table">
        <div className="line-head"><span>Package</span><span>Qty</span><span>Amount</span></div>
        {items.map((item, index) => (
          <div key={item.id || index} className="line-row">
            <div><strong>{toTitleCase(item.name || 'Package')}</strong><small>{toTitleCase(item.note || '')}</small></div>
            <span>{item.qty || 1}</span>
            <span>{rupiah((Number(item.qty) || 0) * (Number(item.price) || 0))}</span>
          </div>
        ))}
      </section>
      <section className="summary-box">
        <p><span>Subtotal</span><strong>{rupiah(subtotal)}</strong></p>
        <p><span>Discount</span><strong>{rupiah(discount)}</strong></p>
        {paidDeposits.map((payment, index) => (
          <p className="deposit-paid" key={payment.id || index}>
            <span>Deposit Paid on {prettyDate(payment.paidAtDate)}</span>
            <strong>{rupiah(payment.amount)}</strong>
          </p>
        ))}
        <p className="grand"><span>Grand Total</span><strong>{rupiah(grandTotal)}</strong></p>
        {status === 'paid' && paidReceipt.paid !== false ? (
          <p className="paid-in-full-row"><span>{paidDeposits.length ? 'Full Payment on' : 'Fully Paid on'} {prettyDate(paidReceipt.paidAtDate || invoice?.invoice_date)}</span><strong>{rupiah(paidDeposits.length ? remainingPaid : grandTotal)}</strong></p>
        ) : null}
        {status === 'deposit' ? (
          <p className="balance-due"><span>Balance Due</span><strong>{rupiah(invoice?.balance_due)}</strong></p>
        ) : null}
        {status === 'paid' ? (
          <p className="balance-due"><span>Balance Due</span><strong>{rupiah(0)}</strong></p>
        ) : null}
      </section>
      <section className="bottom-grid">
        <div className="sheet-box payment-box">
          {status !== 'paid' ? <p className="eyebrow">Payment</p> : null}
          {status === 'paid' ? (
            <div className="paid-stamp">
              <span className="paid-stamp-badge">PAID</span>
              <p className="paid-stamp-note">Thank You!<br />Your Invoice has been Paid in Full</p>
            </div>
          ) : status === 'deposit' && !depositAskOpen ? (
            <div className="deposit-received-stamp">
              <span>Deposit</span>
              <span>Received</span>
            </div>
          ) : (
            <>
              {paymentMethod === 'qr' ? (
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
                <strong>{rupiah(invoice?.deposit_amount)}</strong>
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
  );
}

function GalleryLinks({ payload }) {
  const slug = useMemo(() => deliverySlug(), []);
  const delivery = payload?.delivery || {};
  const invoiceRenderRef = useRef(null);
  const copyResetRef = useRef(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const [invoiceImage, setInvoiceImage] = useState('');
  const [invoiceStatus, setInvoiceStatus] = useState('');
  // Brief "Copied" confirmation shown on the adaptive Bank action.
  const [bankCopied, setBankCopied] = useState(false);

  const [fullScreenPreviewOpen, setFullScreenPreviewOpen] = useState(false);
  // Invoices with nothing currently due (fully paid, or a deposit invoice
  // whose deposit is already received) skip the intermediate "View Full
  // Invoice" payment gate and open the full viewer directly. This flag
  // remembers that we entered the viewer that way so closing it returns
  // straight to the delivery page (instead of revealing the unused
  // intermediate card behind it).
  const [paidDirectView, setPaidDirectView] = useState(false);
  // Deposit invoices need invoice_data.depositAskOpen (only on the fetched
  // record, not the card summary) to know whether the deposit is still
  // due. While that fetch is in flight we cannot tell whether to skip the
  // gate, so we show the small loading state — never the gate — until the
  // invoice resolves and the decision is made.
  const [gateDeciding, setGateDeciding] = useState(false);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // Live transform refs. Gesture handlers read/write these so the
  // listeners never need rebinding on scale/pan changes (which used to
  // destabilise mid-pinch). React state mirrors them only for rendering.
  const scaleRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const gestureStartScaleRef = useRef(1);
  const pinchPrevDistRef = useRef(0);
  const pinchPrevMidRef = useRef(null);
  const touchLastPointRef = useRef(null);
  const pointerLastPointRef = useRef(null);
  const previewContainerRef = useRef(null);
  const fullscreenImgRef = useRef(null);

  // Reset scale when invoice preview surfaces close
  useEffect(() => {
    if (!fullScreenPreviewOpen && !invoiceOpen) {
      setScale(1);
      setPan({ x: 0, y: 0 });
      setPaidDirectView(false);
      setGateDeciding(false);
    }
  }, [fullScreenPreviewOpen, invoiceOpen]);

  // Lock background page scrolling while the fullscreen invoice viewer is
  // open so drag/pan gestures never bleed through into body scroll.
  useEffect(() => {
    if (!fullScreenPreviewOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [fullScreenPreviewOpen]);

  // Keep the transform refs in sync with state for any update that does not
  // go through the gesture handlers (Fit button, open/close reset).
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { panRef.current = pan; }, [pan]);

  // Cached, stable sizing for pan bounds. Measured from layout ONLY when
  // it can actually change (image load, viewer open, resize/orientation) —
  // never during a gesture. Reading layout (offsetWidth / getBoundingClientRect)
  // every move is what made Safari stutter and snap back.
  // Bounds for the current scale are derived from these cached numbers
  // with no DOM access, so a drag can never feed back into a reflow.
  const baseSizeRef = useRef({ imgW: 0, imgH: 0, contW: 0, contH: 0, cx: 0, cy: 0 });
  const boundsRef = useRef({ maxX: 0, maxY: 0 });

  const recomputeBounds = useCallback(() => {
    const { imgW, imgH, contW, contH } = baseSizeRef.current;
    const s = scaleRef.current;
    boundsRef.current = {
      maxX: Math.max(0, (imgW * s - contW) / 2),
      maxY: Math.max(0, (imgH * s - contH) / 2),
    };
  }, []);

  const measureBase = useCallback(() => {
    const el = previewContainerRef.current;
    const img = fullscreenImgRef.current;
    if (!el || !img) return;
    const rect = el.getBoundingClientRect();
    baseSizeRef.current = {
      imgW: img.offsetWidth,
      imgH: img.offsetHeight,
      contW: el.clientWidth,
      contH: el.clientHeight,
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2,
    };
    recomputeBounds();
  }, [recomputeBounds]);

  // Clamp against the cached bounds only (no layout). Stops exactly at the
  // real edges; inside the bounds the pan is passed through untouched, so
  // dragging never feels resisted.
  const clampPan = useCallback((p) => {
    const { maxX, maxY } = boundsRef.current;
    return {
      x: Math.min(maxX, Math.max(-maxX, p.x)),
      y: Math.min(maxY, Math.max(-maxY, p.y)),
    };
  }, []);

  // Imperative transform write. Bypasses React during gestures so a full
  // re-render of this (large) component never lands between frames — that
  // per-frame setState was the core desktop-stutter cause. React state is
  // reconciled only when the gesture settles (syncTransformState).
  const applyDOM = useCallback(() => {
    const img = fullscreenImgRef.current;
    if (!img) return;
    img.style.setProperty('--scale', String(scaleRef.current));
    img.style.setProperty('--pan-x', `${panRef.current.x}px`);
    img.style.setProperty('--pan-y', `${panRef.current.y}px`);
  }, []);

  const syncTransformState = useCallback(() => {
    setScale(scaleRef.current);
    setPan({ x: panRef.current.x, y: panRef.current.y });
  }, []);

  // Fit / reset: recentre and rescale to 1, syncing both DOM and state.
  const resetTransform = useCallback(() => {
    scaleRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    recomputeBounds();
    applyDOM();
    syncTransformState();
  }, [recomputeBounds, applyDOM, syncTransformState]);

  // Re-measure + re-clamp after a layout change (image load, resize,
  // orientation) so the zoomed invoice stays inside the new bounds.
  const reclampTransform = useCallback(() => {
    measureBase();
    panRef.current = clampPan(panRef.current);
    applyDOM();
    syncTransformState();
  }, [measureBase, clampPan, applyDOM, syncTransformState]);

  // Pointer / touch / wheel zoom + pan for the fullscreen invoice. Bound
  // once per open (handlers read refs, never component state) so a gesture
  // is never interrupted by a listener rebind. During a gesture the
  // transform is written straight to the DOM via requestAnimationFrame and
  // React state is reconciled only after the gesture settles, so Safari /
  // Firefox no longer drop frames or snap back. Zoom is focal-point based.
  useEffect(() => {
    if (!fullScreenPreviewOpen) return undefined;
    const el = previewContainerRef.current;
    if (!el) return undefined;

    const MIN_SCALE = 1;
    const MAX_SCALE = 4;
    const distance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const midpoint = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

    // Measure now in case the image was already decoded before this effect
    // ran (cached JPG → onLoad may have fired earlier).
    measureBase();

    let rafId = 0;
    const draw = () => { rafId = 0; applyDOM(); };
    const schedule = () => { if (!rafId) rafId = requestAnimationFrame(draw); };

    let syncId = 0;
    const scheduleSync = () => {
      if (syncId) clearTimeout(syncId);
      syncId = setTimeout(() => { syncId = 0; syncTransformState(); }, 90);
    };

    const panTo = (p) => { panRef.current = clampPan(p); schedule(); scheduleSync(); };
    const panBy = (dx, dy) => panTo({ x: panRef.current.x + dx, y: panRef.current.y + dy });

    // Focal zoom: keep the image point under (fx, fy) fixed while scaling.
    const zoomTo = (rawScale, fx, fy, extraPan) => {
      const s0 = scaleRef.current || 1;
      const s1 = Math.max(MIN_SCALE, Math.min(MAX_SCALE, rawScale));
      if (s1 === s0 && !extraPan) return;
      const { cx, cy } = baseSizeRef.current;
      const p0 = panRef.current;
      const k = (s1 - s0) / s0;
      let nx = p0.x - k * (fx - cx - p0.x);
      let ny = p0.y - k * (fy - cy - p0.y);
      if (extraPan) { nx += extraPan.x; ny += extraPan.y; }
      scaleRef.current = s1;
      recomputeBounds();
      panRef.current = clampPan({ x: nx, y: ny });
      schedule();
      scheduleSync();
    };

    const handleTouchStart = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        pinchPrevDistRef.current = distance(e.touches[0], e.touches[1]);
        pinchPrevMidRef.current = midpoint(e.touches[0], e.touches[1]);
        touchLastPointRef.current = null;
      } else if (e.touches.length === 1 && scaleRef.current > 1) {
        e.preventDefault();
        touchLastPointRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const handleTouchMove = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const prevDist = pinchPrevDistRef.current || 1;
        const dist = distance(e.touches[0], e.touches[1]);
        const mid = midpoint(e.touches[0], e.touches[1]);
        const prevMid = pinchPrevMidRef.current || mid;
        zoomTo(
          scaleRef.current * (dist / prevDist),
          mid.x,
          mid.y,
          { x: mid.x - prevMid.x, y: mid.y - prevMid.y },
        );
        pinchPrevDistRef.current = dist;
        pinchPrevMidRef.current = mid;
      } else if (e.touches.length === 1 && scaleRef.current > 1 && touchLastPointRef.current) {
        e.preventDefault();
        const p = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        panBy(p.x - touchLastPointRef.current.x, p.y - touchLastPointRef.current.y);
        touchLastPointRef.current = p;
      }
    };

    const handleTouchEnd = (e) => {
      if (e.touches.length === 1) {
        pinchPrevDistRef.current = 0;
        pinchPrevMidRef.current = null;
        touchLastPointRef.current = scaleRef.current > 1
          ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
          : null;
      } else if (e.touches.length === 0) {
        pinchPrevDistRef.current = 0;
        pinchPrevMidRef.current = null;
        touchLastPointRef.current = null;
        if (scaleRef.current <= 1) { scaleRef.current = 1; panTo({ x: 0, y: 0 }); }
        syncTransformState();
      }
    };

    const handleWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomTo(scaleRef.current * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    };

    const handleGestureStart = (e) => {
      e.preventDefault();
      gestureStartScaleRef.current = scaleRef.current;
    };

    const handleGestureChange = (e) => {
      e.preventDefault();
      const { cx, cy } = baseSizeRef.current;
      zoomTo(gestureStartScaleRef.current * Number(e.scale || 1), cx, cy);
    };

    const handlePointerDown = (e) => {
      if (e.pointerType === 'touch' || scaleRef.current <= 1) return;
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      pointerLastPointRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      el.classList.add('is-grabbing');
    };

    const handlePointerMove = (e) => {
      const last = pointerLastPointRef.current;
      if (!last || last.id !== e.pointerId || scaleRef.current <= 1) return;
      e.preventDefault();
      panBy(e.clientX - last.x, e.clientY - last.y);
      pointerLastPointRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    };

    const handlePointerEnd = (e) => {
      if (pointerLastPointRef.current?.id === e.pointerId) {
        pointerLastPointRef.current = null;
        el.classList.remove('is-grabbing');
        syncTransformState();
      }
    };

    const handleResize = () => {
      measureBase();
      panRef.current = clampPan(panRef.current);
      schedule();
      scheduleSync();
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: false });
    el.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('gesturestart', handleGestureStart, { passive: false });
    el.addEventListener('gesturechange', handleGestureChange, { passive: false });
    el.addEventListener('pointerdown', handlePointerDown);
    el.addEventListener('pointermove', handlePointerMove);
    el.addEventListener('pointerup', handlePointerEnd);
    el.addEventListener('pointercancel', handlePointerEnd);
    el.addEventListener('lostpointercapture', handlePointerEnd);
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (syncId) clearTimeout(syncId);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('gesturestart', handleGestureStart);
      el.removeEventListener('gesturechange', handleGestureChange);
      el.removeEventListener('pointerdown', handlePointerDown);
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerup', handlePointerEnd);
      el.removeEventListener('pointercancel', handlePointerEnd);
      el.removeEventListener('lostpointercapture', handlePointerEnd);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      el.classList.remove('is-grabbing');
    };
  }, [fullScreenPreviewOpen, measureBase, recomputeBounds, clampPan, applyDOM, syncTransformState]);

  // Pressing Esc closes the invoice viewer
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        if (fullScreenPreviewOpen) {
          setFullScreenPreviewOpen(false);
          if (paidDirectView) setInvoiceOpen(false);
        } else if (invoiceOpen) {
          setInvoiceOpen(false);
        }
      }
    }
    if (invoiceOpen || fullScreenPreviewOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [invoiceOpen, fullScreenPreviewOpen, paidDirectView]);

  const links = (payload?.links || []).filter((item) => item?.url);
  const linkMap = new Map(links.map((link) => [String(link.service || '').toLowerCase(), link]));
  const services = [
    { key: 'gd', aliases: ['gd', 'drive', 'google drive'], fallback: 'Google Drive', icon: 'GD' },
    { key: 'db', aliases: ['db', 'dropbox'], fallback: 'Dropbox', icon: 'DB' },
    { key: 'wt', aliases: ['wt', 'wetransfer', 'we transfer'], fallback: 'WeTransfer', icon: 'WT' },
  ];

  async function track(service, eventType = 'button_click') {
    if (!delivery.id || !service) return;
    fetch('/api/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliveryId: delivery.id, service, eventType }),
    }).catch(() => {});
  }

  async function openInvoice(event) {
    event.preventDefault();
    track('invoice', 'invoice_view');
    // Decide whether the intermediate payment gate is needed. We open the
    // full viewer directly whenever nothing is currently due:
    //   - PAID invoices: never anything due.
    //   - DEPOSIT invoices: only direct when the deposit is already
    //     received, which depends on invoice_data.depositAskOpen — a field
    //     present only on the fetched record, not the card summary. So we
    //     defer that decision (gateDeciding) and show the loading state
    //     until the fetch resolves, never flashing the gate.
    //   - Everything else (unpaid full invoice): keep the gate.
    // Until the JPG is ready a small loading state shows — never a
    // premature "Invoice not found" (errors surface only after the fetch).
    const status = String(payload?.invoice?.status || '').toLowerCase();
    const directNow = status === 'paid';
    const deciding = status === 'deposit';
    setInvoiceOpen(true);
    setFullScreenPreviewOpen(false);
    setScale(1);
    setPan({ x: 0, y: 0 });
    setInvoiceImage('');
    setInvoiceStatus('Opening invoice...');
    setPaidDirectView(directNow);
    setGateDeciding(deciding);
    try {
      const response = await fetch(`/api/public-invoice?slug=${encodeURIComponent(slug)}`, {
        credentials: 'same-origin',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Invoice not found.');
      setInvoice(data.invoice);
      setInvoiceStatus('Rendering invoice...');
    } catch (error) {
      setInvoice(null);
      setInvoiceStatus(error.message || 'Invoice unavailable.');
    }
  }

  function openFullInvoice() {
    track('invoice', 'invoice_fullscreen');
    setScale(1);
    setPan({ x: 0, y: 0 });
    setFullScreenPreviewOpen(true);
  }

  // Close the full viewer. When it was opened directly for a PAID
  // invoice (paidDirectView), also close the intermediate gate so the
  // client lands back on the delivery page rather than the skipped card.
  function closeFullPreview() {
    setFullScreenPreviewOpen(false);
    if (paidDirectView) {
      setInvoiceOpen(false);
      setPaidDirectView(false);
    }
  }

  // Paid-direct auto-open: once the invoice JPG has actually rendered,
  // open the full viewer directly. Gating on `invoiceImage` guarantees
  // the invoice was fetched AND the sheet rendered, so we never flash the
  // intermediate gate and never open onto a premature "not found"/empty
  // state. If the fetch fails the image never renders, the viewer stays
  // closed, and the loading card shows the real error instead.
  useEffect(() => {
    if (paidDirectView && invoiceImage && !fullScreenPreviewOpen) {
      track('invoice', 'invoice_fullscreen');
      setScale(1);
      setPan({ x: 0, y: 0 });
      setFullScreenPreviewOpen(true);
    }
  }, [paidDirectView, invoiceImage, fullScreenPreviewOpen]);

  // Deferred gate decision for deposit invoices. Once the invoice record
  // is fetched we know depositAskOpen: if a payment is genuinely due we
  // drop the loading state and reveal the intermediate gate; otherwise the
  // deposit is already received, so we mark it direct-view and let the
  // auto-open effect above open the full viewer once the JPG renders.
  useEffect(() => {
    if (!gateDeciding || !invoice) return;
    if (paymentGateNeeded(invoice)) {
      setGateDeciding(false);
    } else {
      setPaidDirectView(true);
      setGateDeciding(false);
    }
  }, [gateDeciding, invoice]);

  useEffect(() => {
    let alive = true;
    if (!invoiceOpen || !invoice || !invoiceRenderRef.current) return undefined;

    async function renderInvoiceImage() {
      if (document.fonts?.ready) {
        try { await document.fonts.ready; } catch {}
      }
      try {
        // Render the invoice toward a ~4K long edge so the downloaded JPG
        // stays crisp when the client zooms in the fullscreen viewer. The
        // export host renders the sheet at a large fixed CSS width (3000px),
        // so a blind 3x multiplier would create an enormous canvas that
        // mobile Safari refuses to allocate. Instead we scale toward a 4K
        // long edge, never below the previous output, and cap by both a hard
        // 3x ceiling and a safe canvas-area budget for device safety. Output
        // stays JPEG (PNG would be far larger for this mostly-white sheet).
        const TARGET_LONG_EDGE = 4096; // 4K-ish long edge target
        const MAX_CANVAS_AREA = 24 * 1024 * 1024; // ~24M px allocation cap
        const host = invoiceRenderRef.current;
        const baseW = host.offsetWidth || 3000;
        const baseH = host.offsetHeight || 2121;
        const baseLongEdge = Math.max(baseW, baseH);
        const legacyScale = Math.min(2, window.devicePixelRatio || 1.5);
        const fourKScale = TARGET_LONG_EDGE / baseLongEdge;
        const areaScale = Math.sqrt(MAX_CANVAS_AREA / (baseW * baseH));
        const exportScale = Math.min(3, areaScale, Math.max(legacyScale, fourKScale));
        // html2canvas is a heavy dependency only needed when the client
        // actually opens the invoice viewer. Load it on demand so it
        // stays out of the public delivery page's initial bundle (faster
        // first paint, less memory on mobile Safari / tablet Firefox).
        const { default: html2canvas } = await import('html2canvas');
        const canvas = await html2canvas(invoiceRenderRef.current, {
          backgroundColor: '#ffffff',
          scale: exportScale,
          useCORS: true,
          allowTaint: true,
          imageTimeout: 0,
          logging: false,
          windowWidth: 3000,
          windowHeight: 9000,
        });
        if (!alive) return;
        // Encode as JPEG starting at high quality, stepping quality down only
        // if the encoded file would exceed the ~4MB cap. Size is measured
        // from the decoded base64 payload, not the data-URL string length.
        const MAX_INVOICE_JPG_BYTES = 4 * 1024 * 1024;
        const QUALITY_FLOOR = 0.82;
        let jpegQuality = 0.92;
        let dataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
        while (dataUrlByteSize(dataUrl) > MAX_INVOICE_JPG_BYTES && jpegQuality > QUALITY_FLOOR) {
          jpegQuality = Math.max(QUALITY_FLOOR, Math.round((jpegQuality - 0.03) * 100) / 100);
          dataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
        }
        setInvoiceImage(dataUrl);
        setInvoiceStatus('');
      } catch (error) {
        if (alive) setInvoiceStatus(error.message || 'Could not render invoice.');
      }
    }

    renderInvoiceImage();
    return () => { alive = false; };
  }, [invoiceOpen, invoice]);

  // Clear any pending "Copied" reset timer on unmount so we never set
  // state on an unmounted component.
  useEffect(() => () => {
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
  }, []);

  // Bank action: copy ONLY the account number (BANK_DETAILS.accountNumber),
  // then flash a brief "Copied" confirmation on the button. Uses the
  // async Clipboard API with a hidden-textarea fallback for older
  // browsers. Never alerts — failures fail quietly.
  async function copyBankAccount() {
    const value = String(BANK_DETAILS.accountNumber || '');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      setBankCopied(true);
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setBankCopied(false), 1800);
    } catch {
      // Clipboard may be blocked (insecure context / permissions).
      // Stay silent per spec — no alert, payment flow is never blocked.
    }
  }

  const honorific = String(delivery.title || '').trim();
  // Greeting always includes the honorific when present so the
  // public copy reads as "Hello, Ms. Amanda" / "Hello, Mr. Billy
  // Regal". Older rows that were saved without a title fall back
  // to the bare client name; rows with no name at all keep the
  // generic placeholder.
  const heading = delivery.clientName
    ? `Hello, ${honorific ? `${honorific} ` : ''}${delivery.clientName}`
    : 'Your files are ready';
  const folderLabel = String(delivery.folderName || '').trim();

  // Resolve EVERY service to its stored link. All three services are
  // rendered so the card layout stays consistent (Invoice + GD/DB/WT)
  // regardless of how many links a delivery actually has: an
  // active service renders as a clickable anchor, an unavailable one
  // as a disabled greyed-out row. This avoids the page looking
  // half-empty when only an invoice or only some links exist.
  const resolvedServices = services.map((service) => ({
    ...service,
    link: service.aliases.map((alias) => linkMap.get(alias)).find(Boolean),
  }));

  // Client-facing payment area (unpaid invoices only). Shows Bank
  // Transfer details for the client. Totals are unchanged — we only
  // read the already-computed deposit / full payment due. A `paid`
  // invoice never shows this panel (the JPG keeps its PAID
  // stamp/receipt instead).
  const invoiceStatusValue = String(invoice?.status || 'invoice').toLowerCase();
  const invoiceData = invoice?.invoice_data && typeof invoice.invoice_data === 'object' ? invoice.invoice_data : {};
  // Mirror the invoice JPG's payment box. A deposit invoice whose deposit
  // ask has been closed (depositAskOpen === false) renders as "Deposit
  // Received" with NO payment instructions, so the public payment panel
  // must not contradict it by prompting the client to pay an already
  // received deposit. depositAskOpen defaults to open (true) when unset,
  // matching PublicInvoiceDocument.
  const depositReceived = invoiceStatusValue === 'deposit' && invoiceData.depositAskOpen === false;
  // The panel collects an OUTSTANDING amount only: skip it for fully paid
  // invoices (PAID stamp) and for deposit-received invoices (the deposit
  // is already in — there is no separate public balance-collection flow,
  // and the JPG itself shows no balance instructions in this state).
  const showPaymentPanel = !!invoice && invoiceStatusValue !== 'paid' && !depositReceived;
  const paymentDue = paymentDueInfo(invoice);
  const paymentMethod = cleanPaymentMethod(invoiceData.paymentMethod);
  const paymentActionLabel = paymentMethod === 'qr' ? 'Download QR' : (bankCopied ? 'Copied' : 'Copy Bank Account');
  const PaymentActionIcon = paymentMethod === 'qr' ? IconDownload : IconCopy;
  const downloadSafeName = String(delivery.clientName || 'client').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'client';
  const handlePaymentAction = paymentMethod === 'qr'
    ? () => {
        track('payment_qr', 'payment_qr_download');
        triggerImageDownload(PAYMENT_QR_SRC, `${downloadSafeName}-payment-qr.png`);
      }
    : () => {
        track('payment_bank', 'payment_bank_copy');
        copyBankAccount();
      };

  return (
    <main className="public-delivery-page">
      <GlobalBackground />
      <section className="public-delivery-card" aria-label="Private delivery links">
        {/* Brand header: logo + folder name share a centered column
            above the divider line. The divider replaces the older
            kicker's border-top so the visual hierarchy reads as
            (logo → folder → line → greeting → invoice → links). */}
        <header className="public-delivery-header">
          <picture>
            <source media="(prefers-color-scheme: dark)" srcSet="/logo-hero-white.png" />
            <img className="public-delivery-logo" src="/logo-hero.png" alt="StarShots" />
          </picture>
          {folderLabel ? <p className="public-delivery-folder">{folderLabel}</p> : null}
        </header>
        <div className="public-delivery-divider" role="presentation" />
        <h1 className="public-delivery-greeting">{heading}</h1>

        {payload?.invoice ? (
          <a
            className={`public-delivery-invoice${String(payload?.invoice?.status || '').toLowerCase() === 'paid' ? ' is-paid' : ''}`}
            href="#invoice"
            onClick={openInvoice}
          >
            <span className="public-delivery-invoice-icon" aria-hidden="true">INV</span>
            <span className="public-delivery-invoice-label">Invoice</span>
            <span className="public-delivery-invoice-cta">{String(payload?.invoice?.status || '').toLowerCase() === 'paid' ? 'Paid' : 'View'}</span>
          </a>
        ) : null}

        <p className="public-delivery-subcopy">Choose your preferred delivery option below</p>
        <div className="public-delivery-list">
          {resolvedServices.map(({ key, fallback, icon, link }) => {
            const url = link?.url || '';
            const openUrl = link?.openUrl || url;
            const name = link?.label || fallback;
            const isDone = !!(delivery.delivery_done || delivery.deliveryDone);
            const hasEventDate = !!payload?.delivery?.eventDate;

            if (url && isDone) {
              return (
                <a
                  key={fallback}
                  className="public-delivery-row is-active"
                  href={openUrl}
                  rel="noopener"
                  target="_blank"
                >
                  <span className="public-delivery-icon">{icon}</span>
                  <span className="public-delivery-name">{name}</span>
                  <span className="public-delivery-state">Click</span>
                </a>
              );
            } else if (url && !isDone) {
              // URL exists but the delivery is not marked complete yet.
              // The link is still openable (it logs a service_click via
              // the /api/open-link redirect just like the final state),
              // but we badge it PREVIEW so the client knows the files
              // may still change. No "IN PROGRESS" — that reads as
              // not-clickable, which contradicts an openable row.
              return (
                <a
                  key={fallback}
                  className="public-delivery-row is-active is-preview"
                  href={openUrl}
                  rel="noopener"
                  target="_blank"
                >
                  <span className="public-delivery-icon">{icon}</span>
                  <span className="public-delivery-name">{name}</span>
                  <span className="public-delivery-state">PREVIEW</span>
                </a>
              );
            } else {
              return (
                <button
                  key={fallback}
                  type="button"
                  className="public-delivery-row is-disabled"
                  disabled
                  aria-disabled="true"
                >
                  <span className="public-delivery-icon">{icon}</span>
                  <span className="public-delivery-name">{name}</span>
                  <span className="public-delivery-state">UNAVAILABLE</span>
                </button>
              );
            }
          })}
        </div>
        <p className="public-delivery-signoff">With Love, StarShots ID</p>
      </section>

      {invoiceOpen ? (
        <div className="public-invoice-viewer" role="dialog" aria-modal="true" aria-label="Invoice preview">
          {(paidDirectView || gateDeciding) && !fullScreenPreviewOpen ? (
            // Direct-open / deciding loading state. For invoices that skip
            // the gate (paid or deposit-received) and for deposit invoices
            // still being classified (gateDeciding), we show a small status
            // note (and a Close affordance) instead of the gate while the
            // invoice fetches/renders. The full viewer opens automatically
            // once ready; any fetch error surfaces here only after the
            // request resolves.
            <div className="public-invoice-viewer-card">
              <header className="public-invoice-viewer-toolbar desktop-only-header">
                <strong>Invoice</strong>
                <div className="public-invoice-viewer-actions">
                  <button
                    type="button"
                    className="public-invoice-action public-invoice-action--ghost"
                    onClick={() => setInvoiceOpen(false)}
                    aria-label="Close"
                    style={{ padding: 0, width: '38px' }}
                  >
                    <IconClose />
                  </button>
                </div>
              </header>
              <header className="public-invoice-viewer-header-mobile mobile-only-header">
                <strong>Invoice</strong>
                <button
                  type="button"
                  className="public-invoice-close-btn"
                  onClick={() => setInvoiceOpen(false)}
                  aria-label="Close"
                >
                  <IconClose />
                </button>
              </header>
              <div className="public-invoice-viewer-body">
                <p style={{ padding: '28px 4px', textAlign: 'center', opacity: 0.7 }}>
                  {invoiceStatus || 'Loading invoice…'}
                </p>
              </div>
            </div>
          ) : (
          <div className="public-invoice-viewer-card">
            {/* Desktop Toolbar (hidden on mobile) */}
            <header className="public-invoice-viewer-toolbar desktop-only-header">
              <strong>Invoice</strong>
              <div className="public-invoice-viewer-actions">
                <button
                  type="button"
                  className="public-invoice-action public-invoice-action--ghost"
                  onClick={() => setInvoiceOpen(false)}
                  aria-label="Close"
                  style={{ padding: 0, width: '38px' }}
                >
                  <IconClose />
                </button>
              </div>
            </header>

            {/* Mobile Header (hidden on desktop) */}
            <header className="public-invoice-viewer-header-mobile mobile-only-header">
              <strong>Invoice</strong>
              <button
                type="button"
                className="public-invoice-close-btn"
                onClick={() => setInvoiceOpen(false)}
                aria-label="Close"
              >
                <IconClose />
              </button>
            </header>

            {/* Scrollable Body container for mobile, standard flow for desktop */}
            <div className="public-invoice-viewer-body">
              {/* Invoice gate / trigger. The actual JPG opens in the black fullscreen viewer. */}
              <div className="public-invoice-mobile-preview-container public-invoice-gate">
                <button
                  type="button"
                  className="public-invoice-mobile-preview-trigger"
                  onClick={openFullInvoice}
                >
                  <div className="public-invoice-mobile-preview-thumbnail">
                    {invoiceImage ? (
                      <img src={invoiceImage} alt="Invoice Thumbnail" />
                    ) : (
                      <div className="thumbnail-placeholder">📄</div>
                    )}
                  </div>
                  <div className="public-invoice-mobile-preview-info">
                    <strong>Preview Invoice</strong>
                    <span>Open to view, zoom, and pan the full sheet</span>
                  </div>
                  <div className="public-invoice-mobile-preview-arrow">
                    <IconEye />
                  </div>
                </button>

                {/* Mobile actions (payment method action and Download Invoice) */}
                <div className="public-invoice-mobile-actions">
                  {showPaymentPanel ? (
                    <button
                      type="button"
                      className="public-invoice-action public-invoice-action--primary"
                      onClick={handlePaymentAction}
                    >
                      <PaymentActionIcon />
                      <span>{paymentActionLabel}</span>
                    </button>
                  ) : null}

                  {invoiceImage ? (
                    <a
                      className="public-invoice-action public-invoice-action--small"
                      href={invoiceImage}
                      download={`${downloadSafeName}-invoice.jpg`}
                      onClick={() => track('invoice', 'invoice_download')}
                    >
                      <IconDownload />
                      <span>Download 4K</span>
                    </a>
                  ) : null}
                </div>
              </div>

              {/* Payment Details (visible on both, scrolls naturally on mobile) */}
              {showPaymentPanel ? (
                <div className="public-pay" aria-label="Payment options">
                  <div className="public-pay-head">
                    <span className="public-pay-title">Payment</span>
                    <span className="public-pay-due">
                      <span className="public-pay-due-label">{paymentDue.label}</span>
                      <strong className="public-pay-due-amount">{rupiah(paymentDue.amount)}</strong>
                    </span>
                  </div>
                  <div className="public-pay-body">
                    {paymentMethod === 'qr' ? (
                      <img className="public-pay-qr" src={PAYMENT_QR_SRC} alt="Payment QR" />
                    ) : (
                      <dl className="public-pay-bank">
                        <div className="public-pay-bank-row"><dt>Bank</dt><dd>{BANK_DETAILS.bank}</dd></div>
                        <div className="public-pay-bank-row"><dt>Account No.</dt><dd>{BANK_DETAILS.accountNumber}</dd></div>
                        <div className="public-pay-bank-row"><dt>Account Name</dt><dd>{BANK_DETAILS.accountHolderLabel}</dd></div>
                      </dl>
                    )}
                  </div>
                  <p className="public-pay-note">
                    Kindly send your payment confirmation to StarShots via{' '}
                    <a href={`https://wa.me/${CONTACT.whatsapp}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                    {' '}or{' '}
                    <a href={CONTACT.instagram} target="_blank" rel="noopener noreferrer">Instagram</a>
                    {' '}once the transfer has been completed.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
          )}
          {invoice ? (
            <div className="invoice-export-host public-invoice-render-host" aria-hidden="true">
              <div ref={invoiceRenderRef}>
                <PublicInvoiceDocument invoice={invoice} />
              </div>
            </div>
          ) : null}
          
        </div>
      ) : null}

      {/* Mobile Fullscreen Zoomable Invoice Preview Modal */}
      {fullScreenPreviewOpen ? (
        <div className="public-invoice-fullscreen" role="dialog" aria-modal="true" aria-label="Fullscreen invoice preview">
          <header className="public-invoice-fullscreen-header">
            <button type="button" className="public-invoice-fullscreen-btn" onClick={closeFullPreview} aria-label="Close invoice preview">
              <IconClose />
            </button>
            <button type="button" className="public-invoice-fullscreen-btn" onClick={() => {
              resetTransform();
              if (previewContainerRef.current) {
                previewContainerRef.current.scrollTop = 0;
                previewContainerRef.current.scrollLeft = 0;
              }
            }}>
              Fit
            </button>
            {invoiceImage ? (
              <a
                className="public-invoice-fullscreen-btn"
                href={invoiceImage}
                download={`${String(delivery.clientName || 'client').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'client'}-invoice.jpg`}
                onClick={() => track('invoice', 'invoice_download')}
              >
                <IconDownload />
                <span>Download 4K</span>
              </a>
            ) : null}
          </header>
          <div className="public-invoice-fullscreen-body" ref={previewContainerRef}>
            {invoiceImage ? (
              <img
                src={invoiceImage}
                alt="Invoice Preview"
                ref={fullscreenImgRef}
                onLoad={reclampTransform}
                className={`public-invoice-fullscreen-img${scale > 1 ? ' is-zoomed' : ''}`}
                style={{
                  '--scale': scale,
                  '--pan-x': `${pan.x}px`,
                  '--pan-y': `${pan.y}px`,
                }}
              />
            ) : (
              <p>{invoiceStatus || 'Rendering invoice...'}</p>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}

function GalleryGate() {
  const slug = useMemo(() => deliverySlug(), []);
  const [payload, setPayload] = useState(null);
  // Safe public-facing metadata returned by the empty-password
  // probe (worker handleUnlock). Holds { title, clientName } so the
  // gate can render "Hello, <Title> <Client Name>" before the
  // visitor types the access key. Empty when the metadata could
  // not be loaded — the gate then falls back to a bare "Hello".
  const [gateInfo, setGateInfo] = useState(null);
  // checking = the one-shot admin-bypass / metadata probe is still
  // in flight. While true we render nothing so an authenticated
  // admin (cookie already set by /db) never sees the password gate
  // flash before the auto-unlock resolves. A public visitor's
  // probe returns gate metadata quickly and the gate then renders.
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  // ---- Apple-style splash → form reveal stage ----
  // Mirrors the private PasswordGate so /g visitors see the same
  // calm two-stage entry. None of the unlock fetch / payload /
  // slug behavior is touched.
  const inputRef = useRef(null);
  const logoRef = useRef(null);
  const [revealed, setRevealed] = useState(false);
  const [isPageLoaded, setIsPageLoaded] = useState(false);
  const [isLogoLoaded, setIsLogoLoaded] = useState(false);

  const markSplashLogoReady = useCallback(() => {
    const logo = logoRef.current;
    if (!logo || typeof logo.decode !== 'function') {
      setIsLogoLoaded(true);
      return;
    }
    logo.decode()
      .catch(() => {})
      .finally(() => setIsLogoLoaded(true));
  }, []);

  useEffect(() => {
    if (logoRef.current && logoRef.current.complete) {
      if (logoRef.current.naturalWidth > 0) {
        markSplashLogoReady();
      } else {
        setIsLogoLoaded(true);
      }
    }
  }, [markSplashLogoReady]);

  useEffect(() => {
    if (document.readyState === 'complete') {
      setIsPageLoaded(true);
    } else {
      const handleLoad = () => setIsPageLoaded(true);
      window.addEventListener('load', handleLoad);
      return () => window.removeEventListener('load', handleLoad);
    }
  }, []);

  // Auto-continue to the password gate exactly after 1 logo bounce cycle (2.2s)
  // only after both the page layout is ready AND the high-res logo has downloaded.
  useEffect(() => {
    if (isPageLoaded && isLogoLoaded && !revealed) {
      const timer = setTimeout(() => {
        handleReveal();
      }, 2200);
      return () => clearTimeout(timer);
    }
  }, [isPageLoaded, isLogoLoaded, revealed]);

  // Trigger canonical logo bounce animation as soon as the logo and page are ready.
  // We use a calm, Apple-like initial delay (300ms) before the animation starts,
  // and then reveal the password gate almost instantly after the active animation
  // finishes (at 3600ms total, i.e., 300ms delay + 3300ms active bounce).
  useEffect(() => {
    if (isPageLoaded && isLogoLoaded && logoRef.current) {
      const timer = setTimeout(() => {
        if (window.StarShotsReveal && typeof window.StarShotsReveal.bounceLogos === 'function') {
          window.StarShotsReveal.bounceLogos(logoRef.current.parentNode);
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isPageLoaded, isLogoLoaded]);

  // Keyboard skip for the intro splash. While the intro is still
  // showing (!revealed), pressing ANY key (Enter, Space, Escape, a
  // letter, etc.) dismisses it straight to the password gate — the
  // keyboard equivalent of the click/tap-to-skip already wired on
  // .gate-page. The listener is attached ONLY during the intro and
  // is torn down the instant the gate is revealed, so it never
  // intercepts keystrokes typed into the access-key input once the
  // gate is visible. (The input is hidden + non-focusable behind the
  // splash until reveal, so there is no input to type into while this
  // listener is live.)
  useEffect(() => {
    if (revealed) return undefined;
    const handleKeyDown = () => { handleReveal(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [revealed]);

  function handleReveal() {
    if (revealed) return;
    setRevealed(true);
    // Sync focus inside the user-gesture task (so iOS / Android can
    // raise the soft keyboard) plus a deferred re-focus after the
    // card's fade/scale transition completes (380 ms ≈ a hair after
    // the 0.5 s opacity transition lands).
    inputRef.current?.focus();
    setTimeout(() => { inputRef.current?.focus(); }, 380);
  }

  // Admin auto-unlock + public gate metadata probe.
  //
  // POSTs an empty-password unlock with credentials so the worker
  // can read the HttpOnly admin session cookie. The cookie is never
  // exposed to JS — only the server can verify it. The worker
  // responds in three shapes:
  //   - { ok: true, delivery, links }  -> admin bypass: jump to UI
  //   - { ok: false, gate: { title, clientName } }
  //         -> public visitor: render the gate with a personalised
  //            "Hello, <Title> <Client Name>" greeting
  //   - 4xx error                      -> render the bare gate
  //
  // Empty-password probes do not count toward the gallery 12/min
  // rate limit (see handleUnlock in _worker.js), so this single
  // mount-time call never burns a public visitor's password budget
  // and never writes a password_failed log.
  useEffect(() => {
    let alive = true;
    if (!slug) {
      setChecking(false);
      return undefined;
    }
    if (import.meta.env.DEV) {
      setChecking(false);
      return undefined;
    }
    fetch('/api/unlock', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, password: '' }),
    })
      .then(async (response) => {
        if (!alive) return;
        if (!response.ok) return;
        const data = await response.json().catch(() => ({}));
        if (data?.ok) {
          setPayload(data);
          return;
        }
        const gate = data?.gate;
        if (gate && (gate.title || gate.clientName)) {
          setGateInfo({
            title: String(gate.title || '').trim(),
            clientName: String(gate.clientName || '').trim(),
          });
        }
      })
      .catch(() => {})
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, [slug]);

  async function unlock(event) {
    event.preventDefault();
    const value = password.trim();
    if (!slug) {
      setStatus('Delivery link not found.');
      return;
    }
    if (!value) {
      setStatus('Access key required.');
      return;
    }

    setBusy(true);
    setStatus('Checking...');
    try {
      const response = await fetch('/api/unlock', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, password: value }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Wrong password.');
      setPayload(data);
    } catch (error) {
      if (import.meta.env.DEV) {
        setPayload({
          ok: true,
          delivery: { clientName: 'Client', title: 'Local preview delivery' },
          links: [
            { service: 'drive', label: 'Google Drive', url: 'https://drive.google.com/' },
            { service: 'dropbox', label: 'Dropbox', url: 'https://dropbox.com/' },
          ],
        });
        return;
      }
      setStatus(error.message || 'Wrong password.');
    } finally {
      setBusy(false);
    }
  }

  // Admin probe still in flight — instead of returning null (which
  // produced a brief blank /g flash for both admins and public
  // visitors after PR #56), render the normal gate shell with a
  // subtle "Opening..." status. The form is disabled until the
  // probe resolves so a public visitor doesn't accidentally submit
  // an empty unlock; once `checking` flips off, the probe has
  // either set `payload` (admin auto-unlock) or left it null
  // (public visitor — gate stays visible and editable).
  if (payload) return <GalleryLinks payload={payload} />;

  const gateBusy = busy || checking;
  const gateStatus = checking ? 'Opening...' : status;
  const gateStatusClass = status && !checking ? 'error' : '';

  // Personalised greeting derived from the safe public metadata
  // returned by the empty-password probe. If the probe didn't
  // resolve (network error, missing record, dev mode) we fall
  // back to a bare "Hello" — never to the old "Private Delivery"
  // chrome.
  const honorific = String(gateInfo?.title || '').trim();
  const clientName = String(gateInfo?.clientName || '').trim();
  const greeting = clientName
    ? `Hello, ${honorific ? `${honorific} ` : ''}${clientName}`
    : 'Hello';

  return (
    <main
      className={`gate-page ${revealed ? 'is-revealed' : 'is-splash'}`}
      onClick={handleReveal}
    >
      <GlobalBackground />

      {/* Stage 1: Apple-style splash. */}
      <div className="gate-splash" aria-hidden={revealed ? 'true' : undefined}>
        <picture className="gate-splash-logo-wrapper">
          <source media="(prefers-color-scheme: dark)" srcSet="/logo-hero-white.png" />
          <img
            ref={logoRef}
            className={`gate-splash-logo ss-logo-hero ${(isPageLoaded && isLogoLoaded) ? 'is-loaded' : ''}`}
            src="/logo-hero.png"
            alt="StarShots"
            width="640"
            height="156"
            decoding="async"
            fetchPriority="high"
            loading="eager"
            onLoad={markSplashLogoReady}
            onError={() => setIsLogoLoaded(true)}
          />
        </picture>
      </div>

      {/* Stage 2: the actual access-key form. Identical inner
        * markup and behavior to the previous /g gate; only
        * stopPropagation on the form's onClick is added so a click
        * inside the card never re-triggers the page-level reveal. */}
      <form
        className="gate-card"
        onSubmit={unlock}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Real white-on-transparent asset for dark mode (no filter). */}
        <picture>
          <source media="(prefers-color-scheme: dark)" srcSet="/logo-hero-white.png" />
          <img className="gate-logo" src="/logo-hero.png" alt="StarShots" />
        </picture>
        <h1>{greeting}</h1>
        <label htmlFor="galleryPassword">Access key</label>
        <div className="gate-input">
          <input
            id="galleryPassword"
            ref={inputRef}
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck="false"
            disabled={checking}
          />
          <button type="button" aria-label="Toggle password visibility" onClick={() => setShowPassword((value) => !value)}>
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        <button className="gate-submit" type="submit" disabled={gateBusy}>
          {gateBusy ? 'Opening...' : 'Sign In'}
        </button>
        <p className={`gate-status ${gateStatusClass}`}>{gateStatus}</p>
      </form>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GalleryGate />
  </React.StrictMode>,
);
