// PreviewPanel — the right-hand /inv Live Preview column and the
// invoice document artboard, extracted verbatim from
// InvoiceComposer.jsx (Pass 61). It owns only self-contained preview
// concerns: a local previewCanvasRef + previewMetrics state and a
// ResizeObserver-driven fit-to-width scaling effect. The invoice
// document `documentRef`, the JPG export (downloadJpg), and the
// save/delete actions remain owned by InvoiceComposer and are passed
// in as props — this component just renders markup and invokes those
// prop callbacks. Markup, class names, props, ref behaviour, and the
// scaling/export behaviour are unchanged.

import { useEffect, useRef, useState } from 'react';
import { toTitleCase, maybeTitleCase } from '../../utils/titleCase.js';
import { SaveIcon, PrinterIcon, TrashIcon } from './invoicePrimitives.jsx';
import { BANK_DETAILS, PAYMENT_QR_SRC, INVOICE_PREVIEW_WIDTH, INVOICE_PREVIEW_MIN_HEIGHT } from './invoiceConstants.js';
import { cleanPaymentMethod, rupiah, isFullPayment, prettyDate, prettyDateTime, clampItemDiscount } from './invoiceFormat.js';

// Toolbar icons for the Live Preview header. Same minimalist 2D
// stroke-only family as the /db Subs detail toolbar (viewBox 0 0 24
// 24, fill:none, stroke:currentColor, round caps/joins, className
// "btn-icon") so the two surfaces read as one icon system. They pick
// up the parent .toolbar-icon-btn's currentColor for hover/disabled
// palettes without per-icon overrides.

export function PreviewPanel({ mode, clientName, title, contact, venue, eventDate, issuedDate, eventTime, items, totals, depositPayments, depositAskOpen, balanceDue, requestedDue, paymentMethod, paidConfirmed, paidAtDate, paidAtTime, status, documentRef, downloadJpg, saveInvoice, deleteInvoice, deletingInvoice, confirmDeleteInvoice, saving, savedId, hydrating, invoiceType }) {
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
                  <span>Deposit Paid on {prettyDateTime(payment.paidAtDate, payment.paidAtTime)}</span>
                  <strong>{rupiah(payment.amount)}</strong>
                </p>
              ))}
              <p className="grand"><span>Grand Total</span><strong>{rupiah(totals.grandTotal)}</strong></p>
              {mode === 'paid' && paidConfirmed ? (
                <p className="paid-in-full-row"><span>{paidDeposits.length ? 'Full Payment on' : 'Fully Paid on'} {prettyDateTime(paidAtDate, paidAtTime)}</span><strong>{rupiah(paidDeposits.length ? balanceDue : totals.grandTotal)}</strong></p>
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
