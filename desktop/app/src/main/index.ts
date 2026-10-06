/**
 * Main process entry point — Browser Use Desktop.
 *
 * Browser modules (tabs, bookmarks, history, downloads, extensions,
 * permissions, profiles, etc.) have been removed in the nuclear pivot.
 * Only the core infrastructure remains: shell window, pill, HL engine,
 * OAuth/identity, settings page routing, updater, hotkeys.
 */

import { config as loadDotEnv } from 'dotenv';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Load .env from the app root (app/.env) BEFORE any module reads
// process.env. In production the key comes from the keychain; .env is the
// dev-time fallback.
loadDotEnv({ path: path.resolve(__dirname, '..', '..', '.env') });

import { app, BrowserWindow, crashReporter, dialog, globalShortcut, ipcMain, Menu, MenuItemConstructorOptions, nativeImage, session as electronSession, shell } from 'electron';
import { mergeChromiumFeature } from './startup/chromiumFeatures';
import { destroyStage, stageEnabled, waitForFrame } from './workspace/stage';

if (process.platform === 'linux') {
  app.commandLine.appendSwitch(
    'enable-features',
    mergeChromiumFeature(app.commandLine.getSwitchValue('enable-features'), 'GlobalShortcutsPortal'),
  );
}

// Tabs off your screen live on an off-screen stage window (workspace/stage.ts).
// Windows' occlusion tracking would call that window hidden and stop painting
// it — then the agent can't screenshot a background tab or a task you aren't
// looking at. Hidden views still sleep (they're setVisible(false)); the cost is
// that DEX's own window keeps drawing its animations while another app covers it.
if (stageEnabled()) {
  app.commandLine.appendSwitch(
    'disable-features',
    mergeChromiumFeature(app.commandLine.getSwitchValue('disable-features'), 'CalculateNativeWinOcclusion'),
  );
}

app.setName('DEX');

// Native-crash minidumps → userData/Crashpad/. Captures GPU process,
// renderer process, and main-process native crashes that our
// uncaughtException handlers (JS-only) miss. Local-only — no upload
// endpoint wired yet; users can zip the Crashpad dir and attach to
// bug reports.
crashReporter.start({
  productName: 'DEX',
  companyName: 'DEX',
  submitURL: '',
  uploadToServer: false,
  compress: true,
});

// Enforce a single running instance. The lock loser exits, while the primary
// process handles `second-instance` by focusing or recreating its main window.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}
app.on('second-instance', handleSecondInstanceLaunch);

// Populate the native About dialog (macOS + Linux) instead of showing the
// default Electron panel with no branding.
app.setAboutPanelOptions({
  applicationName: 'DEX',
  applicationVersion: app.getVersion(),
  copyright: '© 2026 DEX',
  website: 'https://github.com/Chethan616/Dex',
});

import started from 'electron-squirrel-startup';
import { createShellWindow } from './window';
import { createTray, refreshTrayMenu } from './tray';
// Track B — Pill + hotkeys
import { togglePill, showPill, hidePill, sendToPill, setPillHeight, PILL_HEIGHT_COLLAPSED, PILL_HEIGHT_EXPANDED } from './pill';
import { attachToHub as attachLogsToHub, toggleLogs, hideLogs, getLogsWindow, showLogs, setLogsMode, updateLogsAnchor, focusLogsFollowUp } from './logsPill';
import * as takeoverOverlay from './takeoverOverlay';
import { sendSessionNotification } from './notifications';
import { registerHotkeys, unregisterHotkeys, getGlobalCmdbarAccelerator, setGlobalCmdbarAccelerator } from './hotkeys';
import { makeRequest, PROTOCOL_VERSION } from '../shared/types';
import type { AgentEvent } from '../shared/types';
import type { HlEvent } from '../shared/session-schemas';
// Identity
import { AccountStore } from './identity/AccountStore';
import { createOnboardingWindow } from './identity/onboardingWindow';
import { registerOnboardingHandlers } from './identity/onboardingHandlers';
import { loadBrowserCodeConfig } from './identity/authStore';
import { registerApiKeyHandlers } from './settings/apiKeyIpc';
import { registerConsentHandlers } from './consentIpc';
import { registerTelemetryHandlers } from './telemetryIpc';
import { registerThemeHandlers } from './themeIpc';
import { startSystemThemeWatcher } from './themeMode';
import { registerAppPopupHandlers } from './appPopup';
import { captureEvent } from './telemetry';
import { registerChromeImportHandlers } from './chrome-import/ipc';
import { mainLogger } from './logger';
import { createLocalTaskServer } from './localTaskServer';
import { registerAccountsIpc } from './accounts';
import { registerSetupIpc } from './setup/essentials';
import { registerProfileIpc } from './profile';
import {
  resolveUserDataDir,
  resolveDevtoolsPortOptIn,
  setAnnouncedCdpPort,
  verifyCdpOwnership,
} from './startup/cli';
import { CdpBroker, type BrokerContents, type BrokerHooks } from './cdpBroker';
import { moveCursor, setCursorVisible } from './workspace/agentCursor';
import { noteAgentInput, takeUserActsSinceAgent, userActiveWithin, waitForUserIdle } from './workspace/userActivity';
import { maskSecretFields, READS_PAGE, redactSecrets, secretValues } from './workspace/secretFields';
import { handleDownload } from './workspace/downloads';
import { leaseDebugger, withDebugger } from './cdpLease';
import { normalizeAddress } from '../shared/address';
import { assertString, assertAttachments, type ValidatedAttachment } from './ipc-validators';
import { runPreflight, formatPreflightForLog, type PreflightReport } from './startup/preflight';
import {
  getEngineStatus,
  invalidateEngineStatus,
  prewarmEngineStatus,
  type EngineStatus,
} from './hl/engines/statusCache';
import { TaskStateMutationSchema } from '../shared/session-schemas';
// Agent loop: CLI subprocess driving the browser harness. Engine is
// pluggable (claude-code, codex, …) — see src/main/hl/engines/.
import { bootstrapHarness, harnessDir } from './hl/harness';
import { isRunnable, resolveRecordedFile } from './sessions/recordedFiles';
import { DocumentTabs, MAX_DOC_BYTES } from './workspace/documents';
import { resolveAgentPath } from './hl/agentPaths';
import { runEngine, DEFAULT_ENGINE_ID } from './hl/engines';
import type { EngineRunControl } from './hl/engines/types';
import { getEngine, setEngine, type EngineId } from './hl/engine';
import { forwardAgentEvent } from './pill';
// Session management
import { SessionManager } from './sessions/SessionManager';
import { BrowserPool } from './sessions/BrowserPool';
import * as approvalPolicy from './approvals/policy';
import { normalizeApprovalCategory, normalizeApprovalLifetime, normalizeApprovalMode } from './approvals/policy';
import type { ApprovalCategory, ApprovalLifetime } from './approvals/policy';
import {
  snapshotResourceUsage,
  startResourceMonitor,
  stopResourceMonitor,
  type ResourceMonitorContext,
} from './resourceMonitor';
// Channels (WhatsApp)
import { WhatsAppAdapter } from './channels/WhatsAppAdapter';
import { ChannelRouter } from './channels/ChannelRouter';
import { registerChannelHandlers, unregisterChannelHandlers } from './channels/ipc';
// Auto-updater
import {
  downloadLatestVersion,
  getUpdateRuntimeInfo,
  getUpdateStatus,
  initUpdater,
  installDownloadedUpdate,
  onBeforeQuitForUpdate,
  onUpdateStatusChanged,
  stopUpdater,
} from './updater';

// ---------------------------------------------------------------------------
// Crash telemetry: catch unhandled errors before anything else
// ---------------------------------------------------------------------------
process.on('uncaughtException', (err) => {
  mainLogger.error('main.uncaughtException', {
    error: err.message,
    stack: err.stack,
    type: err.constructor?.name,
  });
});
process.on('unhandledRejection', (reason, promise) => {
  mainLogger.error('main.unhandledRejection', {
    reason: String(reason),
    promise: String(promise),
  });
});

// ---------------------------------------------------------------------------
// Isolated userData override.
// Precedence: --user-data-dir CLI flag > AGB_USER_DATA_DIR env > platform default.
// MUST be applied before any app.getPath('userData') call.
// ---------------------------------------------------------------------------
const resolvedUserData = resolveUserDataDir(process.argv, process.env);
if (resolvedUserData.value) {
  app.setPath('userData', resolvedUserData.value);
}

// ---------------------------------------------------------------------------
// Remote debugging port — MUST be called before app.whenReady()
// ---------------------------------------------------------------------------
// Windows groups taskbar buttons and picks the jump-list identity by
// AppUserModelID. Without one set explicitly, an unpackaged run inherits
// Electron's, so the taskbar says "Electron" with the Electron icon even
// after the window icon is correct.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.chethan616.dex');
}

// No remote-debugging port unless explicitly asked for: it would expose every
// window, DEX's own approval cards included, to any process on the PC. Agents
// reach their tab through the CDP broker (cdpBroker.ts), started when ready.
const devtoolsPort = resolveDevtoolsPortOptIn(process.argv, process.env);
if (devtoolsPort) {
  app.commandLine.appendSwitch('remote-debugging-port', String(devtoolsPort.port));
  setAnnouncedCdpPort(devtoolsPort.port);
}
mainLogger.info('main.startup', {
  msg: devtoolsPort
    ? `Remote debugging port ${devtoolsPort.port} opened on request (${devtoolsPort.source}) — every DEX window is reachable on it`
    : 'Remote debugging port off; agents use the CDP broker',
  devtoolsPort: devtoolsPort?.port ?? null,
  devtoolsPortSource: devtoolsPort?.source ?? null,
  userDataOverride: resolvedUserData.value,
  userDataSource: resolvedUserData.source,
  forceOnboarding: process.env.AGB_FORCE_ONBOARDING === '1',
});

// Handle Windows Squirrel installer events
if (started) {
  app.quit();
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
let shellWindow: BrowserWindow | null = null;

// Document tabs (docs/unify/PLAN.md §3.9). The hub draws them; this keeps each
// task's list and reloads a tab when its file changes on disk.
const documentTabs = new DocumentTabs(
  (sessionId, docs, focusId) => shellWindow?.webContents.send('workspace:docs-changed', sessionId, docs, focusId ?? null),
  (sessionId, docId, mtimeMs) => shellWindow?.webContents.send('workspace:doc-changed', sessionId, docId, mtimeMs),
);
let onboardingWindow: BrowserWindow | null = null;
let isQuitting = false;

const sessionManager = new SessionManager(path.join(app.getPath('userData'), 'sessions.db'));

/**
 * Outstanding dex-registry confirmations, keyed by id.
 *
 * The /dex/confirm route's returned Promise is what keeps that HTTP request
 * open — the CLI is genuinely blocked on it, not polling — until this
 * resolver is called from the renderer's Approve/Deny click. A generous
 * timeout guards against a card nobody ever answers (the app closed, the
 * user walked away) leaving the agent's process hung forever.
 */
const pendingConfirmations = new Map<string, {
  resolve: (approved: boolean) => void;
  sessionId: string;
  title: string;
  detail: string;
  category: ApprovalCategory;
}>();
const CONFIRMATION_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Answers a pending confirmation exactly once — called from the renderer's
 * Approve/Deny click, or from the /dex/confirm route's own timeout if
 * nobody answers. Idempotent: a second call for the same id (a timeout
 * racing a late click) is a no-op rather than a double-resolve.
 */
function resolveConfirmation(id: string, approved: boolean, lifetime: ApprovalLifetime = 'once'): void {
  const pending = pendingConfirmations.get(id);
  if (!pending) return;
  pendingConfirmations.delete(id);
  approvalPolicy.recordDecision(pending.sessionId, pending.category, approved, lifetime);
  const session = sessionManager.getSession(pending.sessionId);
  if (session) {
    sessionManager.appendOutput(pending.sessionId, {
      type: 'confirmation',
      id,
      title: pending.title,
      detail: pending.detail,
      status: approved ? 'approved' : 'denied',
      at: Date.now(),
    });
  }
  pending.resolve(approved);
}

/**
 * Shared by /dex/confirm (dex-registry) and /dex/sh-session-run (dex-sh's
 * session mode) — both need "check the policy, and if it says ask, put up
 * a real blocking card and wait." Resolves `{approved: true}` immediately,
 * with no card shown at all, when the policy already covers this action.
 */
function requestConfirmation(
  sessionId: string,
  title: string,
  detail: string,
  category: ApprovalCategory,
  subject?: string,
): Promise<{ approved: boolean }> {
  if (!approvalPolicy.needsPrompt({ sessionId, category, subject })) {
    return Promise.resolve({ approved: true });
  }

  const id = randomUUID();
  const session = sessionManager.getSession(sessionId);
  if (session) {
    sessionManager.appendOutput(sessionId, { type: 'confirmation', id, title, detail, status: 'pending', at: Date.now() });
    // Suspend AFTER appendOutput, which just reset it — otherwise the very
    // next line's clear would have nothing to undo and the timer stays
    // armed for a wait that can run minutes.
    sessionManager.suspendStuckTimer(sessionId);
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolveConfirmation(id, false);
    }, CONFIRMATION_TIMEOUT_MS);
    pendingConfirmations.set(id, {
      sessionId,
      title,
      detail,
      category,
      resolve: (approved) => {
        clearTimeout(timeout);
        resolve({ approved });
      },
    });
  });
}
// Bootstrap the editable helpers harness — writes stock helpers.js + TOOLS.json
// to <userData>/harness/ on first run, preserves user edits on subsequent runs.
//
// This runs at module load, so anything thrown here stops the app before a
// window exists: the user sees "App threw an error during load" and nothing
// else. A harness that failed to refresh is a degraded app; a harness that
// throws is no app at all. Diagnostics reports the state either way.
try {
  bootstrapHarness();
} catch (err) {
  mainLogger.error('main.bootstrapHarness.failed', {
    error: (err as Error).message,
    hint: 'The agent may be missing tools. Usually another DEX instance is holding files open.',
  });
}
// There is no background file index any more. `dex-find` queries the
// Windows Search index on demand instead (see src/main/search/winSearch.ts):
// DEX's own SQLite FTS5 index reached 3.4 GB in real use and, being
// synchronous and main-process-bound, its writes competed with every IPC
// call the UI makes. Nothing indexing-related runs at startup now.
/**
 * The environment report, refreshed at startup and on demand from Settings.
 *
 * Held in main rather than recomputed per request so the renderer, the log and
 * the engine spawn all agree on what was found — the whole point is that a
 * missing dependency is stated once, clearly, instead of surfacing later as an
 * agent that mysteriously does less than it should.
 */
let preflightReport: PreflightReport | null = null;

// One-time reclaim: existing installs still have the old index on disk
// (3.4 GB on the machine this was found on). Nothing reads it any more, so
// remove it rather than leaving it orphaned. Best-effort and never fatal —
// a locked file just means it gets cleared on some later launch.
setTimeout(() => {
  const userData = app.getPath('userData');
  for (const name of ['dex-index.sqlite3', 'dex-index.sqlite3-wal', 'dex-index.sqlite3-shm']) {
    const target = path.join(userData, name);
    try {
      if (fs.existsSync(target)) {
        fs.rmSync(target, { force: true });
        mainLogger.info('search.legacyIndex.removed', { target });
      }
    } catch (err) {
      mainLogger.warn('search.legacyIndex.removeFailed', { target, error: (err as Error).message });
    }
  }
}, 10_000);

