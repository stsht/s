import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { PrivateWorkspaceFrame } from '../../components/PrivateWorkspaceFrame.jsx';
import { Segmented, EmptyState } from '../../components/ui/index.js';
import { toTitleCase, onBlurTitleCase } from '../../utils/titleCase.js';

function rupiah(value) {
  const number = Number(value) || 0;
  return `Rp ${Math.round(number).toLocaleString('id-ID')}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dateLabel(value) {
  if (!value) return 'No date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Whether a string is a contact value worth showing under a client
// row. Used by /db's left list to scrub raw timestamps (e.g.
// "2026-05-17T13:08:21.123Z") and other non-contact metadata that
// previously leaked into the visible meta line. Accepts only the
// three shapes the design calls out: phone, Instagram handle/URL,
// or email. Anything else (ISO dates, normalized slugs, empty
// strings) is rejected and the meta line is hidden.
function isHumanReadableContact(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  // Discard timestamp-shaped strings outright. Both the full ISO
  // form and bare YYYY-MM-DD count — the dashboard never wants
  // these on a client card.
  if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(v)) return false;
  // Email — at least one '@' separating two non-empty halves.
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return true;
  // Instagram — handle (@name) or full instagram.com URL.
  if (/^@[a-zA-Z0-9._]+$/.test(v)) return true;
  if (/instagram\.com\//i.test(v)) return true;
  // Phone — digits with optional +, spaces, dashes, parens. At
  // least 6 digits in total so 4-digit years can't masquerade.
  const digits = v.replace(/[^\d]/g, '');
  if (digits.length >= 6 && /^\+?[\d\s\-().]+$/.test(v)) return true;
  return false;
}

// Inline X glyph used by every list/row delete control on /db.
// Stroke-only path so the icon picks up `currentColor`, which lets
// CSS swap idle/hover palettes without touching the SVG markup.
function DeleteIcon() {
  return (
    <svg
      className="row-delete-icon"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4 4 L12 12 M12 4 L4 12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function createRecordUrl(path, params) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return `${url.pathname}${url.search}`;
}

// Map a subscription row to one of three visual states.
//
// active  - currently in good standing — green.
// expired - expiry_date has already passed — red.
// warning - expiry_date within the next 3 days AND the row hasn't been
//           settled (status is anything other than paid/solved/closed
//           or one of the "recurring" status hints) — orange so
//           renewal stays visible.
//
// Recurring/renew/active/paid statuses always read as green when the
// subscription is not yet expired, even inside the 3-day warning
// window — the operator has already confirmed the row is being
// kept alive.
//
// The rule intentionally checks `expiry_date` only — `start_date`
// without an expiry is treated as still active. Returning a stable
// className lets the styling live in CSS.
const SUBS_SETTLED_STATUS_PATTERN = /recurring|renew|active|paid|solved|closed/;

function subscriptionTone(sub = {}) {
  const expiryRaw = sub.expiry_date || '';
  if (!expiryRaw) return 'active';
  const expiry = new Date(`${expiryRaw}T23:59:59Z`);
  if (Number.isNaN(expiry.getTime())) return 'active';
  const now = Date.now();
  const diffDays = (expiry.getTime() - now) / 86400000;
  if (diffDays < 0) return 'expired';
  const status = String(sub.status || '').toLowerCase();
  const isSettled = SUBS_SETTLED_STATUS_PATTERN.test(status);
  if (diffDays <= 3 && !isSettled) return 'warning';
  return 'active';
}

// Format the Subs-tab list meta from a subscription row. Produces
// e.g. "ChatGPT Paid" / "Google Drive Active" / "Dropbox Expired" —
// the service name passed through verbatim, status capitalised and
// joined with a single space (no hyphen). Falls back to "Active"
// when the row has no status, mirroring the empty-state used by
// the rest of the dashboard.
function formatSubscriptionMeta(sub = {}) {
  const service = String(sub.service || 'Subscription').trim();
  const statusRaw = String(sub.status || '').trim();
  const status = statusRaw ? toTitleCase(statusRaw) : 'Active';
  return `${service} ${status}`.trim();
}

function PageChrome() {
  // Removed: legacy /admin dashboard chrome. /db is now the workspace home;
  // /l, /subs migrated to PrivateWorkspaceFrame. Kept as a placeholder to
  // preserve historical export shape during cleanup but no longer rendered.
  return null;
}

function ToolCard({ tool }) {
  return (
    <a className="tool-card" href={tool.href}>
      <span>{tool.eyebrow}</span>
      <strong>{tool.title}</strong>
      <p>{tool.body}</p>
      <em>Open</em>
    </a>
  );
}

export function AdminDashboard() {
  // /admin route removed; _redirects sends /admin → /db/. This export is
  // retained as a no-op fallback so any stray import resolves cleanly.
  return null;
}

function friendlyDbError(message) {
  const text = String(message || '').trim();
  if (!text) return 'Database request failed. Check API configuration.';
  // Map raw PostgREST/Supabase payloads (e.g. "{\"code\":\"PGRST125\",
  // \"message\":\"Invalid path specified in request URL\"}") onto a
  // short user-facing message. Anything that looks like a JSON blob
  // or carries a PGRSTxxx code is treated as backend noise and
  // redacted. Plain operator messages (e.g. "Unauthorized.") pass
  // through unchanged.
  if (/PGRST\d+/i.test(text)) return 'Database request failed. Check API configuration.';
  if (/^\s*\{[\s\S]*\}\s*$/.test(text)) return 'Database request failed. Check API configuration.';
  return text;
}

// useRemoteList: fetch the /api/db payload and expose a refetch hook
// so delete actions can refresh the dashboard without a full page
// reload. The `version` counter triggers re-runs of the effect on
// demand; the endpoint string is still the primary dependency so
// switching tabs / search query also re-fetches.
function useRemoteList(endpoint) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('Loading...');
  const [version, setVersion] = useState(0);
  const refetch = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    fetch(endpoint, { credentials: 'same-origin' })
      .then(async (response) => {
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          return { ok: false, error: json.error || `Unable to load (${response.status}).`, code: json.code };
        }
        return json;
      })
      .then((json) => {
        if (!alive) return;
        setData(json);
        if (json?.ok === false) {
          if (json.error) console.warn('[db] api error:', json.error, json.code || '');
          setStatus(friendlyDbError(json.error));
        } else {
          setStatus('');
        }
      })
      .catch((error) => {
        if (!alive) return;
        console.warn('[db] fetch error:', error);
        if (import.meta.env.DEV) {
          setStatus('API unavailable in Vite dev. Production data loads on Pages.');
        } else {
          setStatus(friendlyDbError(error?.message));
        }
      });
    return () => { alive = false; };
  }, [endpoint, version]);

  return { data, status, refetch };
}

function ListRow({ title, meta, amount }) {
  return (
    <article className="list-row">
      <div>
        <strong>{title || 'Untitled'}</strong>
        <span>{meta || 'No details yet'}</span>
      </div>
      {amount ? <b>{amount}</b> : null}
    </article>
  );
}

function buildClientRecords(client, invoices, deliveries) {
  const rows = new Map();
  const clientId = String(client?.client_id || client?.id || '').trim();
  const clientName = String(client?.name || client?.client_name || '').trim().toLowerCase();
  const matches = (record) => {
    const recordClientId = String(record?.client_id || '').trim();
    const recordName = String(record?.client_name || record?.name || '').trim().toLowerCase();
    if (clientId && recordClientId && clientId === recordClientId) return true;
    return !!clientName && !!recordName && clientName === recordName;
  };
  const ensure = (key, seed) => {
    if (!rows.has(key)) rows.set(key, { ...seed, invoice: null, delivery: null });
    return rows.get(key);
  };

  deliveries.filter(matches).forEach((delivery) => {
    const date = delivery.event_date || delivery.created_at || '';
    const key = date || `delivery:${delivery.id}`;
    ensure(key, {
      date,
      name: delivery.client_name || client.name,
      title: delivery.title || client.title,
      contact: client.contact || '',
    }).delivery = delivery;
  });

  invoices.filter(matches).forEach((invoice) => {
    const date = invoice.event_date || invoice.invoice_date || invoice.created_at || '';
    const key = date || `invoice:${invoice.id}`;
    ensure(key, {
      date,
      name: invoice.client_name || client.name,
      title: invoice.client_title || client.title,
      contact: invoice.client_contact || client.contact || '',
    }).invoice = invoice;
  });

  return [...rows.values()].sort((a, b) => (Date.parse(b.date || '') || 0) - (Date.parse(a.date || '') || 0));
}

function ClientForm({ draft, onChange, onCancel, onSave, status }) {
  return (
    <form className="client-form" onSubmit={onSave}>
      <div className="client-form-grid">
        <label>Title
          <select value={draft.title} onChange={(event) => onChange({ ...draft, title: event.target.value })}>
            <option>Ms.</option>
            <option>Mr.</option>
          </select>
        </label>
        <label>Name
          <input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="Client name" />
        </label>
      </div>
      <label>Contact
        <input value={draft.contact} onChange={(event) => onChange({ ...draft, contact: event.target.value })} placeholder="Instagram / phone / email" />
      </label>
      <div className="client-actions">
        <button className="primary-button" type="submit">Save Client</button>
        <button className="ghost-button compact" type="button" onClick={onCancel}>Cancel</button>
      </div>
      {status ? <p className="client-status">{status}</p> : null}
    </form>
  );
}

function ClientDetail({ client, invoices, deliveries, onCreateEvent, onDeleteClient, onDeleteRecord, onClose }) {
  const records = buildClientRecords(client, invoices, deliveries);
  const title = client?.title || 'Ms.';
  const name = client?.name || client?.client_name || 'Client';
  const contact = client?.contact || client?.client_contact || '';
  const linkHref = createRecordUrl('/l/', { title, name, contact });
  const invoiceHref = createRecordUrl('/inv/', { title, name, contact });

  return (
    <>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Client</p>
          <h2>{name}</h2>
          {contact ? <span>{contact}</span> : null}
        </div>
        <div className="detail-actions">
          <a className="ghost-button compact" href={linkHref} target="_blank" rel="noopener noreferrer">Create Links</a>
          <a className="ghost-button compact" href={invoiceHref} target="_blank" rel="noopener noreferrer">Create Invoice</a>
          <button
            type="button"
            className="ghost-button compact db-delete-button"
            onClick={() => onDeleteClient?.(client)}
          >
            Delete Client
          </button>
          <button
            type="button"
            className="db-close-button"
            onClick={onClose}
            aria-label="Close detail view"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      <div className="record-stack">
        {records.map((row, index) => {
          const eventLinkHref = row.delivery?.id
            ? row.delivery.short_url || row.delivery.delivery_url || linkHref
            : createRecordUrl('/l/', { title: row.title || title, name: row.name || name, contact, eventDate: row.date });
          const eventInvoiceHref = row.invoice?.id
            ? createRecordUrl('/inv/', { invoiceId: row.invoice.id })
            : createRecordUrl('/inv/', { title: row.title || title, name: row.name || name, contact, eventDate: row.date });
          // A row's stable identity is delivery.id ?? invoice.id ?? date —
          // we use it to drive both the React key and the mobile "armed"
          // state (parent owns the armed-id so only one row at a time
          // can show its delete button on touch devices).
          const recordKey = row.delivery?.id || row.invoice?.id || `${row.date}-${index}`;
          return (
            <RecordRow
              key={recordKey}
              recordKey={recordKey}
              row={row}
              fallbackName={name}
              eventLinkHref={eventLinkHref}
              eventInvoiceHref={eventInvoiceHref}
              onDelete={() => onDeleteRecord?.(row)}
            />
          );
        })}
        {!records.length ? <p className="empty-state">No events yet.</p> : null}
      </div>
      <button className="create-event-button" type="button" onClick={onCreateEvent}>Create Events</button>
    </>
  );
}

// One event row inside the client detail. The delete control is a
// permanent X glyph at the far right of the row — no hover/tap-to-
// reveal flow. The row's grid lays out date / name / View Links /
// View Invoice / X in that order; the X column is a fixed width so
// the inner action anchors shift left and never overlap the X. The
// row itself stays a plain shell (no click handler) so taps inside
// it never accidentally arm a delete; only the explicit X press
// triggers onDelete.
function RecordRow({ recordKey, row, fallbackName, eventLinkHref, eventInvoiceHref, onDelete }) {
  const linkLabel = row.delivery?.id ? 'View Links' : 'Create Links';
  const invoiceLabel = row.invoice?.id ? 'View Invoice' : 'Create Invoice';
  return (
    <article className="record-row" data-key={recordKey}>
      <span>{dateLabel(row.date)}</span>
      <strong>{row.name || fallbackName}</strong>
      <a href={eventLinkHref} target="_blank" rel="noopener noreferrer">
        {linkLabel}
      </a>
      <a href={eventInvoiceHref} target="_blank" rel="noopener noreferrer">
        {invoiceLabel}
      </a>
      <button
        type="button"
        className="row-delete-x"
        onClick={(event) => {
          event.stopPropagation();
          onDelete?.();
        }}
        aria-label="Delete event"
      >
        <DeleteIcon />
      </button>
    </article>
  );
}

// Right-panel detail view for the Subs tab. Mirrors ClientDetail's
// chrome (heading + delete + close X) but the body is a flat tile
// stack of subscription fields. Reusing ClientDetail here would have
// shown "No events yet" because subscription-only clients have no
// invoice/delivery rows — that mismatch was the bug this view fixes.
//
// Create Invoice / Create Links are intentionally omitted: a
// subscription is a recurring service, not a one-off event, so
// those CTAs don't apply. The Subs page (/subs) is the canonical
// entry for editing/regenerating a subscription bill or receipt.
function SubscriptionDetail({ client, subscription, onDeleteSubscription, onClose }) {
  const name = client?.name || client?.client_name || subscription?.client_name || 'Client';
  const contact = client?.contact || client?.client_contact || subscription?.client_contact || '';
  const tone = subscription ? subscriptionTone(subscription) : '';

  const statusRaw = String(subscription?.status || '').trim();
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
  const period = Number(subscription?.access_period);
  const periodLabel = Number.isFinite(period) && period > 0 ? `${period} Days` : '';
  const priceLabel = Number.isFinite(Number(subscription?.price))
    ? rupiah(subscription.price)
    : '';
  const priceField = String(subscription?.status || '').toLowerCase() === 'paid'
    ? 'Paid Amount'
    : 'Price';

  // Build the field list. Empty fields are dropped so the panel
  // never shows a wall of "—" placeholders for a thin record.
  const fields = [
    { label: 'Service', value: subscription?.service || '' },
    { label: 'Status', value: statusLabel },
    { label: 'Storage', value: subscription?.storage_slot || subscription?.storage || '' },
    { label: 'Period', value: periodLabel },
    { label: priceField, value: priceLabel },
    { label: 'Invoice Date', value: subscription?.invoice_date ? dateLabel(subscription.invoice_date) : '' },
    { label: 'Payment Date', value: subscription?.payment_date ? dateLabel(subscription.payment_date) : '' },
    { label: 'Payment Time', value: subscription?.payment_time || '' },
    { label: 'Start Date', value: subscription?.start_date ? dateLabel(subscription.start_date) : '' },
    { label: 'Start Time', value: subscription?.start_time || '' },
    { label: 'Expiry Date', value: subscription?.expiry_date ? dateLabel(subscription.expiry_date) : '' },
    { label: 'Contact', value: contact },
  ].filter((f) => String(f.value || '').trim());

  return (
    <>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Subscription</p>
          <h2>
            {name}
            {tone && toneLabel ? (
              <span className={`sub-badge sub-badge-${tone}`}>{toneLabel}</span>
            ) : null}
          </h2>
          {contact ? <span>{contact}</span> : null}
        </div>
        <div className="detail-actions">
          {subscription?.id ? (
            <button
              type="button"
              className="ghost-button compact db-delete-button"
              onClick={() => onDeleteSubscription?.(subscription)}
            >
              Delete Subscription
            </button>
          ) : null}
          <button
            type="button"
            className="db-close-button"
            onClick={onClose}
            aria-label="Close detail view"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      {!subscription ? (
        <p className="empty-state">No subscription details available.</p>
      ) : (
        <div className={`list-stack${tone ? ` sub-${tone}` : ''}`}>
          {fields.map((field) => (
            <article className="list-row" key={field.label}>
              <div>
                <strong>{field.label}</strong>
                <span>{field.value}</span>
              </div>
            </article>
          ))}
          {!fields.length ? <p className="empty-state">No subscription details available.</p> : null}
        </div>
      )}
    </>
  );
}

// Polished drag-and-drop upload zone used by SubscriptionImport.
// Wraps a visually-hidden <input type="file"> so the same control
// handles three input modes:
//   • click anywhere on the zone       → opens the file picker
//   • drag a file over the zone        → highlights drop target
//   • drop a file onto the zone        → handed to onFile(File)
// The native input also stays keyboard-focusable: pressing Enter
// or Space while focused opens the picker, matching link/button
// affordances. The dragCounter ref is what keeps the highlight
// stable when the pointer crosses child elements (each enter/leave
// nests, and naive boolean state would flicker).
function SubsImportDropZone({ busy, fileName, onFile }) {
  const inputRef = useRef(null);
  const dragCounter = useRef(0);
  const [dragActive, setDragActive] = useState(false);

  function pickFile() {
    if (busy) return;
    inputRef.current?.click();
  }

  function onKeyDown(event) {
    if (busy) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pickFile();
    }
  }

  function onChange(event) {
    const file = event.target?.files?.[0];
    if (file) onFile(file);
    // Reset so re-selecting the same file fires another change.
    if (event.target) event.target.value = '';
  }

  function onDragEnter(event) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    dragCounter.current += 1;
    if (event.dataTransfer?.items?.length) setDragActive(true);
  }

  function onDragOver(event) {
    // Required to make the element a valid drop target — without
    // this the browser cancels the drop before our handler runs.
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  function onDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragActive(false);
  }

  function onDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current = 0;
    setDragActive(false);
    if (busy) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) onFile(file);
  }

  const stateClass = busy
    ? ' subs-drop--busy'
    : dragActive
      ? ' subs-drop--active'
      : '';

  return (
    <div className="subs-drop-wrap">
      <span className="qr-upload-label">Receipt JPG</span>
      <div
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-disabled={busy}
        aria-label="Drop a StarShots receipt JPG here, or click to browse"
        className={`subs-drop${stateClass}`}
        onClick={pickFile}
        onKeyDown={onKeyDown}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onChange}
          disabled={busy}
          tabIndex={-1}
          aria-hidden="true"
        />
        <svg className="subs-drop-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M12 16V4m0 0l-4 4m4-4l4 4M5 20h14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <strong className="subs-drop-title">
          {busy
            ? 'Reading image\u2026'
            : dragActive
              ? 'Drop to extract fields'
              : 'Drop a StarShots receipt here'}
        </strong>
        <span className="subs-drop-hint">
          {fileName
            ? fileName
            : 'or click to browse \u00b7 JPG, PNG, or WebP'}
        </span>
      </div>
    </div>
  );
}

const SUBS_IMPORT_SERVICE_ALIASES = [
  { aliases: ['google-drive', 'googledrive', 'gdrive', 'drive'], label: 'Google Drive', pattern: /google\s*drive|gdrive/i },
  { aliases: ['chatgpt', 'gpt'], label: 'ChatGPT', pattern: /chat\s*gpt|chatgpt/i },
  { aliases: ['icloud', 'i-cloud'], label: 'iCloud', pattern: /icloud|i\s*cloud/i },
  { aliases: ['dropbox'], label: 'Dropbox', pattern: /dropbox/i },
  { aliases: ['copilot'], label: 'Copilot', pattern: /copilot/i },
];

function completeImportTime(value) {
  const match = String(value || '').trim().replace(/\./g, ':').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return '';
  return `${match[1].padStart(2, '0')}:${match[2]}:${match[3] || '00'}`;
}

function normalizeImportService(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const found = SUBS_IMPORT_SERVICE_ALIASES.find((item) => item.pattern.test(normalized));
  return found ? found.label : toTitleCase(normalized);
}

function parseImportFilename(fileName = '') {
  const base = String(fileName || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  const match = base.match(/^subscription-(paid|invoice|confirmed)-(.+)$/i);
  if (!match) return {};
  const status = match[1] === 'invoice' ? 'invoice' : 'paid';
  const tail = match[2];
  let serviceRaw = '';
  let clientRaw = '';
  const aliases = SUBS_IMPORT_SERVICE_ALIASES.flatMap((item) => item.aliases.map((alias) => ({ alias, label: item.label })));
  const found = aliases
    .sort((a, b) => b.alias.length - a.alias.length)
    .find(({ alias }) => tail === alias || tail.startsWith(`${alias}-`));
  if (found) {
    serviceRaw = found.label;
    clientRaw = tail.slice(found.alias.length).replace(/^-+/, '');
  } else {
    const pieces = tail.split('-').filter(Boolean);
    serviceRaw = pieces.shift() || '';
    clientRaw = pieces.join(' ');
  }
  const titleMatch = clientRaw.match(/^(mr|ms|mrs|family)-(.+)$/i);
  return {
    client_title: titleMatch
      ? (titleMatch[1].toLowerCase() === 'mrs' ? 'Mrs.' : titleMatch[1].toLowerCase() === 'ms' ? 'Ms.' : titleMatch[1].toLowerCase() === 'family' ? 'Family' : 'Mr.')
      : '',
    client_name: toTitleCase((titleMatch ? titleMatch[2] : clientRaw).replace(/[-_]+/g, ' ')),
    service: normalizeImportService(serviceRaw),
    status,
  };
}

function parseReceiptGreeting(text = '') {
  const match = String(text || '').match(/Hello,\s*(?:(Mr\.?|Ms\.?|Mrs\.?|Family)\s+)?([A-Za-z][A-Za-z0-9 .'-]{1,80})!?/i);
  if (!match) return {};
  const rawTitle = String(match[1] || '').trim();
  const clientTitle = /^mrs\.?$/i.test(rawTitle)
    ? 'Mrs.'
    : /^ms\.?$/i.test(rawTitle)
      ? 'Ms.'
      : /^family$/i.test(rawTitle)
        ? 'Family'
        : rawTitle
          ? 'Mr.'
          : '';
  return {
    client_title: clientTitle,
    client_name: toTitleCase(String(match[2] || '').trim()),
  };
}

function mergeImportParsed(...sources) {
  return sources.reduce((merged, source) => {
    Object.entries(source || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== '') merged[key] = value;
    });
    return merged;
  }, {});
}

function hasUsefulImport(parsed = {}) {
  return !!(
    parsed.client_name ||
    parsed.service ||
    parsed.payment_date ||
    parsed.start_date ||
    parsed.expiry_date
  );
}

function missingCoreImportFields(parsed = {}) {
  return !parsed.client_name || !parsed.service || !parsed.payment_date || !parsed.start_date || !parsed.expiry_date;
}

async function extractSubscriptionReceiptInBrowser(file, setStatus) {
  const filenameParsed = parseImportFilename(file?.name || '');
  try {
    setStatus?.('Server could not read it. Trying browser OCR...');
    const Tesseract = await loadTesseract();
    setStatus?.('Reading receipt text...');
    let data;
    if (typeof Tesseract.recognize === 'function') {
      const result = await Tesseract.recognize(file, 'eng');
      data = result?.data || {};
    } else {
      const worker = await Tesseract.createWorker();
      const result = await worker.recognize(file);
      data = result?.data || {};
      await worker.terminate();
    }
    const text = String(data?.text || '');
    const extracted = parseOcrText(text);
    const parsed = mergeImportParsed(filenameParsed, {
      ...parseReceiptGreeting(text),
      service: normalizeImportService(extracted.service || filenameParsed.service),
      status: extracted.status || filenameParsed.status,
      payment_date: extracted.paymentDate,
      payment_time: completeImportTime(extracted.paymentTime),
      access_period: extracted.accessPeriod,
      start_date: extracted.startDate,
      start_time: completeImportTime(extracted.startTime),
      expiry_date: extracted.expiryDate,
      expiry_time: completeImportTime(extracted.expiryTime),
      price: extracted.paidAmount,
    });
    return {
      parsed,
      confidence: Number(data?.confidence || 0),
      usedBrowserOcr: true,
    };
  } catch (error) {
    console.warn('[subs-import] browser OCR failed:', error);
    return {
      parsed: filenameParsed,
      confidence: 0,
      usedBrowserOcr: false,
      error,
    };
  }
}

// Right-panel "Import JPG" flow for /db Subs. Step 1 is a file
// picker; step 2 is the editable preview that shows extracted
// fields and lets the operator correct anything before Save.
//
// On Save we POST to /api/subscriptions-save with the matched
// existing-subscription id (when present) so the row is updated
// rather than duplicated for the same client+service+payment+start.
//
// Failure is graceful: if the server returns ok:false (or the
// vision provider is unavailable), the form opens with empty
// fields so the operator can type the receipt manually. The
// uploaded image is never stored — the request body is consumed
// once and dropped on the server.
function SubscriptionImport({ onSaved, onCancel }) {
  const [stage, setStage] = useState('upload'); // 'upload' | 'edit'
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState('');
  const [existingId, setExistingId] = useState('');
  const [fileName, setFileName] = useState('');
  // All date/time fields start blank. The spec is explicit: do NOT
  // default to today when extraction fails — leave them empty so the
  // operator visibly sees what wasn't read instead of silently
  // saving "today" for a receipt the OCR never matched.
  const [draft, setDraft] = useState({
    client_title: 'Mr.',
    client_name: '',
    client_contact: '',
    service: '',
    storage_slot: '',
    rate_mode: 'normal',
    price: 0,
    status: 'paid',
    invoice_date: '',
    payment_date: '',
    payment_time: '',
    access_period: 30,
    start_date: '',
    start_time: '',
    expiry_date: '',
    expiry_time: '',
  });

  function setField(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  // Merge server-parsed fields into the draft. Empty/null values
  // fall back to the current draft so a partial extraction still
  // leaves any defaults the operator already saw.
  function applyParsed(parsed = {}) {
    setDraft((current) => ({
      ...current,
      client_title: parsed.client_title || current.client_title,
      client_name: parsed.client_name || current.client_name,
      client_contact: parsed.client_contact || current.client_contact,
      service: parsed.service || current.service,
      storage_slot: parsed.storage_slot || current.storage_slot,
      rate_mode: parsed.rate_mode || current.rate_mode,
      price: Number.isFinite(Number(parsed.price)) && Number(parsed.price) > 0
        ? Number(parsed.price)
        : current.price,
      status: parsed.status || current.status,
      invoice_date: parsed.invoice_date || current.invoice_date,
      payment_date: parsed.payment_date || current.payment_date,
      payment_time: parsed.payment_time || current.payment_time,
      access_period: Number.isFinite(Number(parsed.access_period)) && Number(parsed.access_period) > 0
        ? Number(parsed.access_period)
        : current.access_period,
      start_date: parsed.start_date || current.start_date,
      start_time: parsed.start_time || current.start_time,
      expiry_date: parsed.expiry_date || current.expiry_date,
      expiry_time: parsed.expiry_time || current.expiry_time,
    }));
  }

  // Receives a File instance from either the hidden <input
  // type="file"> click-picker or a drag-and-drop onto the upload
  // zone — both code paths funnel through here.
  async function handleFile(file) {
    if (!file) return;
    if (!/^image\//i.test(file.type || '')) {
      setStatus('Please drop a JPG, PNG, or WebP receipt image.');
      setStatusTone('error');
      return;
    }
    setFileName(file.name || '');
    setBusy(true);
    setStatus('Reading image\u2026');
    setStatusTone('');
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/subscriptions-import', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        const local = await extractSubscriptionReceiptInBrowser(file, setStatus);
        if (hasUsefulImport(local.parsed)) {
          applyParsed(local.parsed);
          setStatus(missingCoreImportFields(local.parsed)
            ? 'Needs review. Some fields were restored from filename/OCR, but blanks remain.'
            : 'Fields restored in-browser. Review and Save to create the row.');
          setStatusTone(missingCoreImportFields(local.parsed) ? '' : 'success');
        } else {
          // Spec requires the friendly message — fall through to the
          // edit stage so the operator can still type the fields. We
          // intentionally do NOT pre-fill any date/time field with
          // today(); the empty state itself signals "not extracted".
          setStatus(json.error || 'Could not read image, please enter manually.');
          setStatusTone('error');
        }
        setStage('edit');
        setExistingId('');
        return;
      }
      let parsed = json.parsed || {};
      if (json.needs_review || missingCoreImportFields(parsed)) {
        const local = await extractSubscriptionReceiptInBrowser(file, setStatus);
        parsed = mergeImportParsed(parsed, local.parsed);
      }
      applyParsed(parsed);
      setExistingId(String(json.existing?.id || ''));
      setStatus(missingCoreImportFields(parsed)
        ? (json.message || 'Needs review. Some fields could not be read.')
        : json.existing?.id
          ? 'Read OK. Existing subscription found \u2014 Save will update it.'
          : 'Read OK. Review and Save to create the row.');
      setStatusTone(missingCoreImportFields(parsed) ? '' : 'success');
      setStage('edit');
    } catch (error) {
      setStatus(error?.message || 'Could not read image, please enter manually.');
      setStatusTone('error');
      setStage('edit');
      setExistingId('');
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!String(draft.client_name || '').trim()) {
      setStatus('Client name is required.');
      setStatusTone('error');
      return;
    }
    if (!String(draft.service || '').trim()) {
      setStatus('Service is required.');
      setStatusTone('error');
      return;
    }
    setBusy(true);
    setStatus('Saving\u2026');
    setStatusTone('');
    try {
      const payload = { ...draft };
      // Pass id through when we matched an existing row so
      // /api/subscriptions-save runs as an update rather than an
      // insert — this is the duplicate-suppression contract.
      if (existingId) payload.id = existingId;
      const response = await fetch('/api/subscriptions-save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: payload, id: existingId || undefined }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) {
        throw new Error(json.error || `Save failed (${response.status}).`);
      }
      onSaved?.();
    } catch (error) {
      setStatus(error?.message || 'Save failed.');
      setStatusTone('error');
    } finally {
      setBusy(false);
    }
  }

  // Step 1 — pick a file. The operator can also click "Enter
  // manually" to skip the upload entirely (for cases where the
  // vision provider is offline and they already know the values).
  if (stage === 'upload') {
    return (
      <>
        <div className="detail-heading">
          <div>
            <p className="eyebrow">Subscription</p>
            <h2>Import JPG</h2>
            <span>Upload a StarShots receipt to auto-fill the subscription fields.</span>
          </div>
          <div className="detail-actions">
            <button
              type="button"
              className="db-close-button"
              onClick={onCancel}
              aria-label="Close importer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        <form className="form-stack subs-import-upload" onSubmit={(e) => e.preventDefault()}>
          <SubsImportDropZone
            busy={busy}
            fileName={fileName}
            onFile={handleFile}
          />
          {status ? (
            <p className={`download-status${statusTone ? ` lg-status-${statusTone}` : ''}`}>{status}</p>
          ) : null}
          <div className="client-actions">
            <button
              type="button"
              className="ghost-button compact"
              onClick={() => {
                // Manual subscription entry lives on /subs (the
                // dedicated invoice / receipt composer). The /db
                // Subs panel only handles JPG import + listing.
                window.location.assign('/subs/');
              }}
            >
              Enter manually
            </button>
            <button type="button" className="ghost-button compact" onClick={onCancel}>Cancel</button>
          </div>
        </form>
      </>
    );
  }

  // Step 2 — editable preview. Uses the same field grid the rest
  // of the dashboard uses; the operator can edit anything before
  // Save. "Re-upload" sends them back to step 1 to try a different
  // image without losing the open editor.
  return (
    <>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Subscription</p>
          <h2>
            Import JPG
            {existingId ? <span className="sub-badge sub-badge-active">Update</span> : null}
          </h2>
          <span>Review the extracted fields and Save.</span>
        </div>
        <div className="detail-actions">
          <button
            type="button"
            className="ghost-button compact"
            onClick={() => {
              setStage('upload');
              setStatus('');
              setStatusTone('');
              setExistingId('');
            }}
          >
            Re-upload
          </button>
          <button
            type="button"
            className="db-close-button"
            onClick={onCancel}
            aria-label="Close importer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      <form className="form-stack" onSubmit={handleSave}>
        <div className="two-col">
          <label>Title
            <select value={draft.client_title} onChange={(e) => setField('client_title', e.target.value)}>
              <option>Mr.</option>
              <option>Ms.</option>
              <option>Mrs.</option>
              <option>Family</option>
            </select>
          </label>
          <label>Client Name
            <input
              value={draft.client_name}
              onChange={(e) => setField('client_name', e.target.value)}
              onBlur={onBlurTitleCase((v) => setField('client_name', v))}
              placeholder="Client name"
            />
          </label>
        </div>
        <label>Service
          <input
            value={draft.service}
            onChange={(e) => setField('service', e.target.value)}
            placeholder="ChatGPT, iCloud, Google Drive\u2026"
          />
        </label>
        <div className="two-col">
          <label>Status
            <select value={draft.status} onChange={(e) => setField('status', e.target.value)}>
              <option value="paid">Paid</option>
              <option value="invoice">Invoice</option>
            </select>
          </label>
          <label>Access Period (Days)
            <input
              type="number"
              min="0"
              value={draft.access_period}
              onChange={(e) => setField('access_period', Number(e.target.value) || 0)}
            />
          </label>
        </div>
        <div className="two-col">
          <label>Payment Date
            <input
              type="date"
              value={draft.payment_date}
              onChange={(e) => setField('payment_date', e.target.value)}
            />
          </label>
          <label>Payment Time
            <input
              type="time"
              step="1"
              value={draft.payment_time}
              onChange={(e) => setField('payment_time', e.target.value)}
            />
          </label>
        </div>
        <div className="two-col">
          <label>Start Date
            <input
              type="date"
              value={draft.start_date}
              onChange={(e) => setField('start_date', e.target.value)}
            />
          </label>
          <label>Start Time
            <input
              type="time"
              step="1"
              value={draft.start_time}
              onChange={(e) => setField('start_time', e.target.value)}
            />
          </label>
        </div>
        <div className="two-col">
          <label>Expiry Date
            <input
              type="date"
              value={draft.expiry_date}
              onChange={(e) => setField('expiry_date', e.target.value)}
            />
          </label>
          <label>Expiry Time
            <input
              type="time"
              step="1"
              value={draft.expiry_time}
              onChange={(e) => setField('expiry_time', e.target.value)}
            />
          </label>
        </div>
        <label>Price (IDR)
          <input
            type="number"
            min="0"
            value={draft.price}
            onChange={(e) => setField('price', Number(e.target.value) || 0)}
          />
        </label>
        {status ? (
          <p className={`download-status${statusTone ? ` lg-status-${statusTone}` : ''}`}>{status}</p>
        ) : null}
        <div className="client-actions">
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? 'Saving\u2026' : (existingId ? 'Save (Update Existing)' : 'Save Subscription')}
          </button>
          <button className="ghost-button compact" type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </>
  );
}

export function DatabasePage() {
  const [tab, setTab] = useState('clients');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({ title: 'Ms.', name: '', contact: '' });
  const [saveStatus, setSaveStatus] = useState('');
  const [mobileView, setMobileView] = useState('left');
  const endpoint = `/api/db${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`;
  const { data, status, refetch } = useRemoteList(endpoint);
  const rawClients = data?.clients || [];
  const invoices = data?.invoices || [];
  const subscriptions = data?.subscriptions || [];
  // Sort clients alphabetically (case-insensitive) by display name
  // for the Clients tab. Search/query filtering still happens server
  // side via /api/db?q=... so the alphabetical ordering composes
  // naturally with the filtered subset returned.
  const clients = useMemo(() => {
    return [...rawClients].sort((a, b) => {
      const an = String(a?.name || a?.client_name || '').toLowerCase();
      const bn = String(b?.name || b?.client_name || '').toLowerCase();
      return an.localeCompare(bn);
    });
  }, [rawClients]);

  const subClients = useMemo(() => {
    return clients.filter(c => (c.subscription_count || 0) > 0 || (c.subscription_ids && c.subscription_ids.length > 0));
  }, [clients]);

  // CRM Clients tab: real client rows + any client with invoice/delivery
  // history. Subscription-only summaries (no invoice/delivery rows but
  // a non-zero subscription count, or rows sourced from the legacy /
  // subscriptions buckets) are intentionally excluded so the Clients
  // tab stays a CRM view, not a subscription roster. Those entries
  // still appear in the Subs tab via subClients.
  const crmClients = useMemo(() => {
    return clients.filter((c) => {
      const invoiceCount = Number(c?.invoice_count || 0);
      const deliveryCount = Number(c?.delivery_count || 0);
      const subscriptionCount = Number(c?.subscription_count || 0);
      const source = String(c?.source || '').toLowerCase();
      const hasInvoiceHistory =
        invoiceCount > 0 ||
        (Array.isArray(c?.invoice_ids) && c.invoice_ids.length > 0);
      const hasDeliveryHistory =
        deliveryCount > 0 ||
        (Array.isArray(c?.delivery_ids) && c.delivery_ids.length > 0);

      // Real history wins regardless of source/subscription state.
      if (hasInvoiceHistory || hasDeliveryHistory) return true;

      // Drop legacy / subscription-derived summaries that have no
      // invoice or delivery history. These are subscription-only
      // entries (e.g. Keysyanaf, Kornelius) that previously leaked
      // into the Clients list.
      const isLegacyOrSubscriptionSource =
        source === 'legacy' ||
        source === 'subscription' ||
        source === 'subscriptions';
      if (isLegacyOrSubscriptionSource) return false;

      // Even when source === 'client', a row with only subscription
      // history is still a subscription-only summary for CRM purposes.
      if (subscriptionCount > 0) return false;

      // Otherwise include real client rows.
      return source === 'client';
    });
  }, [clients]);

  const getClientSubscription = useCallback((client) => {
    const clientId = String(client?.id || '').trim();
    const clientName = String(client?.name || client?.client_name || '').trim().toLowerCase();
    return subscriptions.find(sub => {
      const subClientId = String(sub?.client_id || '').trim();
      const subName = String(sub?.client_name || sub?.name || '').trim().toLowerCase();
      if (clientId && subClientId && clientId === subClientId) return true;
      return !!clientName && !!subName && clientName === subName;
    });
  }, [subscriptions]);

  // Subs-tab list ordering. Two-bucket sort:
  //   • bucket A — active + warning rows: newest first by
  //                expiry_date (primary), then payment_date,
  //                then start_date, then created_at.
  //   • bucket B — expired rows: pinned to the bottom regardless
  //                of how recently they expired. Within the
  //                expired bucket we still keep newest-first so
  //                the most recently lapsed reads first.
  // The recency key is an ISO/YYYY-MM-DD string, so a plain
  // reverse localeCompare is sufficient — no Date parsing needed.
  // Subscription lookup is cached once per row to avoid an O(n²)
  // walk inside the comparator.
  const sortedSubClients = useMemo(() => {
    function recencyKey(sub) {
      return String(
        sub?.expiry_date
        || sub?.payment_date
        || sub?.start_date
        || sub?.created_at
        || ''
      );
    }
    const annotated = subClients.map((row) => {
      const sub = getClientSubscription(row) || null;
      const tone = sub ? subscriptionTone(sub) : 'active';
      return {
        row,
        bucket: tone === 'expired' ? 1 : 0,
        key: recencyKey(sub),
      };
    });
    annotated.sort((a, b) => {
      if (a.bucket !== b.bucket) return a.bucket - b.bucket;
      // Newer first within the same bucket.
      return b.key.localeCompare(a.key);
    });
    return annotated.map((entry) => entry.row);
  }, [subClients, getClientSubscription]);

  const activeRows = tab === 'subs' ? sortedSubClients : crmClients;
  const selectedClient = selected?.type === 'client' ? clients.find((client) => client.id === selected.id) || selected.data : null;
  // For Subs tab selections, resolve the actual subscription row so the
  // detail panel renders subscription fields instead of reusing the
  // CRM event flow (which produced a misleading "No events yet").
  const selectedSubscription = selected?.type === 'subscription'
    ? getClientSubscription(selected.data || {})
    : null;

  // Escape key listener to clear selection
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setSelected(null);
        setMobileView('left');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Auto-switch to the right panel on mobile when a row is selected.
  useEffect(() => {
    if (selected) setMobileView('right');
  }, [selected]);

  async function saveClient(event) {
    event.preventDefault();
    if (!draft.name.trim()) {
      setSaveStatus('Client name required.');
      return;
    }

    setSaveStatus('Saving...');
    try {
      const response = await fetch('/api/clients-save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || 'Save failed.');
      window.location.reload();
    } catch (error) {
      setSaveStatus(error.message || 'Save failed.');
    }
  }

  function openNewClient() {
    setTab('clients');
    setDraft({ title: 'Ms.', name: query.trim(), contact: '' });
    setSaveStatus('');
    setSelected({ type: 'new' });
  }

  // /db Subs → "Import JPG". Opens the right-panel importer (file
  // upload + editable preview + Save) without picking a row from
  // the list. The actual extraction is fired when the operator
  // chooses a file inside SubscriptionImport.
  function openImportSubscription() {
    setTab('subs');
    setSelected({ type: 'subs-import' });
  }

  function createEventForClient() {
    const client = selectedClient;
    const href = createRecordUrl('/inv/', {
      title: client?.title || 'Ms.',
      name: client?.name || '',
      contact: client?.contact || '',
      eventDate: today(),
    });
    // Open the invoice composer in a new tab so /db keeps the
    // current selection — matches the cross-tool nav buttons.
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  // Cascade-delete a client and every record bucketed under them.
  // The legacy:<normalized> id case has no real client row to drop
  // but still cleans the denormalized invoice/delivery/subscription
  // rows the dashboard groups under that name.
  async function deleteClient(client) {
    if (!client) return;
    const id = String(client.id || client.client_id || '');
    const name = String(client.name || client.client_name || '');
    if (!id && !name) return;
    try {
      const response = await fetch('/api/clients-delete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || 'Delete failed.');
      setSelected(null);
      setMobileView('left');
      refetch();
    } catch (error) {
      console.warn('[db] client delete failed:', error);
      setSaveStatus(error?.message || 'Delete failed.');
    }
  }

  // Delete a single subscription / invoice / delivery row. Used by
  // the Subs and Invoices list and by record rows inside the client
  // detail. After a successful delete we clear the selection if it
  // pointed at the deleted row, then refetch.
  async function deleteRecord({ kind, id, deliveryId, invoiceId }) {
    let endpointPath = '';
    let body = null;
    if (kind === 'subscription') {
      endpointPath = '/api/subscriptions-delete';
      body = { id };
    } else if (kind === 'invoice') {
      endpointPath = '/api/invoices-delete';
      body = { id };
    } else if (kind === 'delivery') {
      endpointPath = '/api/db-delete';
      body = { id };
    } else if (kind === 'event') {
      // A unified event row that may carry both a delivery and an
      // invoice. Issue both deletes in series; ignore individual
      // failures so a partial cleanup still progresses.
      if (deliveryId) {
        await fetch('/api/db-delete', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: deliveryId }),
        }).catch((error) => console.warn('[db] event delivery delete failed:', error));
      }
      if (invoiceId) {
        await fetch('/api/invoices-delete', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: invoiceId }),
        }).catch((error) => console.warn('[db] event invoice delete failed:', error));
      }
      refetch();
      return;
    } else {
      return;
    }

    try {
      const response = await fetch(endpointPath, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || 'Delete failed.');
      if (selected?.id === id) setSelected(null);
      refetch();
    } catch (error) {
      console.warn('[db] record delete failed:', error);
    }
  }

  const tabs = [
    { value: 'clients', label: 'Clients' },
    { value: 'subs', label: 'Subs' },
  ];

  const tabHeading =
    tab === 'subs' ? 'Subscriptions' : 'Choose A Client';

  const left = (
    <>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search"
      />
      {tab === 'clients' ? (
        <button className="add-client-button" type="button" onClick={openNewClient}>
          Create Client
        </button>
      ) : null}
      {tab === 'subs' ? (
        <button className="add-client-button" type="button" onClick={openImportSubscription}>
          Import JPG
        </button>
      ) : null}
      {status ? <EmptyState>{status}</EmptyState> : null}
      <div className="db-list">
        {activeRows.slice(0, 80).map((row, index) => {
          const isClient = tab === 'clients';
          const isSub = tab === 'subs';
          const title = row.client_name || row.name || row.title || row.slug;
          const clientSub = isSub ? getClientSubscription(row) : null;
          const subTone = clientSub ? subscriptionTone(clientSub) : '';
          let meta = '';
          if (isClient) {
            const contact = row.contact || row.client_contact || '';
            meta = isHumanReadableContact(contact) ? contact : '';
          } else if (isSub && clientSub) {
            meta = formatSubscriptionMeta(clientSub);
          }
          const rowId = row.id || `row-${index}`;
          const className = [
            'db-list-row',
            selected?.id === row.id ? 'active' : '',
            subTone ? `sub-${subTone}` : '',
          ]
            .filter(Boolean)
            .join(' ');
          const handleSelect = () => {
            // Delete X is now a permanent control on every row, so
            // taps just select. The previous arm/disarm dance was
            // removed along with armedRowId state in PR #56.
            if (isSub) {
              // Subs tab → subscription detail (resolved via
              // getClientSubscription on render). Keeps the row's
              // client summary in selected.data so heading/contact
              // stay available when the subscription record is
              // missing fields.
              setSelected({ type: 'subscription', id: row.id, data: row });
            } else if (isClient) {
              setSelected({ type: 'client', id: row.id, data: row });
            } else {
              setSelected({ type: tab, id: row.id, data: row });
            }
          };
          const handleDelete = (event) => {
            event.stopPropagation();
            if (isSub) {
              // Deleting from the Subs list removes the subscription
              // record itself, not the underlying client. The client
              // can still own invoices/deliveries that should survive.
              const sub = getClientSubscription(row);
              if (sub?.id) {
                deleteRecord({ kind: 'subscription', id: sub.id });
                if (selected?.type === 'subscription' && selected.id === row.id) {
                  setSelected(null);
                  setMobileView('left');
                }
              }
            } else if (isClient) {
              deleteClient(row);
            }
          };
          return (
            <div
              className={className}
              key={rowId}
              onClick={handleSelect}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleSelect();
                }
              }}
            >
              <div className="db-list-row-text">
                <strong>{title || 'Untitled'}</strong>
                {meta ? <span>{meta}</span> : null}
              </div>
              <button
                type="button"
                className="row-delete-x"
                onClick={handleDelete}
                aria-label={`Delete ${title || 'record'}`}
              >
                <DeleteIcon />
              </button>
            </div>
          );
        })}
        {!status && activeRows.length === 0 ? <EmptyState>No records yet.</EmptyState> : null}
      </div>
    </>
  );

  const right = (
    <>
      {status ? <EmptyState>{status}</EmptyState> : null}
      {!selected && !status ? <h2>{tabHeading}</h2> : null}
      {selected?.type === 'new' ? (
        <>
          <h2>Create Client</h2>
          <ClientForm
            draft={draft}
            onChange={setDraft}
            onCancel={() => {
              setSelected(null);
              setMobileView('left');
            }}
            onSave={saveClient}
            status={saveStatus}
          />
        </>
      ) : null}
      {selectedClient ? (
        <ClientDetail
          client={selectedClient}
          invoices={invoices}
          deliveries={data?.items || []}
          onCreateEvent={createEventForClient}
          onDeleteClient={deleteClient}
          onDeleteRecord={(row) =>
            deleteRecord({
              kind: 'event',
              deliveryId: row?.delivery?.id || '',
              invoiceId: row?.invoice?.id || '',
            })
          }
          onClose={() => {
            setSelected(null);
            setMobileView('left');
          }}
        />
      ) : null}
      {selected?.type === 'subscription' ? (
        <SubscriptionDetail
          client={selected.data || {}}
          subscription={selectedSubscription}
          onDeleteSubscription={(sub) => {
            if (!sub?.id) return;
            deleteRecord({ kind: 'subscription', id: sub.id });
            setSelected(null);
            setMobileView('left');
          }}
          onClose={() => {
            setSelected(null);
            setMobileView('left');
          }}
        />
      ) : null}
      {selected?.type === 'subs-import' ? (
        <SubscriptionImport
          onSaved={() => {
            setSelected(null);
            setMobileView('left');
            refetch();
          }}
          onCancel={() => {
            setSelected(null);
            setMobileView('left');
          }}
        />
      ) : null}
      {selected && !selectedClient && selected.type !== 'new' && selected.type !== 'subscription' && selected.type !== 'subs-import' ? (
        <>
          <div className="list-stack">
            <ListRow
              title={
                selected.data?.client_name ||
                selected.data?.name ||
                selected.data?.title ||
                selected.data?.service
              }
              meta={
                selected.data?.client_contact ||
                selected.data?.contact ||
                selected.data?.status ||
                selected.data?.updated_at
              }
              amount={
                selected.data?.total || selected.data?.grand_total || selected.data?.price
                  ? rupiah(
                      selected.data.total || selected.data.grand_total || selected.data.price,
                    )
                  : ''
              }
            />
          </div>
        </>
      ) : null}
    </>
  );

  return (
    <PrivateWorkspaceFrame
      active="/db/"
      pills={
        <Segmented
          value={tab}
          onChange={(next) => {
            setTab(next);
            setSelected(null);
            setMobileView('left');
          }}
          options={tabs}
          ariaLabel="Database section"
        />
      }
      left={left}
      right={right}
      mobileView={mobileView}
      onMobileViewChange={(view) => {
        if (view === 'left') setSelected(null);
        setMobileView(view);
      }}
      mobileTabs={{ left: 'List', right: 'Detail' }}
    />
  );
}

// /l — Link Generator.
//
// Recreates the legacy /l workflow on top of the current React
// shell. The folder-name conventions, slug + display-password
// derivation, URL normalisation, gallery-code prettifier, message
// template, and invoice handoff (URL params + localStorage) all
// match the legacy behaviour 1:1 so saved deliveries look the
// same in the database.
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
  { key: 'tn', label: 'TransferNow', placeholder: 'https://transfernow.net/...' },
];

// Small string helpers — direct ports of the legacy helpers used
// by the static /l page so the slug + password the worker stores
// match what the client previewed.
function cleanLinkText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeSlugSegment(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/["'\u2019`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeFolderName(value) {
  return cleanLinkText(String(value || '').replace(/\s*\(/g, ' ( ').replace(/\s*\)/g, ' ) '));
}

function stripBracketed(value) {
  return value.replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ');
}

function extractFolderParts(folder) {
  const normalized = normalizeFolderName(folder);
  const close = normalized.lastIndexOf(')');
  const head = close >= 0 ? normalized.slice(0, close + 1) : normalized;
  const suffix = close >= 0 ? normalized.slice(close + 1).trim() : '';
  const parts = stripBracketed(head).split(/\s+/).map(sanitizeSlugSegment).filter(Boolean);
  let date = '';
  let cursor = 0;
  if (/^\d{6}$/.test(parts[0] || '')) {
    date = parts[0];
    cursor = 1;
  } else if (/^\d{8}$/.test(parts[0] || '')) {
    date = parts[0].slice(2);
    cursor = 1;
  } else {
    const now = new Date();
    date =
      String(now.getFullYear()).slice(-2) +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');
  }
  const name = parts[cursor] || '';
  return { date, name, suffix: sanitizeSlugSegment(suffix), normalized };
}

function buildBaseSlug(folder) {
  const parts = extractFolderParts(folder);
  if (!parts.name) return '';
  const arr = [parts.date, parts.name];
  if (parts.suffix && parts.suffix !== parts.name) arr.push(parts.suffix);
  return arr.join('-').slice(0, 64).replace(/-+$/, '');
}

function buildFolderPassword(folder) {
  const parts = extractFolderParts(folder);
  const date = parts.date;
  // Display password = DDMMYY derived from the folder's YYMMDD prefix.
  return /^\d{6}$/.test(date) ? date.slice(4, 6) + date.slice(2, 4) + date.slice(0, 2) : '';
}

function normalizeLinkUrl(value) {
  let v = String(value || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v) && /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#].*)?$/i.test(v)) {
    v = `https://${v}`;
  }
  try {
    const url = new URL(v);
    if (!/^https?:$/i.test(url.protocol) || !url.hostname.includes('.')) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function prettyGalleryCode(slug) {
  const parts = String(slug || '').split('-').filter(Boolean);
  if (!parts.length) return '';
  return [parts[0], ...parts.slice(1).map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word))].join(' ');
}

function normalizeInvoiceTitleValue(value) {
  return /^mr\.?$/i.test(cleanLinkText(value)) ? 'Mr.' : 'Ms.';
}

function folderCodeFromEventDate(value) {
  const raw = String(value || '').trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return iso[1].slice(2) + iso[2] + iso[3];
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return slash[3].slice(2) + slash[2].padStart(2, '0') + slash[1].padStart(2, '0');
  return '';
}

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
  return `Dear ${cleanLinkText(title)} ${cleanLinkText(clientName)},

With sincere appreciation, your StarShots delivery files have been prepared and are now ready for your kind attention.

You may access them through the details below:

\u2022 Link: ${link}
\u2022 Password: ${info.pass}

Kindly download the files within the stated availability period.

It has been our pleasure to serve you, and we look forward to welcoming you again.

Warm regards,
StarShots`;
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

function ServiceField({ chip, label, value, placeholder, onChange }) {
  return (
    <label className="lg-service">
      <span className="lg-service-head">
        <span className="lg-service-chip">{chip}</span>
        <span className="lg-service-name">{label}</span>
      </span>
      <input
        type="url"
        inputMode="url"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        spellCheck="false"
        autoCapitalize="off"
        autoComplete="off"
      />
    </label>
  );
}

export function LinkGeneratorPage() {
  const [title, setTitle] = useState('Ms.');
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
  const [mobileView, setMobileView] = useState('left');
  // Visual flash on the clickable preview cards / textarea so
  // operators get tactile feedback after a copy or open action.
  const [copyFlash, setCopyFlash] = useState('');
  const clientInputRef = useRef(null);

  // One-shot invoice handoff. Only fills empty fields so that a
  // mid-edit reload from /inv → /l never clobbers manual changes.
  useEffect(() => {
    const handoff = readInvoiceHandoff();
    if (!handoff) return;
    const handoffName = cleanLinkText(handoff.name);
    if (!handoffName) return;
    const handoffTitle = normalizeInvoiceTitleValue(handoff.title);
    setTitle(handoffTitle);
    setLinkedInvoiceId(cleanLinkText(handoff.invoiceId || ''));
    setClientName((current) => (current.trim() ? current : handoffName));
    setFolderName((current) => {
      if (current.trim()) return current;
      const code = folderCodeFromEventDate(handoff.eventDate);
      return code ? normalizeFolderName(`${code} ${handoffName}`) : current;
    });
    setStatus({
      text: `Loaded ${handoffTitle} ${handoffName} from invoice.`,
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
    const galleryCode = prettyGalleryCode(slug);
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const directUrl = slug ? `${origin}/g/${slug}` : origin;
    const cleanName = cleanLinkText(clientName);
    const matchesSaved =
      saved && saved.slug === slug && saved.pass === pass && saved.name === cleanName && saved.shortLink;
    return {
      folder,
      slug,
      pass,
      galleryCode,
      directUrl,
      shortLink: matchesSaved ? saved.shortLink : '',
      displayPass: matchesSaved ? saved.password : pass,
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
    event.preventDefault();
    const name = cleanLinkText(clientName);
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
    if (!links.length) {
      setStatus({ text: 'Please fill at least one delivery link.', tone: 'error' });
      return;
    }

    setBusy(true);
    setStatus({ text: 'Saving delivery...', tone: '' });
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
          title,
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
          links,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.error || `Save failed (${response.status}).`);
      }

      const finalShortLink =
        data.shortLink ||
        (data.shortUrl ? `${window.location.origin}${data.shortUrl}` : info.directUrl);
      const finalPassword = String(data.password || '').trim() || info.pass;
      const finalMessage =
        data.generatedText ||
        buildPreviewMessage(title, name, {
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
      setStatus({
        text: copied ? 'Saved and copied.' : 'Saved. Please copy manually.',
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
    setTitle('Ms.');
    setClientName('');
    setFolderName('');
    setServiceUrls({ gd: '', db: '', wt: '', tn: '' });
    setLinkedInvoiceId('');
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
      setStatus({ text: 'Fill folder name first.', tone: 'error' });
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
    const url = info.shortLink;
    if (!url) {
      setStatus({ text: 'Generate first to open the short link.', tone: 'error' });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    flash('short');
    setStatus({ text: 'Opened short link.', tone: 'success' });
  }

  // What the delivery card displays. Mirrors the legacy logic:
  // saved → strip protocol; valid candidate slug+pass → "Save first";
  // otherwise → site host as a placeholder hint.
  const fallbackHost = typeof window !== 'undefined' ? window.location.host : 'starshots.pages.dev';
  const deliveryDisplay = info.shortLink
    ? info.shortLink.replace(/^https?:\/\//, '')
    : info.slug && info.pass
      ? 'Save first'
      : fallbackHost;

  const left = (
    <form className="form-stack lg-form" onSubmit={submit} noValidate>
      <div className="two-col">
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
          placeholder="260427 Anson M Luis ( 6th Birthday )"
          autoComplete="off"
        />
      </label>
      <div className="two-col">
        <label>
          Gallery Code
          <input
            className="lg-readonly"
            value={info.slug}
            readOnly
            tabIndex={-1}
            placeholder="260427-anson"
          />
        </label>
        <label>
          Password
          <input
            className="lg-readonly"
            value={info.pass}
            readOnly
            tabIndex={-1}
            placeholder="270426"
          />
        </label>
      </div>
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
        </div>
        <button type="button" className="ghost-button compact" onClick={copyMessage}>
          Copy
        </button>
      </header>
      <div className="lg-stats">
        <button
          type="button"
          className={`lg-stat-card${copyFlash === 'short' ? ' is-flash' : ''}`}
          onClick={openShortLink}
          aria-label="Open short link in new tab"
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
          <strong>{info.displayPass || '\u2014'}</strong>
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
    <PrivateWorkspaceFrame
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

const SUBS_PERIOD_OPTIONS = [
  { value: 7, label: '7 Days' },
  { value: 15, label: '15 Days' },
  { value: 30, label: '30 Days' },
];

const SUBS_SERVICE_OPTIONS = ['iCloud', 'Google Drive', 'Dropbox', 'ChatGPT', 'Copilot'];

const SUBS_TITLE_OPTIONS = ['', 'Mr.', 'Ms.', 'Mrs.', 'Family'];

const SUBS_MODE_OPTIONS = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'paid', label: 'Paid' },
];

// Storage is service-specific. Non-storage services (ChatGPT,
// Copilot) hide the storage input entirely and the generated card
// omits the storage line. Storage products keep the dropdown but
// allow blank — a blank value also drops the storage line from the
// JPG. The dropdown values include their unit so the card can
// render them verbatim ("200 GB", "1.5 TB") instead of stitching a
// number onto a static suffix.
const SUBS_STORAGE_OPTIONS = ['200 GB', '400 GB', '500 GB', '1 TB', '1.5 TB', '2 TB'];
const SUBS_NON_STORAGE_SERVICES = new Set(['ChatGPT', 'Copilot']);

// Duration dropdown for invoice mode. Includes a blank entry so a
// subscription bill that doesn't tie to a fixed term (e.g. ad-hoc
// access) can omit the duration line. Paid mode uses
// SUBS_PERIOD_OPTIONS unchanged because the expiry calculation
// always needs a non-blank period.
const SUBS_DURATION_OPTIONS = [
  { value: '', label: '—' },
  { value: '7', label: '7 Days' },
  { value: '15', label: '15 Days' },
  { value: '30', label: '30 Days' },
];

// Title-case rules (small-words, preserve list, regex token matcher)
// live in `src/utils/titleCase.js` so /subs and /inv share the exact
// same display normalisation. Older versions of this file kept a
// local `toSubsTitleCase` helper; it has been replaced by
// `toTitleCase` from the shared utility, with `onBlurTitleCase` used
// to normalise text inputs on blur.

function fmtSubsDate(value) {
  if (!value) return '-';
  const [y, m, d] = String(value).split('-').map(Number);
  if (!y || !m || !d) return '-';
  // Build a noon-UTC date so en-US localisation never drifts a day
  // on either side of midnight.
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function fmtSubsTime(value) {
  if (!value) return '-';
  // Reference card uses the European "HH.mm" form (e.g. 20.21).
  const [h = '00', mi = '00'] = String(value).split(':');
  return `${h.padStart(2, '0')}.${mi.padStart(2, '0')}`;
}

function safeSubsToken(value) {
  return String(value || '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function todaySubs() {
  return new Date().toISOString().slice(0, 10);
}

function nowSubsTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// addDays(date, n) — UTC-safe day arithmetic shared by invoice (due
// date) and paid (expiry) calculations. Returns "" when the input
// can't be parsed so the caller can fall back to "-" in the UI.
function addDays(value, days) {
  if (!value) return '';
  const [y, m, d] = String(value).split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + (Number(days) || 0));
  return dt.toISOString().slice(0, 10);
}

function loadTesseract() {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) {
      resolve(window.Tesseract);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.onload = () => {
      if (window.Tesseract) {
        resolve(window.Tesseract);
      } else {
        reject(new Error('Tesseract global object not found.'));
      }
    };
    script.onerror = () => {
      reject(new Error('Failed to load Tesseract.js from CDN.'));
    };
    document.head.appendChild(script);
  });
}

function parseOcrText(text) {
  const result = {
    paymentDate: '',
    paymentTime: '',
    startDate: '',
    startTime: '',
    expiryDate: '',
    expiryTime: '',
    accessPeriod: 0,
    paidAmount: 0,
    service: '',
    status: '',
    hasMr: false
  };

  if (!text) return result;

  // Check if text suggests "Mr."
  if (/\bMr\.?\b/i.test(text)) {
    result.hasMr = true;
  }

  // Helper to normalize month names
  const months = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    january: '01', february: '02', march: '03', april: '04', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
  };

  // Find all dates in format "Month DD, YYYY" or "DD Month YYYY"
  const dateRegex = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/ig;
  const datesFound = [];
  let match;
  while ((match = dateRegex.exec(text)) !== null) {
    const monthName = match[1].toLowerCase();
    const month = months[monthName] || '01';
    const day = match[2].padStart(2, '0');
    const year = match[3];
    datesFound.push(`${year}-${month}-${day}`);
  }

  // Find all times in format "HH.MM" or "HH:MM"
  const timeRegex = /\b(\d{2})[.:](\d{2})\b/g;
  const timesFound = [];
  while ((match = timeRegex.exec(text)) !== null) {
    timesFound.push(`${match[1]}:${match[2]}`);
  }

  if (datesFound.length >= 1) result.paymentDate = datesFound[0];
  if (datesFound.length >= 2) result.startDate = datesFound[1];
  else if (datesFound.length === 1) result.startDate = datesFound[0]; // fallback
  if (datesFound.length >= 3) result.expiryDate = datesFound[2];
  
  if (timesFound.length >= 1) result.paymentTime = timesFound[0];
  if (timesFound.length >= 2) result.startTime = timesFound[1];
  else if (timesFound.length === 1) result.startTime = timesFound[0]; // fallback
  if (timesFound.length >= 3) result.expiryTime = timesFound[2];
  else if (result.startTime) result.expiryTime = result.startTime;

  const accessMatch = text.match(/Access\s+Period[\s\S]{0,50}?(\d{1,3})\s*Days?/i)
    || text.match(/\b(\d{1,3})\s*Days?\b/i);
  if (accessMatch) result.accessPeriod = Number(accessMatch[1]) || 0;

  const amountMatch = text.match(/Paid\s+Amount\s*[:\-\s]*\s*Rp\s*([\d.,]+)/i)
    || text.match(/Total\s*[:\-\s]*\s*Rp\s*([\d.,]+)/i);
  if (amountMatch) result.paidAmount = Number(String(amountMatch[1]).replace(/[.,]/g, '')) || 0;

  const serviceAlias = SUBS_IMPORT_SERVICE_ALIASES.find((item) => item.pattern.test(text));
  if (serviceAlias) result.service = serviceAlias.label;

  if (/Payment\s+Received|Subscription\s+Confirmed|\bPaid\b/i.test(text)) result.status = 'paid';

  return result;
}

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
        windowWidth: 800,
        windowHeight: 1200,
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
            <input type="date" value={issuedDate} onChange={(event) => setIssuedDate(event.target.value)} />
          </label>
        </>
      ) : (
        <>
          <div className="two-col">
            <label>Date of Payment
              <input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
            </label>
            <label>Time of Payment
              <input type="time" value={paymentTime} onChange={(event) => setPaymentTime(event.target.value)} />
            </label>
          </div>
          <label>Access Period
            <select value={accessPeriod} onChange={(event) => setAccessPeriod(Number(event.target.value))}>
              {SUBS_PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className="two-col">
            <label>Start Access
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label>Start Time
              <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
            </label>
          </div>
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

  // Paid receipt card. The 2x2 meta grid intentionally drops the
  // redundant "Service" tile (already shown in the eyebrow tag at
  // the top of the card) and replaces it with the Paid Amount, so
  // every cell carries unique receipt information.
  const paidCard = (
    <article className="subs-card" ref={cardRef}>
      <header className="subs-card-head">
        <p className="subs-greeting">Hello, {titlePrefix ? titlePrefix + ' ' : ''}{displayClient}!</p>
        <p className="subs-service-tag">{service}</p>
        <h1 className="subs-title">Subscription Confirmed</h1>
        <p className="subs-eyebrow">Payment Received</p>
      </header>
      <section className="subs-grid">
        <div className="subs-tile">
          <span className="subs-tile-label">Date of Payment</span>
          <strong>{fmtSubsDate(paymentDate)}</strong>
        </div>
        <div className="subs-tile">
          <span className="subs-tile-label">Time of Payment</span>
          <strong>{fmtSubsTime(paymentTime)}</strong>
        </div>
        <div className="subs-tile">
          <span className="subs-tile-label">Paid Amount</span>
          <strong>{rupiah(price)}</strong>
        </div>
        <div className="subs-tile">
          <span className="subs-tile-label">Access Period</span>
          <strong>{periodLabel}</strong>
        </div>
      </section>
      <section className="subs-period">
        <div className="subs-period-card">
          <span className="subs-tile-label">Start Access</span>
          <strong className="subs-period-date">{fmtSubsDate(startDate)}</strong>
          <strong className="subs-period-time">{fmtSubsTime(startTime)}</strong>
        </div>
        <div className="subs-period-card">
          <span className="subs-tile-label">Expiry</span>
          <strong className="subs-period-date">{fmtSubsDate(expiryDate)}</strong>
          <strong className="subs-period-time">{fmtSubsTime(startTime)}</strong>
        </div>
      </section>
      <footer className="subs-card-foot">
        <p className="subs-foot-title">This card serves as your confirmed subscription receipt</p>
        <p className="subs-foot-sub">Please keep this JPG for your subscription history and future reference.</p>
        <div className="subs-foot-meta">
          <span>This confirmation is automatically generated and valid without signature.</span>
          <strong>@starshots.id</strong>
        </div>
      </footer>
    </article>
  );

  // Invoice card. Compact subscription bill: header with logo +
  // "Subscription Invoice" eyebrow (no random INV-# anymore — the
  // operator owns canonical record ids in /db, this card is the
  // sendable artifact), bill-to / service-details tiles, line-item
  // row, payment block with QR + totals (Total / Issued — no Due
  // row, single date convention), and a shared footer.
  const invoiceCard = (
    <article className="subs-invoice-card" ref={cardRef}>
      <header className="subs-invoice-head">
        <img src="/logo-hero.png" alt="StarShots" className="subs-invoice-logo" />
        <div className="subs-invoice-meta">
          <p className="subs-eyebrow">Subscription Invoice</p>
        </div>
      </header>
      <section className="subs-invoice-grid">
        <div className="subs-tile subs-tile--list">
          <span className="subs-tile-label">Bill To</span>
          <strong>{titlePrefix ? titlePrefix + ' ' : ''}{displayClient}</strong>
        </div>
        <div className="subs-tile subs-tile--list">
          <span className="subs-tile-label">Service Details</span>
          <p>{service}</p>
          {showStorage ? <p>Storage: {storage}</p> : null}
          {showDuration ? <p>Duration: {durationLabel}</p> : null}
        </div>
      </section>
      <section className="subs-invoice-line">
        <div>
          <strong>{service} Subscription</strong>
          {lineSubtitle ? <small>{lineSubtitle}</small> : null}
        </div>
        <span>{rupiah(price)}</span>
      </section>
      <section className="subs-invoice-pay">
        <img src="/payment-qr.png" alt="Payment QR" className="subs-invoice-qr" />
        <div className="subs-invoice-totals">
          <p><span>Total</span><strong>{rupiah(price)}</strong></p>
          <p><span>Issued</span><strong>{fmtSubsDate(issuedDate)}</strong></p>
        </div>
      </section>
      <footer className="subs-card-foot">
        <p className="subs-foot-title">Thanks for Trusting StarShots</p>
        <p className="subs-foot-sub">Please complete payment to keep your subscription active.</p>
        <div className="subs-foot-meta">
          <span>This invoice is automatically generated and valid without signature.</span>
          <strong>@starshots.id</strong>
        </div>
      </footer>
    </article>
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
      <div className="subs-canvas">
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
