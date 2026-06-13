import { useCallback, useEffect, useMemo, useState } from 'react';
import { WorkspacePanels } from '../../components/WorkspacePanels.jsx';
import { DatabaseList } from './DatabaseList.jsx';
import { Segmented, EmptyState, Combobox } from '../../components/ui/index.js';
import { rupiah } from '../../utils/rupiah.js';
import { useRemoteList } from './useRemoteList.js';
import {
  plainEventDate,
  jakartaTodayISO,
  classifyClientEvents,
  buildClientRecords,
  subscriptionTone,
  applySubscriptionExtension,
  pickLatestSubscriptionExtension,
} from './dbHelpers.js';
import { SubscriptionDetail } from './subs/SubscriptionDetail.jsx';
import { SubscriptionEdit } from './subs/SubscriptionEdit.jsx';
import { SubscriptionImport } from './subs/SubscriptionImport.jsx';
import { ClientDetail } from './clients/ClientDetail.jsx';
import { DeliveryDetail } from './delivery/DeliveryDetail.jsx';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function PageChrome() {
  // Removed: legacy /admin dashboard chrome. /db is now the workspace home;
  // /l, /subs migrated to WorkspacePanels. Kept as a placeholder to
  // preserve historical export shape during cleanup but no longer rendered.
  return null;
}

function ToolCard({ tool }) {
  return (
    <a className="tool-card" href={tool.href}>
      <span>{tool.eyebrow}</span>
      <strong>{tool.title}</strong>
      <p>{tool.body}</p>
      <em>Open</em>
    </a>
  );
}

export function AdminDashboard() {
  // /admin route removed; _redirects sends /admin → /db/. This export is
  // retained as a no-op fallback so any stray import resolves cleanly.
  return null;
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
        <input value={draft.contact} onChange={(event) => onChange({ ...draft, contact: event.target.value })} placeholder="Instagram / phone / email" />
      </label>
      <div className="client-actions">
        <button className="primary-button" type="submit">Save Client</button>
        <button className="ghost-button compact" type="button" onClick={onCancel}>Cancel</button>
      </div>
      {status ? <p className="client-status">{status}</p> : null}
    </form>
  );
}

function SaveIcon({ saving = false }) {
  return (
    <svg
      className={`btn-icon${saving ? ' is-saving' : ''}`}
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
      <path d="M5 3h12l2 2v16H5z" />
      <path d="M8 3v6h8V3" />
      <path d="M8 21v-7h8v7" />
      <path d="M14 6h1" />
    </svg>
  );
}

