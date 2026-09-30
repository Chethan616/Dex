import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

vi.mock('../../src/main/logger', () => ({ mainLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { CdpBroker, isBlockedOnPage, type BrokerContents } from '../../src/main/cdpBroker';
import { leaseDebugger } from '../../src/main/cdpLease';

/** A stand-in for a task's browser view: its debugger records what it's sent. */
function fakeTab(targetId: string) {
  const events = new EventEmitter();
  let attached = false;
  const sent: Array<{ method: string; params: unknown; sessionId?: string }> = [];
  const dbg = {
    attach: vi.fn(() => {
      if (attached) throw new Error('Debugger is already attached');
      attached = true;
    }),
    detach: vi.fn(() => { attached = false; }),
    isAttached: () => attached,
    sendCommand: vi.fn(async (method: string, params: object = {}, sessionId?: string) => {
      sent.push({ method, params, sessionId });
      if (method === 'Target.getTargetInfo') return { targetInfo: { targetId, type: 'page' } };
      if (method === 'Runtime.evaluate') return { result: { type: 'string', value: 'from ' + targetId } };
      return {};
    }),
    on: (event: string, listener: (...args: unknown[]) => void) => events.on(event, listener),
    removeListener: (event: string, listener: (...args: unknown[]) => void) => events.removeListener(event, listener),
  };
  const wc: BrokerContents = {
    isDestroyed: () => false,
    getTitle: () => 'Tab ' + targetId,
    getURL: () => 'https://example.com/' + targetId,
    getUserAgent: () => 'Mozilla/5.0 Chrome/146',
    debugger: dbg,
  };
  return { wc, dbg, sent, emit: (...args: unknown[]) => events.emit(...(args as [string, ...unknown[]])) };
}

type Client = {
  ws: WebSocket;
  call: (method: string, params?: object, sessionId?: string) => Promise<{ result?: any; error?: { code: number; message: string } }>;
  events: Array<{ method: string; params: any; sessionId?: string }>;
};

async function connect(url: string): Promise<Client> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject); });
  let nextId = 1;
  const pending = new Map<number, (m: any) => void>();
  const events: Client['events'] = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (typeof m.id === 'number') pending.get(m.id)?.(m);
    else events.push(m);
  });
  const call: Client['call'] = (method, params = {}, sessionId) => new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });
  return { ws, call, events };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

describe('CdpBroker', () => {
  let broker: CdpBroker;
  let tabs: Record<string, ReturnType<typeof fakeTab>>;

  beforeEach(async () => {
    tabs = { a: fakeTab('TARGET-A'), b: fakeTab('TARGET-B') };
    broker = new CdpBroker((scope) => (scope === 'session-a' ? [tabs.a.wc] : scope === 'session-b' ? [tabs.b.wc] : []));
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
  });

  it('answers only with the task’s secret link', async () => {
    const port = broker.listeningPort;
    expect((await fetch(`http://127.0.0.1:${port}/json/version`)).status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${port}/not-a-token/json/version`)).status).toBe(403);
    await expect(connect(`ws://127.0.0.1:${port}/devtools/browser/x`)).rejects.toThrow();

    const { httpUrl, wsUrl } = broker.endpointFor('session-a');
    const version = await (await fetch(`${httpUrl}/json/version`)).json();
    expect(version.webSocketDebuggerUrl).toBe(wsUrl);
    expect(broker.endpointFor('session-a').wsUrl).toBe(wsUrl);
    expect(broker.endpointFor('session-b').wsUrl).not.toBe(wsUrl);
  });

  it('lists and attaches only the task’s own tab', async () => {
    const { httpUrl, wsUrl } = broker.endpointFor('session-a');
    const list = await (await fetch(`${httpUrl}/json/list`)).json();
    expect(list.map((t: { id: string }) => t.id)).toEqual(['TARGET-A']);

    const c = await connect(wsUrl);
    const targets = await c.call('Target.getTargets');
    expect(targets.result.targetInfos.map((t: { targetId: string }) => t.targetId)).toEqual(['TARGET-A']);

    const foreign = await c.call('Target.attachToTarget', { targetId: 'TARGET-B', flatten: true });
    expect(foreign.error?.code).toBe(-32601);

    const own = await c.call('Target.attachToTarget', { targetId: 'TARGET-A', flatten: true });
    const sessionId = own.result.sessionId as string;
    expect(sessionId).toMatch(/^[0-9A-F]{32}$/);
    expect(c.events.find((e) => e.method === 'Target.attachedToTarget')?.params.sessionId).toBe(sessionId);

    const evaluated = await c.call('Runtime.evaluate', { expression: '1' }, sessionId);
    expect(evaluated.result).toEqual({ result: { type: 'string', value: 'from TARGET-A' } });
    expect(tabs.a.sent.at(-1)).toMatchObject({ method: 'Runtime.evaluate', sessionId: undefined });
    expect(tabs.b.sent.some((s) => s.method === 'Runtime.evaluate')).toBe(false);
    c.ws.close();
  });

  it('refuses browser-level control, at the browser and through the page', async () => {
    const c = await connect(broker.endpointFor('session-a').wsUrl);
    for (const method of ['Browser.close', 'Target.createTarget', 'Target.createBrowserContext', 'Target.exposeDevToolsProtocol']) {
      expect((await c.call(method)).error?.code, method).toBe(-32601);
    }
    const { result } = await c.call('Target.attachToTarget', { targetId: 'TARGET-A', flatten: true });
    for (const method of ['Browser.close', 'Target.createTarget', 'Target.attachToTarget', 'Target.getTargets', 'Page.close']) {
      expect((await c.call(method, {}, result.sessionId)).error?.code, method).toBe(-32601);
    }
    expect(tabs.a.sent.map((s) => s.method)).not.toContain('Browser.close');
    // Auto-attach to the page's own iframes stays allowed.
    expect((await c.call('Target.setAutoAttach', { autoAttach: true, flatten: true }, result.sessionId)).error).toBeUndefined();
    c.ws.close();
  });

  it('routes the page’s events and its iframes’ sessions', async () => {
    const c = await connect(broker.endpointFor('session-a').wsUrl);
    const { result } = await c.call('Target.attachToTarget', { targetId: 'TARGET-A', flatten: true });

    tabs.a.emit('message', {}, 'Page.loadEventFired', { timestamp: 1 });
    tabs.a.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'CHILD', targetInfo: { type: 'iframe' } });
    tabs.a.emit('message', {}, 'Runtime.consoleAPICalled', { type: 'log' }, 'CHILD');
    tabs.a.emit('message', {}, 'Runtime.consoleAPICalled', { type: 'log' }, 'SOMEONE-ELSES');
    await settle();

    expect(c.events).toContainEqual({ method: 'Page.loadEventFired', params: { timestamp: 1 }, sessionId: result.sessionId });
    expect(c.events.filter((e) => e.sessionId === 'CHILD')).toHaveLength(1);
    expect(c.events.some((e) => e.sessionId === 'SOMEONE-ELSES')).toBe(false);

    await c.call('Runtime.evaluate', { expression: '2' }, 'CHILD');
    expect(tabs.a.sent.at(-1)).toMatchObject({ method: 'Runtime.evaluate', sessionId: 'CHILD' });
    c.ws.close();
  });

  it('holds the debugger while attached and lets go when the client leaves', async () => {
    const c = await connect(broker.endpointFor('session-a').wsUrl);
    await c.call('Target.attachToTarget', { targetId: 'TARGET-A', flatten: true });
    expect(tabs.a.dbg.isAttached()).toBe(true);

    // A short user elsewhere in main (the idle freeze, say) must not cut it off.
    const release = leaseDebugger(tabs.a.wc);
    release();
    expect(tabs.a.dbg.isAttached()).toBe(true);

    c.ws.close();
    await settle();
    expect(tabs.a.dbg.isAttached()).toBe(false);
  });

  it('serves a page endpoint that talks to the tab without session ids', async () => {
    const list = await (await fetch(`${broker.endpointFor('session-b').httpUrl}/json/list`)).json();
    const c = await connect(list[0].webSocketDebuggerUrl);
    await settle();
    const res = await c.call('Runtime.evaluate', { expression: '3' });
    expect(res.result).toEqual({ result: { type: 'string', value: 'from TARGET-B' } });
    expect((await c.call('Browser.close')).error?.code).toBe(-32601);
    c.ws.close();
  });
});

