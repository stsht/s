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

// Admin-only delivery detail rendered in /db's right panel after
// clicking "View Links" on a saved client event. Shows the
// operator everything needed to re-share a delivery without
// hopping to the public /{shortcode} page or digging through the
// database: client greeting, folder/gallery name, plain password,
// the full short link, any original Google Drive / Dropbox /
// WeTransfer URLs that were stored when the
// delivery was composed, plus tap-to-copy/share controls and the
// stored WhatsApp/Instagram message templates.
//
// Tap behaviour:
//   • Short Link card  → copies URL to clipboard.
//   • Password card    → copies password to clipboard.
//   • Service cards    → opens the original GD/DB/WT/TN link.
//   • Copy WA / Copy IG → copies the displayed message variant.
//
// Source-of-truth fields come from /api/db's `items[]` payload
// (handleDbSearch in _worker.js). When the row is too old to
// carry a 12-char short_code, the panel offers an admin repair
// action instead of showing a broken root URL.
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
  // Refresh-in-flight flag for the detail-header Refresh button.
  // Refresh only re-pulls /api/db data (via onRefresh) and lets the
  // derived selectedDelivery rehydrate this panel — it never rotates
  // or regenerates the password.
  const [refreshing, setRefreshing] = useState(false);
  // Delete confirmation lives inside the detail panel only — the
  // left-panel client row and event-row X stay their existing
  // one-/two-tap controls. First click arms the Delete button (red
  // fill), a second click within ~4s issues the actual delete of
  // ONLY this delivery (links + access logs) via /api/db-delete —
  // the paired invoice on the same event row is untouched. Auto-
  // disarms on timeout or when the panel swaps to another delivery.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Mark-done toggle in-flight flag. The done state itself lives on
  // currentDelivery.delivery_done so it tracks the saved row and the
  // parent refetch; markingDone only gates the button while the
  // PATCH is resolving.
  const [markingDone, setMarkingDone] = useState(false);
  const [confirmRotatePassword, setConfirmRotatePassword] = useState(false);
  // Inline custom-password editor (pencil control on the password
  // card). editingPassword toggles the inline input; customPasswordValue
  // holds the in-flight value; passwordEditError surfaces client-side
  // validation before the request is sent.
  const [editingPassword, setEditingPassword] = useState(false);
  const [customPasswordValue, setCustomPasswordValue] = useState('');
  const [passwordEditError, setPasswordEditError] = useState('');
  // Per-card access-log clear in-flight gate. Clicking a visitor
  // card's X clears ONLY that session's log rows immediately (no
  // confirm dialog); deletingVisitor just prevents overlapping
  // requests while one delete is resolving.
  const [deletingVisitor, setDeletingVisitor] = useState(false);
  const noButtonRef = useRef(null);

  useEffect(() => {
    if (confirmRotatePassword && noButtonRef.current) {
      noButtonRef.current.focus();
    }
  }, [confirmRotatePassword]);

  useEffect(() => {
    if (!confirmRotatePassword) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') setConfirmRotatePassword(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [confirmRotatePassword]);

  // Hydrate the editable copy from the freshest delivery row the
  // parent hands down (selectedDelivery, derived from /api/db
  // data.items). Runs whenever that row changes — including after a
  // Refresh or a password regenerate refetch — so the open panel
  // never holds stale data and never needs a close/reopen. Guard:
  // a blank incoming password never overwrites a non-empty password
  // we already hold, so a transient empty row from /api/db (or a
  // refetch landing a tick before the repair write is visible) can't
  // blank a known-good password.
  useEffect(() => {
    const incoming = delivery || {};
    setCurrentDelivery((prev) => {
      const sameRow = String(prev?.id || '') === String(incoming.id || '');
      const incomingPwd = String(incoming.password || '').trim();
      const prevPwd = String(prev?.password || '').trim();
      if (sameRow && !incomingPwd && prevPwd) {
        return { ...incoming, password: prev.password };
      }
      return incoming;
    });
  }, [delivery]);

  // Reset transient panel UI only when the parent swaps to a
  // DIFFERENT delivery, so a same-row Refresh/regenerate keeps the
  // current status line (e.g. "Delivery refreshed.") and any open
  // editor instead of flickering them away on every data update.
  useEffect(() => {
    setRepairStatus('');
    setConfirmDelete(false);
    setConfirmRotatePassword(false);
    setEditingPassword(false);
    setCustomPasswordValue('');
    setPasswordEditError('');
  }, [delivery?.id]);

  // Auto-disarm the Delete confirm after ~4s so an accidental first
  // click never sits in a hot state.
  useEffect(() => {
    if (!confirmDelete) return undefined;
    const id = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(id);
  }, [confirmDelete]);

  const title = String(currentDelivery?.title ?? 'Ms.').trim() ?? 'Ms.';
  const clientName = String(currentDelivery?.client_name || 'Client').trim() || 'Client';
  // Vendor deliveries carry an empty title (the /l vendor flow saves
  // title:'') and the /api/db item also exposes an explicit type.
  // Either signal marks a vendor delivery, for which Edit Links
  // exposes a Vendor Name field. Client deliveries always carry a
  // title and never show that field, so this path never renames a
  // client delivery.
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
  // Display-only label for the short link card. Strip the protocol
  // so a 12-char URL fits on one line at smaller widths.
  const shortDisplay = shortUrl.replace(/^https?:\/\//, '');

  const linkRows = Array.isArray(currentDelivery?.links) ? currentDelivery.links : [];
  const byService = new Map();
  for (const link of linkRows) {
    const service = String(link?.service || '').toLowerCase();
    const url = String(link?.original_url || '').trim();
    if (service && url && !byService.has(service)) {
      byService.set(service, url);
    }
  }
  const services = SERVICE_LABELS
    .filter(({ key }) => byService.has(key))
    .map((s) => ({
      ...s,
      url: byService.get(s.key),
    }));

  useEffect(() => {
    const next = {};
    for (const { key } of SERVICE_LABELS) {
      next[key] = byService.get(key) || '';
    }
    // Folder Name shares the same draft so a single Save Links
    // submission can ship both link rebuilds and a folder_name
    // PATCH in one request.
    next.folderName = String(currentDelivery?.folder_name || '').trim();
    next.eventDate = plainEventDate(currentDelivery?.event_date);
    // Vendor name (only surfaced/sent for vendor deliveries). Seeded
    // from the delivery's client_name so a vendor rename is a small
    // edit; client deliveries never expose this field.
    next.clientName = String(currentDelivery?.client_name || '').trim();
    setLinkDraft(next);
  }, [currentDelivery]);

  // Both WA and IG are synthesised from the CURRENT delivery fields
  // at display/copy time, so older saved rows (which may carry a
  // Folder line or stale formatting in generated_text_*) never leak
  // to the client. WA keeps markdown; IG is the same text stripped.
  const deliveryDone = !!currentDelivery?.delivery_done;
  const synthWa = synthesizeDeliveryMessageWa(title, clientName, folder, currentDelivery?.event_date, shortUrl, password, deliveryDone);
  const synthIg = synthesizeDeliveryMessageIg(title, clientName, folder, currentDelivery?.event_date, shortUrl, password, deliveryDone);
  const messageWa = synthWa;
  const messageIg = synthIg;

  const accessLogs = Array.isArray(currentDelivery?.stats?.logs)
    ? currentDelivery.stats.logs
    : [];
  // Group the flat public log into per-visitor cards and derive the
  // compact summary header (visitors / opens / clicks / last
  // activity). Memoised so re-renders from unrelated state (copy
  // flashes, variant toggles) don't re-walk the log array.
  const accessVisitors = useMemo(() => groupAccessLogsByVisitor(accessLogs), [accessLogs]);
  const accessStats = useMemo(() => summarizeAccessLogs(accessLogs), [accessLogs]);
  // Compact header summary. Always rendered (even at zero) so the
  // header reads "0 visitors · 0 opens · 0 clicks" both on a
  // delivery with no public activity yet AND immediately after the
  // operator deletes the logs. Last activity is appended only when
  // there is real public activity to point at.
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

  const messageText = variant === 'instagram' ? messageIg : messageWa;
  const hasAnyDetail = !!password || !!shortUrl || services.length > 0;

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
  // Refresh ONLY: re-pull fresh /api/db data via the parent and let
  // the derived selectedDelivery rehydrate this open panel in place.
  // It never rotates/regenerates the password and never edits links
  // — if the password is still missing afterwards, the existing
  // "Generate Secure Password" action remains the repair path.
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
    const customPassword = typeof options.customPassword === 'string' ? customPassword.trim() : '';
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
      if (!response.ok || !json.ok) {
        throw new Error(json.error || `Repair failed (${response.status}).`);
      }
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
      setRepairStatus(
        customPassword
          ? 'Custom password saved.'
          : (rotatePassword ? 'Password regenerated and hashed.' : 'Secure short link repaired.')
      );
      onRepaired?.(repaired);
    } catch (error) {
      setRepairStatus(error?.message || 'Repair failed.');
    } finally {
      setRepairing(false);
      setRotatingPassword(false);
    }
  }

  // Open the inline custom-password editor, seeding it with the
  // current password so a small tweak is a one-character edit.
  function startEditPassword() {
    setCustomPasswordValue(password);