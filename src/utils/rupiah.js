// Shared IDR currency formatter. Extracted so subscription card
// modules can render amounts identically to WorkspacePages.jsx
// without re-declaring the helper (and without importing back from
// WorkspacePages.jsx, which would create a circular dependency).
export function rupiah(value) {
  const number = Number(value) || 0;
  return `Rp ${Math.round(number).toLocaleString('id-ID')}`;
}
