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

/**
 * The store's Chrome-only wording, made DEX's: "Add to Chrome" → "Add to
 * DEX", and its "Switch to Chrome?" dialog and banner out of the way. Found
 * by their text, not Google's class names, which change; if the store's
 * wording changes, this just stops doing anything.
 */
function rebrand(): void {
  const leafWithText = (text: string): HTMLElement[] =>
    Array.from(document.querySelectorAll<HTMLElement>('span, button, h1, h2, h3, div, p'))
      .filter((el) => el.childElementCount === 0 && el.textContent?.trim() === text);
  const pass = (): void => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('span, button'))) {
      if (el.childElementCount > 0) continue;
      const text = el.textContent?.trim() ?? '';
      if (text === 'Add to Chrome') el.textContent = 'Add to DEX';
      else if (text === 'Remove from Chrome') el.textContent = 'Remove from DEX';
    }
    // The "Switch to Chrome?" dialog: dismissed with its own "No thanks".
    for (const title of leafWithText('Switch to Chrome?')) {
      const dialog = title.closest<HTMLElement>('[role="dialog"]');
      const no = dialog && Array.from(dialog.querySelectorAll<HTMLElement>('button')).find((b) => b.textContent?.trim() === 'No thanks');
      if (no && !no.dataset.dexDismissed) { no.dataset.dexDismissed = '1'; no.click(); }
    }
    // The "Switch to Chrome to install…" banner: its card goes.
    for (const line of leafWithText('Switch to Chrome to install extensions and themes')) {
      let card: HTMLElement | null = line;
      while (card?.parentElement && card.parentElement.tagName !== 'SECTION' && card.parentElement !== document.body) card = card.parentElement;
      if (card && card.parentElement?.tagName === 'SECTION') card.style.display = 'none';
    }
  };
  let queued = false;
  const later = (): void => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; pass(); }, 150);
  };
  const start = (): void => {
    pass();
    new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
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
