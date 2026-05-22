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

function PageChrome({ active, title, eyebrow = 'StarShots Private', aside, children }) {
  return (
    <main className="workspace-page">
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
    fetch(endpoint)
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

export function DatabasePage() {
  const [tab, setTab] = useState('clients');
  const [query, setQuery] = useState('');
  const endpoint = `/api/db${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`;
  const { data, status } = useRemoteList(endpoint);
  const clients = data?.clients || [];
  const invoices = data?.invoices || [];
  const subscriptions = data?.subscriptions || [];
  const activeRows = tab === 'subs' ? subscriptions : tab === 'invoices' ? invoices : clients;

  return (
    <PageChrome active="/db/" title="Database" aside="Clients stay separated from subscription records, so Subs has its own lane.">
      <section className="workspace-grid">
        <aside className="workspace-panel side-panel">
          <div className="segmented">
            <button className={tab === 'clients' ? 'active' : ''} onClick={() => setTab('clients')} type="button">Clients</button>
            <button className={tab === 'subs' ? 'active' : ''} onClick={() => setTab('subs')} type="button">Subs</button>
            <button className={tab === 'invoices' ? 'active' : ''} onClick={() => setTab('invoices')} type="button">Invoices</button>
          </div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" />
        </aside>
        <section className="workspace-panel">
          <h2>{tab === 'subs' ? 'Subscriptions' : tab === 'invoices' ? 'Invoices' : 'Clients'}</h2>
          {status ? <p className="empty-state">{status}</p> : null}
          <div className="list-stack">
            {activeRows.slice(0, 40).map((row, index) => (
              <ListRow
                key={row.id || index}
                title={row.client_name || row.name || row.title || row.slug}
                meta={row.client_contact || row.contact || row.service || row.status || row.updated_at}
                amount={row.total || row.grand_total || row.price ? rupiah(row.total || row.grand_total || row.price) : ''}
              />
            ))}
            {!status && activeRows.length === 0 ? <p className="empty-state">No records yet.</p> : null}
          </div>
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
