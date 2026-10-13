/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * What the Chrome Web Store's page needs from "the browser" to show a
 * working "Add to Chrome" button: Chrome's private `chrome.webstorePrivate`
 * API and parts of `chrome.management`. Each call goes to DEX's main
 * process (main/extensions/webStore.ts), which asks you, installs, and
 * answers in the store's own terms.
 *
 * Like extensionShim.ts, this is serialized into the page's world by
 * contextBridge.executeInMainWorld: it must stay self-contained.
 */
export type StoreDispatch = (event: string, args: unknown[]) => void;

export function storeBridge(call: (method: string, args: unknown[]) => Promise<unknown>): StoreDispatch | null {
  const g: any = globalThis as any;
  if (location.origin !== 'https://chromewebstore.google.com') return null;
  if (!g.chrome) g.chrome = {};
  const chrome = g.chrome;

  const setLastError = (message: string | null): void => {
    try {
      if (!chrome.runtime) chrome.runtime = {};
      chrome.runtime.lastError = message ? { message } : undefined;
      if (!chrome.extension) chrome.extension = {};
      chrome.extension.lastError = message ? { message } : undefined;
    } catch { /* read-only */ }
  };

  const m = (name: string) => (...raw: any[]) => {
    const cb = typeof raw[raw.length - 1] === 'function' ? raw.pop() : null;
    const p = call(name, raw).then((r: any) => {
      // beginInstall answers { result, message }: the page wants the result.
      if (r && typeof r === 'object' && 'result' in r) {
        setLastError(r.result === 'success' ? null : (r.message || r.result));
        return r.result;
      }
      return r;
    });
    if (cb) { p.then((r: any) => cb(r), () => cb()); return undefined; }
    return p;
  };

  const listeners: Record<string, Array<(...a: any[]) => void>> = {};
  const ev = (name: string) => ({
    addListener: (f: any) => { (listeners[name] = listeners[name] || []).push(f); },
    removeListener: (f: any) => { listeners[name] = (listeners[name] || []).filter((x) => x !== f); },
    hasListener: (f: any) => (listeners[name] || []).includes(f),
  });

  chrome.webstorePrivate = {
    ExtensionInstallStatus: {
      BLACKLISTED: 'blacklisted', BLOCKED_BY_POLICY: 'blocked_by_policy', CAN_REQUEST: 'can_request', CORRUPTED: 'corrupted',
      CUSTODIAN_APPROVAL_REQUIRED: 'custodian_approval_required', DEPRECATED_MANIFEST_VERSION: 'deprecated_manifest_version',
      DISABLED: 'disabled', ENABLED: 'enabled', FORCE_INSTALLED: 'force_installed', INSTALLABLE: 'installable',
      REQUEST_PENDING: 'request_pending', TERMINATED: 'terminated',
    },
    Result: {
      ALREADY_INSTALLED: 'already_installed', BLOCKED_BY_POLICY: 'blocked_by_policy', FEATURE_DISABLED: 'feature_disabled',
      ICON_ERROR: 'icon_error', INSTALL_ERROR: 'install_error', INSTALL_IN_PROGRESS: 'install_in_progress',
      INVALID_ICON_URL: 'invalid_icon_url', INVALID_ID: 'invalid_id', MANIFEST_ERROR: 'manifest_error',
      SUCCESS: 'success', UNKNOWN_ERROR: 'unknown_error', USER_CANCELLED: 'user_cancelled', USER_GESTURE_REQUIRED: 'user_gesture_required',
    },
    WebGlStatus: { WEBGL_ALLOWED: 'webgl_allowed', WEBGL_BLOCKED: 'webgl_blocked' },
    MV2DeprecationStatus: { INACTIVE: 'inactive', WARNING: 'warning', SOFT_DISABLE: 'soft_disable' },
    beginInstallWithManifest3: m('beginInstallWithManifest3'),
    completeInstall: m('completeInstall'),
    install: m('install'),
    getExtensionStatus: m('getExtensionStatus'),
    getFullChromeVersion: m('getFullChromeVersion'),
    getBrowserLogin: m('getBrowserLogin'),
    getStoreLogin: m('getStoreLogin'),
    setStoreLogin: m('setStoreLogin'),
    getWebGLStatus: m('getWebGLStatus'),
    getIsLauncherEnabled: m('getIsLauncherEnabled'),
    enableAppLauncher: m('enableAppLauncher'),
    isInIncognitoMode: m('isInIncognitoMode'),
    getMV2DeprecationStatus: m('getMV2DeprecationStatus'),
    getReferrerChain: m('getReferrerChain'),
    isPendingCustodianApproval: m('isPendingCustodianApproval'),
  };
  if (!chrome.runtime) chrome.runtime = {};
  if (typeof chrome.runtime.getManifest !== 'function') chrome.runtime.getManifest = () => ({});
  chrome.management = Object.assign(chrome.management || {}, {
    getAll: m('management.getAll'),
    get: m('management.get'),
    setEnabled: m('management.setEnabled'),
    uninstall: m('management.uninstall'),
    onInstalled: ev('management.onInstalled'),
    onUninstalled: ev('management.onUninstalled'),
    onEnabled: ev('management.onEnabled'),
    onDisabled: ev('management.onDisabled'),
  });

  return (name, args) => {
    for (const f of listeners[name] || []) {
      try { f(...(args || [])); } catch (e) { console.error(e); }
    }
  };
}
