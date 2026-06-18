import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles/app-base.css';
import './t.css';
import { TextPadPage } from './TextPadPage.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TextPadPage />
  </React.StrictMode>,
);
