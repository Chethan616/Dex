/**
 * Reading an extension's manifest the way Chrome presents it: its name in
 * your language, its icon, what it asks to do, and where it may run.
 */
import fs from 'node:fs';
import path from 'node:path';

export type Manifest = Record<string, unknown> & {
  name?: string;
  short_name?: string;
  description?: string;
  version?: string;
  manifest_version?: number;
  default_locale?: string;
  icons?: Record<string, string>;
  permissions?: unknown[];
  optional_permissions?: unknown[];
  host_permissions?: unknown[];
  optional_host_permissions?: unknown[];
  content_scripts?: Array<{ matches?: string[] }>;
  action?: { default_popup?: string; default_title?: string; default_icon?: string | Record<string, string> };
  browser_action?: { default_popup?: string; default_title?: string; default_icon?: string | Record<string, string> };
  options_page?: string;
  options_ui?: { page?: string };
  side_panel?: { default_path?: string };
  homepage_url?: string;
  commands?: Record<string, { suggested_key?: Record<string, string> | string; description?: string }>;
  key?: string;
};

export function readManifest(dir: string): Manifest {
  return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^\uFEFF/, '')) as Manifest;
}

/** `_locales/<locale>/messages.json`, trying the UI's language, its base, then the default. */
function loadMessages(dir: string, manifest: Manifest, uiLocale: string): Record<string, { message?: string }> {
  const tries = [uiLocale.replace('-', '_'), uiLocale.split(/[-_]/)[0], manifest.default_locale].filter(Boolean) as string[];
  for (const locale of tries) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, '_locales', locale, 'messages.json'), 'utf8').replace(/^\uFEFF/, '')) as Record<string, { message?: string }>;
    } catch { /* next */ }
  }
  return {};
}

/** Replace `__MSG_name__` with its message, as Chrome does in the manifest. */
export function localize(text: string | undefined, dir: string, manifest: Manifest, uiLocale = 'en'): string {
  if (!text) return '';
  if (!text.includes('__MSG_')) return text;
  const messages = loadMessages(dir, manifest, uiLocale);
  const lower = Object.fromEntries(Object.entries(messages).map(([k, v]) => [k.toLowerCase(), v]));
  return text.replace(/__MSG_([A-Za-z0-9_@]+)__/g, (_m, key: string) => lower[key.toLowerCase()]?.message ?? '');
}

/** The icon path closest to `size` px (at least as big when there is one). */
export function pickIcon(icons: string | Record<string, string> | undefined, size: number): string | null {
  if (!icons) return null;
  if (typeof icons === 'string') return icons;
  const sizes = Object.keys(icons).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (sizes.length === 0) return null;
  const best = sizes.find((s) => s >= size) ?? sizes[sizes.length - 1];
  return icons[String(best)] ?? null;
}

