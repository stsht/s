import { WorkspacePanels } from '../../components/WorkspacePanels.jsx';
import { DatabaseList } from './DatabaseList.jsx';
import { Segmented } from '../../components/ui/index.js';
import { DatabaseRightPanel } from './DatabaseRightPanel.jsx';
import { useDatabasePageState } from './useDatabasePageState.js';

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
  const {
    tab,
    setTab,
    query,
    setQuery,
    selected,
    setSelected,
    draft,
    setDraft,
    saveStatus,
    setSaveStatus,
    mobileView,
    setMobileView,
    data,
    status,
    refetch,
    refresh,
    invoices,
    activeRows,
    clientToneByRowId,
    effectiveSubscription,
    selectedClient,
    selectedSubscription,
    selectedDelivery,
    back,
    saveClient,
    openNewClient,
    openImportSubscription,
    openCreateSubscription,
    deleteClient,
    deleteRecord,
    handleSelectRow,
    handleDeleteRow,
  } = useDatabasePageState();

  const tabs = [
    { value: 'clients', label: 'Clients' },
    { value: 'subs', label: 'Subs' },
  ];

  const tabHeading =
    tab === 'subs' ? 'Subscriptions' : 'Choose A Client';

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
    <DatabaseRightPanel
      status={status}
      tabHeading={tabHeading}
      selected={selected}
      selectedClient={selectedClient}
      selectedDelivery={selectedDelivery}
      selectedSubscription={selectedSubscription}
      draft={draft}
      setDraft={setDraft}
      saveStatus={saveStatus}
      setSaveStatus={setSaveStatus}
      back={back}
      saveClient={saveClient}
      deleteClient={deleteClient}
      deleteRecord={deleteRecord}
      refetch={refetch}
      refresh={refresh}
      setSelected={setSelected}
      setMobileView={setMobileView}
      data={data}
      invoices={invoices}
    />
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
