import { Combobox, DateTimeField } from '../../../components/ui/index.js';
import { selectAllIfZero, parseMoneyInput } from '../../../utils/moneyInput.js';
import { SUBSCRIPTION_STATUS_OPTIONS, ACCESS_PERIOD_OPTIONS } from '../dbHelpers.js';
import { ProofField } from '../ProofField.jsx';

// Inline new/edit extension form for the Subs detail view.
//
// Extracted verbatim from SubscriptionDetail. The draft state, field
// mirroring, and save handler all live in useSubscriptionExtensionForm
// (the parent owns the hook); this component only renders the form and
// forwards changes via setExtensionField / onSubmit / onCancel.
export function SubscriptionExtensionForm({
  editingExtensionId,
  extensionDraft,
  extensionBusy,
  extensionStatus,
  extensionStatusTone,
  servicePlaceholder,
  setExtensionField,
  onSubmit,
  onCancel,
}) {
  return (
    <form className="form-stack subs-extension-form" onSubmit={onSubmit}>
      <p className="subs-extension-form-eyebrow">
        {editingExtensionId ? 'Edit Extension' : 'New Extension'}
      </p>
      <label>Service
        <input
          value={extensionDraft.service}
          onChange={(e) => setExtensionField('service', e.target.value)}
          placeholder={servicePlaceholder || 'ChatGPT, iCloud, Google Drive\u2026'}
        />
      </label>
      <div className="two-col">
        <label>Status
          <Combobox
            value={extensionDraft.status}
            options={SUBSCRIPTION_STATUS_OPTIONS}
            placeholder="Status"
            ariaLabel="Extension status"
            onChange={(value) => setExtensionField('status', value)}
          />
        </label>
        <label>Access Period (Days)
          <Combobox
            value={String(extensionDraft.access_period)}
            options={[...ACCESS_PERIOD_OPTIONS, ...([7, 15, 30].includes(Number(extensionDraft.access_period))
              ? []
              : [{ value: String(extensionDraft.access_period), label: `${extensionDraft.access_period} (custom)` }])]}
            placeholder="Days"
            ariaLabel="Extension access period"
            onChange={(value) => setExtensionField('access_period', Number(value) || 0)}
          />
        </label>
      </div>
      <label>Bonus (Days)
        <input
          type="number"
          min="0"
          step="1"
          value={extensionDraft.bonus}
          onFocus={selectAllIfZero}
          onChange={(e) => setExtensionField('bonus', Number(e.target.value) || 0)}
          aria-label="Extension bonus days"
        />
      </label>
      <div className="two-col">
        <label>Start
          <DateTimeField
            value={extensionDraft.start_date}
            onChange={(value) => setExtensionField('start_date', value)}
            timeValue={extensionDraft.start_time}
            onTimeChange={(value) => setExtensionField('start_time', value)}
            withTime
            ariaLabel="Extension start"
          />
        </label>
        <label>Expiry
          <DateTimeField
            value={extensionDraft.expiry_date}
            onChange={(value) => setExtensionField('expiry_date', value)}
            timeValue={extensionDraft.expiry_time}
            onTimeChange={(value) => setExtensionField('expiry_time', value)}
            withTime
            ariaLabel="Extension expiry"
          />
        </label>
      </div>
      <label>Notes (Optional)
        <textarea
          value={extensionDraft.notes || ''}
          onChange={(e) => setExtensionField('notes', e.target.value)}
          rows={2}
          placeholder="Internal note for this period"
          aria-label="Extension notes"
        />
      </label>
      <div className="two-col">
        <label>Payment Date
          <DateTimeField
            value={extensionDraft.payment_date}
            onChange={(value) => setExtensionField('payment_date', value)}
            timeValue={extensionDraft.payment_time}
            onTimeChange={(value) => setExtensionField('payment_time', value)}
            withTime
            ariaLabel="Extension payment date"
          />
        </label>
        <label>Price (IDR)
          <input
            type="text"
            inputMode="numeric"
            // Show a real "0" when no price is set (not just a
            // placeholder); selectAllIfZero selects that "0" on
            // focus so the first keystroke replaces it cleanly,
            // and parseMoneyInput collapses any leading zero.
            value={String(Number(extensionDraft.price) || 0)}
            placeholder="0"
            onFocus={selectAllIfZero}
            onChange={(e) => setExtensionField('price', parseMoneyInput(e.target.value))}
            aria-label="Extension price in rupiah"
          />
        </label>
      </div>
      <ProofField
        value={extensionDraft.payment_proof}
        onChange={(v) => setExtensionField('payment_proof', v)}
        ariaLabel="Extension payment proof"
      />
      {extensionStatus ? (
        <p className={`download-status${extensionStatusTone ? ` lg-status-${extensionStatusTone}` : ''}`}>
          {extensionStatus}
        </p>
      ) : null}
      <div className="client-actions">
        <button className="primary-button" type="submit" disabled={extensionBusy}>
          {extensionBusy ? 'Saving\u2026' : (editingExtensionId ? 'Save Changes' : 'Save Extension')}
        </button>
        <button className="ghost-button compact" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
