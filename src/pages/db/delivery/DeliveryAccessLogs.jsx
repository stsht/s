import { useState } from 'react';
import { DeleteIcon } from '../RecordRow.jsx';
import {
  visitorActionSummary,
  classifyAccessNetwork,
  accessActorType,
  isRealInAppBrowser,
  maskIpAddress,
  visitorWhenLabel,
  accessLogRowDetail,
  formatAccessLogStamp,
  accessLogEventLabel,
} from './deliveryHelpers.js';

function AccessLogVisitorCard({ visitor, onRequestDelete }) {
  const [open, setOpen] = useState(false);
  const actions = visitorActionSummary(visitor.events);
  const device = visitor.device;
  const rep = visitor.first || visitor.last || {};
  const network = classifyAccessNetwork(rep);
  const actor = accessActorType(visitor);
  const realApp = isRealInAppBrowser(rep.user_agent || visitor.last?.user_agent || '');
  const canDelete = typeof onRequestDelete === 'function';
  // Title identity, in priority order:
  //   1. Meta link-preview/scanner  -> "Meta Preview" (never counted
  //      as a real in-app open).
  //   2. A GENUINE in-app browser   -> the app label ("Instagram
  //      Browser" / "WhatsApp Browser") even if it rode a Meta IP.
  //   3. A known ISP / network owner-> that name ("Telkomsel",
  //      "Cloudflare / Proxy", "Apple Private Relay", ...).
  //   4. Otherwise                  -> the device/browser label.
  let headline;
  if (actor.key === 'meta') headline = actor.label || 'Meta Preview';
  else if (actor.key === 'proxy' && actor.label === 'Crawler') headline = 'Crawler';
  else if (realApp && device) headline = device;
  else headline = network.name || device || 'Unknown device';
  // Supporting line is always "City, Country · Browser/App · IP"
  // (IP masked here; full IP lives in the expanded rows). Keeping the
  // browser/app here even when it is also the title gives the operator
  // a consistent, scannable identity strip on every card.
  const support = [visitor.place, device, maskIpAddress(visitor.ip)]
    .filter(Boolean)
    .join(' · ');
  const whenLabel = visitorWhenLabel(visitor);
  // Expanded timeline reads newest-to-oldest to stay consistent with
  // the newest-first card ordering (events are stored chronological,
  // so reverse a copy here for display).
  const timelineRows = [...visitor.events].reverse();
  const toggle = () => setOpen((cur) => !cur);
  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      toggle();
    }
  };
  return (
    <article
      className={`dd-visitor-card${open ? ' is-open' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={toggle}
      onKeyDown={handleKeyDown}
    >
      {/* Summary row: the stacked text block on the left, and the
          clear (X) control on the right. align-items:center on the
          row keeps the X vertically centered against the WHOLE
          summary block (title + meta + when + actions), not just the
          title line — and it stays out of the expanded timeline. */}
      <div className="dd-visitor-head">
        <div className="dd-visitor-info">
          <div className="dd-visitor-titleline">
            <strong className="dd-visitor-name">{headline}</strong>
            {actor.label ? (
              <span className={`dd-visitor-pill is-${actor.key}`}>{actor.label}</span>
            ) : null}
          </div>
          {support ? <p className="dd-visitor-meta">{support}</p> : null}
          {whenLabel ? <p className="dd-visitor-when">{whenLabel}</p> : null}
          {actions.length ? <p className="dd-visitor-actions">{actions.join(' · ')}</p> : null}
        </div>
        {/* Per-card clear: removes ONLY this visitor/session's log
            rows, immediately (no confirm). stopPropagation on click +
            Enter/Space keeps the whole-card expand/collapse gesture
            from also firing. No separate expand arrow. */}
        {canDelete ? (
          <button
            type="button"
            className="dd-visitor-delete"
            onClick={(event) => {
              event.stopPropagation();
              onRequestDelete?.();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
                event.stopPropagation();
              }
            }}
            title="Clear this log"
            aria-label="Clear this log"
          >
            <DeleteIcon />
          </button>
        ) : null}
      </div>
      {open ? (
        <ol className="dd-visitor-timeline">
          {timelineRows.map((event, i) => {
            const type = String(event.event_type || '').toLowerCase();
            const strong = type === 'password_success' || type === 'service_click' || type === 'button_click';
            const weak = type === 'page_view';
            const detail = accessLogRowDetail(event);
            return (
              <li
                className={`dd-visitor-row${strong ? ' is-strong' : ''}${weak ? ' is-weak' : ''}`}
                key={`${event.id || i}-${event.created_at || ''}`}
              >
                <span className="dd-visitor-rowhead">
                  <span className="dd-visitor-stamp">{formatAccessLogStamp(event.created_at) || '—'}</span>
                  <span className="dd-visitor-dot" aria-hidden="true">{'·'}</span>
                  <span className="dd-visitor-event">{accessLogEventLabel(event.event_type, event.service)}</span>
                </span>
                {detail ? <span className="dd-visitor-detail">{detail}</span> : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </article>
  );
}

export function DeliveryAccessLogs({ accessSummaryText, accessVisitors, handleDeleteVisitor }) {
  return (
          <section className="dd-access-log" aria-label="Delivery access activity">
            <div className="dd-access-log-head">
              <p className="eyebrow">Access Activity</p>
              {accessSummaryText ? <span>{accessSummaryText}</span> : null}
            </div>
            {accessVisitors.length ? (
              <div className="dd-visitor-list">
                {accessVisitors.map((visitor, index) => (
                  <AccessLogVisitorCard
                    key={visitor.key || index}
                    visitor={visitor}
                    onRequestDelete={handleDeleteVisitor ? () => handleDeleteVisitor(visitor) : undefined}
                  />
                ))}
              </div>
            ) : (
              <p className="dd-access-log-empty">No activity yet.</p>
            )}
          </section>
  );
}
