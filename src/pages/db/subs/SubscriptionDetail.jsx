import { useEffect, useMemo, useRef, useState } from 'react';
import {
  pickLatestSubscriptionExtension,
  applySubscriptionExtension,
  subscriptionTone,
  resolveBonusDays,
  subscriptionExtensionSortKey,
} from '../dbHelpers.js';
import { dateLabel } from './subscriptionFormatting.js';
import { toTitleCase } from '../../../utils/titleCase.js';
import { rupiah } from '../../../utils/rupiah.js';
import { isProofViewable, isProofImage } from '../../../utils/proofImage.js';
import {
  fmtSubsTime,
  safeSubsToken,
  subscriptionToCardProps,
} from '../../../features/subscriptions/subscriptionUtils.js';
import { SubsPaidCard } from '../../../features/subscriptions/SubsPaidCard.jsx';
import { SubsInvoiceCard } from '../../../features/subscriptions/SubsInvoiceCard.jsx';
import { useSubscriptionExtensionForm } from './useSubscriptionExtensionForm.js';
import { SubscriptionHeader } from './SubscriptionHeader.jsx';
import { SubscriptionDetailRows } from './SubscriptionDetailRows.jsx';
import { SubscriptionExtensionForm } from './SubscriptionExtensionForm.jsx';
import { SubscriptionPeriodHistory } from './SubscriptionPeriodHistory.jsx';

