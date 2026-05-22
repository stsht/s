import { useEffect, useMemo, useState } from 'react';
import { GlobalBackground } from '../../components/GlobalBackground.jsx';

const navItems = [
  { href: '/admin/', label: 'Dashboard' },
  { href: '/db/', label: 'Database' },
  { href: '/l/', label: 'Links' },
  { href: '/inv/', label: 'Invoice' },
  { href: '/subs/', label: 'Subs' },
];

const tools = [
  { href: '/inv/', eyebrow: 'Billing', title: 'Invoice Generator', body: 'Create invoice, deposit, and paid documents.' },
  { href: '/l/', eyebrow: 'Delivery', title: 'Create Links', body: 'Prepare short links and delivery messages.' },
  { href: '/db/', eyebrow: 'Activity', title: 'Database & Activity', body: 'Review clients, saved invoices, subscriptions, and access logs.' },
  { href: '/subs/', eyebrow: 'Subscriptions', title: 'Subscriptions', body: 'Create storage and subscription invoices.' },
];

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

function createRecordUrl(path, params) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return `${url.pathname}${url.search}`;
}

function PageChrome({ active, title, eyebrow = 'StarShots Private', aside, className = '', children }) {
  return (
    <main className={`workspace-page ${className}`.trim()}>
      <GlobalBackground />
      <div className="workspace-shell">
        <header className="workspace-topbar">
          <a className="workspace-logo" href="/admin/" aria-label="StarShots Dashboard">
            <img src="/logo-hero.png" alt="StarShots" />
          </a>
          <nav className="workspace-nav" aria-label="Private tools">
            {navItems.map((item) => (
              <a key={item.href} className={active === item.href ? 'active' : ''} href={item.href}>{item.label}</a>
            ))}
          </nav>
        </header>
        <section className="workspace-hero">
          <div>
            <p className="hero-eyebrow"><span />{eyebrow}</p>
            <h1>{title}</h1>
          </div>
          {aside ? <p className="hero-aside">{aside}</p> : null}
        </section>
        {children}
      </div>
    </main>
  );
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
  return (
    <PageChrome active="/admin/" title="Dashboard" aside="Studio tools for delivery links, activity tracking, invoices, and client access.">
      <section className="tool-grid">
        {tools.map((tool) => <ToolCard key={tool.href} tool={tool} />)}
      </section>
    </PageChrome>
  );
}

function useRemoteList(endpoint) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('Loading...');

  useEffect(() => {
    let alive = true;
    fetch(endpoint, { credentials: 'same-origin' })
      .then((response) => response.json())
      .then((json) => {
        if (!alive) return;
        setData(json);
        setStatus(json?.ok === false ? (json.error || 'Unable to load.') : '');
      })
      .catch((error) => {
        if (!alive) return;
        setStatus(import.meta.env.DEV ? 'API unavailable in Vite dev. Production data loads on Pages.' : (error.message || 'Unable to load.'));
      });
    return () => { alive = false; };
  }, [endpoint]);

  return { data, status };
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

function ClientDetail({ client, invoices, deliveries, onCreateEvent, onBack }) {
  const records = buildClientRecords(client, invoices, deliveries);
  const title = client?.title || 'Ms.';
  const name = client?.name || client?.client_name || 'Client';
  const contact = client?.contact || client?.client_contact || '';
  const linkHref = createRecordUrl('/l/', { title, name, contact });
  const invoiceHref = createRecordUrl('/inv/', { title, name, contact });

  return (
    <>
      <button className="db-back-button" type="button" onClick={onBack}>Back</button>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Client</p>
          <h2>{name}</h2>
          {contact ? <span>{contact}</span> : null}
        </div>
        <div className="detail-actions">
          <a className="ghost-button compact" href={linkHref}>Create Links</a>
          <a className="ghost-button compact" href={invoiceHref}>Create Invoice</a>
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
          return (
            <article className="record-row" key={`${row.date}-${index}`}>
              <span>{dateLabel(row.date)}</span>
              <strong>{row.name || name}</strong>
              <a href={eventLinkHref}>{row.delivery?.id ? 'View Links' : 'Create Links'}</a>
              <a href={eventInvoiceHref}>{row.invoice?.id ? 'View Invoice' : 'Create Invoice'}</a>
            </article>
          );
        })}
        {!records.length ? <p className="empty-state">No events yet.</p> : null}
      </div>
      <button className="create-event-button" type="button" onClick={onCreateEvent}>Create Events</button>
    </>
  );
}

