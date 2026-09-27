import React from 'react';
import { createRoot } from 'react-dom/client';
import { OnboardingApp } from './OnboardingApp';
import { ErrorBoundary } from '../components/empty/ErrorBoundary';
import { OfflineBanner } from '../components/empty/OfflineBanner';
import '@/renderer/design/theme.global.css';
import '../design/empty-states.css';
import '../components/lib/lib.css';
import './onboarding.css';
import { initThemeMode } from '@/renderer/design/themeMode';

document.documentElement.dataset.theme = 'shell';
// Onboarding used to skip this and was always dark regardless of the setting.
initThemeMode();

window.addEventListener('error', (e) => {
  console.error('[onboarding] renderer.error', { message: e.message, file: e.filename, line: e.lineno });
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[onboarding] renderer.unhandledrejection', { reason: String(e.reason) });
});

const rootEl = document.getElementById('onboarding-root');
if (!rootEl) throw new Error('[onboarding] #onboarding-root element not found');

// No StrictMode — see hub/index.tsx: its dev double-mount freezes the
// Libraries.dev canvas components (metal, orbs, bot avatars) after one frame.
createRoot(rootEl).render(
  <ErrorBoundary>
    <OfflineBanner />
    <OnboardingApp />
  </ErrorBoundary>,
);
