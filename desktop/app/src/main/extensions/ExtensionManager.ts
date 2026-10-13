/**
 * The extensions you've added to DEX's browser (docs/unify/PLAN.md §3.8).
 *
 * They live in the web profile only (workspace/webProfile.ts), so they act
 * on the pages in your tasks' tabs and never inside DEX's own windows.
 *
 * - Store installs are downloaded from Google's update service, their
 *   signatures checked (crx.ts), shown to you with what they can do, and
 *   unpacked into `<userData>/extensions/<id>/<version>_0`.
 * - "Load unpacked" points at a folder you chose and leaves it in place.
 * - What's installed, on, pinned and allowed file access is remembered in
 *   `<userData>/extensions/state.json`; Electron forgets extensions on every
 *   start, so each enabled one is loaded again at startup.
 * - Store installs are checked for updates a few minutes after start, then
 *   every five hours, like Chrome.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isExtensionId, MAX_CRX_BYTES, parseCrx, unpackCrx, verifyCrx } from './crx';
import { actionOf, apiPermissions, hostPermissions, localize, optionsPageOf, permissionWarnings, pickIcon, readManifest, type Manifest } from './manifest';

export interface InstalledExtension {
  id: string;
  source: 'store' | 'unpacked';
  path: string;
  version: string;
  enabled: boolean;
  pinned: boolean;
  fileAccess: boolean;
  installedAt: string;
  updatedAt?: string;
  /** Optional permissions you agreed to (chrome.permissions.request). */
  granted?: { permissions: string[]; origins: string[] };
  /** Opened when you remove it (chrome.runtime.setUninstallURL). */
  uninstallUrl?: string;
}

/** One extension as Settings and the toolbar show it. */
export interface ExtensionSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  source: 'store' | 'unpacked';
  enabled: boolean;
  loaded: boolean;
  pinned: boolean;
  fileAccess: boolean;
  /** The extension's icon file, absolute (the hub asks main for its bytes). */
  iconPath: string | null;
  warnings: string[];
  permissions: string[];
  hostPermissions: string[];
  hasPopup: boolean;
  optionsUrl: string | null;
  homepageUrl: string | null;
  storeUrl: string | null;
  error: string | null;
  manifestVersion: number;
}

/** What the manager needs from Electron (a fake in tests). */
export interface ExtensionsApi {
  loadExtension(path: string, opts?: { allowFileAccess?: boolean }): Promise<{ id: string; name: string; version: string; manifest: unknown }>;
  removeExtension(id: string): void;
  getExtension(id: string): { id: string; path: string; manifest: unknown } | null;
}

export interface ManagerDeps {
  dir: string;
  extensions: ExtensionsApi;
  /** GET a URL, at most `maxBytes`. */
  fetchBytes(url: string, maxBytes: number): Promise<Buffer>;
  fetchText(url: string): Promise<string>;
  chromeVersion: string;
  /** Ask before adding an extension. Resolves true to add it. */
  confirmInstall(info: { id: string; name: string; warnings: string[]; iconPath: string | null; source: 'store' | 'unpacked' }): Promise<boolean>;
  /** Wipe an uninstalled extension's own storage. */
  clearData(id: string): Promise<void>;
  uiLocale?: string;
  log?(event: string, data: Record<string, unknown>): void;
  /** Tests only: accept packages the Web Store didn't sign (they can't be). */
  allowUnsignedForTests?: boolean;
}

interface StateFile { version: 1; extensions: Record<string, InstalledExtension> }

export const UPDATE_INTERVAL_MS = 5 * 60 * 60 * 1000;

