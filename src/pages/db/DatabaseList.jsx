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
  return (
    <>
      <div className="pf-list-tools">
        <input
          className="pf-search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={isActivityTab ? 'Search activity' : 'Search'}
          type="search"
          aria-label="Search database"
        />
        {tab === 'clients' ? (
          <button className="add-client-button" type="button" onClick={onCreateClient}>
            + New Client
          </button>
        ) : null}
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
