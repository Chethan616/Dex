/**
 * Preload for every service worker in DEX's web profile. Only extension
 * workers get anything: the shim (extensionShim.ts) checks the worker's own
 * address, in its own world, and leaves websites' workers alone.
 *
 * Calls go to the worker's ServiceWorkerMain in DEX's main process
 * (main/extensions/ExtensionHost.ts), which knows exactly which extension
 * this worker belongs to, from its scope.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { extensionShim, type ShimDispatch } from './extensionShim';

const dispatch = contextBridge.executeInMainWorld({
  func: extensionShim,
  args: [{
    call: (method: string, args: unknown[]) => ipcRenderer.invoke('dex-ext:call', method, args),
    listen: (name: string, spec: unknown) => ipcRenderer.send('dex-ext:listen', name, spec ?? null),
    unlisten: (name: string, id?: number) => ipcRenderer.send('dex-ext:unlisten', name, id ?? null),
  }, 'worker'],
}) as ShimDispatch | null;

if (dispatch) {
  ipcRenderer.on('dex-ext:event', (_e, name: string, args: unknown[], ids: number[] | null, token: string | null) => {
    void Promise.resolve(dispatch(name, args, ids)).then(
      (result) => { if (token) ipcRenderer.send('dex-ext:reply', token, result ?? null); },
      () => { if (token) ipcRenderer.send('dex-ext:reply', token, null); },
    );
  });
}
