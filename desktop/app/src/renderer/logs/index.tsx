import React from 'react';
import { createRoot } from 'react-dom/client';
import { LogsApp } from './LogsApp';
import { ErrorBoundary } from '../components/empty/ErrorBoundary';
import '../design/theme.global.css';
import '../design/empty-states.css';
import '../components/lib/lib.css';
import './logs.css';
import './chat.css';
import { initThemeMode } from '../design/themeMode';

document.documentElement.dataset.theme = 'shell';
initThemeMode();

const rootEl = document.getElementById('logs-root');
if (!rootEl) throw new Error('[logs] #logs-root not found');

// No StrictMode — see hub/index.tsx: its dev double-mount freezes the
// Libraries.dev canvas components after one frame.
createRoot(rootEl).render(
  <ErrorBoundary>
    <LogsApp />
  </ErrorBoundary>,
);
