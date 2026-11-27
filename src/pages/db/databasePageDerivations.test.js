import test from 'node:test';
import assert from 'node:assert/strict';
import { applyClientListStatus, buildSortedCrmClients } from './databasePageDerivations.js';

const today = '2026-11-27';

function settledGroup(eventDate = today) {
  return {
    eventDate,
    delivery: { id: 'delivery-1', delivery_done: true, type: 'client' },
    deliveries: [{ id: 'delivery-1', delivery_done: true, type: 'client' }],
    invoice: { id: 'invoice-1', status: 'paid', payment_proofs: [{ id: 'proof-1', status: 'confirmed', image_url: 'proof.jpg' }] },
  };
}

test('same-day event moves to neutral past bucket when delivery, payment and proofs are complete', () => {
  const result = applyClientListStatus({
    classification: { bucket: 'upcoming', tone: 'soon', sortKey: today, representativeDate: today },
    groups: [settledGroup()],
    todayIso: today,
  });
  assert.equal(result.bucket, 'past');
  assert.equal(result.tone, '');
});

test('same-day event remains upcoming when delivery is not complete', () => {
  const group = settledGroup();
  group.delivery.delivery_done = false;
  group.deliveries[0].delivery_done = false;
  const result = applyClientListStatus({
    classification: { bucket: 'upcoming', tone: 'soon', sortKey: today, representativeDate: today },
    groups: [group],
    todayIso: today,
  });
  assert.equal(result.bucket, 'upcoming');
  assert.equal(result.tone, 'soon');
});

test('same-day event remains upcoming when a payment proof is pending', () => {
  const group = settledGroup();
  group.invoice.payment_proofs[0].status = 'pending';
  const result = applyClientListStatus({
    classification: { bucket: 'upcoming', tone: 'soon', sortKey: today, representativeDate: today },
    groups: [group],
    todayIso: today,
  });
  assert.equal(result.bucket, 'upcoming');
});

test('same-day completed event stays upcoming when the client has a future event', () => {
  const result = applyClientListStatus({
    classification: { bucket: 'upcoming', tone: 'soon', sortKey: today, representativeDate: today },
    groups: [settledGroup(today), settledGroup('2026-12-05')],
    todayIso: today,
  });
  assert.equal(result.bucket, 'upcoming');
});

test('buildSortedCrmClients loads settlement groups for clients whose nearest event is today', () => {
  const clients = [{ id: 'client-1', name: 'Alya', invoice_count: 1, delivery_count: 1 }];
  const invoices = [{
    id: 'invoice-1', client_id: 'client-1', client_name: 'Alya', event_key: 'booking-1',
    event_date: today, status: 'paid',
    payment_proofs: [{ id: 'proof-1', status: 'confirmed', image_url: 'proof.jpg' }],
  }];
  const deliveriesAll = [{
    id: 'delivery-1', client_id: 'client-1', client_name: 'Alya', event_key: 'booking-1',
    event_date: today, delivery_done: true, type: 'client',
  }];
  const result = buildSortedCrmClients({
    crmClients: clients,
    eventDatesByClient: () => [today],
    invoices,
    deliveriesAll,
    todayIso: today,
  });
  assert.equal(result[0].bucket, 'past');
  assert.equal(result[0].tone, '');
});
