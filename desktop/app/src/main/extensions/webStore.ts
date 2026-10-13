/**
 * The Chrome Web Store page's side of "Add to DEX" (preload/storeBridge.ts
 * is the page's side). The store calls Chrome's private webstorePrivate API
 * with the extension's id, name, icon and manifest; DEX asks you with what
 * the extension can do, then installs it the same way as everywhere else
 * (ExtensionManager.installFromStore: downloaded from Google, signatures
 * checked).
 *
 * Only the store's own page in DEX's web profile is answered; any other
 * caller is ignored.
 */
import { isExtensionId } from './crx';
import { permissionWarnings, type Manifest } from './manifest';
import type { ExtensionManager } from './ExtensionManager';
import { extensionInfo } from './permissionsApi';

export const STORE_ORIGIN = 'https://chromewebstore.google.com';

export interface StoreDeps {
  manager: ExtensionManager;
  chromeVersion: string;
  /** The store's install question: its icon is a URL on Google's CDN. */
  confirm(info: { name: string; warnings: string[]; iconUrl: string | null }): Promise<boolean>;
  /** Chrome asks before the store removes an extension; so does DEX. */
  confirmRemove(name: string): Promise<boolean>;
  log?(event: string, data: Record<string, unknown>): void;
}

export function storeCaller(senderOrigin: string | undefined | null): boolean {
  return senderOrigin === STORE_ORIGIN;
}

export function createStoreApi(deps: StoreDeps): (method: string, args: unknown[]) => Promise<unknown> {
  const { manager } = deps;
  const status = (id: unknown): string => {
    if (typeof id !== 'string' || !isExtensionId(id)) return 'installable';
    if (manager.isInstalling(id)) return 'installable';
    const ext = manager.get(id);
    if (!ext) return 'installable';
    return ext.enabled ? 'enabled' : 'disabled';
  };
  const info = (id: string) => {
    const s = manager.summary(id);
    const ext = manager.get(id);
    if (!s || !ext) return null;
    return extensionInfo(id, { manifest: { name: s.name, version: s.version, description: s.description } as Manifest, name: s.name, granted: manager.granted(id) }, s.enabled, s.optionsUrl, ext.source);
  };

  return async (method, args) => {
    switch (method) {
      case 'beginInstallWithManifest3': {
        const d = (args[0] ?? {}) as { id?: unknown; manifest?: unknown; iconUrl?: unknown; localizedName?: unknown };
        const id = typeof d.id === 'string' ? d.id : '';
        if (!isExtensionId(id)) return { result: 'invalid_id' };
        if (manager.isInstalling(id)) return { result: 'install_in_progress' };
        if (manager.get(id)) return { result: 'already_installed' };
        let manifest: Manifest;
        try { manifest = JSON.parse(String(d.manifest ?? '')) as Manifest; } catch { return { result: 'manifest_error' }; }
        const name = typeof d.localizedName === 'string' && d.localizedName ? d.localizedName : (manifest.name ?? id);
        const iconUrl = typeof d.iconUrl === 'string' && /^https:\/\//.test(d.iconUrl) ? d.iconUrl : null;
        const ok = await deps.confirm({ name, warnings: permissionWarnings(manifest), iconUrl });
        if (!ok) return { result: 'user_cancelled' };
        try {
          const result = await manager.installFromStore(id, { confirmed: true });
          return { result: result === 'already_installed' ? 'success' : result };
        } catch (err) {
          deps.log?.('extensions.store.installFailed', { id, error: (err as Error).message });
          return { result: 'install_error', message: (err as Error).message };
        }
      }
      case 'completeInstall':
        return 'success';
      case 'install':
        return 'success';
      case 'getExtensionStatus':
        return status(args[0]);
      case 'getFullChromeVersion':
        return { version_number: deps.chromeVersion, app_name: 'DEX' };
      case 'getBrowserLogin':
        return { login: '' };
      case 'getStoreLogin':
        return '';
      case 'setStoreLogin':
        return true;
      case 'getWebGLStatus':
        return 'webgl_allowed';
      case 'getIsLauncherEnabled':
        return false;
      case 'enableAppLauncher':
        return undefined;
      case 'isInIncognitoMode':
        return false;
      case 'getMV2DeprecationStatus':
        return 'inactive';
      case 'getReferrerChain':
        return '';
      case 'isPendingCustodianApproval':
        return false;
      case 'management.getAll':
        return manager.list().map((s) => info(s.id)).filter(Boolean);
      case 'management.get': {
        const id = String(args[0] ?? '');
        return info(id);
      }
      case 'management.setEnabled': {
        const id = String(args[0] ?? '');
        if (manager.get(id)) await manager.setEnabled(id, Boolean(args[1]));
        return undefined;
      }
      case 'management.uninstall': {
        const id = String(args[0] ?? '');
        const s = manager.summary(id);
        if (s && await deps.confirmRemove(s.name)) await manager.uninstall(id);
        return undefined;
      }
      default:
        deps.log?.('extensions.store.unknownCall', { method });
        return undefined;
    }
  };
}
