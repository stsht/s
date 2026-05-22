import React from 'react';
import { createRoot } from 'react-dom/client';
import { PasswordGate } from '../../components/PasswordGate.jsx';
import { InvoiceComposer } from '../invcs/InvoiceComposer.jsx';
import '../invcs/invcs.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PasswordGate title="Invoice Generator">
      <InvoiceComposer />
    </PasswordGate>
  </React.StrictMode>,
);
