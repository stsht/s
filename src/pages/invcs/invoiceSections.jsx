// Small/medium invoice sections extracted verbatim from
// InvoiceComposer.jsx (Pass 53, Pass 54). Most are pure, props-only
// components — no side effects, DOM refs, network, or localStorage —
// rendering fixed markup driven only by their props and the shared
// primitives/constants/helpers imported below. PackageCatalogEditor
// (Pass 54) additionally carries self-contained local state for its
// inline catalogue-edit UX; its save/delete actions remain
// prop-driven. Markup, class names, and props are unchanged.

import { useEffect, useState } from 'react';
import { Fieldset, TrashIcon, PencilIcon, PlusIcon } from './invoicePrimitives.jsx';
import { BANK_DETAILS, PAYMENT_QR_SRC, DEPOSIT_PRESETS } from './invoiceConstants.js';
import { cleanPaymentMethod, rupiah, isFullPayment, prettyDate, prettyDateTime } from './invoiceFormat.js';
import { latestPaidDepositAmount } from './invoiceDeposit.js';
import { toTitleCase, maybeTitleCase } from '../../utils/titleCase.js';
import { DateTimeField } from '../../components/ui/index.js';
import { selectAllIfZero } from '../../utils/moneyInput.js';

export function PaymentMethodPicker({ paymentMethod, setPaymentMethod }) {
  const current = cleanPaymentMethod(paymentMethod);
  return (
    <div className="payment-method-block">
      <span className="payment-method-label">Payment Method</span>
      <div className="payment-method-switch" role="radiogroup" aria-label="Payment method">
        {[
          { value: 'bank', label: 'Bank' },
          { value: 'qr', label: 'QR' },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={current === option.value}
            className={current === option.value ? 'active' : ''}
            onClick={() => setPaymentMethod(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PaymentMethodSummary({ paymentMethod }) {
  const current = cleanPaymentMethod(paymentMethod);
  if (current === 'qr') {
    return (
      <div className="qr-details-summary" aria-label="QR payment destination">
        <span className="payment-method-label">Payment Details</span>
        <div className="qr-details-card">
          <img src={PAYMENT_QR_SRC} alt="Payment QR" />
          <strong>QR Payment</strong>
        </div>
      </div>
    );
  }
  return (
    <div className="bank-details-summary" aria-label="Bank transfer destination">
      <span className="payment-method-label">Payment Details</span>
      <dl className="bank-details-summary-list">
        <div><dt>Bank</dt><dd>{BANK_DETAILS.bank}</dd></div>
        <div><dt>Account No.</dt><dd>{BANK_DETAILS.accountNumber}</dd></div>
        <div><dt>Account Name</dt><dd>{BANK_DETAILS.accountHolderLabel}</dd></div>
      </dl>
    </div>
  );
}

export function PaymentMethodFieldset({ paymentMethod, setPaymentMethod }) {
  return (
    <Fieldset title="Payment Method">
      <div className="field-stack">
        <PaymentMethodPicker paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod} />
        <PaymentMethodSummary paymentMethod={paymentMethod} />
      </div>
    </Fieldset>
  );
}

// Read-only identity + event recap shown on the Deposit and Paid
// tabs. The Invoice tab is the single source of truth for these
// fields (client_title/name/contact, venue, event date+time) and
// the grand total — the Deposit/Paid tabs deliberately cannot edit
// them, they only display the locked snapshot so the operator has
// context while recording payments. Preserves client_id / event_key
// / client_name / event_date grouping inputs untouched.
export function LockedDetails({ mode, title, clientName, contact, venue, eventDate, eventTime, totals, invoiceType }) {
  return (
    <Fieldset title="Invoice Details (locked)">
      <dl className="locked-list">
        <div className="locked-row"><dt>Client</dt><dd>{invoiceType === 'vendor' ? (clientName ? toTitleCase(clientName) : 'Client') : `${title} ${clientName ? toTitleCase(clientName) : 'Client'}`.trim()}</dd></div>
        <div className="locked-row"><dt>Contact</dt><dd>{contact ? maybeTitleCase(contact) : '-'}</dd></div>
        <div className="locked-row"><dt>Venue</dt><dd>{venue ? toTitleCase(venue) : 'TBA'}</dd></div>
        <div className="locked-row"><dt>Event</dt><dd>{prettyDateTime(eventDate, eventTime)}</dd></div>
        <div className="locked-row"><dt>Grand Total</dt><dd>{rupiah(totals.grandTotal)}</dd></div>
      </dl>
    </Fieldset>
  );
}


// Paid-tab summary. Paid means one final receipt state: the invoice
// is settled in full, paid_amount = grand total, and balance_due = 0.
// The single editable timestamp feeds both the operator recap and the
// JPG summary line.
export function PaidSummary({ totals, paidConfirmed, setPaidConfirmed, paidAtDate, setPaidAtDate, paidAtTime, setPaidAtTime }) {
  return (
    <Fieldset title="Mark as Paid">
      <div className="dp-row paid-row">
        <label className="dp-paid-toggle">
          <input
            type="checkbox"
            checked={!!paidConfirmed}
            onChange={(event) => setPaidConfirmed(event.target.checked)}
          />
          <span>Fully Paid</span>
        </label>
        <label className="dp-field">Paid on
          <DateTimeField
            value={paidAtDate}
            onChange={setPaidAtDate}
            timeValue={paidAtTime}
            onTimeChange={setPaidAtTime}
            withTime
            ariaLabel="Fully paid date and time"
          />
        </label>
      </div>
      <div className="dp-totals">
        <div className="dp-total-row"><span>Grand Total</span><strong>{rupiah(totals.grandTotal)}</strong></div>
        {paidConfirmed ? (
          <div className="dp-total-row paid-in-full-row">
            <span>Fully Paid on {prettyDate(paidAtDate)}</span>
            <strong>{rupiah(totals.grandTotal)}</strong>
          </div>
        ) : null}
        <div className="dp-total-row dp-total-balance"><span>Balance Due</span><strong>{rupiah(0)}</strong></div>
      </div>
    </Fieldset>
  );
}

export function PackageCatalogEditor({ packages, savePackage, deletePackage }) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState({ id: '', name: '', note: '', price: '' });

  function beginEdit(pkg = null) {
    setOpen(true);
    setEditingId(pkg?.id || '__new__');
    setDraft(pkg ? {
      id: String(pkg.id || ''),
      name: String(pkg.name || ''),
      note: String(pkg.note || ''),
      price: String(pkg.price || ''),
    } : { id: '', name: '', note: '', price: '' });
  }

  function cancelEdit() {
    setEditingId('');
    setDraft({ id: '', name: '', note: '', price: '' });
  }

  async function commitEdit() {
    const saved = await savePackage?.(draft, editingId === '__new__' ? '' : packages.find((pkg) => pkg.id === editingId)?.name || draft.name);
    if (saved) cancelEdit();
  }

  function handleEditKeyDown(event) {
    if (event.nativeEvent?.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      commitEdit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  }

  return (
    <div className={`package-catalog${open ? ' is-open' : ''}`}>
      <button className="package-catalog-toggle" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>Package Catalogue</span>
        <strong>{packages.length}</strong>
      </button>
      {open ? (
        <>
          <div className="package-catalog-actions">
            <button className="package-catalog-add" type="button" onClick={() => beginEdit(null)}>
              <PlusIcon /> New Package
            </button>
            {editingId === '__new__' ? (
              <div className="package-catalog-row">
                <div className="package-catalog-edit" onKeyDown={handleEditKeyDown}>
                  <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Package name" />
                  <input value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Default note" />
                  <input className="no-spinner" type="number" min="0" value={draft.price} onFocus={selectAllIfZero} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} placeholder="Price" />
                  <div className="package-catalog-edit-actions">
                    <button className="package-catalog-save" type="button" onClick={commitEdit}>Save</button>
                    <button type="button" onClick={cancelEdit}>Cancel</button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          <div className="package-catalog-list">
          {packages.map((pkg) => {
            const editing = editingId === pkg.id;
            return (
              <div className="package-catalog-row" key={pkg.id || pkg.name}>
                {editing ? (
                  <div className="package-catalog-edit" onKeyDown={handleEditKeyDown}>
                    <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Package name" />
                    <input value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Default note" />
                    <input className="no-spinner" type="number" min="0" value={draft.price} onFocus={selectAllIfZero} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} placeholder="Price" />
                    <div className="package-catalog-edit-actions">
                      <button className="package-catalog-save" type="button" onClick={commitEdit}>Save</button>
                      <button type="button" onClick={cancelEdit}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="package-catalog-main">
                      <strong>{toTitleCase(pkg.name)}</strong>
                      <span>{pkg.note ? toTitleCase(pkg.note) : 'No default note'}</span>
                    </div>
                    <span className="package-catalog-price">{rupiah(pkg.price)}</span>
                    <button className="icon-soft-button" type="button" aria-label={`Edit ${pkg.name}`} title="Edit package" onClick={() => beginEdit(pkg)}>
                      <PencilIcon />
                    </button>
                    <button className="icon-danger-button" type="button" aria-label={`Delete ${pkg.name}`} title="Delete package" onClick={() => deletePackage?.(pkg.id)}>
                      <TrashIcon />
                    </button>
                  </>
                )}
              </div>
            );
          })}
          </div>
        </>
      ) : null}
    </div>
  );
}


// Deposit-tab ledger + workflow menu. Two clearly separated actions:
//
//   • "Ask DP"        — set the deposit you request from the client.
//                       Toggles the Requested Deposit Due editor: the
//                       20/30/50/100/Custom preset ladder plus a manual
//                       IDR override field. Shares the Invoice tab's
//                       depositMode / depositCustomAmount state so the
//                       requested-deposit figure stays in sync.
//   • "+ Add DP Paid" — record one paid deposit instalment.
//
// The running Deposit Paid / Balance Due totals and a per-deposit
// "Deposit Paid on <date>" recap (same wording as the live preview /
// JPG summary box) sit below. The old "Show Balance Due on invoice"
// checkbox was removed — the Balance Due line is now always shown on
// the invoice (see PreviewPanel). All state lives in invoice_data;
// no new DB columns are introduced.
export function DepositLedger({ mode, payments, addPayment, updatePayment, removePayment, depositMode, setDepositMode, depositCustomAmount, setDepositCustomAmount, depositPaidTotal, balanceDue, requestedDue, totals, depositAskOpen, setDepositAskOpen }) {
  const fullPayment = isFullPayment(totals);
  // In the Paid tab the requested figure is always the remaining
  // balance, so it reads as "Full Payment" regardless of preset. The
  // Deposit tab keeps its existing wording (full vs partial deposit).
  const requestLabel = mode === 'paid'
    ? 'Full Payment'
    : (fullPayment ? 'Requested Full Payment' : 'Requested Deposit Due');
  const paidRows = payments.filter((payment) => payment.paid);

  useEffect(() => {
    if (depositAskOpen && paidRows.length) setDepositAskOpen(false);
  }, [depositAskOpen, paidRows.length, setDepositAskOpen]);

  // Opening "Ask DP" auto-follows the requested deposit due to the
  // latest recorded paid DP, so the amount we ask for matches what
  // the client most recently paid. With no paid DP yet it falls back
  // to the 20% preset default. Tied to the open action only —
  // hydrating a saved invoice keeps the persisted requested deposit
  // untouched until the operator explicitly reopens Ask DP.
  const handleAskToggle = () => {
    const willOpen = !depositAskOpen;
    setDepositAskOpen(willOpen);
    if (!willOpen) return;
    const latest = latestPaidDepositAmount(payments);
    if (latest > 0) {
      setDepositMode('custom');
      setDepositCustomAmount(String(latest));
    } else {
      setDepositMode('20');
      setDepositCustomAmount('');
    }
  };
  return (
    <Fieldset title="Deposit Payments">
      {/* Workflow menu — "Ask DP" reveals the requested-deposit
          editor; "Add DP Paid" logs a recorded instalment. */}
      <div className="dp-menu" role="group" aria-label="Deposit workflow">
        <button
          type="button"
          className={`dp-menu-btn${depositAskOpen ? ' active' : ''}`}
          aria-expanded={depositAskOpen}
          onClick={handleAskToggle}
        >
          Ask DP
        </button>
        <button type="button" className="dp-menu-btn dp-menu-btn--primary" onClick={addPayment}>
          + Add DP Paid
        </button>
      </div>

      {depositAskOpen ? (
        <div className="dp-ask">
          <div className="dp-context">
            <span>{requestLabel}</span>
            <strong>{rupiah(requestedDue)}</strong>
          </div>
          <div className="deposit-presets" role="radiogroup" aria-label="Requested deposit preset">
            {DEPOSIT_PRESETS.map((preset) => {
              const value = String(preset);
              const active = depositMode === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={active ? 'active' : ''}
                  onClick={() => setDepositMode(value)}
                >
                  {preset}%
                </button>
              );
            })}
            <button
              type="button"
              role="radio"
              aria-checked={depositMode === 'custom'}
              className={depositMode === 'custom' ? 'active' : ''}
              onClick={() => setDepositMode('custom')}
            >
              Custom
            </button>
          </div>
          <label className="deposit-custom">
            Manual amount (IDR) — overrides preset
            <input
              type="number"
              min="0"
              value={depositMode === 'custom' ? depositCustomAmount : ''}
              onFocus={selectAllIfZero}
              onChange={(event) => {
                setDepositCustomAmount(event.target.value);
                setDepositMode('custom');
              }}
              placeholder="e.g. 500000"
            />
          </label>
        </div>
      ) : null}

      <div className="dp-list">
        {payments.length === 0 ? (
          <p className="dp-empty">No deposit payments recorded yet. Use the + Add DP Paid button to log one.</p>
        ) : payments.map((payment) => (
          <div className="dp-row" key={payment.id}>
            <label className="dp-paid-toggle">
              <input
                type="checkbox"
                checked={!!payment.paid}
                onChange={(event) => {
                  const checked = event.target.checked;
                  updatePayment(payment.id, { paid: checked });
                  if (checked) setDepositAskOpen(false);
                }}
              />
              <span>DP Paid</span>
            </label>
            <label className="dp-field">Paid on
              <DateTimeField
                value={payment.paidAtDate}
                onChange={(value) => updatePayment(payment.id, { paidAtDate: value })}
                timeValue={payment.paidAtTime}
                onTimeChange={(value) => updatePayment(payment.id, { paidAtTime: value })}
                withTime
                ariaLabel="Deposit paid date and time"
              />
            </label>
            <div className="dp-amount-row">
              <label className="dp-field">Amount
                <input
                  type="number"
                  min="0"
                  value={payment.amount}
                  onFocus={selectAllIfZero}
                  onChange={(event) => updatePayment(payment.id, { amount: event.target.value })}
                  placeholder="0"
                />
              </label>
              <button className="remove" type="button" onClick={() => removePayment(payment.id)}>Remove</button>
            </div>
          </div>
        ))}
      </div>

      <div className="dp-totals">
        <div className="dp-total-row"><span>Deposit Paid</span><strong>{rupiah(depositPaidTotal)}</strong></div>
        <div className="dp-total-row dp-total-balance"><span>Balance Due</span><strong>{rupiah(balanceDue)}</strong></div>
      </div>

      {/* Per-deposit recap — each paid instalment listed separately
          with the same "Deposit Paid on <date>" wording the live
          preview / JPG summary box uses. */}
      {paidRows.length ? (
        <div className="dp-list dp-list--readonly">
          <p className="dp-context-label">{paidRows.length > 1 ? 'Deposits paid' : 'Deposit paid'}</p>
          {paidRows.map((payment) => (
            <div className="dp-readonly-row" key={payment.id}>
              <span>Deposit Paid on {prettyDate(payment.paidAtDate)}</span>
              <strong>{rupiah(payment.amount)}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </Fieldset>
  );
}
