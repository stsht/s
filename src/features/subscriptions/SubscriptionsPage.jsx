// /subs — subscription tooling with a Generate JPG flow.
//
// Two modes, switched by the contextual pills next to the logo
// (Segmented component → matches the /inv .mode-switch sizing/style):
//
//   invoice  Subscription bill: client/service/storage/duration/price
//            with a payment QR block. Used to ask the client to pay.
//   paid     Confirmation receipt: payment date/time, paid amount,
//            access period, start access, computed expiry.
//
// One Generate JPG button rasterises whichever card is active. The
// receipt's expiry is strictly start_date + N days (7/15/30) using
// UTC arithmetic, so a 30-day period in May expires on day 30, not
// 31, regardless of the local timezone.
import { useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { PrivateWorkspaceFrame } from '../../components/PrivateWorkspaceFrame.jsx';
import { Segmented, DateTimeField } from '../../components/ui/index.js';
import { toTitleCase, onBlurTitleCase } from '../../utils/titleCase.js';
import { selectAllIfZero } from '../../utils/moneyInput.js';
import {
  SUBS_PERIOD_OPTIONS,
  SUBS_SERVICE_OPTIONS,
  SUBS_TITLE_OPTIONS,
  SUBS_MODE_OPTIONS,
  SUBS_STORAGE_OPTIONS,
  SUBS_NON_STORAGE_SERVICES,
  SUBS_DURATION_OPTIONS,
} from './subscriptionConstants.js';
import {
  todaySubs,
  nowSubsTime,
  addDays,
  safeSubsToken,
  loadTesseract,
  parseOcrText,
} from './subscriptionUtils.js';
import { SubsPaidCard } from './SubsPaidCard.jsx';
import { SubsInvoiceCard } from './SubsInvoiceCard.jsx';

export function SubscriptionsPage() {
  const [mode, setMode] = useState('invoice');
  const [titlePrefix, setTitlePrefix] = useState('Mr.');
  const [client, setClient] = useState('');
  const [service, setService] = useState('iCloud');
  // Shared price input. Used as Total in invoice mode and as Paid
  // Amount in paid mode — same number, different role per mode.
  // In paid mode the field is rendered read-only so the user has
  // to switch back to invoice mode to change the amount.
  const [price, setPrice] = useState(100000);
  // Invoice-only fields. Storage is a free-form select value (e.g.
  // "200 GB"); blank means "no storage" and removes the line from
  // the rendered card. Duration is a string ('7'|'15'|'30'|'') so
  // the empty option in SUBS_DURATION_OPTIONS round-trips cleanly.
  const [storage, setStorage] = useState('');
  const [duration, setDuration] = useState('30');
  const [issuedDate, setIssuedDate] = useState(todaySubs);
  // Paid-only fields. paymentDate / paymentTime / startDate /
  // startTime initialise to "now" on mount and re-snap to "now"
  // every time the user switches into Paid mode (see effect below)
  // so the receipt always carries the real-world payment moment
  const [paymentDate, setPaymentDate] = useState(todaySubs);
  const [paymentTime, setPaymentTime] = useState(nowSubsTime);
  const [accessPeriod, setAccessPeriod] = useState(30);
  const [startDate, setStartDate] = useState(todaySubs);
  const [startTime, setStartTime] = useState(nowSubsTime);
  const [mobileView, setMobileView] = useState('left');
  const [status, setStatus] = useState('');
  // Persisted-row id for the in-progress draft. Set after the
  // first successful save so subsequent Save clicks PATCH the
  // same row instead of inserting a duplicate (the worker
  // handleSubscriptionSave reads body.id / body.subscription.id
  // for the upsert decision). Cleared automatically when the
  // operator changes inputs that would identify a different
  // subscription (client/service) — we keep the policy simple
  // and let the worker's duplicate-suppression handle the rest.
  const [savedId, setSavedId] = useState('');
  const [saving, setSaving] = useState(false);
  const cardRef = useRef(null);
  // Track the previous mode so the refresh-on-switch effect only
  // fires on actual transitions into 'paid', not on the very first
  // render or on unrelated re-renders.
  const previousModeRef = useRef(mode);
  const skipAutoSnapRef = useRef(false);

  // Refresh paid-mode date/time fields each time the user switches
  // into Paid. Workflow: build invoice → wait for client to pay →
  // click Paid → the receipt automatically uses the current real
  // payment moment. Manual edits afterwards still apply (we only
  // re-snap on the transition itself).
  useEffect(() => {
    if (previousModeRef.current !== 'paid' && mode === 'paid') {
      if (skipAutoSnapRef.current) {
        skipAutoSnapRef.current = false;
      } else {
        const dateNow = todaySubs();
        const timeNow = nowSubsTime();
        setPaymentDate(dateNow);
        setPaymentTime(timeNow);
        setStartDate(dateNow);
        setStartTime(timeNow);
      }
    }
    previousModeRef.current = mode;
  }, [mode]);

  // expiry = startDate + accessPeriod days (paid mode only).
  const expiryDate = useMemo(
    () => addDays(startDate, accessPeriod),
    [startDate, accessPeriod],
  );

  async function handleJpgImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const filename = file.name;
    const filenameMatch = filename.match(/^subscription-paid-([a-z0-9-]+)-([a-z0-9-]+)\.jpe?g$/i);
    if (!filenameMatch) {
      setStatus('Invalid filename pattern. Must be subscription-paid-<service>-<client>.jpg');
      return;
    }

    setStatus('Reading JPG...');

    const rawService = filenameMatch[1];
    const rawClient = filenameMatch[2];

    let parsedService = 'ChatGPT';
    if (/chatgpt/i.test(rawService)) parsedService = 'ChatGPT';
    else if (/icloud/i.test(rawService)) parsedService = 'iCloud';
    else if (/google/i.test(rawService)) parsedService = 'Google Drive';
    else if (/dropbox/i.test(rawService)) parsedService = 'Dropbox';
    else if (/copilot/i.test(rawService)) parsedService = 'Copilot';

    const parsedClient = toTitleCase(rawClient.replace(/[-_]+/g, ' '));

    try {
      setStatus('Loading OCR engine...');
      const Tesseract = await loadTesseract();
      setStatus('Analyzing image text...');
      const worker = await Tesseract.createWorker();
      const { data } = await worker.recognize(file);
      const text = data.text;
      const confidence = data.confidence;
      await worker.terminate();

      const extracted = parseOcrText(text);

      skipAutoSnapRef.current = true;
      setMode('paid');
      setClient(parsedClient);
      setService(parsedService);

      const suggestsMr = /mr/i.test(rawClient) || /mr/i.test(rawService) || extracted.hasMr;
      setTitlePrefix(suggestsMr ? 'Mr.' : '');

      setPaymentDate(extracted.paymentDate || '');
      setPaymentTime(extracted.paymentTime || '');
      setStartDate(extracted.startDate || '');
      setStartTime(extracted.startTime || '');

      const accessMatch = text.match(/Access\s+Period\s*[:\-\s]*\s*(\d+)/i);
      if (accessMatch) {
        setAccessPeriod(Number(accessMatch[1]));
      }

      const amountMatch = text.match(/Paid\s+Amount\s*[:\-\s]*\s*Rp\s*([\d.,]+)/i) || text.match(/Total\s*[:\-\s]*\s*Rp\s*([\d.,]+)/i);
      if (amountMatch) {
        const cleanedAmount = amountMatch[1].replace(/[.,]/g, '');
        setPrice(Number(cleanedAmount));
      }

      const hasLowConfidence = confidence < 60;
      const hasMissingDates = !extracted.paymentDate || !extracted.startDate;
      if (hasLowConfidence || hasMissingDates) {
        setStatus('Needs review');
      } else {
        setStatus('✓ Fields restored from JPG');
      }
    } catch (error) {
      console.error('[subs] import error:', error);
      skipAutoSnapRef.current = true;
      setMode('paid');
      setClient(parsedClient);
      setService(parsedService);

      const suggestsMr = /mr/i.test(rawClient) || /mr/i.test(rawService);
      setTitlePrefix(suggestsMr ? 'Mr.' : '');

      setPaymentDate('');
      setPaymentTime('');
      setStartDate('');
      setStartTime('');

      setStatus('Needs review');
    }
  }

  // Persist the current /subs draft through the same endpoint the
  // /db Subs importer uses, so a subscription created from /subs
  // immediately surfaces in /db Subs without a second hop. The
  // payload mirrors what SubscriptionImport sends — same field
  // names the worker normalises in normalizeSubscriptionPayload.
  //
  // After the first successful save we capture the row id into
  // savedId so further Save clicks PATCH that row instead of
  // inserting duplicates. The worker also runs its own duplicate
  // lookup (client + service + payment_date + start_date) so even
  // an explicit re-create would map back to the same record, but
  // routing the id explicitly is cheaper and avoids that probe.
  async function saveSubscription() {
    const trimmedClient = String(client || '').trim();
    const trimmedService = String(service || '').trim();
    if (!trimmedClient) {
      setStatus('Client name is required to Save.');
      return;
    }
    if (!trimmedService) {
      setStatus('Service is required to Save.');
      return;
    }
    setSaving(true);
    setStatus('Saving subscription\u2026');
    try {
      const isPaid = mode === 'paid';
      const subscription = {
        client_title: titlePrefix || '',
        client_name: trimmedClient,
        // /subs intentionally doesn't collect a contact field —
        // the worker tolerates an empty string and reuses any
        // existing client record's contact when matching by name.
        client_contact: '',
        service: trimmedService,
        status: isPaid ? 'paid' : 'invoice',
        price: Math.max(0, Math.round(Number(price) || 0)),
        storage_slot: !SUBS_NON_STORAGE_SERVICES.has(service) && storage ? String(storage) : '',
        access_period: isPaid
          ? Math.max(0, Math.round(Number(accessPeriod) || 0))
          : Math.max(0, Math.round(Number(duration) || 30)) || 30,
        invoice_date: !isPaid ? (issuedDate || '') : '',
        payment_date: isPaid ? (paymentDate || '') : '',
        payment_time: isPaid ? (paymentTime || '') : '',
        start_date: isPaid ? (startDate || '') : '',
        start_time: isPaid ? (startTime || '') : '',
        // Worker normalises expiry from start + access_period when
        // status === 'paid', but we send the computed value so the
        // /db list reflects it on the next load even if the worker
        // ever loses that derivation.
        expiry_date: isPaid ? (expiryDate || '') : '',
        expiry_time: isPaid ? (startTime || '') : '',
      };
      if (savedId) subscription.id = savedId;
      const response = await fetch('/api/subscriptions-save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription, id: savedId || undefined }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(json.error || `Save failed (${response.status}).`);
      }
      const newId = String(json.subscription?.id || savedId || '');
      if (newId) setSavedId(newId);
      setStatus(savedId ? 'Subscription updated.' : 'Subscription saved.');
    } catch (error) {
      setStatus(error?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function downloadJpg() {
    if (!cardRef.current) return;
    setStatus('Rendering JPG...');
    if (document.fonts?.ready) {
      try { await document.fonts.ready; } catch {}
    }
    // Clone the active card into an off-screen export host so the
    // rasterised output is independent of the live preview viewport
    // (which can be narrower than the card on mobile). The host pins
    // the card at a stable 720px width via .subs-export-host > *.
    const exportHost = document.createElement('div');
    exportHost.className = 'subs-export-host';
    const cloned = cardRef.current.cloneNode(true);
    exportHost.appendChild(cloned);
    document.body.appendChild(exportHost);
    try {
      const canvas = await html2canvas(cloned, {
        backgroundColor: '#ffffff',
        scale: Math.max(3, Math.min(4, (window.devicePixelRatio || 2) * 2)),
        useCORS: true,
        allowTaint: true,
        imageTimeout: 0,
        logging: false,
        // Wide-ish landscape paid receipt needs a desktop viewport so
        // it doesn't fold into the <1024px mobile layout. Invoice stays
        // on the original portrait viewport.
        windowWidth: mode === 'paid' ? 1120 : 800,
        windowHeight: mode === 'paid' ? 840 : 1200,
      });
      const filePrefix = mode === 'paid' ? 'subscription-paid' : 'subscription-invoice';
      const link = document.createElement('a');
      link.download = `${filePrefix}-${safeSubsToken(service) || 'service'}-${safeSubsToken(client) || 'client'}.jpg`;
      link.href = canvas.toDataURL('image/jpeg', 1.0);
      link.click();
      setStatus('JPG ready.');
    } catch (error) {
      setStatus(error.message || 'Failed to render JPG.');
    } finally {
      exportHost.remove();
    }
  }

  // Shared inputs render first; the mode-specific block below swaps
  // between invoice fields (storage/duration/issued/due) and paid
  // fields (payment date+time, access period, start access). The
  // Price input is shared so switching modes preserves the amount.
  const left = (
    <form className="form-stack" onSubmit={(event) => event.preventDefault()}>
      <div className="qr-upload" style={{ marginBottom: '18px' }}>
        <span className="qr-upload-label">Import JPG Receipt</span>
        <label className="qr-upload-control">
          <input type="file" accept="image/*" onChange={handleJpgImport} />
          <span className="qr-upload-pill">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: '18px', height: '18px', display: 'block' }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className="qr-upload-text">Click to upload receipt JPG</span>
          </span>
        </label>
      </div>
      <div className="two-col">
        <label>Title
          <select value={titlePrefix} onChange={(event) => setTitlePrefix(event.target.value)}>
            {SUBS_TITLE_OPTIONS.map((option) => (
              <option key={option || 'blank'} value={option}>
                {option || '—'}
              </option>
            ))}
          </select>
        </label>
        <label>Client name
          <input value={client} onChange={(event) => setClient(event.target.value)} onBlur={onBlurTitleCase(setClient)} placeholder="Client Name" />
        </label>
      </div>
      <label>Service
        <select value={service} onChange={(event) => setService(event.target.value)}>
          {SUBS_SERVICE_OPTIONS.map((option) => <option key={option}>{option}</option>)}
        </select>
      </label>
      <label>{mode === 'paid' ? 'Paid Amount (IDR)' : 'Price (IDR)'}
        <input
          type="number"
          min="0"
          value={price}
          onFocus={selectAllIfZero}
          onChange={(event) => setPrice(event.target.value)}
          readOnly={mode === 'paid'}
          aria-readonly={mode === 'paid'}
        />
      </label>
      {mode === 'invoice' ? (
        <>
          {!SUBS_NON_STORAGE_SERVICES.has(service) ? (
            <label>Storage
              <select value={storage} onChange={(event) => setStorage(event.target.value)}>
                <option value="">—</option>
                {SUBS_STORAGE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label>Duration
            <select value={duration} onChange={(event) => setDuration(event.target.value)}>
              {SUBS_DURATION_OPTIONS.map((option) => (
                <option key={option.value || 'blank'} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>Date Issued
            <DateTimeField
              value={issuedDate}
              onChange={(value) => setIssuedDate(value)}
              ariaLabel="Date issued"
            />
          </label>
        </>
      ) : (
        <>
          <label>Payment
            <DateTimeField
              value={paymentDate}
              onChange={(value) => setPaymentDate(value)}
              timeValue={paymentTime}
              onTimeChange={(value) => setPaymentTime(value)}
              withTime
              ariaLabel="Payment date and time"
            />
          </label>
          <label>Access Period
            <select value={accessPeriod} onChange={(event) => setAccessPeriod(Number(event.target.value))}>
              {SUBS_PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>Start Access
            <DateTimeField
              value={startDate}
              onChange={(value) => setStartDate(value)}
              timeValue={startTime}
              onTimeChange={(value) => setStartTime(value)}
              withTime
              ariaLabel="Start access date and time"
            />
          </label>
        </>
      )}
    </form>
  );

  const periodLabel = SUBS_PERIOD_OPTIONS.find((option) => option.value === Number(accessPeriod))?.label
    || `${accessPeriod} Days`;

  // Display-only title-cased client name. State stays raw so the
  // input field echoes whatever the user typed verbatim.
  const displayClient = toTitleCase(client) || 'Client';

  // Whether the active service supports storage AND a value was
  // chosen. Drives both the invoice card's storage line and the
  // line-item subtitle so the two stay in sync.
  const showStorage = !SUBS_NON_STORAGE_SERVICES.has(service) && Boolean(storage);
  const showDuration = Boolean(duration);
  const durationLabel = showDuration
    ? (SUBS_DURATION_OPTIONS.find((option) => option.value === String(duration))?.label
       || `${duration} Days`)
    : '';
  // Subtitle pieces — joined with " · " only when present so
  // omitting both yields an empty subtitle (small element collapses
  // via :empty styling).
  const lineSubtitle = [showStorage ? storage : '', durationLabel]
    .filter(Boolean)
    .join(' \u00b7 ');

  // Paid receipt card. Driven entirely by SubsPaidCard so /db Subs
  // detail can re-render the same artifact from a saved row.
  const paidCard = (
    <SubsPaidCard
      cardRef={cardRef}
      titlePrefix={titlePrefix}
      displayClient={displayClient}
      service={service}
      paymentDate={paymentDate}
      paymentTime={paymentTime}
      price={price}
      periodLabel={periodLabel}
      startDate={startDate}
      startTime={startTime}
      expiryDate={expiryDate}
      // /subs UI doesn't carry a separate expiry-time input, so the
      // live preview keeps its previous behaviour of showing the
      // start time on the Expiry tile. Re-prints from /db pass the
      // saved expiry_time through subscriptionToCardProps.
      expiryTime={startTime}
    />
  );

  // Invoice card. Same prop-driven contract as SubsPaidCard above.
  const invoiceCard = (
    <SubsInvoiceCard
      cardRef={cardRef}
      titlePrefix={titlePrefix}
      displayClient={displayClient}
      service={service}
      showStorage={showStorage}
      storage={storage}
      showDuration={showDuration}
      durationLabel={durationLabel}
      lineSubtitle={lineSubtitle}
      price={price}
      issuedDate={issuedDate}
    />
  );

  const right = (
    <>
      <header className="subs-toolbar">
        <div>
          <p className="eyebrow">Live Preview</p>
          <h2>{mode === 'paid' ? 'Subscription Receipt' : 'Subscription Invoice'}</h2>
        </div>
        <div className="subs-toolbar-actions">
          <button
            className="ghost-button compact"
            type="button"
            onClick={saveSubscription}
            disabled={saving}
          >
            {saving ? 'Saving\u2026' : (savedId ? 'Update' : 'Save')}
          </button>
          <button className="primary-button" type="button" onClick={downloadJpg}>Generate JPG</button>
        </div>
      </header>
      <div className="subs-canvas scroll-surface-y">
        {mode === 'paid' ? paidCard : invoiceCard}
      </div>
      <p className="download-status">{status}</p>
    </>
  );

  return (
    <PrivateWorkspaceFrame
      active="/subs/"
      // Contextual pills sit right of the logo in the left-panel
      // header (pf-pills slot). Segmented uses .pf-pillset which
      // mirrors the /inv .mode-switch sizing/style 1:1, so the look
      // matches without introducing a new pill style.
      pills={
        <Segmented
          value={mode}
          onChange={setMode}
          options={SUBS_MODE_OPTIONS}
          ariaLabel="Subscription mode"
        />
      }
      // /subs is a leaf page; the nav row would just point back at
      // itself or repeat /db. Hide it entirely for a cleaner header.
      showNav={false}
      left={left}
      right={right}
      mobileView={mobileView}
      onMobileViewChange={setMobileView}
      mobileTabs={{ left: 'Form', right: 'Preview' }}
    />
  );
}
