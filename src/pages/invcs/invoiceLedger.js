const SCHEMA_VERSION = 2;
const LEGACY_SESSION_ID = 'legacy-session';

function money(value) {
  if (value === null || value === undefined || value === '') return 0;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function hasMoney(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function confirmed(payment) {
  return String(payment?.status || '').toLowerCase() === 'confirmed';
}

function paymentDateParts(payment) {
  const date = String(payment?.paidAtDate ?? payment?.paid_at_date ?? '').trim();
  const time = String(payment?.paidAtTime ?? payment?.paid_at_time ?? '').trim();
  const timeMatch = /^(\d{2}:\d{2})/.exec(time);
  return {
    paidAtDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    paidAtTime: timeMatch ? timeMatch[1] : '',
  };
}

function normalizeCanonicalPayment(payment, index) {
  const source = asObject(payment);
  const dateParts = paymentDateParts(source);
  const status = String(source.status || (source.paid === true ? 'confirmed' : 'pending')).toLowerCase();
  return {
    ...source,
    id: String(source.id || 'legacy-payment-' + (index + 1)),
    amount: money(source.amount),
    status,
    type: String(source.type || source.kind || 'payment').toLowerCase(),
    ...dateParts,
  };
}

function normalizeLegacyDepositPayment(payment, index) {
  const source = asObject(payment);
  const dateParts = paymentDateParts(source);
  return {
    ...source,
    id: String(source.id || 'legacy-deposit-' + (index + 1)),
    amount: money(source.amount),
    status: source.paid === false ? 'pending' : 'confirmed',
    type: 'deposit',
    source: 'legacy-depositPayments',
    legacy: true,
    ...dateParts,
  };
}

function normalizeSession(session, index) {
  const source = asObject(session);
  return {
    ...source,
    id: String(source.id || 'session-' + (index + 1)),
    title: String(source.title || 'Session ' + (index + 1)),
    date: String(source.date || ''),
    startTime: String(source.startTime || ''),
    endTime: String(source.endTime || ''),
    venue: String(source.venue || ''),
    status: String(source.status || 'active'),
    rescheduledFrom: source.rescheduledFrom ?? null,
    notes: String(source.notes || ''),
  };
}

function createLegacySession(invoiceData, invoiceRow) {
  return normalizeSession({
    id: LEGACY_SESSION_ID,
    title: 'Session 1',
    date: invoiceRow.event_date || invoiceRow.eventDate || invoiceData.eventDate || invoiceData.event_date || '',
    startTime: invoiceData.eventTime || invoiceRow.event_time || invoiceRow.eventTime || '',
    endTime: '',
    venue: invoiceData.venue || invoiceRow.venue || '',
    status: 'active',
    rescheduledFrom: null,
    notes: '',
  }, 0);
}

function normalizeAdjustment(adjustment, index) {
  const source = asObject(adjustment);
  return {
    ...source,
    id: String(source.id || 'legacy-adjustment-' + (index + 1)),
    amount: money(source.amount),
    status: String(source.status || 'confirmed').toLowerCase(),
  };
}

function normalizeRefund(refund, index) {
  const source = asObject(refund);
  const hasRefundDate = Boolean(source.refundedAtDate || source.refundedAt || source.completedAt);
  return {
    ...source,
    id: String(source.id || 'legacy-refund-' + (index + 1)),
    amount: Math.abs(money(source.amount)),
    status: String(source.status || (hasRefundDate ? 'completed' : 'pending')).toLowerCase(),
  };
}

function firstMoney(...values) {
  const value = values.find(hasMoney);
  return value === undefined ? 0 : money(value);
}

/**
 * Return a new schema-v2 invoice_data object without mutating the input.
 * Accepts either (invoice_data, invoiceRow) or a complete invoice row.
 * Existing canonical payments always win over legacy payment fields.
 */
export function normalizeInvoiceData(invoiceDataOrRow, invoiceRow = {}) {
  let source = asObject(invoiceDataOrRow);
  let row = asObject(invoiceRow);
  if (Object.keys(row).length === 0 && source.invoice_data && typeof source.invoice_data === 'object') {
    row = source;
    source = asObject(source.invoice_data);
  }

  const normalized = { ...source };
  const existingSessions = asArray(source.sessions);
  const sessions = existingSessions.length
    ? existingSessions.map(normalizeSession)
    : [createLegacySession(source, row)];
  normalized.sessions = sessions;

  const fallbackSessionId = String(sessions[0]?.id || LEGACY_SESSION_ID);
  normalized.items = asArray(source.items).map((item) => {
    const entry = asObject(item);
    return entry.sessionId || entry.session_id
      ? { ...entry, sessionId: String(entry.sessionId || entry.session_id) }
      : { ...entry, sessionId: fallbackSessionId };
  });

  if (Array.isArray(source.payments)) {
    normalized.payments = source.payments.map(normalizeCanonicalPayment);
  } else {
    const deposits = asArray(source.depositPayments).map(normalizeLegacyDepositPayment);
    const payments = [...deposits];
    const receipt = asObject(source.paidReceipt);
    const rowStatus = String(row.status || source.status || '').toLowerCase();

    // Legacy paidReceipt.amount is a settlement snapshot (usually the whole
    // invoice total), not necessarily the amount of the last transfer.
    // Subtract paid DP rows to derive the actual final cash event.
    if (rowStatus === 'paid' && receipt.paid !== false) {
      const paidDeposits = deposits.reduce(
        (sum, payment) => sum + (confirmed(payment) ? payment.amount : 0),
        0,
      );
      const totalPaid = firstMoney(row.paid_amount, row.paidAmount, row.grand_total, row.grandTotal, receipt.amount);
      const finalAmount = Math.max(0, totalPaid - paidDeposits);
      const dateParts = paymentDateParts(receipt);
      payments.push({
        id: 'paid-receipt',
        amount: finalAmount,
        status: finalAmount > 0 ? 'confirmed' : 'superseded',
        type: finalAmount > 0 ? (paidDeposits > 0 ? 'final' : 'full') : 'settlement_marker',
        source: 'legacy-paidReceipt',
        legacy: true,
        legacyTotalAmount: firstMoney(receipt.amount, totalPaid),
        ...dateParts,
      });
    }

    normalized.payments = payments;
  }

  normalized.adjustments = asArray(source.adjustments).map(normalizeAdjustment);
  normalized.refunds = asArray(source.refunds).map(normalizeRefund);
  normalized.schemaVersion = SCHEMA_VERSION;
  return normalized;
}

function itemTotals(invoiceData) {
  const items = asArray(invoiceData.items);
  if (!items.length) return null;

  let subtotal = 0;
  let itemDiscountTotal = 0;
  for (const itemValue of items) {
    const item = asObject(itemValue);
    const qty = hasMoney(item.qty) && Number(item.qty) !== 0 ? Number(item.qty) : 1;
    const price = Math.max(0, money(item.price));
    const gross = Math.max(0, Math.round(qty * price));
    const rawDiscount = money(item.discount ?? item.discount_amount);
    subtotal += gross;
    itemDiscountTotal += Math.min(gross, Math.max(0, rawDiscount));
  }

  const hasItemDiscount = itemDiscountTotal > 0;
  const discountTotal = hasItemDiscount
    ? itemDiscountTotal
    : Math.max(0, money(invoiceData.discount));
  return {
    subtotal,
    discountTotal,
    originalValue: subtotal,
    originalBillableTotal: Math.max(0, subtotal - discountTotal),
    discountSource: hasItemDiscount ? 'items' : (discountTotal > 0 ? 'legacy-invoice' : 'none'),
  };
}

function adjustmentDelta(adjustment) {
  const status = String(adjustment?.status || 'confirmed').toLowerCase();
  if (['pending', 'cancelled', 'canceled', 'voided', 'rejected'].includes(status)) return 0;
  const amount = money(adjustment.amount);
  const type = String(adjustment.type || adjustment.kind || '').toLowerCase();

  // Blueprint adjustments use signed amounts. Positive legacy "credit" and
  // discount entries are also accepted as reductions for compatibility.
  if (amount > 0 && ['credit', 'discount', 'reduction', 'write_off', 'write-off', 'cancellation_credit'].includes(type)) return -amount;
  return amount;
}

/** Pure financial projection for an invoice. All values are integer IDR. */
export function calculateInvoiceLedger(invoiceData, invoiceRow = {}) {
  const isCompleteRow = Object.keys(asObject(invoiceRow)).length === 0
    && invoiceData?.invoice_data
    && typeof invoiceData.invoice_data === 'object';
  const row = isCompleteRow ? asObject(invoiceData) : asObject(invoiceRow);
  const data = isCompleteRow ? row.invoice_data : invoiceData;
  const normalized = normalizeInvoiceData(data, row);
  const items = itemTotals(normalized);
  const fallbackTotal = Math.max(0, firstMoney(row.grand_total, row.grandTotal, normalized.grandTotal, normalized.grand_total));
  const base = items || {
    subtotal: fallbackTotal + Math.max(0, money(normalized.discount)),
    discountTotal: Math.max(0, money(normalized.discount)),
    originalValue: fallbackTotal + Math.max(0, money(normalized.discount)),
    originalBillableTotal: fallbackTotal,
    discountSource: fallbackTotal > 0 ? 'row-grand-total' : 'none',
  };

  const totalConfirmedPayments = normalized.payments.reduce(
    (sum, payment) => sum + (confirmed(payment) ? money(payment.amount) : 0),
    0,
  );
  const totalPendingPayments = normalized.payments.reduce(
    (sum, payment) => sum + (String(payment.status || '').toLowerCase() === 'pending' ? money(payment.amount) : 0),
    0,
  );
  const totalCompletedRefunds = normalized.refunds.reduce(
    (sum, refund) => sum + (String(refund.status || '').toLowerCase() === 'completed' ? Math.max(0, money(refund.amount)) : 0),
    0,
  );
  const totalPendingRefunds = normalized.refunds.reduce(
    (sum, refund) => sum + (String(refund.status || '').toLowerCase() === 'pending' ? Math.max(0, money(refund.amount)) : 0),
    0,
  );
  const totalAdjustments = normalized.adjustments.reduce((sum, adjustment) => sum + adjustmentDelta(adjustment), 0);
  const netBillableTotal = Math.max(0, base.originalBillableTotal + totalAdjustments);
  const netCashReceived = totalConfirmedPayments - totalCompletedRefunds;
  const balanceDue = Math.max(0, netBillableTotal - netCashReceived);
  const refundableCredit = Math.max(0, netCashReceived - netBillableTotal);

  return {
    subtotal: base.subtotal,
    discountTotal: base.discountTotal,
    originalValue: base.originalValue,
    originalBillableTotal: base.originalBillableTotal,
    discountSource: base.discountSource,
    totalAdjustments,
    netBillableTotal,
    totalConfirmedPayments,
    totalPendingPayments,
    totalCompletedRefunds,
    totalPendingRefunds,
    netCashReceived,
    balanceDue,
    refundableCredit,
    isSettled: balanceDue === 0,
  };
}

export const INVOICE_LEDGER_SCHEMA_VERSION = SCHEMA_VERSION;
