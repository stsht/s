// Display title-case helper shared by /subs and /inv.
//
// Rules:
//   - First letter of each word is capitalised.
//   - Connector words (to, of, in, at, on, and, or, for, with, without,
//     via) stay lowercase mid-phrase. The very first word is always
//     capitalised regardless.
//   - Curated brand/acronym tokens (ChatGPT, iCloud, IDR, QR, USB, GB,
//     TB, URL, Copilot, StarShots, Mr., Ms., Mrs., Dr.) are preserved
//     in their canonical casing, regardless of how the user typed them.
//   - Tokens that are already entirely uppercase (>= 2 letters) are
//     preserved as-is. Numbers, punctuation, and mixed identifier
//     strings are left alone via maybeTitleCase().
//
// The helper is display-only — call sites pass through the editor
// state on render or normalise on blur, never on every keystroke, so
// the input field always echoes what the user typed verbatim.

const SMALL_WORDS = new Set([
  'to', 'of', 'in', 'at', 'on', 'and', 'or', 'for', 'with', 'without', 'via',
]);

const PRESERVE_TOKENS = [
  'ChatGPT', 'iCloud', 'IDR', 'QR', 'USB', 'GB', 'TB', 'URL',
  'Copilot', 'StarShots',
  'Mr.', 'Ms.', 'Mrs.', 'Dr.',
];

const PRESERVE_LOOKUP = new Map(
  PRESERVE_TOKENS.map((token) => [token.toLowerCase(), token]),
);

export function toTitleCase(value) {
  if (typeof value !== 'string' || !value) return value;
  // Preserve internal whitespace runs by capturing them in the split.
  const parts = value.split(/(\s+)/);
  let seenWord = false;
  return parts
    .map((part) => {
      if (!part || /^\s+$/.test(part)) return part;
      const isFirst = !seenWord;
      seenWord = true;

      // Whole-token preserve first — handles bare "ChatGPT", "iCloud",
      // "Mr.", etc. matched case-insensitively.
      const preservedWhole = PRESERVE_LOOKUP.get(part.toLowerCase());
      if (preservedWhole) return preservedWhole;

      // Split the token into leading punctuation, the core letters/
      // digits/dot/dash/apostrophe, and trailing punctuation. This
      // lets "ChatGPT," and "(iCloud)" round-trip cleanly while still
      // checking the lowercase core against the preserve lookup.
      const match = part.match(/^(\W*)([\w'.\-]+?)(\W*)$/);
      if (!match) return part;
      const [, lead, core, trail] = match;

      const lowerCore = core.toLowerCase();
      const preservedCore = PRESERVE_LOOKUP.get(lowerCore);
      if (preservedCore) return `${lead}${preservedCore}${trail}`;

      // All-caps acronyms (>= 2 letters) keep their casing as typed.
      const letters = core.replace(/[^A-Za-z]/g, '');
      if (letters.length >= 2 && letters === letters.toUpperCase()) {
        return part;
      }

      // Connector words drop to lowercase only when they're not the
      // leading word of the phrase.
      if (!isFirst && SMALL_WORDS.has(lowerCore)) {
        return `${lead}${lowerCore}${trail}`;
      }

      // Capitalise the first letter of the core; lowercase the rest.
      const firstLetterIndex = core.search(/[A-Za-z]/);
      if (firstLetterIndex === -1) return part; // pure number / punct
      const formatted =
        core.slice(0, firstLetterIndex) +
        core.charAt(firstLetterIndex).toUpperCase() +
        core.slice(firstLetterIndex + 1).toLowerCase();
      return `${lead}${formatted}${trail}`;
    })
    .join('');
}

// maybeTitleCase: title-case unless the value looks like a raw
// identifier we shouldn't mangle (URL, email, IG/social handle,
// phone number). Used on contact-style inputs so "0812..." or
// "name@email.com" or "@starshots.id" round-trip unchanged while a
// plain "kornelius" still becomes "Kornelius".
export function maybeTitleCase(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (/^https?:/i.test(trimmed)) return value;
  if (/[@]/.test(trimmed)) return value;
  if (/^\+?\d[\d\s\-().]*$/.test(trimmed)) return value;
  return toTitleCase(value);
}

// onBlurTitleCase: factory for input onBlur handlers. Reads the
// input value from the event target, trims surrounding whitespace,
// and calls the provided setter only when title-casing changed the
// string. Skipping the setter when the value is identical avoids
// triggering an unnecessary re-render or invalidating downstream
// effects.
export function onBlurTitleCase(setter) {
  return (event) => {
    const raw = event.target.value;
    const trimmed = raw.trim();
    const next = maybeTitleCase(trimmed);
    if (next !== raw) setter(next);
  };
}
