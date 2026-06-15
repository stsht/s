import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { PasswordGate } from '../../components/PasswordGate.jsx';
import '../invcs/inv.css';

const InvoiceComposer = lazy(() => import('../invcs/InvoiceComposer.jsx').then((module) => ({
  default: module.InvoiceComposer,
})));

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PasswordGate title="Invoice Generator">
      <Suspense fallback={null}>
        <InvoiceComposer />
      </Suspense>
    </PasswordGate>
  </React.StrictMode>,
);
