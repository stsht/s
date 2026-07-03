// Lightweight gated debug logger shared by /db, /l, and /inv.
// Enable with ?debug=1; the flag stays hot for the tab via sessionStorage.
export function dbgEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    const url = new URLSearchParams(window.location.search);
    if (url.get('debug') === '1') {
      try { window.sessionStorage?.setItem('starshots_debug_grouping', '1'); } catch {}
      return true;
    }
    return window.sessionStorage?.getItem('starshots_debug_grouping') === '1';
  } catch {
    return false;
  }
}

export function dbg(...args) {
  if (dbgEnabled()) console.log('[grouping]', ...args);
}