export function DatabasePage() {
  const [tab, setTab] = useState('clients');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({ title: 'Ms.', name: '', contact: '' });
  const [saveStatus, setSaveStatus] = useState('');
  const endpoint = `/api/db${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`;
  const { data, status } = useRemoteList(endpoint);
  const clients = data?.clients || [];
  const invoices = data?.invoices || [];
  const subscriptions = data?.subscriptions || [];
  const activeRows = tab === 'subs' ? subscriptions : tab === 'invoices' ? invoices : clients;
  const selectedClient = selected?.type === 'client' ? clients.find((client) => client.id === selected.id) || selected.data : null;
  const showDetail = !!selected;

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
    window.location.href = href;
  }

  return (
    <PageChrome active="/db/" title="Database" className={`db-page ${showDetail ? 'show-detail' : ''}`}>
      <section className="workspace-grid db-grid">
        <aside className="workspace-panel side-panel">
          <div className="segmented">
            <button className={tab === 'clients' ? 'active' : ''} onClick={() => setTab('clients')} type="button">Clients</button>
            <button className={tab === 'subs' ? 'active' : ''} onClick={() => setTab('subs')} type="button">Subs</button>
            <button className={tab === 'invoices' ? 'active' : ''} onClick={() => setTab('invoices')} type="button">Invoices</button>
          </div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" />
          {tab === 'clients' ? <button className="add-client-button" type="button" onClick={openNewClient}>Create Client</button> : null}
          <div className="db-list">
            {activeRows.slice(0, 80).map((row, index) => {
              const title = row.client_name || row.name || row.title || row.slug;
              const meta = row.contact || row.client_contact || row.service || row.status || row.updated_at;
              const isClient = tab === 'clients';
              return (
                <button
                  className={`db-list-row ${selected?.id === row.id ? 'active' : ''}`}
                  key={row.id || index}
                  onClick={() => isClient ? setSelected({ type: 'client', id: row.id, data: row }) : setSelected({ type: tab, id: row.id, data: row })}
                  type="button"
                >
                  <strong>{title || 'Untitled'}</strong>
                  {meta ? <span>{meta}</span> : null}
                </button>
              );
            })}
            {!status && activeRows.length === 0 ? <p className="empty-state">No records yet.</p> : null}
          </div>
        </aside>
        <section className="workspace-panel db-detail-panel">
          {status ? <p className="empty-state">{status}</p> : null}
          {!selected && !status ? <h2>{tab === 'subs' ? 'Subscriptions' : tab === 'invoices' ? 'Invoices' : 'Choose A Client'}</h2> : null}
          {selected?.type === 'new' ? (
            <>
              <button className="db-back-button" type="button" onClick={() => setSelected(null)}>Back</button>
              <h2>Create Client</h2>
              <ClientForm draft={draft} onChange={setDraft} onCancel={() => setSelected(null)} onSave={saveClient} status={saveStatus} />
            </>
          ) : null}
          {selectedClient ? <ClientDetail client={selectedClient} invoices={invoices} deliveries={data?.items || []} onCreateEvent={createEventForClient} onBack={() => setSelected(null)} /> : null}
          {selected && !selectedClient && selected.type !== 'new' ? (
            <>
              <button className="db-back-button" type="button" onClick={() => setSelected(null)}>Back</button>
              <div className="list-stack">
                <ListRow
                  title={selected.data?.client_name || selected.data?.name || selected.data?.title || selected.data?.service}
                  meta={selected.data?.client_contact || selected.data?.contact || selected.data?.status || selected.data?.updated_at}
                  amount={selected.data?.total || selected.data?.grand_total || selected.data?.price ? rupiah(selected.data.total || selected.data.grand_total || selected.data.price) : ''}
                />
              </div>
            </>
          ) : null}
        </section>
      </section>
    </PageChrome>
  );
}

