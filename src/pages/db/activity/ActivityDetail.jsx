import { useEffect, useMemo, useRef, useState } from 'react';
import { compactEventDateLabel } from '../dbHelpers.js';
import { DeliveryAccessLogs } from '../delivery/DeliveryAccessLogs.jsx';
import {
  groupAccessLogsByVisitor,
  partitionAccessVisitors,
  summarizeAccessLogs,
} from '../delivery/deliveryHelpers.js';

function ActivityFolderMarquee({ text }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const [overflowing, setOverflowing] = useState(false);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const measure = () => {
      const outer = outerRef.current;
      const inner = innerRef.current;
      if (!outer || !inner) return;
      const overflowDistance = Math.max(0, inner.scrollWidth - outer.clientWidth);
      const nextOverflowing = overflowDistance > 8;
      setOverflowing(nextOverflowing);
      setDistance(nextOverflowing ? overflowDistance + 48 : 0);
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
      <span ref={innerRef} style={{ '--activity-marquee-distance': `${distance}px` }}>{text}</span>
    </div>
  );
}

export function ActivityDetail({ activity, onClose, onRefresh }) {
  const delivery = activity?.delivery || activity || {};
  const deliveryId = activity?.deliveryId || delivery?.id || '';
  const sourceLogs = Array.isArray(activity?.logs)
    ? activity.logs
    : Array.isArray(delivery?.stats?.logs)
      ? delivery.stats.logs
      : [];

  const [removedIds, setRemovedIds] = useState(() => new Set());
  const [deletingVisitor, setDeletingVisitor] = useState(false);

  // Reset optimistic removals when switching to a different delivery.
  useEffect(() => {
    setRemovedIds(new Set());
  }, [deliveryId]);

  const logs = useMemo(
    () => (removedIds.size ? sourceLogs.filter((log) => !removedIds.has(log?.id)) : sourceLogs),
    [sourceLogs, removedIds]
  );

  const accessVisitors = useMemo(() => groupAccessLogsByVisitor(logs), [logs]);
  const { human } = useMemo(() => partitionAccessVisitors(accessVisitors), [accessVisitors]);
  const accessStats = useMemo(() => summarizeAccessLogs(logs, { excludeNoise: true }), [logs]);

  const statusTone = accessStats.clicks > 0
    ? { key: 'clicked', label: 'Gallery Accessed' }
    : accessStats.unlocked > 0
      ? { key: 'unlocked', label: 'Unlocked' }
      : human.length > 0
        ? { key: 'opened', label: 'Gate Only' }
        : { key: 'idle', label: 'No Client Visits' };

  const name = String(activity?.client_name || delivery?.client_name || 'Delivery').trim();
  const folder = String(activity?.folder_name || delivery?.folder_name || delivery?.base_slug || '').trim();
  const type = String(activity?.deliveryType || delivery?.type || '').trim().toLowerCase() === 'vendor' ? 'Vendor' : 'Client';
  const dateLabel = compactEventDateLabel(activity?.event_date || delivery?.event_date || '');
  const shortCode = String(activity?.short_code || delivery?.short_code || '').trim();
  const shortHref = shortCode ? `/${shortCode}` : '';

  async function handleDeleteVisitor(target) {
    const logIds = (target?.events || []).map((event) => event.id).filter(Boolean);
    if (!deliveryId || !logIds.length || deletingVisitor) return;
    setDeletingVisitor(true);
    try {
      const response = await fetch('/api/db-clear-logs', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deliveryId, logIds }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || `Delete failed (${response.status}).`);
      setRemovedIds((prev) => {
        const next = new Set(prev);
        for (const id of logIds) next.add(id);
        return next;
      });
      onRefresh?.();
    } catch {
      // Keep existing state if the request fails.
    } finally {
      setDeletingVisitor(false);
    }
  }

  return (
    <div className="activity-detail-view">
      <div className="activity-detail-heading">
        <div className="activity-detail-titleblock">
          <p className="eyebrow">Activity Log</p>
          <h2>{name}</h2>
          {folder ? <ActivityFolderMarquee text={folder} /> : null}
          <p className="activity-detail-meta">{[`${type} Delivery`, dateLabel].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="activity-detail-head-actions">
          {shortHref ? (
            <a className="activity-short-link" href={shortHref} target="_blank" rel="noopener noreferrer">
              /{shortCode}
            </a>
          ) : null}
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
      </div>

      <section className="activity-kpi-strip" aria-label="Client activity summary">
        <div className="activity-kpi-metrics">
          <div className="activity-kpi-item">
            <strong>{human.length}</strong>
            <span>{human.length === 1 ? 'Visitor' : 'Visitors'}</span>
          </div>
          <span className="activity-kpi-divider" aria-hidden="true" />
          <div className="activity-kpi-item">
            <strong>{accessStats.opens}</strong>
            <span>{accessStats.opens === 1 ? 'Open' : 'Opens'}</span>
          </div>
          <span className="activity-kpi-divider" aria-hidden="true" />
          <div className="activity-kpi-item">
            <strong>{accessStats.clicks}</strong>
            <span>{accessStats.clicks === 1 ? 'Click' : 'Clicks'}</span>
          </div>
        </div>
        <span className={`activity-status-chip is-${statusTone.key}`}>{statusTone.label}</span>
      </section>

      <DeliveryAccessLogs
        accessVisitors={accessVisitors}
        handleDeleteVisitor={deliveryId ? handleDeleteVisitor : undefined}
        hideHead
      />
    </div>
  );
}
