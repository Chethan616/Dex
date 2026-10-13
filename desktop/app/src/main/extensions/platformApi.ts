/**
 * The smaller chrome.* APIs, each mapped onto what Windows and Electron
 * offer: notifications (Windows toasts), idle (the system's idle state),
 * power (keep awake), search, font lists, commands, sign-in windows for
 * chrome.identity, offscreen documents, side panels (drawn as popups under
 * the toolbar button), and chrome.runtime's few missing pieces.
 *
 * Anything a desktop browser has that DEX doesn't answers with a clear
 * error instead of crashing the extension.
 */
import { ApiError, type CallContext, type Handler } from './types';
import { searchUrl } from '../../shared/address';
import type { Manifest } from './manifest';

export interface ShownNotification { close(): void }

export interface PlatformDeps {
  manifest(extensionId: string): Manifest | null;
  name(extensionId: string): string;
  hasPermission(extensionId: string, permission: string): boolean;
  /** A data URL or extension file as an image for a toast. */
  notify(extensionId: string, opts: { title: string; body: string; icon?: string; silent: boolean; requireInteraction: boolean }, on: { click(): void; close(byUser: boolean): void }): ShownNotification;
  idleState(thresholdSeconds: number): 'active' | 'idle' | 'locked' | 'unknown';
  keepAwake(extensionId: string, level: 'system' | 'display' | null): void;
  /** Open a page in a tab of the task the caller means. */
  openTab(ctx: CallContext, url: string): void;
  /** chrome.identity.launchWebAuthFlow: resolves the redirect URL. */
  authFlow(extensionId: string, url: string, interactive: boolean): Promise<string>;
  offscreen: {
    create(extensionId: string, url: string): Promise<void>;
    has(extensionId: string): boolean;
    close(extensionId: string): void;
  };
  /** Show a page of the extension under its toolbar button (popups, side panels). */
  showPanel(ctx: CallContext, page: string, kind: 'popup' | 'side_panel'): Promise<void>;
  contexts(extensionId: string): Array<Record<string, unknown>>;
  setUninstallUrl(extensionId: string, url: string): void;
  emit(extensionId: string, event: string, args: unknown[]): void;
}

const FONTS = [
  'Arial', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel',
  'Courier New', 'Ebrima', 'Franklin Gothic Medium', 'Gabriola', 'Gadugi', 'Georgia', 'Impact', 'Lucida Console',
  'Lucida Sans Unicode', 'Malgun Gothic', 'Microsoft Sans Serif', 'Palatino Linotype', 'Segoe Print', 'Segoe Script',
  'Segoe UI', 'Sitka Text', 'Sylfaen', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
];

/** Chrome's way of writing a shortcut, from a manifest's suggested_key. */
export function shortcutOf(suggested: unknown): string {
  if (typeof suggested === 'string') return suggested;
  const s = (suggested ?? {}) as Record<string, string>;
  return s.windows || s.default || '';
}

export class Platform {
  private notifications = new Map<string, Map<string, ShownNotification>>();
  private idleIntervals = new Map<string, number>();
  private lastIdle = new Map<string, string>();
  private sidePanels = new Map<string, { path?: string; enabled: boolean; openOnAction: boolean }>();

  constructor(private readonly deps: PlatformDeps) {}

  sidePanelFor(extensionId: string): { path?: string; enabled: boolean; openOnAction: boolean } {
    const manifest = this.deps.manifest(extensionId);
    const fallback = { path: manifest?.side_panel?.default_path, enabled: true, openOnAction: false };
    return { ...fallback, ...this.sidePanels.get(extensionId) };
  }

  /** Check every extension that listens for idle changes; called on a timer. */
  pollIdle(listening: string[]): void {
    for (const id of listening) {
      const state = this.deps.idleState(this.idleIntervals.get(id) ?? 60);
      if (state === 'unknown') continue;
      const before = this.lastIdle.get(id);
      this.lastIdle.set(id, state);
      if (before && before !== state) this.deps.emit(id, 'idle.onStateChanged', [state]);
    }
  }

  forgetExtension(extensionId: string): void {
    for (const n of this.notifications.get(extensionId)?.values() ?? []) { try { n.close(); } catch { /* gone */ } }
    this.notifications.delete(extensionId);
    this.idleIntervals.delete(extensionId);
    this.lastIdle.delete(extensionId);
    this.sidePanels.delete(extensionId);
    this.deps.keepAwake(extensionId, null);
    this.deps.offscreen.close(extensionId);
  }

