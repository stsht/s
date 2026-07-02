import { useEffect, useMemo, useRef, useState } from 'react';
import { plainEventDate } from '../dbHelpers.js';
import {
  resolveDeliveryShortCode,
  buildShortUrl,
  synthesizeDeliveryMessageWa,
  synthesizeDeliveryMessageIg,
  groupAccessLogsByVisitor,
  summarizeAccessLogs,
  pluralCount,
  copyToClipboard,
  SERVICE_LABELS,
} from './deliveryHelpers.js?v=pending-message-20260702';
import { DeliveryHeader } from './DeliveryHeader.jsx';
import { DeliveryLinkCards } from './DeliveryLinkCards.jsx';
import { DeliveryPasswordTools } from './DeliveryPasswordTools.jsx';
import { DeliveryLinkEditor } from './DeliveryLinkEditor.jsx';
import { DeliveryMessageBox } from './DeliveryMessageBox.jsx';
import { DeliveryAccessLogs } from './DeliveryAccessLogs.jsx';

export function DeliveryDetail({ delivery, onClose, onRepaired, onDeleted, onRefresh }) {
  const [currentDelivery, setCurrentDelivery] = useState(delivery || {});
  const [variant, setVariant] = useState('whatsapp');
  const [flash, setFlash] = useState('');
  const [repairing, setRepairing] = useState(false);
  const [rotatingPassword, setRotatingPassword] = useState(false);
  const [editingLinks, setEditingLinks] = useState(false);
  const [linkDraft, setLinkDraft] = useState({});
  const [savingLinks, setSavingLinks] = useState(false);
  const [repairStatus, setRepairStatus] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [markingDone, setMarkingDone] = useState(false);
  const [confirmRotatePassword, setConfirmRotatePassword] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);
  const [customPasswordValue, setCustomPasswordValue] = useState('');
  const [passwordEditError, setPasswordEditError] = useState('');
  const [deletingVisitor, setDeletingVisitor] = useState(false);
  const noButtonRef = useRef(null);

  useEffect(() => {
    if (confirmRotatePassword && noButtonRef.current) noButtonRef.current.focus();
  }, [confirmRotatePassword]);

  useEffect(() => {
    if (!confirmRotatePassword) return undefined;
    function handleKeyDown(e) {
      if (e.key === 'Escape') setConfirmRotatePassword(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [confirmRotatePassword]);

  useEffect(() => {
    const incoming = delivery || {};
    setCurrentDelivery((prev) => {
      const sameRow = String(prev?.id || '') === String(incoming.id || '');
      const incomingPwd = String(incoming.password || '').trim();
      const prevPwd = String(prev?.password || '').trim();
      if (sameRow && !incomingPwd && prevPwd) return { ...incoming, password: prev.password };
      return incoming;
    });
  }, [delivery]);

  useEffect(() => {
    setRepairStatus('');
    setConfirmDelete(false);
    setConfirmRotatePassword(false);
    setEditingPassword(false);
    setCustomPasswordValue('');
    setPasswordEditError('');
  }, [delivery?.id]);

  useEffect(() => {
    if (!confirmDelete) return undefined;
    const id = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(id);
  }, [confirmDelete]);

  const title = String(currentDelivery?.title ?? 'Ms.').trim() ?? 'Ms.';
  const clientName = String(currentDelivery?.client_name || 'Client').trim() || 'Client';
  const isVendorDelivery =
    String(currentDelivery?.type || '').toLowerCase() === 'vendor'
    || String(currentDelivery?.title ?? '').trim() === '';
  const folder =
    String(currentDelivery?.folder_name || '').trim() ||
    String(currentDelivery?.gallery_code || '').trim() ||
    String(currentDelivery?.base_slug || '').trim();
  const password = String(currentDelivery?.password || '').trim();
  const shortCode = resolveDeliveryShortCode(currentDelivery);
  const shortUrl = buildShortUrl(shortCode);
  const shortDisplay = shortUrl.replace(/^https?:\/\//, '');

  const linkRows = Array.isArray(currentDelivery?.links) ? currentDelivery.links : [];
  const byService = new Map();
  for (const link of linkRows) {
    const service = String(link?.service || '').toLowerCase();
    const url = String(link?.original_url || '').trim();
    if (service && url && !byService.has(service)) byService.set(service, url);
  }
  const services = SERVICE_LABELS
    .filter(({ key }) => byService.has(key))
    .map((service) => ({ ...service, url: byService.get(service.key) }));

  useEffect(() => {
    const next = {};
    for (const { key } of SERVICE_LABELS) next[key] = byService.get(key) || '';
    next.folderName = String(currentDelivery?.folder_name || '').trim();
    next.eventDate = plainEventDate(currentDelivery?.event_date);
    next.clientName = String(currentDelivery?.client_name || '').trim();
    setLinkDraft(next);
  }, [currentDelivery]);

  const deliveryDone = !!currentDelivery?.delivery_done;
  const messageWa = synthesizeDeliveryMessageWa(title, clientName, folder, currentDelivery?.event_date, shortUrl, password, deliveryDone);
  const messageIg = synthesizeDeliveryMessageIg(title, clientName, folder, currentDelivery?.event_date, shortUrl, password, deliveryDone);
  const messageText = variant === 'instagram' ? messageIg : messageWa;
  const hasAnyDetail = !!password || !!shortUrl || services.length > 0;

  const accessLogs = Array.isArray(currentDelivery?.stats?.logs) ? currentDelivery.stats.logs : [];
  const accessVisitors = useMemo(() => groupAccessLogsByVisitor(accessLogs), [accessLogs]);
  const accessStats = useMemo(() => summarizeAccessLogs(accessLogs), [accessLogs]);
  const accessSummaryText = [
    pluralCount(accessVisitors.length, 'visitor'),
    pluralCount(accessStats.opens, 'open'),
    pluralCount(accessStats.clicks, 'click'),
    accessStats.lastActivity ? `Last activity ${accessStats.lastActivity}` : '',
  ].filter(Boolean).join(' · ');

  const flashTarget = (target) => {
    setFlash(target);
    setTimeout(() => setFlash((cur) => (cur === target ? '' : cur)), 700);
  };

  async function handleShortLinkClick() {
    if (!shortUrl) return;
    await copyToClipboard(shortUrl);
    flashTarget('short');
  }

  async function handlePasswordClick() {
    if (!password) return;
    await copyToClipboard(password);
    flashTarget('pass');
  }

  async function handleCopyMessage(which) {
    const text = which === 'instagram' ? messageIg : messageWa;
    if (!text) return;
    await copyToClipboard(text);
    flashTarget(`msg-${which}`);
  }

  async function handleRefresh() {
    if (refreshing || !currentDelivery?.id) return;
    setRefreshing(true);
    setRepairStatus('Refreshing…');
    try {
      await onRefresh?.();
      setRepairStatus('Delivery refreshed.');
    } catch (error) {
      setRepairStatus(error?.message || 'Refresh failed.');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleRepairDelivery(options = {}) {
    if (!currentDelivery?.id) return;
    const rotatePassword = Boolean(options.rotatePassword);
    const customPassword = typeof options.customPassword === 'string' ? options.customPassword.trim() : '';
    if (rotatePassword || customPassword) setRotatingPassword(true);
    else setRepairing(true);
    setRepairStatus('');
    try {
      const response = await fetch('/api/db-repair-delivery', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: currentDelivery.id,
          rotatePassword,
          ...(customPassword ? { customPassword } : {}),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || `Repair failed (${response.status}).`);
      const repaired = {
        ...currentDelivery,
        ...(json.delivery || {}),
        password: json.password || json.delivery?.password || currentDelivery.password || '',
        short_code: json.shortCode || json.delivery?.short_code || currentDelivery.short_code || '',
        short_url: json.shortUrl || json.delivery?.short_url || '',
        delivery_url: json.shortUrl || json.delivery?.delivery_url || '',
        generated_text_whatsapp: json.generatedText || json.delivery?.generated_text_whatsapp || currentDelivery.generated_text_whatsapp || '',
        generated_text_instagram: json.delivery?.generated_text_instagram || json.generatedText || currentDelivery.generated_text_instagram || '',
        needs_secure_repair: false,
      };
      setCurrentDelivery(repaired);
      if (customPassword) {
        setEditingPassword(false);
        setCustomPasswordValue('');
        setPasswordEditError('');
      }
      setRepairStatus(customPassword ? 'Custom password saved.' : (rotatePassword ? 'Password regenerated and hashed.' : 'Secure short link repaired.'));
      onRepaired?.(repaired);
    } catch (error) {
      setRepairStatus(error?.message || 'Repair failed.');
    } finally {
      setRepairing(false);
      setRotatingPassword(false);
    }
  }

  function startEditPassword() {
    setCustomPasswordValue(password);
    setPasswordEditError('');
    setEditingPassword(true);
  }

  function cancelEditPassword() {
    setEditingPassword(false);
    setCustomPasswordValue('');
    setPasswordEditError('');
  }

  function submitCustomPassword() {
    const value = String(customPasswordValue || '').trim();
    if (!value) {
      setPasswordEditError('Password cannot be empty.');
      return;
    }
    if (value.length > 72) {
      setPasswordEditError('Use 72 characters or fewer.');
      return;
    }
    setPasswordEditError('');
    handleRepairDelivery({ customPassword: value });
  }

  async function handleSaveLinks(event) {
    event.preventDefault();
    if (!currentDelivery?.id) return;
    setSavingLinks(true);
    setRepairStatus('');
    try {
      const trimmedFolder = String(linkDraft.folderName || '').trim();
      const draftEventDate = String(linkDraft.eventDate || '').trim();
      const trimmedVendorName = String(linkDraft.clientName || '').trim();
      const response = await fetch('/api/db-update-delivery', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: currentDelivery.id,
          folderName: trimmedFolder,
          eventDate: /^\d{4}-\d{2}-\d{2}$/.test(draftEventDate) ? draftEventDate : '',
          ...(isVendorDelivery && trimmedVendorName ? { clientName: trimmedVendorName } : {}),
          links: SERVICE_LABELS.map(({ key }) => ({
            service: key,
            originalUrl: linkDraft[key] || '',
            link_done: !!currentDelivery?.delivery_done,
          })),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || `Save failed (${response.status}).`);
      const updated = {
        ...currentDelivery,
        ...(json.delivery || {}),
        links: Array.isArray(json.delivery?.links) ? json.delivery.links : currentDelivery.links,
      };
      setCurrentDelivery(updated);
      setEditingLinks(false);
      setRepairStatus('Delivery links updated.');
      onRepaired?.(updated);
    } catch (error) {
      setRepairStatus(error?.message || 'Save failed.');
    } finally {
      setSavingLinks(false);
    }
  }

  async function handleDeleteLinks() {
    if (!currentDelivery?.id || deleting) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setConfirmDelete(false);
    setDeleting(true);
    setRepairStatus('');
    try {
      const response = await fetch('/api/db-delete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentDelivery.id }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || `Delete failed (${response.status}).`);
      onDeleted?.(currentDelivery);
    } catch (error) {
      setRepairStatus(error?.message || 'Delete failed.');
      setDeleting(false);
    }
  }

  async function handleDeleteVisitor(target) {
    const logIds = (target?.events || []).map((event) => event.id).filter(Boolean);
    if (!currentDelivery?.id || !logIds.length || deletingVisitor) return;
    setDeletingVisitor(true);
    setRepairStatus('');
    try {
      const response = await fetch('/api/db-clear-logs', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentDelivery.id, logIds }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || `Delete failed (${response.status}).`);
      const removeSet = new Set(logIds);
      setCurrentDelivery((prev) => {
        const logs = Array.isArray(prev?.stats?.logs) ? prev.stats.logs : [];
        return { ...prev, stats: { ...(prev?.stats || {}), logs: logs.filter((log) => !removeSet.has(log.id)) } };
      });
    } catch (error) {
      setRepairStatus(error?.message || 'Delete failed.');
    } finally {
      setDeletingVisitor(false);
    }
  }

  async function handleToggleDone() {
    if (!currentDelivery?.id || markingDone) return;
    const nextDone = !currentDelivery.delivery_done;
    setMarkingDone(true);
    setRepairStatus('');
    try {
      const response = await fetch('/api/db-update-delivery', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentDelivery.id, deliveryDone: nextDone }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || `Update failed (${response.status}).`);
      const updated = {
        ...currentDelivery,
        ...(json.delivery || {}),
        delivery_done: json.delivery?.delivery_done ?? nextDone,
        links: Array.isArray(json.delivery?.links) ? json.delivery.links : currentDelivery.links,
      };
      setCurrentDelivery(updated);
      setRepairStatus(updated.delivery_done ? 'Delivery marked done.' : 'Delivery reopened.');
      onRepaired?.(updated);
    } catch (error) {
      setRepairStatus(error?.message || 'Update failed.');
    } finally {
      setMarkingDone(false);
    }
  }

  return (
    <>
      <DeliveryHeader
        title={title}
        clientName={clientName}
        folder={folder}
        currentDelivery={currentDelivery}
        deliveryDone={deliveryDone}
        handleRefresh={handleRefresh}
        refreshing={refreshing}
        handleToggleDone={handleToggleDone}
        markingDone={markingDone}
        editingLinks={editingLinks}
        setEditingLinks={setEditingLinks}
        handleDeleteLinks={handleDeleteLinks}
        confirmDelete={confirmDelete}
        deleting={deleting}
        onClose={onClose}
      />
      {!hasAnyDetail ? (
        <p className="empty-state">No delivery details available.</p>
      ) : (
        <div className="dd-stack">
          <DeliveryLinkCards
            shortUrl={shortUrl}
            shortDisplay={shortDisplay}
            flash={flash}
            handleShortLinkClick={handleShortLinkClick}
            currentDelivery={currentDelivery}
            handleRepairDelivery={handleRepairDelivery}
            repairing={repairing}
            repairStatus={repairStatus}
            services={services}
            editingLinks={editingLinks}
            passwordTools={(
              <DeliveryPasswordTools
                password={password}
                flash={flash}
                editingPassword={editingPassword}
                customPasswordValue={customPasswordValue}
                setCustomPasswordValue={setCustomPasswordValue}
                submitCustomPassword={submitCustomPassword}
                cancelEditPassword={cancelEditPassword}
                rotatingPassword={rotatingPassword}
                handlePasswordClick={handlePasswordClick}
                startEditPassword={startEditPassword}
                setConfirmRotatePassword={setConfirmRotatePassword}
                confirmRotatePassword={confirmRotatePassword}
                noButtonRef={noButtonRef}
                handleRepairDelivery={handleRepairDelivery}
                currentDelivery={currentDelivery}
                passwordEditError={passwordEditError}
              />
            )}
          />
          {editingLinks ? (
            <DeliveryLinkEditor
              linkDraft={linkDraft}
              setLinkDraft={setLinkDraft}
              savingLinks={savingLinks}
              repairStatus={repairStatus}
              handleSaveLinks={handleSaveLinks}
              setEditingLinks={setEditingLinks}
              isVendorDelivery={isVendorDelivery}
            />
          ) : null}
          <DeliveryMessageBox
            variant={variant}
            setVariant={setVariant}
            messageText={messageText}
            flash={flash}
            handleCopyMessage={handleCopyMessage}
          />
          <DeliveryAccessLogs
            accessSummaryText={accessSummaryText}
            accessVisitors={accessVisitors}
            handleDeleteVisitor={handleDeleteVisitor}
          />
        </div>
      )}
    </>
  );
}
