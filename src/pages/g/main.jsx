import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GlobalBackground } from '../../components/GlobalBackground.jsx';
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
  const linkMap = new Map(links.map((link) => [String(link.service || '').toLowerCase(), link]));
  const services = [
    { key: 'gd', aliases: ['gd', 'drive', 'google drive'], fallback: 'Google Drive', icon: 'GD' },
    { key: 'db', aliases: ['db', 'dropbox'], fallback: 'Dropbox', icon: 'DB' },
    { key: 'wt', aliases: ['wt', 'wetransfer', 'we transfer'], fallback: 'WeTransfer', icon: 'WT' },
    { key: 'tn', aliases: ['tn', 'transfernow', 'transfer now'], fallback: 'TransferNow', icon: 'TN' },
  ];

  async function track(service) {
    if (!delivery.id || !service) return;
    fetch('/api/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliveryId: delivery.id, service }),
    }).catch(() => {});
  }

  const honorific = String(delivery.title || '').trim();
  // Greeting always includes the honorific when present so the
  // public copy reads as "Hello, Ms. Amanda" / "Hello, Mr. Billy
  // Regal". Older rows that were saved without a title fall back
  // to the bare client name; rows with no name at all keep the
  // generic placeholder.
  const heading = delivery.clientName
    ? `Hello, ${honorific ? `${honorific} ` : ''}${delivery.clientName}`
    : 'Your files are ready';
  const folderLabel = String(delivery.folderName || '').trim();

  return (
    <main className="public-delivery-page">
      <GlobalBackground />
      <section className="public-delivery-card" aria-label="Private delivery links">
        {/* Brand header: logo + folder name share a centered column
            above the divider line. The divider replaces the older
            kicker's border-top so the visual hierarchy reads as
            (logo → folder → line → greeting → CTA copy → links). */}
        <header className="public-delivery-header">
          <picture>
            <source media="(prefers-color-scheme: dark)" srcSet="/logo-hero-white.png" />
            <img className="public-delivery-logo" src="/logo-hero.png" alt="StarShots" />
          </picture>
          {folderLabel ? <p className="public-delivery-folder">{folderLabel}</p> : null}
        </header>
        <div className="public-delivery-divider" role="presentation" />
        <h1 className="public-delivery-greeting">{heading}</h1>
        <p className="public-delivery-subcopy">Choose your preferred delivery option below</p>
        <div className="public-delivery-list">
          {services.map(({ key, aliases, fallback, icon }) => {
            const link = aliases.map((alias) => linkMap.get(alias)).find(Boolean);
            const available = !!link?.url;
            const content = (
              <>
                <span className="public-delivery-icon">{icon}</span>
                <span className="public-delivery-name">{link?.label || fallback}</span>
                <span className="public-delivery-state">{available ? 'Click' : 'Unavailable'}</span>
              </>
            );
            return available ? (
              <a
                key={fallback}
                className="public-delivery-row is-active"
                href={link.url}
                onClick={() => track(link.service || key)}
                rel="noopener"
                target="_blank"
              >
                {content}
              </a>
            ) : (
              <div key={fallback} className="public-delivery-row is-muted">
                {content}
              </div>
            );
          })}
        </div>
        <p className="public-delivery-signoff">With love, StarShots</p>
      </section>
    </main>
  );
}

