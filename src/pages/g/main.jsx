import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GlobalBackground } from '../../components/GlobalBackground.jsx';
import '../invcs/invcs.css';

function deliverySlug() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0]?.toLowerCase() === 'g') return parts[1] || '';
  return parts[0] || '';
}

function GalleryLinks({ payload }) {
  const delivery = payload?.delivery || {};
  const links = (payload?.links || []).filter((item) => item?.url);

  async function track(service) {
    if (!delivery.id || !service) return;
    fetch('/api/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliveryId: delivery.id, service }),
    }).catch(() => {});
  }

  return (
    <main className="workspace-page gallery-page">
      <GlobalBackground />
      <div className="workspace-shell">
        <header className="workspace-topbar">
          <a className="workspace-logo" href="/" aria-label="StarShots">
            <img src="/logo-hero.png" alt="StarShots" />
          </a>
          <nav className="workspace-nav" aria-label="Delivery status">
            <span className="gallery-pill">Private Delivery</span>
          </nav>
        </header>
        <section className="workspace-hero">
          <div>
            <p className="hero-eyebrow"><span />StarShots Private</p>
            <h1>{delivery.clientName ? `Hello, ${delivery.clientName}` : 'Private Delivery'}</h1>
          </div>
          <p className="hero-aside">{delivery.title || delivery.folderName || 'Your delivery links are ready.'}</p>
        </section>
        <section className="workspace-panel gallery-panel">
          <p className="eyebrow">Available Links</p>
          <div className="gallery-link-grid">
            {links.length ? links.map((link) => (
              <a
                className="gallery-link-card"
                href={link.url}
                key={link.service}
                onClick={() => track(link.service)}
                rel="noopener"
                target="_blank"
              >
                <span>{link.label || link.service}</span>
                <b>Open</b>
              </a>
            )) : <p className="empty-state">No links available yet.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}

function GalleryGate() {
  const slug = useMemo(() => deliverySlug(), []);
  const [payload, setPayload] = useState(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function unlock(event) {
    event.preventDefault();
    const value = password.trim();
    if (!slug) {
      setStatus('Delivery link not found.');
      return;
    }
    if (!value) {
      setStatus('Access key required.');
      return;
    }

    setBusy(true);
    setStatus('Checking...');
    try {
      const response = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, password: value }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Wrong password.');
      setPayload(data);
    } catch (error) {
      if (import.meta.env.DEV) {
        setPayload({
          ok: true,
          delivery: { clientName: 'Client', title: 'Local preview delivery' },
          links: [
            { service: 'drive', label: 'Google Drive', url: 'https://drive.google.com/' },
            { service: 'dropbox', label: 'Dropbox', url: 'https://dropbox.com/' },
          ],
        });
        return;
      }
      setStatus(error.message || 'Wrong password.');
    } finally {
      setBusy(false);
    }
  }

  if (payload) return <GalleryLinks payload={payload} />;

  return (
    <main className="gate-page">
      <GlobalBackground />
      <form className="gate-card" onSubmit={unlock}>
        <img className="gate-logo" src="/logo-hero.png" alt="StarShots" />
        <p className="gate-eyebrow"><span />Private Workspace<span /></p>
        <h1>Private Delivery</h1>
        <label htmlFor="galleryPassword">Access key</label>
        <div className="gate-input">
          <input
            id="galleryPassword"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck="false"
          />
          <button type="button" aria-label="Toggle password visibility" onClick={() => setShowPassword((value) => !value)}>
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        <button className="gate-submit" type="submit" disabled={busy}>
          {busy ? 'Opening...' : 'Sign In'}
        </button>
        <p className={`gate-status ${status ? 'error' : ''}`}>{status}</p>
      </form>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GalleryGate />
  </React.StrictMode>,
);
