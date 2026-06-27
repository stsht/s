import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRemoteList } from './useRemoteList.js';
import { jakartaTodayISO } from './dbHelpers.js';
import {
  sortClientsByName,
  buildSubRows,
  filterCrmClients,
  getEffectiveSubscription,
  getEventDatesByClient,
  buildSortedCrmClients,
  buildClientToneByRowId,
  buildSortedSubRows,
  buildActivityRows,
  getSelectedClient,
  getSelectedSubscription,
  getSelectedDelivery,
} from './databasePageDerivations.js';
import { createDatabasePageActions } from './databasePageActions.js';

export function useDatabasePageState() {
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
  const deliveriesAll = data?.items || [];
  const todayIso = useMemo(() => jakartaTodayISO(), []);

  const effectiveSubscription = useCallback((sub) => getEffectiveSubscription(sub), []);
  const eventDatesByClient = useCallback(
    (client) => getEventDatesByClient(client, invoices, deliveriesAll),
    [invoices, deliveriesAll],
  );

  const clients = useMemo(() => sortClientsByName(rawClients), [rawClients]);
  const subRows = useMemo(() => buildSubRows(subscriptions), [subscriptions]);
  const crmClients = useMemo(() => filterCrmClients(clients), [clients]);

  const sortedCrmClients = useMemo(
    () => buildSortedCrmClients({ crmClients, eventDatesByClient, invoices, deliveriesAll, todayIso }),
    [crmClients, eventDatesByClient, invoices, deliveriesAll, todayIso],
  );

  const clientToneByRowId = useMemo(
    () => buildClientToneByRowId(sortedCrmClients),
    [sortedCrmClients],
  );

  const sortedSubRows = useMemo(
    () => buildSortedSubRows({ subRows, effectiveSubscription }),
    [subRows, effectiveSubscription],
  );

  const activeRows = tab === 'subs'
    ? sortedSubRows
    : sortedCrmClients.map((entry) => entry.client);
  const selectedClient = getSelectedClient(selected, clients);
  const selectedSubscription = getSelectedSubscription(selected, subscriptions);
  const selectedDelivery = useMemo(
    () => getSelectedDelivery(selected, data),
    [selected, data],
  );

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

  const {
    saveClient,
    openNewClient,
    openImportSubscription,
    openCreateSubscription,
    deleteClient,
    deleteRecord,
    handleSelectRow,
    handleDeleteRow,
  } = createDatabasePageActions({
    draft,
    query,
    tab,
    selected,
    setTab,
    setDraft,
    setSaveStatus,
    setSelected,
    setMobileView,
    back,
    refetch,
  });

  return {
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
  };
}
