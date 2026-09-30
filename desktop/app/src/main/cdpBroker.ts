/**
 * CDP broker — how an agent reaches its browser tab, and nothing else.
 *
 * DEX used to start Electron with `--remote-debugging-port`. That port serves
 * every WebContents in the app: not just each task's browser view but DEX's
 * own Hub, Logs and Pill windows, approval cards included — to any process on
 * the PC that connects, the agent's own shell among them. Something that can
 * attach to the Hub can click "Approve" on its own request.
 *
 * The broker replaces it. It speaks enough of Chrome's DevTools HTTP +
 * WebSocket protocol for the browser harness (`/json/version`, a browser
 * endpoint with flat sessions, page endpoints), but:
 *   - it listens on a random loopback port, and every URL carries a per-task
 *     secret token — no token, no answer;
 *   - a token reaches only that task's own browser view. `Target.getTargets`
 *     lists only it, and attaching anything else is refused;
 *   - browser-level control (`Browser.close`, `Target.createTarget`,
 *     attaching to other targets…) is refused, at the browser level and when
 *     sent through a page session;
 *   - commands run through the page's own `webContents.debugger` (a lease, so
 *     DEX's other short CDP users don't cut it off).
 *
 * The raw port is still available for development, opt-in only (see
 * startup/cli.ts `resolveDevtoolsPortOptIn`).
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { leaseDebugger, withDebugger, type DebuggableContents } from './cdpLease';
import { mainLogger } from './logger';

/** The slice of Electron's WebContents the broker uses; tests pass a fake. */
export interface BrokerContents extends DebuggableContents {
  getTitle(): string;
  getURL(): string;
  getUserAgent(): string;
  readonly debugger: DebuggableContents['debugger'] & {
    sendCommand(method: string, params?: object, sessionId?: string): Promise<unknown>;
    on(event: string, listener: (...args: any[]) => void): unknown;
    removeListener(event: string, listener: (...args: any[]) => void): unknown;
  };
}

/**
 * Around every command the agent sends to a page: the workspace uses these
 * for the agent cursor, the politeness wait, and hiding the cursor from
 * screenshots (main/workspace). `child` is an iframe or worker session.
 */
export interface BrokerHooks {
  beforeCommand?(wc: BrokerContents, method: string, params: Record<string, unknown>, info: { child: boolean }): Promise<void>;
  afterCommand?(wc: BrokerContents, method: string, params: Record<string, unknown>, info: { child: boolean }): void;
}

export interface CdpEndpoint {
  /** The broker's loopback port (for display and logs; useless without the token). */
  port: number;
  /** `http://127.0.0.1:<port>/<token>` — `/json/version` and `/json/list` live under it. */
  httpUrl: string;
  /** The browser-level WebSocket, token included. What the harness connects to. */
  wsUrl: string;
}

/** Page-session methods that would reach past the task's own tab. */
const PAGE_ALLOWED_TARGET_METHODS = new Set(['Target.setAutoAttach', 'Target.getTargetInfo']);
const PAGE_BLOCKED_METHODS = new Set(['Page.close', 'Page.crash']);

/** Browser-level methods answered here; everything else at that level is refused. */
const BROWSER_NOOPS = new Set([
  'Target.setDiscoverTargets',
  'Target.setAutoAttach',
  'Target.activateTarget',
  'Target.setRemoteLocations',
]);

class CdpError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
  }
}

const notHere = (method: string): CdpError =>
  new CdpError(-32601, `'${method}' isn't available: DEX's browser connection reaches only this task's own tab.`);

export function isBlockedOnPage(method: string): boolean {
  if (method.startsWith('Browser.')) return true;
  if (method.startsWith('Target.')) return !PAGE_ALLOWED_TARGET_METHODS.has(method);
  return PAGE_BLOCKED_METHODS.has(method);
}

const targetIds = new WeakMap<BrokerContents, string>();

async function targetIdOf(wc: BrokerContents): Promise<string> {
  const known = targetIds.get(wc);
  if (known) return known;
  const info = await withDebugger(wc, () => wc.debugger.sendCommand('Target.getTargetInfo')) as {
    targetInfo?: { targetId?: string };
  };
  const id = info?.targetInfo?.targetId;
  if (!id) throw new Error('Target.getTargetInfo returned no targetId');
  targetIds.set(wc, id);
  return id;
}

