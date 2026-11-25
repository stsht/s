import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInvoiceData, calculateInvoiceLedger } from './invoiceLedger.js';

const item = (price, discount = 0, qty = 1) => ({ qty, price, discount });
const payment = (id, amount, status = 'confirmed', type = 'deposit') => ({ id, amount, status, type });

test('1. legacy DP plus final settlement derives actual 3M + 7M cash events', () => {
  const data = normalizeInvoiceData({ depositPayments: [{ id: 'dp-1', paid: true, amount: 3_000_000 }], paidReceipt: { paid: true, amount: 10_000_000 } }, { status: 'paid', grand_total: 10_000_000, paid_amount: 10_000_000 });
  assert.deepEqual(data.payments.map(({ id, amount, status }) => ({ id, amount, status })), [
    { id: 'dp-1', amount: 3_000_000, status: 'confirmed' },
    { id: 'paid-receipt', amount: 7_000_000, status: 'confirmed' },
  ]);
  const ledger = calculateInvoiceLedger({ items: [item(10_000_000)], ...data }, { status: 'paid', grand_total: 10_000_000, paid_amount: 10_000_000 });
  assert.equal(ledger.totalConfirmedPayments, 10_000_000);
  assert.equal(ledger.balanceDue, 0);
});

test('2. multiple legacy installments retain each stable ID and sum once', () => {
  const data = normalizeInvoiceData({ depositPayments: [
    { id: 'dp-a', paid: true, amount: 2_000_000 },
    { id: 'dp-b', paid: true, amount: 3_000_000 },
    { id: 'dp-c', paid: true, amount: 5_000_000 },
  ] }, { status: 'deposit', grand_total: 10_000_000, paid_amount: 10_000_000 });
  assert.deepEqual(data.payments.map((p) => p.id), ['dp-a', 'dp-b', 'dp-c']);
  assert.equal(calculateInvoiceLedger({ items: [item(10_000_000)], ...data }).totalConfirmedPayments, 10_000_000);
});

test('3. partial payment followed by cancellation credit leaves a balance due', () => {
  const ledger = calculateInvoiceLedger({ items: [item(10_000_000)], payments: [payment('p1', 5_000_000)], adjustments: [{ id: 'cancel-1', type: 'credit', amount: 3_000_000, status: 'confirmed' }] });
  assert.equal(ledger.netBillableTotal, 7_000_000);
  assert.equal(ledger.balanceDue, 2_000_000);
});

test('4. full payment then cancellation and completed refund retains only the fee', () => {
  const ledger = calculateInvoiceLedger({ items: [item(10_000_000)], payments: [payment('p1', 10_000_000)], adjustments: [{ id: 'cancel', type: 'credit', amount: 8_000_000, status: 'confirmed' }], refunds: [{ id: 'r1', amount: 8_000_000, status: 'completed' }] });
  assert.equal(ledger.netBillableTotal, 2_000_000);
  assert.equal(ledger.netCashReceived, 2_000_000);
  assert.equal(ledger.refundableCredit, 0);
});

test('5. only completed partial refunds reduce net cash received', () => {
  const ledger = calculateInvoiceLedger({ items: [item(10_000_000)], payments: [payment('p1', 10_000_000)], refunds: [{ id: 'r1', amount: 2_000_000, status: 'completed' }, { id: 'r2', amount: 1_000_000, status: 'pending' }] });
  assert.equal(ledger.totalCompletedRefunds, 2_000_000);
  assert.equal(ledger.totalPendingRefunds, 1_000_000);
  assert.equal(ledger.netCashReceived, 8_000_000);
});

test('6. multiple completed refunds accumulate without altering original payments', () => {
  const ledger = calculateInvoiceLedger({ items: [item(10_000_000)], payments: [payment('p1', 10_000_000)], refunds: [{ id: 'r1', amount: 1_000_000, status: 'completed' }, { id: 'r2', amount: 2_000_000, status: 'completed' }] });
  assert.equal(ledger.netCashReceived, 7_000_000);
  assert.equal(ledger.totalConfirmedPayments, 10_000_000);
});

test('7. overpayment is surfaced as refundable credit, not silently lost', () => {
  const ledger = calculateInvoiceLedger({ items: [item(10_000_000)], payments: [payment('p1', 12_000_000)] });
  assert.equal(ledger.refundableCredit, 2_000_000);
  assert.equal(ledger.balanceDue, 0);
});

test('8. item discounts take precedence over duplicated invoice-level legacy discount', () => {
  const ledger = calculateInvoiceLedger({ items: [item(1_500_000, 300_000), item(500_000, 0, 2)], discount: 300_000 });
  assert.equal(ledger.subtotal, 2_500_000);
  assert.equal(ledger.discountTotal, 300_000);
  assert.equal(ledger.netBillableTotal, 2_200_000);
  assert.equal(ledger.discountSource, 'items');
});

