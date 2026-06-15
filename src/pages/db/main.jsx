import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { PasswordGate } from '../../components/PasswordGate.jsx';
import '../invcs/inv.css';

const DatabasePage = lazy(() => import('./DatabasePage.jsx').then((module) => ({
  default: module.DatabasePage,
})));

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PasswordGate title="Database">
      <Suspense fallback={null}>
        <DatabasePage />
      </Suspense>
    </PasswordGate>
  </React.StrictMode>,
);
