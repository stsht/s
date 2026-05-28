// Helpers for the IDR price/amount/discount inputs across /subs,
// /db Subs, and /inv. Goal: when a field is sitting at 0 the
// digit "0" must read like a placeholder, not a sticky real
// value the operator has to manually backspace out before
// typing. Three behaviours:
//
//   • selectAllIfZero(event)
//       - On focus, if the field's current value parses to 0,
//         select the whole text so the next keystroke replaces
//         it. The browser already keeps "5" instead of "05" when
//         a digit lands on a selected "0", which gives the
//         placeholder-like feel without needing to clear state.
//
//   • parseMoneyInput(raw)
//       - Convert any input string to a non-negative integer.
//         Empty / non-numeric values come back as 0 instead of
//         NaN so the controlled input never flashes "NaN".
//
// Access Period (Days), Qty, and other non-money numeric fields
// intentionally do NOT use selectAllIfZero — typing into a
// 30-day default should not require a tap-to-select first.
export function selectAllIfZero(event) {
  const target = event?.target;
  if (!target || typeof target.select !== 'function') return;
  const raw = String(target.value ?? '').trim();
  if (raw === '' || Number(raw) === 0) {
    // Defer the select() so it runs after the focus has fully
    // settled — Safari/iOS otherwise drops the selection on the
    // very next paint when focus came from a tap.
    requestAnimationFrame(() => {
      try { target.select(); } catch { /* element unmounted */ }
    });
  }
}

export function parseMoneyInput(raw) {
  if (raw === '' || raw === null || raw === undefined) return 0;
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num);
}
