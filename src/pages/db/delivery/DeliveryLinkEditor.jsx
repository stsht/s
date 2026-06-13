import { DateTimeField } from '../../../components/ui/index.js';
import { SERVICE_LABELS } from './deliveryHelpers.js';

export function DeliveryLinkEditor({
  linkDraft,
  setLinkDraft,
  savingLinks,
  repairStatus,
  handleSaveLinks,
  setEditingLinks,
}) {
  return (
            <form className="dd-link-editor" onSubmit={handleSaveLinks}>
              <p className="eyebrow">Edit Links</p>
              <div className="dd-link-fields">
                <label key="folderName">
                  <span>Folder Name</span>
                  <input
                    type="text"
                    value={linkDraft.folderName || ''}
                    onChange={(event) => setLinkDraft((draft) => ({ ...draft, folderName: event.target.value }))}
                    placeholder="e.g. 260524 Sahputra, Mr. ( Birthday )"
                  />
                </label>
                <label key="eventDate">
                  <span>Event Date</span>
                  <DateTimeField
                    value={linkDraft.eventDate || ''}
                    onChange={(value) => setLinkDraft((draft) => ({ ...draft, eventDate: value }))}
                    ariaLabel="Event date"
                  />
                </label>
                {SERVICE_LABELS.map(({ key, label }) => (
                  <div key={key} className="dd-link-field-row" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ color: 'var(--muted)', fontSize: '11px', fontWeight: 900 }}>{label}</span>
                    <input
                      type="url"
                      value={linkDraft[key] || ''}
                      onChange={(event) => setLinkDraft((draft) => ({ ...draft, [key]: event.target.value }))}
                      placeholder="https://..."
                    />
                  </div>
                ))}
              </div>
              <div className="dd-message-actions">
                <button type="submit" className="ghost-button compact" disabled={savingLinks}>
                  {savingLinks ? 'Saving...' : 'Save Links'}
                </button>
                <button type="button" className="ghost-button compact" onClick={() => setEditingLinks(false)}>
                  Cancel
                </button>
              </div>
              {repairStatus ? <span className="dd-card-hint">{repairStatus}</span> : null}
            </form>
  );
}