function GalleryGate() {
  const slug = useMemo(() => deliverySlug(), []);
  const [payload, setPayload] = useState(null);
  // Safe public-facing metadata returned by the empty-password
  // probe (worker handleUnlock). Holds { title, clientName } so the
  // gate can render "Hello, <Title> <Client Name>" before the
  // visitor types the access key. Empty when the metadata could
  // not be loaded — the gate then falls back to a bare "Hello".
  const [gateInfo, setGateInfo] = useState(null);
  // checking = the one-shot admin-bypass / metadata probe is still
  // in flight. While true we render nothing so an authenticated
  // admin (cookie already set by /db) never sees the password gate
  // flash before the auto-unlock resolves. A public visitor's
  // probe returns gate metadata quickly and the gate then renders.
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  // Access-key input ref + idle UX state. Used by the click/tap-to
  // -focus handlers below so a tap on the card or the
  // "Tap/Click to continue" hint pulls focus into the password
  // field. Purely a UX affordance — none of the unlock fetch /
  // payload / slug logic is changed.
  const inputRef = useRef(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [pointerCoarse, setPointerCoarse] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    try { return !!window.matchMedia('(pointer: coarse)').matches; } catch { return false; }
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(pointer: coarse)');
    const apply = () => setPointerCoarse(!!mq.matches);
    apply();
    if (mq.addEventListener) {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
    if (mq.addListener) {
      mq.addListener(apply);
      return () => mq.removeListener(apply);
    }
    return undefined;
  }, []);

  function focusGateInput() {
    const el = inputRef.current;
    if (!el || el.disabled) return;
    if (typeof document !== 'undefined' && document.activeElement === el) return;
    try { el.focus({ preventScroll: false }); } catch { el.focus(); }
  }

  function handleCardClick(event) {
    const t = event.target;
    if (!t || typeof t.closest !== 'function') return;
    if (t.closest('input, button, a, label, [contenteditable="true"]')) return;
    focusGateInput();
  }

  // Admin auto-unlock + public gate metadata probe.
  //
  // POSTs an empty-password unlock with credentials so the worker
  // can read the HttpOnly admin session cookie. The cookie is never
  // exposed to JS — only the server can verify it. The worker
  // responds in three shapes:
  //   - { ok: true, delivery, links }  -> admin bypass: jump to UI
  //   - { ok: false, gate: { title, clientName } }
  //         -> public visitor: render the gate with a personalised
  //            "Hello, <Title> <Client Name>" greeting
  //   - 4xx error                      -> render the bare gate
  //
  // Empty-password probes do not count toward the gallery 12/min
  // rate limit (see handleUnlock in _worker.js), so this single
  // mount-time call never burns a public visitor's password budget
  // and never writes a password_failed log.
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
        if (!response.ok) return;
        const data = await response.json().catch(() => ({}));
        if (data?.ok) {
          setPayload(data);
          return;
        }
        const gate = data?.gate;
        if (gate && (gate.title || gate.clientName)) {
          setGateInfo({
            title: String(gate.title || '').trim(),
            clientName: String(gate.clientName || '').trim(),
          });
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

  // Personalised greeting derived from the safe public metadata
  // returned by the empty-password probe. If the probe didn't
  // resolve (network error, missing record, dev mode) we fall
  // back to a bare "Hello" — never to the old "Private Delivery"
  // chrome.
  const honorific = String(gateInfo?.title || '').trim();
  const clientName = String(gateInfo?.clientName || '').trim();
  const greeting = clientName
    ? `Hello, ${honorific ? `${honorific} ` : ''}${clientName}`
    : 'Hello';

  return (
    <main className="gate-page">
      <GlobalBackground />
      <form className="gate-card" onSubmit={unlock} onClick={handleCardClick}>
        {/* Real white-on-transparent asset for dark mode (no filter).
         * Wrapped in .gate-brand so the idle shimmer/breathe loop
         * (CSS in invcs.css) has a positioned host with overflow
         * hidden to clip the sweep band to the brand bounding box. */}
        <span className="gate-brand">
          <picture>
            <source media="(prefers-color-scheme: dark)" srcSet="/logo-hero-white.png" />
            <img className="gate-logo" src="/logo-hero.png" alt="StarShots" />
          </picture>
        </span>
        <h1>{greeting}</h1>
        <label htmlFor="galleryPassword">Access key</label>
        <div className="gate-input">
          <input
            id="galleryPassword"
            ref={inputRef}
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
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
        {/* Idle "continue" hint — same component-shape as the
         * private PasswordGate so /g visitors see the same calm
         * cue. Pulses gently with the brand shimmer (CSS), hides
         * while the input is focused. */}
        <p
          className={`gate-hint${inputFocused ? ' is-hidden' : ''}`}
          onClick={focusGateInput}
          aria-hidden={inputFocused ? 'true' : undefined}
        >
          {pointerCoarse ? 'Tap to continue' : 'Click to continue'}
        </p>
      </form>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GalleryGate />
  </React.StrictMode>,
);
