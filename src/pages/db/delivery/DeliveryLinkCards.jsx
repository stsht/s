export function DeliveryLinkCards({
  shortUrl,
  adminOpenUrl,
  shortDisplay,
  flash,
  handleShortLinkClick,
  currentDelivery,
  handleRepairDelivery,
  repairing,
  repairStatus,
  services,
  editingLinks,
  passwordTools,
}) {
  return (
    <>
      <div className="dd-grid-2">
            {shortUrl ? (
              /* Short link card: the tile body is a tap-to-copy
                 button (.dd-card-tap) and a dedicated icon-only
                 "open in new tab" anchor sits on the right edge —
                 same wrapper pattern as the password card so an
                 accidental tap on the body never triggers the open
                 action and vice versa. The wrapper div is non-
                 interactive; the inner button owns the copy tap. */
              <div
                className={`dd-card dd-card--shortlink${flash === 'short' ? ' is-flash' : ''}`}
                aria-label="Short link actions"
              >
                <button
                  type="button"
                  className="dd-card-tap"
                  onClick={handleShortLinkClick}
                  aria-label="Copy short link"
                >
                  <span className="dd-eyebrow">Short Link</span>
                  <strong className="dd-card-strong">{shortDisplay}</strong>
                  <span className="dd-card-hint">Tap to Copy</span>
                </button>
                <a
                  className="dd-icon-button dd-open-button"
                  href={adminOpenUrl || shortUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  aria-label="Open short link in new tab"
                  title="Open in New Tab"
                >
                  <ExternalLinkIcon />
                </a>
              </div>
            ) : (
              <div className="dd-card dd-card--muted" aria-label="Legacy short link unavailable">
                <span className="dd-eyebrow">Short Link</span>
                <strong className="dd-card-strong dd-card-strong--muted">Legacy Link Unavailable</strong>
                <span className="dd-card-hint">No 12-char short code on this row.</span>
                {currentDelivery?.id ? (
                  <button
                    type="button"
                    className="ghost-button compact dd-repair-button"
                    onClick={() => handleRepairDelivery()}
                    disabled={repairing}
                  >
                    {repairing ? 'Repairing...' : 'Repair Secure Link'}
                  </button>
                ) : null}
                {repairStatus ? <span className="dd-card-hint">{repairStatus}</span> : null}
              </div>
            )}
        {passwordTools}
      </div>
      {!editingLinks && services.length ? (
            <div className="dd-services">
              {services.map(({ key, label, url }) => (
                <a
                  key={key}
                  className="dd-card dd-card--action dd-service-card"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="dd-service-head">
                    <span className="dd-chip">{key.toUpperCase()}</span>
                    <span className="dd-service-label">{label}</span>
                  </span>
                  <span className="dd-service-url">{url}</span>
                </a>
              ))}
            </div>
      ) : null}
    </>
  );
}

// Open-in-new-tab (external link) glyph for the short link card.
// Same 14x14 stroke-only family as RefreshIcon so the two right-edge
// card actions read as one icon set; picks up `currentColor` for the
// idle/hover palette from CSS.
function ExternalLinkIcon() {
  return (
    <svg
      className="btn-icon"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  );
}