describe('CdpBroker hooks', () => {
  it('runs the workspace hooks around page commands, marking iframe sessions', async () => {
    const tab = fakeTab('TARGET-H');
    const seen: string[] = [];
    const broker = new CdpBroker(() => [tab.wc], {
      beforeCommand: async (_wc, method, _params, { child }) => { seen.push(`before ${method}${child ? ' (child)' : ''}`); },
      afterCommand: (_wc, method) => { seen.push(`after ${method}`); },
    });
    await broker.start();
    try {
      const c = await connect(broker.endpointFor('any').wsUrl);
      const { result } = await c.call('Target.attachToTarget', { targetId: 'TARGET-H', flatten: true });
      await c.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 10, y: 20 }, result.sessionId);
      tab.emit('message', {}, 'Target.attachedToTarget', { sessionId: 'FRAME', targetInfo: { type: 'iframe' } });
      await settle();
      await c.call('Runtime.evaluate', { expression: '1' }, 'FRAME');
      await c.call('Target.getTargets');
      expect(seen).toEqual([
        'before Input.dispatchMouseEvent',
        'after Input.dispatchMouseEvent',
        'before Runtime.evaluate (child)',
        'after Runtime.evaluate',
      ]);
      c.ws.close();
    } finally {
      await broker.stop();
    }
  });

  it('still answers when a hook throws', async () => {
    const tab = fakeTab('TARGET-X');
    const broker = new CdpBroker(() => [tab.wc], { beforeCommand: async () => { throw new Error('cursor broke'); } });
    await broker.start();
    try {
      const c = await connect(broker.endpointFor('any').wsUrl);
      const { result } = await c.call('Target.attachToTarget', { targetId: 'TARGET-X', flatten: true });
      const res = await c.call('Runtime.evaluate', { expression: '1' }, result.sessionId);
      expect(res.result).toEqual({ result: { type: 'string', value: 'from TARGET-X' } });
      c.ws.close();
    } finally {
      await broker.stop();
    }
  });
});

describe('isBlockedOnPage', () => {
  it('allows page work and the page’s own auto-attach, nothing that reaches further', () => {
    expect(isBlockedOnPage('Runtime.evaluate')).toBe(false);
    expect(isBlockedOnPage('Input.dispatchMouseEvent')).toBe(false);
    expect(isBlockedOnPage('Target.setAutoAttach')).toBe(false);
    expect(isBlockedOnPage('Target.attachToTarget')).toBe(true);
    expect(isBlockedOnPage('Browser.close')).toBe(true);
    expect(isBlockedOnPage('Page.close')).toBe(true);
  });
});
