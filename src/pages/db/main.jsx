import React from 'react';
import { createRoot } from 'react-dom/client';
import { PasswordGate } from '../../components/PasswordGate.jsx';
import { DatabasePage } from './DatabasePage.jsx';
import '../invcs/invcs.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PasswordGate title="Database">
      <DatabasePage />
    </PasswordGate>
  </React.StrictMode>,
);
