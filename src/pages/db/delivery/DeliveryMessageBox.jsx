export function DeliveryMessageBox({
  useLastName,
  setUseLastName,
  messageText,
  flash,
  handleCopyMessage,
}) {
  return (
    <div className={`dd-message${flash === 'msg' ? ' is-flash' : ''}`}>
      <div className="dd-message-head">
        <p className="eyebrow">Message</p>
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
          Copy Message
        </button>
      </div>
    </div>
  );
}
