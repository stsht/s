import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

// Format phone-only values using Google's maintained numbering metadata.
// Mixed contacts, email addresses, URLs, and social handles pass through
// untouched. "ID" is the default region for local numbers without +country.
const PHONE_ONLY = /^\+?[\d\s()./-]+$/;

export function formatClientContact(value, defaultCountry = 'ID') {
  const raw = String(value ?? '');
  const trimmed = raw.trim();
  if (!trimmed || !PHONE_ONLY.test(trimmed)) return raw;

  try {
    const phone = parsePhoneNumberFromString(trimmed, defaultCountry);
    if (!phone || !phone.isPossible()) return raw;
    return phone.formatInternational();
  } catch {
    return raw;
  }
}
