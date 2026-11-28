const STORAGE_KEY = 'starshots_use_last_name_v1';

function readMap() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage may be unavailable or full; the UI preference remains usable in memory.
  }
}

function normalizeKeys(keys = []) {
  return [...new Set((Array.isArray(keys) ? keys : [keys])
    .map((key) => String(key || '').trim())
    .filter(Boolean))];
}

export function readUseLastNamePref(keys = []) {
  const map = readMap();
  for (const key of normalizeKeys(keys)) {
    if (typeof map[key] === 'boolean') return map[key];
  }
  return false;
}

export function writeUseLastNamePref(keys = [], enabled = false) {
  const list = normalizeKeys(keys);
  if (!list.length) return;
  const map = readMap();
  const value = Boolean(enabled);
  for (const key of list) map[key] = value;
  writeMap(map);
}
