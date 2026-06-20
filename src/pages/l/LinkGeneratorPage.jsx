import { useEffect, useMemo, useRef, useState } from 'react';
import { WorkspacePanels } from '../../components/WorkspacePanels.jsx';
import { DateTimeField } from '../../components/ui/index.js';
import { toTitleCase } from '../../utils/titleCase.js';
import { SaveIcon, ServiceField } from './linkPrimitives.jsx';
import {
  cleanLinkText,
  jakartaTodayISO,
  eventDateTone,
  compactEventDateLabel,
  normalizeFolderName,
  normalizeLinkUrl,
  normalizeInvoiceTitleValue,
  folderCodeFromEventDate,
} from './linkHelpers.js';
import {
  buildBaseSlug,
  buildFolderPassword,
} from './linkSlug.js';

// --- Shared helpers duplicated from WorkspacePages.jsx ---
// These small utilities are still used by /db inside WorkspacePages.jsx,
// so they are intentionally duplicated here (not moved) to let /l stand
// alone without importing the large WorkspacePages module. Keep behaviour
// identical to the originals.

function dbgEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    const url = new URLSearchParams(window.location.search);
    if (url.get('debug') === '1') {
      try { window.sessionStorage?.setItem('starshots_debug_grouping', '1'); } catch {}
      return true;
    }
    return window.sessionStorage?.getItem('starshots_debug_grouping') === '1';
  } catch {
    return false;
  }
}

function dbg(...args) {
  if (dbgEnabled()) console.log('[grouping]', ...args);
}

// /l — Link Generator.
//
// Recreates the legacy /l workflow on top of the current React
// shell. The folder-name conventions, URL normalisation, gallery-
// code prettifier, message template, and invoice handoff (URL
// params + localStorage) follow the legacy flow, with current
// policy layered on top for no-lowercase-l slugs and 7-char
// passwords.
//
// Server contract:
//   POST /api/save with the legacy payload shape. The current
//   worker authoritatively generates `password` and `shortCode`
//   server-side and ignores any matching fields in the body, so
//   we send the body for shape compatibility but always display
//   `data.password`, `data.shortLink`, and `data.generatedText`
//   from the response. The folder-date password is shown only as
//   a pre-save preview hint and is replaced once the worker
//   responds.
//
// Auth: PasswordGate has already established the shared admin
// session cookie before this page renders, so /api/save runs with
// `credentials: 'same-origin'` and no body password.

const LINK_INVOICE_HANDOFF_KEY = 'starshots_invoice_client_handoff_v1';
const LINK_HANDOFF_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const LINK_SERVICES = [
  { key: 'gd', label: 'Google Drive', placeholder: 'https://drive.google.com/...' },
  { key: 'db', label: 'Dropbox', placeholder: 'https://dropbox.com/...' },
  { key: 'wt', label: 'WeTransfer', placeholder: 'https://we.tl/...' },
];

// Read invoice handoff in the same priority the legacy /l used:
// URL params first (so /db's "Create Links" button always wins),
// otherwise a localStorage entry written by /inv that's still
// inside the 7-day window.
function readInvoiceHandoff() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const fromUrl = {
    title: params.get('title') || '',
    name: params.get('name') || '',
    eventDate: params.get('eventDate') || '',
    invoiceId: params.get('invoiceId') || '',
    eventKey: params.get('eventKey') || '',
    // Stable parent client id forwarded by /db's Create Events
    // sheet. Empty when /l is opened standalone or from a legacy
    // bucket — the worker still has its name+contact fallback.
    clientId: params.get('clientId') || '',
    type: params.get('type') || '',
    folderName: params.get('folderName') || '',
  };
  if (cleanLinkText(fromUrl.name)) return fromUrl;
  try {
    const raw = window.localStorage.getItem(LINK_INVOICE_HANDOFF_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (
      saved &&
      cleanLinkText(saved.name) &&
      Date.now() - Number(saved.savedAt || 0) < LINK_HANDOFF_TTL_MS
    ) {
      return saved;
    }
  } catch {
    /* ignore parse / storage errors */
  }
  return null;
}

