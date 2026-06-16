import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { PasswordGate } from '../../components/PasswordGate.jsx';
import '../../styles/app-base.css';
import '../invcs/inv.css';
import './subs/subscriptionManagement.css';

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
