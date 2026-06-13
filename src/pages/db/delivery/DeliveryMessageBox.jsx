export function DeliveryMessageBox({ variant, setVariant, messageText, flash, handleCopyMessage }) {
  return (
          <div className={`dd-message${(flash === 'msg-whatsapp' || flash === 'msg-instagram') ? ' is-flash' : ''}`}>
            <div className="dd-message-head">
              <p className="eyebrow">Message</p>
              <div className="dd-segmented" role="tablist" aria-label="Message variant">
                <button
                  type="button"
                  role="tab"
                  aria-selected={variant === 'whatsapp'}
                  className={variant === 'whatsapp' ? 'active' : ''}
                  onClick={() => setVariant('whatsapp')}
                >
                  WhatsApp
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={variant === 'instagram'}
                  className={variant === 'instagram' ? 'active' : ''}
                  onClick={() => setVariant('instagram')}
                >
                  Instagram
                </button>
              </div>
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
                className={`ghost-button compact${flash === 'msg-whatsapp' ? ' is-flash' : ''}`}
                onClick={() => handleCopyMessage('whatsapp')}
              >
                Copy WA
              </button>
              <button
                type="button"
                className={`ghost-button compact${flash === 'msg-instagram' ? ' is-flash' : ''}`}
                onClick={() => handleCopyMessage('instagram')}
              >
                Copy IG
              </button>
            </div>
          </div>
  );
}