export function DatabasePage() {
  const [tab, setTab] = useState('clients');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({ title: 'Ms.', name: '', contact: '' });
  const [saveStatus, setSaveStatus] = useState('');
  const [mobileView, setMobileView] = useState('left');
  const endpoint = `/api/db${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`;
  const { data, status, refetch, refresh } = useRemoteList(endpoint);
  const rawClients = data?.clients || [];
  const invoices = data?.invoices || [];
  const subscriptions = data?.subscriptions || [];

  const effectiveSubscription = useCallback((sub) => {
    if (!sub || typeof sub !== 'object') return sub;
    const ext = sub.latest_extension || pickLatestSubscriptionExtension(sub.extensions);
    return applySubscriptionExtension(sub, ext);
  }, []);

  const clients = useMemo(() => {
    return [...rawClients].sort((a, b) => {
      const an = String(a?.name || a?.client_name || '').toLowerCase();
      const bn = String(b?.name || b?.client_name || '').toLowerCase();
      return an.localeCompare(bn);
    });
  }, [rawClients]);

  const subRows = useMemo(() => {
    return (Array.isArray(subscriptions) ? subscriptions : []).map((sub) => ({
      id: String(sub.id || ''),
      client_name: String(sub.client_name || '').trim(),
      client_title: String(sub.client_title || '').trim(),
      client_contact: String(sub.client_contact || '').trim(),
      subscription: sub,
    }));
  }, [subscriptions]);

  const crmClients = useMemo(() => {
    return clients.filter((c) => {
      const invoiceCount = Number(c?.invoice_count || 0);
      const deliveryCount = Number(c?.delivery_count || 0);
      const subscriptionCount = Number(c?.subscription_count || 0);
      const source = String(c?.source || '').toLowerCase();
      const hasInvoiceHistory =
        invoiceCount > 0 ||
        (Array.isArray(c?.invoice_ids) && c.invoice_ids.length > 0);
      const hasDeliveryHistory =
        deliveryCount > 0 ||
        (Array.isArray(c?.delivery_ids) && c.delivery_ids.length > 0);
      const hasCrmHistory = hasInvoiceHistory || hasDeliveryHistory;

      if (hasCrmHistory) return true;

      const isLegacyOrSubscriptionSource =
        source === 'legacy' ||
        source === 'subscription' ||
        source === 'subscriptions';
      if (isLegacyOrSubscriptionSource) return false;

      if (subscriptionCount > 0) return false;

      return source === 'client';
    });
  }, [clients]);

  const getSubscriptionById = useCallback((id) => {
    const cleanId = String(id || '').trim();
    if (!cleanId) return null;
    return subscriptions.find((sub) => String(sub?.id || '') === cleanId) || null;
  }, [subscriptions]);

  const deliveriesAll = data?.items || [];
  const todayIso = useMemo(() => jakartaTodayISO(), []);
  const eventDatesByClient = useCallback((client) => {
    const cid = String(client?.id || '').trim();
    const cname = String(client?.name || client?.client_name || '').trim().toLowerCase();
    const matches = (rec) => {
      const rid = String(rec?.client_id || '').trim();
      const rname = String(rec?.client_name || rec?.name || '').trim().toLowerCase();
      if (cid && rid && cid === rid) return true;
      return !!cname && !!rname && cname === rname;
    };
    const dates = [];
    for (const rec of invoices) {
      if (!matches(rec)) continue;
      const d = plainEventDate(rec?.event_date);
      if (d) dates.push(d);
    }
    for (const rec of deliveriesAll) {
      if (!matches(rec)) continue;
      const d = plainEventDate(rec?.event_date);
      if (d) dates.push(d);
    }
    return dates;
  }, [invoices, deliveriesAll]);

  const sortedCrmClients = useMemo(() => {
    const bucketOrder = { upcoming: 0, tba: 1, past: 2 };
    const annotated = crmClients.map((client) => {
      const dates = eventDatesByClient(client);
      const cls = classifyClientEvents(dates, todayIso);
      const records = buildClientRecords(client, invoices, deliveriesAll, todayIso);
      const deliveryRecords = records.filter((row) => !!row.delivery?.id);
      const clientWorkflowComplete =
        deliveryRecords.length > 0 &&
        deliveryRecords.every((row) => !!row.delivery?.delivery_done);
      const name = String(client?.name || client?.client_name || '').toLowerCase();
      return {
        client,
        ...cls,
        tone: clientWorkflowComplete ? '' : cls.tone,
        name,
      };
    });
    annotated.sort((a, b) => {
      const ba = bucketOrder[a.bucket] ?? 9;
      const bb = bucketOrder[b.bucket] ?? 9;
      if (ba !== bb) return ba - bb;
      if (a.bucket === 'upcoming') {
        return a.sortKey.localeCompare(b.sortKey);
      }
      if (a.bucket === 'past') {
        return b.sortKey.localeCompare(a.sortKey);
      }
      return a.name.localeCompare(b.name);
    });
    return annotated;
  }, [crmClients, eventDatesByClient, invoices, deliveriesAll, todayIso]);

  const clientToneByRowId = useMemo(() => {
    const map = new Map();
    for (const entry of sortedCrmClients) {
      map.set(entry.client?.id, {
        tone: entry.tone,
        representativeDate: entry.representativeDate,
      });
    }
    return map;
  }, [sortedCrmClients]);

  const sortedSubRows = useMemo(() => {
    function recencyKey(sub) {
      return String(
        sub?.expiry_date
        || sub?.payment_date
        || sub?.start_date
        || sub?.created_at
        || ''
      );
    }
    const annotated = subRows.map((row) => {
      const sub = row.subscription || null;
      const effective = sub ? effectiveSubscription(sub) : null;
      const tone = effective ? subscriptionTone(effective) : 'active';
      return {
        row,
        bucket: tone === 'expired' ? 1 : 0,
        key: recencyKey(effective || sub),
      };
    });
    annotated.sort((a, b) => {
      if (a.bucket !== b.bucket) return a.bucket - b.bucket;
      return b.key.localeCompare(a.key);
    });
    return annotated.map((entry) => entry.row);
  }, [subRows, effectiveSubscription]);

  const activeRows = tab === 'subs'
    ? sortedSubRows
    : sortedCrmClients.map((entry) => entry.client);
  const selectedClient = selected?.type === 'client' ? clients.find((client) => client.id === selected.id) || selected.data : null;
  const selectedSubscription = (selected?.type === 'subscription' || selected?.type === 'subs-edit')
    ? (getSubscriptionById(selected.id) || selected.data?.subscription || null)
    : null;

  const selectedDelivery = useMemo(() => {
    if (selected?.type !== 'delivery') return null;
    const id = String(selected.id || '');
    const fresh = (data?.items || []).find((d) => String(d?.id || '') === id);
    return fresh || selected.data || null;
  }, [selected, data]);

  const back = useCallback(() => {
    setSelected((cur) => {
      if (!cur) {
        setMobileView('left');
        return null;
      }
      if (cur.parent) {
        return cur.parent;
      }
      setMobileView('left');
      return null;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') back();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [back]);

  useEffect(() => {
    if (selected) setMobileView('right');
  }, [selected]);

  async function saveClient(event) {
    event.preventDefault();
    if (!draft.name.trim()) {
      setSaveStatus('Client name required.');
      return;
    }

    const isEdit = selected?.type === 'client-edit';
    const editSource = isEdit ? (selected?.data || {}) : {};
    const editId = isEdit ? String(editSource.id || editSource.client_id || '') : '';
    const groupedInvoiceIds = Array.isArray(editSource.invoice_ids) ? editSource.invoice_ids : [];
    const groupedDeliveryIds = Array.isArray(editSource.delivery_ids) ? editSource.delivery_ids : [];

    setSaveStatus('Saving...');
    try {
      const payload = isEdit
        ? {
            ...draft,
            ...(editId && !editId.startsWith('legacy:') ? { id: editId } : {}),
            invoiceIds: groupedInvoiceIds,
            deliveryIds: groupedDeliveryIds,
          }
        : draft;
      const response = await fetch('/api/clients-save', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || 'Save failed.');
      if (isEdit) {
        setSaveStatus('');
        back();
        refetch();
      } else {
        window.location.reload();
      }
    } catch (error) {
      setSaveStatus(error.message || 'Save failed.');
    }
  }

  function openNewClient() {
    setTab('clients');
    setDraft({ title: 'Ms.', name: query.trim(), contact: '' });
    setSaveStatus('');
    setSelected({ type: 'new' });
  }

  function openImportSubscription() {
    setTab('subs');
    setSelected({ type: 'subs-import' });
  }

  function openCreateSubscription() {
    setTab('subs');
    setSelected({ type: 'subs-create' });
    setMobileView('right');
  }

  async function deleteClient(client) {
    if (!client) return;
    const id = String(client.id || client.client_id || '');
    const name = String(client.name || client.client_name || '');
    if (!id && !name) return;
    try {
      const response = await fetch('/api/clients-delete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || 'Delete failed.');
      setSelected(null);
      setMobileView('left');
      refetch();
    } catch (error) {
      console.warn('[db] client delete failed:', error);
      setSaveStatus(error?.message || 'Delete failed.');
    }
  }

  async function deleteRecord({ kind, id, deliveryId, invoiceId }) {
    let endpointPath = '';
    let body = null;
    if (kind === 'subscription') {
      endpointPath = '/api/subscriptions-delete';
      body = { id };
    } else if (kind === 'invoice') {
      endpointPath = '/api/invoices-delete';
      body = { id };
    } else if (kind === 'delivery') {
      endpointPath = '/api/db-delete';
      body = { id };
    } else if (kind === 'event') {
      if (deliveryId) {
        await fetch('/api/db-delete', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: deliveryId }),
        }).catch((error) => console.warn('[db] event delivery delete failed:', error));
      }
      if (invoiceId) {
        await fetch('/api/invoices-delete', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: invoiceId }),
        }).catch((error) => console.warn('[db] event invoice delete failed:', error));
      }
      refetch();
      return;
    } else {
      return;
    }

    try {
      const response = await fetch(endpointPath, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json.ok) throw new Error(json.error || 'Delete failed.');
      if (selected?.id === id) setSelected(null);
      refetch();
    } catch (error) {
      console.warn('[db] record delete failed:', error);
    }
  }

  const tabs = [
    { value: 'clients', label: 'Clients' },
    { value: 'subs', label: 'Subs' },
  ];

  const tabHeading =
    tab === 'subs' ? 'Subscriptions' : 'Choose A Client';

  const handleSelectRow = (row) => {
    if (tab === 'subs') {
      setSelected({ type: 'subscription', id: row.id, data: row });
    } else if (tab === 'clients') {
      setSelected({ type: 'client', id: row.id, data: row });
    } else {
      setSelected({ type: tab, id: row.id, data: row });
    }
  };

  const handleDeleteRow = (row, event) => {
    event.stopPropagation();
    if (tab === 'subs') {
      if (row.id) {
        deleteRecord({ kind: 'subscription', id: row.id });
        if (selected?.type === 'subscription' && selected.id === row.id) {
          setSelected(null);
          setMobileView('left');
        }
      }
    } else if (tab === 'clients') {
      deleteClient(row);
    }
  };

  const left = (
    <DatabaseList
      tab={tab}
      query={query}
      onQueryChange={setQuery}
      status={status}
      activeRows={activeRows}
      selected={selected}
      clientToneByRowId={clientToneByRowId}
      effectiveSubscription={effectiveSubscription}
      onSelectRow={handleSelectRow}
      onDeleteRow={handleDeleteRow}
      onCreateClient={openNewClient}
      onCreateSubscription={openCreateSubscription}
      onImportSubscription={openImportSubscription}
    />
  );

  const right = (
    <>
      {status ? <EmptyState>{status}</EmptyState> : null}
      {!selected && !status ? <h2>{tabHeading}</h2> : null}
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
      {selected?.type === 'subscription' ? (
        <SubscriptionDetail
          client={selected.data || {}}
          subscription={selectedSubscription}
          onEdit={(sub) => {
            if (!sub?.id) return;
            const parent = selected;
            setSelected({
              type: 'subs-edit',
              id: selected.id,
              data: selected.data,
              parent,
            });
          }}
          onDeleteSubscription={(sub) => {
            if (!sub?.id) return;
            deleteRecord({ kind: 'subscription', id: sub.id });
            setSelected(null);
            setMobileView('left');
          }}
          onChanged={refetch}
          onClose={back}
        />
      ) : null}
      {selected?.type === 'subs-edit' ? (
        <SubscriptionEdit
          subscription={selectedSubscription}
          onSaved={(saved) => {
            refetch();
            const parent = selected?.parent || null;
            const savedId = String(saved?.id || parent?.id || selected?.id || '');
            if (saved && savedId) {
              setSelected({
                type: 'subscription',
                id: savedId,
                data: {
                  ...(parent?.data || {}),
                  id: savedId,
                  client_name: String(saved.client_name ?? parent?.data?.client_name ?? ''),
                  client_title: String(saved.client_title ?? parent?.data?.client_title ?? ''),
                  client_contact: String(saved.client_contact ?? parent?.data?.client_contact ?? ''),
                  subscription: saved,
                },
                parent: parent?.parent || null,
              });
            } else {
              back();
            }
          }}
          onCancel={back}
        />
      ) : null}
      {selected?.type === 'subs-import' ? (
        <SubscriptionImport
          onSaved={() => {
            refetch();
          }}
          onCancel={back}
        />
      ) : null}
      {selected?.type === 'subs-create' ? (
        <SubscriptionEdit
          subscription={null}
          mode="create"
          onSaved={(saved) => {
            refetch();
            const newId = String(saved?.id || '');
            if (newId) {
              setSelected({
                type: 'subscription',
                id: newId,
                data: {
                  id: newId,
                  client_name: String(saved?.client_name || ''),
                  client_title: String(saved?.client_title || ''),
                  client_contact: String(saved?.client_contact || ''),
                  subscription: saved,
                },
              });
            } else {
              setSelected(null);
              setMobileView('left');
            }
          }}
          onCancel={back}
        />
      ) : null}
      {selected && !selectedClient && selected.type !== 'new' && selected.type !== 'client-edit' && selected.type !== 'subscription' && selected.type !== 'subs-import' && selected.type !== 'subs-edit' && selected.type !== 'subs-create' && selected.type !== 'delivery' ? (
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

  return (
    <WorkspacePanels
      active="/db/"
      showNav={false}
      pills={
        <Segmented
          value={tab}
          onChange={(next) => {
            refetch();
            if (next !== tab) {
              setTab(next);
              setSelected(null);
              setMobileView('left');
            }
          }}
          options={tabs}
          ariaLabel="Database section"
        />
      }
      left={left}
      right={right}
      mobileView={mobileView}
      onMobileViewChange={(view) => {
        if (view === 'left') setSelected(null);
        setMobileView(view);
      }}
      mobileTabs={{ left: 'List', right: 'Detail' }}
    />
  );
}