/** An extension file's path, refused if it would leave the extension's folder. */
export function extensionFile(dir: string, rel: string): string | null {
  const clean = rel.replace(/^\/+/, '').split(/[?#]/)[0];
  const target = path.resolve(dir, clean);
  const back = path.relative(dir, target);
  if (!back || back.startsWith('..') || path.isAbsolute(back)) return null;
  return target;
}

export function actionOf(manifest: Manifest): { popup?: string; title?: string; icon?: string | Record<string, string> } {
  const a = manifest.action ?? manifest.browser_action ?? {};
  return { popup: a.default_popup || undefined, title: a.default_title || undefined, icon: a.default_icon ?? manifest.icons };
}

export function optionsPageOf(manifest: Manifest): string | null {
  return manifest.options_ui?.page || manifest.options_page || null;
}

const API_PERMISSIONS = new Set([
  'activeTab', 'alarms', 'background', 'bookmarks', 'browsingData', 'clipboardRead', 'clipboardWrite', 'contentSettings',
  'contextMenus', 'cookies', 'debugger', 'declarativeContent', 'declarativeNetRequest', 'declarativeNetRequestFeedback',
  'declarativeNetRequestWithHostAccess', 'desktopCapture', 'downloads', 'downloads.open', 'downloads.ui', 'favicon',
  'fontSettings', 'gcm', 'geolocation', 'history', 'identity', 'identity.email', 'idle', 'management', 'nativeMessaging',
  'notifications', 'offscreen', 'pageCapture', 'power', 'printerProvider', 'privacy', 'proxy', 'readingList', 'scripting',
  'search', 'sessions', 'sidePanel', 'storage', 'system.cpu', 'system.display', 'system.memory', 'system.storage',
  'tabCapture', 'tabGroups', 'tabs', 'topSites', 'tts', 'ttsEngine', 'unlimitedStorage', 'userScripts', 'webAuthenticationProxy',
  'webNavigation', 'webRequest', 'webRequestAuthProvider', 'webRequestBlocking', 'menus',
]);

/** The API permissions it declares (`tabs`, `storage`…). */
export function apiPermissions(manifest: Manifest): string[] {
  const all = [...(manifest.permissions ?? [])].filter((p): p is string => typeof p === 'string');
  return all.filter((p) => API_PERMISSIONS.has(p) || !/[:/*<]/.test(p));
}

/** The sites it may reach: MV3 `host_permissions`, MV2 host patterns in `permissions`, and content-script matches. */
export function hostPermissions(manifest: Manifest, includeContentScripts = true): string[] {
  const out = new Set<string>();
  for (const p of manifest.host_permissions ?? []) if (typeof p === 'string') out.add(p);
  if ((manifest.manifest_version ?? 2) < 3) {
    for (const p of manifest.permissions ?? []) if (typeof p === 'string' && /[:/*<]/.test(p)) out.add(p);
  }
  if (includeContentScripts) {
    for (const cs of manifest.content_scripts ?? []) for (const m of cs.matches ?? []) out.add(m);
  }
  return [...out];
}

const ALL_SITES = /^(<all_urls>|\*:\/\/\*\/\*|https?:\/\/\*\/\*|\*:\/\/\*\/)$/;

/** What Chrome tells you before installing, in its own words where it has them. */
export function permissionWarnings(manifest: Manifest): string[] {
  const perms = new Set(apiPermissions(manifest));
  const hosts = hostPermissions(manifest);
  const warnings: string[] = [];
  if (perms.has('debugger')) warnings.push('Access the page debugger backend');
  if (hosts.some((h) => ALL_SITES.test(h))) warnings.push('Read and change all your data on all websites');
  else if (hosts.length) {
    const names = [...new Set(hosts.map((h) => h.replace(/^[^:]+:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '')))].filter(Boolean);
    if (names.length) warnings.push(names.length <= 3 ? `Read and change your data on ${names.join(', ')}` : `Read and change your data on ${names.length} websites`);
  }
  if (perms.has('history') || perms.has('tabs') || perms.has('webNavigation')) warnings.push('Read your browsing history');
  if (perms.has('bookmarks')) warnings.push('Read and change your bookmarks');
  if (perms.has('cookies') && !hosts.length) warnings.push('Read and change your cookies');
  if (perms.has('clipboardRead')) warnings.push('Read data you copy and paste');
  if (perms.has('clipboardWrite')) warnings.push('Modify data you copy and paste');
  if (perms.has('downloads')) warnings.push('Manage your downloads');
  if (perms.has('geolocation')) warnings.push('Detect your physical location');
  if (perms.has('management')) warnings.push('Manage your apps, extensions, and themes');
  if (perms.has('nativeMessaging')) warnings.push('Communicate with cooperating native applications');
  if (perms.has('notifications')) warnings.push('Display notifications');
  if (perms.has('privacy')) warnings.push('Change your privacy-related settings');
  if (perms.has('proxy')) warnings.push('Change your proxy settings');
  if (perms.has('desktopCapture') || perms.has('tabCapture')) warnings.push('Capture content of your screen');
  if (perms.has('declarativeNetRequest') || perms.has('declarativeNetRequestWithHostAccess')) warnings.push('Block content on any page');
  if (perms.has('identity.email')) warnings.push('Know your email address');
  return warnings;
}
