import { useCallback, useEffect, useMemo, useState } from 'react';
import { PrivateWorkspaceFrame } from '../../components/PrivateWorkspaceFrame.jsx';
import { Segmented, EmptyState } from '../../components/ui/index.js';

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

// Same formatter as dateLabel but returns an empty string when the
// input is missing or unparseable, so callers can use it as a soft
// fallback inside ternaries without printing the literal "No date".
function softDateLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Build the small grey subtitle line under each list-row title.
// Goal: never expose a raw ISO/Postgres timestamp like
// "2026-05-17T13:50:05.719653+00:00" — that's database language.
//
// Per-tab preference order:
//   clients   - contact > formatted "last seen" date > nothing
//   subs      - contact > service > status > formatted expiry/start > nothing
//   invoices  - contact > status > formatted event/invoice date > nothing
//
// `service` and `status` are short human strings that happen to live
// on the row and read fine as a subtitle. Anything that looks like a
// date is run through softDateLabel() so the operator sees
// "17 May 2026" instead of an ISO blob.
function rowSubtitle(row, tab) {
  if (!row) return '';
  const contact = row.contact || row.client_contact;
  if (contact) return String(contact);
  if (tab === 'subs') {
    if (row.service) return String(row.service);
    if (row.status) return String(row.status);
    return softDateLabel(row.expiry_date || row.start_date || row.updated_at || row.created_at);
  }
  if (tab === 'invoices') {
    if (row.status) return String(row.status);
    return softDateLabel(row.event_date || row.invoice_date || row.updated_at || row.created_at);
  }
  // clients tab: a contact is the natural subtitle. Fall back to the
  // most recent date we have on the client row, formatted humanely.
  return softDateLabel(row.last_event_date || row.updated_at || row.created_at);
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

function ClientDetail({ client, invoices, deliveries, onCreateEvent, onDeleteClient, onDeleteRecord }) {
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

// One event row inside the client detail. Owns its own armed state
// so first-tap-reveals on touch devices doesn't propagate to the
// inner anchors (which still navigate to /inv or /l in a new tab).
// On desktop, CSS `:hover` reveals the delete button regardless of
// the armed flag, so an intentional hover-then-click never costs an
// extra tap.
function RecordRow({ recordKey, row, fallbackName, eventLinkHref, eventInvoiceHref, onDelete }) {
  const [armed, setArmed] = useState(false);
  const handleArm = (event) => {
    // Don't arm when the user is interacting with an inner action
    // (anchor or the delete button itself); those handle their own
    // events. The row is only the bare shell.
    if (event.target.closest('a') || event.target.closest('button')) return;
    setArmed((value) => !value);
  };
  return (
    <article
      className={`record-row${armed ? ' armed' : ''}`}
      onClick={handleArm}
      data-key={recordKey}
    >
      <span>{dateLabel(row.date)}</span>
      <strong>{row.name || fallbackName}</strong>
      <a href={eventLinkHref} target="_blank" rel="noopener noreferrer">
        {row.delivery?.id ? 'View Links' : 'Create Links'}
      </a>
      <a href={eventInvoiceHref} target="_blank" rel="noopener noreferrer">
        {row.invoice?.id ? 'View Invoice' : 'Create Invoice'}
      </a>
      <button
        type="button"
        className="db-delete-button record-row-delete"
        onClick={(event) => {
          event.stopPropagation();
          onDelete?.();
        }}
        aria-label="Delete event"
      >
        Delete
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
  // armedRowId: which list-row currently has its delete button revealed
  // on touch devices. Desktop uses :hover and ignores this entirely.
  const [armedRowId, setArmedRowId] = useState(null);
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
  const activeRows = tab === 'subs' ? subscriptions : tab === 'invoices' ? invoices : clients;
  const selectedClient = selected?.type === 'client' ? clients.find((client) => client.id === selected.id) || selected.data : null;

  // Auto-switch to the right panel on mobile when a row is selected.
  useEffect(() => {
    if (selected) setMobileView('right');
  }, [selected]);

  // Reset arming whenever the user changes tabs or search terms so a
  // stale row id from a previous list cannot trigger a delete.
  useEffect(() => {
    setArmedRowId(null);
  }, [tab, query]);

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
      setArmedRowId(null);
      setMobileView('left');
      refetch();
    } catch (error) {
      console.warn('[db] client delete failed:', error);
      setSaveStatus(error?.message || 'Delete failed.');
    }
  }

  // Delete a single subscription / invoice / delivery row. Used by
  // the Subs and Invoices list and by record rows inside the client
  // detail. After a successful delete we drop the armed flag and
  // clear the selection if it pointed at the deleted row, then
  // refetch.
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
      setArmedRowId(null);
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
      setArmedRowId(null);
      refetch();
    } catch (error) {
      console.warn('[db] record delete failed:', error);
    }
  }

  const tabs = [
    { value: 'clients', label: 'Clients' },
    { value: 'subs', label: 'Subs' },
    { value: 'invoices', label: 'Invoices' },
  ];

  const tabHeading =
    tab === 'subs' ? 'Subscriptions' : tab === 'invoices' ? 'Invoices' : 'Choose A Client';

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
          const title = row.client_name || row.name || row.title || row.slug;
          const meta = rowSubtitle(row, tab);
          const isClient = tab === 'clients';
          const isSub = tab === 'subs';
          const isInvoice = tab === 'invoices';
          const rowId = row.id || `row-${index}`;
          const isArmed = armedRowId === rowId;
          const subTone = isSub ? subscriptionTone(row) : '';
          const className = [
            'db-list-row',
            selected?.id === row.id ? 'active' : '',
            isArmed ? 'armed' : '',
            subTone ? `sub-${subTone}` : '',
          ]
            .filter(Boolean)
            .join(' ');
          const handleSelect = () => {
            if (isArmed) {
              // Tapping a row that's already armed disarms it instead
              // of reselecting (gives mobile users a way to back off).
              setArmedRowId(null);
            } else {
              setArmedRowId(rowId);
            }
            if (isClient) {
              setSelected({ type: 'client', id: row.id, data: row });
            } else {
              setSelected({ type: tab, id: row.id, data: row });
            }
          };
          const handleDelete = (event) => {
            event.stopPropagation();
            if (isClient) {
              deleteClient(row);
            } else if (isSub) {
              deleteRecord({ kind: 'subscription', id: row.id });
            } else if (isInvoice) {
              deleteRecord({ kind: 'invoice', id: row.id });
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
              <strong>{title || 'Untitled'}</strong>
              {meta ? <span>{meta}</span> : null}
              <button
                type="button"
                className="db-delete-button db-row-delete"
                onClick={handleDelete}
                aria-label={`Delete ${title || 'record'}`}
              >
                Delete
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
                softDateLabel(
                  selected.data?.event_date ||
                    selected.data?.invoice_date ||
                    selected.data?.expiry_date ||
                    selected.data?.start_date ||
                    selected.data?.updated_at ||
                    selected.data?.created_at,
                )
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

export function LinkGeneratorPage() {
  const [client, setClient] = useState('');
  const [slug, setSlug] = useState('');
  const [service, setService] = useState('Google Drive');
  const [status, setStatus] = useState('');
  const [mobileView, setMobileView] = useState('left');
  // Snapshot of the link/message produced by the most recent
  // Generate Link click. The preview only renders these — the live
  // hash from useMemo below is used as the *candidate* slug while
  // the user is typing, but never displayed until they click
  // Generate so the workflow has a clear before/after.
  const [generated, setGenerated] = useState(false);
  const [generatedSlug, setGeneratedSlug] = useState('');
  const [generatedMessage, setGeneratedMessage] = useState('');
  // Candidate short-code derived from the inputs. Hash logic
  // unchanged — same FNV-style mix used previously, just gated
  // behind the `generated` flag for display.
  const candidateSlug = useMemo(() => {
    const base = `${client}-${slug}-${service}`.toLowerCase().replace(/[^a-z0-9]+/g, '');
    let hash = 2166136261;
    for (let index = 0; index < base.length; index += 1) hash = Math.imul(hash ^ base.charCodeAt(index), 16777619);
    return Math.abs(hash).toString(36).padStart(7, '0').slice(0, 12);
  }, [client, slug, service]);

  // Editing any input after generation invalidates the preview so
  // the displayed link always matches the displayed inputs.
  useEffect(() => {
    if (generated) {
      setGenerated(false);
      setStatus('');
    }
    // We intentionally do NOT depend on `generated` itself — that
    // would cause an immediate re-toggle on the next render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, slug, service]);

  async function generate(event) {
    event.preventDefault();
    if (!client.trim() || !slug.trim()) {
      setStatus('Fill in client and slug first.');
      return;
    }
    setGeneratedSlug(candidateSlug);
    setGeneratedMessage(
      `Hi ${client.trim()}, your delivery is ready: https://sshots.pages.dev/${candidateSlug}`,
    );
    setGenerated(true);
    setStatus('Link ready. Production save uses the existing worker API.');
    setMobileView('right');
  }

  const left = (
    <form className="form-stack" onSubmit={generate}>
      <label>Client<input value={client} onChange={(event) => setClient(event.target.value)} placeholder="Client name" /></label>
      <label>Gallery or folder slug<input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="Google Drive / Dropbox link" /></label>
      <label>Service
        <select value={service} onChange={(event) => setService(event.target.value)}>
          <option>Google Drive</option>
          <option>Dropbox</option>
          <option>iCloud</option>
          <option>USB</option>
        </select>
      </label>
      <button className="primary-button" type="submit">Generate Link</button>
      <p className="download-status">{status}</p>
    </form>
  );

  const right = generated ? (
    <div className="preview-note-card">
      <p className="eyebrow">Generated Link</p>
      <h2>{client} Delivery</h2>
      <p>Share this link with the client:</p>
      <strong>sshots.pages.dev/{generatedSlug}</strong>
      <p style={{ marginTop: 12 }}>{generatedMessage}</p>
    </div>
  ) : (
    <div className="preview-note-card">
      <p className="eyebrow">Preview</p>
      <h2>Ready to generate</h2>
      <p>Fill the form on the left, then tap Generate Link to produce the short URL and the share message.</p>
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
      mobileTabs={{ left: 'Form', right: 'Link' }}
    />
  );
}

export function SubscriptionsPage() {
  const [client, setClient] = useState('');
  const [service, setService] = useState('iCloud');
  const [storage, setStorage] = useState(500);
  const [duration, setDuration] = useState(30);
  const [rate, setRate] = useState(45000);
  const [mobileView, setMobileView] = useState('left');
  const total = Math.round((Number(rate) || 0) * (Number(duration) || 0) / 30);

  const left = (
    <form className="form-stack">
      <label>Service
        <select value={service} onChange={(event) => setService(event.target.value)}>
          <option>iCloud</option>
          <option>Google Drive</option>
          <option>Dropbox</option>
        </select>
      </label>
      <label>Client name<input value={client} onChange={(event) => setClient(event.target.value)} placeholder="Client name" /></label>
      <div className="two-col">
        <label>Storage<input type="number" value={storage} onChange={(event) => setStorage(event.target.value)} /></label>
        <label>Duration<input type="number" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
      </div>
      <label>Monthly rate<input type="number" value={rate} onChange={(event) => setRate(event.target.value)} /></label>
    </form>
  );

  const right = (
    <div className="preview-note-card">
      <p className="eyebrow">Invoice Preview</p>
      <h2>{client || 'Client'}</h2>
      <p>{service} storage, {storage}GB, {duration} days.</p>
      <strong>{rupiah(total)}</strong>
      <small>{today()}</small>
    </div>
  );

  return (
    <PrivateWorkspaceFrame
      active="/subs/"
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
