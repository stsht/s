export const SubscriptionDetailRows = ({
  tone,
  storageValue,
  priceLabel,
  paymentValue,
  startValue,
  expiryValue,
  periodLabel,
  bonusLabel,
  contact,
  hasAnyDetailRow,
}) => (
  <div className={`list-stack${tone ? ` sub-${tone}` : ''}`}>
    {storageValue ? (
      <article className="list-row" key="Storage">
        <div><strong>Storage</strong><span>{storageValue}</span></div>
      </article>
    ) : null}
    {(priceLabel || paymentValue) ? (
      <div className="subs-detail-row-group" key="row-price-payment">
        <article className="list-row"><div><strong>Price</strong><span>{priceLabel || '—'}</span></div></article>
        <article className="list-row"><div><strong>Payment Date</strong><span>{paymentValue || '—'}</span></div></article>
      </div>
    ) : null}
    {(startValue || expiryValue) ? (
      <div className="subs-detail-row-group" key="row-start-expiry">
        <article className="list-row"><div><strong>Start Date</strong><span>{startValue || '—'}</span></div></article>
        <article className="list-row"><div><strong>Expiry Date</strong><span>{expiryValue || '—'}</span></div></article>
      </div>
    ) : null}
    <div className="subs-detail-row-group" key="row-period-bonus">
      <article className="list-row"><div><strong>Access Period</strong><span>{periodLabel || '0 Days'}</span></div></article>
      <article className="list-row"><div><strong>Bonus</strong><span>{bonusLabel}</span></div></article>
    </div>
    {contact ? (
      <article className="list-row" key="Contact">
        <div><strong>Contact</strong><span>{contact}</span></div>
      </article>
    ) : null}
    {!hasAnyDetailRow ? <p className="empty-state">No subscription details available.</p> : null}
  </div>
);
