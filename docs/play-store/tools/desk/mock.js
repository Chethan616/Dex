// A stand-in for DEX's preload (window.electronAPI) so the hub renders in a
// plain browser with sample data. Every call not listed resolves to a quiet
// default; on*/subscribe calls return an unsubscribe function.
(() => {
  const now = Date.now();
  const MIN = 60_000;
  const S = (window.__DEX_SAMPLE__ = window.__DEX_SAMPLE__ || {});
  const sessions = S.sessions || [];
  const byId = Object.fromEntries(sessions.map((s) => [s.id, s]));
  const summary = (s) => ({ ...s, output: [] });

  const overrides = {
    'sessions.listAll': async () => sessions.map(summary),
    'sessions.list': async () => sessions.map(summary),
    'sessions.get': async (id) => byId[id] ?? null,
    'sessions.listEngines': async () => [
      { id: 'claude-code', displayName: 'Claude Code', binaryName: 'claude' },
      { id: 'codex', displayName: 'Codex', binaryName: 'codex' },
      { id: 'browsercode', displayName: 'BrowserCode', binaryName: 'browsercode' },
    ],
    'sessions.engineStatus': async (id) => ({ id, installed: { installed: true, version: '2.1.0' }, authed: { authed: true, mode: 'subscription', subscriptionType: 'Max' } }),
    'sessions.listEditors': async () => [],
    'shell.platform': 'win32',
    ...(S.overrides || {}),
  };

  const isSubscribe = (path) => {
    const last = path.split('.').pop() || '';
    return path.startsWith('on.') || /^on[A-Z]/.test(last) || /^subscribe/.test(last);
  };

  // One proxy per path, like the preload's objects: a component that keys an
  // effect on `window.electronAPI.settings.app` must get the same object
  // every render, or the effect re-runs forever.
  const cache = new Map();
  function deep(path) {
    if (cache.has(path)) return cache.get(path);
    const fn = function () {};
    const proxy = new Proxy(fn, {
      get(_t, prop) {
        if (prop === 'then') return undefined;
        if (typeof prop === 'symbol') return undefined;
        const full = path ? `${path}.${prop}` : String(prop);
        if (Object.prototype.hasOwnProperty.call(overrides, full)) return overrides[full];
        return deep(full);
      },
      apply(_t, _this, args) {
        if (isSubscribe(path)) return () => {};
        const d = (S.defaults || {})[path];
        return Promise.resolve(typeof d === 'function' ? d(...args) : d);
      },
    });
    cache.set(path, proxy);
    return proxy;
  }
  window.electronAPI = deep('');
  window.__dexMockReady = true;
})();
