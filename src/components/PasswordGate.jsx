import { useEffect, useMemo, useState } from 'react';
import { GlobalBackground } from './GlobalBackground.jsx';

const SESSION_MS = 15 * 60 * 1000;

function sessionKey(title) {
  return `starshots_gate_${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
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
  const key = useMemo(() => sessionKey(title), [title]);
  const [unlocked, setUnlocked] = useState(() => readSession(key));
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!unlocked) return;
    sessionStorage.setItem(key, JSON.stringify({ expiresAt: Date.now() + SESSION_MS }));
  }, [key, unlocked]);

  async function openGate(event) {
    event.preventDefault();
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: value }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Unauthorized.');
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

  return (
    <main className="gate-page">
      <GlobalBackground />
      <form className="gate-card" onSubmit={openGate}>
        <img className="gate-logo" src="/logo-hero.png" alt="StarShots" />
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
          />
          <button type="button" aria-label="Toggle password visibility" onClick={() => setShowPassword((value) => !value)}>
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
        <button className="gate-submit" type="submit" disabled={busy}>
          {busy ? 'Opening...' : 'Sign In'}
        </button>
        <p className={`gate-status ${status.includes('Unauthorized') || status.includes('required') ? 'error' : ''}`}>{status}</p>
      </form>
    </main>
  );
}