// How an agent reaches its own browser tab, and nothing else (cdpBroker.ts):
// a private loopback endpoint with one secret link per task. Started when the
// app is ready; engines get their link through cdpFor().
// The agent's input to a shared page (docs/unify/PLAN.md §3.4–3.5): wait while
// you're using the page, glide DEX's cursor to the spot and let it arrive
// before the click lands, and keep the cursor — and your password, code and
// card fields (workspace/secretFields.ts) — out of what the agent sees.
const AGENT_INPUT = new Set([
  'Input.dispatchMouseEvent', 'Input.dispatchKeyEvent', 'Input.insertText', 'Input.dispatchTouchEvent',
  'Input.synthesizeScrollGesture', 'Input.synthesizeTapGesture', 'Input.dispatchDragEvent', 'Input.imeSetComposition',
]);
type CursorTarget = Parameters<typeof moveCursor>[0];
const workspaceHooks: BrokerHooks = {
  async beforeCommand(wc, method, params, { child }) {
    // A tab off your screen wakes on the stage while the agent uses it; a
    // screenshot right after waking waits for the page to draw.
    const woke = browserPool.noteAgentUse(wc as unknown as Electron.WebContents);
    if (woke && method === 'Page.captureScreenshot') await waitForFrame(wc as unknown as CursorTarget);
    if (AGENT_INPUT.has(method)) {
      await waitForUserIdle(wc);
      if (!child && method === 'Input.dispatchMouseEvent') {
        const type = params.type;
        if (type === 'mouseMoved' || type === 'mousePressed' || type === 'mouseWheel') {
          await moveCursor(wc as unknown as CursorTarget, Number(params.x), Number(params.y), type === 'mousePressed');
        }
      }
      noteAgentInput(wc, 400);
    } else if (method === 'Page.captureScreenshot' && !child) {
      await Promise.all([
        setCursorVisible(wc as unknown as CursorTarget, false),
        maskSecretFields(wc as unknown as CursorTarget, true),
      ]);
    }
  },
  afterCommand(wc, method, _params, { child }) {
    if (AGENT_INPUT.has(method)) noteAgentInput(wc, 250);
    else if (method === 'Page.captureScreenshot' && !child) {
      void setCursorVisible(wc as unknown as CursorTarget, true);
      void maskSecretFields(wc as unknown as CursorTarget, false);
    }
  },
  // You used the page between the agent's commands: it hears so on its next
  // one, instead of acting on a page that's no longer what it last saw.
  noticeFor(wc) {
    const acts = takeUserActsSinceAgent(wc);
    if (acts.length === 0) return null;
    const did = acts.length === 1 ? acts[0] : `${acts.slice(0, -1).join(', ')} and ${acts[acts.length - 1]}`;
    const url = wc.isDestroyed() ? '' : wc.getURL();
    return `The user ${did} in this page since your last command${url ? ` (now at ${url})` : ''}. `
      + 'It may have changed: look again before your next action, and don\'t undo what they did.';
  },
  async filterResult(wc, method, result) {
    if (!READS_PAGE.has(method)) return result;
    const secrets = await secretValues(wc as unknown as CursorTarget);
    if (secrets.length === 0) return result;
    const { value, hits } = redactSecrets(result, secrets);
    if (hits > 0) mainLogger.info('workspace.secrets.redacted', { method, hits });
    return value;
  },
};
const cdpBroker = new CdpBroker(
  (sessionId) => browserPool.getAllWebContents(sessionId) as unknown as BrokerContents[],
  workspaceHooks,
);
let cdpBrokerReady: boolean | null = null;

function cdpFor(sessionId: string): { cdpPort: number; cdpWsUrl: string } {
  const endpoint = cdpBroker.endpointFor(sessionId);
  return { cdpPort: endpoint.port, cdpWsUrl: endpoint.wsUrl };
}

/**
 * Last handshake result per connection, from the startup check or an explicit
 * re-check. Settings reads it so the dots are already meaningful when the pane
 * opens, instead of every visit paying for a fresh round of npx spawns.
 */
const mcpVerifyCache = new Map<string, { ok: boolean; serverName?: string; toolCount?: number; error?: string }>();

function refreshPreflight(cdpVerified: boolean | null = null): PreflightReport {
  preflightReport = runPreflight({
    env: process.env,
    harnessPath: harnessDir(),
    cdpPort: cdpBroker.listeningPort || null,
    cdpVerified: cdpVerified ?? cdpBrokerReady,
    devtoolsPort: devtoolsPort?.port ?? null,
  });
  for (const line of formatPreflightForLog(preflightReport)) {
    const missing = line.startsWith('[FAIL]');
    if (missing) mainLogger.error('main.preflight', { line });
    else mainLogger.info('main.preflight', { line });
  }
  return preflightReport;
}

refreshPreflight();

const browserPool = new BrowserPool();
let interruptBrowserSessionFromShortcut: ((sessionId: string) => boolean) | null = null;
const resourceMonitorContext: ResourceMonitorContext = {
  browserSessions: () => browserPool.getStats().sessions,
  sessionInfo: (sessionId) => sessionManager.getResourceInfo(sessionId),
};
// Push browser-gone notifications to the shell renderer so the UI can stop
// showing "Browser starting…" when a WebContents is destroyed or crashes.
browserPool.setOnGone((sessionId) => {
  if (shellWindow && !shellWindow.isDestroyed()) {
    shellWindow.webContents.send('sessions:browser-gone', sessionId);
  }
  takeoverOverlay.hide(sessionId, shellWindow);
  // An idle session whose browser is gone has nothing left to do — promote
  // to 'stopped' so the UI stops showing "Idle" and renders the end state.
  sessionManager.markBrowserEnded(sessionId);
});
// Keep each session's primarySite + lastUrl in sync with the actual page —
// the browser is the source of truth. Covers agent-driven navigation and
// any clicks the user makes inside the attached view.
browserPool.setOnNavigate((sessionId, url) => {
  sessionManager.updateNavigationFromUrl(sessionId, url);
});
// The workspace's tab strip follows every tab change (opened, closed,
// switched, navigated, retitled, loading).
browserPool.setOnTabsChanged((sessionId, tabs) => {
  if (shellWindow && !shellWindow.isDestroyed()) {
    shellWindow.webContents.send('workspace:tabs-changed', sessionId, tabs);
  }
});
browserPool.setOnFocusAddress((sessionId) => {
  if (shellWindow && !shellWindow.isDestroyed()) {
    shellWindow.webContents.focus();
    shellWindow.webContents.send('workspace:focus-address', sessionId);
  }
});
browserPool.setOnInterruptShortcut((sessionId) => {
  return interruptBrowserSessionFromShortcut?.(sessionId) ?? false;
});
const accountStore = new AccountStore();
const whatsAppAdapter = new WhatsAppAdapter();
const channelRouter = new ChannelRouter(sessionManager, whatsAppAdapter);

type SettingsOpenPayload = {
  focusBrowserCodeProvider?: string;
};

function normalizeSettingsOpenPayload(payload: unknown): SettingsOpenPayload | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const rawProvider = (payload as { focusBrowserCodeProvider?: unknown }).focusBrowserCodeProvider;
  if (typeof rawProvider !== 'string') return undefined;
  const providerId = rawProvider.trim();
  if (!providerId || providerId.length > 80) return undefined;
  return { focusBrowserCodeProvider: providerId };
}

function openSettingsInShell(payload?: SettingsOpenPayload): void {
  if (!shellWindow || shellWindow.isDestroyed()) return;
  shellWindow.show();
  shellWindow.focus();
  shellWindow.webContents.send('open-settings', payload);
}

function restorableResumeUrl(lastUrl: string | null | undefined): string {
  if (!lastUrl) return 'about:blank';
  try {
    const parsed = new URL(lastUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'file:') {
      return lastUrl;
    }
  } catch {
    // Fall through to the blank page fallback.
  }
  return 'about:blank';
}

// ---------------------------------------------------------------------------
// Single-instance focus
// ---------------------------------------------------------------------------
function handleSecondInstanceLaunch(): void {
  mainLogger.info('main.singleInstance.focusExisting', {
    currentVersion: app.getVersion(),
  });
  showAndFocusPrimaryWindow();
}

function showAndFocusPrimaryWindow(): void {
  const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
  const preferred = [shellWindow, onboardingWindow, BrowserWindow.getFocusedWindow(), ...windows]
    .find((win): win is BrowserWindow => Boolean(win && !win.isDestroyed()));

  if (preferred) {
    if (preferred.isMinimized()) preferred.restore();
    preferred.show();
    preferred.focus();
    return;
  }

  setTimeout(() => {
    if (BrowserWindow.getAllWindows().some((win) => !win.isDestroyed())) return;
    if (accountStore.isOnboardingComplete()) {
      openShellAndWire();
      return;
    }
    onboardingWindow = createOnboardingWindow();
    onboardingWindow.on('closed', () => {
      mainLogger.info('main.onboardingWindow.closed');
      onboardingWindow = null;
    });
  }, 100);
}

// ---------------------------------------------------------------------------
// Shell window factory
// ---------------------------------------------------------------------------
function openShellAndWire(): BrowserWindow {
  mainLogger.info('main.openShellAndWire', { msg: 'Creating shell window' });

  shellWindow = createShellWindow();

  // Pill, Logs, and the app-popup window are all created lazily now, on
  // first actual use (togglePill/showLogs/toggleLogs/focusLogsFollowUp/
  // openAppPopup each self-create) rather than eagerly here — three
  // full extra Electron renderer processes sitting hidden from launch,
  // for surfaces a given session might never open, was real idle RAM cost
  // for no benefit. attachToHub still runs unconditionally: it wires
  // hub-level listeners (resize/focus/blur/minimize) that check whether
  // the logs window exists each time they fire, so it works whether or
  // not that window has been created yet.
  attachLogsToHub(shellWindow);
  mainLogger.info('main.tray.beforeCreate', { typeofCreateTray: typeof createTray });
  try {
    createTray(sessionManager);
    mainLogger.info('main.tray.afterCreate');
  } catch (err) {
    mainLogger.warn('main.tray.threw', { error: (err as Error).message, stack: (err as Error).stack });
  }
  const togglePillAndNotify = () => {
    togglePill();
    if (shellWindow && !shellWindow.isDestroyed()) {
      shellWindow.webContents.send('pill-toggled');
    }
  };
  const hotkeyOk = registerHotkeys(togglePillAndNotify);
  if (!hotkeyOk) {
    mainLogger.warn('main.hotkey', { msg: 'Global hotkey registration failed — another app may own it' });
  }

  registerApiKeyHandlers();
  captureEvent('app_launched');

  ipcMain.handle('hotkeys:get-global', () => getGlobalCmdbarAccelerator());
  ipcMain.handle('hotkeys:set-global', (_e, accel: string) => {
    const result = setGlobalCmdbarAccelerator(accel);
    if (result.ok) {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('hotkeys:global-changed', result.accelerator);
      }
      refreshTrayMenu();
    }
    return result;
  });

  // Cmd+K is handled by the hub renderer's own keydown listener (CommandBar).
  // No before-input-event intercept needed — let the key pass through to the DOM.

  buildApplicationMenu();

  shellWindow.webContents.once('did-finish-load', () => {
    mainLogger.info('main.shellReady', { windowId: shellWindow?.id });
    shellWindow?.webContents.send('window-ready');
    shellWindow?.webContents.executeJavaScript('localStorage.getItem("hub-zoom-factor")')
      .then((saved) => {
        if (saved && shellWindow && !shellWindow.isDestroyed()) {
          const factor = parseFloat(saved);
          if (factor >= 0.5 && factor <= 2.0) {
            mainLogger.info('main.zoom.restore', { factor });
            shellWindow.webContents.setZoomFactor(factor);
            shellWindow.webContents.send('zoom-changed', factor);
          }
        }
      })
      .catch(() => {});

    const waAuthDir = path.join(app.getPath('userData'), 'whatsapp-auth');
    if (fs.existsSync(path.join(waAuthDir, 'creds.json'))) {
      mainLogger.info('main.whatsapp.autoReconnect', { authDir: waAuthDir });
      whatsAppAdapter.connect().catch((err) => {
        mainLogger.warn('main.whatsapp.autoReconnect.failed', { error: (err as Error).message });
      });
    }
  });

  shellWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      shellWindow?.hide();
      mainLogger.info('main.shellWindow.hidden', { msg: 'Window hidden (Cmd+Q to quit)' });
      return;
    }
  });

  shellWindow.on('closed', () => {
    mainLogger.info('main.shellWindow.closed');
    shellWindow = null;
    destroyStage();
  });

  // Closed to the tray or minimized: the task on screen moves to the stage, so
  // the agent can still see its page.
  const syncWindowHidden = () => {
    if (!shellWindow || shellWindow.isDestroyed()) return;
    browserPool.setWindowHidden(!shellWindow.isVisible() || shellWindow.isMinimized());
  };
  for (const event of ['hide', 'show', 'minimize', 'restore'] as const) {
    shellWindow.on(event as 'hide', syncWindowHidden);
  }

  mainLogger.info('main.openShellAndWire.done', { windowId: shellWindow.id });
  return shellWindow;
}

