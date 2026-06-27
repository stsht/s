import { useEffect, useMemo, useRef, useState } from 'react';
import { compactEventDateLabel } from '../dbHelpers.js';
import { DeliveryAccessLogs } from '../delivery/DeliveryAccessLogs.jsx';
import {
  groupAccessLogsByVisitor,
  summarizeAccessLogs,
  pluralCount,
} from '../delivery/deliveryHelpers.js';

function ActivityFolderMarquee({ text }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const measure = () => {
      const outer = outerRef.current;
      const inner = innerRef.current;
      if (!outer || !inner) return;
      setOverflowing(inner.scrollWidth > outer.clientWidth + 8);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [text]);

  return (
    <div
      className={`activity-folder-marquee${overflowing ? ' is-overflowing' : ''}`}
      title={text}
      ref={outerRef}
    >
      <span ref={innerRef}>{text}</span>
    </div>
  );
}

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
  const shortHref = shortCode ? `/${shortCode}` : '';

  return (
    <>
      <div className="activity-detail-heading">
        <div className="activity-detail-titleblock">
          <p className="eyebrow">Activity Log</p>
          <h2>{name}</h2>
          {folder ? <ActivityFolderMarquee text={folder} /> : null}
          <p className="activity-detail-meta">{[`${type} Delivery`, dateLabel].filter(Boolean).join(' · ')}</p>
        </div>
        <button
          type="button"
          className="db-close-button activity-close-button"
          onClick={onClose}
          aria-label="Close activity detail"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <section className="activity-last-card" aria-label="Latest activity summary">
        <p className="eyebrow">Last Activity</p>
        <div>
          <strong>{activity?.lastActivityLabel || 'Latest delivery activity'}</strong>
          <span>{activity?.lastActivityDisplay || 'No recent time'}</span>
        </div>
        {shortHref ? (
          <a className="activity-short-link" href={shortHref} target="_blank" rel="noopener noreferrer">
            /{shortCode}
          </a>
        ) : null}
      </section>
      <DeliveryAccessLogs
        accessSummaryText={accessSummaryText}
        accessVisitors={accessVisitors}
      />
    </>
  );
}
