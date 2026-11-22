import { useMemo, useState } from 'react';
import { DeleteIcon } from '../RecordRow.jsx';
import {
  visitorActionSummary,
  visitorPrimaryAction,
  classifyAccessNetwork,
  accessActorType,
  partitionAccessVisitors,
  visitorWhenLabel,
  accessLogRowDetail,
  formatAccessLogStamp,
  accessLogEventLabel,
  pluralCount,
} from './deliveryHelpers.js';

function AccessLogVisitorCard({ visitor, onRequestDelete }) {
  const [open, setOpen] = useState(false);
  const actions = visitorActionSummary(visitor.events);
  const rep = visitor.first || visitor.last || {};
  const network = classifyAccessNetwork(rep);
  const actor = accessActorType(visitor);
  const primaryAction = visitorPrimaryAction(visitor.events, actor);
  const extraActions = actions.filter((label) => label !== primaryAction);
  const canDelete = typeof onRequestDelete === 'function';

  // Organized profiling strip: Device · Browser · Location (no duplicates).
  const profileParts = [];
  if (visitor.platform) profileParts.push(visitor.platform);
  if (visitor.browser) profileParts.push(visitor.browser);
  else if (!visitor.platform && network.name) profileParts.push(network.name);
  else if (!visitor.platform && visitor.device) profileParts.push(visitor.device);
  if (visitor.place) profileParts.push(visitor.place);
  if (visitor.isp && !profileParts.includes(visitor.isp)) profileParts.push(visitor.isp);

  const fullIp = String(visitor.ip || '').trim();
  const whenLabel = visitorWhenLabel(visitor);
  const eventCount = Array.isArray(visitor.events) ? visitor.events.length : 0;

  // Expanded timeline reads newest-to-oldest to stay consistent with card order.
  const timelineRows = [...(visitor.events || [])].reverse();
  const toggle = () => setOpen((cur) => !cur);
  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      toggle();
    }
  };

  return (
    <article
      className={`dd-visitor-card is-actor-${actor.key}${open ? ' is-open' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={toggle}
      onKeyDown={handleKeyDown}
    >
      <div className="dd-visitor-head">
        <div className="dd-visitor-info">
          <div className="dd-visitor-toprow">
            <div className="dd-visitor-titleline">
              <span className={`dd-visitor-dot-status is-${actor.key}`} aria-hidden="true" />
              <strong className="dd-visitor-name">{primaryAction}</strong>
              {actor.label ? (
                <span className={`dd-visitor-pill is-${actor.key}`}>{actor.label}</span>
              ) : null}
            </div>
            <div className="dd-visitor-right">
              {whenLabel ? <span className="dd-visitor-when">{whenLabel}</span> : null}
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
                  title="Remove this session log"
                  aria-label="Remove this session log"
                >
                  <DeleteIcon />
                </button>
              ) : null}
            </div>
          </div>

          {profileParts.length ? (
            <p className="dd-visitor-profile">
              {profileParts.map((part, idx) => (
                <span key={`${part}-${idx}`} className="dd-visitor-profile-item">
                  {idx > 0 ? <span className="dd-visitor-sep" aria-hidden="true">·</span> : null}
                  <span>{part}</span>
                </span>
              ))}
              {eventCount > 1 ? (
                <span className="dd-visitor-profile-item dd-visitor-count">
                  <span className="dd-visitor-sep" aria-hidden="true">·</span>
                  <span>{pluralCount(eventCount, 'event')}</span>
                </span>
              ) : null}
            </p>
          ) : null}

          {extraActions.length ? (
            <p className="dd-visitor-trail">Also: {extraActions.join(' · ')}</p>
          ) : null}

          {fullIp ? (
            <p className="dd-visitor-ip-row">
              <span className="dd-visitor-ip-label">IP</span>
              <span className="dd-visitor-ip-val">{fullIp}</span>
            </p>
          ) : null}
        </div>
      </div>

      {open ? (
        <ol className="dd-visitor-timeline">
          {timelineRows.map((event, i) => {
            const type = String(event.event_type || '').toLowerCase();
            const strong = type === 'password_success' || type === 'service_click' || type === 'button_click'
              || type === 'invoice_fullscreen' || type === 'invoice_download'
              || type === 'payment_bank_copy' || type === 'payment_qr_download';
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

export function DeliveryAccessLogs({
  accessSummaryText,
  accessVisitors,
  handleDeleteVisitor,
  hideHead = false,
}) {
  const [showHidden, setShowHidden] = useState(false);
  const { human, bots, admin } = useMemo(
    () => partitionAccessVisitors(accessVisitors),
    [accessVisitors]
  );

  const hiddenCount = bots.length + admin.length;
  const hiddenLabelParts = [];
  if (bots.length) hiddenLabelParts.push(pluralCount(bots.length, 'link preview'));
  if (admin.length) hiddenLabelParts.push(pluralCount(admin.length, 'admin preview'));
  const hiddenToggleLabel = `${showHidden ? 'Hide' : 'Show'} ${hiddenLabelParts.join(' · ')}`;

  return (
    <section className="dd-access-log" aria-label="Delivery access activity">
      {!hideHead ? (
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
