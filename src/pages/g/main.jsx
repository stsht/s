import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GlobalBackground } from '../../components/GlobalBackground.jsx';
import '../invcs/invcs.css';

/**
 * Public gallery delivery — single centred card flow.
 *
 * One <main className="gate-page"> with one card; the card swaps
 * between two inner states:
 *
 *   locked    Password input form, mirrors PasswordGate visually so
 *             clients arriving at /:12char see the same React-themed
 *             gate the operator sees on /db, /l, /inv, /subs.
 *   unlocked  Same card, .gate-card--delivery variant, with a
 *             greeting + 2x2 service link grid. No workspace shell,
 *             no nav row — this is a public delivery surface, not a
 *             tool tab.
 *
 * Routing/slug logic is owned by _worker.js — this page only reads
 * whatever path the worker delivered (a 12-char short code or a
 * /g/<base-slug>) and submits it to /api/unlock. Crypto / random
 * generation stays untouched: server still issues short codes
 * via SHA-256 + nonce + timestamp, and gallery passwords still
 * round-trip through PBKDF2 + random salt.
 */

// Path -> lookup token. The worker accepts either a 12-char short
// code or a /g/<slug> form on /api/unlock; we just hand the path
// segment over.
function deliverySlug() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0]?.toLowerCase() === 'g') return parts[1] || '';
  return parts[0] || '';
}

const SERVICE_LABEL = {
  gd: 'Google Drive',
  db: 'Dropbox',
  wt: 'WeTransfer',
  tn: 'TransferNow',
};

// Inline service icons. Keeps the public card free of font / icon
// library dependencies and renders identically in dark / light.
const SERVICE_ICON = {
  gd: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 3h7l5.5 9.5-3.5 6h-11L3 12.5 8.5 3Zm1.2 2-4.2 7.3h4.2L13.9 5H9.7Zm8.6 8.3-2.8 4.7H9.8l2.8-4.7h5.7Zm-11.6 0h4.1L7.9 18 5 13.3h2.7Z" fill="currentColor" />
    </svg>
  ),
  db: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 3 12 6.3 6.5 9.6 1 6.3 6.5 3Zm11 0L23 6.3 17.5 9.6 12 6.3 17.5 3Zm-11 7.6L12 13.9l-5.5 3.3L1 13.9l5.5-3.3Zm11 0L23 13.9l-5.5 3.3L12 13.9l5.5-3.3ZM6.8 18.3 12 15l5.2 3.3L12 21.6l-5.2-3.3Z" fill="currentColor" />
    </svg>
  ),
  wt: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5.75.75 0 0 0-1.5 0 7 7 0 1 1-7-7 .75.75 0 0 0 0-1.5Zm.75 2.75v8.19l2.72-2.72a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 1 1 1.06-1.06l2.72 2.72V6.25a.75.75 0 0 1 1.5 0Z" fill="currentColor" />
    </svg>
  ),
  tn: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12.53 14.47a.75.75 0 0 1 0-1.06l1.72-1.72H9.75a.75.75 0 0 1 0-1.5h4.5l-1.72-1.72a.75.75 0 1 1 1.06-1.06l3 3a.75.75 0 0 1 0 1.06l-3 3a.75.75 0 0 1-1.06 0ZM6.5 18A4.5 4.5 0 0 1 6 9.03 6 6 0 0 1 18 10a4 4 0 0 1 0 8h-1.5a.75.75 0 0 1 0-1.5H18a2.5 2.5 0 0 0 0-5h-.75V10a4.5 4.5 0 0 0-9-.1.75.75 0 0 1-.72.65A3 3 0 0 0 6.5 16.5H10a.75.75 0 0 1 0 1.5H6.5Z" fill="currentColor" />
    </svg>
  ),
};

// Order in which services render. Worker accepts any subset; the
// 4-up grid stays stable so two missing services never reflow the
// remaining links into surprise positions.
const SERVICE_ORDER = ['gd', 'db', 'wt', 'tn'];

function DeliveryLinks({ payload }) {
  const delivery = payload?.delivery || {};
  const links = payload?.links || [];

  function track(service) {
    if (!delivery.id || !service) return;
    fetch('/api/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliveryId: delivery.id, service }),
    }).catch(() => {});
  }

  const heading = delivery.clientName
    ? `Hello, ${delivery.clientName}`
    : 'Your files are ready';

  return (
    <section className="gate-card gate-card--delivery" aria-live="polite">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcSet="/logo-hero-white.png" />
        <img className="gate-logo" src="/logo-hero.png" alt="StarShots" />
      </picture>
      <p className="gate-eyebrow"><span />Private Delivery<span /></p>
      <h1>{heading}</h1>
      <p className="delivery-subline">Choose your preferred delivery option below.</p>
      <div className="delivery-link-grid">
        {SERVICE_ORDER.map((key) => {
          const link = links.find((item) => item?.service === key);
          const active = !!link?.url;
          const iconNode = (
            <span className="delivery-link-icon" aria-hidden="true">{SERVICE_ICON[key]}</span>
          );
          const nameNode = (
            <span className="delivery-link-name">{SERVICE_LABEL[key]}</span>
          );
          if (active) {
            return (
              <a
                key={key}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="delivery-link delivery-link--active"
                onClick={() => track(key)}
              >
                {iconNode}
                {nameNode}
                <span className="delivery-link-go">Open</span>
              </a>
            );
          }
          return (
            <span
              key={key}
              className="delivery-link delivery-link--disabled"
              aria-disabled="true"
            >
              {iconNode}
              {nameNode}
              <span className="delivery-link-go">Unavailable</span>
            </span>
          );
        })}
      </div>
      <p className="delivery-tagline">With love, StarShots</p>
    </section>
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
      setStatus('');
      setPayload(data);
    } catch (error) {
      if (import.meta.env.DEV) {
        // Local Vite preview fallback so the unlocked card can be
        // designed without a live worker. Never reached in
        // production builds (import.meta.env.DEV is statically
        // false in `vite build`).
        setPayload({
          ok: true,
          delivery: { clientName: 'Client', title: 'Local preview delivery' },
          links: [
            { service: 'gd', label: 'Google Drive', url: 'https://drive.google.com/' },
            { service: 'db', label: 'Dropbox', url: 'https://dropbox.com/' },
          ],
        });
        return;
      }
      setStatus(error.message || 'Wrong password.');
    } finally {
      setBusy(false);
    }
  }

  if (payload) {
    return (
      <main className="gate-page">
        <GlobalBackground />
        <DeliveryLinks payload={payload} />
      </main>
    );
  }

  // Locked state — same shell as PasswordGate (workspace gates) so
  // a client visiting their delivery link sees the same React-
  // themed card the operator sees on /db, /l, /inv, /subs.
  const isError = !!status && !/Checking/i.test(status);
  return (
    <main className="gate-page">
      <GlobalBackground />
      <form className="gate-card" onSubmit={unlock}>
        <picture>
          <source media="(prefers-color-scheme: dark)" srcSet="/logo-hero-white.png" />
          <img className="gate-logo" src="/logo-hero.png" alt="StarShots" />
        </picture>
        <p className="gate-eyebrow"><span />Private Delivery<span /></p>
        <h1>Your files are ready</h1>
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
          <button
            type="button"
            aria-label="Toggle password visibility"
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        <button className="gate-submit" type="submit" disabled={busy}>
          {busy ? 'Opening...' : 'Open Files'}
        </button>
        <p className={`gate-status ${isError ? 'error' : ''}`}>{status}</p>
      </form>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GalleryGate />
  </React.StrictMode>,
);
