import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { jakartaTodayISO, buildClientRecords } from '../dbHelpers.js';
import { generateEventKey, createRecordUrl, stripVendorName } from './clientEventHelpers.js';
import { ClientHeader } from './ClientHeader.jsx';
import { ClientDetailRows } from './ClientDetailRows.jsx';
import { ClientEventList } from './ClientEventList.jsx';

function invoiceType(invoice = {}) {
  const data = invoice?.invoice_data && typeof invoice.invoice_data === 'object' ? invoice.invoice_data : {};
  return String(invoice?.invoice_type || data.invoiceType || '').trim().toLowerCase() === 'vendor' ? 'vendor' : 'client';
}

function eventInvoicesForRow(row, invoices, client) {
  const clientId = String(client?.client_id || client?.id || '').trim();
  const clientName = String(client?.name || client?.client_name || '').trim().toLowerCase();
  const rowEventKey = String(row?.eventKey || row?.invoice?.event_key || row?.delivery?.event_key || '').trim();
  const rowEventDate = String(row?.eventDate || '').trim();
  const rowDeliveryId = String(row?.delivery?.id || '').trim();
  const currentInvoiceId = String(row?.invoice?.id || '').trim();

  return (Array.isArray(invoices) ? invoices : [])
    .filter((invoice) => {
      if (invoiceType(invoice) === 'vendor') return false;
      const invoiceClientId = String(invoice?.client_id || '').trim();
      const invoiceName = String(invoice?.client_name || '').trim().toLowerCase();
      if (clientId && invoiceClientId) return clientId === invoiceClientId;
      return !!clientName && clientName === invoiceName;
    })
    .filter((invoice) => {
      const data = invoice?.invoice_data && typeof invoice.invoice_data === 'object' ? invoice.invoice_data : {};
      const invoiceId = String(invoice?.id || '').trim();
      const invoiceEventKey = String(invoice?.event_key || data.event_key || '').trim();
      const invoiceEventDate = String(invoice?.event_date || '').trim();
      const invoiceDeliveryId = String(data.delivery_id || '').trim();

      if (currentInvoiceId && invoiceId === currentInvoiceId) return true;
      if (rowDeliveryId && invoiceDeliveryId === rowDeliveryId) return true;
      if (rowEventKey && invoiceEventKey) return rowEventKey === invoiceEventKey;
      return !!rowEventDate && rowEventDate === invoiceEventDate && (!rowEventKey || !invoiceEventKey);
    })
    .sort((a, b) => (
      (Date.parse(b?.updated_at || b?.created_at || '') || 0)
      - (Date.parse(a?.updated_at || a?.created_at || '') || 0)
    ));
}

export function ClientDetail({ client, invoices, deliveries, onDeleteClient, onEditClient, onDeleteRecord, onViewLinks, onRefresh, onClose }) {
  const todayIso = useMemo(() => jakartaTodayISO(), []);
  const records = useMemo(() => {
    const baseRecords = buildClientRecords(client, invoices, deliveries, todayIso);
    return baseRecords.map((row) => {
      const matchingInvoices = eventInvoicesForRow(row, invoices, client);
      return {
        ...row,
        invoice: matchingInvoices[0] || row.invoice || null,
        paymentInvoices: matchingInvoices.length ? matchingInvoices : (row.invoice ? [row.invoice] : []),
      };
    });
  }, [client, invoices, deliveries, todayIso]);

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