  private showNotification(ctx: CallContext, id: string, options: Record<string, unknown>): void {
    const own = this.notifications.get(ctx.extensionId) ?? new Map<string, ShownNotification>();
    this.notifications.set(ctx.extensionId, own);
    own.get(id)?.close();
    const items = Array.isArray(options.items)
      ? options.items.map((i) => `${String((i as { title?: string }).title ?? '')}: ${String((i as { message?: string }).message ?? '')}`)
      : [];
    const progress = typeof options.progress === 'number' ? [`${Math.round(options.progress)}%`] : [];
    const body = [options.message, options.contextMessage, ...items, ...progress].filter((x) => typeof x === 'string' && x).join('\n');
    const shown = this.deps.notify(ctx.extensionId, {
      title: typeof options.title === 'string' && options.title ? options.title : this.deps.name(ctx.extensionId),
      body,
      icon: typeof options.iconUrl === 'string' ? options.iconUrl : undefined,
      silent: options.silent === true,
      requireInteraction: options.requireInteraction === true,
    }, {
      click: () => this.deps.emit(ctx.extensionId, 'notifications.onClicked', [id]),
      close: (byUser) => {
        own.delete(id);
        this.deps.emit(ctx.extensionId, 'notifications.onClosed', [id, byUser]);
      },
    });
    own.set(id, shown);
  }

