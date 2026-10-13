/**
 * What an extension may do, and chrome.permissions / chrome.management.
 *
 * An extension starts with what its manifest requires. Optional permissions
 * are granted only when it asks (chrome.permissions.request) and you agree,
 * and are remembered with the extension (ExtensionManager).
 */
import { ApiError, type Handler } from './types';
import { matchesAny, parseMatchPattern } from './matchPattern';
import { apiPermissions, hostPermissions, type Manifest } from './manifest';

export interface ExtensionGrants {
  manifest: Manifest;
  name: string;
  granted: { permissions: string[]; origins: string[] };
}

/** A URL a match pattern covers, to test one pattern against another. */
function sampleUrl(pattern: string): string | null {
  if (pattern === '<all_urls>') return 'https://dex-sample.example/';
  const p = parseMatchPattern(pattern);
  if (!p) return null;
  const scheme = p.schemes === 'any' ? 'https' : [...p.schemes][0] === 'file' ? 'file' : [...p.schemes].includes('https') ? 'https' : [...p.schemes][0];
  if (scheme === 'file') return 'file:///dex-sample';
  const host = p.host === '*' ? 'dex-sample.example' : p.subdomains ? `dex-sample.${p.host}` : p.host;
  return `${scheme}://${host}${p.port ? `:${p.port}` : ''}/`;
}

/** Whether `have` covers everything `want` would (good enough for contains/request). */
export function patternCovers(have: string[], want: string): boolean {
  if (have.includes(want)) return true;
  if (want === '<all_urls>' || /^\*:\/\/\*\//.test(want)) return have.some((h) => h === '<all_urls>' || /^\*:\/\/\*\/\*$/.test(h));
  const sample = sampleUrl(want);
  return Boolean(sample && matchesAny(have, sample));
}

export class Permissions {
  constructor(private readonly lookup: (extensionId: string) => ExtensionGrants | null) {}

  apiSet(extensionId: string): Set<string> {
    const e = this.lookup(extensionId);
    if (!e) return new Set();
    return new Set([...apiPermissions(e.manifest), ...e.granted.permissions]);
  }

  hosts(extensionId: string, includeContentScripts = false): string[] {
    const e = this.lookup(extensionId);
    if (!e) return [];
    return [...hostPermissions(e.manifest, includeContentScripts), ...e.granted.origins];
  }

  has(extensionId: string, permission: string): boolean {
    return this.apiSet(extensionId).has(permission);
  }

  /** Host access to `url` from its permissions (not "tabs"). */
  canReach(extensionId: string, url: string): boolean {
    return matchesAny(this.hosts(extensionId), url);
  }

  handlers(deps: {
    ask(extensionId: string, name: string, warnings: string[]): Promise<boolean>;
    grant(extensionId: string, permissions: string[], origins: string[]): void;
    revoke(extensionId: string, permissions: string[], origins: string[]): void;
    warningsFor(permissions: string[], origins: string[]): string[];
    emit(extensionId: string, event: string, args: unknown[]): void;
  }): Record<string, Handler> {
    const parse = (v: unknown) => {
      const o = (v && typeof v === 'object' ? v : {}) as { permissions?: unknown; origins?: unknown };
      const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
      return { permissions: list(o.permissions), origins: list(o.origins) };
    };
    return {
      'permissions.contains': (ctx, [v]) => {
        const want = parse(v);
        const api = this.apiSet(ctx.extensionId);
        const hosts = this.hosts(ctx.extensionId);
        return want.permissions.every((p) => api.has(p)) && want.origins.every((o) => patternCovers(hosts, o));
      },
      'permissions.getAll': (ctx) => ({ permissions: [...this.apiSet(ctx.extensionId)], origins: this.hosts(ctx.extensionId) }),
      'permissions.request': async (ctx, [v]) => {
        const e = this.lookup(ctx.extensionId);
        if (!e) throw new ApiError('Unknown extension');
        const want = parse(v);
        const optionalApi = new Set((e.manifest.optional_permissions ?? []).filter((p): p is string => typeof p === 'string'));
        const optionalHosts = [
          ...(e.manifest.optional_host_permissions ?? []),
          ...(e.manifest.optional_permissions ?? []).filter((p) => typeof p === 'string' && /[:/*<]/.test(p)),
        ].filter((p): p is string => typeof p === 'string');
        const api = this.apiSet(ctx.extensionId);
        const hosts = this.hosts(ctx.extensionId);
        const newApi = want.permissions.filter((p) => !api.has(p));
        const newHosts = want.origins.filter((o) => !patternCovers(hosts, o));
        if (newApi.some((p) => !optionalApi.has(p)) || newHosts.some((o) => !patternCovers(optionalHosts, o))) {
          throw new ApiError('Only permissions specified in the manifest may be requested.');
        }
        if (newApi.length === 0 && newHosts.length === 0) return true;
        const ok = await deps.ask(ctx.extensionId, e.name, deps.warningsFor(newApi, newHosts));
        if (!ok) return false;
        deps.grant(ctx.extensionId, newApi, newHosts);
        deps.emit(ctx.extensionId, 'permissions.onAdded', [{ permissions: newApi, origins: newHosts }]);
        return true;
      },
      'permissions.remove': (ctx, [v]) => {
        const e = this.lookup(ctx.extensionId);
        if (!e) return false;
        const want = parse(v);
        const required = new Set(apiPermissions(e.manifest));
        const requiredHosts = hostPermissions(e.manifest, false);
        if (want.permissions.some((p) => required.has(p)) || want.origins.some((o) => requiredHosts.includes(o))) {
          throw new ApiError("You can't remove required permissions.");
        }
        deps.revoke(ctx.extensionId, want.permissions, want.origins);
        deps.emit(ctx.extensionId, 'permissions.onRemoved', [want]);
        return true;
      },
      'permissions.addHostAccessRequest': () => undefined,
      'permissions.removeHostAccessRequest': () => undefined,
    };
  }
}

/** chrome.management's ExtensionInfo for one extension. */
export function extensionInfo(id: string, e: ExtensionGrants, enabled: boolean, optionsUrl: string | null, source: 'store' | 'unpacked'): Record<string, unknown> {
  const m = e.manifest;
  const icons = Object.entries(m.icons ?? {}).map(([size, p]) => ({ size: Number(size), url: `chrome-extension://${id}/${String(p).replace(/^\/+/, '')}` }));
  return {
    id,
    name: e.name,
    shortName: e.name,
    description: typeof m.description === 'string' ? m.description : '',
    version: m.version ?? '',
    enabled,
    mayDisable: true,
    isApp: false,
    type: 'extension',
    installType: source === 'unpacked' ? 'development' : 'normal',
    offlineEnabled: false,
    homepageUrl: typeof m.homepage_url === 'string' ? m.homepage_url : '',
    updateUrl: '',
    optionsUrl: optionsUrl ?? '',
    permissions: apiPermissions(m),
    hostPermissions: hostPermissions(m, false),
    icons,
  };
}
