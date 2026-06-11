import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { PasswordGate } from '../../components/PasswordGate.jsx';
import '../invcs/invcs.css';

const SubscriptionsPage = lazy(() => import('../../features/subscriptions/SubscriptionsPage.jsx').then((module) => ({
  default: module.SubscriptionsPage,
})));

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PasswordGate title="Subscriptions">
      <Suspense fallback={null}>
        <SubscriptionsPage />
      </Suspense>
    </PasswordGate>
  </React.StrictMode>,
);
