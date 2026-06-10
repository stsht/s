import React from 'react';
import { createRoot } from 'react-dom/client';
import { PasswordGate } from '../../components/PasswordGate.jsx';
import { LinkGeneratorPage } from './LinkGeneratorPage.jsx';
import '../invcs/invcs.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PasswordGate title="Link Generator">
      <LinkGeneratorPage />
    </PasswordGate>
  </React.StrictMode>,
);