  handlers(): Record<string, Handler> {
    const need = (ctx: CallContext, perm: string) => {
      if (!this.deps.hasPermission(ctx.extensionId, perm)) throw new ApiError(`The '${perm}' permission is required.`);
    };
    return {
      'notifications.create': (ctx, [id, options]) => {
        need(ctx, 'notifications');
        const opts = (options ?? {}) as Record<string, unknown>;
        if (typeof opts.title !== 'string' || typeof opts.message !== 'string') throw new ApiError('Notifications need a title and a message.');
        this.showNotification(ctx, String(id), opts);
        return String(id);
      },
      'notifications.update': (ctx, [id, options]) => {
        need(ctx, 'notifications');
        if (!this.notifications.get(ctx.extensionId)?.has(String(id))) return false;
        this.showNotification(ctx, String(id), (options ?? {}) as Record<string, unknown>);
        return true;
      },
      'notifications.clear': (ctx, [id]) => {
        const n = this.notifications.get(ctx.extensionId)?.get(String(id));
        if (!n) return false;
        n.close();
        this.notifications.get(ctx.extensionId)?.delete(String(id));
        return true;
      },
      'notifications.getAll': (ctx) => Object.fromEntries([...(this.notifications.get(ctx.extensionId)?.keys() ?? [])].map((k) => [k, true])),
      'notifications.getPermissionLevel': () => 'granted',

      'idle.queryState': (ctx, [seconds]) => {
        const s = typeof seconds === 'number' && seconds >= 15 ? Math.floor(seconds) : 60;
        const state = this.deps.idleState(s);
        return state === 'unknown' ? 'active' : state;
      },
      'idle.setDetectionInterval': (ctx, [seconds]) => {
        if (typeof seconds === 'number' && seconds >= 15) this.idleIntervals.set(ctx.extensionId, Math.floor(seconds));
      },
      'idle.getAutoLockDelay': () => 0,

      'power.requestKeepAwake': (ctx, [level]) => this.deps.keepAwake(ctx.extensionId, level === 'display' ? 'display' : 'system'),
      'power.releaseKeepAwake': (ctx) => this.deps.keepAwake(ctx.extensionId, null),

      'search.query': (ctx, [info]) => {
        const text = (info as { text?: unknown } | undefined)?.text;
        if (typeof text !== 'string' || !text.trim()) throw new ApiError('Search text is required');
        this.deps.openTab(ctx, searchUrl(text));
      },

      'fontSettings.getFontList': () => FONTS.map((f) => ({ fontId: f, displayName: f })),
      'fontSettings.getFont': () => ({ fontId: '', levelOfControl: 'not_controllable' }),
      'fontSettings.setFont': () => { throw new ApiError("DEX doesn't let extensions change fonts"); },
      'fontSettings.clearFont': () => undefined,
      'fontSettings.getDefaultFontSize': () => ({ pixelSize: 16, levelOfControl: 'not_controllable' }),
      'fontSettings.getDefaultFixedFontSize': () => ({ pixelSize: 13, levelOfControl: 'not_controllable' }),
      'fontSettings.getMinimumFontSize': () => ({ pixelSize: 0, levelOfControl: 'not_controllable' }),

      'commands.getAll': (ctx) => {
        const commands = this.deps.manifest(ctx.extensionId)?.commands ?? {};
        return Object.entries(commands).map(([name, c]) => ({
          name,
          description: typeof c?.description === 'string' ? c.description : '',
          shortcut: shortcutOf(c?.suggested_key),
        }));
      },

      'identity.launchWebAuthFlow': async (ctx, [details]) => {
        need(ctx, 'identity');
        const d = (details ?? {}) as { url?: unknown; interactive?: unknown };
        if (typeof d.url !== 'string' || !/^https:\/\//.test(d.url)) throw new ApiError('The sign-in page must be an https URL');
        return this.deps.authFlow(ctx.extensionId, d.url, d.interactive === true);
      },
      'identity.getAuthToken': () => { throw new ApiError("Signing in to Chrome isn't available in DEX. The extension's own sign-in still works."); },
      'identity.removeCachedAuthToken': () => undefined,
      'identity.clearAllCachedAuthTokens': () => undefined,
      'identity.getProfileUserInfo': () => ({ email: '', id: '' }),
      'identity.getAccounts': () => [],

      'offscreen.createDocument': async (ctx, [params]) => {
        need(ctx, 'offscreen');
        const p = (params ?? {}) as { url?: unknown };
        if (typeof p.url !== 'string') throw new ApiError('An offscreen document needs a url');
        if (this.deps.offscreen.has(ctx.extensionId)) throw new ApiError('Only a single offscreen document may be created.');
        const url = new URL(p.url, `chrome-extension://${ctx.extensionId}/`);
        if (url.origin !== `chrome-extension://${ctx.extensionId}`) throw new ApiError("An offscreen document must be one of the extension's own pages");
        await this.deps.offscreen.create(ctx.extensionId, url.href);
      },
      'offscreen.closeDocument': (ctx) => {
        if (!this.deps.offscreen.has(ctx.extensionId)) throw new ApiError('No current offscreen document.');
        this.deps.offscreen.close(ctx.extensionId);
      },
      'offscreen.hasDocument': (ctx) => this.deps.offscreen.has(ctx.extensionId),

      'sidePanel.open': async (ctx) => {
        const panel = this.sidePanelFor(ctx.extensionId);
        if (!panel.path || !panel.enabled) throw new ApiError('No active side panel for this extension.');
        await this.deps.showPanel(ctx, panel.path, 'side_panel');
      },
      'sidePanel.setOptions': (ctx, [options]) => {
        const o = (options ?? {}) as { path?: unknown; enabled?: unknown };
        const cur = this.sidePanelFor(ctx.extensionId);
        this.sidePanels.set(ctx.extensionId, {
          ...cur,
          ...(typeof o.path === 'string' ? { path: o.path } : {}),
          ...(typeof o.enabled === 'boolean' ? { enabled: o.enabled } : {}),
        });
      },
      'sidePanel.getOptions': (ctx) => {
        const p = this.sidePanelFor(ctx.extensionId);
        return { path: p.path, enabled: p.enabled };
      },
      'sidePanel.setPanelBehavior': (ctx, [behavior]) => {
        const b = (behavior ?? {}) as { openPanelOnActionClick?: unknown };
        const cur = this.sidePanelFor(ctx.extensionId);
        this.sidePanels.set(ctx.extensionId, { ...cur, openOnAction: b.openPanelOnActionClick === true });
      },
      'sidePanel.getPanelBehavior': (ctx) => ({ openPanelOnActionClick: this.sidePanelFor(ctx.extensionId).openOnAction }),
      'sidePanel.setLayout': () => undefined,
      'sidePanel.getLayout': () => ({ side: 'right' }),

      'runtime.openOptionsPage': (ctx) => {
        const m = this.deps.manifest(ctx.extensionId);
        const page = m?.options_ui?.page || m?.options_page;
        if (!page) throw new ApiError('Could not create an options page.');
        this.deps.openTab(ctx, `chrome-extension://${ctx.extensionId}/${page.replace(/^\/+/, '')}`);
      },
      'runtime.getContexts': (ctx, [filter]) => {
        const f = (filter ?? {}) as { contextTypes?: string[]; documentUrls?: string[]; tabIds?: number[] };
        return this.deps.contexts(ctx.extensionId).filter((c) =>
          (!f.contextTypes || f.contextTypes.includes(String(c.contextType)))
          && (!f.documentUrls || f.documentUrls.includes(String(c.documentUrl)))
          && (!f.tabIds || f.tabIds.includes(Number(c.tabId))));
      },
      'runtime.setUninstallURL': (ctx, [url]) => {
        if (typeof url !== 'string' || (url && !/^https?:\/\//.test(url))) throw new ApiError('The uninstall URL must be http or https');
        this.deps.setUninstallUrl(ctx.extensionId, url.slice(0, 1023));
      },
      'runtime.sendNativeMessage': () => { throw new ApiError('Native messaging isn\'t available in DEX.'); },
    };
  }
}

/** For APIs DEX doesn't have: a clear error, never a crash. */
export function unsupportedHandler(method: string): Handler {
  const name = method.replace(/^unsupported\./, 'chrome.');
  return () => { throw new ApiError(`${name} isn't available in DEX's browser yet.`); };
}
