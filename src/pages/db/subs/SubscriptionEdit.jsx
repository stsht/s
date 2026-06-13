import { useEffect, useState } from 'react';
import { Combobox, DateTimeField } from '../../../components/ui/index.js';
import { onBlurTitleCase } from '../../../utils/titleCase.js';
import { selectAllIfZero, parseMoneyInput } from '../../../utils/moneyInput.js';
import { ProofField } from '../ProofField.jsx';
import { SUBSCRIPTION_STATUS_OPTIONS } from '../dbHelpers.js';
import {
  applySubscriptionDraftUpdate,
  subscriptionToDraft,
} from './subscriptionEditDrafts.js';

const TITLE_OPTIONS = ['Mr.', 'Ms.', 'Mrs.', 'Family'];

// Right-panel "Edit Subscription" flow for /db Subs. Shares the same
// editable form shape as SubscriptionImport's preview step, but
// prefilled from a saved subscription row and wired straight to
// /api/subscriptions-save with the row's id so saving updates the
// existing row instead of inserting. On success the parent swaps
// the right panel back to the read-only detail view.
//
// Doubles as the "New Subscription" composer when invoked with no
// `subscription` prop (or a freshly-shaped empty draft). In create
// mode the heading, eyebrow, and submit-button copy switch over and
// the save POST flows through the same /api/subscriptions-save
// endpoint without an `id`, so the worker treats it as an insert.
// Subs/Clients separation is preserved server-side: handleSubscription
// Save explicitly does not auto-create a public.clients row from a
// subscription save (see comment block in _worker.js), so manual
// creation here keeps the two systems independent.
export function SubscriptionEdit({ subscription, onSaved, onCancel, mode = 'edit' }) {
  const id = String(subscription?.id || '');
  const isCreate = mode === 'create' || !id;
  const [draft, setDraft] = useState(() => subscriptionToDraft(subscription || {}));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState('');

  // If the parent re-selects a different subscription while this
  // form is still mounted (rare, but possible after a refetch where
  // the same client now points at a different subscription row),
  // re-seed the draft so the inputs reflect the new row.
  useEffect(() => {
    setDraft(subscriptionToDraft(subscription || {}));
    setStatus('');
    setStatusTone('');
  }, [subscription?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function setField(key, value) {
    setDraft((current) => applySubscriptionDraftUpdate(current, key, value));
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!String(draft.client_name || '').trim()) {
      setStatus('Client name is required.');
      setStatusTone('error');
      return;
    }
    if (!String(draft.service || '').trim()) {
      setStatus('Service is required.');
      setStatusTone('error');
      return;
    }
    setBusy(true);
    setStatus('Saving…');
    setStatusTone('');
    try {
      const payload = { ...draft };
      if (id) payload.id = id;
      const response = await fetch('/api/subscriptions-save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: payload, id: id || undefined }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(json.error || `Save failed (${response.status}).`);
      }
      // Hand the freshly-saved row back to the parent so it can
      // refetch the list and route the right panel back to the
      // (now updated) detail view in one transition.
      onSaved?.(json.subscription || null);
    } catch (error) {
      setStatus(error?.message || 'Save failed.');
      setStatusTone('error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Subscription</p>
          <h2>{isCreate ? 'New Subscription' : 'Edit Subscription'}</h2>
          <span>
            {isCreate
              ? 'Fill in the details and Save to add a subscription. This does not create a Clients record.'
              : 'Update the saved fields and Save to apply changes.'}
          </span>
        </div>
        <div className="detail-actions">
          <button
            type="button"
            className="db-close-button"
            onClick={onCancel}
            aria-label={isCreate ? 'Cancel new subscription' : 'Cancel edit'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      <form className="form-stack" onSubmit={handleSave}>
        <div className="two-col">
          <label>Title
            <Combobox
              value={draft.client_title}
              options={TITLE_OPTIONS}
              placeholder="Title"
              ariaLabel="Subscription client title"
              onChange={(value) => setField('client_title', value)}
            />
          </label>
          <label>Client Name
            <input
              value={draft.client_name}
              onChange={(e) => setField('client_name', e.target.value)}
              onBlur={onBlurTitleCase((v) => setField('client_name', v))}
              placeholder="Client name"
            />
          </label>
        </div>
        <label>Service
          <input
            value={draft.service}
            onChange={(e) => setField('service', e.target.value)}
            placeholder="ChatGPT, iCloud, Google Drive…"
          />
        </label>
        <div className="two-col">
          <label>Status
            <Combobox
              value={draft.status}
              options={SUBSCRIPTION_STATUS_OPTIONS}
              placeholder="Status"
              ariaLabel="Subscription status"
              onChange={(value) => setField('status', value)}
            />
          </label>
          <label>Access Period (Days)
            <input
              type="number"
              min="0"
              value={draft.access_period}
              onChange={(e) => setField('access_period', Number(e.target.value) || 0)}
            />
          </label>
        </div>
        <label>Bonus (Days)
          <input
            type="number"
            min="0"
            step="1"
            value={draft.bonus}
            onFocus={selectAllIfZero}
            onChange={(e) => setField('bonus', Number(e.target.value) || 0)}
            aria-label="Subscription bonus days"
          />
        </label>
        <label>Payment
          <DateTimeField
            value={draft.payment_date}
            onChange={(value) => setField('payment_date', value)}
            timeValue={draft.payment_time}
            onTimeChange={(value) => setField('payment_time', value)}
            withTime
            ariaLabel="Payment date and time"
          />
        </label>
        <label>Start
          <DateTimeField
            value={draft.start_date}
            onChange={(value) => setField('start_date', value)}
            timeValue={draft.start_time}
            onTimeChange={(value) => setField('start_time', value)}
            withTime
            ariaLabel="Start date and time"
          />
        </label>
        <label>Expiry
          <DateTimeField
            value={draft.expiry_date}
            onChange={(value) => setField('expiry_date', value)}
            timeValue={draft.expiry_time}
            onTimeChange={(value) => setField('expiry_time', value)}
            withTime
            ariaLabel="Expiry date and time"
          />
        </label>
        <label>Price (IDR)
          <input
            type="text"
            inputMode="numeric"
            // Show a real "0" when no price is set (not just a
            // placeholder) so the field reads as a concrete value;
            // selectAllIfZero selects that "0" on focus so the first
            // keystroke replaces it cleanly, and parseMoneyInput
            // collapses any leading zero on the way back in.
            value={String(Number(draft.price) || 0)}
            placeholder="0"
            onFocus={selectAllIfZero}
            onChange={(e) => setField('price', parseMoneyInput(e.target.value))}
            aria-label="Subscription price in rupiah"
          />
        </label>
        <ProofField
          value={draft.payment_proof}
          onChange={(v) => setField('payment_proof', v)}
          ariaLabel="Subscription payment proof"
        />
        {status ? (
          <p className={`download-status${statusTone ? ` lg-status-${statusTone}` : ''}`}>{status}</p>
        ) : null}
        <div className="client-actions">
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? 'Saving…' : (isCreate ? 'Create Subscription' : 'Save Subscription')}
          </button>
          <button className="ghost-button compact" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </>
  );
}
