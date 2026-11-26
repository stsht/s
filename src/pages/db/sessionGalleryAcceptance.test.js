import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClientRecords } from './dbHelpers.js';
import { bookingDeliveryState, eventGroupIsSettled } from './vendorStatus.js';

const client = { id: 'client-1', name: 'Ayu' };
const sessions = [
  { id: 'ses-1', title: 'Akad', date: '2026-12-01' },
  { id: 'ses-2', title: 'Resepsi', date: '2026-12-01' },
];
const invoice = {
  id: 'inv-1', client_id: 'client-1', client_name: 'Ayu', client_title: 'Ms.',
  event_key: 'booking-1', event_date: '2026-12-01', status: 'paid',
  invoice_data: { sessions },
};
const delivery = (id, session_id, delivery_done, extra = {}) => ({
  id, client_id: 'client-1', client_name: 'Ayu', title: 'Ms.',
  event_key: 'booking-1', event_date: '2026-12-01',
  session_id, delivery_done, ...extra,
});

test('1. shared booking gallery (session_id NULL) groups with one invoice and covers sessions only when done', () => {
  const [group] = buildClientRecords(client, [invoice], [delivery('shared', null, true)], '2026-11-26');
  assert.equal(group.invoice.id, 'inv-1');
  assert.equal(group.delivery.id, 'shared');
  assert.equal(group.deliveries.length, 1);
  assert.equal(bookingDeliveryState({ ...group, sessions }), 'delivered');
  assert.equal(bookingDeliveryState({ ...group, sessions, deliveries: [delivery('shared', null, false)] }), 'processing');
});

test('2. dedicated session deliveries remain in one booking group and complete independently', () => {
  const rows = [delivery('d1', 'ses-1', true), delivery('d2', 'ses-2', true)];
  const [group] = buildClientRecords(client, [invoice], rows, '2026-11-26');
  assert.equal(group.deliveries.length, 2);
  assert.equal(group.delivery.id, 'd1');
  assert.equal(bookingDeliveryState({ ...group, sessions }), 'delivered');
  assert.equal(bookingDeliveryState({ ...group, sessions, deliveries: [rows[0], { ...rows[1], delivery_done: false }] }), 'partial');
});

test('3. mixed dedicated and shared mode never lets shared completion override unfinished dedicated delivery', () => {
  const dedicatedDone = delivery('d1', 'ses-1', true);
  const dedicatedPending = delivery('d2', 'ses-2', false);
  const sharedDone = delivery('shared', null, true);
  assert.equal(bookingDeliveryState({ sessions, deliveries: [dedicatedDone, dedicatedPending, sharedDone] }), 'partial');
  assert.equal(bookingDeliveryState({ sessions, deliveries: [dedicatedDone, sharedDone] }), 'delivered');
  assert.equal(bookingDeliveryState({ sessions, deliveries: [dedicatedDone, { ...sharedDone, delivery_done: false }] }), 'partial');
});

test('4. legacy single-session NULL delivery keeps delivery alias; same-day keyless deliveries never merge', () => {
  const legacy = { id: 'legacy', client_id: 'client-1', client_name: 'Ayu', title: 'Ms.', event_date: '2026-12-01', session_id: null, delivery_done: true };
  const [single] = buildClientRecords(client, [], [legacy], '2026-11-26');
  assert.equal(single.delivery.id, 'legacy');
  assert.equal(single.deliveries[0].id, 'legacy');

  const morning = { ...legacy, id: 'morning' };
  const afternoon = { ...legacy, id: 'afternoon' };
  const groups = buildClientRecords(client, [], [morning, afternoon], '2026-11-26');
  assert.equal(groups.length, 2);
  assert.deepEqual(new Set(groups.map((g) => g.delivery.id)), new Set(['morning', 'afternoon']));
});

test('5. vendor delivery remains booking-level and never changes client delivery state', () => {
  const clientDelivery = delivery('client-gallery', 'ses-1', true);
  const vendorDelivery = {
    id: 'vendor-gallery', client_id: 'client-1', client_name: 'Ayu',
    event_key: 'booking-1', event_date: '2026-12-01', type: 'vendor',
    session_id: null, delivery_done: false,
  };
  const [group] = buildClientRecords(client, [invoice], [clientDelivery, vendorDelivery], '2026-11-26');
  assert.equal(group.deliveries.length, 1);
  assert.equal(group.vendorDelivery.id, 'vendor-gallery');
  assert.equal(bookingDeliveryState({ ...group, sessions }), 'partial');
  assert.equal(eventGroupIsSettled({ ...group, sessions, invoice: { ...invoice, status: 'paid' } }), false);
  assert.equal(eventGroupIsSettled({
    ...group, sessions, delivery: { ...clientDelivery, delivery_done: true },
    deliveries: [{ ...clientDelivery, delivery_done: true }],
    vendorDelivery: { ...vendorDelivery, delivery_done: true },
    invoice: { ...invoice, status: 'paid' },
  }), true);
});
