import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import html2canvas from 'html2canvas';
import { GlobalBackground } from '../../components/GlobalBackground.jsx';
import { toTitleCase } from '../../utils/titleCase.js';
import '../../../animate.css';
import '../invcs/invcs.css';

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

// Official StarShots contact channels surfaced in the public payment
// area so clients can send proof of payment after transferring. Subtle
// inline links only — never a popup/alert and never blocking.
const CONTACT = {
  whatsapp: '6282260882006',
  instagram: 'https://www.instagram.com/starshots.id/',
};

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

// Resolve the payment method for the client-facing invoice. Existing
// invoices that explicitly chose 'qr' keep QR; everything else
// (missing / empty / 'bank' / unknown) falls back to Bank Transfer,
// which is the default for unpaid invoices.
function resolvePaymentMethod(invoice) {
  const data = invoice?.invoice_data && typeof invoice.invoice_data === 'object' ? invoice.invoice_data : {};
  return String(data.paymentMethod || '').trim().toLowerCase() === 'qr' ? 'qr' : 'bank';
}

// Static/custom QR source saved on the invoice; falls back to the
// shared payment QR asset. Never generates a dynamic QR.
function invoiceQrSrc(invoice) {
  const data = invoice?.invoice_data && typeof invoice.invoice_data === 'object' ? invoice.invoice_data : {};
  return String(data.qrSrc || '/payment-qr.png');
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
  const paidReceipt = data.paidReceipt && typeof data.paidReceipt === 'object' ? data.paidReceipt : {};
  const paymentMethod = resolvePaymentMethod(invoice);
  const qrSrc = invoiceQrSrc(invoice);
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
            <div className="meta-row"><dt>Client</dt><dd>{invoice?.client_title || 'Ms.'} {invoice?.client_name ? toTitleCase(invoice.client_name) : 'Client'}</dd></div>
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
          <p className="paid-in-full-row"><span>Fully Paid on {prettyDate(paidReceipt.paidAtDate || invoice?.invoice_date)}</span><strong>{rupiah(grandTotal)}</strong></p>
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
  const qrCardRef = useRef(null);
  const copyResetRef = useRef(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const [invoiceImage, setInvoiceImage] = useState('');
  const [invoiceStatus, setInvoiceStatus] = useState('');
  // Brief "Copied" confirmation shown on the adaptive Bank action.
  const [bankCopied, setBankCopied] = useState(false);
  // Client-facing payment selector. Defaults to Bank Transfer for
  // unpaid invoices; initialised from the invoice's resolved method
  // when it loads so an invoice explicitly saved as QR still opens on
  // QR. The client can freely switch between Bank and QR — this only
  // toggles the on-screen payment helper, never the totals.
  const [payMethod, setPayMethod] = useState('bank');

  const [expandedService, setExpandedService] = useState(null);
  const [fullScreenPreviewOpen, setFullScreenPreviewOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const touchStartDistRef = useRef(0);
  const touchStartScaleRef = useRef(1);
  const previewContainerRef = useRef(null);

  // Reset scale when fullscreen preview closes
  useEffect(() => {
    if (!fullScreenPreviewOpen) {
      setScale(1);
    }
  }, [fullScreenPreviewOpen]);

  // Non-passive pinch-to-zoom event listeners
  useEffect(() => {
    const el = previewContainerRef.current;
    if (!el) return;

    const handleTouchStart = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        touchStartDistRef.current = dist;
        touchStartScaleRef.current = scale;
      }
    };

    const handleTouchMove = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const factor = dist / touchStartDistRef.current;
        const nextScale = Math.max(1, Math.min(4, touchStartScaleRef.current * factor));
        setScale(nextScale);
      }
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
    };
  }, [fullScreenPreviewOpen, scale]);

  useEffect(() => {
    if (expandedService === null) return;
    function handleDocumentClick() {
      setExpandedService(null);
    }
    document.addEventListener('click', handleDocumentClick);
    return () => {
      document.removeEventListener('click', handleDocumentClick);
    };
  }, [expandedService]);
  const links = (payload?.links || []).filter((item) => item?.url);
  const linkMap = new Map(links.map((link) => [String(link.service || '').toLowerCase(), link]));
  const services = [
    { key: 'gd', aliases: ['gd', 'drive', 'google drive'], fallback: 'Google Drive', icon: 'GD' },
    { key: 'db', aliases: ['db', 'dropbox'], fallback: 'Dropbox', icon: 'DB' },
    { key: 'wt', aliases: ['wt', 'wetransfer', 'we transfer'], fallback: 'WeTransfer', icon: 'WT' },
  ];

  async function track(service) {
    if (!delivery.id || !service) return;
    fetch('/api/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliveryId: delivery.id, service }),
    }).catch(() => {});
  }

  async function openInvoice(event) {
    event.preventDefault();
    setInvoiceOpen(true);
    setInvoiceImage('');
    setInvoiceStatus('Opening invoice...');
    try {
      const response = await fetch(`/api/public-invoice?slug=${encodeURIComponent(slug)}`, {
        credentials: 'same-origin',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Invoice not found.');
      setInvoice(data.invoice);
      setPayMethod(resolvePaymentMethod(data.invoice));
      setInvoiceStatus('Rendering invoice...');
    } catch (error) {
      setInvoice(null);
      setInvoiceStatus(error.message || 'Invoice unavailable.');
    }
  }

  useEffect(() => {
    let alive = true;
    if (!invoiceOpen || !invoice || !invoiceRenderRef.current) return undefined;

    async function renderInvoiceImage() {
      if (document.fonts?.ready) {
        try { await document.fonts.ready; } catch {}
      }
      try {
        const canvas = await html2canvas(invoiceRenderRef.current, {
          backgroundColor: '#ffffff',
          scale: 1,
          useCORS: true,
          allowTaint: true,
          imageTimeout: 0,
          logging: false,
          windowWidth: 3000,
          windowHeight: 9000,
        });
        if (!alive) return;
        setInvoiceImage(canvas.toDataURL('image/jpeg', 0.95));
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

  // QR action: export the off-screen payment card (brand + QR + amount
  // due) to a JPG and download it. Reuses the html2canvas that already
  // renders the invoice. Falls back to downloading the raw static QR
  // asset if the card capture fails. Never generates a dynamic QR.
  async function downloadQrCard() {
    const node = qrCardRef.current;
    if (!node) {
      triggerImageDownload(payQrSrc, 'starshots-payment-qr.jpg');
      return;
    }
    try {
      if (document.fonts?.ready) {
        try { await document.fonts.ready; } catch {}
      }
      const canvas = await html2canvas(node, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        allowTaint: true,
        imageTimeout: 0,
        logging: false,
      });
      triggerImageDownload(canvas.toDataURL('image/jpeg', 0.95), 'starshots-payment-qr.jpg');
    } catch {
      triggerImageDownload(payQrSrc, 'starshots-payment-qr.jpg');
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

  // Client-facing payment area (unpaid invoices only). The on-screen
  // selector lets the client switch between Bank Transfer (default)
  // and the saved/static QR image; the downloadable JPG document
  // defaults to Bank Transfer too (see resolvePaymentMethod). Totals
  // are unchanged — we only read the already-computed deposit / full
  // payment due. A `paid` invoice never shows this panel (the JPG
  // keeps its PAID stamp/receipt instead).
  const invoiceStatusValue = String(invoice?.status || 'invoice').toLowerCase();
  const showPaymentPanel = !!invoice && invoiceStatusValue !== 'paid';
  const paymentDue = paymentDueInfo(invoice);
  const payQrSrc = invoiceQrSrc(invoice);

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

        <a
          className={`public-delivery-invoice${String(payload?.invoice?.status || '').toLowerCase() === 'paid' ? ' is-paid' : ''}`}
          href="#invoice"
          onClick={openInvoice}
        >
          <span className="public-delivery-invoice-icon" aria-hidden="true">INV</span>
          <span className="public-delivery-invoice-label">Invoice</span>
          <span className="public-delivery-invoice-cta">{String(payload?.invoice?.status || '').toLowerCase() === 'paid' ? 'Paid' : 'View'}</span>
        </a>

        <p className="public-delivery-subcopy">Choose your preferred delivery option below</p>
        <div className="public-delivery-list">
          {resolvedServices.map(({ key, fallback, icon, link }) => {
            const url = link?.url || '';
            const name = link?.label || fallback;
            const isDone = link ? !!link.link_done : false;
            const hasEventDate = !!payload?.delivery?.eventDate;

            if (url && isDone) {
              return (
                <a
                  key={fallback}
                  className="public-delivery-row is-active"
                  href={url}
                  onClick={() => track(link.service || key)}
                  rel="noopener"
                  target="_blank"
                >
                  <span className="public-delivery-icon">{icon}</span>
                  <span className="public-delivery-name">{name}</span>
                  <span className="public-delivery-state">Click</span>
                </a>
              );
            } else if (url && !isDone) {
              const isExpanded = expandedService === fallback;
              return (
                <div key={fallback} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button
                    type="button"
                    className={`public-delivery-row is-disabled in-progress${isExpanded ? ' is-expanded' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedService(isExpanded ? null : fallback);
                    }}
                    style={{ cursor: 'pointer' }}
                    aria-expanded={isExpanded}
                  >
                    <span className="public-delivery-icon">{icon}</span>
                    <span className="public-delivery-name">{name}</span>
                    <span className="public-delivery-state">IN PROGRESS</span>
                  </button>
                  {isExpanded && (
                    <div
                      className="public-delivery-eta-note"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Your files are currently being prepared and are estimated to be available within 5 days after the event.
                    </div>
                  )}
                </div>
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

        <p className="public-delivery-signoff">With love, StarShots</p>
      </section>

      {invoiceOpen ? (
        <div className="public-invoice-viewer" role="dialog" aria-modal="true" aria-label="Invoice preview">
          <div className="public-invoice-viewer-card">
            {/* Desktop Toolbar (hidden on mobile) */}
            <header className="public-invoice-viewer-toolbar desktop-only-header">
              <strong>Invoice</strong>
              <div className="public-invoice-viewer-actions">
                {showPaymentPanel ? (
                  payMethod === 'bank' ? (
                    <button
                      type="button"
                      className="public-invoice-action public-invoice-action--primary"
                      onClick={copyBankAccount}
                    >
                      <IconCopy />
                      <span>{bankCopied ? 'Copied' : 'Copy Bank Account'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="public-invoice-action public-invoice-action--primary"
                      onClick={downloadQrCard}
                    >
                      <IconDownload />
                      <span>Download QR</span>
                    </button>
                  )
                ) : null}
                {invoiceImage ? (
                  <a
                    className="public-invoice-action public-invoice-action--ghost"
                    href={invoiceImage}
                    download={`${String(delivery.clientName || 'client').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'client'}-invoice.jpg`}
                  >
                    <IconDownload />
                    <span>Download Invoice</span>
                  </a>
                ) : null}
                <button
                  type="button"
                  className="public-invoice-action public-invoice-action--ghost"
                  onClick={() => setInvoiceOpen(false)}
                >
                  Close
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
              {/* Desktop Frame (hidden on mobile) */}
              <div className="public-invoice-frame desktop-only-frame">
                {invoiceImage ? (
                  <img src={invoiceImage} alt="Invoice JPG" />
                ) : (
                  <p>{invoiceStatus || 'Rendering invoice...'}</p>
                )}
              </div>

              {/* Mobile View Invoice Row / Trigger (hidden on desktop) */}
              <div className="public-invoice-mobile-preview-container mobile-only-preview">
                <button
                  type="button"
                  className="public-invoice-mobile-preview-trigger"
                  onClick={() => setFullScreenPreviewOpen(true)}
                >
                  <div className="public-invoice-mobile-preview-thumbnail">
                    {invoiceImage ? (
                      <img src={invoiceImage} alt="Invoice Thumbnail" />
                    ) : (
                      <div className="thumbnail-placeholder">📄</div>
                    )}
                  </div>
                  <div className="public-invoice-mobile-preview-info">
                    <strong>View Full Invoice</strong>
                    <span>Pinch to zoom & pan the full sheet</span>
                  </div>
                  <div className="public-invoice-mobile-preview-arrow">
                    <IconEye />
                  </div>
                </button>

                {/* Mobile actions (Copy Bank Account / Download QR, and Download Invoice) */}
                <div className="public-invoice-mobile-actions">
                  {showPaymentPanel ? (
                    payMethod === 'bank' ? (
                      <button
                        type="button"
                        className="public-invoice-action public-invoice-action--primary"
                        onClick={copyBankAccount}
                      >
                        <IconCopy />
                        <span>{bankCopied ? 'Copied' : 'Copy Bank Account'}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="public-invoice-action public-invoice-action--primary"
                        onClick={downloadQrCard}
                      >
                        <IconDownload />
                        <span>Download QR</span>
                      </button>
                    )
                  ) : null}

                  {invoiceImage ? (
                    <a
                      className="public-invoice-action public-invoice-action--small"
                      href={invoiceImage}
                      download={`${String(delivery.clientName || 'client').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'client'}-invoice.jpg`}
                    >
                      <IconDownload />
                      <span>Download Invoice</span>
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
                  <div className="public-pay-switch" role="radiogroup" aria-label="Payment method">
                    {[{ value: 'bank', label: 'Bank' }, { value: 'qr', label: 'QR' }].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={payMethod === option.value}
                        className={`public-pay-option${payMethod === option.value ? ' is-active' : ''}`}
                        onClick={() => setPayMethod(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="public-pay-body">
                    {payMethod === 'qr' ? (
                      <img className="public-pay-qr" src={payQrSrc} alt="Payment QR" />
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
          {invoice ? (
            <div className="invoice-export-host public-invoice-render-host" aria-hidden="true">
              <div ref={invoiceRenderRef}>
                <PublicInvoiceDocument invoice={invoice} />
              </div>
            </div>
          ) : null}
          {showPaymentPanel ? (
            <div className="invoice-export-host public-pay-card-host" aria-hidden="true">
              <div ref={qrCardRef} className="public-pay-card">
                <img className="public-pay-card-logo" src="/logo-hero.png" alt="StarShots" />
                <p className="public-pay-card-kicker">Payment QR</p>
                <img className="public-pay-card-qr" src={payQrSrc} alt="Payment QR" />
                <div className="public-pay-card-due">
                  <span>{paymentDue.label}</span>
                  <strong>{rupiah(paymentDue.amount)}</strong>
                </div>
                <p className="public-pay-card-meta">
                  {BANK_DETAILS.bank} · {BANK_DETAILS.accountNumber} · {BANK_DETAILS.accountHolderLabel}
                </p>
                <p className="public-pay-card-foot">Scan to pay · StarShots ID</p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Mobile Fullscreen Zoomable Invoice Preview Modal */}
      {fullScreenPreviewOpen ? (
        <div className="public-invoice-fullscreen" role="dialog" aria-modal="true" aria-label="Fullscreen invoice preview">
          <header className="public-invoice-fullscreen-header">
            <button className="public-invoice-fullscreen-btn" onClick={() => setFullScreenPreviewOpen(false)}>
              <IconClose />
            </button>
            <button className="public-invoice-fullscreen-btn" onClick={() => setScale(1)}>
              Fit
            </button>
            {invoiceImage ? (
              <a
                className="public-invoice-fullscreen-btn"
                href={invoiceImage}
                download={`${String(delivery.clientName || 'client').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'client'}-invoice.jpg`}
              >
                <IconDownload />
                <span>Download Invoice</span>
              </a>
            ) : null}
          </header>
          <div className="public-invoice-fullscreen-body" ref={previewContainerRef}>
            {invoiceImage ? (
              <img
                src={invoiceImage}
                alt="Invoice Preview"
                className={`public-invoice-fullscreen-img${scale > 1 ? ' is-zoomed' : ''}`}
                style={{
                  '--scale': scale,
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