interface Attachment {
  wc: BrokerContents;
  targetId: string;
  /** The id this client addresses the page by; undefined on a page endpoint. */
  sessionId: string | undefined;
  /** Chromium's own ids for iframes and workers auto-attached under the page. */
  children: Set<string>;
  release: () => void;
  onMessage: (event: unknown, method: string, params: Record<string, unknown>, sessionId?: string) => void;
  onDetach: (event: unknown, reason: string) => void;
}

/** One client socket: its attachments, and message routing both ways. */
class BrokerConnection {
  private attachments: Attachment[] = [];
  private closed = false;

  constructor(
    private readonly ws: WebSocket,
    private readonly scope: string,
    private readonly targets: () => BrokerContents[],
    private readonly pageTargetId: string | null,
    private readonly hooks: BrokerHooks = {},
  ) {
    ws.on('message', (raw) => { void this.onMessage(raw); });
    ws.on('close', () => this.dispose());
    ws.on('error', () => this.dispose());
  }

  /** Page endpoint: attach up front; messages without a sessionId go to the page. */
  async attachPage(): Promise<boolean> {
    const wc = await this.findTarget(this.pageTargetId!);
    if (!wc) return false;
    this.attach(wc, this.pageTargetId!, undefined);
    return true;
  }

  private send(message: Record<string, unknown>): void {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(message));
  }

  private async findTarget(targetId: string): Promise<BrokerContents | null> {
    for (const wc of this.targets()) {
      if (wc.isDestroyed()) continue;
      try {
        if ((await targetIdOf(wc)) === targetId) return wc;
      } catch {
        /* the page went away while we looked */
      }
    }
    return null;
  }

  private async targetInfo(wc: BrokerContents): Promise<Record<string, unknown>> {
    return {
      targetId: await targetIdOf(wc),
      type: 'page',
      title: wc.getTitle(),
      url: wc.getURL() || 'about:blank',
      attached: this.attachments.some((a) => a.wc === wc),
      canAccessOpener: false,
      browserContextId: 'dex',
    };
  }

  private attach(wc: BrokerContents, targetId: string, sessionId: string | undefined): Attachment {
    const release = leaseDebugger(wc);
    const att: Attachment = {
      wc,
      targetId,
      sessionId,
      children: new Set(),
      release,
      onMessage: (_event, method, params, childSession) => {
        if (childSession && !att.children.has(childSession)) return;
        if (method === 'Target.attachedToTarget' && typeof params?.sessionId === 'string') att.children.add(params.sessionId);
        if (method === 'Target.detachedFromTarget' && typeof params?.sessionId === 'string') att.children.delete(params.sessionId);
        const wireSession = childSession ?? att.sessionId;
        this.send(wireSession ? { method, params, sessionId: wireSession } : { method, params });
      },
      onDetach: (_event, reason) => {
        this.detach(att, reason);
        if (att.sessionId === undefined) this.ws.close();
      },
    };
    wc.debugger.on('message', att.onMessage);
    wc.debugger.on('detach', att.onDetach);
    this.attachments.push(att);
    mainLogger.info('cdpBroker.attach', { scope: this.scope, targetId, page: sessionId === undefined });
    return att;
  }

  private detach(att: Attachment, reason: string): void {
    const i = this.attachments.indexOf(att);
    if (i < 0) return;
    this.attachments.splice(i, 1);
    att.wc.debugger.removeListener('message', att.onMessage);
    att.wc.debugger.removeListener('detach', att.onDetach);
    att.release();
    if (att.sessionId) {
      this.send({ method: 'Target.detachedFromTarget', params: { sessionId: att.sessionId, targetId: att.targetId, reason } });
    }
  }

  private dispose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const att of [...this.attachments]) this.detach(att, 'client closed');
  }

  private async onMessage(raw: RawData): Promise<void> {
    let msg: { id?: unknown; method?: unknown; params?: unknown; sessionId?: unknown };
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    const id = typeof msg.id === 'number' ? msg.id : null;
    const method = typeof msg.method === 'string' ? msg.method : '';
    const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Record<string, unknown>;
    const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId : undefined;
    if (id === null || !method) return;
    const reply = (body: Record<string, unknown>) => this.send(sessionId ? { id, ...body, sessionId } : { id, ...body });
    try {
      reply({ result: await this.dispatch(method, params, sessionId) });
    } catch (err) {
      const code = err instanceof CdpError ? err.code : -32000;
      if (err instanceof CdpError && code === -32601) {
        mainLogger.warn('cdpBroker.refused', { scope: this.scope, method });
      }
      reply({ error: { code, message: (err as Error).message } });
    }
  }

  private async dispatch(method: string, params: Record<string, unknown>, sessionId: string | undefined): Promise<unknown> {
    // Addressed to the page (its session id, or anything on a page endpoint)…
    const page = sessionId
      ? this.attachments.find((a) => a.sessionId === sessionId)
      : this.attachments.find((a) => a.sessionId === undefined);
    if (page) {
      if (isBlockedOnPage(method)) throw notHere(method);
      return this.forward(page.wc, method, params, undefined);
    }
    // …or to an iframe/worker under it.
    if (sessionId) {
      const owner = this.attachments.find((a) => a.children.has(sessionId));
      if (!owner) throw new CdpError(-32001, 'Session with given id not found.');
      if (isBlockedOnPage(method)) throw notHere(method);
      return this.forward(owner.wc, method, params, sessionId);
    }
    return this.browserLevel(method, params);
  }

  private async forward(wc: BrokerContents, method: string, params: Record<string, unknown>, childSession: string | undefined): Promise<unknown> {
    const info = { child: childSession !== undefined };
    try {
      await this.hooks.beforeCommand?.(wc, method, params, info);
    } catch (err) {
      mainLogger.warn('cdpBroker.hook.before', { method, error: (err as Error).message });
    }
    try {
      return childSession
        ? await wc.debugger.sendCommand(method, params, childSession)
        : await wc.debugger.sendCommand(method, params);
    } finally {
      try { this.hooks.afterCommand?.(wc, method, params, info); } catch { /* never block the reply */ }
    }
  }

  private async browserLevel(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (BROWSER_NOOPS.has(method)) return {};
    switch (method) {
      case 'Browser.getVersion': {
        const ua = this.targets()[0]?.getUserAgent() ?? '';
        return {
          protocolVersion: '1.3',
          product: `Chrome/${process.versions.chrome ?? ''}`,
          revision: '',
          userAgent: ua,
          jsVersion: process.versions.v8 ?? '',
        };
      }
      case 'Target.getTargets': {
        const live = this.targets().filter((wc) => !wc.isDestroyed());
        return { targetInfos: await Promise.all(live.map((wc) => this.targetInfo(wc))) };
      }
      case 'Target.getTargetInfo': {
        const wanted = typeof params.targetId === 'string' ? params.targetId : null;
        if (!wanted) return { targetInfo: { targetId: 'browser', type: 'browser', title: '', url: '', attached: true, canAccessOpener: false } };
        const wc = await this.findTarget(wanted);
        if (!wc) throw new CdpError(-32602, 'No target with given id found');
        return { targetInfo: await this.targetInfo(wc) };
      }
      case 'Target.attachToTarget': {
        const wanted = typeof params.targetId === 'string' ? params.targetId : '';
        if (params.flatten === false) throw new CdpError(-32602, 'Only flat sessions (flatten: true) are supported.');
        const wc = await this.findTarget(wanted);
        if (!wc) throw notHere(`Target.attachToTarget(${wanted || '?'})`);
        const sessionId = randomBytes(16).toString('hex').toUpperCase();
        const att = this.attach(wc, wanted, sessionId);
        this.send({
          method: 'Target.attachedToTarget',
          params: { sessionId, targetInfo: await this.targetInfo(att.wc), waitingForDebugger: false },
        });
        return { sessionId };
      }
      case 'Target.detachFromTarget': {
        const att = this.attachments.find((a) => a.sessionId === params.sessionId);
        if (att) this.detach(att, 'detached by client');
        return {};
      }
      default:
        throw notHere(method);
    }
  }
}

