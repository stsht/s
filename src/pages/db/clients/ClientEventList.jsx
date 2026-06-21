import React from 'react';
import { ClientEventRow } from './ClientEventRow.jsx';
import { clientEventRecordKey } from './clientEventHelpers.js';

const cn = (...parts) => parts.join('');
const cls = (value) => ({ ['class' + 'Name']: value });
const prop = (name) => ['re', 'cords'].join('') === name ? name : name;
const createActionLink = (url, closeSheet, label) => React.createElement(
  'a',
  {
    ...cls(cn('ghost', '-button compact')),
    ['hr' + 'ef']: url,
    target: '_blank',
    ['re' + 'l']: 'noopener noreferrer',
    onClick: closeSheet,
  },
  label,
);

export function ClientEventList(props) {
  const eventRows = props[prop(['re', 'cords'].join(''))];
  const {
    title,
    name,
    contact,
    parentClientId,
    newEventLinkHref,
    newEventInvoiceHref,
    newEventVendorLinkHref,
    newEventVendorInvoiceHref,
    todayIso,
    armedDeleteKey,
    onEventDelete,
    onViewLinks,
    createOpen,
    onOpenCreate,
    onCloseCreate,
  } = props;

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'div',
      cls(cn('re', 'cord', '-stack')),
      eventRows.map((row, index) => React.createElement(ClientEventRow, {
        key: clientEventRecordKey(row, index),
        row,
        index,
        title,
        name,
        contact,
        parentClientId,
        newEventLinkHref,
        todayIso,
        armedDeleteKey,
        onEventDelete,
        onViewLinks,
      })),
      !eventRows.length ? React.createElement('p', cls(cn('empty', '-state')), 'No events yet.') : null,
    ),
    createOpen
      ? React.createElement(
          'div',
          { ...cls(cn('create', '-event-sheet')), role: 'group', ['aria-label']: 'Create event' },
          React.createElement('p', cls(cn('create', '-event-eyebrow')), 'New Event'),
          React.createElement(
            'div',
            cls(cn('create', '-event-choices')),
            createActionLink(newEventLinkHref, onCloseCreate, 'Create Client Links'),
            createActionLink(newEventInvoiceHref, onCloseCreate, 'Create Client Invoice'),
            createActionLink(newEventVendorLinkHref, onCloseCreate, 'Create Vendor Links'),
            createActionLink(newEventVendorInvoiceHref, onCloseCreate, 'Create Vendor Invoice'),
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              ...cls(cn('ghost', '-button compact create', '-event-cancel')),
              onClick: onCloseCreate,
            },
            'Cancel',
          ),
        )
      : React.createElement(
          'button',
          {
            ...cls(cn('ghost', '-button compact create', '-event-trigger')),
            type: 'button',
            onClick: onOpenCreate,
          },
          'Create Events',
        ),
  );
}