// Subscription detail/edit view for the /db Subs tab.
//
// This orchestrator owns the page-level state (expire confirm, print
// export, delete arming, proof lightbox, expanded-period toggle) and
// the derived "effective" subscription (base + latest extension). The
// renewal-history form lives in useSubscriptionExtensionForm, and the
// heading / detail rows / extension form / period history render in
// their own focused components. Logic and markup were extracted
// verbatim from DatabasePage.jsx so /db behaviour is unchanged.
export function SubscriptionDetail({ client, subscription, onEdit, onDeleteSubscription, onChanged, onClose }) {
  const name = client?.name || client?.client_name || subscription?.client_name || 'Client';
  const contact = client?.contact || client?.client_contact || subscription?.client_contact || '';

  // Extensions ride along on the subscription record from /api/db.
  // Compute the EFFECTIVE subscription (base + latest extension)
  // so the heading badge reflects the current renewal state.
  const extensions = Array.isArray(subscription?.extensions) ? subscription.extensions : [];
  const latestExtension = subscription?.latest_extension || pickLatestSubscriptionExtension(extensions);
  const effective = subscription ? applySubscriptionExtension(subscription, latestExtension) : null;
  const tone = effective ? subscriptionTone(effective) : '';

  const [expireConfirmOpen, setExpireConfirmOpen] = useState(false);
  const [expireDate, setExpireDate] = useState('');
  const [expireTime, setExpireTime] = useState('');
  const [expireBusy, setExpireBusy] = useState(false);
  const [expireStatus, setExpireStatus] = useState('');

  function openExpireConfirm() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    setExpireDate(`${y}-${m}-${d}`);
    const h = String(now.getHours()).padStart(2, '0');
    const mn = String(now.getMinutes()).padStart(2, '0');
    setExpireTime(`${h}:${mn}`);
    setExpireConfirmOpen(true);
  }

  async function handleExpire(event) {
    if (event) event.preventDefault();
    if (!subscription?.id) return;
    setExpireBusy(true);
    setExpireStatus('');
    try {
      const isExt = !!latestExtension;
      const target = isExt ? latestExtension : subscription;
      const endpoint = isExt ? '/api/subscription-extensions-save' : '/api/subscriptions-save';
      const payloadKey = isExt ? 'extension' : 'subscription';

      const payload = {
        ...target,
        status: 'expired',
        expiry_date: expireDate,
        expiry_time: expireTime,
      };

      if (isExt) {
        payload.subscription_id = subscription.id;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [payloadKey]: payload }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(json.error || `Save failed (${response.status}).`);
      }
      setExpireConfirmOpen(false);
      onChanged?.();
    } catch (error) {
      console.warn('Expire failed:', error);
      setExpireStatus(error?.message || 'Failed to expire.');
    } finally {
      setExpireBusy(false);
    }
  }

  // Unified, newest-first transaction history. The base subscription
  // is folded into the same list as an extension-like row (isBase:
  // true) so the rendered timeline shows every period at a glance —
  // the latest renewal pinned at the very top and the original
  // "Initial Purchase" sitting at the bottom. Shares the same sort
  // key (subscriptionExtensionSortKey) as pickLatestSubscriptionExtension
  // so the row pinned at the top is always the same row that drives
  // the `effective` subscription rendered in the top card above.
  //
  // Sort priority (all descending): expiry_date + expiry_time →
  // start_date + start_time → created_at. The base row carries no
  // created_at, so on a tie it naturally falls below a real
  // extension and lands at the bottom of the timeline. Stays a memo
  // so re-renders don't re-sort an already-stable array.
  const allPeriods = useMemo(() => {
    const basePeriod = {
      id: 'base_subscription',
      service: subscription?.service || '',
      status: subscription?.status || '',
      price: Number(subscription?.price)
        || Number(subscription?.paid_amount)
        || Number(subscription?.amount)
        || Number(subscription?.total)
        || 0,
      access_period: Number(subscription?.access_period) || 0,
      bonus: resolveBonusDays(subscription),
      start_date: subscription?.start_date || '',
      start_time: subscription?.start_time || '',
      expiry_date: subscription?.expiry_date || '',
      expiry_time: subscription?.expiry_time || '',
      payment_date: subscription?.payment_date || '',
      payment_time: subscription?.payment_time || '',
      payment_proof: subscription?.payment_proof || '',
      isBase: true,
    };
    const rawExtensions = Array.isArray(subscription?.extensions) ? subscription.extensions : [];
    return [basePeriod, ...rawExtensions].sort((a, b) => {
      const aKey = subscriptionExtensionSortKey(a);
      const bKey = subscriptionExtensionSortKey(b);
      const cmp = bKey.localeCompare(aKey);
      if (cmp !== 0) return cmp;
      // Final tiebreak: created_at descending (newest first) so two
      // rows with identical expiry/start still land in a stable
      // newest-first order.
      const aCreated = String(a?.created_at || '');
      const bCreated = String(b?.created_at || '');
      return bCreated.localeCompare(aCreated);
    });
  }, [subscription]);

  // The top summary card already renders the CURRENT/active period
  // (base subscription + latest extension applied). Drop that exact
  // period from the history list below so the operator never sees the
  // same current period rendered twice (complaint #4). When an
  // extension is the latest, it's hidden here and shown only in the
  // top card; when there are no extensions the base row IS the card,
  // so the history collapses to "No extensions yet.".
  const currentPeriodId = latestExtension?.id || 'base_subscription';
  const visiblePeriods = useMemo(
    () => allPeriods.filter((p) => String(p.id) !== String(currentPeriodId)),
    [allPeriods, currentPeriodId],
  );

  // Top-card display reads from the EFFECTIVE subscription (base +
  // latest extension) so price, status, dates and access period
  // always reflect the current active/ongoing renewal rather than
  // stale base data. The base values stay visible at the bottom of
  // the transaction history (the isBase row in allPeriods).
  const statusRaw = String(effective?.status || '').trim();
  const statusLabel = statusRaw ? toTitleCase(statusRaw) : '';
  // Friendly tone label for the status badge — "Active" / "Expiring
  // Soon" / "Expired". Falls back to the raw status if no expiry-
  // derived tone applies.
  const toneLabel = tone === 'expired'
    ? 'Expired'
    : tone === 'warning'
      ? 'Expiring Soon'
      : tone === 'active'
        ? (statusLabel || 'Active')
        : '';
  const period = Number(effective?.access_period);
  const periodLabel = Number.isFinite(period) && period > 0 ? `${period} Days` : '';
  // Bonus is an integer add-on day count layered on top of the
  // access period (e.g. 30 + 1 → expiry stretches by one extra
  // day). Always shows in the detail panel (even at 0) so the
  // operator can see at a glance that no bonus was applied. Reads
  // from the effective subscription so a bonus carried by the
  // latest extension surfaces in the top card.
  const bonusDays = resolveBonusDays(effective);
  const bonusValue = Number.isFinite(bonusDays) && bonusDays >= 0 ? bonusDays : 0;
  const bonusLabel = `${bonusValue} ${bonusValue === 1 ? 'Day' : 'Days'}`;
  // Resolve the saved price defensively. The Subs schema only has
  // a single `price` column, but historical rows or other parsers
  // may have stamped the amount onto an alias (paid_amount /
  // amount / total) — read whichever non-zero value lands first
  // so a real Rp 50.000 shows up instead of "Rp 0". Mirrors the
  // formatting rule used by the extension list rows below
  // (`Number(ext.price) > 0 ? rupiah(...) : ''`) so the main
  // detail row drops out cleanly when no price was ever recorded.
  const priceValue = Number(effective?.price)
    || Number(effective?.paid_amount)
    || Number(effective?.amount)
    || Number(effective?.total)
    || 0;
  const priceLabel = priceValue > 0 ? rupiah(priceValue) : '';

  // Off-screen export card. We always render the appropriate card
  // for the saved subscription inside a .subs-export-host wrapper
  // (position:fixed at left:-10000px, ~760px wide for the paid card) so html2canvas
  // can rasterise a stable layout on Print without the operator
  // ever seeing the card on screen. cardProps mirrors what the
  // /subs live preview computes from local state, so the same JPG
  // comes out for both creation and re-print.
  const cardRef = useRef(null);
  // `printPeriod` selects which subscription period the off-screen
  // export card renders. null means the EFFECTIVE subscription (base
  // + latest extension) — i.e. the current active period — so the
  // toolbar Print button always prints the latest receipt. A specific
  // extension's effective subscription is swapped in when an
  // individual row's Print button is used. The export then captures
  // whatever the card currently shows.
  const [printPeriod, setPrintPeriod] = useState(null);
  const [printReq, setPrintReq] = useState(0);
  const [printStatus, setPrintStatus] = useState('');

  const exportSub = printPeriod || effective || subscription || {};
  const cardProps = useMemo(
    () => subscriptionToCardProps(exportSub),
    [exportSub],
  );
  const exportIsPaid = String(exportSub?.status || '').toLowerCase() === 'paid';

  // Queue a render-then-rasterise pass. Setting printPeriod swaps the
  // hidden export card's props; bumping printReq triggers the capture
  // effect AFTER React has committed the new card to the DOM, so the
  // JPG always matches the requested period.
  function requestPrint(periodSub) {
    setPrintPeriod(periodSub || null);
    setPrintReq((n) => n + 1);
  }

  function handlePrint() {
    // Toolbar print → current active period (effective subscription).
    requestPrint(null);
  }

  useEffect(() => {
    if (printReq === 0) return undefined;
    let cancelled = false;
    (async () => {
      if (!cardRef.current) return;
      setPrintStatus('Rendering JPG\u2026');
      if (document.fonts?.ready) {
        try { await document.fonts.ready; } catch {}
      }
      try {
        // html2canvas is a heavy dependency only needed when the
        // operator actually exports a card. Load it on demand so it
        // stays out of the initial /db bundle (faster first paint,
        // less memory on mobile Safari / tablet Firefox).
        const { default: html2canvas } = await import('html2canvas');
        const canvas = await html2canvas(cardRef.current, {
          backgroundColor: '#ffffff',
          scale: Math.max(3, Math.min(4, (window.devicePixelRatio || 2) * 2)),
          useCORS: true,
          allowTaint: true,
          imageTimeout: 0,
          logging: false,
          // Paid receipt is a balanced ~4:3 card — pin a desktop
          // viewport so it never collapses into the <1024px mobile
          // layout during rasterisation. Invoice stays portrait.
          windowWidth: exportIsPaid ? 1120 : 800,
          windowHeight: exportIsPaid ? 840 : 1200,
        });
        if (cancelled) return;
        const filePrefix = exportIsPaid ? 'subscription-paid' : 'subscription-invoice';
        const link = document.createElement('a');
        link.download = `${filePrefix}-${safeSubsToken(exportSub?.service) || 'service'}-${safeSubsToken(exportSub?.client_name || subscription?.client_name) || 'client'}.jpg`;
        link.href = canvas.toDataURL('image/jpeg', 1.0);
        link.click();
        if (!cancelled) setPrintStatus('JPG ready.');
      } catch (error) {
        console.warn('[db/subs] print failed:', error);
        if (!cancelled) setPrintStatus(error?.message || 'Failed to render JPG.');
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printReq]);

  // Display-time format helpers. Detail rows use the en-GB short
  // date (now TZ-safe via dateLabel) and the receipt's HH.MM time
  // form so a single saved value reads the same in the detail
  // panel and on the printed card.
  const fmtTime = (v) => (v ? fmtSubsTime(v) : '');
  const fmtDate = (v) => (v ? dateLabel(v) : '');
  // Combined "date · time" formatter — produces "15 Apr 2026 · 19.09"
  // when both halves exist, or whichever half exists alone, or "" if
  // neither does. Returning an empty string lets the .filter() below
  // drop the row entirely instead of showing a stub line.
  const fmtDateTime = (date, time) => {
    const d = fmtDate(date);
    const t = fmtTime(time);
    if (d && t) return `${d} \u00b7 ${t}`;
    return d || t;
  };

  // Compact pills under the client name: Status · Service · Period.
  // Only non-empty values render so a partial row doesn't show empty
  // bubbles. The Expired / Expiring Soon / Paid (Active) tone pill is
  // prepended to this same row at render time (see the heading JSX
  // below) so the status reads inline with Service and Period rather
  // than riding the <h2> name line — keeping long names on their own
  // line and the pill layout stable across mobile font scaling.
  const headingPills = [
    // Service is the subscription's stable identity for the visible
    // header/list UI, so this pill reads the BASE subscription
    // service rather than the latest extension's per-period snapshot.
    // Extension/history rows keep their own stored service below.
    subscription?.service ? String(subscription.service).trim() : '',
    // Plain statusLabel intentionally omitted here — the colored tone
    // pill prepended to this row already conveys Paid/Active/Expiring/
    // Expired, so repeating it as a neutral pill would duplicate it.
    periodLabel,
  ].filter(Boolean);

  // Delete confirmation lives inside the detail panel only — the
  // left-panel row X stays a one-tap delete per spec. First click
  // arms the button (label + tone change), a second click within
  // ~4s issues the delete via the parent. Auto-disarms on timeout
  // or close so an accidental press doesn't sit in a hot state.
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!confirmDelete) return undefined;
    const id = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(id);
  }, [confirmDelete]);
  // Reset the armed state if the parent swaps to a different
  // subscription, or when the current/latest extension changes (the
  // trash target moves with it), while this component stays mounted.
  useEffect(() => {
    setConfirmDelete(false);
  }, [subscription?.id, latestExtension?.id]);

  function handleDeleteClick() {
    if (!subscription?.id) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setConfirmDelete(false);
    // When the top card represents the latest extension, the trash
    // deletes that current period only — deleteExtension refetches
    // via onChanged and leaves the detail panel open, so the card
    // falls back to the previous period (or the base subscription
    // once no extensions remain). With no extension present, it
    // deletes the whole base subscription as before.
    if (latestExtension) {
      deleteExtension(latestExtension);
    } else {
      onDeleteSubscription?.(subscription);
    }
  }

  // Target-aware delete copy for the header trash button so its
  // label/title/aria match what the click actually removes.
  const deleteLabel = confirmDelete
    ? (latestExtension ? 'Confirm delete current period' : 'Confirm delete subscription')
    : (latestExtension ? 'Delete current period' : 'Delete subscription');

  // Req6: which period/extension row is expanded inline. Empty = all
  // collapsed (compact). Toggled by clicking the row body — no arrow
  // affordance; the whole summary acts as the expand/collapse target.
  const [expandedPeriodId, setExpandedPeriodId] = useState('');
  // Lightbox preview for an image payment proof. Holds the proof
  // source string while open, '' when closed. Opened by tapping the
  // detail-card thumbnail; closed via the close button, a backdrop
  // tap, or the Escape key.
  const [proofPreview, setProofPreview] = useState('');
  useEffect(() => {
    if (!proofPreview) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setProofPreview(''); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [proofPreview]);

  // Extension form state + save/delete logic. The hook resets itself
  // when the parent swaps to a different subscription (keyed on
  // subscription?.id) so a stale draft never carries across rows.
  const {
    extensionFormOpen,
    editingExtensionId,
    extensionDraft,
    extensionBusy,
    extensionStatus,
    extensionStatusTone,
    setExtensionField,
    openAddExtension,
    openEditExtension,
    closeExtensionForm,
    saveExtension,
    deleteExtension,
  } = useSubscriptionExtensionForm({ subscription, effective, latestExtension, onChanged });

  // Build the per-field values needed by the explicit row layout
  // below. Storage and Contact stay as standalone rows because they
  // don't participate in the date/price grid groups. Title is no
  // longer rendered as its own row — the prefix (Mr./Ms.) is woven
  // directly into the <h2> heading instead, matching the "Ms. Linda"
  // shape called out in the spec.
  const storageValue = String(subscription?.storage_slot || subscription?.storage || '').trim();
  // Payment Date on the top card reflects the CURRENT/active period:
  // the latest extension's payment date when one exists, otherwise
  // the base subscription's (Initial) payment date. The base row's
  // own payment date is never mutated — it stays visible as the
  // Initial receipt of record in the history below. Start/Expiry
  // likewise read from the effective subscription so the top card
  // shows the current active window.
  const paymentValue = fmtDateTime(
    latestExtension?.payment_date || subscription?.payment_date,
    latestExtension?.payment_date ? latestExtension?.payment_time : subscription?.payment_time,
  );
  const startValue = fmtDateTime(effective?.start_date, effective?.start_time);
  const expiryValue = fmtDateTime(effective?.expiry_date, effective?.expiry_time);
  // Payment proof for the CURRENT/active period: latest extension's
  // proof when extended, else the base subscription's. Only rendered
  // when present so the panel stays clean for proof-less records.
  const proofValue = String(effective?.payment_proof || '').trim();
  const proofIsUrl = isProofViewable(proofValue);
  // Whether the current-period proof is a displayable image (inline
  // data URL or an http(s) image link) — drives the thumbnail +
  // lightbox treatment instead of a plain "View proof" link.
  const proofIsImage = isProofImage(proofValue);
  // Composed h2 label: "<title> <client_name>" — e.g. "Ms. Linda" or
  // "Mr. Fenny Sofian". Falls back to the client name alone when no
  // title prefix is set, so a row missing a title prefix still reads
  // cleanly without a leading space.
  const titlePrefix = String(subscription?.client_title || '').trim();
  const headingName = titlePrefix ? `${titlePrefix} ${name}` : name;
  // Whether any of the row groups have at least one populated cell.
  // If every grouped field is empty we fall through to the "No
  // subscription details available." copy so the panel doesn't show
  // a stack of blank label boxes.
  const hasAnyDetailRow = Boolean(
    storageValue || priceLabel || paymentValue || startValue || expiryValue || periodLabel || contact || proofValue
  );

  return (
    <>
      <SubscriptionHeader
        headingName={headingName}
        tone={tone}
        toneLabel={toneLabel}
        headingPills={headingPills}
        contact={contact}
        hasId={!!subscription?.id}
        showAddExtension={!!subscription?.id && !extensionFormOpen}
        onAddExtension={openAddExtension}
        onRefresh={onChanged}
        onEditCurrent={() => (latestExtension ? openEditExtension(latestExtension) : onEdit?.(subscription))}
        editLabel={latestExtension ? 'Edit current period' : 'Edit subscription'}
        onPrint={handlePrint}
        confirmDelete={confirmDelete}
        onDelete={handleDeleteClick}
        deleteLabel={deleteLabel}
        showExpire={!!subscription?.id && tone !== 'expired'}
        onExpire={openExpireConfirm}
        onClose={onClose}
      />
      {expireConfirmOpen ? (
        <form className="expire-confirm-form" onSubmit={handleExpire}>
          <p className="expire-confirm-title">Expire access now?</p>
          <div className="two-col">
            <label>Expiry Date
              <input type="date" value={expireDate} onChange={(e) => setExpireDate(e.target.value)} required />
            </label>
            <label>Expiry Time
              <input type="time" value={expireTime} onChange={(e) => setExpireTime(e.target.value)} required />
            </label>
          </div>
          {expireStatus ? <p className="download-status lg-status-error">{expireStatus}</p> : null}
          <div className="client-actions">
            <button type="submit" className="primary-button" disabled={expireBusy} style={{ background: 'var(--sub-expired)', borderColor: 'var(--sub-expired)' }}>
              {expireBusy ? 'Expiring\u2026' : 'Expire'}
            </button>
            <button type="button" className="ghost-button compact" onClick={() => { setExpireConfirmOpen(false); setExpireStatus(''); }} disabled={expireBusy}>Cancel</button>
          </div>
        </form>
      ) : null}
      {!subscription ? (
        <p className="empty-state">No subscription details available.</p>
      ) : (
        <SubscriptionDetailRows
          tone={tone}
          storageValue={storageValue}
          priceLabel={priceLabel}
          paymentValue={paymentValue}
          startValue={startValue}
          expiryValue={expiryValue}
          periodLabel={periodLabel}
          bonusLabel={bonusLabel}
          contact={contact}
          hasAnyDetailRow={hasAnyDetailRow}
          proofValue={proofValue}
          proofIsImage={proofIsImage}
          proofIsUrl={proofIsUrl}
          onProofPreview={setProofPreview}
        />
      )}
      {subscription?.id ? (
        <section className="subs-extensions" aria-label="Subscription extensions">
          <div className="subs-extensions-head">
            <p className="eyebrow">Extensions</p>
          </div>
          {extensionFormOpen ? (
            <SubscriptionExtensionForm
              editingExtensionId={editingExtensionId}
              extensionDraft={extensionDraft}
              extensionBusy={extensionBusy}
              extensionStatus={extensionStatus}
              extensionStatusTone={extensionStatusTone}
              servicePlaceholder={subscription?.service}
              setExtensionField={setExtensionField}
              onSubmit={saveExtension}
              onCancel={closeExtensionForm}
            />
          ) : null}
          <SubscriptionPeriodHistory
            subscription={subscription}
            visiblePeriods={visiblePeriods}
            expandedPeriodId={expandedPeriodId}
            setExpandedPeriodId={setExpandedPeriodId}
            extensionFormOpen={extensionFormOpen}
            onRequestPrint={requestPrint}
            onEditBase={(sub) => onEdit?.(sub)}
            onEditExtension={openEditExtension}
            onDeleteExtension={deleteExtension}
          />
        </section>
      ) : null}
      {printStatus ? <p className="download-status">{printStatus}</p> : null}
      {/* Off-screen export host. The card is always rendered (just
          hidden via the .subs-export-host wrapper styling) so Print
          can rasterise a fully laid-out 720px article without an
          extra mount step. */}
      {subscription ? (
        <div className="subs-export-host" aria-hidden="true">
          {exportIsPaid ? (
            <SubsPaidCard cardRef={cardRef} {...cardProps} />
          ) : (
            <SubsInvoiceCard cardRef={cardRef} {...cardProps} />
          )}
        </div>
      ) : null}
      {proofPreview ? (
        <div
          className="subs-proof-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Payment proof preview"
          onClick={() => setProofPreview('')}
        >
          <div className="subs-proof-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="subs-proof-lightbox-close"
              onClick={() => setProofPreview('')}
              aria-label="Close preview"
              title="Close"
            >
              &times;
            </button>
            <img src={proofPreview} alt="Payment proof" />
          </div>
        </div>
      ) : null}
    </>
  );
}
