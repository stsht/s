export function DeliveryMessageBox({
  useLastName,
  setUseLastName,
  messageMode = 'delivery',
  onMessageModeChange,
  hasPaymentMessage = false,
  messageText,
  flash,
  handleCopyMessage,
}) {
  const isPayment = hasPaymentMessage && messageMode === 'payment';

  return (
    <div className={`dd-message${flash === 'msg' ? ' is-flash' : ''}`}>
      <div className="dd-message-head">
        <div className="dd-message-head-left">
          <p className="eyebrow">Message</p>
          {hasPaymentMessage && typeof onMessageModeChange === 'function' ? (
            <div
              className="dd-message-mode"
              role="tablist"
              aria-label="Message type"
              style={{ '--msg-index': isPayment ? 1 : 0 }}
            >
              <span className="dd-message-mode-thumb" aria-hidden="true" />
              <button
                type="button"
                role="tab"
                aria-selected={!isPayment}
                className={!isPayment ? 'active' : ''}
                onClick={() => onMessageModeChange('delivery')}
              >
                Delivery
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={isPayment}
                className={isPayment ? 'active' : ''}
                onClick={() => onMessageModeChange('payment')}
              >
                Payment
              </button>
            </div>
          ) : null}
        </div>
        <label className="dd-message-salutation-toggle">
          <input
            type="checkbox"
            checked={useLastName}
            onChange={(event) => setUseLastName(event.target.checked)}
          />
          <span>Use Last Name</span>
        </label>
      </div>
      <textarea
        className="dd-message-output"
        value={messageText}
        readOnly
        spellCheck="false"
      />
      <div className="dd-message-actions">
        <button
          type="button"
          className={`ghost-button compact${flash === 'msg' ? ' is-flash' : ''}`}
          onClick={handleCopyMessage}
        >
          {flash === 'msg' ? 'Copied' : isPayment ? 'Copy Payment Message' : 'Copy Message'}
        </button>
      </div>
    </div>
  );
}
