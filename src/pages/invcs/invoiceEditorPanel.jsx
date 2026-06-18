// EditorPanel — the left-hand /inv editor column, extracted verbatim
// from InvoiceComposer.jsx (Pass 60). Pure, props-only: no hooks, no
// local state, no DOM refs, no network, no localStorage. It renders
// the Bill To / Details / Packages / Payment form for the Invoice tab
// and the locked summary + DepositLedger / PaidSummary sections for
// the Deposit/Paid tabs, driven entirely by props and the shared
// primitives / constants / helpers / sections imported below. Markup,
// class names, props, and call site are unchanged.

import { Combobox, DateTimeField } from '../../components/ui/index.js';
import { toTitleCase, maybeTitleCase, onBlurTitleCase } from '../../utils/titleCase.js';
import { selectAllIfZero, parseMoneyInput } from '../../utils/moneyInput.js';
import { Fieldset, TrashIcon, PlusIcon } from './invoicePrimitives.jsx';
import { TITLE_OPTIONS, DEPOSIT_PRESETS } from './invoiceConstants.js';
import { rupiah, isFullPayment, clampItemDiscount } from './invoiceFormat.js';
import { PaymentMethodPicker, PaymentMethodSummary, PaymentMethodFieldset, LockedDetails, PaidSummary, PackageCatalogEditor, DepositLedger } from './invoiceSections.jsx';

export function EditorPanel(props) {
  return (
    <aside className="editor-panel panel">
      <div className="editor-panel-scroll scroll-surface-y">
        <header className="panel-header">
          <img src="/logo-hero.png" alt="StarShots" />
          <div className="mode-switch">
            {['invoice', 'deposit', 'paid'].map((value) => (
              <button key={value} className={props.mode === value ? 'active' : ''} type="button" onClick={() => props.setMode(value)}>
                {value}
              </button>
            ))}
          </div>
        </header>

      {props.mode === 'invoice' ? (
        <>
      <Fieldset title="Bill To">
        <div className="field-stack">
          <div className="two-col">
            {props.invoiceType !== 'vendor' && <label>Title<Combobox value={props.title} onChange={props.setTitle} options={TITLE_OPTIONS} ariaLabel="Title" placeholder="Title" /></label>}
            <label>Client Name<input value={props.clientName} onChange={(event) => props.setClientName(event.target.value)} onBlur={onBlurTitleCase(props.setClientName)} placeholder="Client Name" /></label>
          </div>
          <label>Contact<input value={props.contact} onChange={(event) => props.setContact(event.target.value)} onBlur={onBlurTitleCase(props.setContact)} placeholder="Instagram / Phone / Email" /></label>
        </div>
      </Fieldset>

      <Fieldset title="Details">
        <div className="field-stack">
          <label>Venue<input value={props.venue} onChange={(event) => props.setVenue(event.target.value)} onBlur={onBlurTitleCase(props.setVenue)} placeholder="Venue" /></label>
          <div className="event-date-row">
            <label>Event Date
              <DateTimeField
                value={props.eventDate}
                onChange={props.setEventDate}
                timeValue={props.eventTime}
                onTimeChange={props.setEventTime}
                withTime
                ariaLabel="Event Date and time"
              />
            </label>
            <label>Issued
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
              <label>Package
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
              <label>Note<input value={item.note} onChange={(event) => props.updateItem(item.id, { note: event.target.value })} onBlur={(event) => {
                const next = maybeTitleCase(event.target.value.trim());
                if (next !== item.note) props.updateItem(item.id, { note: next });
              }} placeholder="Optional note" /></label>
              <label>Package Discount<input
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
              /></label>
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
        <button className="ghost-button add-package-button" type="button" onClick={props.addItem}><PlusIcon /> Add Package</button>
      </Fieldset>

      <Fieldset title="Payment">
        <div className="field-stack">
          <div className="deposit-block">
            <span className="deposit-label">Deposit</span>
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

          <PaymentMethodPicker
            paymentMethod={props.paymentMethod}
            setPaymentMethod={props.setPaymentMethod}
          />
          <PaymentMethodSummary paymentMethod={props.paymentMethod} />
          <div className="total-card"><span>Grand Total</span><strong>{rupiah(props.totals.grandTotal)}</strong></div>
          <div className="total-card"><span>{isFullPayment(props.totals) ? 'Full Payment Due' : 'Deposit Due'}</span><strong>{rupiah(props.totals.depositDue)}</strong></div>
        </div>
      </Fieldset>
        </>
      ) : (
        <>
          <LockedDetails
            invoiceType={props.invoiceType}
            mode={props.mode}
            title={props.title}
            clientName={props.clientName}
            contact={props.contact}
            venue={props.venue}
            eventDate={props.eventDate}
            eventTime={props.eventTime}
            totals={props.totals}
          />
          {props.mode === 'deposit' ? (
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
          ) : (
            <PaidSummary
              totals={props.totals}
              paidConfirmed={props.paidConfirmed}
              setPaidConfirmed={props.setPaidConfirmed}
              paidAtDate={props.paidAtDate}
              setPaidAtDate={props.setPaidAtDate}
              paidAtTime={props.paidAtTime}
              setPaidAtTime={props.setPaidAtTime}
            />
          )}
        </>
      )}
      </div>
    </aside>
  );
}
