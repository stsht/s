import { EmptyState } from '../../components/ui/index.js';
import { compactEventDateLabel } from './dbHelpers.js';
import { subscriptionTone } from './subs/subscriptionLogic.js';

const CLIENT_NAME_TONE_STYLE = {
  soon: { color: 'var(--evt-soon)' },
  future: { color: 'var(--evt-future)' },
  tba: { color: 'var(--evt-tba)' },
};

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

// Format the Subs-tab list meta from a subscription row. Produces
// just the service name, e.g. "ChatGPT" / "iCloud" / "Google Drive".
// The row already communicates state via two parallel surfaces — a
// tone-driven left-edge tint (subscriptionTone → .sub-active /
// .sub-warning / .sub-expired / .sub-tba) and the right-aligned
// expiry-date pill — so repeating the status word in the subtitle
// would be redundant. Falls back to "Subscription" when the row
// has no service name set, matching the empty-state language used
// elsewhere in the dashboard.
function formatSubscriptionMeta(sub = {}) {
  const service = String(sub.service || 'Subscription').trim();
  return service || 'Subscription';
}

function activityStatsLine(row = {}) {
  return [
    row.lastActivityDisplay ? `Last ${row.lastActivityDisplay}` : '',
    `${Number(row.visitors || 0)} visitors`,
    `${Number(row.opens || 0)} opens`,
    `${Number(row.clicks || 0)} clicks`,
  ].filter(Boolean).join(' · ');
}

// Inline X glyph used by every list/row delete control on /db.
// Stroke-only path so the icon picks up `currentColor`, which lets
// CSS swap idle/hover palettes without touching the SVG markup.
// Duplicated from DatabasePage (which keeps its own copy for the
// detail-panel delete controls) so the list component stays
// self-contained.
function DeleteIcon() {
  return (
    <svg
      className="row-delete-icon"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4 4 L12 12 M12 4 L4 12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg
      className="btn-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M5 20h14" />
    </svg>
  );
}

// /db left panel content: the search/tools row, Create Client / New
// Subscription / Import JPG actions, the status empty state, and the
// scrollable Clients/Subs list (rows, tone, date/expiry pill, and the
// permanent delete X). Pure presentation — selection and delete
// business logic stay in DatabasePage and arrive via onSelectRow /
// onDeleteRow. The shared left/right panel shell (WorkspacePanels)
// is intentionally NOT part of this component.
export function DatabaseList({
  tab,
  query,
  onQueryChange,
  status,
  activeRows,
  selected,
  clientToneByRowId,
  effectiveSubscription,
  onSelectRow,
  onDeleteRow,
  onCreateClient,
  onCreateSubscription,
  onImportSubscription,
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
            Create Client
          </button>
        ) : null}
        {tab === 'subs' ? (
          <div className="subs-list-actions">
            <button className="add-client-button" type="button" onClick={onCreateSubscription}>
              New Subscription
            </button>
            <button className="subs-import-icon-button" type="button" onClick={onImportSubscription} aria-label="Import JPG" title="Import JPG">
              <UploadIcon />
            </button>
          </div>
        ) : null}
      </div>
      {status ? <EmptyState>{status}</EmptyState> : null}
      <div className="db-list">
        {activeRows.slice(0, 80).map((row, index) => {
          const isClient = tab === 'clients';
          const isSub = tab === 'subs';
          const isActivity = tab === 'activity';
          const title = isActivity
            ? (row.client_name || row.name || 'Delivery')
            : row.client_name || row.name || row.title || row.slug;
          // Subs row tone reads off the EFFECTIVE subscription so a
          // recent extension can flip an "expired" base row back to
          // active. row.subscription is the canonical subscription
          // record that came down on /api/db.
          const subRecord = isSub ? (row.subscription || null) : null;
          const subEffective = subRecord ? effectiveSubscription(subRecord) : null;
          const subTone = subEffective ? subscriptionTone(subEffective) : '';
          // Subs row right-aligned expiry pill. Mirrors the Clients
          // date pill: same chrome / event-tone-* palette, same
          // {pill, X} grid column. effectiveSubscription has already
          // merged the latest extension on top of the base row, so
          // its expiry_date is the renewal-aware "current" expiry.
          // No extension → base subscription expiry. No expiry on
          // either → 'tba'. The compact label produces "14 Jun 2026"
          // and "TBA" so the column reads identically to Clients.
          const subExpiry = isSub ? String(subEffective?.expiry_date || '') : '';
          const subPillTone = isSub
            ? (subTone === 'expired' ? 'past' : subTone === 'active' ? 'future' : 'tba')
            : '';
          // Clients tab tone is computed above in sortedCrmClients
          // by walking the row's event_dates against today (WIB).
          // The tone drives the client name, subtle left edge, and
          // date pill. Settled past clients intentionally have no
          // tone so all three surfaces return to neutral.
          const clientToneInfo = isClient ? (clientToneByRowId.get(row.id) || null) : null;
          const clientTone = clientToneInfo?.tone || '';
          const clientToneClass = clientTone ? `event-tone-${clientTone}` : '';
          const clientNameStyle = isClient ? CLIENT_NAME_TONE_STYLE[clientTone] : undefined;
          const clientPillDate = clientToneInfo?.representativeDate || '';
          const clientPillTone = clientTone || (clientPillDate ? '' : 'tba');
          let meta = '';
          if (isClient) {
            const contact = row.contact || row.client_contact || '';
            meta = isHumanReadableContact(contact) ? contact : '';
          } else if (isSub && subRecord) {
            // Service subtitle reflects the BASE subscription identity,
            // not the latest extension's per-period snapshot. Tone and
            // the right-aligned expiry pill still read off subEffective
            // so renewal state stays current; only the service label is
            // pinned to the base subscription.
            meta = formatSubscriptionMeta(subRecord);
          }
          const rowId = row.id || `row-${index}`;
          const className = [
            'db-list-row',
            isActivity ? 'activity-row' : '',
            selected?.id === row.id ? 'active' : '',
            subTone ? `sub-${subTone}` : '',
            clientToneClass,
            isClient ? 'has-event-pill' : '',
            isSub ? 'has-event-pill' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const handleSelect = () => {
            onSelectRow(row);
          };
          const handleDelete = (event) => {
            onDeleteRow(row, event);
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
                <strong style={clientNameStyle}>{title || 'Untitled'}</strong>
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
              {isSub ? (
                <span
                  className={`event-date-pill event-tone-${subPillTone || 'tba'}`}
                  aria-label={`Expiry ${compactEventDateLabel(subExpiry)}`}
                >
                  {compactEventDateLabel(subExpiry)}
                </span>
              ) : null}
              {!isActivity ? (
                <button
                  type="button"
                  className="row-delete-x"
                  onClick={handleDelete}
                  aria-label={`Delete ${title || 'record'}`}
                >
                  <DeleteIcon />
                </button>
              ) : null}
            </div>
          );
        })}
        {!status && activeRows.length === 0 ? <EmptyState>{isActivityTab ? 'No recent activity yet.' : 'No records yet.'}</EmptyState> : null}
      </div>
    </>
  );
}
