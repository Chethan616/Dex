import React from 'react';
import { createRoot } from 'react-dom/client';
import '../design/theme.global.css';
import '../design/empty-states.css';
import '../components/lib/lib.css';
import './popup.css';
import { initThemeMode } from '../design/themeMode';
import { ErrorBoundary } from '../components/empty/ErrorBoundary';
import { AppPopup } from './AppPopup';
import { prefetchEngineMenu } from '../hub/EnginePicker';

document.documentElement.dataset.theme = 'shell';
initThemeMode();
prefetchEngineMenu();

const rootEl = document.getElementById('popup-root');
if (!rootEl) throw new Error('[popup] #popup-root not found');

// No StrictMode — see hub/index.tsx: its dev double-mount freezes the
// Libraries.dev canvas components after one frame.
createRoot(rootEl).render(
  <ErrorBoundary>
    <AppPopup />
  </ErrorBoundary>,
);
