/**
 * Hub renderer entry point.
 * Mounts the HubApp React tree into #hub-root.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { HubApp } from './HubApp';
import { queryClient } from './useSessionsQuery';
import { ToastProvider } from '@/renderer/components/base/Toast';
import { ErrorBoundary } from '../components/empty/ErrorBoundary';
import { OfflineBanner } from '../components/empty/OfflineBanner';
import '@/renderer/design/theme.global.css';
import '../design/empty-states.css';
import '../components/lib/lib.css';
import '@/renderer/components/base/components.css';
import './hub.css';
import { initThemeMode } from '@/renderer/design/themeMode';

// Apply shell theme — hub uses the same dark palette
document.documentElement.dataset.theme = 'shell';
initThemeMode();

window.addEventListener('error', (e) => {
  console.error('[hub] renderer.error', { message: e.message, file: e.filename, line: e.lineno });
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[hub] renderer.unhandledrejection', { reason: String(e.reason) });
});

const rootEl = document.getElementById('hub-root');
if (!rootEl) throw new Error('[hub] #hub-root element not found');

/* No StrictMode. It mounts, unmounts and remounts every component once in
 * development; metal-fx, voice-glow and thinking-orbs attach to a shared
 * render loop on mount and tear it down on unmount, and the remount does not
 * restart it — so the metal paints one frame and freezes (dev only). */
createRoot(rootEl).render(
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <OfflineBanner />
        <HubApp />
      </ToastProvider>
    </QueryClientProvider>
  </ErrorBoundary>,
);
