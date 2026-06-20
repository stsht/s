// Slug / folder / preview-password generation for the /l Link Generator.
//
// Extracted verbatim from LinkGeneratorPage.jsx (Pass 70). These functions
// turn an operator-entered folder name into the canonical gallery slug and
// the folder-derived preview password. Their output is user-facing and must
// stay byte-identical to the legacy behaviour, so the bodies are unchanged.
// The worker still authoritatively regenerates the final password/shortCode
// server-side; the password here is only the pre-save preview hint.
import { normalizeFolderName, stripBracketed } from './linkHelpers.js';

// Small string helpers used by /l so the client preview matches the
// payload sent to the worker.
export function sanitizeSlugSegment(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Avoid lowercase l in generated gallery slugs.
    .replace(/l/g, '1')
    .replace(/["'\u2019`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function extractFolderParts(folder) {
  const normalized = normalizeFolderName(folder);
  const close = normalized.lastIndexOf(')');
  const head = close >= 0 ? normalized.slice(0, close + 1) : normalized;
  const suffix = close >= 0 ? normalized.slice(close + 1).trim() : '';
  const parts = stripBracketed(head).split(/\s+/).map(sanitizeSlugSegment).filter(Boolean);
  let date = '';
  let cursor = 0;
  if (/^\d{6}$/.test(parts[0] || '')) {
    date = parts[0];
    cursor = 1;
  } else if (/^\d{8}$/.test(parts[0] || '')) {
    date = parts[0].slice(2);
    cursor = 1;
  } else {
    const now = new Date();
    date =
      String(now.getFullYear()).slice(-2) +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');
  }
  const name = parts[cursor] || '';
  return { date, name, suffix: sanitizeSlugSegment(suffix), normalized };
}

export function buildBaseSlug(folder) {
  const parts = extractFolderParts(folder);
  if (!parts.name) return '';
  const arr = [parts.date, parts.name];
  if (parts.suffix && parts.suffix !== parts.name) arr.push(parts.suffix);
  return arr.join('-').slice(0, 64).replace(/-+$/, '');
}

export function buildFolderPassword(folder) {
  const parts = extractFolderParts(folder);
  const date = parts.date;
  // Preview password = DDMMYY + one deterministic digit derived from
  // the folder date. The worker still authoritatively returns the
  // final secure 7-char password after save.
  if (!/^\d{6}$/.test(date)) return '';
  const checksum = date.split('').reduce((sum, digit) => sum + Number(digit || 0), 0) % 10;
  return date.slice(4, 6) + date.slice(2, 4) + date.slice(0, 2) + String(checksum);
}
