import { contextBridge, ipcRenderer } from 'electron';
import {
  validateSession,
  validateSessionList,
  validateHlEvent,
  validateTabs,
  validatePoolStats,
} from '../shared/session-schemas';
import type { AgentSession, HlEvent, TabInfo, BrowserPoolStats } from '../shared/session-schemas';
import { createPopupBridge } from './popupBridge';
import type { PreflightReport } from '../main/startup/preflight';

interface McpConnectionInfo {
  id: string;
  displayName: string;
  summary: string;
  docsUrl?: string;
  enabled: boolean;
  credentials: Array<{ key: string; label: string; secret: boolean; help?: string; present: boolean }>;
  missing: string[];
  verified?: { ok: boolean; serverName?: string; toolCount?: number; error?: string };
}

type SettingsOpenPayload = { focusBrowserCodeProvider?: string };

function normalizeSettingsOpenPayload(raw: unknown): SettingsOpenPayload | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rawProvider = (raw as { focusBrowserCodeProvider?: unknown }).focusBrowserCodeProvider;
  const providerId = typeof rawProvider === 'string' ? rawProvider.trim() : '';
  return providerId.length > 0 && providerId.length <= 80
    ? { focusBrowserCodeProvider: providerId }
    : undefined;
}

contextBridge.exposeInMainWorld('electronAPI', {
  profile: {
    get: (): Promise<unknown> => ipcRenderer.invoke('profile:get'),
    set: (next: { bot?: string; color?: string | null; name?: string | null }): Promise<unknown> => ipcRenderer.invoke('profile:set', next),
    onChange: (cb: (profile: unknown) => void): (() => void) => {
      const handler = (_evt: unknown, payload: unknown) => cb(payload);
      ipcRenderer.on('profile:changed', handler);
      return () => ipcRenderer.removeListener('profile:changed', handler);
    },
  },
  shell: {
    platform: process.platform,
    getPlatform: (): Promise<string> => ipcRenderer.invoke('shell:get-platform'),
    setOverlay: (active: boolean): void => {
      ipcRenderer.send('shell:set-overlay', active);
    },
  },
  pill: {
    toggle: (): Promise<void> => ipcRenderer.invoke('pill:toggle'),
    hide: (): Promise<void> => ipcRenderer.invoke('pill:hide'),
  },
  logs: {
    toggle: (
      sessionId: string,
      anchor?: { x: number; y: number; width: number; height: number },
    ): Promise<boolean> => ipcRenderer.invoke('logs:toggle', sessionId, anchor),
    show: (
      sessionId: string,
      anchor?: { x: number; y: number; width: number; height: number },
    ): Promise<boolean> => ipcRenderer.invoke('logs:show', sessionId, anchor),
    close: (): Promise<void> => ipcRenderer.invoke('logs:close'),
    focusFollowUp: (
      sessionId: string,
      anchor?: { x: number; y: number; width: number; height: number },
    ): Promise<void> => ipcRenderer.invoke('logs:focus-followup', sessionId, anchor),
    // Fire-and-forget during rapid hub resize — keeps dot/normal/full bounds
    // aligned to the pane rect without an invoke round-trip per frame.
    updateAnchor: (anchor: { x: number; y: number; width: number; height: number }): void => {
      ipcRenderer.send('logs:update-anchor', anchor);
    },
  },
  popup: createPopupBridge(),
  /** The task's tabs (docs/unify/PLAN.md §3.2): list, act, follow changes. */
  workspace: {
    tabs: (sessionId: string): Promise<unknown[]> => ipcRenderer.invoke('workspace:tabs', sessionId),
    tab: (
      sessionId: string,
      action:
        | { op: 'new'; input?: string }
        | { op: 'activate' | 'close'; tabId: string }
        | { op: 'navigate'; tabId?: string; input: string }
        | { op: 'back' | 'forward' | 'reload' | 'stop'; tabId?: string },
    ): Promise<boolean> => ipcRenderer.invoke('workspace:tab', sessionId, action),
    shortcut: (sessionId: string, shortcut: string): Promise<boolean> =>
      ipcRenderer.invoke('workspace:shortcut', sessionId, shortcut),
    onFocusAddress: (cb: (sessionId: string) => void): (() => void) => {
      const handler = (_event: unknown, sessionId: unknown) => { if (typeof sessionId === 'string') cb(sessionId); };
      ipcRenderer.on('workspace:focus-address', handler);
      return () => ipcRenderer.removeListener('workspace:focus-address', handler);
    },
    onTabsChanged: (cb: (sessionId: string, tabs: unknown[]) => void): (() => void) => {
      const handler = (_event: unknown, sessionId: unknown, tabs: unknown) => {
        if (typeof sessionId === 'string' && Array.isArray(tabs)) cb(sessionId, tabs);
      };
      ipcRenderer.on('workspace:tabs-changed', handler);
      return () => ipcRenderer.removeListener('workspace:tabs-changed', handler);
    },
  },
  takeover: {
    show: (
      sessionId: string,
      bounds: { x: number; y: number; width: number; height: number },
      mode?: 'idle' | 'active',
    ): Promise<void> => ipcRenderer.invoke('takeover:show', sessionId, bounds, mode),
    hide: (sessionId: string): Promise<void> => ipcRenderer.invoke('takeover:hide', sessionId),
  },
  settings: {
    open: (payload?: { focusBrowserCodeProvider?: string }): Promise<void> => ipcRenderer.invoke('settings:open', payload),
    apiKey: {
      getMasked: (): Promise<{ present: boolean; masked: string | null }> =>
        ipcRenderer.invoke('settings:api-key:get-masked'),
      getStatus: (): Promise<{ type: 'oauth' | 'apiKey' | 'none'; masked?: string; subscriptionType?: string | null; expiresAt?: number }> =>
        ipcRenderer.invoke('settings:api-key:get-status'),
      save: (key: string): Promise<void> =>
        ipcRenderer.invoke('settings:api-key:save', key),
      test: (key: string): Promise<{ success: boolean; error?: string }> =>
        ipcRenderer.invoke('settings:api-key:test', key),
      delete: (): Promise<void> => ipcRenderer.invoke('settings:api-key:delete'),
    },
    claudeCode: {
      available: (): Promise<{ available: boolean; subscriptionType?: string | null }> =>
        ipcRenderer.invoke('settings:claude-code:available'),
      use: (): Promise<{ subscriptionType: string | null }> =>
        ipcRenderer.invoke('settings:claude-code:use'),
      login: (): Promise<{ ok: boolean; error?: string }> =>
        ipcRenderer.invoke('settings:claude-code:login'),
      logout: (): Promise<{ opened: boolean; error?: string }> =>
        ipcRenderer.invoke('settings:claude-code:logout'),
    },
    openaiKey: {
      getStatus: (): Promise<{ present: boolean; masked?: string }> =>
        ipcRenderer.invoke('settings:openai-key:get-status'),
      save: (key: string): Promise<void> =>
        ipcRenderer.invoke('settings:openai-key:save', key),
      test: (key: string): Promise<{ success: boolean; error?: string }> =>
        ipcRenderer.invoke('settings:openai-key:test', key),
      delete: (): Promise<void> => ipcRenderer.invoke('settings:openai-key:delete'),
    },
    codex: {
      status: (): Promise<{
        id: string;
        displayName: string;
        installed: { installed: boolean; version?: string; error?: string };
        authed: { authed: boolean; error?: string };
      }> => ipcRenderer.invoke('sessions:engine-status', 'codex'),
      login: (opts?: { deviceAuth?: boolean }): Promise<{ opened: boolean; error?: string; verificationUrl?: string; deviceCode?: string }> =>
        ipcRenderer.invoke('sessions:engine-login', 'codex', opts),
      logout: (): Promise<{ opened: boolean; error?: string }> =>
        ipcRenderer.invoke('settings:codex:logout'),
    },
    browserCode: {
      getStatus: (): Promise<{
        keys: Record<string, { masked: string; lastModel?: string }>;
        active: string | null;
        installed?: { installed: boolean; version?: string; error?: string };
        providers: Array<{
          id: string;
          name: string;
          defaultModel: string;
          models: Array<{ id: string; label: string }>;
        }>;
      }> => ipcRenderer.invoke('settings:browsercode:get-status'),
      save: (payload: { providerId: string; apiKey: string; lastModel?: string }): Promise<void> =>
        ipcRenderer.invoke('settings:browsercode:save', payload),
      test: (payload: { providerId: string; apiKey: string; model?: string }): Promise<{ success: boolean; error?: string }> =>
        ipcRenderer.invoke('settings:browsercode:test', payload),
      delete: (payload?: { providerId?: string }): Promise<void> =>
        ipcRenderer.invoke('settings:browsercode:delete', payload),
      setActive: (payload: { providerId: string }): Promise<void> =>
        ipcRenderer.invoke('settings:browsercode:set-active', payload),
    },
    privacy: {
      get: (): Promise<{ telemetry: boolean; telemetryUpdatedAt: string | null; version: number }> =>
        ipcRenderer.invoke('consent:get'),
      setTelemetry: (optedIn: boolean): Promise<{ telemetry: boolean; telemetryUpdatedAt: string | null; version: number }> =>
        ipcRenderer.invoke('consent:set-telemetry', optedIn),
      openSystemNotifications: (): Promise<{ ok: boolean; error?: string }> =>
        ipcRenderer.invoke('settings:open-system-notifications'),
    },
    approvals: {
      get: (): Promise<{ mode: 'ask' | 'auto' | 'full' }> => ipcRenderer.invoke('settings:approvals:get'),
      set: (mode: 'ask' | 'auto' | 'full'): Promise<{ mode: 'ask' | 'auto' | 'full' }> =>
        ipcRenderer.invoke('settings:approvals:set', mode),
    },
    theme: {
      get: (): Promise<{ mode: 'light' | 'dark' | 'system'; resolved: 'light' | 'dark' }> =>
        ipcRenderer.invoke('theme:get'),
      set: (mode: 'light' | 'dark' | 'system'): Promise<{ mode: 'light' | 'dark' | 'system'; resolved: 'light' | 'dark' }> =>
        ipcRenderer.invoke('theme:set', mode),
      onChange: (cb: (event: { mode: 'light' | 'dark' | 'system'; resolved: 'light' | 'dark' }) => void): (() => void) => {
        const handler = (_evt: unknown, payload: { mode: 'light' | 'dark' | 'system'; resolved: 'light' | 'dark' }) => cb(payload);
        ipcRenderer.on('theme:changed', handler);
        return () => ipcRenderer.removeListener('theme:changed', handler);
      },
    },
    mcp: {
      list: (): Promise<McpConnectionInfo[]> => ipcRenderer.invoke('settings:mcp:list'),
      set: (id: string, patch: { enabled?: boolean; values?: Record<string, string> }): Promise<{ ok: boolean }> =>
        ipcRenderer.invoke('settings:mcp:set', id, patch),
      test: (id: string): Promise<{ ok: boolean; serverName?: string; toolCount?: number; error?: string }> =>
        ipcRenderer.invoke('settings:mcp:test', id),
    },
    bridge: {
      status: (): Promise<unknown> => ipcRenderer.invoke('bridge:status'),
      restart: (): Promise<void> => ipcRenderer.invoke('bridge:restart'),
      signIn: (email: string, password: string, create: boolean): Promise<unknown> => ipcRenderer.invoke('bridge:sign-in', email, password, create),
      resetPassword: (email: string): Promise<unknown> => ipcRenderer.invoke('bridge:reset-password', email),
      signOut: (): Promise<void> => ipcRenderer.invoke('bridge:sign-out'),
      onState: (cb: (state: unknown) => void): (() => void) => {
        const handler = (_evt: unknown, payload: unknown) => cb(payload);
        ipcRenderer.on('bridge:state', handler);
        return () => ipcRenderer.removeListener('bridge:state', handler);
      },
    },
    accounts: {
      list: (): Promise<unknown> => ipcRenderer.invoke('accounts:list'),
      connect: (provider: 'google' | 'github' | 'slack'): Promise<unknown> => ipcRenderer.invoke('accounts:connect', provider),
      cancel: (provider: 'google' | 'github' | 'slack'): Promise<void> => ipcRenderer.invoke('accounts:cancel', provider),
      disconnect: (provider: 'google' | 'github' | 'slack'): Promise<void> => ipcRenderer.invoke('accounts:disconnect', provider),
      openLink: (key: 'huggingface-pro' | 'huggingface-billing' | 'huggingface-zerogpu'): Promise<void> => ipcRenderer.invoke('accounts:open-link', key),
      onProgress: (cb: (event: unknown) => void): (() => void) => {
        const handler = (_evt: unknown, payload: unknown) => cb(payload);
        ipcRenderer.on('accounts:progress', handler);
        return () => ipcRenderer.removeListener('accounts:progress', handler);
      },
    },
    preflight: {
      get: (): Promise<PreflightReport> => ipcRenderer.invoke('settings:preflight:get'),
      refresh: (): Promise<PreflightReport> => ipcRenderer.invoke('settings:preflight:refresh'),
    },
    app: {
      getInfo: (): Promise<{
        version: string;
        latestVersion: string | null;
        isLatestVersion: boolean | null;
        platform: string;
        packaged: boolean;
        updateSupported: boolean;
        canDownloadUpdate: boolean;
        updateFeedUrl: string;
      }> => ipcRenderer.invoke('settings:app:get-info'),
      downloadLatest: (): Promise<{
        ok: boolean;
        action: 'started-update-check' | 'unavailable';
        message: string;
      }> => ipcRenderer.invoke('settings:app:download-latest'),
      getUpdateStatus: (): Promise<{
        status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error' | 'unavailable';
        version?: string;
        message?: string;
        error?: string;
        progress?: {
          percent: number | null;
          transferred: number | null;
          total: number | null;
          bytesPerSecond: number | null;
        };
      }> => ipcRenderer.invoke('settings:app:get-update-status'),
      installUpdate: (): Promise<{
        ok: boolean;
        action: 'install-started' | 'not-ready';
        message: string;
      }> => ipcRenderer.invoke('settings:app:install-update'),
      onUpdateStatus: (cb: (event: {
        status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error' | 'unavailable';
        version?: string;
        message?: string;
        error?: string;
        progress?: {
          percent: number | null;
          transferred: number | null;
          total: number | null;
          bytesPerSecond: number | null;
        };
      }) => void): (() => void) => {
        const handler = (_event: unknown, payload: {
          status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error' | 'unavailable';
          version?: string;
          message?: string;
          error?: string;
          progress?: {
            percent: number | null;
            transferred: number | null;
            total: number | null;
            bytesPerSecond: number | null;
          };
        }) => cb(payload);
        ipcRenderer.on('settings:app:update-status', handler);
        return () => ipcRenderer.removeListener('settings:app:update-status', handler);
      },
    },
  },
  telemetry: {
    capture: (name: string, props?: Record<string, string | number | boolean>): void => {
      ipcRenderer.invoke('telemetry:capture', name, props);
    },
  },
  dex: {
    // Answers a dex-registry (or dex-sh) confirmation card
    // (PreviewDeck's ConfirmationCard). `lifetime` — 'once' (default),
    // 'turn', or 'session' — controls whether this answer is remembered so
    // later calls in the same category skip the prompt.
    confirmAnswer: (sessionId: string, id: string, approved: boolean, lifetime?: 'once' | 'turn' | 'session'): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('dex:confirm-answer', sessionId, id, approved, lifetime),
  },
  sessions: {
    create: (
      promptOrPayload: string | { prompt: string; attachments?: Array<{ name: string; mime: string; bytes: Uint8Array }>; engine?: string; model?: string },
    ): Promise<string> => ipcRenderer.invoke('sessions:create', promptOrPayload),
    start: (id: string): Promise<void> => ipcRenderer.invoke('sessions:start', id),
    cancel: (id: string): Promise<void> => ipcRenderer.invoke('sessions:cancel', id),
    pause: (id: string): Promise<{ paused?: boolean; error?: string }> => ipcRenderer.invoke('sessions:pause', id),
    halt: (id: string): Promise<void> => ipcRenderer.invoke('sessions:halt', id),
    steer: (id: string, message: string): Promise<{ queued?: boolean; error?: string }> =>
      ipcRenderer.invoke('sessions:steer', { id, message }),
    dismiss: (id: string): Promise<void> => ipcRenderer.invoke('sessions:dismiss', id),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('sessions:delete', id),
    downloadOutput: (filePath: string): Promise<{ opened: boolean }> =>
      ipcRenderer.invoke('sessions:download-output', filePath),
    revealOutput: (filePath: string): Promise<{ revealed: boolean }> =>
      ipcRenderer.invoke('sessions:reveal-output', filePath),
    listEditors: (): Promise<Array<{ id: string; name: string }>> =>
      ipcRenderer.invoke('sessions:list-editors'),
    openInEditor: (editorId: string, filePath: string): Promise<{ opened: boolean }> =>
      ipcRenderer.invoke('sessions:open-in-editor', { editorId, filePath }),
    listEngines: (): Promise<Array<{ id: string; displayName: string; binaryName: string; selectableModels?: Array<{ id: string; label: string; hint?: string }> }>> =>
      ipcRenderer.invoke('sessions:list-engines'),
    engineStatus: (engineId: string): Promise<{
      id: string;
      displayName: string;
      installed: { installed: boolean; version?: string; error?: string };
      authed: { authed: boolean; error?: string };
    }> => ipcRenderer.invoke('sessions:engine-status', engineId),
    engineLogin: (engineId: string): Promise<{ opened: boolean; error?: string }> =>
      ipcRenderer.invoke('sessions:engine-login', engineId),
    engineInstall: (engineId: string): Promise<{
      opened: boolean;
      completed?: boolean;
      exitCode?: number | null;
      signal?: string | null;
      error?: string;
      command?: string;
      displayName?: string;
      stdout?: string;
      stderr?: string;
      installed?: { installed: boolean; version?: string; error?: string };
    }> =>
      ipcRenderer.invoke('sessions:engine-install', engineId),
    resume: (
      id: string,
      prompt: string,
      attachments?: Array<{ name: string; mime: string; bytes: Uint8Array }>,
    ): Promise<{ resumed?: boolean; queued?: boolean; error?: string }> =>
      ipcRenderer.invoke('sessions:resume', { id, prompt, attachments }),
    rerun: (id: string): Promise<{ rerun?: boolean; error?: string }> =>
      ipcRenderer.invoke('sessions:rerun', id),
    list: async (): Promise<AgentSession[]> => {
      const raw = await ipcRenderer.invoke('sessions:list');
      return validateSessionList(raw);
    },
    listAll: async (): Promise<AgentSession[]> => {
      const raw = await ipcRenderer.invoke('sessions:list-all');
      return validateSessionList(raw);
    },
    get: async (id: string): Promise<AgentSession | null> => {
      const raw = await ipcRenderer.invoke('sessions:get', id);
      if (!raw) return null;
      return validateSession(raw);
    },
    viewAttach: (id: string, bounds: { x: number; y: number; width: number; height: number }): Promise<boolean> =>
      ipcRenderer.invoke('sessions:view-attach', id, bounds),
    viewDetach: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('sessions:view-detach', id),
    // Fire-and-forget during rapid window resize: avoid the invoke round-trip
    // (renderer → main → reply promise) that adds latency at 60+ events/sec.
    viewResize: (id: string, bounds: { x: number; y: number; width: number; height: number }): void => {
      ipcRenderer.send('sessions:view-resize', id, bounds);
    },
    viewIsAttached: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('sessions:view-is-attached', id),
    viewsSetVisible: (visible: boolean): Promise<void> =>
      ipcRenderer.invoke('sessions:views-set-visible', visible),
    viewsDetachAll: (): Promise<void> =>
      ipcRenderer.invoke('sessions:views-detach-all'),
    getTabs: async (id: string): Promise<TabInfo[]> => {
      const raw = await ipcRenderer.invoke('sessions:get-tabs', id);
      return validateTabs(raw);
    },
    poolStats: async (): Promise<BrowserPoolStats> => {
      const raw = await ipcRenderer.invoke('sessions:pool-stats');
      return validatePoolStats(raw);
    },
    memory: (): Promise<{
      totalMb: number;
      totalCpuPercent?: number;
      sessions: Array<{ id: string; mb: number; cpuPercent?: number; status: string; processCount?: number }>;
      processes: Array<{
        pid?: number;
        label: string;
        type: string;
        component?: string;
        mb: number;
        cpuPercent?: number;
        sessionId?: string;
        engineId?: string;
        source?: string;
      }>;
      processCount: number;
      errors?: string[];
    }> => ipcRenderer.invoke('sessions:memory'),
    getTermReplay: (id: string): Promise<string> =>
      ipcRenderer.invoke('sessions:get-term-replay', id),
  },
  hotkeys: {
    getGlobalCmdbar: (): Promise<string> => ipcRenderer.invoke('hotkeys:get-global'),
    setGlobalCmdbar: (accel: string): Promise<{ ok: boolean; accelerator: string }> =>
      ipcRenderer.invoke('hotkeys:set-global', accel),
  },
  channels: {
    whatsapp: {
      connect: (): Promise<{ status: string }> => ipcRenderer.invoke('channels:whatsapp:connect'),
      disconnect: (): Promise<{ status: string }> => ipcRenderer.invoke('channels:whatsapp:disconnect'),
      status: (): Promise<{ status: string; identity: string | null }> => ipcRenderer.invoke('channels:whatsapp:status'),
      clearAuth: (): Promise<{ status: string }> => ipcRenderer.invoke('channels:whatsapp:clear-auth'),
    },
  },
  chromeImport: {
    detectProfiles: (): Promise<Array<{ id: string; directory: string; browserKey: string; browserName: string; name: string; email: string; avatarIcon: string }>> =>
      ipcRenderer.invoke('chrome-import:detect-profiles'),
    importCookies: (profileId: string): Promise<{
      profileId: string;
      browserName: string;
      profileDirectory: string;
      total: number;
      imported: number;
      failed: number;
      skipped: number;
      domains: string[];
      failedDomains: string[];
      errorReasons: Record<string, number>;
    }> => ipcRenderer.invoke('chrome-import:import-cookies', profileId),
    listCookies: (): Promise<Array<{
      name: string;
      domain: string;
      path: string;
      secure: boolean;
      httpOnly: boolean;
      expires: number | null;
      sameSite: string;
    }>> => ipcRenderer.invoke('chrome-import:list-cookies'),
    getSyncs: (): Promise<Record<string, {
      last_synced_at: string;
      imported: number;
      total: number;
      domain_count: number;
      new_cookies?: number;
      updated_cookies?: number;
      unchanged_cookies?: number;
      new_domain_count?: number;
      updated_domain_count?: number;
    }>> => ipcRenderer.invoke('chrome-import:get-syncs'),
  },
  on: {
    windowReady: (cb: () => void): (() => void) => {
      const handler = () => cb();
      ipcRenderer.on('window-ready', handler);
      return () => ipcRenderer.removeListener('window-ready', handler);
    },
    sessionUpdated: (cb: (session: AgentSession) => void): (() => void) => {
      const handler = (_event: unknown, raw: unknown) => {
        try {
          cb(validateSession(raw));
        } catch (err) {
          console.error('[preload] sessionUpdated validation failed', err);
        }
      };
      ipcRenderer.on('session-updated', handler);
      return () => ipcRenderer.removeListener('session-updated', handler);
    },
    sessionBrowserGone: (cb: (id: string) => void): (() => void) => {
      const handler = (_event: unknown, id: string) => {
        if (typeof id === 'string') cb(id);
      };
      ipcRenderer.on('sessions:browser-gone', handler);
      return () => ipcRenderer.removeListener('sessions:browser-gone', handler);
    },
    sessionOutput: (cb: (id: string, event: HlEvent) => void): (() => void) => {
      const handler = (_event: unknown, id: string, raw: unknown) => {
        try {
          cb(id, validateHlEvent(raw));
        } catch (err) {
          console.error('[preload] sessionOutput validation failed', err);
        }
      };
      ipcRenderer.on('session-output', handler);
      return () => ipcRenderer.removeListener('session-output', handler);
    },
    sessionOutputTerm: (cb: (id: string, bytes: string) => void): (() => void) => {
      const handler = (_event: unknown, id: string, bytes: string) => {
        if (typeof id === 'string' && typeof bytes === 'string') cb(id, bytes);
      };
      ipcRenderer.on('session-output-term', handler);
      return () => ipcRenderer.removeListener('session-output-term', handler);
    },
    openSettings: (cb: (payload?: SettingsOpenPayload) => void): (() => void) => {
      const handler = (_event: unknown, rawPayload?: unknown) => cb(normalizeSettingsOpenPayload(rawPayload));
      ipcRenderer.on('open-settings', handler);
      return () => ipcRenderer.removeListener('open-settings', handler);
    },
    hubRelayout: (cb: (reason: string) => void): (() => void) => {
      const handler = (_event: unknown, reason: string) => cb(reason);
      ipcRenderer.on('hub:relayout', handler);
      return () => ipcRenderer.removeListener('hub:relayout', handler);
    },
    zoomChanged: (cb: (factor: number) => void): (() => void) => {
      const handler = (_event: unknown, factor: number) => cb(factor);
      ipcRenderer.on('zoom-changed', handler);
      return () => ipcRenderer.removeListener('zoom-changed', handler);
    },
    whatsappQr: (cb: (dataUrl: string) => void): (() => void) => {
      const handler = (_event: unknown, dataUrl: string) => cb(dataUrl);
      ipcRenderer.on('whatsapp-qr', handler);
      return () => ipcRenderer.removeListener('whatsapp-qr', handler);
    },
    channelStatus: (cb: (channelId: string, status: string, detail?: string) => void): (() => void) => {
      const handler = (_event: unknown, channelId: string, status: string, detail?: string) => cb(channelId, status, detail);
      ipcRenderer.on('channel-status', handler);
      return () => ipcRenderer.removeListener('channel-status', handler);
    },
    pillToggled: (cb: () => void): (() => void) => {
      const handler = () => cb();
      ipcRenderer.on('pill-toggled', handler);
      return () => ipcRenderer.removeListener('pill-toggled', handler);
    },
    globalCmdbarChanged: (cb: (accelerator: string) => void): (() => void) => {
      const handler = (_event: unknown, accelerator: string) => cb(accelerator);
      ipcRenderer.on('hotkeys:global-changed', handler);
      return () => ipcRenderer.removeListener('hotkeys:global-changed', handler);
    },
    forceViewMode: (cb: (mode: 'dashboard' | 'grid' | 'list') => void): (() => void) => {
      const handler = (_event: unknown, mode: 'dashboard' | 'grid' | 'list') => cb(mode);
      ipcRenderer.on('hub:force-view-mode', handler);
      return () => ipcRenderer.removeListener('hub:force-view-mode', handler);
    },
  },
});
