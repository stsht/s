const SCHEMA_VERSION = 2;

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
  const status = String(source.status || (source.paid === false ? 'pending' : 'confirmed')).toLowerCase();
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

function firstMoney(...values) {
  const value = values.find(hasMoney);
  return value === undefined ? 0 : money(value);
}

/**
 * Return a new schema-v2 invoice_data object without mutating the input.
 * Existing canonical payments always win over legacy payment fields, so
 * calling this repeatedly cannot duplicate a migrated deposit or receipt.
 */
export function normalizeInvoiceData(invoiceData, invoiceRow = {}) {
  const source = asObject(invoiceData);
  const row = asObject(invoiceRow);
  const normalized = { ...source };

  if (Array.isArray(source.payments)) {
    normalized.payments = source.payments.map(normalizeCanonicalPayment);
  } else {
    const deposits = asArray(source.depositPayments).map(normalizeLegacyDepositPayment);
    const payments = [...deposits];
    const receipt = asObject(source.paidReceipt);
    const rowStatus = String(row.status || source.status || '').toLowerCase();

    // Legacy paidReceipt.amount is a settlement snapshot (usually the
    // whole invoice total), not necessarily the amount of the last transfer.
    // Subtract already-recorded paid deposits to derive the final cash event.
    // Keep the deterministic ID even when deposits already cover the total;
    // in that case it is a zero-value superseded marker, not new cash.
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

  normalized.adjustments = asArray(source.adjustments).map((entry) => ({ ...asObject(entry) }));
  normalized.refunds = asArray(source.refunds).map((entry) => ({ ...asObject(entry) }));
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
  if (String(adjustment?.status || '').toLowerCase() !== 'confirmed') return 0;
  const amount = Math.max(0, money(adjustment.amount));
  const type = String(adjustment.type || adjustment.kind || '').toLowerCase();
  if (['credit', 'discount', 'reduction', 'write_off', 'write-off', 'cancellation_credit'].includes(type)) return -amount;
  if (['charge', 'fee', 'addition', 'increase'].includes(type)) return amount;
  return 0;
}

/** Pure financial projection for an invoice. All values are integer IDR. */
export function calculateInvoiceLedger(invoiceData, invoiceRow = {}) {
  const normalized = normalizeInvoiceData(invoiceData, invoiceRow);
  const row = asObject(invoiceRow);
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