// ---------------------------------------------------------------------------
// App ready
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  mainLogger.info('main.appReady', { msg: 'Electron app ready — initializing DEX' });
  // GPU status is only meaningful once a window has actually composited a
  // frame: queried at whenReady() — before any window exists — Chromium
  // always reports "disabled_software", which is a pending state, not a
  // verdict. Reading it too early is exactly how an earlier pass here
  // misdiagnosed this machine as stuck in software rendering and added
  // ignore-gpu-blocklist/disable-gpu-driver-bug-workarounds switches that
  // fixed nothing (a bare Electron app with no flags reports "enabled"
  // here once its window paints). Deferred so the number logged is real.
  setTimeout(() => {
    try {
      mainLogger.info('main.gpuFeatureStatus', app.getGPUFeatureStatus() as unknown as Record<string, unknown>);
    } catch (err) {
      mainLogger.warn('main.gpuFeatureStatus.failed', { error: (err as Error).message });
    }
  }, 8000);
  startResourceMonitor(resourceMonitorContext);

  // The agents' private way into their tabs. Fold the result into the
  // environment report as soon as it's known.
  cdpBroker.start().then((port) => {
    cdpBrokerReady = true;
    mainLogger.info('main.cdpBroker.ready', { port });
    refreshPreflight(true);
  }).catch((err) => {
    cdpBrokerReady = false;
    mainLogger.error('main.cdpBroker.failed', { error: (err as Error).message });
    refreshPreflight(false);
  });

  // Only when the raw port was asked for: check it's really ours, not a
  // browser that already held that port.
  if (devtoolsPort && devtoolsPort.port !== 0) {
    verifyCdpOwnership(devtoolsPort.port).then((v) => {
      if (v.ok) {
        mainLogger.info('main.cdp.verified', { port: devtoolsPort.port, browser: v.browser, userAgent: v.userAgent });
      } else {
        mainLogger.error('main.cdp.verifyFailed', {
          port: devtoolsPort.port,
          portSource: devtoolsPort.source,
          browser: v.browser ?? null,
          userAgent: v.userAgent ?? null,
          error: v.error ?? null,
        });
      }
    });
  }

  if (process.platform === 'darwin' && app.dock) {
    try {
      await app.dock.show();
      const iconFile = app.isPackaged ? 'icon.png' : 'icon-dev.png';
      const iconPath = path.resolve(app.getAppPath(), 'assets', iconFile);
      mainLogger.info('main.dockIcon', { iconPath, exists: fs.existsSync(iconPath) });
      if (fs.existsSync(iconPath)) {
        const icon = nativeImage.createFromPath(iconPath);
        mainLogger.info('main.dockIcon.loaded', { isEmpty: icon.isEmpty(), size: icon.getSize() });
        if (!icon.isEmpty()) {
          app.dock.setIcon(icon);
        }
      }
    } catch (err) {
      mainLogger.error('main.dockIcon.error', { error: (err as Error).message });
    }
  }

  // ---------------------------------------------------------------------------
  // Channel IPC handlers (registered early so onboarding can use them too)
  // ---------------------------------------------------------------------------
  registerConsentHandlers();
  registerTelemetryHandlers();
  registerAppPopupHandlers();
  registerAccountsIpc();
  registerSetupIpc();
  registerProfileIpc();
  startSystemThemeWatcher();
  registerChannelHandlers(channelRouter, whatsAppAdapter);
  whatsAppAdapter.onStatusChange((status, detail) => {
    const target = shellWindow ?? onboardingWindow;
    if (target && !target.isDestroyed()) {
      target.webContents.send('channel-status', 'whatsapp', status, detail);
    }
  });
  whatsAppAdapter.onQr((dataUrl) => {
    const target = shellWindow ?? onboardingWindow;
    if (target && !target.isDestroyed()) {
      target.webContents.send('whatsapp-qr', dataUrl);
    }
  });

  async function stampConfiguredSessionModel(id: string, engineId: string, source: string): Promise<void> {
    if (engineId !== 'browsercode') return;
    try {
      const cfg = await loadBrowserCodeConfig();
      const model = cfg?.model?.trim();
      if (!model) {
        mainLogger.warn('main.sessionModel.missing', {
          id,
          engineId,
          source,
          providerId: cfg?.providerId ?? null,
          hasBrowserCodeConfig: Boolean(cfg),
        });
        return;
      }
      sessionManager.setSessionModel(id, model);
      mainLogger.info('main.sessionModel.stamped', {
        id,
        engineId,
        source,
        providerId: cfg?.providerId ?? null,
        model,
      });
    } catch (err) {
      mainLogger.warn('main.sessionModel.stampFailed', {
        id,
        engineId,
        source,
        error: (err as Error).message,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Pill IPC handlers
  // ---------------------------------------------------------------------------

  // Active HL agent abort controllers keyed by task_id
  const activeAgents = new Map<string, AbortController>();
  type QueuedFollowUp = {
    prompt: string;
    attachments: ValidatedAttachment[];
  };
  const queuedFollowUps = new Map<string, QueuedFollowUp[]>();
  const drainingQueuedFollowUps = new Set<string>();
  const activeRunIds = new Map<string, number>();
  const activeRunControls = new Map<string, { runId: number; control: EngineRunControl }>();
  let nextRunId = 0;
  const startingSessionIds = new Set<string>();

  // pill:submit — creates a session via the standard pipeline, hides pill
  ipcMain.handle('pill:submit', async (_event, payload: unknown) => {
    let promptRaw: unknown;
    let attachmentsRaw: unknown;
    if (typeof payload === 'string') {
      promptRaw = payload;
    } else if (payload && typeof payload === 'object') {
      promptRaw = (payload as { prompt?: unknown }).prompt;
      attachmentsRaw = (payload as { attachments?: unknown }).attachments;
    } else {
      throw new Error('pill:submit payload must be a string or { prompt, attachments? }');
    }
    const validatedPrompt = assertString(promptRaw, 'prompt', 10000);
    const attachments = assertAttachments(attachmentsRaw);
    mainLogger.info('main.pill:submit', {
      promptLength: validatedPrompt.length,
      attachmentCount: attachments.length,
    });

    hidePill();

    const id = sessionManager.createSession(validatedPrompt);
    // Stamp the engine so the hub card shows the provider icon. Respect
    // an explicit engine from the pill payload, else default to the
    // canonical per-session default. getEngine() returns the legacy
    // global ('hl-inprocess') which isn't a valid per-session engine id.
    const pillEngineRaw = typeof payload === 'object' && payload !== null
      ? (payload as { engine?: unknown }).engine
      : undefined;
    const pillEngineId = typeof pillEngineRaw === 'string' && pillEngineRaw.length > 0
      ? pillEngineRaw
      : DEFAULT_ENGINE_ID;
    sessionManager.setSessionEngine(id, pillEngineId);
    // Same contract as sessions:create — absent/empty means "engine default",
    // and we then never pass a model flag at all.
    const pillModelRaw = typeof payload === 'object' && payload !== null
      ? (payload as { model?: unknown }).model
      : undefined;
    if (typeof pillModelRaw === 'string' && pillModelRaw.length > 0) {
      sessionManager.setSessionModel(id, assertString(pillModelRaw, 'model', 100));
    }
    if (attachments.length > 0) {
      const turnIndex = sessionManager.getNextAttachmentTurnIndex(id);
      for (const a of attachments) {
        sessionManager.saveAttachment(id, a, turnIndex);
      }
    }
    captureEvent('session_created', {
      source: 'pill',
      engine: pillEngineId,
      prompt_length: validatedPrompt.length,
      attachments_count: attachments.length,
    });
    startSessionWithAgent(id).catch((err) => {
      mainLogger.error('main.pill:submit.startFailed', { id, error: (err as Error).message });
    });

    // If onboarding is active, notify it so it can auto-complete and open the shell
    if (onboardingWindow && !onboardingWindow.isDestroyed()) {
      mainLogger.info('main.pill:submit.notifyOnboarding', { id });
      onboardingWindow.webContents.send('onboarding-task-submitted', id);
    }

    return { task_id: id };
  });

  // pill:cancel — cancels the running task
  ipcMain.handle('pill:cancel', async (_event, { task_id }: { task_id: string }) => {
    mainLogger.info('main.pill:cancel', { task_id });
    const ctrl = activeAgents.get(task_id);
    if (ctrl) {
      ctrl.abort();
      activeAgents.delete(task_id);
      return { cancelled: true };
    }
    return { cancelled: false };
  });

  // pill:hide — hide the pill window
  ipcMain.handle('pill:hide', async () => {
    mainLogger.info('main.pill:hide');
    hidePill();
  });

  // pill:toggle — toggle the pill window from renderer
  ipcMain.handle('pill:toggle', async () => {
    mainLogger.info('main.pill:toggle');
    togglePill();
    if (shellWindow && !shellWindow.isDestroyed()) {
      shellWindow.webContents.send('pill-toggled');
    }
  });

  ipcMain.on('pill:select-session', (_event, id: string) => {
    mainLogger.info('main.pill:selectSession', { id });
    hidePill();
    if (shellWindow && !shellWindow.isDestroyed()) {
      shellWindow.show();
      shellWindow.focus();
      shellWindow.webContents.send('select-session', id);
    }
  });

  // pill:set-expanded — grow/shrink pill window
  ipcMain.handle('pill:set-expanded', (_event, expandedOrHeight: boolean | number) => {
    if (typeof expandedOrHeight === 'number') {
      setPillHeight(Math.max(PILL_HEIGHT_COLLAPSED, Math.min(expandedOrHeight, PILL_HEIGHT_EXPANDED)));
    } else {
      setPillHeight(expandedOrHeight ? PILL_HEIGHT_EXPANDED : PILL_HEIGHT_COLLAPSED);
    }
  });

  // pill:get-tabs — no tabs in Browser Use Desktop, return empty
  ipcMain.handle('pill:get-tabs', () => {
    return { tabs: [], activeTabId: null };
  });

  // ---------------------------------------------------------------------------
  // Logs overlay IPC
  // ---------------------------------------------------------------------------
  ipcMain.handle('logs:toggle', (_evt, sessionId: string, anchor?: { x: number; y: number; width: number; height: number }) => {
    mainLogger.info('main.logs:toggle', { sessionId, anchor });
    return toggleLogs(sessionId, anchor ?? null);
  });
  ipcMain.handle('logs:show', (_evt, sessionId: string, anchor?: { x: number; y: number; width: number; height: number }) => {
    mainLogger.info('main.logs:show', { sessionId, anchor });
    showLogs(sessionId, anchor ?? null);
    return true;
  });
  ipcMain.handle('logs:close', () => {
    mainLogger.info('main.logs:close');
    hideLogs();
  });
  ipcMain.on('logs:close', () => {
    mainLogger.info('main.logs:close (send)');
    hideLogs();
  });
  // Fire-and-forget anchor update during rapid window resize — avoids the
  // invoke round-trip cost at 60+ events/sec.
  ipcMain.on('logs:update-anchor', (_evt, anchor: { x: number; y: number; width: number; height: number }) => {
    if (!anchor || typeof anchor.x !== 'number') return;
    updateLogsAnchor(anchor);
  });
  ipcMain.on('logs:set-mode', (_evt, nextMode: 'dot' | 'normal' | 'full') => {
    mainLogger.info('main.logs:set-mode', { nextMode });
    if (nextMode === 'dot' || nextMode === 'normal' || nextMode === 'full') {
      setLogsMode(nextMode);
    }
  });
  ipcMain.handle('logs:focus-followup', (_evt, sessionId: string, anchor?: { x: number; y: number; width: number; height: number }) => {
    mainLogger.info('main.logs:focus-followup', { sessionId, anchor });
    focusLogsFollowUp(sessionId, anchor ?? null);
  });

  // ---------------------------------------------------------------------------
  // HL engine IPC
  // ---------------------------------------------------------------------------
  ipcMain.handle('hl:get-engine', () => getEngine());
  ipcMain.handle('hl:set-engine', (_event, { engine }: { engine: string }) => {
    const e: EngineId = 'hl-inprocess';
    setEngine(e);
    return e;
  });

  // ---------------------------------------------------------------------------
  // Session IPC handlers
  // ---------------------------------------------------------------------------

  const notifiedStuck = new Set<string>();
  const notifiedStarted = new Set<string>();
  const forwardSessionUpdatedToLogs = (session: unknown): void => {
    const logsWin = getLogsWindow();
    if (logsWin && !logsWin.isDestroyed()) {
      logsWin.webContents.send('session-updated', session);
    }
  };
  sessionManager.onEvent('session-updated', (session) => {
    shellWindow?.webContents.send('session-updated', session);
    sendToPill('session-updated', session);
    forwardSessionUpdatedToLogs(session);
    if (session.status === 'running' && !notifiedStarted.has(session.id)) {
      notifiedStarted.add(session.id);
      sendSessionNotification({
        title: 'Task started',
        body: `"${session.prompt.slice(0, 120)}"`,
        sessionId: session.id,
        shellWindow,
      });
    }
    if (session.status === 'stuck' && !notifiedStuck.has(session.id)) {
      notifiedStuck.add(session.id);
      sendSessionNotification({
        title: 'Session stuck',
        body: `"${session.prompt.slice(0, 80)}" needs input`,
        sessionId: session.id,
        shellWindow,
      });
    }
    if (session.status !== 'stuck') notifiedStuck.delete(session.id);
  });
  sessionManager.onEvent('session-completed', (session) => {
    shellWindow?.webContents.send('session-updated', session);
    sendToPill('session-updated', session);
    forwardSessionUpdatedToLogs(session);
    notifiedStuck.delete(session.id);
    browserPool.closeTemporaryTabs(session.id);
    browserPool.markSessionIdle(session.id);
    const doneEvent = session.output.find(
      (e: { type: string }) => e.type === 'done',
    ) as { type: string; summary?: string } | undefined;
    const summary = doneEvent?.summary ?? 'Task completed';
    captureEvent('session_completed', {
      engine: (session as { engine?: string }).engine ?? 'unknown',
      success: Boolean(doneEvent),
      has_summary: Boolean(doneEvent?.summary),
    });
    sendSessionNotification({
      title: 'Session done',
      body: `"${session.prompt.slice(0, 60)}" — ${summary.slice(0, 80)}`,
      sessionId: session.id,
      shellWindow,
    });
  });
  sessionManager.onEvent('session-error', (session) => {
    shellWindow?.webContents.send('session-updated', session);
    sendToPill('session-updated', session);
    forwardSessionUpdatedToLogs(session);
    notifiedStuck.delete(session.id);
    sendSessionNotification({
      title: 'Session failed',
      body: `"${session.prompt.slice(0, 60)}" — ${session.error ?? 'Unknown error'}`,
      sessionId: session.id,
      shellWindow,
    });
  });
  sessionManager.onEvent('session-output', (id, line) => {
    shellWindow?.webContents.send('session-output', id, line);
    sendToPill('session-output', { id, line });
    // Logs window needs structured events live (file_output, done, etc.) —
    // not only at the next session-updated snapshot, which lags.
    const logsWin = getLogsWindow();
    if (logsWin && !logsWin.isDestroyed()) {
      logsWin.webContents.send('session-output', id, line);
    }
  });
  sessionManager.onEvent('session-output-term', (id, bytes) => {
    shellWindow?.webContents.send('session-output-term', id, bytes);
    sendToPill('session-output-term', { id, bytes });
    const logsWin = getLogsWindow();
    if (logsWin && !logsWin.isDestroyed()) {
      logsWin.webContents.send('session-output-term', id, bytes);
    }
  });
  ipcMain.handle('sessions:get-term-replay', (_evt, id: string) => {
    return sessionManager.getTermReplay(id);
  });

  async function assertSessionEngineReady(id: string): Promise<string> {
    const engineId = sessionManager.getSessionEngine(id) ?? DEFAULT_ENGINE_ID;
    const { getAdapter } = await import('./hl/engines');
    const adapter = getAdapter(engineId);
    if (!adapter) throw new Error(`unknown engine: ${engineId}`);

    const [installed, authed] = await Promise.all([adapter.probeInstalled(), adapter.probeAuthed()]);
    mainLogger.info('main.session.engine.preflight', {
      id,
      engineId,
      displayName: adapter.displayName,
      installed: installed.installed,
      installedVersion: installed.version ?? null,
      installedError: installed.error ?? null,
      authed: authed.authed,
      authError: authed.error ?? null,
    });
    if (!installed.installed) {
      throw new Error(`${adapter.displayName} is not installed. Install ${adapter.displayName} and try again.`);
    }
    if (!authed.authed) {
      throw new Error(`You aren't authenticated into ${adapter.displayName}. Please re-authenticate to ${adapter.displayName} and try again.`);
    }

    return engineId;
  }

  function beginEngineRun(id: string): number {
    const runId = ++nextRunId;
    activeRunIds.set(id, runId);
    return runId;
  }

  function endEngineRun(id: string, runId: number): void {
    if (activeRunIds.get(id) === runId) {
      activeRunIds.delete(id);
    }
    if (activeRunControls.get(id)?.runId === runId) {
      activeRunControls.delete(id);
    }
  }

  function bindRunControl(id: string, runId: number): (control: EngineRunControl) => void {
    return (control) => {
      if (activeRunIds.get(id) !== runId) return;
      activeRunControls.set(id, { runId, control });
    };
  }

  function terminateActiveRunControl(id: string): void {
    const active = activeRunControls.get(id);
    if (!active) return;
    active.control.terminate();
    activeRunControls.delete(id);
  }

  function pauseSessionFromMain(
    id: string,
    source: 'button' | 'browser-ctrl-c' | 'logs-ctrl-c' | 'queued-follow-up',
    opts: { notify?: boolean } = {},
  ): { paused?: boolean; error?: string } {
    const status = sessionManager.getSessionStatus(id);
    if (status !== 'running' && status !== 'stuck') {
      return { error: `Session ${id} is ${status ?? 'unknown'}, expected running or stuck` };
    }
    const active = activeRunControls.get(id);
    if (!active) {
      return { error: 'Session is still starting and cannot be paused yet. Try again in a moment.' };
    }
    const controlResult = active.control.pause();
    if (!controlResult.paused) return controlResult;

    const result = sessionManager.pauseSession(id, opts);
    if (result.paused) {
      takeoverOverlay.hide(id, shellWindow);
      captureEvent('session_paused', {
        engine: sessionManager.getSessionEngine(id) ?? 'unknown',
        source,
      });
    } else {
      active.control.resume();
    }
    return result;
  }

  function resumePausedRun(id: string, source: 'button' | 'logs' | 'resume'): { resumed?: boolean; error?: string } {
    const active = activeRunControls.get(id);
    if (!active) {
      return { error: 'Paused agent process is no longer available.' };
    }
    const controlResult = active.control.resume();
    if (!controlResult.resumed) return controlResult;
    const result = sessionManager.resumePausedSession(id);
    if (result.resumed) {
      captureEvent('session_resumed', {
        engine: sessionManager.getSessionEngine(id) ?? 'unknown',
        source,
      });
    } else {
      active.control.pause();
    }
    return result;
  }

  function cancelSessionFromMain(
    id: string,
    source: 'button' | 'browser-ctrl-c' | 'logs-ctrl-c',
  ): { cancelled?: boolean; error?: string } {
    const status = sessionManager.getSessionStatus(id);
    if (status !== 'running' && status !== 'stuck' && status !== 'paused') {
      return { error: `Session ${id} is ${status ?? 'unknown'}, expected running, stuck, or paused` };
    }
    const engine = sessionManager.getSessionEngine(id) ?? 'unknown';
    terminateActiveRunControl(id);
    sessionManager.cancelSession(id);
    browserPool.destroy(id, shellWindow ?? undefined);
    queuedFollowUps.delete(id);
    drainingQueuedFollowUps.delete(id);
    captureEvent('session_cancelled', { engine, source });
    return { cancelled: true };
  }

  interruptBrowserSessionFromShortcut = (sessionId) => {
    const status = sessionManager.getSessionStatus(sessionId);
    if (status === 'paused') {
      const result = cancelSessionFromMain(sessionId, 'browser-ctrl-c');
      return result.cancelled === true;
    }
    if (status === 'running' || status === 'stuck') {
      const result = pauseSessionFromMain(sessionId, 'browser-ctrl-c');
      return result.paused === true;
    }
    return false;
  };

  function queueFollowUpAfterNextTool(id: string, prompt: string, attachments: ValidatedAttachment[]): { queued?: boolean; error?: string } {
    const session = sessionManager.getSession(id);
    if (!session) return { error: 'Session not found' };
    if (session.status !== 'running' && session.status !== 'stuck' && session.status !== 'paused') {
      return { error: `Session ${id} is ${session.status}, expected running, stuck, or paused` };
    }
    const q = queuedFollowUps.get(id) ?? [];
    q.push({ prompt, attachments });
    queuedFollowUps.set(id, q);
    sessionManager.appendOutput(id, {
      type: 'notify',
      level: 'info',
      message: 'Follow-up queued. It will run after the next tool call.',
    });
    mainLogger.info('main.sessions.followUpQueued', {
      id,
      queuedCount: q.length,
      promptLength: prompt.length,
      attachmentCount: attachments.length,
    });
    captureEvent('session_followup_queued', {
      engine: sessionManager.getSessionEngine(id) ?? 'unknown',
      attachments_count: attachments.length,
    });
    return { queued: true };
  }

  function shouldIgnoreEngineEvent(id: string, eventType: HlEvent['type'] | 'exception', runId?: number): boolean {
    const activeRunId = activeRunIds.get(id);
    if (runId != null && activeRunId != null && activeRunId !== runId) {
      mainLogger.info('main.engineEvent.ignoredStaleRun', { id, eventType, runId, activeRunId });
      return true;
    }
    const status = sessionManager.getSessionStatus(id);
    if (status === 'paused' || status === 'stopped') {
      mainLogger.info('main.engineEvent.ignored', { id, status, eventType });
      return true;
    }
    return false;
  }

  function handleEngineEvent(id: string, event: HlEvent, runId?: number): void {
    if (shouldIgnoreEngineEvent(id, event.type, runId)) return;
    if (event.type === 'done') {
      sessionManager.appendOutput(id, event);
      sessionManager.completeSession(id);
      void drainQueuedFollowUp(id, 'done');
    } else if (event.type === 'error') {
      sessionManager.failSession(id, event.message);
      browserPool.destroy(id, shellWindow ?? undefined);
      queuedFollowUps.delete(id);
    } else {
      sessionManager.appendOutput(id, event);
      if (event.type === 'tool_result') {
        void drainQueuedFollowUp(id, 'tool_result');
      }
    }
  }

  function handleEngineRunError(id: string, err: Error, source: string, runId?: number): void {
    if (shouldIgnoreEngineEvent(id, 'exception', runId)) return;
    mainLogger.error(source, { id, error: err.message });
    sessionManager.failSession(id, err.message);
    browserPool.destroy(id, shellWindow ?? undefined);
    queuedFollowUps.delete(id);
  }

  /** Show what the user attached, on their message in the chat (desktop + phone). */
  function noteUserAttachments(sessionId: string, items: Array<{ name: string; mime: string; size: number }>): void {
    if (items.length === 0) return;
    sessionManager.appendOutput(sessionId, { type: 'user_attachments', items });
  }

  async function resumeSessionWithAgent(
    validatedId: string,
    validatedPrompt: string,
    resumeAttachments: ValidatedAttachment[],
    source: 'resume' | 'queued-follow-up',
  ): Promise<{ resumed?: boolean; error?: string }> {
    const currentSession = sessionManager.getSession(validatedId);
    if (!currentSession) return { error: 'Session not found' };
    if (currentSession.status !== 'idle' && currentSession.status !== 'paused' && currentSession.status !== 'stopped') {
      return { error: `Session ${validatedId} is ${currentSession.status}, expected idle, paused, or stopped` };
    }
    // A fresh prompt reaching the engine is a new conversational turn —
    // 'turn'-lifetime approvals from the previous one do not carry forward.
    approvalPolicy.startTurn(validatedId);
    await browserPool.markSessionActive(validatedId);

    if (resumeAttachments.length > 0) {
      const turnIndex = sessionManager.getNextAttachmentTurnIndex(validatedId);
      for (const a of resumeAttachments) {
        sessionManager.saveAttachment(validatedId, a, turnIndex);
      }
      mainLogger.info('main.sessions:resume.persistedAttachments', { id: validatedId, turnIndex, count: resumeAttachments.length, source });
    }

    let webContents = browserPool.getWebContents(validatedId);
    if (!webContents) {
      const restoreUrl = restorableResumeUrl(currentSession.lastUrl);
      mainLogger.info('main.sessions:resume.recreateBrowser', {
        id: validatedId,
        hasLastUrl: Boolean(currentSession.lastUrl),
        restoreUrl,
        source,
      });
      const view = browserPool.create(validatedId, Date.now());
      if (!view) {
        mainLogger.warn('main.sessions:resume.poolFull', { id: validatedId, stats: browserPool.getStats(), source });
        return { error: 'Browser pool full' };
      }
      if (shellWindow && !shellWindow.isDestroyed()) {
        browserPool.detachAll(shellWindow);
        mainLogger.info('main.sessions:resume.detachedAwaitingRenderer', { id: validatedId, source });
      }
      try {
        await view.webContents.loadURL(restoreUrl);
      } catch (err) {
        mainLogger.warn('main.sessions:resume.restoreUrl.failed', {
          id: validatedId,
          restoreUrl,
          source,
          error: (err as Error).message,
        });
        try { await view.webContents.loadURL('about:blank'); }
        catch { /* keep going; runEngine will surface target failures */ }
      }
      webContents = view.webContents;
    }

    const engineId = sessionManager.getSessionEngine(validatedId) ?? DEFAULT_ENGINE_ID;
    await stampConfiguredSessionModel(validatedId, engineId, source);
    const abortController = sessionManager.resumeSession(validatedId, validatedPrompt);
    noteUserAttachments(validatedId, resumeAttachments.map((a) => ({ name: a.name, mime: a.mime, size: a.bytes.byteLength })));
    if (resumeAttachments.length > 0) {
      mainLogger.info('main.sessions:resume.attachments', { id: validatedId, count: resumeAttachments.length, source });
    }
    captureEvent(source === 'queued-follow-up' ? 'session_followup_started' : 'session_resumed', {
      engine: engineId,
      prompt_length: validatedPrompt.length,
      attachments_count: resumeAttachments.length,
    });

    const runId = beginEngineRun(validatedId);
    runEngine({
      engineId,
      harnessDir: harnessDir(),
      sessionId: validatedId,
      originChannel: sessionManager.getSessionOrigin(validatedId).originChannel ?? undefined,
      prompt: validatedPrompt,
      attachments: resumeAttachments.map((a) => ({ name: a.name, mime: a.mime, bytes: a.bytes })),
      webContents,
      ...cdpFor(validatedId),
      signal: abortController.signal,
      resumeSessionId: sessionManager.getEngineSessionId(validatedId),
      model: sessionManager.getSessionModel(validatedId) ?? undefined,
      onRunControl: bindRunControl(validatedId, runId),
      onSessionId: (sid) => sessionManager.setEngineSessionId(validatedId, sid),
      onModelResolved: ({ model }) => sessionManager.setSessionModel(validatedId, model),
      onAuthResolved: ({ authMode, subscriptionType }) => sessionManager.setSessionAuth(validatedId, authMode, subscriptionType),
      onEvent: (event) => handleEngineEvent(validatedId, event, runId),
    }).catch((err: Error) => {
      handleEngineRunError(validatedId, err, `main.sessions:${source}.agentError`, runId);
    }).finally(() => {
      endEngineRun(validatedId, runId);
      mainLogger.info('main.sessions:resume.agentFinished', { id: validatedId, source, poolStats: browserPool.getStats() });
    });

    return { resumed: true };
  }

  async function drainQueuedFollowUp(id: string, boundary: 'tool_result' | 'done'): Promise<void> {
    if (drainingQueuedFollowUps.has(id)) return;
    const q = queuedFollowUps.get(id);
    const next = q?.shift();
    if (!next) return;
    if (q.length === 0) queuedFollowUps.delete(id);

    drainingQueuedFollowUps.add(id);
    try {
      const status = sessionManager.getSessionStatus(id);
      mainLogger.info('main.sessions.followUpDrain', { id, boundary, status });
      if (status === 'running' || status === 'stuck') {
        const ctrl = sessionManager.getAbortController(id);
        if (ctrl) ctrl.abort();
        terminateActiveRunControl(id);
        const paused = sessionManager.pauseSession(id, { notify: false });
        if (!paused.paused) {
          const existing = queuedFollowUps.get(id) ?? [];
          queuedFollowUps.set(id, [next, ...existing]);
          mainLogger.warn('main.sessions.followUpDrain.pauseFailed', { id, boundary, error: paused.error });
          return;
        }
      }

      const result = await resumeSessionWithAgent(id, next.prompt, next.attachments, 'queued-follow-up');
      if (result.error) {
        mainLogger.warn('main.sessions.followUpDrain.resumeFailed', { id, boundary, error: result.error });
        sessionManager.appendOutput(id, {
          type: 'notify',
          level: 'info',
          message: `Queued follow-up could not start: ${result.error}`,
        });
      }
    } finally {
      drainingQueuedFollowUps.delete(id);
    }
  }

  async function startSessionWithAgent(id: string): Promise<void> {
    if (startingSessionIds.has(id)) {
      mainLogger.warn('main.startSessionWithAgent.alreadyStarting', { id });
      return;
    }
    startingSessionIds.add(id);
    const t0 = Date.now();
    mainLogger.info('main.startSessionWithAgent', { id });
    let launched = false;
    let view: ReturnType<typeof browserPool.create> | null = null;

    try {
      const engineId = await assertSessionEngineReady(id);
      mainLogger.info('main.startSessionWithAgent.timing', { id, step: 'enginePreflight', ms: Date.now() - t0, engineId });
      await stampConfiguredSessionModel(id, engineId, 'start');

      const abortController = sessionManager.startSession(id);
      mainLogger.info('main.startSessionWithAgent.timing', { id, step: 'startSession', ms: Date.now() - t0 });

      view = browserPool.create(id, t0);
      await browserPool.markSessionActive(id);
      mainLogger.info('main.startSessionWithAgent.timing', { id, step: 'poolCreate', ms: Date.now() - t0 });
      if (!view) {
        sessionManager.failSession(id, `Browser pool full (max ${browserPool.activeCount}), session queued`);
        mainLogger.warn('main.startSessionWithAgent.poolFull', { id, stats: browserPool.getStats() });
        return;
      }

      if (shellWindow && !shellWindow.isDestroyed()) {
        // Detach existing views — only one session is visible at a time.
        // We DON'T attach here: main doesn't know the exact pane rect.
        // The renderer (AgentPane) is authoritative for bounds and will call
        // sessions:view-attach with the exact .pane__output getBoundingClientRect.
        browserPool.detachAll(shellWindow);
        mainLogger.info('main.startSessionWithAgent.detachedAwaitingRenderer', { id });
      }
      mainLogger.info('main.startSessionWithAgent.timing', { id, step: 'attach', ms: Date.now() - t0 });

      await view.webContents.loadURL('about:blank');
      mainLogger.info('main.startSessionWithAgent.timing', { id, step: 'loadBlank', ms: Date.now() - t0 });

      const attachmentsForRun = sessionManager.loadAttachmentsForRun(id);
      noteUserAttachments(id, attachmentsForRun.map((a) => ({ name: a.name, mime: a.mime, size: a.size })));
      if (attachmentsForRun.length > 0) {
        mainLogger.info('main.startSessionWithAgent.attachments', { id, count: attachmentsForRun.length, totalBytes: attachmentsForRun.reduce((s, a) => s + a.size, 0) });
      }
      const runId = beginEngineRun(id);
      launched = true;
      runEngine({
        engineId,
        harnessDir: harnessDir(),
        sessionId: id,
        originChannel: sessionManager.getSessionOrigin(id).originChannel ?? undefined,
        prompt: sessionManager.getSession(id)!.prompt,
        attachments: attachmentsForRun.map((a) => ({ name: a.name, mime: a.mime, bytes: a.bytes })),
        webContents: view.webContents,
        ...cdpFor(id),
        signal: abortController.signal,
        model: sessionManager.getSessionModel(id) ?? undefined,
        onRunControl: bindRunControl(id, runId),
        onSessionId: (sid) => sessionManager.setEngineSessionId(id, sid),
        onModelResolved: ({ model }) => sessionManager.setSessionModel(id, model),
        onAuthResolved: ({ authMode, subscriptionType }) => sessionManager.setSessionAuth(id, authMode, subscriptionType),
        onEvent: (event) => handleEngineEvent(id, event, runId),
      }).catch((err: Error) => {
        handleEngineRunError(id, err, 'main.startSessionWithAgent.agentError', runId);
      }).finally(() => {
        endEngineRun(id, runId);
        startingSessionIds.delete(id);
        mainLogger.info('main.startSessionWithAgent.finished', { id, poolStats: browserPool.getStats() });
      });
    } catch (err) {
      const message = (err as Error).message ?? 'Session start failed';
      mainLogger.warn('main.startSessionWithAgent.preflightFailed', { id, error: message });
      sessionManager.failSession(id, message);
      if (view) browserPool.destroy(id, shellWindow ?? undefined);
      throw err;
    } finally {
      if (!launched) {
        startingSessionIds.delete(id);
      }
    }
  }

  channelRouter.setStartSession(startSessionWithAgent);
  // A WhatsApp reply to a task's message continues that task, exactly like
  // the hub's follow-up box.
  channelRouter.setFollowUp((id, text) => handleResumeRequest(id, text, []));

  /** Show a file in the task as a file card (desktop chat + phone). Deduped by path. */
  function appendFileCard(sessionId: string, rawPath: string, name?: string): void {
    // Agents run in Git Bash: /c/Users/…, /tmp/…, paths relative to the harness.
    const filePath = resolveAgentPath(rawPath, harnessDir());
    const session = sessionManager.getSession(sessionId);
    if (!session) return;
    const already = session.output.some((e) => e.type === 'file_output' && (e as { path?: string }).path === filePath);
    if (already) return;
    let size = 0;
    try { size = fs.statSync(filePath).size; } catch { return; }
    const fileName = name || path.basename(filePath);
    const ext = path.extname(fileName).slice(1).toLowerCase();
    const mime = ({
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
      pdf: 'application/pdf', glb: 'model/gltf-binary', gltf: 'model/gltf+json', fbx: 'application/octet-stream',
      blend: 'application/x-blender', mp4: 'video/mp4',
    } as Record<string, string>)[ext] ?? 'application/octet-stream';
    sessionManager.appendOutput(sessionId, { type: 'file_output', name: fileName, path: filePath, size, mime });
  }

  // Downloads in a task's tabs land in Downloads (no Save dialog) and show as
  // the task's files; the agent's wait on the approval policy first.
  electronSession.defaultSession.on('will-download', (_event, item, wc) => {
    handleDownload(item, wc, {
      sessionIdOf: (contents) => browserPool.sessionIdOf(contents as Electron.WebContents),
      isRunning: (id) => sessionManager.getSession(id)?.status === 'running',
      userStarted: (contents) => userActiveWithin(contents, 2000),
      approve: async (id, title, detail, fileName) => (await requestConfirmation(id, title, detail, 'download', fileName)).approved,
      folder: () => app.getPath('downloads'),
      finished: (id, filePath, name) => appendFileCard(id, filePath, name),
      log: (event, data) => mainLogger.info(event, data),
    });
  });

  const localTaskServer = await createLocalTaskServer({
    userDataPath: app.getPath('userData'),
    log: mainLogger,
    routes: {
      // Remember a nickname for a site: `dex-remember site "uni portal" <url>`.
      'POST /dex/remember-site': async (raw) => {
        const { target, aliases } = JSON.parse(raw || '{}') as { target?: unknown; aliases?: unknown };
        const t = assertString(target, 'target', 300);
        const list = Array.isArray(aliases) ? aliases.filter((a): a is string => typeof a === 'string') : [];
        const { rememberSite } = await import('./memory/siteStore');
        return { site: await rememberSite(t, list) };
      },

      // Remember a username and/or password for a site. The password is stored
      // in the OS credential store and never returned by any route.
      'POST /dex/remember-login': async (raw) => {
        const body = JSON.parse(raw || '{}') as { target?: unknown; username?: unknown; password?: unknown };
        const t = assertString(body.target, 'target', 300);
        const { rememberLogin } = await import('./memory/siteStore');
        const site = await rememberLogin(t, {
          username: typeof body.username === 'string' ? body.username : undefined,
          password: typeof body.password === 'string' ? body.password : undefined,
        });
        return { site };
      },

      // Forget a site entirely — its aliases and any stored login.
      'POST /dex/forget-site': async (raw) => {
        const { target } = JSON.parse(raw || '{}') as { target?: unknown };
        const t = assertString(target, 'target', 300);
        const { forgetSite } = await import('./memory/siteStore');
        await forgetSite(t);
        return { forgotten: t };
      },

      // Resolve a nickname to a site. Returns the URL and whether credentials
      // exist — never the password.
      'POST /dex/recall-site': async (raw) => {
        const { query } = JSON.parse(raw || '{}') as { query?: unknown };
        const q = assertString(query, 'query', 300);
        const { recallSite } = await import('./memory/siteStore');
        return { site: await recallSite(q) };
      },

      // Type a stored credential into the session's focused browser field.
      //
      // This is the whole reason the password can stay secret: the value goes
      // from the credential store straight into the page via the WebContentsView,
      // and the response says only whether it worked. The agent focuses the
      // field first (with the harness) and never sees the value.
      'POST /dex/fill': async (raw) => {
        const body = JSON.parse(raw || '{}') as { sessionId?: unknown; target?: unknown; field?: unknown; selector?: unknown };
        const sessionId = assertString(body.sessionId, 'sessionId', 100);
        const target = assertString(body.target, 'target', 300);
        const field = body.field === 'username' ? 'username' : 'password';
        const selector = typeof body.selector === 'string' && body.selector.trim() ? body.selector.trim() : null;

        const view = browserPool.getView(sessionId);
        if (!view || view.webContents.isDestroyed()) {
          return { filled: false, error: 'No live browser view for this session. Open the page first.' };
        }
        const { getSecret } = await import('./memory/siteStore');
        const secret = await getSecret(target, field);
        if (!secret) {
          return { filled: false, error: `No stored ${field} for ${target}.` };
        }

        // Set the value through the page's own DOM via the debugger, rather than
        // webContents.insertText. insertText needs the WebContents to hold OS
        // focus and to land on whatever the DOM thinks is focused — which did
        // not survive the harness driving focus over its own CDP connection, so
        // the fields came back empty. Setting the value directly, through the
        // native value setter and with input/change events dispatched, lands
        // reliably and looks to the site like real entry. The secret is built
        // into the expression here in main and is never logged or returned.
        const dbg = view.webContents.debugger;
        let release: (() => void) | null = null;
        try {
          release = leaseDebugger(view.webContents);
          const literal = JSON.stringify(secret);
          const sel = selector ? JSON.stringify(selector) : 'null';
          const expression = `(() => {
            const el = ${sel} ? document.querySelector(${sel}) : document.activeElement;
            if (!el || !('value' in el)) return 'nofield';
            const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
            el.focus();
            setter.call(el, ${literal});
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return 'ok';
          })()`;
          const result = await dbg.sendCommand('Runtime.evaluate', {
            expression,
            returnByValue: true,
          }) as { result?: { value?: string }; exceptionDetails?: unknown };

          if (result.exceptionDetails) {
            return { filled: false, error: 'Could not reach the field on the page.' };
          }
          if (result.result?.value === 'nofield') {
            return {
              filled: false,
              error: selector
                ? `No field matched "${selector}".`
                : 'No input is focused. Click the field first, or pass its selector.',
            };
          }
          mainLogger.info('dex.fill', { sessionId, field, bySelector: Boolean(selector) });
          return { filled: true };
        } catch (err) {
          return { filled: false, error: (err as Error).message };
        } finally {
          release?.();
        }
      },

      // The `dex-find` CLI. Local search always runs; `--drive` additionally
      // fires Google Drive through its MCP tool, concurrently — see
      // search/query.ts's searchCombined for why that is a `Promise.all` and
      // not two sequential calls. Also publishes an `artifact` event so the
      // result shows as a card in the preview deck, not just in the agent's
      // own terminal output.
      'POST /dex/search': async (raw) => {
        const body = JSON.parse(raw || '{}') as {
          sessionId?: unknown; query?: unknown; drive?: unknown; limit?: unknown;
        };
        const id = assertString(body.sessionId, 'sessionId', 100);
        const query = assertString(body.query, 'query', 500);
        const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.min(Math.floor(body.limit), 50) : 20;
        const wantDrive = body.drive === true;

        const { searchCombined } = await import('./search/query');
        const { searchDrive } = await import('./search/drive');

        const combined = await searchCombined(query, limit, wantDrive, searchDrive);

        const items = [
          ...combined.local.map((r) => ({
            label: r.label, detail: r.detail, reasons: r.reasons, excerpt: r.excerpt, bytes: r.bytes, modified: r.modified,
          })),
          ...(combined.drive?.items ?? []).map((item) => ({ label: item.label, reasons: item.reasons })),
        ];

        const noteParts: string[] = [];
        if (combined.localNote) noteParts.push(combined.localNote);
        if (wantDrive && combined.drive && !combined.drive.ok) noteParts.push(`Drive: ${combined.drive.error}`);

        const session = sessionManager.getSession(id);
        if (session) {
          sessionManager.appendOutput(id, {
            type: 'artifact',
            kind: 'files',
            title: `Search results for "${query}"`,
            note: noteParts.length > 0 ? noteParts.join('; ') : undefined,
            items,
          });
        }

        return { items, driveError: combined.drive && !combined.drive.ok ? combined.drive.error : undefined, note: combined.localNote };
      },

      // dex-websearch's only endpoint. A plain factual lookup ("current
      // Node LTS version") doesn't need a browser tab — this renders as the
      // same row-list artifact card dex-find uses, no new UI needed.
      'POST /dex/websearch': async (raw) => {
        const body = JSON.parse(raw || '{}') as { sessionId?: unknown; query?: unknown; limit?: unknown };
        const id = assertString(body.sessionId, 'sessionId', 100);
        const query = assertString(body.query, 'query', 500);
        const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.min(Math.floor(body.limit), 20) : 10;

        const { searchWeb } = await import('./search/websearch');
        const result = await searchWeb(query, limit);

        const items = result.items.map((r) => ({ label: r.title, detail: r.url, reasons: ['web search'], excerpt: r.snippet }));

        const session = sessionManager.getSession(id);
        if (session) {
          sessionManager.appendOutput(id, {
            type: 'artifact',
            kind: 'reading',
            title: `Web search: "${query}"`,
            note: !result.ok ? result.error : undefined,
            items,
          });
        }

        return { items, error: result.ok ? undefined : result.error };
      },

      // The `dex-canvas` CLI's only endpoint. One markdown document per
      // session — the latest call replaces whatever was showing, the same
      // "last write wins" rule task_state uses for the plan.
      'POST /dex/canvas': async (raw) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new Error('request body must be JSON');
        }
        const body = (parsed ?? {}) as { sessionId?: unknown; title?: unknown; markdown?: unknown };
        const id = assertString(body.sessionId, 'sessionId', 100);
        const title = assertString(body.title, 'title', 200);
        const markdown = assertString(body.markdown, 'markdown', 200_000);

        const session = sessionManager.getSession(id);
        if (session) {
          sessionManager.appendOutput(id, { type: 'canvas', title, markdown, at: Date.now() });
        }
        return { ok: true };
      },

      // `dex-send`: files, a screenshot of the session's browser view or the
      // screen, or the canvas as a PDF — to the user's own WhatsApp chat only
      // (the task's thread if it came from WhatsApp). The recipient is never
      // taken from the request.
      'POST /dex/send': async (raw) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new Error('request body must be JSON');
        }
        const body = (parsed ?? {}) as { sessionId?: unknown; files?: unknown; page?: unknown; screen?: unknown; canvas?: unknown; caption?: unknown };
        const id = assertString(body.sessionId, 'sessionId', 100);
        const session = sessionManager.getSession(id);
        if (!session) throw new Error('Session not found');
        const caption = typeof body.caption === 'string' ? body.caption.slice(0, 1000) : '';
        const requested = Array.isArray(body.files) ? body.files.filter((f): f is string => typeof f === 'string') : [];

        const outbox = await import('./channels/outbox');
        if (requested.length > outbox.MAX_FILES) throw new Error(`at most ${outbox.MAX_FILES} files per call`);
        const files: Array<{ path: string; fileName?: string }> = [];
        const problems: string[] = [];
        if (body.page === true) {
          const view = browserPool.getView(id);
          if (!view || view.webContents.isDestroyed()) problems.push('--page: no browser view for this session — open the page first');
          else {
            try { files.push(await outbox.capturePage(view.webContents)); }
            catch (err) { problems.push(`--page: ${outbox.logOutboxError('page', err)}`); }
          }
        }
        if (body.screen === true) {
          try { files.push(await outbox.captureScreen()); }
          catch (err) { problems.push(`--screen: ${outbox.logOutboxError('screen', err)}`); }
        }
        if (body.canvas === true) {
          const canvas = [...session.output].reverse().find((e) => e.type === 'canvas') as { title?: string; markdown?: string } | undefined;
          if (!canvas?.markdown) problems.push('--canvas: nothing shown with dex-canvas in this task yet');
          else {
            try { files.push(await outbox.renderCanvasPdf(canvas.title ?? 'Document', canvas.markdown)); }
            catch (err) { problems.push(`--canvas: ${outbox.logOutboxError('canvas', err)}`); }
          }
        }
        for (const f of requested) {
          const checked = await outbox.checkFile(f);
          if (!('error' in checked)) files.push({ path: checked.path });
          else problems.push(checked.error);
        }
        if (files.length === 0) throw new Error(problems.join('\n') || 'nothing to send');

        const result = await channelRouter.sendFiles(id, files, caption);
        // What was sent also shows in the task itself, as file cards — on
        // the desktop and in the phone app's Files.
        const { statSync } = await import('node:fs');
        for (const f of files) {
          const name = f.fileName ?? f.path.split(/[\\/]/).pop() ?? f.path;
          let size = 0;
          try { size = statSync(f.path).size; } catch { /* gone already */ }
          const ext = name.split('.').pop()?.toLowerCase() ?? '';
          const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' } as Record<string, string>)[ext] ?? 'application/octet-stream';
          sessionManager.appendOutput(id, { type: 'file_output', name, path: f.path, size, mime });
        }
        return { ...result, files: files.map((f) => f.path), problems };
      },

      // The `dex-tab` CLI: the agent's view of its workspace tabs (docs/unify
      // PLAN.md §4.2). Tabs it opens are background scratch tabs unless it
      // shows or keeps them; `targetId` is what `session.use()` takes.
      'POST /dex/tab': async (raw) => {
        let parsed: { sessionId?: unknown; op?: unknown; tab?: unknown; url?: unknown; show?: unknown; keep?: unknown };
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new Error('request body must be JSON');
        }
        const id = assertString(parsed.sessionId, 'sessionId', 100);
        if (!browserPool.getWebContents(id)) throw new Error('This task has no browser open.');
        const tabId = typeof parsed.tab === 'string' ? parsed.tab : '';
        const describe = async () => {
          const tabs = browserPool.listTabs(id);
          return Promise.all(tabs.map(async (t) => {
            const wc = browserPool.getTabWebContents(id, t.id);
            let targetId: string | null = null;
            if (wc) {
              try {
                const info = await withDebugger(wc, () => wc.debugger.sendCommand('Target.getTargetInfo')) as { targetInfo?: { targetId?: string } };
                targetId = info.targetInfo?.targetId ?? null;
              } catch { /* closing */ }
            }
            return { tab: t.id, targetId, url: t.url, title: t.title, onScreen: t.active, openedBy: t.openedBy, temporary: t.temporary };
          }));
        };
        switch (parsed.op) {
          case 'list':
            return { tabs: await describe() };
          case 'new': {
            const url = typeof parsed.url === 'string' ? normalizeAddress(parsed.url) : null;
            if (!url) throw new Error('dex-tab new needs a URL or search words');
            const opened = browserPool.openTab(id, { url, openedBy: 'agent', activate: parsed.show === true, temporary: parsed.keep !== true && parsed.show !== true });
            if (!opened) throw new Error('Could not open a tab.');
            await new Promise((resolve) => setTimeout(resolve, 60));
            return { opened: (await describe()).find((t) => t.tab === opened) ?? { tab: opened } };
          }
          case 'show':
            if (!browserPool.activateTab(id, tabId)) throw new Error(`No tab ${tabId || '(missing)'}`);
            browserPool.keepTab(id, tabId);
            return { shown: tabId };
          case 'keep':
            if (!browserPool.keepTab(id, tabId)) throw new Error(`No tab ${tabId || '(missing)'}`);
            return { kept: tabId };
          case 'close':
            if (!browserPool.closeTab(id, tabId)) throw new Error(`No tab ${tabId || '(missing)'}`);
            return { closed: tabId };
          default:
            throw new Error('op must be list, new, show, keep or close');
        }
      },

      // The `dex-open` CLI: show the user a file in a document tab — what the
      // agent wrote, downloaded or filled in. The agent can already read any
      // file; this only puts it in front of the user.
      'POST /dex/open': async (raw) => {
        let parsed: { sessionId?: unknown; path?: unknown; show?: unknown };
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new Error('request body must be JSON');
        }
        const id = assertString(parsed.sessionId, 'sessionId', 100);
        const requested = assertString(parsed.path, 'path', 2000);
        if (!sessionManager.getSession(id)) throw new Error('No such task.');
        const abs = path.isAbsolute(requested) ? requested : path.resolve(harnessDir(), requested);
        const doc = documentTabs.open(id, abs, 'agent', parsed.show !== false);
        return { opened: { tab: doc.id, name: doc.name, path: doc.path, size: doc.size } };
      },

      // The `dex-state` CLI's only endpoint. Everything it can do is one of
      // the verbs in TaskStateMutationSchema, so validation is a single parse
      // and the handler stays a pass-through to the session manager.
      'POST /dex/state': async (raw) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new Error('request body must be JSON');
        }
        const { sessionId, ...rest } = (parsed ?? {}) as { sessionId?: unknown };
        const id = assertString(sessionId, 'sessionId', 100);
        const mutation = TaskStateMutationSchema.parse(rest);
        // Store the file where it really is, not as Git Bash spelled it.
        if (mutation.op === 'file') mutation.path = resolveAgentPath(mutation.path, harnessDir());
        const state = sessionManager.applyTaskState(id, mutation);
        // A recorded file (a render, a model, an export) also shows in the
        // task itself as a file card — with a preview for pictures — on the
        // desktop and in the phone app.
        if (mutation.op === 'file') appendFileCard(id, mutation.path, mutation.name);
        return { state };
      },

      // dex-3d: an AI 3D model (GLB) from a picture or a description, on the
      // user's free Hugging Face GPU time. See src/main/threed/generate.ts.
      'POST /dex/3d': async (raw) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new Error('request body must be JSON');
        }
        const body = (parsed ?? {}) as { sessionId?: unknown; prompt?: unknown; image?: unknown; model?: unknown; shapeOnly?: unknown; name?: unknown };
        const id = assertString(body.sessionId, 'sessionId', 100);
        const prompt = typeof body.prompt === 'string' && body.prompt.trim() ? body.prompt.trim().slice(0, 1000) : undefined;
        let image: string | undefined;
        if (typeof body.image === 'string' && body.image.trim()) {
          const { checkFile } = await import('./channels/outbox');
          const checked = await checkFile(body.image);
          if ('error' in checked) throw new Error(checked.error);
          image = checked.path;
        }
        const { generate3D } = await import('./threed/generate');
        const result = await generate3D({
          prompt,
          image,
          model: body.model === 'trellis' ? 'trellis' : 'hunyuan',
          shapeOnly: body.shapeOnly === true,
          name: typeof body.name === 'string' ? body.name.slice(0, 60) : undefined,
          outDir: path.join(harnessDir(), 'outputs', id, '3d'),
        });
        if (result.referenceImage) appendFileCard(id, result.referenceImage);
        appendFileCard(id, result.glb);
        return { ...result };
      },

      // dex-registry's (and now dex-sh's) blocking confirmation. The
      // returned Promise is what holds the HTTP response (and so the CLI,
      // and so the agent) open until resolveConfirmation is called — by the
      // renderer's Approve/Deny click, or by the timeout below. No polling
      // on either side.
      //
      // Before showing anything, this checks the per-category approval
      // policy (src/main/approvals/policy.ts): registry-write always asks;
      // the newer categories (process-launch, filesystem-write-unsafe-path,
      // service-control) only ask when the session's mode calls for it, and
      // any of them skip the prompt entirely once a 'turn' or 'session'
      // lifetime answer already covers this category — the whole point of
      // "approve for this session" being to go quiet, not just to speed up
      // clicking the same button again.
      'POST /dex/confirm': async (raw) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new Error('request body must be JSON');
        }
        const body = (parsed ?? {}) as { sessionId?: unknown; title?: unknown; detail?: unknown; category?: unknown; subject?: unknown };
        const sessionId = assertString(body.sessionId, 'sessionId', 100);
        const title = assertString(body.title, 'title', 200);
        const detail = assertString(body.detail, 'detail', 4000);
        const category = normalizeApprovalCategory(body.category);
        const subject = typeof body.subject === 'string' ? body.subject.slice(0, 4000) : undefined;

        return requestConfirmation(sessionId, title, detail, category, subject);
      },

      // dex-sh's session subcommands — a long-lived PTY (src/main/hl/
      // persistentShell.ts) that keeps cwd/env state across calls, unlike
      // the one-shot form which spawns fresh every time. Command execution
      // (not session start/end) goes through the same approval policy the
      // one-shot form uses, keyed the same way (process-launch).
      'POST /dex/sh-session-start': async (raw) => {
        const body = JSON.parse(raw || '{}') as { kind?: unknown };
        const kind = body.kind;
        if (kind !== 'bash' && kind !== 'cmd' && kind !== 'powershell' && kind !== 'wsl') {
          throw new Error('kind must be one of bash, cmd, powershell, wsl');
        }
        const { startSession } = await import('./hl/persistentShell');
        return { shellSessionId: startSession(kind) };
      },

      'POST /dex/sh-session-run': async (raw) => {
        const body = JSON.parse(raw || '{}') as { sessionId?: unknown; shellSessionId?: unknown; command?: unknown; timeoutMs?: unknown };
        const sessionId = assertString(body.sessionId, 'sessionId', 100);
        const shellSessionId = assertString(body.shellSessionId, 'shellSessionId', 100);
        const command = assertString(body.command, 'command', 20_000);
        const timeoutMs = typeof body.timeoutMs === 'number' && body.timeoutMs > 0 ? Math.min(body.timeoutMs, 10 * 60_000) : 30_000;

        const { approved } = await requestConfirmation(sessionId, 'Run a shell command', command, 'process-launch', command);
        if (!approved) {
          return { approved: false, error: 'command not approved' };
        }

        const { runCommand } = await import('./hl/persistentShell');
        try {
          const result = await runCommand(shellSessionId, command, timeoutMs);
          return { approved: true, ...result };
        } catch (err) {
          throw new Error((err as Error).message);
        }
      },

      'POST /dex/sh-session-end': async (raw) => {
        const body = JSON.parse(raw || '{}') as { shellSessionId?: unknown };
        const shellSessionId = assertString(body.shellSessionId, 'shellSessionId', 100);
        const { endSession } = await import('./hl/persistentShell');
        return { ended: endSession(shellSessionId) };
      },
    },
    submitTask: async (payload) => {
      const validatedPrompt = assertString(payload.prompt, 'prompt', 10000);
      const engineId = payload.engine == null ? DEFAULT_ENGINE_ID : assertString(payload.engine, 'engine', 50);
      mainLogger.info('main.localTask.submit', {
        promptLength: validatedPrompt.length,
        engineId,
      });

      const id = sessionManager.createSession(validatedPrompt);
      sessionManager.setSessionEngine(id, engineId);
      captureEvent('session_created', {
        source: 'local-task-server',
        engine: engineId,
        prompt_length: validatedPrompt.length,
        attachments_count: 0,
      });

      try {
        await startSessionWithAgent(id);
        return { id, started: true, engine: engineId };
      } catch (err) {
        const error = (err as Error).message || 'Session start failed';
        mainLogger.warn('main.localTask.startFailed', { id, error });
        return { id, started: false, engine: engineId, error };
      }
    },
  });
  app.once('before-quit', () => {
    void localTaskServer.close().catch((err) => {
      mainLogger.warn('main.localTaskServer.closeFailed', { error: (err as Error).message });
    });
  });

  ipcMain.handle('sessions:create', (_event, payload: unknown) => {
    let promptRaw: unknown;
    let attachmentsRaw: unknown;
    let engineRaw: unknown;
    let modelRaw: unknown;
    if (typeof payload === 'string') {
      promptRaw = payload;
    } else if (payload && typeof payload === 'object') {
      promptRaw = (payload as { prompt?: unknown }).prompt;
      attachmentsRaw = (payload as { attachments?: unknown }).attachments;
      engineRaw = (payload as { engine?: unknown }).engine;
      modelRaw = (payload as { model?: unknown }).model;
    } else {
      throw new Error('sessions:create payload must be a string or { prompt, attachments?, engine?, model? }');
    }
    const validatedPrompt = assertString(promptRaw, 'prompt', 10000);
    const attachments = assertAttachments(attachmentsRaw);
    const engineId = engineRaw == null ? DEFAULT_ENGINE_ID : assertString(engineRaw, 'engine', 50);
    // Empty/absent means "engine default" — we then omit the CLI's model flag
    // entirely rather than pinning whatever we last guessed it supports.
    const modelId = modelRaw == null || modelRaw === '' ? null : assertString(modelRaw, 'model', 100);
    mainLogger.info('main.sessions:create', {
      promptLength: validatedPrompt.length,
      attachmentCount: attachments.length,
      engineId,
      modelId,
      attachmentMeta: attachments.map((a) => ({ name: a.name, mime: a.mime, size: a.bytes.byteLength })),
    });
    const id = sessionManager.createSession(validatedPrompt);
    sessionManager.setSessionEngine(id, engineId);
    if (modelId) sessionManager.setSessionModel(id, modelId);
    if (attachments.length > 0) {
      const turnIndex = sessionManager.getNextAttachmentTurnIndex(id);
      for (const a of attachments) {
        sessionManager.saveAttachment(id, a, turnIndex);
      }
    }
    captureEvent('session_created', {
      source: 'hub',
      engine: engineId,
      prompt_length: validatedPrompt.length,
      attachments_count: attachments.length,
    });
    return id;
  });

  ipcMain.handle('sessions:start', async (_event, id: string) => {
    const validatedId = assertString(id, 'id', 100);
    await startSessionWithAgent(validatedId);
  });

  // Shared by the hub's follow-up box and the phone bridge: a running
  // session queues the message after its next tool, a paused one resumes,
  // a finished one continues its conversation.
  async function handleResumeRequest(
    validatedId: string,
    validatedPrompt: string,
    resumeAttachments: ReturnType<typeof assertAttachments>,
  ): Promise<Record<string, unknown>> {
    const currentSession = sessionManager.getSession(validatedId);
    if (!currentSession) return { error: 'Session not found' };
    if (currentSession.status === 'running' || currentSession.status === 'stuck') {
      return queueFollowUpAfterNextTool(validatedId, validatedPrompt, resumeAttachments);
    }
    if (currentSession.status === 'paused') {
      const isPlainResume = validatedPrompt.trim() === 'Continue from where you left off.' && resumeAttachments.length === 0;
      if (activeRunControls.has(validatedId)) {
        if (!isPlainResume) {
          const queued = queueFollowUpAfterNextTool(validatedId, validatedPrompt, resumeAttachments);
          if (queued.error) return queued;
        }
        return resumePausedRun(validatedId, 'resume');
      }
      if (sessionManager.getEngineSessionId(validatedId)) {
        return resumeSessionWithAgent(validatedId, validatedPrompt, resumeAttachments, 'resume');
      }
      return { error: 'Paused agent process is no longer available.' };
    }
    return resumeSessionWithAgent(validatedId, validatedPrompt, resumeAttachments, 'resume');
  }

  ipcMain.handle('sessions:resume', async (_event, payload: { id: string; prompt: string; attachments?: unknown }) => {
    const validatedId = assertString(payload?.id, 'id', 100);
    const validatedPrompt = assertString(payload?.prompt, 'prompt', 10000);
    const resumeAttachments = assertAttachments(payload?.attachments);
    mainLogger.info('main.sessions:resume', {
      id: validatedId,
      promptLength: validatedPrompt.length,
      attachmentCount: resumeAttachments.length,
      attachmentMeta: resumeAttachments.map((a) => ({ name: a.name, mime: a.mime, size: a.bytes.byteLength })),
    });
    return handleResumeRequest(validatedId, validatedPrompt, resumeAttachments);
  });

  ipcMain.handle('sessions:rerun', async (_event, id: string) => {
    const validatedId = assertString(id, 'id', 100);
    const t0 = Date.now();
    mainLogger.info('main.sessions:rerun', { id: validatedId });

    const session = sessionManager.getSession(validatedId);
    if (!session) return { error: 'Session not found' };

    terminateActiveRunControl(validatedId);
    browserPool.destroy(validatedId, shellWindow ?? undefined);

    const engineId = sessionManager.getSessionEngine(validatedId) ?? DEFAULT_ENGINE_ID;
    await stampConfiguredSessionModel(validatedId, engineId, 'rerun');
    const abortController = sessionManager.rerunSession(validatedId);
    captureEvent('session_rerun', {
      engine: engineId,
    });

    const view = browserPool.create(validatedId, t0);
    await browserPool.markSessionActive(validatedId);
    if (!view) {
      sessionManager.failSession(validatedId, 'Browser pool full');
      return { error: 'Browser pool full' };
    }

    if (shellWindow && !shellWindow.isDestroyed()) {
      // See startSessionWithAgent comment — renderer is authoritative for bounds.
      browserPool.detachAll(shellWindow);
      mainLogger.info('main.sessions:rerun.detachedAwaitingRenderer', { id: validatedId });
    }

    try {
      await view.webContents.loadURL('about:blank');
    } catch (err) {
      mainLogger.warn('main.sessions:rerun.loadBlank.failed', { id: validatedId, error: (err as Error).message });
    }

    const rerunAttachments = sessionManager.loadAttachmentsForRun(validatedId);
    if (rerunAttachments.length > 0) {
      mainLogger.info('main.sessions:rerun.attachments', { id: validatedId, count: rerunAttachments.length });
    }
    queuedFollowUps.delete(validatedId);
    const runId = beginEngineRun(validatedId);
    runEngine({
      engineId,
      harnessDir: harnessDir(),
      sessionId: validatedId,
      originChannel: sessionManager.getSessionOrigin(validatedId).originChannel ?? undefined,
      prompt: session.prompt,
      attachments: rerunAttachments.map((a) => ({ name: a.name, mime: a.mime, bytes: a.bytes })),
      webContents: view.webContents,
      ...cdpFor(validatedId),
      signal: abortController.signal,
      // Rerun intentionally starts a fresh conversation; SessionManager.rerunSession
      // already cleared any stored resume id. The model choice is a property of
      // the session, not the conversation, so it carries over.
      model: sessionManager.getSessionModel(validatedId) ?? undefined,
      onRunControl: bindRunControl(validatedId, runId),
      onSessionId: (sid) => sessionManager.setEngineSessionId(validatedId, sid),
      onModelResolved: ({ model }) => sessionManager.setSessionModel(validatedId, model),
      onAuthResolved: ({ authMode, subscriptionType }) => sessionManager.setSessionAuth(validatedId, authMode, subscriptionType),
      onEvent: (event) => handleEngineEvent(validatedId, event, runId),
    }).catch((err: Error) => {
      handleEngineRunError(validatedId, err, 'main.sessions:rerun.agentError', runId);
    }).finally(() => {
      endEngineRun(validatedId, runId);
    });

    return { rerun: true };
  });

  ipcMain.handle('sessions:pause', (_event, payload: string | { id?: unknown; source?: unknown }) => {
    const idRaw = typeof payload === 'string' ? payload : payload?.id;
    const sourceRaw = typeof payload === 'string' ? 'button' : payload?.source;
    const validatedId = assertString(idRaw, 'id', 100);
    const source = sourceRaw === 'logs-ctrl-c' ? 'logs-ctrl-c' : 'button';
    mainLogger.info('main.sessions:pause', { id: validatedId, source });
    return pauseSessionFromMain(validatedId, source);
  });

  ipcMain.handle('sessions:cancel', (_event, payload: string | { id?: unknown; source?: unknown }) => {
    const idRaw = typeof payload === 'string' ? payload : payload?.id;
    const sourceRaw = typeof payload === 'string' ? 'button' : payload?.source;
    const validatedId = assertString(idRaw, 'id', 100);
    const source = sourceRaw === 'logs-ctrl-c' ? 'logs-ctrl-c' : 'button';
    mainLogger.info('main.sessions:cancel', { id: validatedId, source });
    return cancelSessionFromMain(validatedId, source);
  });

  ipcMain.handle('sessions:halt', (_event, id: string) => {
    const validatedId = assertString(id, 'id', 100);
    mainLogger.info('main.sessions:halt', { id: validatedId });
    const ctrl = sessionManager.getAbortController(validatedId);
    if (ctrl) ctrl.abort();
    terminateActiveRunControl(validatedId);
    queuedFollowUps.delete(validatedId);
    drainingQueuedFollowUps.delete(validatedId);
  });

  ipcMain.handle('sessions:steer', (_event, { id, message }: { id: string; message: string }) => {
    const validatedId = assertString(id, 'id', 100);
    const validatedMsg = assertString(message, 'message', 10000);
    mainLogger.info('main.sessions:steer', { id: validatedId, messageLength: validatedMsg.length });
    return queueFollowUpAfterNextTool(validatedId, validatedMsg, []);
  });

  ipcMain.handle('sessions:dismiss', (_event, id: string) => {
    const validatedId = assertString(id, 'id', 100);
    mainLogger.info('main.sessions:dismiss', { id: validatedId });
    queuedFollowUps.delete(validatedId);
    drainingQueuedFollowUps.delete(validatedId);
    terminateActiveRunControl(validatedId);
    sessionManager.dismissSession(validatedId);
    browserPool.destroy(validatedId, shellWindow ?? undefined);
  });

  ipcMain.handle('sessions:delete', (_event, id: string) => {
    const validatedId = assertString(id, 'id', 100);
    mainLogger.info('main.sessions:delete', { id: validatedId });
    queuedFollowUps.delete(validatedId);
    drainingQueuedFollowUps.delete(validatedId);
    terminateActiveRunControl(validatedId);
    browserPool.destroy(validatedId, shellWindow ?? undefined);
    documentTabs.closeSession(validatedId);
    sessionManager.deleteSession(validatedId);
    approvalPolicy.clearSession(validatedId);
  });

  /**
   * Open an agent-produced file (from <harnessDir>/outputs/<sessionId>/) in
   * its default OS handler. Path-traversal guarded: only paths rooted inside
   * the outputs directory are allowed.
   */
  ipcMain.handle('sessions:download-output', async (_event, filePath: string) => {
    const validated = assertString(filePath, 'filePath', 2000);
    // Accept either an absolute path or a harness-relative path like
    // `outputs/<session>/<file>` (what Claude's narration uses).
    const resolvedPath = path.isAbsolute(validated)
      ? path.resolve(validated)
      : path.resolve(harnessDir(), validated);
    const outputsRoot = path.resolve(harnessDir(), 'outputs');
    if (!resolvedPath.startsWith(outputsRoot + path.sep)) {
      mainLogger.warn('main.sessions:download-output.rejected', { filePath: validated });
      throw new Error('refused: path outside outputs dir');
    }
    const err = await shell.openPath(resolvedPath);
    if (err) {
      mainLogger.warn('main.sessions:download-output.openFailed', { path: resolvedPath, error: err });
      throw new Error(err);
    }
    mainLogger.info('main.sessions:download-output.ok', { path: resolvedPath });
    return { opened: true };
  });

  ipcMain.handle('sessions:list-editors', async () => {
    const { detectEditors } = await import('./editors');
    return detectEditors();
  });

  ipcMain.handle('sessions:list-engines', async () => {
    const { listAdapters } = await import('./hl/engines');
    return listAdapters().map((a) => ({
      id: a.id,
      displayName: a.displayName,
      binaryName: a.binaryName,
      selectableModels: a.selectableModels ? [...a.selectableModels] : undefined,
    }));
  });

  /** The real probe: two process spawns. Only ever called through the cache. */
  const probeEngineStatus = async (engineId: string): Promise<EngineStatus> => {
    mainLogger.info('sessions.engine-status.probe', { engineId });
    const { getAdapter } = await import('./hl/engines');
    const adapter = getAdapter(engineId);
    if (!adapter) throw new Error(`unknown engine: ${engineId}`);
    const [installed, authed] = await Promise.all([adapter.probeInstalled(), adapter.probeAuthed()]);
    mainLogger.info('sessions.engine-status.result', {
      engineId: adapter.id,
      installed: installed.installed,
      installedError: installed.error,
      authed: authed.authed,
      authError: authed.error,
    });
    return { id: adapter.id, displayName: adapter.displayName, installed, authed };
  };

  // Fill the cache before the user can reach a picker, so even the first open
  // is instant rather than paying full price for six spawns.
  void import('./hl/engines').then(({ listAdapters }) => {
    prewarmEngineStatus(listAdapters().map((adapter) => adapter.id), probeEngineStatus);
  });

  // Shake hands with every enabled connection at launch.
  //
  // Two reasons, and both were real complaints. The prompt names each server's
  // tools so the agent never has to search for them, and those names come from
  // a tools/list call — waiting for someone to open Settings meant the first
  // task of a session had no names, and an agent with only a prefix guesses.
  // And a connection that is on should show as connected the moment the app
  // opens, rather than the first time the user happens to visit Settings.
  //
  // Always verify, not only when names are missing: the token may have been
  // revoked since, and a stale "connected" is exactly the lie this check
  // exists to prevent.
  void (async () => {
    try {
      const { findServerDefinition } = await import('./mcp/catalog');
      const { listConnections, setConnection } = await import('./mcp/store');
      const { verifyServer } = await import('./mcp/client');

      // Blender needs no keys: installed means connected — unless the user
      // switched it off, which leaves an entry saying so.
      const { findBlender } = await import('./startup/blender');
      if (findBlender() && !(await listConnections()).some((c) => c.id === 'blender')) {
        await setConnection('blender', { enabled: true, values: {} });
        mainLogger.info('mcp.autoConnect', { id: 'blender' });
      }

      for (const connection of await listConnections()) {
        if (!connection.enabled) continue;
        const definition = findServerDefinition(connection.id);
        if (!definition) continue;

        const result = await verifyServer(definition, connection.values);
        mcpVerifyCache.set(connection.id, result);
        if (result.ok) {
          const identity = connection.identity ?? (await definition.resolveIdentity?.(connection.values));
          await setConnection(connection.id, {
            toolNames: result.toolNames?.length ? result.toolNames : undefined,
            identity,
          });
        }
        mainLogger.info('mcp.startupHandshake', {
          id: connection.id,
          ok: result.ok,
          toolCount: result.toolCount ?? 0,
          error: result.error?.slice(0, 120),
        });
      }
    } catch (err) {
      // Best effort. Tasks still run; the agent just has to enumerate.
      mainLogger.warn('mcp.startupHandshake.failed', { error: (err as Error).message });
    }
  })();

  ipcMain.handle('sessions:engine-status', async (_event, engineId: string) => {
    const validated = assertString(engineId, 'engineId', 50);
    // Cached: probing spawns two processes per engine, so an uncached picker
    // open costs six. See statusCache.ts.
    return getEngineStatus(validated, () => probeEngineStatus(validated));
  });

  ipcMain.handle('sessions:engine-login', async (_event, engineId: string, opts?: { deviceAuth?: boolean }) => {
    const validated = assertString(engineId, 'engineId', 50);
    mainLogger.info('sessions.engine-login.request', { engineId: validated, deviceAuth: !!opts?.deviceAuth });
    const { getAdapter } = await import('./hl/engines');
    const adapter = getAdapter(validated);
    if (!adapter) throw new Error(`unknown engine: ${validated}`);
    const result = await adapter.openLoginInTerminal(opts);
    // Logging in exists to change this answer; serving the pre-login state
    // would make a successful login look like it failed.
    invalidateEngineStatus(adapter.id);
    mainLogger.info('sessions.engine-login.result', {
      engineId: adapter.id,
      opened: result.opened,
      hasError: !!result.error,
      hasVerificationUrl: !!result.verificationUrl,
      hasDeviceCode: !!result.deviceCode,
    });
    return result;
  });

  ipcMain.handle('sessions:engine-install', async (_event, engineId: string) => {
    const validated = assertString(engineId, 'engineId', 50);
    mainLogger.info('sessions.engine-install.request', { engineId: validated });
    const { getAdapter } = await import('./hl/engines');
    const adapter = getAdapter(validated);
    if (!adapter) throw new Error(`unknown engine: ${validated}`);
    const { runEngineInstall } = await import('./hl/engines/installer');
    const result = await runEngineInstall(adapter.id);
    invalidateEngineStatus(adapter.id);
    const installed = await adapter.probeInstalled().catch((err) => ({
      installed: false,
      error: (err as Error).message,
    }));
    mainLogger.info('sessions.engine-install.result', {
      engineId: adapter.id,
      opened: result.opened,
      completed: result.completed,
      exitCode: result.exitCode,
      hasError: !!result.error,
      installed: installed.installed,
      installedError: installed.error,
      command: result.command,
    });
    return { ...result, installed };
  });

  ipcMain.handle('sessions:reveal-output', async (_event, filePath: string) => {
    const validated = assertString(filePath, 'filePath', 2000);
    const resolvedPath = path.isAbsolute(validated)
      ? path.resolve(validated)
      : path.resolve(harnessDir(), validated);
    const outputsRoot = path.resolve(harnessDir(), 'outputs');
    if (!resolvedPath.startsWith(outputsRoot + path.sep)) {
      throw new Error('refused: path outside outputs dir');
    }
    shell.showItemInFolder(resolvedPath);
    mainLogger.info('main.sessions:reveal-output', { path: resolvedPath });
    return { revealed: true };
  });

  // The chat's file cards (docs/unify/PLAN.md §3.12): a file this task
  // recorded, wherever it was saved — never a path the page merely names,
  // and never run as a program (an executable is only shown in its folder).
  ipcMain.handle('sessions:open-file', async (_event, payload: { sessionId?: unknown; path?: unknown; how?: unknown }) => {
    const id = assertString(payload?.sessionId, 'sessionId', 100);
    const requested = assertString(payload?.path, 'path', 2000);
    const how = payload?.how === 'reveal' || payload?.how === 'copy' ? payload.how : 'open';
    const session = sessionManager.getSession(id);
    if (!session) throw new Error('No such task.');
    const resolved = resolveRecordedFile(requested, session.output, harnessDir())
      ?? (documentTabs.isOpen(id, requested) ? path.resolve(requested) : null);
    if (!resolved) {
      mainLogger.warn('main.sessions:open-file.refused', { id, path: requested });
      throw new Error('refused: not a file this task produced');
    }
    if (!fs.existsSync(resolved)) throw new Error('That file has been moved or deleted.');
    if (how === 'reveal' || (how === 'open' && isRunnable(resolved))) {
      shell.showItemInFolder(resolved);
      return { revealed: true };
    }
    if (how === 'copy') {
      const options = { defaultPath: path.join(app.getPath('downloads'), path.basename(resolved)) };
      const res = shellWindow ? await dialog.showSaveDialog(shellWindow, options) : await dialog.showSaveDialog(options);
      if (res.canceled || !res.filePath) return { saved: null };
      await fs.promises.copyFile(resolved, res.filePath);
      mainLogger.info('main.sessions:open-file.copied', { id, to: res.filePath });
      return { saved: res.filePath };
    }
    const err = await shell.openPath(resolved);
    if (err) throw new Error(err);
    return { opened: true };
  });

  // The bytes of a file this task recorded or opened as a document, for the
  // hub's viewers (document tabs, screenshots in the chat). Same rule as
  // open-file: never a path the page merely names.
  ipcMain.handle('sessions:read-file', async (_event, payload: { sessionId?: unknown; path?: unknown }) => {
    const id = assertString(payload?.sessionId, 'sessionId', 100);
    const requested = assertString(payload?.path, 'path', 2000);
    const session = sessionManager.getSession(id);
    if (!session) throw new Error('No such task.');
    const resolved = resolveRecordedFile(requested, session.output, harnessDir())
      ?? (documentTabs.isOpen(id, requested) ? path.resolve(requested) : null);
    if (!resolved) {
      mainLogger.warn('main.sessions:read-file.refused', { id, path: requested });
      throw new Error('refused: not a file this task produced');
    }
    const stat = await fs.promises.stat(resolved);
    if (stat.size > MAX_DOC_BYTES) throw new Error('Too big to show here; open it in its own app.');
    return { bytes: await fs.promises.readFile(resolved), size: stat.size, mtimeMs: stat.mtimeMs };
  });

  ipcMain.handle('sessions:open-in-editor', async (_event, payload: { editorId: string; filePath: string; sessionId?: string }) => {
    mainLogger.info('main.sessions:open-in-editor.enter', {
      editorId: payload?.editorId,
      filePath: payload?.filePath,
      payloadType: typeof payload,
    });
    try {
      const editorId = assertString(payload?.editorId, 'editorId', 50);
      const filePath = assertString(payload?.filePath, 'filePath', 2000);
      const outputsRoot = path.resolve(harnessDir(), 'outputs');
      let resolvedPath = path.resolve(filePath);
      if (!resolvedPath.startsWith(outputsRoot + path.sep)) {
        // Outside outputs/: the same rule as open-file — a file this task
        // recorded (a report it saved to Downloads) or has open as a
        // document. Never an arbitrary path the page names.
        const id = typeof payload?.sessionId === 'string' ? payload.sessionId : null;
        const session = id ? sessionManager.getSession(id) : null;
        const allowed = session && id
          ? resolveRecordedFile(filePath, session.output, harnessDir()) ?? (documentTabs.isOpen(id, filePath) ? resolvedPath : null)
          : null;
        if (!allowed) {
          mainLogger.warn('main.sessions:open-in-editor.outsideOutputs', { resolvedPath, outputsRoot });
          throw new Error(`refused: path "${resolvedPath}" is outside outputs dir "${outputsRoot}"`);
        }
        resolvedPath = allowed;
      }
      const { openInEditor } = await import('./editors');
      await openInEditor(editorId, resolvedPath);
      mainLogger.info('main.sessions:open-in-editor.ok', { editorId, resolvedPath });
      return { opened: true };
    } catch (err) {
      mainLogger.error('main.sessions:open-in-editor.failed', {
        error: (err as Error).message,
        stack: (err as Error).stack?.slice(0, 400),
      });
      throw err;
    }
  });

  ipcMain.handle('sessions:list', () => {
    const list = sessionManager.listSessions().map((s) => ({
      ...s,
      hasBrowser: !!browserPool.getWebContents(s.id),
    }));
    mainLogger.info('main.sessions:list', { returning: list.length, ids: list.map((s) => s.id) });
    return list;
  });

  ipcMain.handle('sessions:list-all', () => {
    return sessionManager.listSessions().map((s) => ({
      ...s,
      hasBrowser: !!browserPool.getWebContents(s.id),
    }));
  });

  // Answers a dex-registry confirmation card. Validated against
  // pendingConfirmations' own sessionId rather than trusted blindly, so a
  // stale/forged id from a closed card can't resolve a different session's
  // wait.
  // Set once the phone bridge is created below; lets other handlers poke it.
  let phoneBridge: { refreshDevice(): void } | null = null;

  ipcMain.handle('dex:confirm-answer', (_event, sessionId: string, id: string, approved: boolean, lifetime?: unknown) => {
    const validatedSessionId = assertString(sessionId, 'sessionId', 100);
    const validatedId = assertString(id, 'id', 100);
    const pending = pendingConfirmations.get(validatedId);
    if (!pending || pending.sessionId !== validatedSessionId) {
      return { ok: false, error: 'no matching pending confirmation' };
    }
    resolveConfirmation(validatedId, approved === true, normalizeApprovalLifetime(lifetime));
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // Phone bridge (Firebase). Off until a Firebase project is configured and
  // the user signs in with email/password (Settings → Accounts → phone).
  // ---------------------------------------------------------------------------
  void (async () => {
    const { FirebaseBridge } = await import('./firebase/bridge');
    const bridge = new FirebaseBridge({
      listSessions: () => sessionManager.listSessions(),
      getSession: (id) => sessionManager.getSession(id),
      onSessionChanged: (cb) => {
        sessionManager.onEvent('session-created', cb);
        sessionManager.onEvent('session-updated', cb);
        sessionManager.onEvent('session-completed', cb);
        sessionManager.onEvent('session-error', cb);
      },
      onSessionOutput: (cb) => { sessionManager.onEvent('session-output', cb); },
      onSessionDeleted: (cb) => { sessionManager.onEvent('session-deleted', cb); },
      // Older tasks recorded Git Bash paths (/tmp/…, /c/…, outputs\…): the
      // phone gets real paths — with sizes — and each file once.
      getTaskFiles: (id) => {
        const seen = new Set<string>();
        const out: Array<{ name: string; path: string; size?: number }> = [];
        for (const f of sessionManager.getTaskState(id).files) {
          const real = resolveAgentPath(f.path, harnessDir());
          if (seen.has(real.toLowerCase())) continue;
          seen.add(real.toLowerCase());
          let size: number | undefined;
          try { size = fs.statSync(real).size; } catch { /* gone since */ }
          out.push({ ...f, path: real, size });
        }
        return out;
      },
      listEngines: async () => {
        const { listAdapters } = await import('./hl/engines');
        return listAdapters().map((a) => ({
          id: a.id,
          name: a.displayName,
          models: (a.selectableModels ?? []).map((m) => ({ id: m.id, label: m.label })),
        }));
      },
      newTask: async ({ prompt, engine, model, attachments: phoneFiles }) => {
        const validatedPrompt = assertString(prompt, 'prompt', 10000);
        // Same limits as the desktop's own task box (shared/attachments.ts).
        const attachments = assertAttachments(phoneFiles ?? []);
        const engineId = engine ? assertString(engine, 'engine', 50) : DEFAULT_ENGINE_ID;
        const id = sessionManager.createSession(validatedPrompt, { originChannel: 'android' });
        sessionManager.setSessionEngine(id, engineId);
        if (model) sessionManager.setSessionModel(id, assertString(model, 'model', 100));
        if (attachments.length > 0) {
          const turnIndex = sessionManager.getNextAttachmentTurnIndex(id);
          for (const a of attachments) sessionManager.saveAttachment(id, a, turnIndex);
        }
        captureEvent('session_created', { source: 'android', engine: engineId, prompt_length: validatedPrompt.length, attachments_count: attachments.length });
        try {
          await startSessionWithAgent(id);
          return { id };
        } catch (err) {
          return { id, error: (err as Error).message };
        }
      },
      followUp: (id, prompt, phoneFiles) => handleResumeRequest(assertString(id, 'id', 100), assertString(prompt, 'prompt', 10000), assertAttachments(phoneFiles ?? [])),
      pause: (id) => pauseSessionFromMain(assertString(id, 'id', 100), 'button'),
      resume: (id) => handleResumeRequest(assertString(id, 'id', 100), 'Continue from where you left off.', []),
      stop: (id) => cancelSessionFromMain(assertString(id, 'id', 100), 'button'),
      getApprovalMode: () => approvalPolicy.getGlobalDefaultMode(),
      setApprovalMode: (mode) => {
        const normalized = normalizeApprovalMode(mode);
        approvalPolicy.setGlobalDefaultMode(normalized);
        return normalized;
      },
      answerConfirmation: (sessionId, confirmationId, approved, lifetime) => {
        const pending = pendingConfirmations.get(confirmationId);
        if (!pending || pending.sessionId !== sessionId) return { ok: false, error: 'no matching pending confirmation' };
        resolveConfirmation(confirmationId, approved, normalizeApprovalLifetime(lifetime));
        return { ok: true };
      },
    });
    phoneBridge = bridge;
    const pushState = (state: unknown) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('bridge:state', state);
      }
    };
    bridge.onState(pushState);
    ipcMain.handle('bridge:status', () => bridge.state);
    ipcMain.handle('bridge:restart', () => bridge.start());
    ipcMain.handle('bridge:sign-in', (_e, email: unknown, password: unknown, create: unknown) =>
      bridge.signIn(assertString(email, 'email', 320), assertString(password, 'password', 256), create === true));
    ipcMain.handle('bridge:reset-password', (_e, email: unknown) => bridge.resetPassword(assertString(email, 'email', 320)));
    ipcMain.handle('bridge:sign-out', () => bridge.signOut());
    app.once('before-quit', () => { void bridge.stop(); });
    await bridge.start();
  })().catch((err: Error) => mainLogger.error('firebase.bridge.init.failed', { error: err.message }));

  // Settings pane's global default for the approval policy (Ask for
  // approval / Approve for me / Full access) — see src/main/approvals/
  // policy.ts. Applies to every session that hasn't been given its own
  // explicit override; there is no such override surface today; Grid-view
  // sessions all read this one global value.
  ipcMain.handle('settings:approvals:get', () => ({ mode: approvalPolicy.getGlobalDefaultMode() }));

  ipcMain.handle('settings:approvals:set', (_e, mode: unknown) => {
    const normalized = normalizeApprovalMode(mode);
    approvalPolicy.setGlobalDefaultMode(normalized);
    phoneBridge?.refreshDevice(); // the phone's Settings shows this mode
    return { mode: normalized };
  });

  ipcMain.handle('sessions:get', (_event, id: string) => {
    const validatedId = assertString(id, 'id', 100);
    const session = sessionManager.getSession(validatedId);
    if (!session) return null;
    return { ...session, hasBrowser: !!browserPool.getWebContents(validatedId) };
  });

  // Live view: attach/detach agent browser to shell window
  ipcMain.handle('sessions:view-attach', (_event, id: string, bounds: { x: number; y: number; width: number; height: number }) => {
    const validatedId = assertString(id, 'id', 100);
    if (!shellWindow) return false;
    mainLogger.info('main.sessions:view-attach', { id: validatedId, visualBounds: bounds });
    const ok = browserPool.attachToWindow(validatedId, shellWindow, bounds);
    if (ok) {
      // Only focus the BrowserView when the shell window is already the
      // user's foreground window. Otherwise — e.g. user submitted a task
      // via the global-shortcut pill while focused on Cursor — focusing
      // here yanks the OS focus back to Browser Use, which is awful UX.
      // When the user later switches to the shell themselves, native macOS
      // click-to-focus on the BrowserView area takes over.
      if (shellWindow.isFocused()) {
        const attachedView = browserPool.getView(validatedId);
        if (attachedView && !attachedView.webContents.isDestroyed()) {
          attachedView.webContents.focus();
        }
      }
      // addChildView raises the browser view above any sibling we already
      // have. Re-raise the takeover overlay so it stays on top.
      takeoverOverlay.reraise(validatedId, shellWindow);
    }
    return ok;
  });

  // ---- Document tabs (docs/unify/PLAN.md §3.9) ----
  ipcMain.handle('workspace:docs', (_event, id: string) => documentTabs.list(assertString(id, 'id', 100)));

  // From the hub (a file card, Recents): only files this task recorded.
  ipcMain.handle('workspace:doc-open', (_event, id: string, filePath: string) => {
    const validatedId = assertString(id, 'id', 100);
    const requested = assertString(filePath, 'path', 2000);
    const session = sessionManager.getSession(validatedId);
    if (!session) throw new Error('No such task.');
    const resolved = resolveRecordedFile(requested, session.output, harnessDir())
      ?? (documentTabs.isOpen(validatedId, requested) ? path.resolve(requested) : null);
    if (!resolved) throw new Error('refused: not a file this task produced');
    return documentTabs.open(validatedId, resolved, 'user');
  });

  // From the Logs window: show one of the task's files in a document tab, in
  // front, with the hub on that task. Same rule as doc-open (recorded files
  // or open documents only).
  ipcMain.handle('logs:show-file', (_event, id: string, filePath: string) => {
    const validatedId = assertString(id, 'id', 100);
    const requested = assertString(filePath, 'path', 2000);
    const session = sessionManager.getSession(validatedId);
    if (!session) throw new Error('No such task.');
    const resolved = resolveRecordedFile(requested, session.output, harnessDir())
      ?? (documentTabs.isOpen(validatedId, requested) ? path.resolve(requested) : null);
    if (!resolved) throw new Error('refused: not a file this task produced');
    const doc = documentTabs.open(validatedId, resolved, 'user');
    if (shellWindow && !shellWindow.isDestroyed()) {
      if (shellWindow.isMinimized()) shellWindow.restore();
      shellWindow.show();
      shellWindow.focus();
      shellWindow.webContents.send('select-session', validatedId);
    }
    return { opened: true, tab: doc.id };
  });

  ipcMain.handle('workspace:doc-close', (_event, id: string, docId: string) =>
    documentTabs.close(assertString(id, 'id', 100), assertString(docId, 'docId', 20)));

  // ---- Workspace tabs (docs/unify/PLAN.md §3.2–3.3) ----
  ipcMain.handle('workspace:tabs', (_event, id: string) => {
    return browserPool.listTabs(assertString(id, 'id', 100));
  });

  ipcMain.handle('workspace:shortcut', (_event, id: string, shortcut: unknown) => {
    const validatedId = assertString(id, 'id', 100);
    const allowed = ['new-tab', 'close-tab', 'reopen-tab', 'focus-address', 'reload', 'back', 'forward', 'next-tab', 'prev-tab'];
    if (typeof shortcut !== 'string' || !allowed.includes(shortcut)) return false;
    browserPool.runShortcut(validatedId, undefined, shortcut as Parameters<typeof browserPool.runShortcut>[2]);
    return true;
  });

  ipcMain.handle('workspace:tab', (_event, id: string, action: unknown) => {
    const validatedId = assertString(id, 'id', 100);
    if (!action || typeof action !== 'object') return false;
    const a = action as { op?: unknown; tabId?: unknown; input?: unknown };
    const tabId = typeof a.tabId === 'string' && a.tabId.length <= 20 ? a.tabId : undefined;
    switch (a.op) {
      case 'new': {
        const newId = browserPool.openTab(validatedId, { openedBy: 'user' });
        if (newId && typeof a.input === 'string' && a.input.trim() && a.input.length <= 4096) {
          browserPool.navigateTab(validatedId, newId, a.input);
        }
        return newId !== null;
      }
      case 'activate':
        if (!tabId || !browserPool.activateTab(validatedId, tabId)) return false;
        browserPool.keepTab(validatedId, tabId);
        return true;
      case 'close':
        return tabId ? browserPool.closeTab(validatedId, tabId) : false;
      case 'navigate':
        return typeof a.input === 'string' && a.input.length <= 4096
          ? browserPool.navigateTab(validatedId, tabId, a.input)
          : false;
      case 'back':
      case 'forward':
      case 'reload':
      case 'stop':
        return browserPool.tabAction(validatedId, tabId, a.op);
      default:
        return false;
    }
  });

  ipcMain.handle('sessions:view-detach', (_event, id: string) => {
    const validatedId = assertString(id, 'id', 100);
    if (!shellWindow) return false;
    mainLogger.info('main.sessions:view-detach', { id: validatedId });
    takeoverOverlay.hide(validatedId, shellWindow);
    return browserPool.detachFromWindow(validatedId, shellWindow);
  });

  // ---- Takeover overlay (pulsing glow + stop-and-take-over button) ----
  ipcMain.handle('takeover:show', (_event, id: string, bounds: { x: number; y: number; width: number; height: number }, mode?: 'idle' | 'active') => {
    const validatedId = assertString(id, 'id', 100);
    if (!shellWindow) return;
    takeoverOverlay.show(validatedId, shellWindow, bounds, mode ?? 'idle');
    // The browser view was attached before us most of the time; reraise to
    // guarantee our overlay paints above it.
    takeoverOverlay.reraise(validatedId, shellWindow);
  });

  ipcMain.handle('takeover:hide', (_event, id: string) => {
    const validatedId = assertString(id, 'id', 100);
    takeoverOverlay.hide(validatedId, shellWindow);
  });

  ipcMain.handle('takeover:stop', (_event, id: string) => {
    const validatedId = assertString(id, 'id', 100);
    mainLogger.info('main.takeover:stop', { id: validatedId });
    try { sessionManager.cancelSession(validatedId); } catch (err) {
      mainLogger.warn('main.takeover:stop.cancelError', { id: validatedId, error: (err as Error).message });
    }
    takeoverOverlay.hide(validatedId, shellWindow);
  });

  // Fast path: fire-and-forget. Called on every frame during window resize /
  // layout reflow — just setBounds, plus a cheap orphan check: if the view is
  // no longer a child of the shell's contentView (e.g. because temporarilyDetachAll
  // removed it without clearing entry.attached, leaving the renderer seeing a
  // phantom "Browser starting…" state), re-add it here so recovery is automatic.
  ipcMain.on('sessions:view-resize', (_event, id: string, bounds: { x: number; y: number; width: number; height: number }) => {
    if (!shellWindow) return;
    const view = browserPool.getView(id);
    if (!view) return;
    const fitted = browserPool.setViewBoundsFitted(id, bounds) ?? bounds;
    // (Intentionally no setZoomFactor here — previously we recomputed zoom
    // on every resize to fit the emulated viewport, but that clobbered any
    // manual zoom the user set via Cmd+=/Cmd+- and felt like the browser
    // was "resetting itself" on layout changes.)
    browserPool.ensureOnScreen(id);
    // Keep takeover overlay tracking the browser rect and sitting above it.
    // Use the fitted (centered) rect so the overlay aligns with the visible
    // view, not the wider hub box.
    if (takeoverOverlay.hasOverlay(id)) {
      takeoverOverlay.updateBounds(id, fitted);
      takeoverOverlay.reraise(id, shellWindow);
    }
  });

  ipcMain.handle('sessions:view-is-attached', (_event, id: string) => {
    const validatedId = assertString(id, 'id', 100);
    return browserPool.isAttached(validatedId);
  });

  ipcMain.handle('sessions:views-set-visible', (_event, visible: boolean) => {
    if (!shellWindow) return;
    if (visible) browserPool.reattachAll(shellWindow);
    else browserPool.temporarilyDetachAll(shellWindow);
  });

  ipcMain.handle('sessions:views-detach-all', () => {
    if (!shellWindow) return;
    takeoverOverlay.destroyAll(shellWindow);
    browserPool.detachAll(shellWindow);
  });

  ipcMain.handle('sessions:get-tabs', async (_event, id: string) => {
    const validatedId = assertString(id, 'id', 100);
    return browserPool.getTabs(validatedId);
  });

  ipcMain.handle('sessions:pool-stats', () => {
    return browserPool.getStats();
  });

  ipcMain.handle('sessions:memory', () => {
    const snapshot = snapshotResourceUsage(resourceMonitorContext);
    return {
      totalMb: Math.round(snapshot.total.rssMb),
      totalCpuPercent: snapshot.total.cpuPercent,
      sessions: Object.entries(snapshot.bySession).map(([id, usage]) => ({
        id,
        mb: Math.round(usage.rssMb),
        cpuPercent: usage.cpuPercent,
        status: usage.status ?? 'unknown',
        processCount: usage.processCount,
      })),
      processes: snapshot.processes.map((processUsage) => ({
        pid: processUsage.pid,
        label: processUsage.label,
        type: processUsage.kind,
        component: processUsage.component,
        mb: Math.round(processUsage.rssMb),
        cpuPercent: processUsage.cpuPercent,
        sessionId: processUsage.sessionId,
        engineId: processUsage.engineId,
        source: processUsage.source,
      })),
      processCount: snapshot.total.processCount,
      errors: snapshot.errors,
    };
  });

  // ---------------------------------------------------------------------------
  // Shell layout IPC (retained for shell renderer compatibility)
  // ---------------------------------------------------------------------------
  ipcMain.handle('shell:set-chrome-height', (_e, height: unknown) => {
    if (typeof height !== 'number' || !Number.isFinite(height)) return;
    mainLogger.debug('main.shell:set-chrome-height', { height });
    // No TabManager to relay to — no-op in Browser Use Desktop
  });

  ipcMain.handle('shell:set-overlay', (_e, active: unknown) => {
    if (typeof active !== 'boolean') return;
    mainLogger.debug('main.shell:set-overlay', { active });
    // Overlay state forwarded to shell window if needed
    shellWindow?.webContents.send('overlay-changed', active);
  });

  // ---------------------------------------------------------------------------
  // Settings page IPC
  // ---------------------------------------------------------------------------
  ipcMain.handle('settings:open', (_e, rawPayload?: unknown) => {
    const payload = normalizeSettingsOpenPayload(rawPayload);
    mainLogger.info('main.settings:open', { focusBrowserCodeProvider: payload?.focusBrowserCodeProvider });
    openSettingsInShell(payload);
  });

  // Environment report. `refresh` re-runs the checks rather than replaying the
  // startup snapshot, so installing Git and clicking Re-check works without
  // restarting the app.
  // MCP connections. The catalogue is static; what varies is which are on and
  // whether their credentials are complete, so both are returned together —
  // a row that cannot say "missing token" is a row the user cannot fix.
  ipcMain.handle('settings:mcp:list', async () => {
    const { MCP_CATALOG, missingCredentials } = await import('./mcp/catalog');
    const { listConnections } = await import('./mcp/store');
    const connections = await listConnections();
    const byId = new Map(connections.map((connection) => [connection.id, connection]));

    return MCP_CATALOG.map((definition) => {
      const connection = byId.get(definition.id);
      const values = connection?.values ?? {};
      return {
        id: definition.id,
        displayName: definition.displayName,
        summary: definition.summary,
        docsUrl: definition.docsUrl,
        enabled: connection?.enabled ?? false,
        // Never the values themselves: these are live API tokens, and the
        // renderer only needs to know which are present.
        credentials: definition.credentials.map((field) => ({
          key: field.key,
          label: field.label,
          secret: field.secret,
          help: field.help,
          present: Boolean(values[field.key] && values[field.key].trim().length > 0),
        })),
        missing: missingCredentials(definition, values).map((field) => field.key),
        // undefined means "not checked yet", which the UI shows as pending
        // rather than as failure.
        verified: mcpVerifyCache.get(definition.id),
      };
    });
  });

  // Prove the connection rather than assume it. A mistyped token is
  // indistinguishable from a correct one until something fails mid-task, so
  // the dot in Settings reports a real handshake, not merely a saved value.
  ipcMain.handle('settings:mcp:test', async (_event, id: string) => {
    const validated = assertString(id, 'id', 60);
    const { findServerDefinition } = await import('./mcp/catalog');
    const { listConnections } = await import('./mcp/store');
    const { verifyServer } = await import('./mcp/client');

    const definition = findServerDefinition(validated);
    if (!definition) return { ok: false, error: 'Unknown connection.' };

    const connection = (await listConnections()).find((c) => c.id === validated);
    if (!connection) return { ok: false, error: 'Not configured yet.' };

    const result = await verifyServer(definition, connection.values);
    mcpVerifyCache.set(validated, result);
    // Keep the tool names and the account. The next task's prompt states both,
    // which is what stops the agent hunting for tools or guessing a username.
    if (result.ok) {
      const { setConnection } = await import('./mcp/store');
      await setConnection(validated, {
        toolNames: result.toolNames?.length ? result.toolNames : undefined,
        identity: await definition.resolveIdentity?.(connection.values),
      });
    }
    return result;
  });

  ipcMain.handle('settings:mcp:set', async (_event, id: string, patch: { enabled?: boolean; values?: Record<string, string> }) => {
    const validated = assertString(id, 'id', 60);
    const { setConnection } = await import('./mcp/store');
    await setConnection(validated, {
      enabled: typeof patch?.enabled === 'boolean' ? patch.enabled : undefined,
      values: patch?.values && typeof patch.values === 'object' ? patch.values : undefined,
    });
    return { ok: true };
  });

  ipcMain.handle('settings:preflight:get', () => preflightReport ?? refreshPreflight());
  ipcMain.handle('settings:preflight:refresh', () => refreshPreflight());

  ipcMain.handle('settings:app:get-info', () => {
    mainLogger.debug('main.settings:app:get-info');
    return getUpdateRuntimeInfo();
  });

  ipcMain.handle('settings:app:download-latest', async () => {
    mainLogger.info('main.settings:app:download-latest');
    return downloadLatestVersion();
  });

  ipcMain.handle('settings:app:get-update-status', () => {
    mainLogger.debug('main.settings:app:get-update-status');
    return getUpdateStatus();
  });

  ipcMain.handle('settings:app:install-update', () => {
    mainLogger.info('main.settings:app:install-update');
    return installDownloadedUpdate();
  });

  const unsubscribeUpdateStatus = onUpdateStatusChanged((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('settings:app:update-status', event);
    }
  });
  app.once('will-quit', unsubscribeUpdateStatus);

  const unsubscribeBeforeQuitForUpdate = onBeforeQuitForUpdate(() => {
    isQuitting = true;
    mainLogger.info('main.beforeQuitForUpdate', { msg: 'Allowing updater to close windows for install' });
  });
  app.once('will-quit', unsubscribeBeforeQuitForUpdate);

  ipcMain.handle('pill:open-hub', () => {
    mainLogger.info('main.pill:open-hub');
    if (shellWindow && !shellWindow.isDestroyed()) {
      shellWindow.show();
      shellWindow.focus();
    }
    hidePill();
  });

  ipcMain.handle('pill:open-settings', (_e, rawPayload?: unknown) => {
    const payload = normalizeSettingsOpenPayload(rawPayload);
    mainLogger.info('main.pill:open-settings', { focusBrowserCodeProvider: payload?.focusBrowserCodeProvider });
    openSettingsInShell(payload);
    hidePill();
  });

  // ---------------------------------------------------------------------------
  // Application menu
  // ---------------------------------------------------------------------------
  buildApplicationMenu();

  // ---------------------------------------------------------------------------
  // Onboarding gate
  // ---------------------------------------------------------------------------
  const forceOnboarding = process.env.AGB_FORCE_ONBOARDING === '1';
  const onboardingComplete = !forceOnboarding && accountStore.isOnboardingComplete();
  mainLogger.info('main.onboardingGate', { onboardingComplete, forceOnboarding });

  buildApplicationMenu();

  // Register onboarding + chrome-import IPC once at app boot. Previously these
  // were tied to the onboarding window's lifetime, so closing the window
  // mid-flow and reopening (via app.activate) gave you a renderer that fired
  // IPC into a void — CC and profile detection silently broke. Handlers now
  // use a getter so they always reach the live window.
  registerChromeImportHandlers({ accountStore });
  registerOnboardingHandlers({
    accountStore,
    getOnboardingWindow: () => onboardingWindow,
    openShellWindow: () => openShellAndWire(),
  });

  if (!onboardingComplete) {
    mainLogger.info('main.onboardingGate.fresh', { msg: 'Opening onboarding window' });
    onboardingWindow = createOnboardingWindow();
    onboardingWindow.on('closed', () => {
      mainLogger.info('main.onboardingWindow.closed');
      onboardingWindow = null;
    });
  } else {
    mainLogger.info('main.onboardingGate.returning', { msg: 'Returning user — opening shell' });
    openShellAndWire();
  }

  // ---------------------------------------------------------------------------
  // Auto-updater
  // ---------------------------------------------------------------------------
  initUpdater().catch((err) => {
    mainLogger.warn('main.updater.initFailed', { error: (err as Error)?.message ?? String(err) });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle hooks
  // ---------------------------------------------------------------------------
  app.on('before-quit', async () => {
    isQuitting = true;
    mainLogger.info('main.beforeQuit', { msg: 'Aborting active agents' });
    for (const [task_id, ctrl] of activeAgents) {
      mainLogger.info('main.beforeQuit.abortAgent', { task_id });
      ctrl.abort();
    }
    activeAgents.clear();
    browserPool.destroyAll(shellWindow ?? undefined);
    documentTabs.dispose();
    stopResourceMonitor();
    sessionManager.destroy();
    whatsAppAdapter.disconnect().catch(() => {});
    channelRouter.destroy();
    unregisterChannelHandlers();
  });

  app.on('will-quit', () => {
    mainLogger.info('main.willQuit', { msg: 'Unregistering hotkeys and updater' });
    unregisterHotkeys();
    stopUpdater();
    globalShortcut.unregisterAll();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainLogger.info('main.activate', { msg: 'Re-activating app (no windows)', onboardingComplete: accountStore.isOnboardingComplete() });
      if (accountStore.isOnboardingComplete()) {
        openShellAndWire();
      } else {
        onboardingWindow = createOnboardingWindow();
        onboardingWindow.on('closed', () => {
          mainLogger.info('main.onboardingWindow.closed');
          onboardingWindow = null;
        });
      }
    } else if (shellWindow && !shellWindow.isDestroyed()) {
      mainLogger.info('main.activate', { msg: 'Re-activating app (showing shell)' });
      shellWindow.show();
      shellWindow.focus();
    }
  });
});

