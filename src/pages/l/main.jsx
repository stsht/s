import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { PasswordGate } from '../../components/PasswordGate.jsx';
import '../../styles/app-base.css';
import '../invcs/inv.css';
import './l.css';

const LinkGeneratorPage = lazy(() => import('./LinkGeneratorPage.jsx').then((module) => ({
  default: module.LinkGeneratorPage,
})));

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PasswordGate title="Link Generator">
      <Suspense fallback={null}>
        <LinkGeneratorPage />
      </Suspense>
    </PasswordGate>
  </React.StrictMode>,
);
