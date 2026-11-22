import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '../../components/ui/index.js';
import { compactEventDateLabel } from './dbHelpers.js';
import { formatClientContact } from './clients/clientContact.js';

// Whether a string is a contact value worth showing under a client
// row. Used by /db's left list to scrub raw timestamps (e.g.
// "2026-05-17T13:08:21.123Z") and other non-contact metadata that
// previously leaked into the visible meta line. Accepts only the
// three shapes the design calls out: phone, Instagram handle/URL,
// or email. Anything else (ISO dates, normalized slugs, empty
// strings) is rejected and the meta line is hidden.
function isHumanReadableContact(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  // Discard timestamp-shaped strings outright. Both the full ISO
  // form and bare YYYY-MM-DD count — the dashboard never wants
  // these on a client card.
  if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(v)) return false;
  // Email — at least one '@' separating two non-empty halves.
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return true;
  // Instagram — handle (@name) or full instagram.com URL.
  if (/^@[a-zA-Z0-9._]+$/.test(v)) return true;
  if (/instagram\.com\//i.test(v)) return true;
  // Bare IG handles from existing rows, e.g. "lisofan". Require at
  // least one letter so numeric IDs/dates do not masquerade as contact.
  if (/^(?=.*[a-zA-Z])[a-zA-Z0-9._]{2,30}$/.test(v)) return true;
  // Phone — digits with optional +, spaces, dashes, parens. At
  // least 6 digits in total so 4-digit years can't masquerade.
  const digits = v.replace(/[^\d]/g, '');
  if (digits.length >= 6 && /^\+?[\d\s\-().]+$/.test(v)) return true;
  return false;
}

function activityStatsLine(row = {}) {
  return [
    row.lastActivityDisplay ? `Latest ${row.lastActivityDisplay}` : '',
    `${Number(row.visitors || 0)} visitors`,
    `${Number(row.opens || 0)} opens`,
    `${Number(row.clicks || 0)} clicks`,
  ].filter(Boolean).join(' · ');
}

// /db left panel content: search/tools, Create Client, status, and
// the scrollable Clients list with event-date pills. Pure presentation —
// selection and delete logic arrive via onSelectRow / onDeleteRow.
export function DatabaseList({
  tab,
  query,
  onQueryChange,
  status,
  activeRows,
  selected,
  clientToneByRowId,
  onSelectRow,
  onDeleteRow,
  onCreateClient,
}) {
  const isActivityTab = tab === 'activity';
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef(null);
  const showSearch = searchOpen || Boolean(query);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  useEffect(() => {
    if (!query) setSearchOpen(false);
  }, [tab]);

  function handleCloseSearch() {
    if (query) onQueryChange('');
    setSearchOpen(false);
  }
  return (
    <>
      <div className="pf-list-tools db-minimal-tools">
        {showSearch ? (
          <div className="db-search-bar">
            <svg className="db-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              className="pf-search db-search-input"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') handleCloseSearch();
              }}
              placeholder={isActivityTab ? 'Search activity…' : 'Search clients…'}
              type="search"
              aria-label={isActivityTab ? 'Search activity' : 'Search clients'}
            />
            <button
              type="button"
              className="db-tool-icon-btn"
              onClick={handleCloseSearch}
              aria-label="Close search"
              title="Close search"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="db-tools-row">
            <span className="db-tools-label">
              {isActivityTab ? 'Activity' : 'Clients'}{activeRows.length ? ` · ${activeRows.length}` : ''}
            </span>
            <div className="db-tools-actions">
              <button
                type="button"
                className="db-tool-icon-btn"
                onClick={() => setSearchOpen(true)}
                aria-label={isActivityTab ? 'Search activity' : 'Search clients'}
                title="Search"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </button>
              {tab === 'clients' ? (
                <button
                  className="db-tool-icon-btn"
                  type="button"
                  onClick={onCreateClient}
                  aria-label="New client"
                  title="New Client"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <line x1="19" y1="8" x2="19" y2="14" />
                    <line x1="16" y1="11" x2="22" y2="11" />
                  </svg>
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
      {status ? <EmptyState>{status}</EmptyState> : null}
      <div className="db-list">
        {activeRows.slice(0, 80).map((row, index) => {
          const isClient = tab === 'clients';
          const isActivity = tab === 'activity';
          const title = isActivity
            ? (row.client_name || row.name || 'Delivery')
            : row.client_name || row.name || row.title || row.slug;
          // Clients tab tone is computed above in sortedCrmClients
          // by walking the row's event_dates against today (WIB).
          // The tone drives the client name, subtle left edge, and
          // date pill. Settled past clients intentionally have no
          // tone so all three surfaces return to neutral.
          const clientToneInfo = isClient ? (clientToneByRowId.get(row.id) || null) : null;
          const clientTone = clientToneInfo?.tone || '';
          const clientToneClass = clientTone ? `event-tone-${clientTone}` : '';
          const clientPillDate = clientToneInfo?.representativeDate || '';
          const clientPillTone = clientTone || (clientPillDate ? '' : 'tba');
          let meta = '';
          if (isClient) {
            const contact = row.contact || row.client_contact || '';
            meta = isHumanReadableContact(contact) ? formatClientContact(contact) : '';
          }
          const rowId = row.id || `row-${index}`;
          const className = [
            'db-list-row',
            isActivity ? 'activity-row' : '',
            selected?.id === row.id ? 'active' : '',
            clientToneClass,
            isClient ? 'has-event-pill' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const handleSelect = () => {
            onSelectRow(row);
          };
          return (
            <div
              className={className}
              key={rowId}
              onClick={handleSelect}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleSelect();
                }
              }}
            >
              <div className="db-list-row-text">
                <strong>{title || 'Untitled'}</strong>
                {isActivity ? (
                  <>
                    {row.folder_name ? <span className="activity-folder-line" title={row.folder_name}>{row.folder_name}</span> : null}
                    <span className="activity-action-line">{row.lastActivityLabel || 'Latest activity'}</span>
                    <span className="activity-stats-line">{activityStatsLine(row)}</span>
                  </>
                ) : meta ? <span>{meta}</span> : null}
              </div>
              {isClient ? (
                <span
                  className={`event-date-pill${clientPillTone ? ` event-tone-${clientPillTone}` : ''}`}
                  aria-label={`Event ${compactEventDateLabel(clientPillDate)}`}
                >
                  {compactEventDateLabel(clientPillDate)}
                </span>
              ) : null}
            </div>
          );
        })}
        {!status && activeRows.length === 0 ? <EmptyState>{isActivityTab ? 'No recent activity yet.' : 'No records yet.'}</EmptyState> : null}
      </div>
    </>
  );
}
