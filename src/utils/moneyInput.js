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
  // Strip everything but digits before parsing. This makes the field
  // robust against stray characters AND collapses any leading zeros
  // (e.g. "090000" → 90000, "09" → 9) so a default-0 field that the
  // operator types into never sticks a leading zero on the value.
  const digits = String(raw).replace(/[^0-9]/g, '');
  if (digits === '') return 0;
  const num = Number(digits);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num);
}

// Display helper for IDR number fields rendered as type="text"
// inputs. A stored 0 (or empty) shows as an empty string so the
// field reads as a placeholder while typing instead of a sticky
// visible "0" the operator has to clear — and a leading zero can
// never appear because the visible value is always derived from the
// parsed integer, not the raw keystrokes.
export function moneyInputValue(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? String(num) : '';
}