/** The store's install URL for an id or a pasted store link, or null. */
export function extensionIdFrom(input: string): string | null {
  const text = input.trim();
  if (isExtensionId(text)) return text;
  const m = /([a-p]{32})(?:[/?#]|$)/.exec(text);
  return m && /chrome(webstore)?\.google\.com/.test(text) ? m[1] : null;
}

export function crxUrl(id: string, chromeVersion: string): string {
  const x = new URLSearchParams({ id, uc: '' }).toString();
  return `https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx3&prodversion=${encodeURIComponent(chromeVersion)}&x=${encodeURIComponent(x)}`;
}

export function updateCheckUrl(items: Array<{ id: string; version: string }>, chromeVersion: string): string {
  const xs = items.map(({ id, version }) => `&x=${encodeURIComponent(new URLSearchParams({ id, v: version, uc: '' }).toString())}`).join('');
  return `https://clients2.google.com/service/update2/crx?response=updatecheck&acceptformat=crx3&prodversion=${encodeURIComponent(chromeVersion)}${xs}`;
}

/** Google's update answer: the ids with a newer version, and where to get it. */
export function parseUpdateResponse(xml: string): Array<{ id: string; version: string; codebase: string }> {
  const out: Array<{ id: string; version: string; codebase: string }> = [];
  const apps = xml.match(/<app\b[^>]*>[\s\S]*?<\/app>/g) ?? [];
  for (const app of apps) {
    const id = /appid="([a-p]{32})"/.exec(app)?.[1];
    const check = /<updatecheck\b([^>]*)\/?>/.exec(app)?.[1] ?? '';
    const status = /status="([^"]*)"/.exec(check)?.[1];
    const version = /version="([^"]*)"/.exec(check)?.[1];
    const codebase = /codebase="([^"]*)"/.exec(check)?.[1]?.replace(/&amp;/g, '&');
    if (id && status === 'ok' && version && codebase?.startsWith('https://')) out.push({ id, version, codebase });
  }
  return out;
}

