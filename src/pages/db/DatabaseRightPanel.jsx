import { EmptyState, Combobox } from '../../components/ui/index.js';
import { rupiah } from '../../utils/rupiah.js';
import { formatClientContact } from './clients/clientContact.js';
import { ClientDetail } from './clients/ClientDetail.jsx';
import { DeliveryDetail } from './delivery/DeliveryDetail.jsx';
import { ActivityDetail } from './activity/ActivityDetail.jsx';

const TITLE_OPTIONS = ['Mr.', 'Ms.', 'Mrs.', 'Family'];

function ClientForm({ draft, onChange, onCancel, onSave, status }) {
  return (
    <form className="client-form" onSubmit={onSave}>
      <div className="client-form-grid">
        <label>Title
          <Combobox
            value={draft.title}
            options={TITLE_OPTIONS}
            placeholder="Title"
            ariaLabel="Client title"
            onChange={(value) => onChange({ ...draft, title: value })}
          />
        </label>
        <label>Name
          <input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="Client name" />
        </label>
      </div>
      <label>Contact
        <input value={draft.contact} onChange={(event) => onChange({ ...draft, contact: event.target.value })} onBlur={(event) => { const contact = formatClientContact(event.target.value); if (contact !== event.target.value) onChange({ ...draft, contact }); }} placeholder="Instagram / phone / email" />
      </label>
      <div className="client-actions">
        <button className="primary-button" type="submit">Save Client</button>
        <button className="ghost-button compact" type="button" onClick={onCancel}>Cancel</button>
      </div>
      {status ? <p className="client-status">{status}</p> : null}
    </form>
  );
}

function ListRow({ title, meta, amount }) {
  return (
    <article className="list-row">
      <div>
        <strong>{title || 'Untitled'}</strong>
        <span>{meta || 'No details yet'}</span>
      </div>
      {amount ? <b>{amount}</b> : null}
    </article>
  );
}

export function DatabaseRightPanel({
  status,
  tabHeading,
  selected,
  selectedClient,
  selectedDelivery,
  draft,
  setDraft,
  saveStatus,
  setSaveStatus,
  back,
  saveClient,
  deleteClient,
  deleteRecord,
  refetch,
  refresh,
  setSelected,
  data,
  invoices,
}) {
  return (
    <>
      {status ? <EmptyState>{status}</EmptyState> : null}
      {!selected && !status ? <h2>{tabHeading}</h2> : null}
      {selected?.type === 'activity' ? (
        <ActivityDetail
          activity={selected.data || {}}
          onClose={back}
          onRefresh={refetch}
        />
      ) : null}
      {selected?.type === 'new' ? (
        <>
          <h2>Create Client</h2>
          <ClientForm
            draft={draft}
            onChange={setDraft}
            onCancel={back}
            onSave={saveClient}
            status={saveStatus}
          />
        </>
      ) : null}
      {selected?.type === 'client-edit' ? (
        <>
          <div className="detail-heading">
            <div>
              <p className="eyebrow">Edit Client</p>
              <h2>{draft.name || selected?.data?.name || selected?.data?.client_name || 'Client'}</h2>
            </div>
            <div className="detail-actions">
              <button
                type="button"
                className="db-close-button"
                onClick={back}
                aria-label="Close edit form"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
          <ClientForm
            draft={draft}
            onChange={setDraft}
            onCancel={back}
            onSave={saveClient}
            status={saveStatus}
          />
        </>
      ) : null}
      {selectedClient ? (
        <ClientDetail
          client={selectedClient}
          invoices={invoices}
          deliveries={data?.items || []}
          onDeleteClient={deleteClient}
          onEditClient={(clientRow) => {
            if (!clientRow) return;
            const parent = selected;
            setDraft({
              title: String((clientRow.title || clientRow.client_title) ?? 'Ms.'),
              name: String(clientRow.name || clientRow.client_name || ''),
              contact: String(clientRow.contact || clientRow.client_contact || ''),
            });
            setSaveStatus('');
            setSelected({
              type: 'client-edit',
              id: clientRow.id,
              data: clientRow,
              parent,
            });
          }}
          onDeleteRecord={(row) =>
            deleteRecord({
              kind: 'event',
              deliveryId: row?.delivery?.id || '',
              invoiceId: row?.invoice?.id || '',
            })
          }
          onViewLinks={(deliveryRow) => {
            if (!deliveryRow?.id) return;
            const parent = selected;
            setSelected({
              type: 'delivery',
              id: deliveryRow.id,
              data: deliveryRow,
              fromClient: selectedClient,
              parent,
            });
          }}
          onRefresh={refetch}
          onClose={back}
        />
      ) : null}
      {selected?.type === 'delivery' ? (
        <DeliveryDetail
          delivery={selectedDelivery || {}}
          onRepaired={(repaired) => {
            setSelected((cur) => cur?.type === 'delivery'
              ? { ...cur, data: repaired }
              : cur);
            refetch();
          }}
          onRefresh={refresh}
          onDeleted={() => {
            back();
            refetch();
          }}
          onClose={back}
        />
      ) : null}
      {selected && !selectedClient && selected.type !== 'new' && selected.type !== 'client-edit' && selected.type !== 'delivery' && selected.type !== 'activity' ? (
        <>
          <div className="list-stack">
            <ListRow
              title={
                selected.data?.client_name ||
                selected.data?.name ||
                selected.data?.title ||
                selected.data?.service
              }
              meta={
                selected.data?.client_contact ||
                selected.data?.contact ||
                selected.data?.status ||
                selected.data?.updated_at
              }
              amount={
                selected.data?.total || selected.data?.grand_total || selected.data?.price
                  ? rupiah(
                      selected.data.total || selected.data.grand_total || selected.data.price,
                    )
                  : ''
              }
            />
          </div>
        </>
      ) : null}
    </>
  );
}