// ---------------------------------------------------------------------------
// Quit behaviour (macOS: stay alive until Cmd+Q)
// ---------------------------------------------------------------------------
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ---------------------------------------------------------------------------
// Window-level IPC (registered outside whenReady — safe for preload bridge)
// ---------------------------------------------------------------------------
ipcMain.handle('shell:get-platform', () => {
  mainLogger.debug('main.shell:get-platform', { platform: process.platform });
  return process.platform;
});

// Theme IPC must be ready before any renderer can call `theme:get`. A
// startup race (second-instance, dev-server reload) can spin up a window
// before the whenReady() block runs — register at module load instead.
registerThemeHandlers();

// ---------------------------------------------------------------------------
// Application menu
// ---------------------------------------------------------------------------
function buildApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            mainLogger.debug('menu.openSettings');
            openSettingsInShell();
          },
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Agent',
      submenu: [
        {
          label: 'New Agent',
          click: () => {
            mainLogger.debug('menu.newAgent.togglePill');
            togglePill();
            if (shellWindow && !shellWindow.isDestroyed()) {
              shellWindow.webContents.send('pill-toggled');
            }
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      role: 'windowMenu',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Report an Issue…',
          click: () => {
            mainLogger.debug('menu.reportIssue');
            shell.openExternal('https://github.com/Chethan616/Dex/issues');
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