/** -1, 0 or 1, comparing dotted versions number by number. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export class ExtensionManager {
  private state: StateFile = { version: 1, extensions: {} };
  private errors = new Map<string, string>();
  private installing = new Set<string>();
  private listeners = new Set<() => void>();
  private updateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: ManagerDeps) {}

  private get stateFile(): string { return path.join(this.deps.dir, 'state.json'); }

  private readState(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as StateFile;
      if (raw && raw.version === 1 && raw.extensions && typeof raw.extensions === 'object') this.state = raw;
    } catch { /* first run */ }
  }

  private writeState(): void {
    fs.mkdirSync(this.deps.dir, { recursive: true });
    const tmp = `${this.stateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.stateFile);
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const l of this.listeners) { try { l(); } catch { /* a listener's problem */ } }
  }

  /** Load every enabled extension. Call once at startup. */
  async start(): Promise<void> {
    this.readState();
    for (const ext of Object.values(this.state.extensions)) {
      if (ext.enabled) await this.load(ext);
    }
    this.changed();
  }

  private async load(ext: InstalledExtension): Promise<boolean> {
    if (!fs.existsSync(path.join(ext.path, 'manifest.json'))) {
      this.errors.set(ext.id, "Its files are missing. Remove it and add it again.");
      return false;
    }
    try {
      const loaded = await this.deps.extensions.loadExtension(ext.path, { allowFileAccess: ext.fileAccess });
      this.errors.delete(ext.id);
      if (loaded.id !== ext.id) {
        // An unpacked folder without a "key" gets a path-based id; keep it.
        this.deps.log?.('extensions.idChanged', { from: ext.id, to: loaded.id });
      }
      this.deps.log?.('extensions.loaded', { id: loaded.id, version: loaded.version });
      return true;
    } catch (err) {
      this.errors.set(ext.id, (err as Error).message);
      this.deps.log?.('extensions.loadFailed', { id: ext.id, error: (err as Error).message });
      return false;
    }
  }

  list(): ExtensionSummary[] {
    return Object.values(this.state.extensions)
      .map((ext) => this.summarize(ext))
      .filter((s): s is ExtensionSummary => s !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): InstalledExtension | null {
    return this.state.extensions[id] ?? null;
  }

  summary(id: string): ExtensionSummary | null {
    const ext = this.state.extensions[id];
    return ext ? this.summarize(ext) : null;
  }

  private summarize(ext: InstalledExtension): ExtensionSummary | null {
    let manifest: Manifest;
    try { manifest = readManifest(ext.path); } catch { manifest = { name: ext.id, version: ext.version }; }
    const locale = this.deps.uiLocale ?? 'en';
    const icon = pickIcon(manifest.icons ?? actionOf(manifest).icon, 48);
    const options = optionsPageOf(manifest);
    const loaded = this.deps.extensions.getExtension(ext.id) !== null;
    return {
      id: ext.id,
      name: localize(manifest.name, ext.path, manifest, locale) || ext.id,
      description: localize(manifest.description, ext.path, manifest, locale),
      version: manifest.version ?? ext.version,
      source: ext.source,
      enabled: ext.enabled,
      loaded,
      pinned: ext.pinned,
      fileAccess: ext.fileAccess,
      iconPath: icon ? path.join(ext.path, icon.replace(/^\/+/, '')) : null,
      warnings: permissionWarnings(manifest),
      permissions: apiPermissions(manifest),
      hostPermissions: hostPermissions(manifest),
      hasPopup: Boolean(actionOf(manifest).popup),
      optionsUrl: options ? `chrome-extension://${ext.id}/${options.replace(/^\/+/, '')}` : null,
      homepageUrl: typeof manifest.homepage_url === 'string' ? manifest.homepage_url : null,
      storeUrl: ext.source === 'store' ? `https://chromewebstore.google.com/detail/${ext.id}` : null,
      error: ext.enabled && !loaded ? (this.errors.get(ext.id) ?? null) : null,
      manifestVersion: manifest.manifest_version ?? 2,
    };
  }

  isInstalling(id: string): boolean {
    return this.installing.has(id);
  }

  /**
   * Add an extension from the Chrome Web Store. `confirmed` skips the
   * question when the store page already asked (its own dialog is ours).
   * Resolves the outcome in the store's words.
   */
  async installFromStore(id: string, opts: { confirmed?: boolean } = {}): Promise<'success' | 'already_installed' | 'user_cancelled' | 'install_in_progress'> {
    if (!isExtensionId(id)) throw new Error("That isn't an extension id");
    if (this.state.extensions[id]) {
      if (!this.state.extensions[id].enabled) await this.setEnabled(id, true);
      return 'already_installed';
    }
    if (this.installing.has(id)) return 'install_in_progress';
    this.installing.add(id);
    this.changed();
    try {
      const fresh = await this.downloadVerified(id, crxUrl(id, this.deps.chromeVersion));
      try {
        const name = localize(fresh.manifest.name, fresh.dir, fresh.manifest, this.deps.uiLocale ?? 'en') || id;
        const icon = pickIcon(fresh.manifest.icons, 128);
        if (!opts.confirmed) {
          const ok = await this.deps.confirmInstall({
            id, name, warnings: permissionWarnings(fresh.manifest), source: 'store',
            iconPath: icon ? path.join(fresh.dir, icon.replace(/^\/+/, '')) : null,
          });
          if (!ok) { fs.rmSync(fresh.dir, { recursive: true, force: true }); return 'user_cancelled'; }
        }
        const final = path.join(this.deps.dir, id, `${fresh.manifest.version}_0`);
        fs.rmSync(final, { recursive: true, force: true });
        fs.renameSync(fresh.dir, final);
        const ext: InstalledExtension = {
          id, source: 'store', path: final, version: String(fresh.manifest.version), enabled: true,
          pinned: false, fileAccess: false, installedAt: new Date().toISOString(),
        };
        this.state.extensions[id] = ext;
        this.writeState();
        await this.load(ext);
        this.deps.log?.('extensions.installed', { id, version: ext.version });
        return 'success';
      } finally {
        if (fs.existsSync(fresh.dir)) fs.rmSync(fresh.dir, { recursive: true, force: true });
      }
    } finally {
      this.installing.delete(id);
      this.changed();
    }
  }

  /** Download a CRX, check it, and unpack it into a scratch folder. */
  private async downloadVerified(id: string, url: string): Promise<{ dir: string; manifest: Manifest }> {
    const bytes = await this.deps.fetchBytes(url, MAX_CRX_BYTES);
    const crx = parseCrx(bytes);
    verifyCrx(crx, { expectedId: id, requireWebStore: this.deps.allowUnsignedForTests !== true });
    const dir = path.join(this.deps.dir, id, `.incoming-${crypto.randomUUID()}`);
    try {
      const manifest = unpackCrx(crx, dir) as Manifest;
      if (typeof manifest.version !== 'string' || !/^\d+(\.\d+){0,3}$/.test(manifest.version)) {
        throw new Error('The extension has no valid version');
      }
      return { dir, manifest };
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw err;
    }
  }

  /** "Load unpacked": an extension folder on your PC, used where it is. */
  async loadUnpacked(folder: string): Promise<ExtensionSummary> {
    let manifest: Manifest;
    try { manifest = readManifest(folder); } catch { throw new Error("That folder has no manifest.json, so it isn't an extension"); }
    const name = localize(manifest.name, folder, manifest, this.deps.uiLocale ?? 'en') || path.basename(folder);
    const icon = pickIcon(manifest.icons, 128);
    const ok = await this.deps.confirmInstall({
      id: '', name, warnings: permissionWarnings(manifest), source: 'unpacked',
      iconPath: icon ? path.join(folder, icon.replace(/^\/+/, '')) : null,
    });
    if (!ok) throw new Error('Cancelled');
    const loaded = await this.deps.extensions.loadExtension(folder, { allowFileAccess: false });
    const ext: InstalledExtension = {
      id: loaded.id, source: 'unpacked', path: folder, version: loaded.version, enabled: true,
      pinned: false, fileAccess: false, installedAt: new Date().toISOString(),
    };
    this.state.extensions[loaded.id] = ext;
    this.errors.delete(loaded.id);
    this.writeState();
    this.changed();
    return this.summarize(ext)!;
  }

  granted(id: string): { permissions: string[]; origins: string[] } {
    const g = this.state.extensions[id]?.granted;
    return { permissions: [...(g?.permissions ?? [])], origins: [...(g?.origins ?? [])] };
  }

  grant(id: string, permissions: string[], origins: string[]): void {
    const ext = this.state.extensions[id];
    if (!ext) return;
    const g = ext.granted ?? { permissions: [], origins: [] };
    ext.granted = {
      permissions: [...new Set([...g.permissions, ...permissions])],
      origins: [...new Set([...g.origins, ...origins])],
    };
    this.writeState();
  }

  revoke(id: string, permissions: string[], origins: string[]): void {
    const ext = this.state.extensions[id];
    if (!ext?.granted) return;
    ext.granted = {
      permissions: ext.granted.permissions.filter((p) => !permissions.includes(p)),
      origins: ext.granted.origins.filter((o) => !origins.includes(o)),
    };
    this.writeState();
  }

  setUninstallUrl(id: string, url: string): void {
    const ext = this.state.extensions[id];
    if (!ext) return;
    ext.uninstallUrl = url || undefined;
    this.writeState();
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const ext = this.state.extensions[id];
    if (!ext || ext.enabled === enabled) return;
    ext.enabled = enabled;
    this.writeState();
    if (enabled) await this.load(ext);
    else {
      try { this.deps.extensions.removeExtension(id); } catch { /* not loaded */ }
    }
    this.changed();
  }

  setPinned(id: string, pinned: boolean): void {
    const ext = this.state.extensions[id];
    if (!ext || ext.pinned === pinned) return;
    ext.pinned = pinned;
    this.writeState();
    this.changed();
  }

  /** File URLs need a reload of the extension to take effect, as in Chrome. */
  async setFileAccess(id: string, allowed: boolean): Promise<void> {
    const ext = this.state.extensions[id];
    if (!ext || ext.fileAccess === allowed) return;
    ext.fileAccess = allowed;
    this.writeState();
    if (ext.enabled) {
      try { this.deps.extensions.removeExtension(id); } catch { /* not loaded */ }
      await this.load(ext);
    }
    this.changed();
  }

  /** Reload an unpacked extension after you changed its files. */
  async reload(id: string): Promise<void> {
    const ext = this.state.extensions[id];
    if (!ext?.enabled) return;
    try { this.deps.extensions.removeExtension(id); } catch { /* not loaded */ }
    await this.load(ext);
    this.changed();
  }

  async uninstall(id: string): Promise<void> {
    const ext = this.state.extensions[id];
    if (!ext) return;
    try { this.deps.extensions.removeExtension(id); } catch { /* not loaded */ }
    delete this.state.extensions[id];
    this.errors.delete(id);
    this.writeState();
    // Only DEX's own copy is deleted; an unpacked folder is yours.
    if (ext.source === 'store') fs.rmSync(path.join(this.deps.dir, id), { recursive: true, force: true });
    await this.deps.clearData(id).catch(() => undefined);
    this.deps.log?.('extensions.uninstalled', { id });
    this.changed();
  }

  /** Check the store for newer versions and install them. Returns the ids updated. */
  async checkForUpdates(): Promise<string[]> {
    const store = Object.values(this.state.extensions).filter((e) => e.source === 'store');
    if (store.length === 0) return [];
    const xml = await this.deps.fetchText(updateCheckUrl(store.map((e) => ({ id: e.id, version: e.version })), this.deps.chromeVersion));
    const updated: string[] = [];
    for (const u of parseUpdateResponse(xml)) {
      const ext = this.state.extensions[u.id];
      if (!ext || compareVersions(u.version, ext.version) <= 0) continue;
      try {
        await this.applyUpdate(ext, u.codebase);
        updated.push(u.id);
      } catch (err) {
        this.deps.log?.('extensions.updateFailed', { id: u.id, error: (err as Error).message });
      }
    }
    if (updated.length) this.changed();
    return updated;
  }

  private async applyUpdate(ext: InstalledExtension, codebase: string): Promise<void> {
    const fresh = await this.downloadVerified(ext.id, codebase);
    const final = path.join(this.deps.dir, ext.id, `${fresh.manifest.version}_0`);
    fs.rmSync(final, { recursive: true, force: true });
    fs.renameSync(fresh.dir, final);
    const old = ext.path;
    if (ext.enabled) {
      try { this.deps.extensions.removeExtension(ext.id); } catch { /* not loaded */ }
    }
    ext.path = final;
    ext.version = String(fresh.manifest.version);
    ext.updatedAt = new Date().toISOString();
    this.writeState();
    if (ext.enabled) await this.load(ext);
    if (old !== final) fs.rmSync(old, { recursive: true, force: true });
    this.deps.log?.('extensions.updated', { id: ext.id, version: ext.version });
  }

  /** Check for updates a few minutes after start, then every five hours. */
  startUpdates(firstDelayMs = 3 * 60 * 1000): void {
    const run = (): void => {
      void this.checkForUpdates().catch((err) => this.deps.log?.('extensions.updateCheckFailed', { error: (err as Error).message }))
        .finally(() => { this.updateTimer = setTimeout(run, UPDATE_INTERVAL_MS); this.updateTimer.unref?.(); });
    };
    this.updateTimer = setTimeout(run, firstDelayMs);
    this.updateTimer.unref?.();
  }

  stop(): void {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = null;
  }
}
