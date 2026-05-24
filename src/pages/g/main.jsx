import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GlobalBackground } from '../../components/GlobalBackground.jsx';
import { PrivateWorkspaceFrame } from '../../components/PrivateWorkspaceFrame.jsx';
import '../invcs/invcs.css';

/**
 * Gallery (public delivery) entrypoint.
 *
 * Routing/slug logic is owned by _worker.js — this page only handles
 * the unlock POST and the rendered links. Slug parsing here just reads
 * whatever path the worker delivered us; it does NOT regenerate or
 * normalize the short-code so existing links keep working unchanged.
 */
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

  const heading = delivery.clientName ? `Hello, ${delivery.clientName}` : 'Private Delivery';
  const hasValidTitle = delivery.title && !['Ms.', 'Mr.', 'Mrs.', 'Family', 'Ms', 'Mr'].includes(delivery.title);
  const subtitle = (hasValidTitle ? delivery.title : '') || delivery.folderName || 'Your delivery links are ready.';

  const left = (
    <>
      <p className="eyebrow">{subtitle}</p>
      <h2>{heading}</h2>
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
    </>
  );

  return (
    <PrivateWorkspaceFrame
      active=""
      showNav={false}
      logoHref="/"
      left={left}
    />
  );
}

function GalleryGate() {
  const slug = useMemo(() => deliverySlug(), []);
  const [payload, setPayload] = useState(null);
  // checking = the one-shot admin-bypass probe is still in flight.
  // While true we render nothing so an authenticated admin (cookie
  // already set by /db) never sees the password gate flash before
  // the auto-unlock resolves. A public visitor's probe returns 401
  // quickly and the gate then renders.
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  // Admin auto-unlock probe.
  //
  // POSTs an empty-password unlock with credentials so the worker
  // can read the HttpOnly admin session cookie. The cookie is never
  // exposed to JS — only the server can verify it. If the worker
  // accepts (admin session valid), it returns the same payload as a
  // successful password unlock and we bypass the gate. If it rejects
  // (no/expired admin session), the response is 401 and we show the
  // gate as before.
  //
  // Empty-password probes do not count toward the gallery 12/min
  // rate limit (see handleUnlock in _worker.js), so this single
  // mount-time call never burns a public visitor's password budget.
  useEffect(() => {
    let alive = true;
    if (!slug) {
      setChecking(false);
      return undefined;
    }
    if (import.meta.env.DEV) {
      setChecking(false);
      return undefined;
    }
    fetch('/api/unlock', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, password: '' }),
    })
      .then(async (response) => {
        if (!alive) return;
        if (response.ok) {
          const data = await response.json().catch(() => ({}));
          if (data?.ok) setPayload(data);
        }
      })
      .catch(() => {})
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, [slug]);

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
        credentials: 'same-origin',
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

  // Admin probe still in flight — instead of returning null (which
  // produced a brief blank /g flash for both admins and public
  // visitors after PR #56), render the normal gate shell with a
  // subtle "Opening..." status. The form is disabled until the
  // probe resolves so a public visitor doesn't accidentally submit
  // an empty unlock; once `checking` flips off, the probe has
  // either set `payload` (admin auto-unlock) or left it null
  // (public visitor — gate stays visible and editable).
  if (payload) return <GalleryLinks payload={payload} />;

  const gateBusy = busy || checking;
  const gateStatus = checking ? 'Opening...' : status;
  const gateStatusClass = status && !checking ? 'error' : '';

  return (
    <main className="gate-page">
      <GlobalBackground />
      <form className="gate-card" onSubmit={unlock}>
        {/* Real white-on-transparent asset for dark mode (no filter). */}
        <picture>
          <source media="(prefers-color-scheme: dark)" srcSet="/logo-hero-white.png" />
          <img className="gate-logo" src="/logo-hero.png" alt="StarShots" />
        </picture>
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
            disabled={checking}
          />
          <button type="button" aria-label="Toggle password visibility" onClick={() => setShowPassword((value) => !value)}>
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        <button className="gate-submit" type="submit" disabled={gateBusy}>
          {gateBusy ? 'Opening...' : 'Sign In'}
        </button>
        <p className={`gate-status ${gateStatusClass}`}>{gateStatus}</p>
      </form>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GalleryGate />
  </React.StrictMode>,
);
