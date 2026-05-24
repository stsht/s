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
// active  - default, white/normal text.
// expired - expiry_date has already passed; greyer/dimmer.
// warning - expiry_date within the next 3 days AND the row hasn't been
//           settled (status is anything other than paid/solved/closed).
//           Rendered red so renewal stays visible.
//
// The rule intentionally checks `expiry_date` only — `start_date`
// without an expiry is treated as still active. Returning a stable
// className lets the styling live in CSS.
const SUBS_SETTLED_STATUSES = new Set(['paid', 'solved', 'closed']);

function subscriptionTone(sub = {}) {
  const expiryRaw = sub.expiry_date || '';
  if (!expiryRaw) return 'active';
  const expiry = new Date(`${expiryRaw}T23:59:59Z`);
  if (Number.isNaN(expiry.getTime())) return 'active';
  const now = Date.now();
  const diffDays = (expiry.getTime() - now) / 86400000;
  if (diffDays < 0) return 'expired';
  const status = String(sub.status || '').toLowerCase();
  if (diffDays <= 3 && !SUBS_SETTLED_STATUSES.has(status)) return 'warning';
  return 'active';
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

  const activeRows = tab === 'subs' ? subClients : clients;
  const selectedClient = selected?.type === 'client' ? clients.find((client) => client.id === selected.id) || selected.data : null;

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
            meta = `${clientSub.service || 'Subscription'} - ${clientSub.status || 'Active'}`;
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
            if (isClient || isSub) {
              setSelected({ type: 'client', id: row.id, data: row });
            } else {
              setSelected({ type: tab, id: row.id, data: row });
            }
          };
          const handleDelete = (event) => {
            event.stopPropagation();
            if (isClient || isSub) {
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
      {selected && !selectedClient && selected.type !== 'new' ? (
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

const SUBS_TITLE_OPTIONS = ['Mr.', 'Ms.', 'Mrs.', 'Family'];

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
  // without manual edits.
  const [paymentDate, setPaymentDate] = useState(todaySubs);
  const [paymentTime, setPaymentTime] = useState(nowSubsTime);
  const [accessPeriod, setAccessPeriod] = useState(30);
  const [startDate, setStartDate] = useState(todaySubs);
  const [startTime, setStartTime] = useState(nowSubsTime);
  const [mobileView, setMobileView] = useState('left');
  const [status, setStatus] = useState('');
  const cardRef = useRef(null);
  // Track the previous mode so the refresh-on-switch effect only
  // fires on actual transitions into 'paid', not on the very first
  // render or on unrelated re-renders.
  const previousModeRef = useRef(mode);

  // Refresh paid-mode date/time fields each time the user switches
  // into Paid. Workflow: build invoice → wait for client to pay →
  // click Paid → the receipt automatically uses the current real
  // payment moment. Manual edits afterwards still apply (we only
  // re-snap on the transition itself).
  useEffect(() => {
    if (previousModeRef.current !== 'paid' && mode === 'paid') {
      const dateNow = todaySubs();
      const timeNow = nowSubsTime();
      setPaymentDate(dateNow);
      setPaymentTime(timeNow);
      setStartDate(dateNow);
      setStartTime(timeNow);
    }
    previousModeRef.current = mode;
  }, [mode]);

  // expiry = startDate + accessPeriod days (paid mode only).
  const expiryDate = useMemo(
    () => addDays(startDate, accessPeriod),
    [startDate, accessPeriod],
  );

  // Deterministic invoice number from the inputs that identify the
  // bill (client + service + issued date). Stable across re-renders
  // for the same triple, regenerates only when those change.
  const invoiceNumber = useMemo(() => {
    const datePart = String(issuedDate || '').replace(/-/g, '');
    const seed = `${client}-${service}-${issuedDate}`.toLowerCase();
    let hash = 5381;
    for (let i = 0; i < seed.length; i += 1) hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
    return `INV-${datePart || '000000'}-${hash.toString(36).slice(0, 4).toUpperCase()}`;
  }, [client, service, issuedDate]);

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
      <div className="two-col">
        <label>Title
          <select value={titlePrefix} onChange={(event) => setTitlePrefix(event.target.value)}>
            {SUBS_TITLE_OPTIONS.map((option) => <option key={option}>{option}</option>)}
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
        <p className="subs-greeting">Hello, {titlePrefix} {displayClient}!</p>
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

  // Invoice card. Compact subscription bill: header with logo + INV-#,
  // bill-to / service-details tiles, line-item row, payment block with
  // QR + totals (Total / Issued — no Due row, single date convention),
  // and a shared footer.
  const invoiceCard = (
    <article className="subs-invoice-card" ref={cardRef}>
      <header className="subs-invoice-head">
        <img src="/logo-hero.png" alt="StarShots" className="subs-invoice-logo" />
        <div className="subs-invoice-meta">
          <p className="subs-eyebrow">Subscription Invoice</p>
          <strong>{invoiceNumber}</strong>
        </div>
      </header>
      <section className="subs-invoice-grid">
        <div className="subs-tile subs-tile--list">
          <span className="subs-tile-label">Bill To</span>
          <strong>{titlePrefix} {displayClient}</strong>
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
        <button className="primary-button" type="button" onClick={downloadJpg}>Generate JPG</button>
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
