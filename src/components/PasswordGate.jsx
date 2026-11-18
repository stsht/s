import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GlobalBackground } from './GlobalBackground.jsx';
import '../../animate.css';
import './PasswordGate.css';

const SESSION_MS = 15 * 60 * 1000;

// One shared session key across every private workspace page. Stored
// in localStorage (not sessionStorage) so signing in once unlocks
// /db, /l, /inv, /subs across browser tabs without re-prompting.
const SHARED_SESSION_KEY = 'starshots_gate_private';

// Soft cap on the visible lockout countdown. Server-side block is
// already 30s (see _worker.js handleAdminCheck), but if a future
// server change ever returned a longer Retry-After we still don't
// want to scare the owner with a multi-minute timer. Anything past
// this falls back to the cap and the user can just retry.
const LOCKOUT_DISPLAY_CAP_S = 30;

function sessionKey() {
  return SHARED_SESSION_KEY;
}

function safeLocalGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore quota / private-mode errors */
  }
}

function safeLocalRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function readSessionExpiry(key) {
  const raw = safeLocalGet(key);
  if (!raw) return 0;
  try {
    const expiresAt = Number(JSON.parse(raw)?.expiresAt);
    if (Number.isSafeInteger(expiresAt) && expiresAt > Date.now()) return expiresAt;
  } catch {
    // Clear malformed local session state below.
  }
  safeLocalRemove(key);
  return 0;
}

function readSession(key) {
  return readSessionExpiry(key) > Date.now();
}

