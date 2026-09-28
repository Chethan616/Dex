/**
 * Track B — Pill renderer entry point.
 * Mounts the Pill React tree into #pill-root.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { Pill } from './Pill';
import { ErrorBoundary } from '../components/empty/ErrorBoundary';
import '../design/theme.global.css';
import '../design/empty-states.css';
import '../components/lib/lib.css';
import '../hub/hub.css';
import './pill.css';
import { initThemeMode } from '../design/themeMode';

// Apply shell theme (dark Linear+Obsidian) — pill uses same palette
document.documentElement.dataset.theme = 'shell';
initThemeMode();

window.addEventListener('error', (e) => {
  console.error('renderer.error', { message: e.message, file: e.filename, line: e.lineno });
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('renderer.unhandledrejection', { reason: String(e.reason) });
});

const rootEl = document.getElementById('pill-root');
if (!rootEl) throw new Error('[pill] #pill-root element not found');

// No StrictMode — see hub/index.tsx: its dev double-mount freezes metal-fx.
createRoot(rootEl).render(
  <ErrorBoundary>
    <Pill />
  </ErrorBoundary>,
);
