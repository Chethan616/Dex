/**
 * The pieces of DEX the extension APIs work against, kept narrow so each
 * API can be tested with fakes (tests/unit/extensions).
 */
import type { WebContents, WebFrameMain } from 'electron';

/** Who's calling: an extension's service worker, or one of its pages. */
export interface CallContext {
  extensionId: string;
  kind: 'worker' | 'page';
  /** The page's own WebContents: a popup, an options page, a tab, an offscreen document. */
  contents?: WebContents;
  frame?: WebFrameMain;
}

export type Handler = (ctx: CallContext, args: unknown[]) => unknown | Promise<unknown>;

/** A tab as BrowserPool holds it. */
export interface PoolTab {
  /** BrowserPool's own id within the task ("t3"). */
  tabId: string;
  wc: WebContents;
  active: boolean;
  /** A remembered tab not loaded yet. */
  pending: { url: string; title: string } | null;
  loading: boolean;
  faviconUrl: string | null;
  openedBy: string;
}

/** A task's tabs: the "window" extensions see. */
export interface PoolWindow {
  sessionId: string;
  title: string;
  tabs: PoolTab[];
}

/** What the APIs need from BrowserPool and the hub. */
export interface TabsBackend {
  windows(): PoolWindow[];
  /** The task on screen in DEX's window, or the last one that was. */
  shownSessionId(): string | null;
  /** DEX's window has the keyboard focus. */
  hubFocused(): boolean;
  openTab(sessionId: string, url: string, active: boolean): PoolTab | null;
  closeTab(sessionId: string, tabId: string): boolean;
  activateTab(sessionId: string, tabId: string): boolean;
  /** Load `url` as is (the API checked it already). */
  loadUrl(sessionId: string, tabId: string, url: string): boolean;
  goBack(sessionId: string, tabId: string): boolean;
  goForward(sessionId: string, tabId: string): boolean;
  /** Bring a task to the front in DEX's window. */
  showSession(sessionId: string): void;
}

export class ApiError extends Error {}