function buildPreviewMessage(title, clientName, info) {
  const link = info.shortLink || info.directUrl;
  const t = cleanLinkText(title);
  const c = cleanLinkText(clientName);
  const namePart = t ? `${t} ${c}` : c;
  return `Dear ${namePart},

With sincere appreciation, your StarShots delivery files have been prepared and are now ready for your kind attention.

Your Delivery Files and Invoice may be accessed through the details below:

\u2022 Link: ${link}
\u2022 Password: ${info.pass}

Should you prefer a different password, please let us know and we will update it for you.

Kindly download the files within the stated availability period.

It has been our pleasure to serve you, and we look forward to welcoming you again.

Warm Regards,
StarShots ID`;
}

async function copyToClipboard(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(String(text));
    return true;
  } catch {
    return false;
  }
}

export function LinkGeneratorPage() {
  const [title, setTitle] = useState('Ms.');
  const [deliveryType, setDeliveryType] = useState('client');
  const [clientName, setClientName] = useState('');
  const [folderName, setFolderName] = useState('');
  // Service URLs are kept as a single object so markDirty / clear
  // flows touch one piece of state instead of four.
  const [serviceUrls, setServiceUrls] = useState({ gd: '', db: '', wt: '', tn: '' });
  // saved is the snapshot returned by the most recent successful
  // /api/save call. Once any input changes (via markDirty) the
  // snapshot clears so the displayed link/password/message can
  // never disagree with the displayed inputs.
  const [saved, setSaved] = useState(null);
  const [status, setStatus] = useState({ text: '', tone: '' });
  const [busy, setBusy] = useState(false);
  const [linkedInvoiceId, setLinkedInvoiceId] = useState('');
  // Stable parent clients.id forwarded from /db's Create Events
  // sheet (or from /inv when an invoice row originated there). The
  // worker uses this as the preferredId in findOrCreateClient so
  // the saved delivery attaches to THIS exact client bucket
  // instead of name+contact-matching its way to a duplicate
  // sibling. Sits alongside `eventKey`, which still controls
  // per-event grouping; the two are independent.
  const [linkedClientId, setLinkedClientId] = useState('');
  // Stable per-event grouping key handed off from /db. When the
  // user clicks "Create Links" on an existing event row this is the
  // row's event_key (or the cross-ref anchor id when the row is
  // legacy and never carried event_key). When /l is opened
  // standalone (no /db handoff) it stays empty and the worker
  // persists no event_key; the row therefore behaves as a brand-new
  // event, matching the spec for top-level Create.
  const [eventKey, setEventKey] = useState('');
  // Event date forwarded from /db so that the saved delivery row
  // carries the real event_date (or '' for TBA). The folder name
  // already encodes the date for legacy folders, but storing the
  // explicit event_date column lets /db group by date even when
  // the folder name doesn't carry the YYMMDD prefix.
  const [eventDateHandoff, setEventDateHandoff] = useState('');
  const [mobileView, setMobileView] = useState('left');
  // Visual flash on the clickable preview cards / textarea so
  // operators get tactile feedback after a copy or open action.
  const [copyFlash, setCopyFlash] = useState('');
  const clientInputRef = useRef(null);

  // One-shot invoice handoff. Only fills empty fields so that a
  // mid-edit reload from /inv → /l never clobbers manual changes.
  useEffect(() => {
    const handoff = readInvoiceHandoff();
    dbg('/l readInvoiceHandoff', handoff);
    const handoffName = handoff ? cleanLinkText(handoff.name) : '';
    // Standalone open (no /db or /inv handoff): default Event Date to
    // today in Asia/Jakarta so a fresh link starts dated rather than
    // TBA. A real /db handoff path falls through below and only sets
    // the date when it carries a valid eventDate, so an explicit
    // handoff (including a deliberate TBA / empty date) always wins.
    if (!handoff || !handoffName) {
      setEventDateHandoff((current) => current || jakartaTodayISO());
      return;
    }
    const handoffType = String(handoff.type || '').trim().toLowerCase() === 'vendor' ? 'vendor' : 'client';
    const handoffTitle = handoffType === 'vendor' ? '' : normalizeInvoiceTitleValue(handoff.title);
    setDeliveryType(handoffType);
    setTitle(handoffTitle);
    setLinkedInvoiceId(cleanLinkText(handoff.invoiceId || ''));
    // Capture the stable parent client id when present. /db
    // forwards the selected client's clients.id so the worker
    // can attach the new delivery to that exact bucket. Any
    // non-empty trimmed value is accepted (UUIDs, legacy ids); an
    // empty string round-trips cleanly and the worker falls back
    // to its name+contact lookup, matching pre-fix behaviour.
    setLinkedClientId(String(handoff.clientId || '').trim().slice(0, 80));
    // Capture the per-event grouping anchors. eventKey is whatever
    // /db handed us (an existing row's event_key, the row's id used
    // as a cross-ref, or empty when the link page was opened
    // standalone). eventDate is sanitised to YYYY-MM-DD; anything
    // else stays empty so a TBA event survives the round-trip.
    const handoffEventKey = String(handoff.eventKey || '').trim().slice(0, 80);
    if (handoffEventKey) setEventKey(handoffEventKey);
    const handoffEventDate = String(handoff.eventDate || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(handoffEventDate)) setEventDateHandoff(handoffEventDate);
    setClientName((current) => (current.trim() ? current : handoffName));
    setFolderName((current) => {
      if (current.trim()) return current;
      if (handoff.folderName) return normalizeFolderName(handoff.folderName);
      const code = folderCodeFromEventDate(handoff.eventDate);
      return code ? normalizeFolderName(`${code} ${handoffName}`) : current;
    });
    const nameText = handoffTitle ? `${handoffTitle} ${handoffName}` : handoffName;
    setStatus({
      text: `Loaded ${nameText} from invoice.`,
      tone: 'success',
    });
    // Mount-only: legacy /l reads handoff exactly once on page open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derived view-model for the preview pane. `displayPass`,
  // `shortLink`, and `generatedText` all prefer the saved snapshot
  // when its slug+pass+name still match the live inputs; otherwise
  // they fall back to the folder-derived preview values (with
  // empty strings for the post-save-only fields).
  const info = useMemo(() => {
    const folder = normalizeFolderName(folderName);
    const slug = buildBaseSlug(folder);
    const pass = buildFolderPassword(folder);
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    // Preview URL shown in the /l output card before the operator
    // hits Save. We intentionally drop the legacy "/g/" prefix so
    // even the placeholder mirrors the canonical client-facing
    // shape `https://<host>/<slug>` — the worker still serves
    // /g/<slug> for backward compatibility, but generated copy /
    // share text never references it. Once the row is saved the
    // worker returns a true 12-char shortLink which replaces this
    // value everywhere it's surfaced.
    const directUrl = slug ? `${origin}/${slug}` : origin;
    const cleanName = cleanLinkText(clientName);
    const matchesSaved =
      saved && saved.slug === slug && saved.pass === pass && saved.name === cleanName && saved.shortLink;
    return {
      folder,
      slug,
      pass,
      directUrl,
      shortLink: matchesSaved ? saved.shortLink : '',
      // Never surface the folder-derived `pass` as if it were final
      // — the worker generates the real secure password on save.
      // Stay empty pre-save so the preview card shows a neutral
      // "Generated on save" hint instead of a misleading value.
      displayPass: matchesSaved ? saved.password : '',
      generatedText: matchesSaved ? saved.generatedText : '',
    };
  }, [folderName, clientName, saved]);

  // Any input change clears the saved snapshot and any leftover
  // status banner so editing-after-generate never shows a stale
  // link or "Saved" message tied to the previous inputs.
  function markDirty() {
    setSaved((current) => (current ? null : current));
    setStatus({ text: '', tone: '' });
  }

  function flash(target) {
    setCopyFlash(target);
    setTimeout(() => setCopyFlash((current) => (current === target ? '' : current)), 850);
  }

  function handleClientNameChange(event) {
    setClientName(event.target.value);
    markDirty();
  }

  function handleClientNameBlur(event) {
    const raw = event.target.value;
    const trimmed = raw.trim();
    const next = toTitleCase(trimmed);
    if (next !== raw) {
      setClientName(next);
      markDirty();
    }
  }

  function handleFolderNameChange(event) {
    setFolderName(event.target.value);
    markDirty();
  }

  function handleFolderNameBlur(event) {
    const next = normalizeFolderName(event.target.value);
    if (next !== event.target.value) setFolderName(next);
    markDirty();
  }

  function handleServiceChange(key) {
    return (event) => {
      const value = event.target.value;
      setServiceUrls((current) => ({ ...current, [key]: value }));
      markDirty();
    };
  }

  async function submit(event) {
    event?.preventDefault?.();
    const name = cleanLinkText(clientName);
    const effectiveTitle = deliveryType === 'vendor' ? '' : title;
    if (!name) {
      setStatus({ text: 'Please fill client name.', tone: 'error' });
      clientInputRef.current?.focus();
      return;
    }
    if (!info.folder || !info.slug || !info.pass) {
      setStatus({ text: 'Please use folder name starting with YYMMDD + name.', tone: 'error' });
      return;
    }

    const links = LINK_SERVICES
      .map((service) => ({
        service: service.key,
        originalUrl: normalizeLinkUrl(serviceUrls[service.key]),
      }))
      .filter((link) => link.originalUrl);

    setBusy(true);
    setStatus({ text: 'Saving delivery...', tone: '' });
    dbg('/l submit', {
      eventKey,
      eventDateHandoff,
      linkedInvoiceId,
      linkedClientId,
      folderName: info.folder,
    });
    try {
      const response = await fetch('/api/save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Legacy payload shape preserved for compatibility. The
          // current worker authoritatively regenerates `password`
          // and `shortCode` server-side and ignores ours; we still
          // include them so older worker versions keep working.
          title: effectiveTitle,
          type: deliveryType,
          clientName: name,
          folderName: info.folder,
          baseSlug: info.slug,
          password: info.pass,
          shortCode: '',
          deliveryYear: 2000 + Number(info.slug.slice(0, 2)),
          deliveryMonth: Number(info.slug.slice(2, 4)),
          generatedTextWhatsapp: '',
          generatedTextInstagram: '',
          invoiceId: linkedInvoiceId,
          // Stable parent clients.id when /l was opened from a
          // selected /db client (or from /inv with one). The
          // worker treats this as the preferredId for
          // findOrCreateClient so the new delivery attaches to
          // this exact bucket and never spawns a duplicate. Empty
          // for standalone /l opens and the legacy fallback runs.
          // It sits alongside eventKey (per-event grouping anchor)
          // — the two are independent and both round-trip on save.
          clientId: linkedClientId,
          // Event grouping fields. Empty strings round-trip cleanly:
          // the worker only writes the columns when they're non-
          // empty and falls back to the legacy schema-tolerant
          // insert when the columns don't exist yet.
          eventKey,
          eventDate: eventDateHandoff,
          links,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.error || `Save failed (${response.status}).`);
      }
      dbg('/l save response', {
        deliveryId: data.deliveryId,
        migrationMissing: data.migrationMissing || null,
      });

      const finalShortLink =
        data.shortLink ||
        (data.shortUrl ? `${window.location.origin}${data.shortUrl}` : info.directUrl);
      const finalPassword = String(data.password || '').trim() || info.pass;
      const finalMessage =
        data.generatedText ||
        buildPreviewMessage(effectiveTitle, name, {
          ...info,
          shortLink: finalShortLink,
          pass: finalPassword,
        });

      setSaved({
        slug: info.slug,
        pass: info.pass,
        password: finalPassword,
        name,
        shortCode: data.shortCode || '',
        shortLink: finalShortLink,
        generatedText: finalMessage,
      });

      const copied = await copyToClipboard(finalMessage);
      const baseMsg = copied ? 'Saved and copied.' : 'Saved. Please copy manually.';
      // The event_key/event_date columns are now part of the
      // applied schema (db-migration-part-6.sql). The worker still
      // returns `migrationMissing` if it ever has to fall back to
      // the schema-tolerant insert path, but we no longer surface
      // that as a scary user-facing warning. Instead we log to the
      // console and only embed it in the visible status when the
      // operator has the debug flag on (?debug=1) — admin-only.
      if (data.migrationMissing) {
        console.warn(
          '[l] schema fallback engaged on save — event grouping fell back to invoice_data jsonb cross-ref. Apply db-migration-part-6.sql.',
          data.migrationMissing,
        );
      }
      const warningSuffix = data.migrationMissing && dbgEnabled()
        ? ' [admin] schema fallback: event_key/event_date dropped, jsonb cross-ref written.'
        : '';
      setStatus({
        text: `${baseMsg}${warningSuffix}`,
        tone: 'success',
      });
      setMobileView('right');
    } catch (error) {
      setStatus({ text: error.message || 'Save failed.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  function clearAll() {
    setTitle(deliveryType === 'vendor' ? '' : 'Ms.');
    setClientName('');
    setFolderName('');
    setServiceUrls({ gd: '', db: '', wt: '', tn: '' });
    setLinkedInvoiceId('');
    setLinkedClientId('');
    setEventKey('');
    setEventDateHandoff('');
    setSaved(null);
    setStatus({ text: '', tone: '' });
    setMobileView('left');
    setTimeout(() => clientInputRef.current?.focus(), 0);
  }

  async function copyMessage() {
    const text = info.generatedText;
    if (!text) {
      setStatus({ text: 'Generate first.', tone: 'error' });
      return;
    }
    const ok = await copyToClipboard(text);
    if (ok) {
      flash('msg');
      setStatus({ text: 'Copied.', tone: 'success' });
    } else {
      setStatus({ text: 'Please copy manually.', tone: 'error' });
    }
  }

  async function copyPassword() {
    const value = info.displayPass;
    if (!value) {
      setStatus({ text: 'Save first to copy the password.', tone: 'error' });
      return;
    }
    const ok = await copyToClipboard(value);
    if (ok) {
      flash('pass');
      setStatus({ text: 'Copied.', tone: 'success' });
    } else {
      setStatus({ text: 'Please copy manually.', tone: 'error' });
    }
  }

  function openShortLink() {
    // Despite the legacy name, this action now copies the short
    // link to clipboard rather than opening it in a new tab. The
    // operator can still inspect the live page from /db's
    // delivery detail; the /l preview card is purely a
    // tap-to-copy convenience while composing.
    const url = info.shortLink;
    if (!url) {
      setStatus({ text: 'Generate first to copy the short link.', tone: 'error' });
      return;
    }
    copyToClipboard(url);
    flash('short');
    setStatus({ text: 'Copied.', tone: 'success' });
  }

  // What the delivery card displays. Mirrors the legacy logic:
  // saved → strip protocol; valid candidate slug+pass → "Save first";
  // otherwise → site host as a placeholder hint.
  const fallbackHost = typeof window !== 'undefined' ? window.location.host : 'sshots.pages.dev';
  const deliveryDisplay = info.shortLink
    ? info.shortLink.replace(/^https?:\/\//, '')
    : info.slug && info.pass
      ? 'Save first'
      : fallbackHost;

  const left = (
    <form className="form-stack lg-form" onSubmit={submit} noValidate>
      <div className={`two-col${deliveryType === 'vendor' ? ' one-col' : ''}`}>
        {deliveryType === 'vendor' ? null : (
          <label>
            Title
            <select
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                markDirty();
              }}
            >
              <option>Ms.</option>
              <option>Mr.</option>
            </select>
          </label>
        )}
        <label>
          Name
          <input
            ref={clientInputRef}
            value={clientName}
            onChange={handleClientNameChange}
            onBlur={handleClientNameBlur}
            placeholder="Client name"
            autoComplete="name"
          />
        </label>
      </div>
      <label>
        Folder Name
        <input
          value={folderName}
          onChange={handleFolderNameChange}
          onBlur={handleFolderNameBlur}
          placeholder="260606 StarShots ( Events )"
          autoComplete="off"
        />
      </label>
      <label>
        Event Date
        <DateTimeField
          value={eventDateHandoff}
          onChange={(value) => {
            // Real event date the operator wants stamped on the
            // saved /l row. Empty = TBA, which is the spec default
            // when an event hasn't been scheduled yet. The /l save
            // payload forwards this value verbatim to the worker;
            // the worker writes it to deliveries.event_date when
            // non-empty and skips the column when empty so the row
            // remains TBA-grouped.
            setEventDateHandoff(value);
            markDirty();
          }}
          ariaLabel="Event date"
        />
      </label>
      <p className="eyebrow lg-services-heading">Delivery Links</p>
      <div className="lg-services">
        {LINK_SERVICES.map((service) => (
          <ServiceField
            key={service.key}
            chip={service.key.toUpperCase()}
            label={service.label}
            value={serviceUrls[service.key]}
            placeholder={service.placeholder}
            onChange={handleServiceChange(service.key)}
          />
        ))}
      </div>
      <div className="lg-actions">
        <button type="button" className="ghost-button compact" onClick={clearAll}>
          Clear
        </button>
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? 'Saving\u2026' : 'Generate'}
        </button>
      </div>
      <p className={`download-status${status.tone ? ` lg-status-${status.tone}` : ''}`}>
        {status.text}
      </p>
    </form>
  );

  const right = (
    <div className="lg-preview">
      <header className="preview-toolbar lg-preview-toolbar">
        <div>
          <p className="eyebrow">Generated Text</p>
          <h2>Short link + password</h2>
          <span
            className={`event-date-pill event-tone-${eventDateTone(eventDateHandoff, jakartaTodayISO())} lg-event-date-pill`}
            aria-label={`Event ${compactEventDateLabel(eventDateHandoff)}`}
          >
            {compactEventDateLabel(eventDateHandoff)}
          </span>
        </div>
        <div className="preview-toolbar-actions">
          <button type="button" className="ghost-button compact" onClick={copyMessage}>
            Copy
          </button>
          <button
            type="button"
            className="toolbar-icon-btn"
            onClick={() => submit()}
            disabled={busy}
            aria-label={busy ? 'Saving delivery' : 'Save delivery'}
            title={busy ? 'Saving...' : 'Save'}
          >
            <SaveIcon saving={busy} />
          </button>
        </div>
      </header>
      <div className="lg-stats">
        <button
          type="button"
          className={`lg-stat-card${copyFlash === 'short' ? ' is-flash' : ''}`}
          onClick={openShortLink}
          aria-label="Copy short link"
        >
          <span>Short Link</span>
          <strong>{deliveryDisplay}</strong>
        </button>
        <button
          type="button"
          className={`lg-stat-card${copyFlash === 'pass' ? ' is-flash' : ''}`}
          onClick={copyPassword}
          aria-label="Copy password"
        >
          <span>Password</span>
          <strong>{info.displayPass || 'Generated on save'}</strong>
        </button>
      </div>
      <textarea
        className={`lg-output${copyFlash === 'msg' ? ' is-flash' : ''}`}
        value={info.generatedText}
        readOnly
        placeholder="Generated delivery message will appear here..."
      />
    </div>
  );

  return (
    <WorkspacePanels
      active="/l/"
      // /l only needs a back-link to the workspace home. No Links/
      // Invoice/Subs in the nav row.
      navItems={[{ href: '/db/', label: 'Database' }]}
      left={left}
      right={right}
      mobileView={mobileView}
      onMobileViewChange={setMobileView}
      mobileTabs={{ left: 'Form', right: 'Output' }}
    />
  );
}

