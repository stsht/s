import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { jakartaTodayISO, buildClientRecords } from '../dbHelpers.js';
import { generateEventKey, createRecordUrl, stripVendorName } from './clientEventHelpers.js';
import { ClientHeader } from './ClientHeader.jsx';
import { ClientDetailRows } from './ClientDetailRows.jsx';
import { ClientEventList } from './ClientEventList.jsx';

export function ClientDetail({ client, invoices, deliveries, onDeleteClient, onEditClient, onDeleteRecord, onViewLinks, onRefresh, onClose }) {
  const todayIso = useMemo(() => jakartaTodayISO(), []);
  const records = buildClientRecords(client, invoices, deliveries, todayIso);
  const title = client?.title ?? 'Ms.';
  const name = client?.name || client?.client_name || 'Client';
  const contact = client?.contact || client?.client_contact || '';

  const [createOpen, setCreateOpen] = useState(false);
  const [pendingEventKey, setPendingEventKey] = useState('');
  const openCreateSheet = () => {
    setPendingEventKey(generateEventKey());
    setCreateOpen(true);
  };
  const closeCreateSheet = () => {
    setCreateOpen(false);
    setPendingEventKey('');
  };

  const [armedDeleteKey, setArmedDeleteKey] = useState(null);
  const armedDeleteTimerRef = useRef(null);
  const clearArmedDeleteTimer = useCallback(() => {
    if (armedDeleteTimerRef.current) {
      clearTimeout(armedDeleteTimerRef.current);
      armedDeleteTimerRef.current = null;
    }
  }, []);
  const handleEventDelete = useCallback((key, row) => {
    if (!key) return;
    if (armedDeleteKey === key) {
      clearArmedDeleteTimer();
      setArmedDeleteKey(null);
      onDeleteRecord?.(row);
      return;
    }
    clearArmedDeleteTimer();
    setArmedDeleteKey(key);
    armedDeleteTimerRef.current = setTimeout(() => {
      armedDeleteTimerRef.current = null;
      setArmedDeleteKey(null);
    }, 3000);
  }, [armedDeleteKey, clearArmedDeleteTimer, onDeleteRecord]);

  const recordsSignature = useMemo(
    () => records
      .map((row, index) => row.delivery?.id || row.invoice?.id || row.vendorDelivery?.id || row.vendorInvoice?.id || `${row.date}-${index}`)
      .join('|'),
    [records],
  );
  const clientIdentity = String(client?.client_id || client?.id || '');
  useEffect(() => {
    clearArmedDeleteTimer();
    setArmedDeleteKey(null);
  }, [clientIdentity, recordsSignature, clearArmedDeleteTimer]);
  useEffect(() => () => clearArmedDeleteTimer(), [clearArmedDeleteTimer]);

  const parentClientId = String(client?.client_id || '').trim();
  const vendorName = stripVendorName(name) || name;
  const newEventLinkHref = createRecordUrl('/l/', {
    title,
    name,
    contact,
    eventKey: pendingEventKey,
    clientId: parentClientId,
  });
  const newEventInvoiceHref = createRecordUrl('/inv/', {
    title,
    name,
    contact,
    eventKey: pendingEventKey,
    clientId: parentClientId,
  });
  const newEventVendorLinkHref = createRecordUrl('/l/', {
    title: '',
    name: vendorName,
    contact,
    eventKey: pendingEventKey,
    clientId: parentClientId,
    type: 'vendor',
  });
  const newEventVendorInvoiceHref = createRecordUrl('/inv/', {
    title: '',
    name: vendorName,
    contact,
    eventKey: pendingEventKey,
    clientId: parentClientId,
    type: 'vendor',
  });

  return (
    <>
      <ClientHeader
        name={name}
        onRefresh={onRefresh}
        onEdit={() => onEditClient?.(client)}
        onDelete={() => onDeleteClient?.(client)}
        onClose={onClose}
      >
        <ClientDetailRows contact={contact} />
      </ClientHeader>
      <ClientEventList
        records={records}
        title={title}
        name={name}
        contact={contact}
        parentClientId={parentClientId}
        newEventLinkHref={newEventLinkHref}
        newEventInvoiceHref={newEventInvoiceHref}
        newEventVendorLinkHref={newEventVendorLinkHref}
        newEventVendorInvoiceHref={newEventVendorInvoiceHref}
        todayIso={todayIso}
        armedDeleteKey={armedDeleteKey}
        onEventDelete={handleEventDelete}
        onViewLinks={onViewLinks}
        createOpen={createOpen}
        onOpenCreate={openCreateSheet}
        onCloseCreate={closeCreateSheet}
      />
    </>
  );
}