export function LinkGeneratorPage() {
  const [client, setClient] = useState('');
  const [slug, setSlug] = useState('');
  const [service, setService] = useState('Google Drive');
  const [status, setStatus] = useState('');
  const shortSlug = useMemo(() => {
    const base = `${client}-${slug}-${service}`.toLowerCase().replace(/[^a-z0-9]+/g, '');
    let hash = 2166136261;
    for (let index = 0; index < base.length; index += 1) hash = Math.imul(hash ^ base.charCodeAt(index), 16777619);
    return Math.abs(hash).toString(36).padStart(7, '0').slice(0, 12);
  }, [client, slug, service]);

  async function save(event) {
    event.preventDefault();
    setStatus('Ready locally. Production save uses existing worker API.');
  }

  return (
    <PageChrome active="/l/" title="Link Generator" aside="Clean delivery messages and short-code previews.">
      <section className="workspace-grid">
        <form className="workspace-panel form-stack" onSubmit={save}>
          <label>Client<input value={client} onChange={(event) => setClient(event.target.value)} placeholder="Client name" /></label>
          <label>Gallery or folder slug<input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="Google Drive / Dropbox link" /></label>
          <label>Service<select value={service} onChange={(event) => setService(event.target.value)}><option>Google Drive</option><option>Dropbox</option><option>iCloud</option><option>USB</option></select></label>
          <button className="primary-button" type="submit">Prepare Link</button>
          <p className="download-status">{status}</p>
        </form>
        <section className="workspace-panel preview-note-card">
          <p className="eyebrow">Preview</p>
          <h2>{client || 'Client'} Delivery</h2>
          <p>Your gallery is ready. Open here:</p>
          <strong>sshots.pages.dev/{shortSlug}</strong>
        </section>
      </section>
    </PageChrome>
  );
}

export function SubscriptionsPage() {
  const [client, setClient] = useState('');
  const [service, setService] = useState('iCloud');
  const [storage, setStorage] = useState(500);
  const [duration, setDuration] = useState(30);
  const [rate, setRate] = useState(45000);
  const total = Math.round((Number(rate) || 0) * (Number(duration) || 0) / 30);

  return (
    <PageChrome active="/subs/" title="Subscriptions" aside="Subscription invoices stay visually aligned with the private tools.">
      <section className="workspace-grid">
        <form className="workspace-panel form-stack">
          <label>Service<select value={service} onChange={(event) => setService(event.target.value)}><option>iCloud</option><option>Google Drive</option><option>Dropbox</option></select></label>
          <label>Client name<input value={client} onChange={(event) => setClient(event.target.value)} placeholder="Client name" /></label>
          <div className="two-col">
            <label>Storage<input type="number" value={storage} onChange={(event) => setStorage(event.target.value)} /></label>
            <label>Duration<input type="number" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
          </div>
          <label>Monthly rate<input type="number" value={rate} onChange={(event) => setRate(event.target.value)} /></label>
        </form>
        <section className="workspace-panel preview-note-card">
          <p className="eyebrow">Invoice Preview</p>
          <h2>{client || 'Client'}</h2>
          <p>{service} storage, {storage}GB, {duration} days.</p>
          <strong>{rupiah(total)}</strong>
          <small>{today()}</small>
        </section>
      </section>
    </PageChrome>
  );
}
