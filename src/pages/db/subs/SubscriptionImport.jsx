import { useState } from 'react';
import { Combobox, DateTimeField } from '../../../components/ui/index.js';
import { onBlurTitleCase } from '../../../utils/titleCase.js';
import { selectAllIfZero, parseMoneyInput } from '../../../utils/moneyInput.js';
import { SUBSCRIPTION_STATUS_OPTIONS } from './subscriptionFormOptions.js';
import {
  applySubscriptionDraftUpdate,
  INITIAL_SUBS_IMPORT_DRAFT,
} from './subscriptionEditDrafts.js';
import { SubsImportDropZone } from './SubscriptionImportDropZone.jsx';
import {
  extractSubscriptionReceiptInBrowser,
  hasUsefulImport,
  mergeImportParsed,
  missingCoreImportFields,
} from './subscriptionImportHelpers.js';

const TITLE_OPTIONS = ['Mr.', 'Ms.', 'Mrs.', 'Family'];

// Right-panel "Import JPG" flow for /db Subs. Step 1 is a file
// picker; step 2 is the editable preview that shows extracted
// fields and lets the operator correct anything before Save.
//
// On Save we POST to /api/subscriptions-save with the matched
// existing-subscription id (when present) so the row is updated
// rather than duplicated for the same client+service+payment+start.
//
// Failure is graceful: if the server returns ok:false (or the
// vision provider is unavailable), the form opens with empty
// fields so the operator can type the receipt manually. The
// uploaded image is never stored — the request body is consumed
// once and dropped on the server.
export function SubscriptionImport({ onSaved, onCancel }) {
  const [stage, setStage] = useState('upload'); // 'upload' | 'edit'
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState('');
  const [existingId, setExistingId] = useState('');
  const [fileName, setFileName] = useState('');
  // All date/time fields start blank. The spec is explicit: do NOT
  // default to today when extraction fails — leave them empty so the
  // operator visibly sees what wasn't read instead of silently
  // saving "today" for a receipt the OCR never matched.
  const [draft, setDraft] = useState(INITIAL_SUBS_IMPORT_DRAFT);

  function setField(key, value) {
    setDraft((current) => applySubscriptionDraftUpdate(current, key, value));
  }

  // Merge server-parsed fields into the draft. Empty/null values
  // fall back to the current draft so a partial extraction still
  // leaves any defaults the operator already saw.
  function applyParsed(parsed = {}) {
    // Resolve the price field across the aliases the server prompt
    // and any local OCR fallback might use. Subs only has a single
    // `price` column on disk, but the parser shape isn't a hard
    // contract — keep this lenient so a Rp 50.000 on the receipt
    // lands in the draft regardless of which key the JSON used.
    const parsedPriceCandidates = [
      parsed.price,
      parsed.paid_amount,
      parsed.paidAmount,
      parsed.amount,
      parsed.total,
    ];
    let parsedPrice = NaN;
    for (const candidate of parsedPriceCandidates) {
      if (candidate === undefined || candidate === null || candidate === '') continue;
      const digits = String(candidate).replace(/[^0-9]/g, '');
      if (!digits) continue;
      const num = Number(digits);
      if (Number.isFinite(num) && num > 0) { parsedPrice = num; break; }
    }
    setDraft((current) => ({
      ...current,
      client_title: parsed.client_title || current.client_title,
      client_name: parsed.client_name || current.client_name,
      client_contact: parsed.client_contact || current.client_contact,
      service: parsed.service || current.service,
      storage_slot: parsed.storage_slot || current.storage_slot,
      rate_mode: parsed.rate_mode || current.rate_mode,
      price: Number.isFinite(parsedPrice) ? parsedPrice : current.price,
      status: parsed.status || current.status,
      invoice_date: parsed.invoice_date || current.invoice_date,
      payment_date: parsed.payment_date || current.payment_date,
      payment_time: parsed.payment_time || current.payment_time,
      access_period: Number.isFinite(Number(parsed.access_period)) && Number(parsed.access_period) > 0
        ? Number(parsed.access_period)
        : current.access_period,
      bonus: Number.isFinite(Number(parsed.bonus)) && Number(parsed.bonus) >= 0
        ? Number(parsed.bonus)
        : current.bonus,
      start_date: parsed.start_date || current.start_date,
      start_time: parsed.start_time || current.start_time,
      expiry_date: parsed.expiry_date || current.expiry_date,
      expiry_time: parsed.expiry_time || current.expiry_time,
      // If OCR extracted a start date, latch it as customized so a
      // later Payment edit in the review stage won't overwrite the
      // start the receipt actually shows (Req2 follow-until-custom).
      start_customized: !!parsed.start_date || current.start_customized,
    }));
  }

  // Receives a File instance from either the hidden <input
  // type="file"> click-picker or a drag-and-drop onto the upload
  // zone — both code paths funnel through here.
  async function handleFile(file) {
    if (!file) return;
    if (!/^image\//i.test(file.type || '')) {
      setStatus('Please drop a JPG, PNG, or WebP receipt image.');
      setStatusTone('error');
      return;
    }
    setFileName(file.name || '');
    setBusy(true);
    setStatus('Reading image…');
    setStatusTone('');
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/subscriptions-import', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        const local = await extractSubscriptionReceiptInBrowser(file, setStatus);
        if (hasUsefulImport(local.parsed)) {
          applyParsed(local.parsed);
          setStatus(missingCoreImportFields(local.parsed)
            ? 'Needs review. Some fields were restored from filename/OCR, but blanks remain.'
            : 'Fields restored in-browser. Review and Save to create the row.');
          setStatusTone(missingCoreImportFields(local.parsed) ? '' : 'success');
        } else {
          // Spec requires the friendly message — fall through to the
          // edit stage so the operator can still type the fields. We
          // intentionally do NOT pre-fill any date/time field with
          // today(); the empty state itself signals "not extracted".
          setStatus(json.error || 'Could not read image, please enter manually.');
          setStatusTone('error');
        }
        setStage('edit');
        setExistingId('');
        return;
      }
      let parsed = json.parsed || {};
      if (json.needs_review || missingCoreImportFields(parsed)) {
        const local = await extractSubscriptionReceiptInBrowser(file, setStatus);
        parsed = mergeImportParsed(parsed, local.parsed);
      }
      applyParsed(parsed);
      setExistingId(String(json.existing?.id || ''));
      setStatus(missingCoreImportFields(parsed)
        ? (json.message || 'Needs review. Some fields could not be read.')
        : json.existing?.id
          ? 'Read OK. Existing subscription found — Save will update it.'
          : 'Read OK. Review and Save to create the row.');
      setStatusTone(missingCoreImportFields(parsed) ? '' : 'success');
      setStage('edit');
    } catch (error) {
      setStatus(error?.message || 'Could not read image, please enter manually.');
      setStatusTone('error');
      setStage('edit');
      setExistingId('');
    } finally {
      setBusy(false);
    }
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
      // Pass id through when we matched an existing row so
      // /api/subscriptions-save runs as an update rather than an
      // insert — this is the duplicate-suppression contract.
      if (existingId) payload.id = existingId;
      const response = await fetch('/api/subscriptions-save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: payload, id: existingId || undefined }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(json.error || `Save failed (${response.status}).`);
      }
      // Save succeeded — return the panel to the upload step so the
      // operator can drop the next receipt without re-navigating.
      // We reset every piece of importer state (stage, fileName,
      // status, existingId, draft) so the next render is visually
      // indistinguishable from a fresh open. The parent only needs
      // to refresh its Subs list; it must NOT clear `selected` or
      // we'd unmount this component and leave a blank panel.
      setStage('upload');
      setFileName('');
      setExistingId('');
      setStatus('');
      setStatusTone('');
      setDraft(INITIAL_SUBS_IMPORT_DRAFT);
      onSaved?.();
    } catch (error) {
      setStatus(error?.message || 'Save failed.');
      setStatusTone('error');
    } finally {
      setBusy(false);
    }
  }

  // Step 1 — pick a file. The operator can also click "Enter
  // manually" to skip the upload entirely (for cases where the
  // vision provider is offline and they already know the values).
  if (stage === 'upload') {
    return (
      <>
        <div className="detail-heading">
          <div>
            <p className="eyebrow">Subscription</p>
            <h2>Import JPG</h2>
            <span>Upload a StarShots receipt to auto-fill the subscription fields.</span>
          </div>
          <div className="detail-actions">
            <button
              type="button"
              className="db-close-button"
              onClick={onCancel}
              aria-label="Close importer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        <form className="form-stack subs-import-upload" onSubmit={(e) => e.preventDefault()}>
          <SubsImportDropZone
            busy={busy}
            fileName={fileName}
            onFile={handleFile}
          />
          {status ? (
            <p className={`download-status${statusTone ? ` lg-status-${statusTone}` : ''}`}>{status}</p>
          ) : null}
          <div className="client-actions">
            <button
              type="button"
              className="ghost-button compact"
              onClick={() => {
                // Manual subscription entry lives on /subs (the
                // dedicated invoice / receipt composer). The /db
                // Subs panel only handles JPG import + listing.
                window.location.assign('/subs/');
              }}
            >
              Enter manually
            </button>
            <button type="button" className="ghost-button compact" onClick={onCancel}>Cancel</button>
          </div>
        </form>
      </>
    );
  }

  // Step 2 — editable preview. Uses the same field grid the rest
  // of the dashboard uses; the operator can edit anything before
  // Save. "Re-upload" sends them back to step 1 to try a different
  // image without losing the open editor.
  return (
    <>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Subscription</p>
          <h2>
            Import JPG
            {existingId ? <span className="sub-badge sub-badge-active">Update</span> : null}
          </h2>
          <span>Review the extracted fields and Save.</span>
        </div>
        <div className="detail-actions">
          <button
            type="button"
            className="ghost-button compact"
            onClick={() => {
              setStage('upload');
              setStatus('');
              setStatusTone('');
              setExistingId('');
            }}
          >
            Re-upload
          </button>
          <button
            type="button"
            className="db-close-button"
            onClick={onCancel}
            aria-label="Close importer"
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
            type="number"
            min="0"
            value={draft.price}
            onFocus={selectAllIfZero}
            onChange={(e) => setField('price', parseMoneyInput(e.target.value))}
          />
        </label>
        {status ? (
          <p className={`download-status${statusTone ? ` lg-status-${statusTone}` : ''}`}>{status}</p>
        ) : null}
        <div className="client-actions">
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? 'Saving…' : (existingId ? 'Save (Update Existing)' : 'Save Subscription')}
          </button>
          <button className="ghost-button compact" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </>
  );
}
