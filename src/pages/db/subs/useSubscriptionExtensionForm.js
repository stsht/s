import { useEffect, useState } from 'react';
import { addDays, todaySubs } from '../../../features/subscriptions/subscriptionUtils.js';
import { makeExtensionDraft, updateExtensionDraftField } from './subscriptionDrafts.js';

// Extension form state + save/delete logic for the Subs detail view.
//
// Extracted verbatim from SubscriptionDetail so the orchestrator stays
// focused on layout while this hook owns the renewal-history form. The
// /api payloads, field-mirroring behaviour, and seeded defaults are
// unchanged.
//
//   subscription    — the base subscription record
//   effective       — base + latest extension applied (drives the
//                     seeded Start/Expiry/Period for a new extension)
//   latestExtension — the most recent extension in the chain
//   onChanged       — refetch callback fired after a save/delete
export function useSubscriptionExtensionForm({ subscription, effective, latestExtension, onChanged }) {
  // ── Extensions state ───────────────────────────────────────────
  // Subs-side renewal history. Each extension is its own row in
  // public.subscription_extensions; the latest one drives the
  // Subs-list visible status/expiry. The base subscription's
  // own Payment / Start / Expiry stay as the receipt of record.
  const [extensionFormOpen, setExtensionFormOpen] = useState(false);
  const [editingExtensionId, setEditingExtensionId] = useState('');
  const [extensionDraft, setExtensionDraft] = useState(() => makeExtensionDraft(subscription, latestExtension, latestExtension));
  const [extensionBusy, setExtensionBusy] = useState(false);
  const [extensionStatus, setExtensionStatus] = useState('');
  const [extensionStatusTone, setExtensionStatusTone] = useState('');

  // Reset the extension form whenever the parent swaps to a
  // different subscription so it doesn't carry stale draft state
  // across rows.
  useEffect(() => {
    setExtensionFormOpen(false);
    setEditingExtensionId('');
    setExtensionDraft(makeExtensionDraft(subscription, latestExtension, latestExtension));
    setExtensionStatus('');
    setExtensionStatusTone('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscription?.id]);

  function setExtensionField(key, value) {
    setExtensionDraft((current) => updateExtensionDraftField(current, key, value));
  }

  function openAddExtension() {
    // Seed the new extension off the EFFECTIVE subscription so a
    // renewal chains to the latest known expiry. `effective`
    // already merges the latest extension into the base row (via
    // applySubscriptionExtension), so `effective.expiry_*` is
    // automatically:
    //   1. latest extension expiry, if any extension exists, else
    //   2. base subscription expiry, else
    //   3. empty — and we fall back to today.
    // See .kiro/steering/subscription-extensions.md for the full
    // requirement. Operators can still override every field.
    //
    // Price is resolved through the same cascade makeExtensionDraft
    // implements (latest extension price → base subscription price
    // aliases → 0) so a fresh extension inherits the most recent
    // known price without manual retyping. Bonus defaults to 0 for
    // a new extension; the operator can layer extra days on top.
    const seedDraft = makeExtensionDraft(subscription, null, latestExtension);
    const seedStart = effective?.expiry_date || todaySubs();
    const seedStartTime = effective?.expiry_date ? (effective?.expiry_time || '') : '';
    const period = Number(effective?.access_period) || 30;
    const bonus = 0;
    const seedExpiry = addDays(seedStart, period + bonus) || '';
    // Payment Date default follows the latest payment in the chain:
    // latest extension's payment date → base subscription's payment
    // date → today. seedDraft already resolves the cascade; we only
    // add today as a final fallback so a fresh extension never opens
    // with an empty Payment Date. The base (Initial) payment date is
    // never changed — this only seeds the NEW extension's default.
    const seedPaymentDate = seedDraft.payment_date || todaySubs();
    const seedPaymentTime = seedDraft.payment_date ? seedDraft.payment_time : '';
    setExtensionDraft({
      ...seedDraft,
      service: effective?.service || seedDraft.service || '',
      status: 'paid',
      access_period: period,
      bonus,
      start_date: seedStart,
      start_time: seedStartTime,
      expiry_date: seedExpiry,
      expiry_time: seedStartTime,
      payment_date: seedPaymentDate,
      payment_time: seedPaymentTime,
    });
    setEditingExtensionId('');
    setExtensionStatus('');
    setExtensionStatusTone('');
    setExtensionFormOpen(true);
  }

  function openEditExtension(ext) {
    setExtensionDraft(makeExtensionDraft(subscription, ext, latestExtension));
    setEditingExtensionId(String(ext?.id || ''));
    setExtensionStatus('');
    setExtensionStatusTone('');
    setExtensionFormOpen(true);
  }

  function closeExtensionForm() {
    setExtensionFormOpen(false);
    setEditingExtensionId('');
    setExtensionStatus('');
    setExtensionStatusTone('');
  }

  async function saveExtension(event) {
    event.preventDefault();
    if (!subscription?.id) return;
    setExtensionBusy(true);
    setExtensionStatus('Saving\u2026');
    setExtensionStatusTone('');
    try {
      const payload = {
        ...extensionDraft,
        subscription_id: subscription.id,
        ...(editingExtensionId ? { id: editingExtensionId } : {}),
      };
      const response = await fetch('/api/subscription-extensions-save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extension: payload }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(json.error || `Save failed (${response.status}).`);
      }
      setExtensionFormOpen(false);
      setEditingExtensionId('');
      setExtensionStatus('');
      onChanged?.();
    } catch (error) {
      setExtensionStatus(error?.message || 'Save failed.');
      setExtensionStatusTone('error');
    } finally {
      setExtensionBusy(false);
    }
  }

  async function deleteExtension(ext) {
    if (!ext?.id) return;
    try {
      const response = await fetch('/api/subscription-extensions-delete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ext.id }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(json.error || `Delete failed (${response.status}).`);
      }
      onChanged?.();
    } catch (error) {
      console.warn('[subs/ext] delete failed:', error);
    }
  }

  return {
    extensionFormOpen,
    editingExtensionId,
    extensionDraft,
    extensionBusy,
    extensionStatus,
    extensionStatusTone,
    setExtensionField,
    openAddExtension,
    openEditExtension,
    closeExtensionForm,
    saveExtension,
    deleteExtension,
  };
}
