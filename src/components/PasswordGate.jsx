import { useEffect, useMemo, useRef, useState } from 'react';
import { GlobalBackground } from './GlobalBackground.jsx';

const SESSION_MS = 15 * 60 * 1000;

// One shared session key across every private workspace page so that
// signing in once unlocks /db, /l, /inv, /subs, etc. for the same browser tab.
const SHARED_SESSION_KEY = 'starshots_gate_private';

// Soft cap on the visible lockout countdown. The server's actual block
// is short (60s, see _worker.js handleAdminCheck), but if the server
// ever returned a longer Retry-After we still don't want to scare the
// owner with a multi-minute timer. Anything past this falls back to a
// generic "try again shortly" message and the user can attempt again
// at their leisure (the next attempt re-checks against the server).
const LOCKOUT_DISPLAY_CAP_S = 30;

function sessionKey() {
  return SHARED_SESSION_KEY;
}

function readSession(key) {
  try {
    const raw = sessionStorage.getItem(key);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved && Number(saved.expiresAt) > Date.now()) return true;
  } catch {
    sessionStorage.removeItem(key);
  }
  return false;
}

export function PasswordGate({ title, children }) {
  const key = useMemo(() => sessionKey(), []);
  const [unlocked, setUnlocked] = useState(() => readSession(key));
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  // Lockout state. lockUntil is the timestamp (ms) at which the
  // client-side cooldown expires. lockSeconds is the remaining seconds
  // for the visible countdown.
  const [lockUntil, setLockUntil] = useState(0);
  const [lockSeconds, setLockSeconds] = useState(0);
  const tickRef = useRef(null);

  useEffect(() => {
    if (!unlocked) return;
    sessionStorage.setItem(key, JSON.stringify({ expiresAt: Date.now() + SESSION_MS }));
  }, [key, unlocked]);

  useEffect(() => {
    if (!unlocked || import.meta.env.DEV) return;
    let alive = true;
    fetch('/api/admin-check', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then((response) => {
        if (!alive || response.ok) return;
        sessionStorage.removeItem(key);
        setUnlocked(false);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [key, unlocked]);

  // Drive the visible countdown while a lockout is active.
  useEffect(() => {
    if (!lockUntil) return undefined;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
      setLockSeconds(remaining);
      if (remaining <= 0) {
        setLockUntil(0);
        setStatus('');
      }
    };
    tick();
    tickRef.current = setInterval(tick, 500);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [lockUntil]);

  function startLockout(retryAfterSeconds) {
    const capped = Math.min(LOCKOUT_DISPLAY_CAP_S, Math.max(1, Math.round(Number(retryAfterSeconds) || 0)));
    setLockUntil(Date.now() + capped * 1000);
    setLockSeconds(capped);
  }

  async function openGate(event) {
    event.preventDefault();
    if (lockUntil && Date.now() < lockUntil) return;
    const value = password.trim();
    if (!value) {
      setStatus('Access key required.');
      return;
    }

    setBusy(true);
    setStatus('Checking...');
    try {
      const response = await fetch('/api/admin-check', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: value }),
      });

      if (response.status === 429) {
        // Server-imposed lockout — read Retry-After (seconds) and start
        // the visible countdown. Cap the displayed value so the owner
        // is never told to wait minutes.
        const retryAfter = Number(response.headers.get('Retry-After')) || 30;
        startLockout(retryAfter);
        setStatus(`Too many attempts. Try again in ${Math.min(LOCKOUT_DISPLAY_CAP_S, Math.max(1, Math.round(retryAfter)))}s.`);
        return;
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Unauthorized.');

      // Successful unlock: clear any lingering lockout/status.
      setLockUntil(0);
      setLockSeconds(0);
      setStatus('');
      setUnlocked(true);
    } catch (error) {
      if (import.meta.env.DEV) {
        setStatus('API unavailable in Vite dev. Opening local preview.');
        setUnlocked(true);
        return;
      }
      setStatus(error.message || 'Unauthorized.');
    } finally {
      setBusy(false);
    }
  }

  if (unlocked) return children;

  const locked = lockUntil > 0 && lockSeconds > 0;
  // Keep the live countdown visible to the user without overwriting
  // any other status text the form already has.
  const visibleStatus = locked ? `Too many attempts. Try again in ${lockSeconds}s.` : status;

  return (
    <main className="gate-page">
      <GlobalBackground />
      <form className="gate-card" onSubmit={openGate}>
        {/* picture/source swap to a real white-on-transparent asset
         * for dark mode — CSS filter:invert was unreliable on the
         * existing PNG, so we ship a dedicated logo-hero-white.png. */}
        <picture>
          <source media="(prefers-color-scheme: dark)" srcSet="/logo-hero-white.png" />
          <img className="gate-logo" src="/logo-hero.png" alt="StarShots" />
        </picture>
        <p className="gate-eyebrow"><span />Private Workspace<span /></p>
        <h1>{title}</h1>
        <label htmlFor="gatePassword">Access key</label>
        <div className="gate-input">
          <input
            id="gatePassword"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck="false"
            disabled={locked}
          />
          <button type="button" aria-label="Toggle password visibility" onClick={() => setShowPassword((value) => !value)}>
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        <button className="gate-submit" type="submit" disabled={busy || locked}>
          {busy ? 'Opening...' : locked ? `Wait ${lockSeconds}s` : 'Sign In'}
        </button>
        <p className={`gate-status ${visibleStatus.includes('Unauthorized') || visibleStatus.includes('required') || locked ? 'error' : ''}`}>{visibleStatus}</p>
      </form>
    </main>
  );
}