export function PasswordGate({ title, children }) {
  const key = useMemo(() => sessionKey(), []);
  const [unlocked, setUnlocked] = useState(false);
  const [sessionExpiresAt, setSessionExpiresAt] = useState(0);
  const lockInProgressRef = useRef(false);
  // Probe the HttpOnly cookie on every private-page mount, even when
  // localStorage still has time left. That prevents an expired server
  // session from leaving /db, /l, /subs, or /inv visibly "open" while
  // every API call only reports Unauthorized.
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  // Lockout state. lockUntil is the timestamp (ms) at which the
  // client-side cooldown expires. lockSeconds is the remaining
  // seconds for the visible countdown.
  const [lockUntil, setLockUntil] = useState(0);
  const [lockSeconds, setLockSeconds] = useState(0);
  const tickRef = useRef(null);

  // ---- Apple-style splash → form reveal stage ----
  //
  // The gate now renders in two stages: a centered logo splash with
  // a "Tap/Click to continue" hint (stage 1, .gate-page.is-splash),
  // and the actual access-key card (stage 2, .gate-page.is-revealed).
  // Tapping/clicking the page swaps stages and pulls focus into the
  // input. None of the existing auth logic, lockout, session probe,
  // or fetch calls is touched — only the visual entry path.
  const inputRef = useRef(null);
  const logoRef = useRef(null);
  const [revealed, setRevealed] = useState(false);
  const [isPageLoaded, setIsPageLoaded] = useState(false);
  const [isLogoLoaded, setIsLogoLoaded] = useState(false);

  const markSplashLogoReady = useCallback(() => {
    const logo = logoRef.current;
    if (!logo || typeof logo.decode !== 'function') {
      setIsLogoLoaded(true);
      return;
    }
    logo.decode()
      .catch(() => {})
      .finally(() => setIsLogoLoaded(true));
  }, []);

  useEffect(() => {
    if (logoRef.current && logoRef.current.complete) {
      if (logoRef.current.naturalWidth > 0) {
        markSplashLogoReady();
      } else {
        setIsLogoLoaded(true);
      }
    }
  }, [markSplashLogoReady]);

  useEffect(() => {
    if (document.readyState === 'complete') {
      setIsPageLoaded(true);
    } else {
      const handleLoad = () => setIsPageLoaded(true);
      window.addEventListener('load', handleLoad);
      return () => window.removeEventListener('load', handleLoad);
    }
  }, []);

  // Auto-continue to the password gate exactly after 1 double-pulse cycle (2.2s)
  // only after both the page layout is ready AND the high-res logo has downloaded.
  useEffect(() => {
    if (isPageLoaded && isLogoLoaded && !revealed) {
      const timer = setTimeout(() => {
        handleReveal();
      }, 2200);
      return () => clearTimeout(timer);
    }
  }, [isPageLoaded, isLogoLoaded, revealed]);

  // Trigger canonical logo bounce animation as soon as the logo and page are ready.
  // We use a calm, Apple-like initial delay (300ms) before the animation starts,
  // and then reveal the password gate almost instantly after the active animation
  // finishes (at 3600ms total, i.e., 300ms delay + 3300ms active bounce).
  useEffect(() => {
    if (isPageLoaded && isLogoLoaded && logoRef.current) {
      const timer = setTimeout(() => {
        if (window.StarShotsReveal && typeof window.StarShotsReveal.bounceLogos === 'function') {
          window.StarShotsReveal.bounceLogos(logoRef.current.parentNode);
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isPageLoaded, isLogoLoaded]);

  // Keyboard skip for the intro splash. Pressing any key dismisses it straight to
  // the password gate, then tears down the listener so it doesn't intercept keystrokes
  // typed into the access-key input.
  useEffect(() => {
    if (revealed) return undefined;
    const handleKeyDown = () => { handleReveal(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [revealed]);

  function handleReveal() {
    if (revealed) return;
    setRevealed(true);
    inputRef.current?.focus();
    setTimeout(() => { inputRef.current?.focus(); }, 380);
  }

  const lockSession = useCallback((message = '', expectedExpiresAt = 0) => {
    if (lockInProgressRef.current) return;

    // A new login in another tab may race an old tab's expiry timer.
    // Keep the newer server-issued session instead of deleting its cache.
    const currentStoredExpiry = readSessionExpiry(key);
    if (expectedExpiresAt && currentStoredExpiry && currentStoredExpiry !== expectedExpiresAt) {
      setSessionExpiresAt(currentStoredExpiry);
      setUnlocked(true);
      return;
    }

    lockInProgressRef.current = true;
    safeLocalRemove(key);
    setSessionExpiresAt(0);
    setUnlocked(false);
    setPassword('');
    setRevealed(true);
    if (message) setStatus(message);

    // Clear only the cookie belonging to the session being locked. This
    // prevents a delayed logout from an older tab clearing a newer login.
    if (!import.meta.env.DEV) {
      fetch('/api/admin-check', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logout: true, expiresAt: expectedExpiresAt }),
      }).catch(() => {});
    }
  }, [key]);

  // Probe the server on every private-page mount and use only its
  // signed-cookie expiry. Never synthesize or extend an expiry in the browser.
  useEffect(() => {
    if (!checking) return undefined;

    if (import.meta.env.DEV) {
      const expiresAt = readSessionExpiry(key);
      setSessionExpiresAt(expiresAt);
      setUnlocked(expiresAt > Date.now());
      setChecking(false);
      return undefined;
    }

    let alive = true;
    fetch('/api/admin-check', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!alive) return;
        const expiresAt = Number(data?.expiresAt);
        const valid = response.ok && data?.ok === true
          && Number.isSafeInteger(expiresAt) && expiresAt > Date.now();

        if (valid) {
          setSessionExpiresAt(expiresAt);
          safeLocalSet(key, JSON.stringify({ expiresAt }));
          lockInProgressRef.current = false;
          setUnlocked(true);
        } else {
          safeLocalRemove(key);
          setSessionExpiresAt(0);
          setUnlocked(false);
        }
        setChecking(false);
      })
      .catch(() => {
        if (alive) {
          safeLocalRemove(key);
          setSessionExpiresAt(0);
          setUnlocked(false);
          setChecking(false);
        }
      });

    return () => { alive = false; };
  }, [checking, key]);

  // Lock the visible workspace precisely at the server-issued expiry.
  // Browser timer throttling is handled again on focus/visibility return.
  useEffect(() => {
    if (!unlocked || !sessionExpiresAt) return undefined;
    const remaining = sessionExpiresAt - Date.now();
    if (remaining <= 0) {
      lockSession('Session expired. Please sign in again.', sessionExpiresAt);
      return undefined;
    }
    const timer = setTimeout(() => {
      lockSession('Session expired. Please sign in again.', sessionExpiresAt);
    }, remaining);
    return () => clearTimeout(timer);
  }, [unlocked, sessionExpiresAt, lockSession]);

  // Revalidate on tab return without renewing the cookie. Shared storage
  // removal locks every other open private workspace tab.
  useEffect(() => {
    if (!unlocked) return undefined;

    const verifyActiveSession = () => {
      if (sessionExpiresAt && Date.now() >= sessionExpiresAt) {
        lockSession('Session expired. Please sign in again.', sessionExpiresAt);
        return;
      }
      if (import.meta.env.DEV) return;

      fetch('/api/admin-check', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          const serverExpiry = Number(data?.expiresAt);
          if (!response.ok || data?.ok !== true
            || !Number.isSafeInteger(serverExpiry) || serverExpiry <= Date.now()) {
            lockSession('Session expired. Please sign in again.', sessionExpiresAt);
          } else if (serverExpiry > sessionExpiresAt) {
            // Another tab completed a fresh login. Adopt its server-issued
            // expiry instead of letting an older tab invalidate that session.
            setSessionExpiresAt(serverExpiry);
            safeLocalSet(key, JSON.stringify({ expiresAt: serverExpiry }));
          } else if (serverExpiry !== sessionExpiresAt) {
            lockSession('Session expired. Please sign in again.', sessionExpiresAt);
          }
        })
        .catch(() => {
          // A transient network error does not extend the session.
          // The local server-issued expiry timer remains authoritative.
        });
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') verifyActiveSession();
    };
    const handleStorage = (event) => {
      if (event.key !== key) return;
      if (!event.newValue) {
        lockSession('Session ended in another tab.', sessionExpiresAt);
        return;
      }

      try {
        const expiresAt = Number(JSON.parse(event.newValue)?.expiresAt);
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
          lockSession('Session expired. Please sign in again.', sessionExpiresAt);
        } else if (expiresAt !== sessionExpiresAt) {
          setSessionExpiresAt(expiresAt);
        }
      } catch {
        lockSession('Session expired. Please sign in again.', sessionExpiresAt);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', verifyActiveSession);
    window.addEventListener('storage', handleStorage);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', verifyActiveSession);
      window.removeEventListener('storage', handleStorage);
    };
  }, [unlocked, sessionExpiresAt, key, lockSession]);

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
        // the visible countdown. Cap the displayed value at 30s so the
        // owner is never told to wait minutes.
        const retryAfter = Number(response.headers.get('Retry-After')) || 30;
        startLockout(retryAfter);
        setStatus(`Too many attempts. Try again in ${Math.min(LOCKOUT_DISPLAY_CAP_S, Math.max(1, Math.round(retryAfter)))}s.`);
        return;
      }

      const data = await response.json().catch(() => ({}));
      const expiresAt = Number(data?.expiresAt);
      if (!response.ok || data?.ok !== true
        || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
        throw new Error(data.error || 'Unable to verify session expiry. Please sign in again.');
      }

      // Success: store only the server-issued expiry, shared across tabs.
      setLockUntil(0);
      setLockSeconds(0);
      setStatus('');
      lockInProgressRef.current = false;
      setSessionExpiresAt(expiresAt);
      safeLocalSet(key, JSON.stringify({ expiresAt }));
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

  // While the cookie probe is in flight, render nothing. This is
  // brief on a fast network and avoids a flash of the gate UI when
  // the user already has a valid shared session in another tab.
  if (checking) return null;
  if (unlocked) return children;

  const locked = lockUntil > 0 && lockSeconds > 0;
  const visibleStatus = locked ? `Too many attempts. Try again in ${lockSeconds}s.` : status;

  return (
    <main
      className={`gate-page ${revealed ? 'is-revealed' : 'is-splash'}`}
      onClick={handleReveal}
    >
      <GlobalBackground />

      {/* Stage 1: Apple-style splash. Position-absolute, fades out
        * (and slides up subtly) when .gate-page.is-revealed flips on. */}
      <div className="gate-splash" aria-hidden={revealed ? 'true' : undefined}>
        <picture className="gate-splash-logo-wrapper">
          <source media="(prefers-color-scheme: dark)" srcSet="/logo-pre-white.png" />
          <img 
            ref={logoRef}
            className={`gate-splash-logo ss-logo-hero ${(isPageLoaded && isLogoLoaded) ? 'is-loaded' : ''}`}
            src="/logo-pre.png" 
            alt="StarShots" 
            width="1280"
            height="311"
            decoding="async"
            fetchPriority="high"
            loading="eager"
            onLoad={markSplashLogoReady}
            onError={() => setIsLogoLoaded(true)}
          />
        </picture>
      </div>

      {/* Stage 2: the actual access-key form. Hidden (opacity 0,
        * scale .95, pointer-events none) until the splash is
        * dismissed. stopPropagation so a click inside the card
        * never re-triggers handleReveal (idempotent anyway, but
        * keeps the intent explicit). */}
      <form
        className="gate-card"
        onSubmit={openGate}
        onClick={(event) => event.stopPropagation()}
      >
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
            ref={inputRef}
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
