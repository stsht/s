import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { compactEventDateLabel, jakartaTodayISO } from './dbHelpers.js';
import { invoicePaymentProofs, paymentState, vendorSummaryState } from './vendorStatus.js';
import { rupiah } from '../../utils/rupiah.js';
import './RecordRowPolish.css';

const SMART_REVIEW_STYLE_ID = 'ss-smart-payment-review-style';

function ensureSmartReviewStyles() {
  if (typeof document === 'undefined' || document.getElementById(SMART_REVIEW_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = SMART_REVIEW_STYLE_ID;
  style.textContent = `
    .payment-proof-viewer{
      z-index:10050 !important;
      padding:24px 16px !important;
    }
    .payment-proof-viewer-card{
      max-height:min(840px, calc(100dvh - 48px)) !important;
    }
    .payment-proof-viewer-head{
      padding:16px 20px !important;
    }
    .payment-proof-viewer-body{
      padding:16px 20px 24px !important;
      gap:16px !important;
    }
    .payment-proof-image-grid.is-single{
      grid-template-columns:minmax(0, 1fr);
    }
    .payment-proof-image-grid.is-single .payment-proof-image-item{
      max-width:360px;
    }
    .payment-proof-invoice-summary{
      display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;
      margin:16px 20px 0;padding:12px 16px;border:1px solid var(--line);border-radius:18px;background:var(--field);
    }
    .payment-proof-summary-metrics{
      display:flex;flex-wrap:wrap;gap:14px 20px;align-items:center;
    }
    .payment-proof-summary-metric{
      display:grid;gap:2px;
    }
    .payment-proof-summary-metric span{
      color:var(--muted);font-size:.66rem;font-weight:850;letter-spacing:.08em;text-transform:uppercase;
    }
    .payment-proof-summary-metric strong{
      color:var(--ink);font-size:.86rem;font-weight:900;font-variant-numeric:tabular-nums;
    }
    .payment-proof-reopen-btn{
      min-height:34px;padding:0 12px;border:1px solid var(--accent);border-radius:999px;
      background:color-mix(in srgb,var(--accent) 12%,var(--panel));color:var(--ink);
      font:inherit;font-size:.72rem;font-weight:850;cursor:pointer;white-space:nowrap;
    }
    .payment-proof-reopen-btn:disabled{opacity:.55;cursor:wait}
    .payment-proof-review-box{
      display:grid;gap:10px;margin-top:4px;padding:12px;border:1px solid var(--line);
      border-radius:16px;background:var(--panel);
    }
    .payment-proof-review-head{
      display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;
    }
    .payment-proof-review-title{
      color:var(--muted);font-size:.68rem;font-weight:900;letter-spacing:.1em;text-transform:uppercase;
    }
    .payment-proof-mode-badge{
      display:inline-flex;align-items:center;min-height:24px;padding:0 10px;border:1px solid var(--line);
      border-radius:999px;background:var(--field);color:var(--ink);font-size:.68rem;font-weight:900;
    }
    .payment-proof-review-grid{
      display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) minmax(0,.8fr);gap:8px;
    }
    @media(max-width:640px){
      .payment-proof-review-grid{grid-template-columns:1fr}
    }
    .payment-proof-field{
      display:grid;gap:4px;
    }
    .payment-proof-field span{
      color:var(--muted);font-size:.65rem;font-weight:850;letter-spacing:.06em;text-transform:uppercase;
    }
    .payment-proof-field input{
      width:100%;min-height:38px;padding:0 10px;border:1px solid var(--line);border-radius:11px;
      background:var(--field);color:var(--ink);font:inherit;font-size:.82rem;font-weight:800;
      font-variant-numeric:tabular-nums;box-sizing:border-box;
    }
    .payment-proof-quick-row{
      display:flex;flex-wrap:wrap;gap:6px;align-items:center;
    }
    .payment-proof-chip{
      min-height:28px;padding:0 10px;border:1px solid var(--line);border-radius:999px;
      background:var(--field);color:var(--ink);font:inherit;font-size:.7rem;font-weight:800;
      cursor:pointer;white-space:nowrap;
    }
    .payment-proof-chip:hover{border-color:var(--accent)}
    .payment-proof-chip.is-ocr{
      border-color:color-mix(in srgb,var(--accent) 45%,var(--line));
      background:color-mix(in srgb,var(--accent) 10%,var(--field));
    }
    .payment-proof-chip:disabled{opacity:.55;cursor:wait}
    .payment-proof-smart-banner{
      padding:8px 11px;border-radius:12px;border:1px solid var(--line);
      background:var(--field);color:var(--muted);font-size:.74rem;font-weight:800;line-height:1.4;
    }
    .payment-proof-smart-banner.is-dp{
      border-color:color-mix(in srgb,var(--accent) 45%,var(--line));
      background:color-mix(in srgb,var(--accent) 12%,var(--panel));
      color:var(--ink);
    }
    .payment-proof-smart-banner.is-paid{
      border-color:color-mix(in srgb,var(--success-state, #1f8a4c) 45%,var(--line));
      background:color-mix(in srgb,var(--success-state, #1f8a4c) 13%,var(--panel));
      color:var(--ink);
    }
    .payment-proof-smart-banner.is-warn{
      border-color:color-mix(in srgb,var(--danger, #c93b42) 55%,var(--line));
      background:color-mix(in srgb,var(--danger, #c93b42) 12%,var(--panel));
      color:var(--danger, #c93b42);
    }
    .payment-proof-review-actions{
      display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center;
    }
    .payment-proof-btn-confirm{
      flex:1 1 200px;min-height:38px;padding:0 14px;border:0;border-radius:999px;
      background:var(--ink);color:var(--panel);font:inherit;font-size:.76rem;font-weight:900;
      cursor:pointer;
    }
    .payment-proof-btn-confirm.is-paid{
      background:var(--success-state, #1f8a4c);color:#fff;
    }
    .payment-proof-btn-confirm:disabled{opacity:.45;cursor:not-allowed}
    .payment-proof-btn-reject{
      min-height:38px;padding:0 14px;border:1px solid color-mix(in srgb,var(--danger, #c93b42) 45%,var(--line));
      border-radius:999px;background:transparent;color:var(--danger, #c93b42);
      font:inherit;font-size:.74rem;font-weight:850;cursor:pointer;
    }
    .payment-proof-btn-reject:disabled{opacity:.5;cursor:not-allowed}
    .payment-proof-review-error{
      margin:0;color:var(--danger, #c93b42);font-size:.74rem;font-weight:800;
    }
    .payment-proof-review-locked{
      display:flex;flex-wrap:wrap;align-items:center;gap:8px;
      margin-top:4px;padding:10px 12px;border:1px solid var(--line);border-radius:13px;
      background:var(--field);color:var(--muted);font-size:.72rem;line-height:1.45;
    }
    .payment-proof-review-locked strong{
      color:var(--danger, #c93b42);font-size:.68rem;font-weight:900;
      letter-spacing:.06em;text-transform:uppercase;
    }
  `;
  document.head.appendChild(style);
}

export function DeleteIcon() {
  return (
    <svg className="row-delete-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg className="btn-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function PaperIcon() {
  return (
    <svg className="btn-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function PaymentIcon() {
  return (
    <svg className="btn-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h3" />
    </svg>
  );
}

function proofPaymentLabel(date, time) {
  const rawDate = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return '';
  const dateLabel = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric'
  }).format(new Date(`${rawDate}T12:00:00`));
  const timeMatch = /^(\d{2}):(\d{2})/.exec(String(time || ''));
  return timeMatch ? `${dateLabel} · ${timeMatch[1]}:${timeMatch[2]}` : dateLabel;
}

function proofAuditLabel(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function formatNumericInput(value) {
  const num = Math.max(0, Math.round(Number(String(value || '').replace(/[^\d]/g, '')) || 0));
  if (!num) return '';
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(num);
}

function parseNumericInput(value) {
  return Math.max(0, Math.round(Number(String(value || '').replace(/[^\d]/g, '')) || 0));
}

function computeInvoiceLedgerSummary(invoice = {}) {
  const data = invoice?.invoice_data && typeof invoice.invoice_data === 'object' ? invoice.invoice_data : {};
  const status = String(invoice?.status || 'invoice').toLowerCase();
  const grandTotal = Math.max(0, Math.round(Number(invoice?.grand_total || invoice?.total || invoice?.price) || 0));
  const depositDue = Math.max(0, Math.round(Number(invoice?.deposit_amount) || 0));
  const depositPayments = Array.isArray(data.depositPayments) ? data.depositPayments : [];
  const paidFromArray = depositPayments
    .filter((p) => p?.paid)
    .reduce((sum, p) => sum + Math.max(0, Math.round(Number(p.amount) || 0)), 0);
  const paidSoFar = status === 'paid'
    ? grandTotal
    : (paidFromArray > 0 ? paidFromArray : Math.max(0, Math.round(Number(invoice?.paid_amount) || 0)));
  const remainingBalance = status === 'paid'
    ? 0
    : Math.max(0, grandTotal - paidSoFar);
  const depositAskOpen = data.depositAskOpen !== false;
  return {
    invoiceId: String(invoice?.id || ''),
    status,
    grandTotal,
    depositDue,
    paidSoFar,
    remainingBalance,
    depositAskOpen,
  };
}

// Group multi-image uploads from the same client submission (identical uploadedAt timestamp)
// into a single Payment entry so a 3-screenshot upload is reviewed and confirmed once as 1 transaction.
export function groupProofEntriesBySubmission(entries = []) {
  const groups = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry) continue;
    const uploadedKey = String(entry.uploadedAt || '').trim();
    const groupKey = uploadedKey
      ? `batch:${uploadedKey}:${entry.paymentDate || ''}:${entry.paymentTime || ''}`
      : `single:${entry.id}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        ...entry,
        proofIds: [String(entry.id || '')].filter(Boolean),
        images: [...(Array.isArray(entry.images) ? entry.images : [])],
      });
    } else {
      const existing = groups.get(groupKey);
      if (entry.id && !existing.proofIds.includes(String(entry.id))) {
        existing.proofIds.push(String(entry.id));
      }
      for (const img of Array.isArray(entry.images) ? entry.images : []) {
        if (img && !existing.images.includes(img)) existing.images.push(img);
      }
      if (String(entry.status || '').toLowerCase() === 'confirmed') {
        existing.status = 'confirmed';
        existing.paymentProvisional = false;
      } else if (String(entry.status || '').toLowerCase() === 'rejected' && existing.status !== 'confirmed') {
        existing.status = 'rejected';
      }
    }
  }
  return [...groups.values()];
}

// Parse Indonesian bank / QRIS transfer receipt text from OCR into ranked IDR candidates.
export function extractReceiptAmountCandidates(rawText = '', summary = {}) {
  const text = String(rawText || '');
  if (!text.trim()) return [];
  const { grandTotal = 0, remainingBalance = 0, depositDue = 0 } = summary;
  const targets = [remainingBalance, depositDue, grandTotal].filter((n) => n > 0);
  const ignoredFees = new Set([2500, 6500, 7500, 1000, 1500]);
  const candidates = new Map();

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const cleanLine = line.trim();
    if (!cleanLine) continue;
    const hasMoneyKeyword = /(?:rp\b|idr\b|nominal|jumlah|total|amount|transfer|bayar|transaksi)/i.test(cleanLine);
    const matches = cleanLine.matchAll(/(?:rp\.?|idr)?\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d{5,9})(?!\d)/gi);
    for (const match of matches) {
      let token = String(match[1] || '').trim();
      token = token.replace(/[.,]\d{2}$/, '');
      const digits = token.replace(/[^\d]/g, '');
      if (digits.length < 5 || digits.length > 9) continue;
      const value = Number(digits);
      if (!Number.isFinite(value) || value < 10000 || ignoredFees.has(value)) continue;
      if (digits.length === 8 && /^202\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(digits)) continue;

      let score = hasMoneyKeyword ? 50 : 10;
      if (/(?:nominal|total|jumlah|amount)/i.test(cleanLine)) score += 30;
      if (/(?:rp|idr)/i.test(match[0] || '')) score += 25;
      for (const target of targets) {
        if (value === target) score += 200;
        else if (Math.abs(value - target) <= 999) score += 120;
      }
      if (grandTotal > 0 && value > grandTotal * 2) score -= 40;
      const prev = candidates.get(value) || -999;
      if (score > prev) candidates.set(value, score);
    }
  }

  return [...candidates.entries()]
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])
    .map(([value]) => value)
    .slice(0, 4);
}

// Strictly classify transfer amount against the invoice's remaining balance and DP request.
// Overpayments (> targetBalance) are blocked (canConfirm: false), and Full Paid vs Deposit
// is strictly determined by whether the transfer settles the remaining balance in full.
export function classifyTransferAmount(amount, summary = {}) {
  const cleanAmount = Math.max(0, Math.round(Number(amount) || 0));
  const { grandTotal = 0, depositDue = 0, paidSoFar = 0, remainingBalance = 0 } = summary;
  const targetBalance = remainingBalance > 0 ? remainingBalance : grandTotal;

  if (cleanAmount <= 0) {
    return {
      mode: 'deposit',
      tone: '',
      message: 'Verify the transfer amount from the receipt image before confirming.',
      canConfirm: false,
    };
  }

  if (targetBalance > 0 && cleanAmount > targetBalance) {
    const excess = cleanAmount - targetBalance;
    return {
      mode: 'invalid',
      tone: 'is-warn',
      message: `Blocked: Amount exceeds Balance Due (${rupiah(targetBalance)}) by ${rupiah(excess)}. Please check for extra zeroes.`,
      canConfirm: false,
    };
  }

  const isFullSettlement = targetBalance > 0 && cleanAmount === targetBalance;

  if (isFullSettlement) {
    let message = `Matches Full Invoice Total (${rupiah(targetBalance)}) → Marks Invoice PAID.`;
    if (paidSoFar === 0 && depositDue > 0 && depositDue < grandTotal && cleanAmount === grandTotal) {
      message = `Full Payment Upfront: Client transferred 100% (${rupiah(cleanAmount)}) instead of ${rupiah(depositDue)} DP → Marks Invoice PAID.`;
    } else if (paidSoFar > 0 && cleanAmount === targetBalance) {
      message = `Final Balance Settlement: Prior DP (${rupiah(paidSoFar)}) + This Transfer (${rupiah(cleanAmount)}) = ${rupiah(grandTotal)} → Marks Invoice PAID.`;
    }
    return {
      mode: 'paid',
      tone: 'is-paid',
      message,
      canConfirm: true,
    };
  }

  const nextBalance = Math.max(0, targetBalance - cleanAmount);
  const matchesDp = depositDue > 0 && cleanAmount === depositDue;
  const message = matchesDp
    ? `Matches DP Request (${rupiah(depositDue)}) → Records DP & sets Balance Due to ${rupiah(nextBalance)}.`
    : `Staged Deposit (${rupiah(cleanAmount)}) → Records DP & sets Balance Due to ${rupiah(nextBalance)}.`;

  return {
    mode: 'deposit',
    tone: 'is-dp',
    message,
    canConfirm: true,
  };
}

function eventPaymentProofs(row = {}, overrideInvoice = null) {
  const baseInvoices = overrideInvoice
    ? [overrideInvoice]
    : (Array.isArray(row?.paymentInvoices) && row.paymentInvoices.length
      ? row.paymentInvoices
      : (row?.invoice ? [row.invoice] : []));
  const seen = new Set();
  const rawList = baseInvoices
    .flatMap((invoice) => invoicePaymentProofs(invoice))
    .filter((entry) => {
      const key = String(entry?.id || entry?.images?.[0] || '').trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (Date.parse(a?.uploadedAt || '') || 0) - (Date.parse(b?.uploadedAt || '') || 0));
  return groupProofEntriesBySubmission(rawList);
}

function PaymentProofEntryReview({ entry, summary, onReviewed }) {
  const defaultAmount = useMemo(() => {
    if (summary.remainingBalance <= 0) return summary.grandTotal || 0;
    if (summary.paidSoFar === 0 && summary.depositDue > 0 && summary.depositDue <= summary.remainingBalance) {
      return summary.depositDue;
    }
    return summary.remainingBalance;
  }, [summary.remainingBalance, summary.grandTotal, summary.paidSoFar, summary.depositDue]);

  const [amountInput, setAmountInput] = useState(() => formatNumericInput(defaultAmount));
  const [paymentDate, setPaymentDate] = useState(() => {
    const raw = String(entry.paymentDate || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : jakartaTodayISO();
  });
  const [paymentTime, setPaymentTime] = useState(() => {
    const match = /^(\d{2}:\d{2})/.exec(String(entry.paymentTime || ''));
    return match ? match[1] : '12:00';
  });
  const [busyAction, setBusyAction] = useState('');
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrCandidates, setOcrCandidates] = useState([]);
  const [ocrNote, setOcrNote] = useState('');
  const [error, setError] = useState('');
  const [editingConfirmed, setEditingConfirmed] = useState(false);

  const entryStatus = String(entry.status || '').toLowerCase();
  const isConfirmed = entryStatus === 'confirmed';
  const isRejected = entryStatus === 'rejected';
  const numericAmount = parseNumericInput(amountInput);
  const classification = useMemo(
    () => classifyTransferAmount(numericAmount, summary),
    [numericAmount, summary]
  );

  if (isConfirmed && !editingConfirmed) {
    return (
      <div className="payment-proof-quick-row" style={{ justifyContent: 'space-between', marginTop: '4px' }}>
        <span style={{ color: 'var(--muted)', fontSize: '.74rem', fontWeight: 750 }}>
          Reconciled with invoice ledger.
        </span>
        <button
          type="button"
          className="payment-proof-chip"
          onClick={() => setEditingConfirmed(true)}
        >
          Edit Review
        </button>
      </div>
    );
  }

  if (isRejected) {
    return (
      <div className="payment-proof-review-locked" role="status">
        <strong>Proof rejected</strong>
        <span>This submission is closed. The client can upload a replacement proof.</span>
      </div>
    );
  }

  async function handleRunOcr() {
    const imageUrl = entry?.images?.[0];
    if (!imageUrl || ocrBusy) return;
    setOcrBusy(true);
    setError('');
    setOcrNote('Scanning receipt image...');
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js');
      const Tesseract = mod.default || mod;
      const result = await Tesseract.recognize(imageUrl, 'eng+ind');
      const rawText = result?.data?.text || '';
      const found = extractReceiptAmountCandidates(rawText, summary);
      setOcrCandidates(found);
      if (found.length > 0) {
        setAmountInput(formatNumericInput(found[0]));
        setOcrNote(`OCR detected ${rupiah(found[0])} — please verify before confirming.`);
      } else {
        setOcrNote('No clear Rupiah amount detected — please verify or type the amount manually.');
      }
    } catch {
      setOcrNote('OCR unavailable on this connection — please use the quick presets or type the amount.');
    } finally {
      setOcrBusy(false);
    }
  }

  async function submitReview(action) {
    if (!summary.invoiceId || !entry?.id || busyAction) return;
    if (action === 'confirm' && !classification.canConfirm) {
      setError('Please enter a valid transfer amount within the remaining balance due.');
      return;
    }
    setBusyAction(action);
    setError('');
    try {
      const response = await fetch('/api/payment-proof-review', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: summary.invoiceId,
          proofId: entry.id,
          proofIds: Array.isArray(entry.proofIds) && entry.proofIds.length ? entry.proofIds : [entry.id],
          action,
          mode: classification.mode,
          amount: numericAmount,
          paymentDate,
          paymentTime,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.error || `Review failed (${response.status}).`);
      }
      setEditingConfirmed(false);
      onReviewed?.(data);
    } catch (err) {
      setError(err?.message || 'Could not save payment review.');
    } finally {
      setBusyAction('');
    }
  }

  const dpPreset = summary.depositDue > 0 && summary.depositDue < summary.remainingBalance ? summary.depositDue : 0;
  const fullPreset = summary.remainingBalance > 0 ? summary.remainingBalance : summary.grandTotal;
  const modeLabel = classification.mode === 'paid'
    ? 'Auto Mode: Full Paid'
    : classification.mode === 'invalid'
      ? 'Blocked: Exceeds Balance'
      : 'Auto Mode: Deposit (DP)';

  return (
    <div className="payment-proof-review-box" aria-label="Smart payment reconciliation">
      <div className="payment-proof-review-head">
        <span className="payment-proof-review-title">Reconcile with Invoice</span>
        <span className="payment-proof-mode-badge">{modeLabel}</span>
      </div>

      <div className="payment-proof-review-grid">
        <label className="payment-proof-field">
          <span>Amount Received (IDR)</span>
          <input
            type="text"
            inputMode="numeric"
            value={amountInput}
            onChange={(e) => setAmountInput(formatNumericInput(e.target.value))}
            placeholder="e.g. 400.000"
          />
        </label>
        <label className="payment-proof-field">
          <span>Transfer Date</span>
          <input
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
          />
        </label>
        <label className="payment-proof-field">
          <span>Transfer Time</span>
          <input
            type="time"
            value={paymentTime}
            onChange={(e) => setPaymentTime(e.target.value)}
          />
        </label>
      </div>

      <div className="payment-proof-quick-row">
        {dpPreset > 0 ? (
          <button
            type="button"
            className="payment-proof-chip"
            onClick={() => setAmountInput(formatNumericInput(dpPreset))}
          >
            DP Request · {rupiah(dpPreset)}
          </button>
        ) : null}
        {fullPreset > 0 ? (
          <button
            type="button"
            className="payment-proof-chip"
            onClick={() => setAmountInput(formatNumericInput(fullPreset))}
          >
            {summary.paidSoFar > 0 ? 'Remaining Balance' : 'Full Total'} · {rupiah(fullPreset)}
          </button>
        ) : null}
        <button
          type="button"
          className="payment-proof-chip is-ocr"
          onClick={handleRunOcr}
          disabled={ocrBusy}
        >
          {ocrBusy ? 'Scanning Receipt…' : 'Scan Receipt (OCR)'}
        </button>
        {ocrCandidates.map((cand) => (
          <button
            key={cand}
            type="button"
            className="payment-proof-chip"
            onClick={() => setAmountInput(formatNumericInput(cand))}
          >
            OCR: {rupiah(cand)}
          </button>
        ))}
      </div>

      {ocrNote ? (
        <span style={{ color: 'var(--muted)', fontSize: '.7rem', fontWeight: 750 }}>{ocrNote}</span>
      ) : null}

      <div className={`payment-proof-smart-banner ${classification.tone}`}>
        {classification.message}
      </div>

      {error ? <p className="payment-proof-review-error">{error}</p> : null}

      <div className="payment-proof-review-actions">
        <button
          type="button"
          className={`payment-proof-btn-confirm${classification.mode === 'paid' ? ' is-paid' : ''}`}
          disabled={!classification.canConfirm || Boolean(busyAction)}
          onClick={() => submitReview('confirm')}
        >
          {busyAction === 'confirm'
            ? 'Saving to Invoice…'
            : classification.mode === 'paid'
              ? `Confirm Full Paid · ${rupiah(numericAmount)}`
              : `Confirm DP Paid · ${rupiah(numericAmount)}`}
        </button>
        <button
          type="button"
          className="payment-proof-btn-reject"
          disabled={Boolean(busyAction)}
          onClick={() => submitReview('reject')}
        >
          {busyAction === 'reject' ? 'Rejecting…' : 'Reject Proof'}
        </button>
        {isConfirmed && editingConfirmed ? (
          <button
            type="button"
            className="payment-proof-chip"
            onClick={() => setEditingConfirmed(false)}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}

function PaymentProofViewer({ entries, invoice, title = 'Payment Proof', onClose, onInvoiceUpdated }) {
  const [previewImage, setPreviewImage] = useState('');
  const [reopening, setReopening] = useState(false);

  useEffect(() => {
    ensureSmartReviewStyles();
  }, []);

  const summary = useMemo(() => computeInvoiceLedgerSummary(invoice), [invoice]);
  const totalImages = useMemo(
    () => entries.reduce((sum, entry) => sum + (Array.isArray(entry.images) ? entry.images.length : 0), 0),
    [entries]
  );

  async function handleReopenPaymentRequest() {
    if (!summary.invoiceId || reopening) return;
    setReopening(true);
    try {
      const response = await fetch('/api/payment-proof-review', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: summary.invoiceId,
          action: 'reopen_request',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.ok) {
        onInvoiceUpdated?.(data);
      }
    } finally {
      setReopening(false);
    }
  }

  const modalContent = (
    <div className="payment-proof-viewer" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="payment-proof-viewer-card" onClick={(event) => event.stopPropagation()}>
        <header className="payment-proof-viewer-head">
          <div>
            <p>{title}</p>
            <strong>{totalImages} image{totalImages !== 1 ? 's' : ''} · {entries.length} submission{entries.length !== 1 ? 's' : ''}</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="Close payment proofs">×</button>
        </header>

        {summary.invoiceId ? (
          <section className="payment-proof-invoice-summary" aria-label="Invoice balance summary">
            <div className="payment-proof-summary-metrics">
              <div className="payment-proof-summary-metric">
                <span>Grand Total</span>
                <strong>{rupiah(summary.grandTotal)}</strong>
              </div>
              <div className="payment-proof-summary-metric">
                <span>DP Request</span>
                <strong>{rupiah(summary.depositDue)}</strong>
              </div>
              <div className="payment-proof-summary-metric">
                <span>Paid So Far</span>
                <strong>{rupiah(summary.paidSoFar)}</strong>
              </div>
              <div className="payment-proof-summary-metric">
                <span>Balance Due</span>
                <strong>{rupiah(summary.remainingBalance)}</strong>
              </div>
            </div>
            {summary.status === 'deposit' && !summary.depositAskOpen && summary.remainingBalance > 0 ? (
              <button
                type="button"
                className="payment-proof-reopen-btn"
                onClick={handleReopenPaymentRequest}
                disabled={reopening}
              >
                {reopening ? 'Opening…' : 'Request Next Payment (Open Upload)'}
              </button>
            ) : null}
          </section>
        ) : null}

        <div className="payment-proof-viewer-body">
          {entries.map((entry, entryIndex) => (
            <section className="payment-proof-entry" key={entry.id || entryIndex}>
              <div className="payment-proof-entry-head">
                <strong>Payment {entryIndex + 1}{entry.images.length > 1 ? ` (${entry.images.length} photos)` : ''}</strong>
                <span className={`payment-proof-status is-${entry.status || 'pending'}`}>{entry.status || 'pending'}</span>
              </div>
              <dl className="payment-proof-entry-times">
                {proofPaymentLabel(entry.paymentDate, entry.paymentTime) ? (
                  <div>
                    <dt>Payment</dt>
                    <dd>{proofPaymentLabel(entry.paymentDate, entry.paymentTime)}{entry.paymentProvisional ? ' · Client reported' : ''}</dd>
                  </div>
                ) : null}
                {proofAuditLabel(entry.uploadedAt) ? <div><dt>Uploaded</dt><dd>{proofAuditLabel(entry.uploadedAt)}</dd></div> : null}
                {entry.reviewedAt && !entry.paymentProvisional && proofAuditLabel(entry.reviewedAt) ? (
                  <div><dt>Confirmed</dt><dd>{proofAuditLabel(entry.reviewedAt)}</dd></div>
                ) : null}
              </dl>
              <div className={`payment-proof-image-grid${entry.images.length === 1 ? ' is-single' : ''}`}>
                {entry.images.map((image, imageIndex) => (
                  <div className="payment-proof-image-item" key={`${entry.id || entryIndex}-${imageIndex}`}>
                    <button type="button" className="payment-proof-image-link" onClick={() => setPreviewImage(image)} aria-label={`View payment proof ${entryIndex + 1}.${imageIndex + 1}`}>
                      <img src={image} alt={`Payment proof ${entryIndex + 1}.${imageIndex + 1}`} />
                    </button>
                    <a className="payment-proof-save" href={image} download={entry.filename || `payment-proof-${entryIndex + 1}-${imageIndex + 1}.jpg`}>
                      Save Image
                    </a>
                  </div>
                ))}
              </div>
              {summary.invoiceId ? (
                <PaymentProofEntryReview
                  entry={entry}
                  summary={summary}
                  onReviewed={onInvoiceUpdated}
                />
              ) : null}
            </section>
          ))}
        </div>
        {previewImage ? (
          <div className="payment-proof-full-preview" role="dialog" aria-modal="true" aria-label="Payment proof full image" onClick={() => setPreviewImage('')}>
            <button type="button" onClick={() => setPreviewImage('')} aria-label="Close full payment proof">×</button>
            <img src={previewImage} alt="Payment proof full preview" onClick={(event) => event.stopPropagation()} />
          </div>
        ) : null}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}

export function RecordRow({
  recordKey,
  row,
  tone,
  eventLinkHref,
  eventInvoiceHref,
  eventVendorInvoiceHref,
  eventVendorDeliveryHref,
  onDelete,
  onViewLinks,
  armed = false,
}) {
  const [proofViewer, setProofViewer] = useState(null);
  const [vendorOpen, setVendorOpen] = useState(false);
  const [clientInvoiceOverride, setClientInvoiceOverride] = useState(null);
  const [vendorInvoiceOverride, setVendorInvoiceOverride] = useState(null);

  useEffect(() => {
    setClientInvoiceOverride(null);
    setVendorInvoiceOverride(null);
  }, [row?.invoice?.id, row?.invoice?.updated_at, row?.vendorInvoice?.id, row?.vendorInvoice?.updated_at]);

  const activeClientInvoice = clientInvoiceOverride || row.invoice || null;
  const activeVendorInvoice = vendorInvoiceOverride || row.vendorInvoice || null;

  const hasDelivery = !!row.delivery?.id;
  const hasInvoice = !!activeClientInvoice?.id;
  const hasVendorDelivery = !!row.vendorDelivery?.id;
  const hasVendorInvoice = !!activeVendorInvoice?.id;

  const baseDateText = compactEventDateLabel(row.eventDate);
  const dateText = row.sessionLabel ? `${baseDateText} · ${row.sessionLabel}` : baseDateText;
  const rawPrice = hasInvoice ? (activeClientInvoice.total || activeClientInvoice.grand_total || activeClientInvoice.price) : '';
  const priceNumber = Number(rawPrice) || 0;
  const priceText = priceNumber > 0 ? rupiah(priceNumber) : '';

  const deliveryDone = !!row.delivery?.delivery_done;
  const invoicePaid = String(activeClientInvoice?.status || '').toLowerCase() === 'paid';
  const vendorDeliveryDone = !!row.vendorDelivery?.delivery_done;
  const vendorInvoicePaid = String(activeVendorInvoice?.status || '').toLowerCase() === 'paid';

  const linkStateClass = hasDelivery ? (deliveryDone ? ' is-complete' : ' is-created') : '';
  const invoiceStateClass = hasInvoice ? (invoicePaid ? ' is-complete' : ' is-created') : '';
  const vendorLinkStateClass = hasVendorDelivery ? (vendorDeliveryDone ? ' is-complete' : ' is-created') : '';
  const vendorInvoiceStateClass = hasVendorInvoice ? (vendorInvoicePaid ? ' is-complete' : ' is-created') : '';

  const paymentProofs = eventPaymentProofs(row, clientInvoiceOverride);
  const vendorPaymentProofs = hasVendorInvoice ? groupProofEntriesBySubmission(invoicePaymentProofs(activeVendorInvoice)) : [];
  const invoiceData = activeClientInvoice?.invoice_data && typeof activeClientInvoice.invoice_data === 'object'
    ? activeClientInvoice.invoice_data
    : {};
  const askDpActive = String(activeClientInvoice?.status || '').toLowerCase() === 'deposit' && invoiceData.depositAskOpen !== false;
  const askOpenedAt = String(invoiceData.depositAskOpenedAt || '');
  const currentAskProofs = askDpActive && askOpenedAt
    ? paymentProofs.filter((proof) => !proof.uploadedAt || Date.parse(proof.uploadedAt) >= Date.parse(askOpenedAt))
    : paymentProofs;
  const currentAskPaymentState = paymentState(currentAskProofs);
  const paymentStateClass = askDpActive
    ? (currentAskPaymentState === ' is-rejected'
      ? ' is-rejected'
      : currentAskPaymentState === ' is-complete'
        ? ' is-complete'
        : ' is-created')
    : paymentState(paymentProofs);
  const vendorPaymentStateClass = paymentState(vendorPaymentProofs);
  const vendorSummaryStateClass = vendorSummaryState({
    ...row,
    invoice: activeClientInvoice,
    vendorInvoice: activeVendorInvoice,
  }).stateClass;

  const actionClass = (stateClass = '') => `record-row-link-anchor${stateClass} record-row-pill record-row-status-pill`;

  let rowTone = tone;
  if (deliveryDone) rowTone = '';
  else if (tone !== 'soon' && tone !== 'future') rowTone = 'past';
  const toneClass = rowTone ? `event-tone-${rowTone}` : '';

  function handleInvoiceAndProofUpdated(kind, data) {
    const baseInv = kind === 'vendor' ? activeVendorInvoice : activeClientInvoice;
    if (!baseInv) return;
    const updatedProofsList = Array.isArray(data?.proofs) && data.proofs.length
      ? data.proofs
      : (data?.proof ? [data.proof] : []);
    const updatedById = new Map(updatedProofsList.map((p) => [String(p?.id || ''), p]));
    const existingProofs = Array.isArray(baseInv.payment_proofs) ? baseInv.payment_proofs : [];
    const nextProofs = updatedById.size
      ? existingProofs.map((p) => {
          const patch = updatedById.get(String(p?.id || ''));
          return patch ? { ...p, ...patch } : p;
        })
      : existingProofs;
    const mergedInvoice = {
      ...baseInv,
      ...(data?.invoice || {}),
      payment_proofs: nextProofs,
    };
    if (kind === 'vendor') setVendorInvoiceOverride(mergedInvoice);
    else setClientInvoiceOverride(mergedInvoice);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ss:db-refresh'));
    }
  }

  const viewerKind = proofViewer?.kind || 'client';
  const viewerInvoice = viewerKind === 'vendor' ? activeVendorInvoice : activeClientInvoice;
  const viewerEntries = viewerKind === 'vendor' ? vendorPaymentProofs : paymentProofs;

  return (
    <>
      <article className={`record-row${toneClass ? ` ${toneClass}` : ''}`} data-key={recordKey}>
        <div className="record-row-meta">
          <span className={`event-date-pill${toneClass ? ` ${toneClass}` : ''}`}>{dateText}</span>
          {priceText ? <span className="record-row-price">{priceText}</span> : null}
        </div>

        <div className="record-row-action-group record-row-primary-actions" aria-label="Client actions">
          {hasDelivery ? (
            <button
              type="button"
              className={actionClass(linkStateClass)}
              title={deliveryDone ? 'Links complete' : 'Links'}
              onClick={(event) => {
                event.stopPropagation();
                onViewLinks?.(row.delivery);
              }}
            >
              <LinkIcon /> <span>Links</span>
            </button>
          ) : (
            <a className={actionClass()} href={eventLinkHref} target="_blank" rel="noopener noreferrer" title="Links">
              <LinkIcon /> <span>Links</span>
            </a>
          )}

          <a
            className={actionClass(invoiceStateClass)}
            href={eventInvoiceHref}
            target="_blank"
            rel="noopener noreferrer"
            title={invoicePaid ? 'Invoice fully paid' : 'Invoice'}
          >
            <PaperIcon /> <span>Invoice</span>
          </a>

          <button
            type="button"
            className={actionClass(paymentStateClass)}
            disabled={!paymentProofs.length}
            aria-disabled={!paymentProofs.length}
            title={paymentProofs.length ? 'Payments' : 'No payment proof'}
            onClick={(event) => {
              event.stopPropagation();
              if (paymentProofs.length) setProofViewer({ kind: 'client', title: 'Client Payment Proof' });
            }}
          >
            <PaymentIcon /> <span>Payments</span>
          </button>

          <button
            type="button"
            className={`record-row-link-anchor${vendorSummaryStateClass} record-row-pill record-row-vendor-toggle`}
            aria-expanded={vendorOpen}
            onClick={(event) => {
              event.stopPropagation();
              setVendorOpen((open) => !open);
            }}
          >
            <span>Vendor</span> <span aria-hidden="true">{vendorOpen ? '▴' : '▾'}</span>
          </button>
        </div>

        {vendorOpen ? (
          <div className="record-row-vendor-panel" role="group" aria-label="Vendor actions">
            {hasVendorDelivery ? (
              <button
                type="button"
                className={actionClass(vendorLinkStateClass)}
                title={vendorDeliveryDone ? 'Vendor links complete' : 'Vendor Links'}
                onClick={(event) => {
                  event.stopPropagation();
                  onViewLinks?.(row.vendorDelivery);
                }}
              >
                <LinkIcon /> <span>Links</span>
              </button>
            ) : (
              <a className={actionClass()} href={eventVendorDeliveryHref} target="_blank" rel="noopener noreferrer" title="Vendor Links">
                <LinkIcon /> <span>Links</span>
              </a>
            )}

            <a
              className={actionClass(vendorInvoiceStateClass)}
              href={eventVendorInvoiceHref}
              target="_blank"
              rel="noopener noreferrer"
              title={vendorInvoicePaid ? 'Vendor invoice fully paid' : 'Vendor Invoice'}
            >
              <PaperIcon /> <span>Invoice</span>
            </a>

            <button
              type="button"
              className={actionClass(vendorPaymentStateClass)}
              disabled={!vendorPaymentProofs.length}
              aria-disabled={!vendorPaymentProofs.length}
              title={vendorPaymentProofs.length ? 'Vendor Payments' : 'No vendor payment proof'}
              onClick={(event) => {
                event.stopPropagation();
                if (vendorPaymentProofs.length) setProofViewer({ kind: 'vendor', title: 'Vendor Payment Proof' });
              }}
            >
              <PaymentIcon /> <span>Payments</span>
            </button>
          </div>
        ) : null}

      </article>

      {proofViewer ? (
        <PaymentProofViewer
          title={proofViewer.title}
          entries={viewerEntries}
          invoice={viewerInvoice}
          onClose={() => setProofViewer(null)}
          onInvoiceUpdated={(data) => handleInvoiceAndProofUpdated(viewerKind, data)}
        />
      ) : null}
    </>
  );
}
