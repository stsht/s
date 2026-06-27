import { useMemo } from 'react';
import { compactEventDateLabel } from '../dbHelpers.js';
import { DeliveryAccessLogs } from '../delivery/DeliveryAccessLogs.jsx';
import {
  groupAccessLogsByVisitor,
  summarizeAccessLogs,
  pluralCount,
} from '../delivery/deliveryHelpers.js';

export function ActivityDetail({ activity, onClose }) {
  const delivery = activity?.delivery || activity || {};
  const logs = Array.isArray(activity?.logs)
    ? activity.logs
    : Array.isArray(delivery?.stats?.logs)
      ? delivery.stats.logs
      : [];
  const accessVisitors = useMemo(() => groupAccessLogsByVisitor(logs), [logs]);
  const accessStats = useMemo(() => summarizeAccessLogs(logs), [logs]);
  const accessSummaryText = [
    pluralCount(accessVisitors.length, 'visitor'),
    pluralCount(accessStats.opens, 'open'),
    pluralCount(accessStats.clicks, 'click'),
    accessStats.lastActivity ? `Last activity ${accessStats.lastActivity}` : '',
  ].filter(Boolean).join(' · ');

  const name = String(activity?.client_name || delivery?.client_name || 'Delivery').trim();
  const folder = String(activity?.folder_name || delivery?.folder_name || delivery?.base_slug || '').trim();
  const type = String(activity?.deliveryType || delivery?.type || '').trim().toLowerCase() === 'vendor' ? 'Vendor' : 'Client';
  const dateLabel = compactEventDateLabel(activity?.event_date || delivery?.event_date || '');
  const shortCode = String(activity?.short_code || delivery?.short_code || '').trim();

  return (
    <>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Activity Log</p>
          <h2>{name}</h2>
          <span>{[type, folder || 'No folder name', dateLabel].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="detail-actions">
          <button
            type="button"
            className="db-close-button"
            onClick={onClose}
            aria-label="Close activity detail"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      <div className="list-stack">
        <article className="list-row">
          <div>
            <strong>{activity?.lastActivityDisplay || 'No recent time'}</strong>
            <span>{activity?.lastActivityLabel || 'Latest delivery activity'}</span>
          </div>
          {shortCode ? <b>/{shortCode}</b> : null}
        </article>
      </div>
      <DeliveryAccessLogs
        accessSummaryText={accessSummaryText}
        accessVisitors={accessVisitors}
      />
    </>
  );
}
