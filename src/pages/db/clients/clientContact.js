import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

// Format phone-only values using Google's maintained numbering metadata.
// Mixed contacts, email addresses, URLs, and social handles pass through
// untouched. "ID" is the default region for local numbers without +country.
const PHONE_ONLY = /^\+?[\d\s()./-]+$/;

export function formatClientContact(value, defaultCountry = 'ID') {
  const raw = String(value ?? '');
  const trimmed = raw.trim();
  if (!trimmed || !PHONE_ONLY.test(trimmed)) return raw;

  // WhatsApp exports sometimes omit the plus before Indonesia's country
  // code. Only bare 628... mobile strings are treated as +628...
  const compactDigits = trimmed.replace(/[\s()./-]/g, '');
  const parseValue = /^628\d+$/.test(compactDigits) ? '+' + compactDigits : trimmed;

  try {
    const phone = parsePhoneNumberFromString(parseValue, defaultCountry);
    if (!phone || !phone.isPossible()) return raw;

    // libphonenumber supplies the country-specific digit groups. Keep one
    // space after the calling code and use dashes between national groups
    // for the compact, consistent StarShots contact display.
    const groups = phone.formatInternational().split(/\s+/);
    return groups.length > 1
      ? groups[0] + ' ' + groups.slice(1).join('-')
      : groups[0];
  } catch {
    return raw;
  }
}