test('9. repeated reschedule history survives normalization unchanged', () => {
  const history = [{ id: 'rs1', from: '2026-01-01', to: '2026-01-02' }, { id: 'rs2', from: '2026-01-02', to: '2026-01-03' }];
  const data = normalizeInvoiceData({ rescheduleHistory: history });
  assert.deepEqual(data.rescheduleHistory, history);
});

test('10. multi-session metadata survives ledger normalization', () => {
  const sessions = [{ id: 's1', title: 'Akad' }, { id: 's2', title: 'Resepsi' }];
  const data = normalizeInvoiceData({ sessions });
  assert.deepEqual(data.sessions, sessions);
});

test('11. legacy single-session invoice remains valid without inventing sessions', () => {
  const data = normalizeInvoiceData({ items: [item(1_000_000)], depositPayments: [] }, { status: 'invoice', grand_total: 1_000_000 });
  assert.deepEqual(data.sessions, undefined);
  assert.equal(calculateInvoiceLedger(data, { grand_total: 1_000_000 }).netBillableTotal, 1_000_000);
});

test('12. pending payments and unpaid legacy DP rows do not count as cash', () => {
  const data = normalizeInvoiceData({ depositPayments: [{ id: 'dp-paid', paid: true, amount: 200_000 }, { id: 'dp-pending', paid: false, amount: 300_000 }] }, { status: 'deposit', grand_total: 1_000_000, paid_amount: 200_000 });
  const ledger = calculateInvoiceLedger({ items: [item(1_000_000)], ...data });
  assert.equal(ledger.totalConfirmedPayments, 200_000);
  assert.equal(ledger.totalPendingPayments, 300_000);
  assert.equal(ledger.balanceDue, 800_000);
});

test('13. legacy paidReceipt without DP maps to deterministic paid-receipt ID', () => {
  const data = normalizeInvoiceData({ paidReceipt: { paid: true, amount: 850_000, paidAtDate: '2026-11-16' } }, { status: 'paid', grand_total: 850_000, paid_amount: 850_000 });
  assert.equal(data.payments[0].id, 'paid-receipt');
  assert.equal(data.payments[0].amount, 850_000);
  assert.equal(data.payments[0].status, 'confirmed');
});

test('14. normalization is idempotent across three consecutive passes', () => {
  const source = { discount: 100_000, items: [item(1_000_000, 100_000)], depositPayments: [{ id: 'dp-1', paid: true, amount: 200_000 }], paidReceipt: { paid: true, amount: 900_000 }, refunds: [], adjustments: [] };
  const row = { status: 'paid', grand_total: 900_000, paid_amount: 900_000 };
  const once = normalizeInvoiceData(source, row);
  const twice = normalizeInvoiceData(once, row);
  const thrice = normalizeInvoiceData(twice, row);
  assert.deepEqual(twice, once);
  assert.deepEqual(thrice, once);
  assert.equal(calculateInvoiceLedger({ ...once, items: source.items }, row).totalConfirmedPayments, 900_000);
});

test('15. zero-value legacy settlement marker preserves paid-receipt ID without double counting', () => {
  const data = normalizeInvoiceData({ depositPayments: [{ id: 'dp-1', paid: true, amount: 1_000_000 }], paidReceipt: { paid: true, amount: 1_000_000 } }, { status: 'paid', grand_total: 1_000_000, paid_amount: 1_000_000 });
  assert.equal(data.payments[1].id, 'paid-receipt');
  assert.equal(data.payments[1].amount, 0);
  assert.equal(data.payments[1].status, 'superseded');
  assert.equal(calculateInvoiceLedger({ items: [item(1_000_000)], ...data }).totalConfirmedPayments, 1_000_000);
});

test('16. pending adjustments do not change the billable total', () => {
  const ledger = calculateInvoiceLedger({ items: [item(1_000_000)], adjustments: [{ id: 'a1', type: 'credit', amount: 200_000, status: 'pending' }] });
  assert.equal(ledger.netBillableTotal, 1_000_000);
});

 
test('17. canonical payment without an explicit confirmation remains pending', () => {
  const ledger = calculateInvoiceLedger({ items: [item(1_000_000)], payments: [{ id: 'p-unknown', amount: 500_000 }] });
  assert.equal(ledger.totalConfirmedPayments, 0);
  assert.equal(ledger.totalPendingPayments, 500_000);
  assert.equal(ledger.balanceDue, 1_000_000);
});
