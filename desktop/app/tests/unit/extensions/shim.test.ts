import { describe, it, expect, vi } from 'vitest';
import vm from 'node:vm';
import { extensionShim } from '../../../src/preload/extensionShim';
import { storeBridge } from '../../../src/preload/storeBridge';

/** Run the shim from its source text in a fresh world, as Electron does. */
function runShim(manifest: Record<string, unknown>, protocol = 'chrome-extension:') {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const listens: Array<{ name: string; spec: unknown }> = [];
  const answers = new Map<string, unknown>();
  const bridge = {
    call: (method: string, args: unknown[]) => {
      calls.push({ method, args });
      if (answers.has(method)) {
        const a = answers.get(method);
        return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
      }
      return Promise.resolve(undefined);
    },
    listen: (name: string, spec: unknown) => { listens.push({ name, spec }); },
    unlisten: vi.fn(),
  };
  const chrome = { runtime: { id: 'a'.repeat(32), getManifest: () => manifest } };
  const sandbox: Record<string, unknown> = { location: { protocol }, chrome, setTimeout, console, Promise, ArrayBuffer, Uint8Array };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  const dispatch = vm.runInContext(`(${extensionShim.toString()})`, context)(bridge, 'worker');
  return { chrome: chrome as Record<string, any>, calls, listens, answers, dispatch };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('the extension shim', () => {
  it('is self-contained: it runs from its own source in an empty world', () => {
    expect(() => runShim({ manifest_version: 3, permissions: ['tabs', 'contextMenus', 'notifications', 'webNavigation', 'proxy', 'declarativeNetRequest', 'cookies', 'downloads', 'idle', 'offscreen', 'identity', 'history'] })).not.toThrow();
  });

  it("does nothing on a website's service worker", () => {
    expect(runShim({}, 'https:').dispatch).toBeNull();
  });

  it('gives an extension chrome.windows and a working chrome.tabs.query', async () => {
    const { chrome, calls, answers } = runShim({ manifest_version: 3, permissions: ['tabs'] });
    expect(typeof chrome.windows.onRemoved.addListener).toBe('function');
    answers.set('tabs.query', [{ id: 5 }]);
    await expect(chrome.tabs.query({ active: true, currentWindow: true })).resolves.toEqual([{ id: 5 }]);
    expect(calls.find((c) => c.method === 'tabs.query')?.args).toEqual([{ active: true, currentWindow: true }]);
  });

  it('supports callbacks, and sets lastError while one runs', async () => {
    const { chrome, answers } = runShim({ manifest_version: 3 });
    answers.set('tabs.get', new Error("Error invoking remote method 'dex-ext:call': Error: No tab with id: 9."));
    const seen = await new Promise<{ message?: string } | undefined>((resolve) => {
      chrome.tabs.get(9, () => resolve(chrome.runtime.lastError));
    });
    expect(seen).toEqual({ message: 'No tab with id: 9.' });
    expect(chrome.runtime.lastError).toBeUndefined();
  });

  it('moves an optional first argument into place (tabs.update without an id)', async () => {
    const { chrome, calls } = runShim({ manifest_version: 3 });
    await chrome.tabs.update({ url: 'https://a.example/' });
    expect(calls.find((c) => c.method === 'tabs.update')?.args).toEqual([undefined, { url: 'https://a.example/' }]);
  });

  it('returns a context menu id at once, as Chrome does', () => {
    const { chrome, calls } = runShim({ manifest_version: 3, permissions: ['contextMenus'] });
    expect(chrome.contextMenus.create({ id: 'x', title: 'X' })).toBe('x');
    const generated = chrome.contextMenus.create({ title: 'Y' });
    expect(typeof generated).toBe('string');
    expect(calls.filter((c) => c.method === 'contextMenus.create')).toHaveLength(2);
  });

  it('delivers events to its listeners, and only to the ids main picked for filtered ones', async () => {
    const { chrome, listens, dispatch } = runShim({ manifest_version: 3, permissions: ['webNavigation'] });
    const a = vi.fn();
    const b = vi.fn();
    chrome.webNavigation.onCompleted.addListener(a, { url: [{ hostEquals: 'a.example' }] });
    chrome.webNavigation.onCompleted.addListener(b, { url: [{ hostEquals: 'b.example' }] });
    expect(listens.map((l) => l.name)).toEqual(['webNavigation.onCompleted', 'webNavigation.onCompleted']);
    const idOfB = (listens[1].spec as { id: number }).id;
    dispatch('webNavigation.onCompleted', [{ url: 'https://b.example/' }], [idOfB]);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith({ url: 'https://b.example/' });
  });

  it('tells DEX once its own top-level code has run', async () => {
    const { calls } = runShim({ manifest_version: 3 });
    await flush();
    expect(calls.some((c) => c.method === '__ready')).toBe(true);
  });

  it("gives APIs DEX lacks a clear error instead of a crash", async () => {
    const { chrome } = runShim({ manifest_version: 3, permissions: ['history'] });
    expect(typeof chrome.history.onVisited.addListener).toBe('function');
    await chrome.history.search({ text: '' }).catch((): undefined => undefined);
  });
});

describe('the Web Store bridge', () => {
  it('is self-contained and only wakes up on the store', () => {
    const run = (origin: string) => {
      const sandbox: Record<string, unknown> = { location: { origin }, console, Promise };
      sandbox.globalThis = sandbox;
      return vm.runInContext(`(${storeBridge.toString()})`, vm.createContext(sandbox))(() => Promise.resolve('success'));
    };
    expect(run('https://evil.example')).toBeNull();
    expect(typeof run('https://chromewebstore.google.com')).toBe('function');
  });
});