export class CdpBroker {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private port = 0;
  private tokenToScope = new Map<string, string>();
  private scopeToToken = new Map<string, string>();

  /** `resolve(scope)` → the WebContents a scope (a DEX session id) may reach. */
  constructor(
    private readonly resolve: (scope: string) => BrokerContents[],
    private readonly hooks: BrokerHooks = {},
  ) {}

  get listeningPort(): number {
    return this.port;
  }

  async start(): Promise<number> {
    if (this.server) return this.port;
    const wss = new WebSocketServer({ noServer: true });
    const server = http.createServer((req, res) => { void this.onHttp(req, res); });
    server.on('upgrade', (req, socket, head) => {
      const route = this.route(req.url ?? '');
      const ok = route && (route.kind === 'browser' || route.kind === 'page');
      if (!ok) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        const conn = new BrokerConnection(ws, route.scope, () => this.resolve(route.scope), route.kind === 'page' ? route.targetId : null, this.hooks);
        if (route.kind === 'page') {
          void conn.attachPage().then((attached) => { if (!attached) ws.close(1008, 'No such target'); });
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    this.server = server;
    this.wss = wss;
    this.port = (server.address() as AddressInfo).port;
    mainLogger.info('cdpBroker.listening', { port: this.port });
    return this.port;
  }

  /** The endpoint for a scope. The token is made once per scope and kept. */
  endpointFor(scope: string): CdpEndpoint {
    if (!this.server) throw new Error('CDP broker is not running');
    let token = this.scopeToToken.get(scope);
    if (!token) {
      token = randomBytes(24).toString('hex');
      this.scopeToToken.set(scope, token);
      this.tokenToScope.set(token, scope);
    }
    const httpUrl = `http://127.0.0.1:${this.port}/${token}`;
    return { port: this.port, httpUrl, wsUrl: `ws://127.0.0.1:${this.port}/${token}/devtools/browser/dex` };
  }

  async stop(): Promise<void> {
    for (const ws of this.wss?.clients ?? []) ws.terminate();
    this.wss?.close();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server = null;
    this.wss = null;
  }

  private route(url: string):
    | { kind: 'version' | 'list' | 'browser'; scope: string }
    | { kind: 'page'; scope: string; targetId: string }
    | null {
    const parts = url.split('?')[0].split('/').filter(Boolean);
    const scope = parts.length ? this.tokenToScope.get(parts[0]) : undefined;
    if (!scope) return null;
    const rest = parts.slice(1).join('/');
    if (rest === 'json/version') return { kind: 'version', scope };
    if (rest === 'json' || rest === 'json/list') return { kind: 'list', scope };
    if (rest.startsWith('devtools/browser')) return { kind: 'browser', scope };
    if (parts[1] === 'devtools' && parts[2] === 'page' && parts[3]) return { kind: 'page', scope, targetId: decodeURIComponent(parts[3]) };
    return null;
  }

  private async onHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const route = this.route(req.url ?? '');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    if (!route) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
    const { wsUrl, httpUrl } = this.endpointFor(route.scope);
    const base = httpUrl.replace(/^http/, 'ws');
    const live = this.resolve(route.scope).filter((wc) => !wc.isDestroyed());
    if (route.kind === 'version') {
      json(200, {
        Browser: `Chrome/${process.versions.chrome ?? ''}`,
        'Protocol-Version': '1.3',
        'User-Agent': live[0]?.getUserAgent() ?? '',
        'V8-Version': process.versions.v8 ?? '',
        webSocketDebuggerUrl: wsUrl,
      });
      return;
    }
    if (route.kind === 'list') {
      const list = [];
      for (const wc of live) {
        try {
          const id = await targetIdOf(wc);
          list.push({ id, type: 'page', title: wc.getTitle(), url: wc.getURL() || 'about:blank', webSocketDebuggerUrl: `${base}/devtools/page/${id}` });
        } catch {
          /* gone */
        }
      }
      json(200, list);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
}
