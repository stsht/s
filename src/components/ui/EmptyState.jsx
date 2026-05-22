/**
 * EmptyState
 *
 * Standard muted message for empty lists, missing selections,
 * or "no records yet" states across the workspace.
 *
 * Renders the existing .empty-state style defined in invcs.css.
 */
export function EmptyState({ children }) {
  return <p className="empty-state">{children}</p>;
}
