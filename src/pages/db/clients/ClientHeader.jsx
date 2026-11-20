import { useEffect, useRef, useState } from 'react';
import { RefreshIcon, EditIcon } from '../dbIcons.jsx';

// Client detail heading: editorial minimalist header with quiet
// borderless icons and an overflow menu for Delete Client.
export function ClientHeader({ name, onRefresh, onEdit, onDelete, onClose, children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const handleOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleOutside);
    return () => document.removeEventListener('pointerdown', handleOutside);
  }, [menuOpen]);

  return (
    <div className="detail-heading client-detail-heading">
      <div className="client-detail-identity">
        <p className="eyebrow">Client</p>
        <h2>{name}</h2>
        {children}
      </div>
      <div className="detail-actions client-detail-actions" ref={menuRef}>
        <button
          type="button"
          className="toolbar-icon-btn client-quiet-icon"
          onClick={onRefresh}
          aria-label="Refresh client detail"
          title="Refresh"
        >
          <RefreshIcon />
        </button>
        <button
          type="button"
          className="toolbar-icon-btn client-quiet-icon"
          onClick={onEdit}
          aria-label="Edit client"
          title="Edit"
        >
          <EditIcon />
        </button>
        <button
          type="button"
          className="toolbar-icon-btn client-quiet-icon"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-label="More client actions"
          title="More"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="1.2" />
            <circle cx="19" cy="12" r="1.2" />
            <circle cx="5" cy="12" r="1.2" />
          </svg>
        </button>
        <button
          type="button"
          className="db-close-button"
          onClick={onClose}
          aria-label="Close detail view"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        {menuOpen ? (
          <div className="client-overflow-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="client-overflow-item is-danger"
              onClick={() => {
                setMenuOpen(false);
                onDelete?.();
              }}
            >
              Delete Client
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
