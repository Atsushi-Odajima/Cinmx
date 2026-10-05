import React from 'react';
import { createRoot } from 'react-dom/client';
import { installHarness } from './harness';
import { App } from './App';
import './styles/tokens.css';
import './styles/base.css';

installHarness();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
