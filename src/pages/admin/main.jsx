import React from 'react';
import { createRoot } from 'react-dom/client';
import { PasswordGate } from '../../components/PasswordGate.jsx';
import { AdminDashboard } from '../workspace/WorkspacePages.jsx';
import '../invcs/invcs.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PasswordGate title="Dashboard">
      <AdminDashboard />
    </PasswordGate>
  </React.StrictMode>,
);
