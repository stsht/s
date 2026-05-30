import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import html2canvas from 'html2canvas';
import { GlobalBackground } from '../../components/GlobalBackground.jsx';
import { toTitleCase } from '../../utils/titleCase.js';
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

function PublicInvoiceDocument({ invoice }) {
  const data = invoice?.invoice_data && typeof invoice.invoice_data === 'object' ? invoice.invoice_data : {};
  const items = invoiceItems(invoice);
  const status = String(invoice?.status || 'invoice').toLowerCase();
  const subtotal = items.reduce((sum, item) => sum + ((Number(item.qty) || 0) * (Number(item.price) || 0)), 0);
  const grandTotal = Math.max(0, Math.round(Number(invoice?.grand_total) || 0));
  const discount = Math.max(0, Math.round(Number(data.discount) || (subtotal - grandTotal) || 0));
  const paidDeposits = status === 'deposit'
    ? (Array.isArray(data.depositPayments) ? data.depositPayments : []).filter((payment) => payment?.paid)
    : [];
  const paidReceipt = data.paidReceipt && typeof data.paidReceipt === 'object' ? data.paidReceipt : {};
  const paymentMethod = String(data.paymentMethod || 'qr');
  const qrSrc = String(data.qrSrc || '/payment-qr.png');
  const dueLabel = isFullPayment(invoice) ? 'Full Payment Due' : 'Deposit Due';

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
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const [invoiceImage, setInvoiceImage] = useState('');
  const [invoiceStatus, setInvoiceStatus] = useState('');
  const links = (payload?.links || []).filter((item) => item?.url);
  const linkMap = new Map(links.map((link) => [String(link.service || '').toLowerCase(), link]));
  const services = [
    { key: 'gd', aliases: ['gd', 'drive', 'google drive'], fallback: 'Google Drive', icon: 'GD' },
    { key: 'db', aliases: ['db', 'dropbox'], fallback: 'Dropbox', icon: 'DB' },
    { key: 'wt', aliases: ['wt', 'wetransfer', 'we transfer'], fallback: 'WeTransfer', icon: 'WT' },
    { key: 'tn', aliases: ['tn', 'transfernow', 'transfer now'], fallback: 'TransferNow', icon: 'TN' },
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

  // Resolve each service to its stored link and keep ONLY the ones
  // that actually have a usable URL. Services without a link are not
  // rendered at all — no greyed-out "Unavailable" dead rows. This is
  // the single source of what the delivery list shows.
  const activeServices = services
    .map((service) => ({
      ...service,
      link: service.aliases.map((alias) => linkMap.get(alias)).find(Boolean),
    }))
    .filter((service) => !!service.link?.url);

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
          className="public-delivery-invoice"
          href="#invoice"
          onClick={openInvoice}
        >
          <span className="public-delivery-invoice-icon" aria-hidden="true">INV</span>
          <span className="public-delivery-invoice-label">Invoice</span>
          <span className="public-delivery-invoice-cta">View</span>
        </a>

        {activeServices.length > 0 ? (
          <>
            <p className="public-delivery-subcopy">Choose your preferred delivery option below</p>
            <div className="public-delivery-list">
              {activeServices.map(({ key, fallback, icon, link }) => (
                <a
                  key={fallback}
                  className="public-delivery-row is-active"
                  href={link.url}
                  onClick={() => track(link.service || key)}
                  rel="noopener"
                  target="_blank"
                >
                  <span className="public-delivery-icon">{icon}</span>
                  <span className="public-delivery-name">{link.label || fallback}</span>
                  <span className="public-delivery-state">Click</span>
                </a>
              ))}
            </div>
          </>
        ) : null}

        <p className="public-delivery-signoff">With love, StarShots</p>
      </section>

      {invoiceOpen ? (
        <div className="public-invoice-viewer" role="dialog" aria-modal="true" aria-label="Invoice preview">
          <div className="public-invoice-viewer-card">
            <header className="public-invoice-viewer-toolbar">
              <strong>Invoice</strong>
              <div>
                {invoiceImage ? (
                  <a
                    className="public-invoice-download"
                    href={invoiceImage}
                    download={`${String(delivery.clientName || 'client').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'client'}-invoice.jpg`}
                  >
                    Download
                  </a>
                ) : null}
                <button type="button" onClick={() => setInvoiceOpen(false)}>Close</button>
              </div>
            </header>
            <div className="public-invoice-frame">
              {invoiceImage ? (
                <img src={invoiceImage} alt="Invoice JPG" />
              ) : (
                <p>{invoiceStatus || 'Rendering invoice...'}</p>
              )}
            </div>
          </div>
          {invoice ? (
            <div className="invoice-export-host public-invoice-render-host" aria-hidden="true">
              <div ref={invoiceRenderRef}>
                <PublicInvoiceDocument invoice={invoice} />
              </div>
            </div>
          ) : null}
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

  // Auto-continue to the password gate exactly after 1 double-pulse cycle (4.0s)
  // only after both the page layout is ready AND the high-res logo has downloaded.
  useEffect(() => {
    if (isPageLoaded && isLogoLoaded && !revealed) {
      const timer = setTimeout(() => {
        handleReveal();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [isPageLoaded, isLogoLoaded, revealed]);

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
          <source media="(prefers-color-scheme: dark)" srcSet="/logo-pre-white.png" />
          <img 
            ref={logoRef}
            className={`gate-splash-logo ${(isPageLoaded && isLogoLoaded) ? 'is-loaded' : ''}`} 
            src="/logo-pre.png" 
            alt="StarShots" 
            width="1280"
            height="311"
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
