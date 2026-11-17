import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRemoteList } from './useRemoteList.js';
import { jakartaTodayISO } from './dbHelpers.js';
import {
  sortClientsByName,
  filterCrmClients,
  getEventDatesByClient,
  buildSortedCrmClients,
  buildClientToneByRowId,
  buildActivityRows,
  getSelectedClient,
  getSelectedDelivery,
} from './databasePageDerivations.js';
import { createDatabasePageActions } from './databasePageActions.js';

export function useDatabasePageState() {
  const [tab, setTab] = useState('clients');
  const [query, setQuery] = useState('');
  // `query` drives the input and the local Activity filter, so it
  // stays instant. The /api/db request is built from `debouncedQuery`
  // instead, so typing one word sends one request rather than one
  // per keystroke. Clearing the box applies immediately.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({ title: 'Ms.', name: '', contact: '' });
  const [saveStatus, setSaveStatus] = useState('');
  const [mobileView, setMobileView] = useState('left');
  useEffect(() => {
    if (!query.trim()) {
      setDebouncedQuery('');
      return undefined;
    }
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const endpoint = `/api/db${debouncedQuery.trim() ? `?q=${encodeURIComponent(debouncedQuery.trim())}` : ''}`;
  const { data, status, refetch, refresh } = useRemoteList(endpoint);
  const rawClients = data?.clients || [];
  const invoices = data?.invoices || [];
  const deliveriesAll = data?.items || [];
  const todayIso = useMemo(() => jakartaTodayISO(), []);

  const eventDatesByClient = useCallback(
    (client) => getEventDatesByClient(client, invoices, deliveriesAll),
    [invoices, deliveriesAll],
  );

  const clients = useMemo(() => sortClientsByName(rawClients), [rawClients]);
  const crmClients = useMemo(() => filterCrmClients(clients), [clients]);

  const sortedCrmClients = useMemo(
    () => buildSortedCrmClients({ crmClients, eventDatesByClient, invoices, deliveriesAll, todayIso }),
    [crmClients, eventDatesByClient, invoices, deliveriesAll, todayIso],
  );

  const clientToneByRowId = useMemo(
    () => buildClientToneByRowId(sortedCrmClients),
    [sortedCrmClients],
  );

  const activityRows = useMemo(
    () => buildActivityRows({ deliveriesAll, query }),
    [deliveriesAll, query],
  );

  const activeRows = tab === 'activity'
    ? activityRows
    : sortedCrmClients.map((entry) => entry.client);
  const selectedClient = getSelectedClient(selected, clients);
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
    selectedClient,
    selectedDelivery,
    back,
    saveClient,
    openNewClient,
    deleteClient,
    deleteRecord,
    handleSelectRow,
    handleDeleteRow,
  };
}
