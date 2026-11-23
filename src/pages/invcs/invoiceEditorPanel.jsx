// EditorPanel — left-hand /inv composer panel (StarShots Identity).
// Clean 2-tab workflow: Details (always editable) | Payments (status,
// 3-figure financial summary, payment method, deposit & paid ledger).

import { Combobox, DateTimeField } from '../../components/ui/index.js';
import { toTitleCase, maybeTitleCase, onBlurTitleCase } from '../../utils/titleCase.js';
import { selectAllIfZero, parseMoneyInput } from '../../utils/moneyInput.js';
import { Fieldset, TrashIcon, PlusIcon } from './invoicePrimitives.jsx';
import { TITLE_OPTIONS, DEPOSIT_PRESETS } from './invoiceConstants.js';
import { rupiah, isFullPayment, clampItemDiscount } from './invoiceFormat.js';
import {
  PaymentMethodPicker,
  PaymentMethodSummary,
  PaymentMethodFieldset,
  PaidSummary,
  PackageCatalogEditor,
  DepositLedger,
} from './invoiceSections.jsx';

const STATUS_OPTIONS = [
  { value: 'invoice', label: 'Draft' },
  { value: 'deposit', label: 'Deposit' },
  { value: 'paid', label: 'Paid' },
];

export function EditorPanel(props) {
  const activeTab = props.editorTab === 'payments' ? 'payments' : 'details';
  const statusIndex = Math.max(0, STATUS_OPTIONS.findIndex((opt) => opt.value === props.mode));
  const grandTotal = Math.max(0, Math.round(Number(props.totals?.grandTotal) || 0));
  const effectivePaid = props.mode === 'paid'
    ? grandTotal
    : Math.max(0, Math.round(Number(props.depositPaidTotal) || 0));
  const effectiveBalance = props.mode === 'paid'
    ? 0
    : Math.max(0, Math.round(Number(props.balanceDue) || 0));

  return (
    <aside className="editor-panel panel">
      <div className="editor-panel-scroll scroll-surface-y">
        <header className="panel-header inv-panel-header">
          <a className="inv-logo" href="/db/" aria-label="StarShots Workspace">
            <picture>
              <source media="(prefers-color-scheme: dark)" srcSet="/logo-hero-white.png" />
              <img src="/logo-hero.png" alt="StarShots" />
            </picture>
          </a>
          <div
            className="inv-tab-switch"
            role="tablist"
            aria-label="Invoice sections"
            style={{ '--tab-index': activeTab === 'payments' ? 1 : 0 }}
          >
            <span className="inv-tab-switch-thumb" aria-hidden="true" />
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'details'}
              className={activeTab === 'details' ? 'active' : ''}
              onClick={() => props.setEditorTab('details')}
            >
              Details
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'payments'}
              className={activeTab === 'payments' ? 'active' : ''}
              onClick={() => props.setEditorTab('payments')}
            >
              Payments
            </button>
          </div>
        </header>

        {activeTab === 'details' ? (
          <>
            <Fieldset title="Bill To">
              <div className="field-stack">
                <div className="two-col">
                  {props.invoiceType !== 'vendor' && (
                    <label>
                      Title
                      <Combobox
                        value={props.title}
                        onChange={props.setTitle}
                        options={TITLE_OPTIONS}
                        ariaLabel="Title"
                        placeholder="Title"
                      />
                    </label>
                  )}
                  <label>
                    Client Name
                    <input
                      value={props.clientName}
                      onChange={(event) => props.setClientName(event.target.value)}
                      onBlur={onBlurTitleCase(props.setClientName)}
                      placeholder="Client Name"
                    />
                  </label>
                </div>
                <label>
                  Contact
                  <input
                    value={props.contact}
                    onChange={(event) => props.setContact(event.target.value)}
                    onBlur={onBlurTitleCase(props.setContact)}
                    placeholder="Instagram / Phone / Email"
                  />
                </label>
              </div>
            </Fieldset>

            <Fieldset title="Event Details">
              <div className="field-stack">
                <label>
                  Venue
                  <input
                    value={props.venue}
                    onChange={(event) => props.setVenue(event.target.value)}
                    onBlur={onBlurTitleCase(props.setVenue)}
                    placeholder="Venue"
                  />
                </label>
                <div className="event-date-row">
                  <label>
                    Event Date
                    <DateTimeField
                      value={props.eventDate}
                      onChange={props.setEventDate}
                      timeValue={props.eventTime}
                      onTimeChange={props.setEventTime}
                      withTime
                      ariaLabel="Event Date and time"
                    />
                  </label>
                  <label>
                    Issued
                    <DateTimeField
                      value={props.issuedDate}
                      onChange={props.setIssuedDate}
                      ariaLabel="Issued date"
                    />
                  </label>
                </div>
              </div>
            </Fieldset>

            <Fieldset title="Packages">
              <PackageCatalogEditor
                packages={props.packages}
                savePackage={props.savePackage}
                deletePackage={props.deletePackage}
              />
              <div className="item-list">
                {props.items.map((item) => (
                  <div className="item-editor" key={item.id}>
                    <label>
                      Package
                      <Combobox
                        value={item.name}
                        onChange={(value) => props.applyPackage(item.id, value)}
                        options={[
                          ...(!props.packages.some((pkg) => pkg.name === item.name) && item.name
                            ? [{ value: item.name, label: toTitleCase(item.name) }]
                            : []),
                          ...props.packages.map((pkg) => ({ value: pkg.name, label: toTitleCase(pkg.name) })),
                        ]}
                        ariaLabel="Package"
                        placeholder="Package"
                      />
                    </label>
                    <label>
                      Note
                      <input
                        value={item.note}
                        onChange={(event) => props.updateItem(item.id, { note: event.target.value })}
                        onBlur={(event) => {
                          const next = maybeTitleCase(event.target.value.trim());
                          if (next !== item.note) props.updateItem(item.id, { note: next });
                        }}
                        placeholder="Optional note"
                      />
                    </label>
                    <div className="inv-discount-row">
                      <label>
                        Discount (IDR)
                        <input
                          className="no-spinner"
                          type="number"
                          min="0"
                          inputMode="numeric"
                          value={item.discount || 0}
                          onFocus={selectAllIfZero}
                          onChange={(event) => props.updateItem(item.id, { discount: parseMoneyInput(event.target.value) })}
                          onBlur={(event) => {
                            const clamped = clampItemDiscount(parseMoneyInput(event.target.value), item.qty, item.price);
                            if (clamped !== (Number(item.discount) || 0)) props.updateItem(item.id, { discount: clamped });
                          }}
                          placeholder="0"
                        />
                      </label>
                      <label>
                        Discount Label
                        <input
                          value={item.discountLabel || ''}
                          onChange={(event) => props.updateItem(item.id, { discountLabel: event.target.value })}
                          onBlur={(event) => {
                            const next = maybeTitleCase(event.target.value.trim());
                            if (next !== (item.discountLabel || '')) props.updateItem(item.id, { discountLabel: next });
                          }}
                          placeholder="Package Discount"
                        />
                      </label>
                    </div>
                    <div className="invoice-item-controls">
                      <div className="qty-control" aria-label="Quantity">
                        <span>Qty</span>
                        <span className="qty-stepper">
                          <button type="button" aria-label="Decrease quantity" onClick={() => props.updateItem(item.id, { qty: Math.max(1, Math.round(Number(item.qty) || 1) - 1) })}>-</button>
                          <strong>{Math.max(1, Math.round(Number(item.qty) || 1))}</strong>
                          <button type="button" aria-label="Increase quantity" onClick={() => props.updateItem(item.id, { qty: Math.max(1, Math.round(Number(item.qty) || 1) + 1) })}>+</button>
                        </span>
                      </div>
                      <div className="package-price-readonly" aria-label="Package price">
                        <span>Price</span>
                        <strong>{rupiah(item.price)}</strong>
                      </div>
                      <button className="icon-danger-button" type="button" aria-label="Delete package row" title="Delete row" onClick={() => props.removeItem(item.id)}>
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button className="ghost-button add-package-button" type="button" onClick={props.addItem}>
                <PlusIcon /> Add Package
              </button>
            </Fieldset>

            <section className="inv-summary-strip" aria-label="Invoice totals">
              <div className="inv-summary-row">
                <span>Grand Total</span>
                <strong>{rupiah(grandTotal)}</strong>
              </div>
              <div className="inv-summary-row">
                <span>{isFullPayment(props.totals) ? 'Full Payment Due' : 'Deposit Due'}</span>
                <strong>{rupiah(props.totals.depositDue)}</strong>
              </div>
              <button
                type="button"
                className="inv-summary-link"
                onClick={() => props.setEditorTab('payments')}
              >
                Manage Payments & Status →
              </button>
            </section>
          </>
        ) : (
          <>
            <section className="inv-finance-kpi" aria-label="Financial summary">
              <div className="inv-finance-kpi-grid">
                <div className="inv-finance-kpi-item">
                  <span>Total</span>
                  <strong>{rupiah(grandTotal)}</strong>
                </div>
                <span className="inv-finance-kpi-divider" aria-hidden="true" />
                <div className="inv-finance-kpi-item">
                  <span>Paid</span>
                  <strong className={effectivePaid > 0 ? 'is-positive' : ''}>{rupiah(effectivePaid)}</strong>
                </div>
                <span className="inv-finance-kpi-divider" aria-hidden="true" />
                <div className="inv-finance-kpi-item">
                  <span>Balance Due</span>
                  <strong className={effectiveBalance > 0 ? 'is-due' : 'is-settled'}>{rupiah(effectiveBalance)}</strong>
                </div>
              </div>
              <button
                type="button"
                className="inv-edit-details-link"
                onClick={() => props.setEditorTab('details')}
              >
                Edit Packages & Discount
              </button>
            </section>

            <Fieldset title="Invoice Status">
              <div className="field-stack">
                <div
                  className="inv-status-switch"
                  role="radiogroup"
                  aria-label="Invoice status"
                  style={{ '--status-index': statusIndex }}
                >
                  <span className="inv-status-switch-thumb" aria-hidden="true" />
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={props.mode === opt.value}
                      className={props.mode === opt.value ? 'active' : ''}
                      onClick={() => props.setMode(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {props.mode === 'invoice' ? (
                  <div className="deposit-block">
                    <span className="deposit-label">Requested Deposit</span>
                    <div className="deposit-presets" role="radiogroup" aria-label="Deposit preset">
                      {DEPOSIT_PRESETS.map((preset) => {
                        const value = String(preset);
                        const active = props.depositMode === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            className={active ? 'active' : ''}
                            onClick={() => props.setDepositMode(value)}
                          >
                            {preset}%
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        role="radio"
                        aria-checked={props.depositMode === 'custom'}
                        className={props.depositMode === 'custom' ? 'active' : ''}
                        onClick={() => props.setDepositMode('custom')}
                      >
                        Custom
                      </button>
                    </div>
                    {props.depositMode === 'custom' ? (
                      <label className="deposit-custom">
                        Custom Amount (IDR)
                        <input
                          type="number"
                          min="0"
                          value={props.depositCustomAmount}
                          onFocus={selectAllIfZero}
                          onChange={(event) => props.setDepositCustomAmount(event.target.value)}
                          placeholder="e.g. 500000"
                        />
                      </label>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Fieldset>

            {props.mode !== 'paid' ? (
              <PaymentMethodFieldset
                paymentMethod={props.paymentMethod}
                setPaymentMethod={props.setPaymentMethod}
              />
            ) : null}

            {props.mode === 'deposit' || (props.mode === 'paid' && props.depositPayments && props.depositPayments.length > 0) ? (
              <DepositLedger
                mode={props.mode}
                payments={props.depositPayments}
                addPayment={props.addDepositPayment}
                updatePayment={props.updateDepositPayment}
                removePayment={props.removeDepositPayment}
                depositMode={props.depositMode}
                setDepositMode={props.setDepositMode}
                depositCustomAmount={props.depositCustomAmount}
                setDepositCustomAmount={props.setDepositCustomAmount}
                depositPaidTotal={props.depositPaidTotal}
                balanceDue={props.balanceDue}
                requestedDue={props.requestedDue}
                totals={props.totals}
                depositAskOpen={props.depositAskOpen}
                setDepositAskOpen={props.setDepositAskOpen}
              />
            ) : null}

            {props.mode === 'paid' ? (
              <PaidSummary
                totals={props.totals}
                paidConfirmed={props.paidConfirmed}
                setPaidConfirmed={props.setPaidConfirmed}
                paidAtDate={props.paidAtDate}
                setPaidAtDate={props.setPaidAtDate}
                paidAtTime={props.paidAtTime}
                setPaidAtTime={props.setPaidAtTime}
              />
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
