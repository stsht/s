import { EditIcon, RefreshIcon } from '../dbIcons.jsx';

export function DeliveryPasswordTools({
  password,
  flash,
  editingPassword,
  customPasswordValue,
  setCustomPasswordValue,
  submitCustomPassword,
  cancelEditPassword,
  rotatingPassword,
  handlePasswordClick,
  startEditPassword,
  setConfirmRotatePassword,
  confirmRotatePassword,
  noButtonRef,
  handleRepairDelivery,
  currentDelivery,
  passwordEditError,
}) {
  return (
    <>
            {password ? (
              /* Password card: the whole tile is a tap-to-copy
                 button. The regenerate action is a separate icon-
                 only refresh control absolutely positioned on the
                 right edge of the tile so an accidental tap on the
                 card body never rotates the password. The wrapper
                 div is non-interactive (the inner button owns the
                 tap target) which lets the refresh button live as
                 a sibling without nesting buttons. */
              <div
                className={`dd-card dd-card--password${flash === 'pass' ? ' is-flash' : ''}`}
                aria-label="Password actions"
              >
                {editingPassword ? (
                  <div className="dd-password-edit">
                    <span className="dd-eyebrow">Set Custom Password</span>
                    <input
                      type="text"
                      className="dd-password-input"
                      value={customPasswordValue}
                      onChange={(event) => setCustomPasswordValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') { event.preventDefault(); submitCustomPassword(); }
                        if (event.key === 'Escape') { event.preventDefault(); cancelEditPassword(); }
                      }}
                      placeholder="Enter a custom password"
                      aria-label="Custom password"
                      autoFocus
                      spellCheck="false"
                      autoComplete="off"
                    />
                    <div className="dd-password-edit-actions">
                      <button
                        type="button"
                        className="ghost-button compact"
                        onClick={submitCustomPassword}
                        disabled={rotatingPassword}
                      >
                        {rotatingPassword ? 'Saving\u2026' : 'Save'}
                      </button>
                      <button
                        type="button"
                        className="ghost-button compact"
                        onClick={cancelEditPassword}
                        disabled={rotatingPassword}
                      >
                        Cancel
                      </button>
                    </div>
                    {passwordEditError ? <span className="dd-card-hint">{passwordEditError}</span> : null}
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="dd-card-tap"
                      onClick={handlePasswordClick}
                      aria-label="Copy password to clipboard"
                    >
                      <span className="dd-eyebrow">Password</span>
                      <strong className="dd-card-strong">{password}</strong>
                      <span className="dd-card-hint">Tap to Copy</span>
                    </button>
                    <div className="dd-card-actions">
                      <button
                        type="button"
                        className="dd-icon-button dd-edit-button"
                        onClick={startEditPassword}
                        disabled={rotatingPassword}
                        aria-label="Set custom password"
                        title="Set Custom Password"
                      >
                        <EditIcon />
                      </button>
                      <button
                        type="button"
                        className="dd-icon-button dd-refresh-button"
                        onClick={() => setConfirmRotatePassword(true)}
                        disabled={rotatingPassword}
                        aria-label={rotatingPassword ? 'Regenerating Password' : 'Regenerate Password'}
                        title={rotatingPassword ? 'Regenerating Password' : 'Regenerate Password'}
                      >
                        <RefreshIcon />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="dd-card dd-card--muted" aria-label="No password">
                <span className="dd-eyebrow">Password</span>
                <strong className="dd-card-strong dd-card-strong--muted">&mdash;</strong>
                <span className="dd-card-hint">No password on this row.</span>
                {currentDelivery?.id ? (
                  <button
                    type="button"
                    className="ghost-button compact dd-repair-button"
                    onClick={() => handleRepairDelivery({ rotatePassword: true })}
                    disabled={rotatingPassword}
                  >
                    {rotatingPassword ? 'Regenerating...' : 'Generate Secure Password'}
                  </button>
                ) : null}
              </div>
            )}
            {confirmRotatePassword && (
              <div
                className="dd-confirm-overlay"
                style={{
                  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  zIndex: 9999,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '16px'
                }}
                onClick={() => setConfirmRotatePassword(false)}
              >
                <div
                  className="dd-confirm-modal"
                  style={{
                    backgroundColor: 'var(--bg, #fff)',
                    padding: '24px',
                    borderRadius: '16px',
                    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
                    minWidth: '280px',
                    maxWidth: '100%'
                  }}
                  onClick={(e) => e.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="confirm-title"
                >
                  <h3 id="confirm-title" style={{ margin: '0 0 24px', fontSize: '1.25rem', color: 'var(--ink)' }}>Change Password?</h3>
                  <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="ghost-button compact"
                      onClick={() => setConfirmRotatePassword(false)}
                      disabled={rotatingPassword}
                      ref={noButtonRef}
                    >
                      No
                    </button>
                    <button
                      type="button"
                      className="ghost-button compact"
                      style={{ color: 'var(--accent-2, red)', borderColor: 'var(--accent-2, red)' }}
                      onClick={() => {
                        setConfirmRotatePassword(false);
                        handleRepairDelivery({ rotatePassword: true });
                      }}
                      disabled={rotatingPassword}
                    >
                      Change
                    </button>
                  </div>
                </div>
              </div>
            )}
    </>
  );
}
