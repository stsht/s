import { WorkspacePanels } from '../../components/WorkspacePanels.jsx';
import { DatabaseList } from './DatabaseList.jsx';
import { Segmented } from '../../components/ui/index.js';
import { DatabaseRightPanel } from './DatabaseRightPanel.jsx';
import { useDatabasePageState } from './useDatabasePageState.js';

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
    selectedClient,
    selectedDelivery,
    back,
    saveClient,
    openNewClient,
    deleteClient,
    deleteRecord,
    handleSelectRow,
    handleDeleteRow,
  } = useDatabasePageState();

  const tabs = [
    { value: 'clients', label: 'Clients' },
    { value: 'activity', label: 'Activity' },
  ];

  const tabHeading = tab === 'activity' ? 'Recent Activity' : 'Choose A Client';

  const left = (
    <DatabaseList
      tab={tab}
      query={query}
      onQueryChange={setQuery}
      status={status}
      activeRows={activeRows}
      selected={selected}
      clientToneByRowId={clientToneByRowId}
      onSelectRow={handleSelectRow}
      onDeleteRow={handleDeleteRow}
      onCreateClient={openNewClient}
    />
  );

  const right = (
    <DatabaseRightPanel
      status={status}
      tabHeading={tabHeading}
      selected={selected}
      selectedClient={selectedClient}
      selectedDelivery={selectedDelivery}
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
