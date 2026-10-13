/**
 * Preload for every frame in DEX's web profile (the pages in your tasks'
 * tabs, extension popups and pages). It does nothing on ordinary websites —
 * it checks the address first, from its own isolated world, and returns.
 *
 * - An extension's own page (chrome-extension://…): the extension APIs
 *   Electron lacks (extensionShim.ts).
 * - The Chrome Web Store: a working "Add to DEX" (storeBridge.ts), and the
 *   store's Chrome-only wording swapped for DEX.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { extensionShim, type ShimDispatch } from './extensionShim';
import { storeBridge, type StoreDispatch } from './storeBridge';

const STORE_ORIGIN = 'https://chromewebstore.google.com';

function extensionPage(): void {
  const dispatch = contextBridge.executeInMainWorld({
    func: extensionShim,
    args: [{
      call: (method: string, args: unknown[]) => ipcRenderer.invoke('dex-ext:call', method, args),
      listen: (name: string, spec: unknown) => ipcRenderer.send('dex-ext:listen', name, spec ?? null),
      unlisten: (name: string, id?: number) => ipcRenderer.send('dex-ext:unlisten', name, id ?? null),
    }, 'page'],
  }) as ShimDispatch | null;
  if (!dispatch) return;
  ipcRenderer.on('dex-ext:event', (_e, name: string, args: unknown[], ids: number[] | null, token: string | null) => {
    void Promise.resolve(dispatch(name, args, ids)).then(
      (result) => { if (token) ipcRenderer.send('dex-ext:reply', token, result ?? null); },
      () => { if (token) ipcRenderer.send('dex-ext:reply', token, null); },
    );
  });
}

/** "Add to Chrome" → "Add to DEX", once the store has drawn its buttons. */
function rebrand(): void {
  const swap = (root: ParentNode): void => {
    for (const el of Array.from(root.querySelectorAll('span, button, div[role="button"]'))) {
      if (el.childElementCount > 0) continue;
      const text = el.textContent ?? '';
      const next = text
        .replace(/^Add to Chrome$/, 'Add to DEX')
        .replace(/^Remove from Chrome$/, 'Remove from DEX');
      if (next !== text) el.textContent = next;
    }
  };
  const start = (): void => {
    swap(document);
    new MutationObserver((records) => {
      for (const r of records) for (const n of Array.from(r.addedNodes)) if (n instanceof Element) swap(n);
    }).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

function webStore(): void {
  const dispatch = contextBridge.executeInMainWorld({
    func: storeBridge,
    args: [(method: string, args: unknown[]) => ipcRenderer.invoke('dex-cws:call', method, args)],
  }) as StoreDispatch | null;
  if (!dispatch) return;
  ipcRenderer.on('dex-cws:event', (_e, name: string, args: unknown[]) => dispatch(name, args));
  rebrand();
}

if (location.protocol === 'chrome-extension:') extensionPage();
else if (location.origin === STORE_ORIGIN) webStore();
