import { describe, it, expect, vi } from 'vitest';
import { ActionStore, colorOf } from '../../../src/main/extensions/actionApi';
import { contextsOf, menuTitle, MenuStore } from '../../../src/main/extensions/menusApi';
import { toElectronProxy, ProxyControl } from '../../../src/main/extensions/proxyApi';
import { navigationFilterMatches, urlFilterMatches } from '../../../src/main/extensions/webNavigationApi';
import { matchesPattern } from '../../../src/main/extensions/matchPattern';
import { patternCovers, Permissions } from '../../../src/main/extensions/permissionsApi';
import { permissionWarnings, localize, pickIcon } from '../../../src/main/extensions/manifest';
import { pageContextMenu, type ContextParams } from '../../../src/main/workspace/pageContextMenu';
import { createStoreApi } from '../../../src/main/extensions/webStore';
import type { CallContext } from '../../../src/main/extensions/types';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ext = 'a'.repeat(32);
const ctx: CallContext = { extensionId: ext, kind: 'worker' };

describe('chrome.action', () => {
  const icons = { fromFile: vi.fn(() => 'data:image/png;base64,FILE'), fromPixels: vi.fn(() => 'data:image/png;base64,PIX') };
  const store = () => new ActionStore(icons, () => ({ title: 'Default', popup: 'popup.html' }));

  it('keeps a badge per tab on top of the global one, and drops it with the tab', async () => {
    const s = store();
    const h = s.handlers(async () => undefined);
    await h['action.setBadgeText'](ctx, [{ text: '12' }]);
    await h['action.setBadgeText'](ctx, [{ text: '3', tabId: 7 }]);
    expect(s.stateFor(ext).badgeText).toBe('12');
    expect(s.stateFor(ext, 7).badgeText).toBe('3');
    s.forgetTab(7);
    expect(s.stateFor(ext, 7).badgeText).toBe('12');
  });

  it("starts from the manifest's title and popup", async () => {
    const s = store();
    const h = s.handlers(async () => undefined);
    expect(await h['action.getTitle'](ctx, [{}])).toBe('Default');
    expect(await h['action.getPopup'](ctx, [{}])).toBe(`chrome-extension://${ext}/popup.html`);
    await h['action.setPopup'](ctx, [{ popup: '' }]);
    expect(await h['action.getPopup'](ctx, [{}])).toBe('');
  });

  it('takes icons from pixels or from its own files', async () => {
    const s = store();
    const h = s.handlers(async () => undefined);
    await h['action.setIcon'](ctx, [{ imageData: { 16: { __imageData: true, width: 16, height: 16, data: new Uint8Array(1024) }, 32: { __imageData: true, width: 32, height: 32, data: new Uint8Array(4096) } } }]);
    expect(icons.fromPixels).toHaveBeenCalledWith(32, 32, expect.any(Uint8Array));
    await h['action.setIcon'](ctx, [{ path: 'icons/on.png' }]);
    expect(icons.fromFile).toHaveBeenCalledWith(ext, 'icons/on.png');
    expect(s.stateFor(ext).icon).toBe('data:image/png;base64,FILE');
  });

  it('reads colours as CSS strings or [r, g, b, a]', () => {
    expect(colorOf('#ff0000')).toBe('#ff0000');
    expect(colorOf([255, 0, 0, 255])).toBe('rgba(255, 0, 0, 1.000)');
    expect(colorOf('red; background:url(x)')).toBeNull();
  });
});

describe('chrome.contextMenus', () => {
  const page = { pageUrl: 'https://a.example/', frameId: 0, editable: false };

  it('uses "page" only when nothing more specific was clicked', () => {
    expect(contextsOf(page).has('page')).toBe(true);
    expect(contextsOf({ ...page, linkUrl: 'https://b.example/' }).has('page')).toBe(false);
    expect(contextsOf({ ...page, selectionText: 'hi' }).has('selection')).toBe(true);
  });

  it('puts one item in the menu directly and several under the extension name', () => {
    const m = new MenuStore();
    m.create(ext, { id: 'one', title: 'Translate “%s”', contexts: ['selection'] });
    let entries = m.entriesFor({ ...page, selectionText: 'bonjour le monde' }, () => 'Translator');
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe('Translate “bonjour le monde”');
    m.create(ext, { id: 'two', title: 'Speak', contexts: ['selection'] });
    entries = m.entriesFor({ ...page, selectionText: 'x' }, () => 'Translator');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'submenu', label: 'Translator' });
    expect(entries[0].children.map((c) => c.id)).toEqual(['one', 'two']);
  });

  it('honours document and target URL patterns', () => {
    const m = new MenuStore();
    m.create(ext, { id: 'gh', title: 'On GitHub', contexts: ['page'], documentUrlPatterns: ['https://github.com/*'] });
    expect(m.entriesFor(page, () => 'X')).toEqual([]);
    expect(m.entriesFor({ ...page, pageUrl: 'https://github.com/a' }, () => 'X')).toHaveLength(1);
  });

  it('flips checkboxes and keeps one radio on per group', () => {
    const m = new MenuStore();
    m.create(ext, { id: 'c', type: 'checkbox', title: 'C' });
    m.create(ext, { id: 'r1', type: 'radio', title: 'R1', checked: true });
    m.create(ext, { id: 'r2', type: 'radio', title: 'R2' });
    expect(m.clicked(ext, 'c')).toEqual({ wasChecked: false, checked: true });
    m.clicked(ext, 'r2');
    expect(m.get(ext, 'r1')?.checked).toBe(false);
    expect(m.get(ext, 'r2')?.checked).toBe(true);
  });

  it('refuses duplicate ids and unknown parents, and removes children with a parent', () => {
    const m = new MenuStore();
    m.create(ext, { id: 'p', title: 'P' });
    expect(() => m.create(ext, { id: 'p', title: 'P' })).toThrow(/duplicate/);
    expect(() => m.create(ext, { id: 'x', title: 'X', parentId: 'nope' })).toThrow(/Cannot find/);
    m.create(ext, { id: 'child', title: 'C', parentId: 'p' });
    m.remove(ext, 'p');
    expect(m.get(ext, 'child')).toBeUndefined();
  });

  it('shortens a long selection in titles', () => {
    expect(menuTitle('Search “%s”', 'a'.repeat(50))).toBe(`Search “${'a'.repeat(31)}…”`);
  });
});

describe('chrome.proxy', () => {
  it('turns Chrome proxy settings into Electron ones', () => {
    expect(toElectronProxy({ mode: 'fixed_servers', rules: { singleProxy: { scheme: 'http', host: 'proxy.vit.ac.in', port: 3128 }, bypassList: ['<local>', '*.vit.ac.in'] } }))
      .toEqual({ mode: 'fixed_servers', proxyRules: 'http://proxy.vit.ac.in:3128', proxyBypassRules: '<local>,*.vit.ac.in' });
    expect(toElectronProxy({ mode: 'fixed_servers', rules: { proxyForHttps: { scheme: 'socks5', host: '10.0.0.1', port: 1080 } } }))
      .toEqual({ mode: 'fixed_servers', proxyRules: 'https=socks5://10.0.0.1:1080' });
    expect(toElectronProxy({ mode: 'pac_script', pacScript: { data: 'function FindProxyForURL(){return "DIRECT"}' } }).pacScript)
      .toMatch(/^data:application\/x-ns-proxy-autoconfig;base64,/);
    expect(toElectronProxy({ mode: 'system' })).toEqual({ mode: 'system' });
  });

  it('refuses malformed servers', () => {
    expect(() => toElectronProxy({ mode: 'fixed_servers', rules: { singleProxy: { host: 'a b;c' } } })).toThrow();
    expect(() => toElectronProxy({ mode: 'fixed_servers', rules: {} })).toThrow();
    expect(() => toElectronProxy({ mode: 'weird' })).toThrow();
  });

  it('remembers who set it, gives it back after a restart, and lets go when it leaves', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-proxy-'));
    const file = path.join(dir, 'proxy.json');
    const apply = vi.fn(async () => undefined);
    const p = new ProxyControl({ file, apply, changed: vi.fn() });
    const h = p.handlers();
    await h['proxy.settings.set'](ctx, [{ value: { mode: 'fixed_servers', rules: { singleProxy: { host: 'p.example', port: 8080 } } } }]);
    expect(p.stateFor(ext).levelOfControl).toBe('controlled_by_this_extension');
    expect(p.stateFor('b'.repeat(32)).levelOfControl).toBe('controlled_by_other_extensions');
    const restarted = new ProxyControl({ file, apply, changed: vi.fn() });
    apply.mockClear();
    await restarted.restore(ext);
    expect(apply).toHaveBeenCalledWith({ mode: 'fixed_servers', proxyRules: 'http://p.example:8080' });
    await restarted.release(ext, true);
    expect(apply).toHaveBeenLastCalledWith({ mode: 'system' });
    expect(fs.existsSync(file)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('URL filters and match patterns', () => {
  it('matches webNavigation URL filters the way Chrome describes them', () => {
    expect(urlFilterMatches({ hostSuffix: '.google.com' }, 'https://mail.google.com/x')).toBe(true);
    expect(urlFilterMatches({ hostSuffix: '.google.com' }, 'https://google.com/x')).toBe(true);
    expect(urlFilterMatches({ hostContains: '.foo' }, 'https://www.foobar.com/')).toBe(true);
    expect(urlFilterMatches({ schemes: ['https'], pathPrefix: '/watch' }, 'https://youtube.com/watch?v=1')).toBe(true);
    expect(urlFilterMatches({ urlMatches: '^https://[^/]+/a$' }, 'https://x.example/a#frag')).toBe(true);
    expect(urlFilterMatches({ ports: [[8000, 9000]] }, 'http://localhost:8080/')).toBe(true);
    expect(navigationFilterMatches({ url: [{ hostEquals: 'a.example' }, { hostEquals: 'b.example' }] }, 'https://b.example/')).toBe(true);
    expect(navigationFilterMatches(null, 'https://any.example/')).toBe(true);
  });

  it('reads match patterns', () => {
    expect(matchesPattern('<all_urls>', 'https://a.example/x')).toBe(true);
    expect(matchesPattern('*://*.example.com/*', 'http://www.example.com/a')).toBe(true);
    expect(matchesPattern('*://*.example.com/*', 'https://example.com/')).toBe(true);
    expect(matchesPattern('https://example.com/docs/*', 'https://example.com/blog/')).toBe(false);
    expect(matchesPattern('*://*/*', 'file:///C:/x')).toBe(false);
    expect(matchesPattern('nonsense', 'https://a/')).toBe(false);
  });
});

describe('permissions', () => {
  const manifest = { manifest_version: 3, permissions: ['storage', 'tabs'], optional_permissions: ['bookmarks'], host_permissions: ['https://*.example.com/*'], optional_host_permissions: ['https://other.example/*'] };
  const perms = () => new Permissions(() => ({ manifest, name: 'X', granted: { permissions: [], origins: [] } }));

  it('knows what is covered, including host patterns inside broader ones', () => {
    expect(patternCovers(['<all_urls>'], 'https://a.example/*')).toBe(true);
    expect(patternCovers(['https://*.example.com/*'], 'https://www.example.com/*')).toBe(true);
    expect(patternCovers(['https://a.example/*'], '<all_urls>')).toBe(false);
  });

  it('asks before granting an optional permission, and refuses ones not in the manifest', async () => {
    const ask = vi.fn(async () => true);
    const grant = vi.fn();
    const h = perms().handlers({ ask, grant, revoke: vi.fn(), warningsFor: () => ['Read and change your bookmarks'], emit: vi.fn() });
    expect(await h['permissions.contains'](ctx, [{ permissions: ['tabs'], origins: ['https://www.example.com/*'] }])).toBe(true);
    expect(await h['permissions.request'](ctx, [{ permissions: ['bookmarks'] }])).toBe(true);
    expect(ask).toHaveBeenCalledWith(ext, 'X', ['Read and change your bookmarks']);
    expect(grant).toHaveBeenCalledWith(ext, ['bookmarks'], []);
    await expect(Promise.resolve().then(() => h['permissions.request'](ctx, [{ permissions: ['history'] }]))).rejects.toThrow(/specified in the manifest/);
  });
});

describe('manifest', () => {
  it('names what an extension can do, in Chrome\'s words', () => {
    expect(permissionWarnings({ host_permissions: ['<all_urls>'], permissions: ['tabs', 'proxy'] }))
      .toEqual(['Read and change all your data on all websites', 'Read your browsing history', 'Change your proxy settings']);
    expect(permissionWarnings({ content_scripts: [{ matches: ['https://mail.google.com/*'] }] }))
      .toEqual(['Read and change your data on mail.google.com']);
  });

  it('reads __MSG_ names from its locales, and picks the right icon size', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-locale-'));
    fs.mkdirSync(path.join(dir, '_locales', 'en'), { recursive: true });
    fs.writeFileSync(path.join(dir, '_locales', 'en', 'messages.json'), JSON.stringify({ extName: { message: 'uBlock Origin Lite' } }));
    expect(localize('__MSG_extName__', dir, { default_locale: 'en' }, 'en-US')).toBe('uBlock Origin Lite');
    expect(pickIcon({ 16: 'a.png', 48: 'b.png', 128: 'c.png' }, 32)).toBe('b.png');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('the page right-click menu', () => {
  const base: ContextParams = {
    x: 10, y: 20, linkURL: '', linkText: '', srcURL: '', mediaType: 'none', hasImageContents: false, selectionText: '',
    isEditable: false, misspelledWord: '', dictionarySuggestions: [], pageURL: 'https://a.example/', frameURL: '',
    editFlags: { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: false, canSelectAll: true },
  };
  const actions = () => ({
    canGoBack: true, canGoForward: false, back: vi.fn(), forward: vi.fn(), reload: vi.fn(), openInNewTab: vi.fn(),
    copyText: vi.fn(), copyImageAt: vi.fn(), download: vi.fn(), search: vi.fn(), replaceMisspelling: vi.fn(),
    addToDictionary: vi.fn(), editCommand: vi.fn(), print: vi.fn(), inspect: vi.fn(), extensionClick: vi.fn(), extensionIcon: (): undefined => undefined,
  });
  const labels = (items: Electron.MenuItemConstructorOptions[]) => items.filter((i) => i.type !== 'separator').map((i) => i.label);

  it('offers back, forward and reload on the page itself', () => {
    const a = actions();
    const menu = pageContextMenu(base, a);
    expect(labels(menu)).toEqual(['Back', 'Forward', 'Reload', 'Print…', 'Copy page address', 'Inspect']);
    expect(menu.find((i) => i.label === 'Forward')?.enabled).toBe(false);
  });

  it('offers link actions on a link, and opens it in a new tab', () => {
    const a = actions();
    const menu = pageContextMenu({ ...base, linkURL: 'https://b.example/', linkText: 'B' }, a);
    expect(labels(menu)).toContain('Open link in new tab');
    (menu.find((i) => i.label === 'Open link in new tab')!.click as () => void)();
    expect(a.openInNewTab).toHaveBeenCalledWith('https://b.example/');
  });

  it('offers spelling fixes in a text field', () => {
    const a = actions();
    const menu = pageContextMenu({ ...base, isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten'] }, a);
    expect(labels(menu).slice(0, 3)).toEqual(['the', 'ten', 'Add to dictionary']);
    (menu[0].click as () => void)();
    expect(a.replaceMisspelling).toHaveBeenCalledWith('the');
  });

  it("adds extensions' items before Inspect", () => {
    const a = actions();
    const menu = pageContextMenu(base, a, [{ extensionId: ext, id: 'x', label: 'Save to Notes', type: 'normal', checked: false, enabled: true, children: [] }]);
    const l = labels(menu);
    expect(l[l.length - 2]).toBe('Save to Notes');
    expect(l[l.length - 1]).toBe('Inspect');
  });
});

describe('the Chrome Web Store bridge', () => {
  it('asks you, then installs through the manager', async () => {
    const manager = {
      isInstalling: () => false,
      get: vi.fn(() => null),
      installFromStore: vi.fn(async () => 'success' as const),
      list: (): never[] => [], summary: (): null => null, granted: () => ({ permissions: [] as string[], origins: [] as string[] }),
      setEnabled: vi.fn(), uninstall: vi.fn(),
    };
    const confirm = vi.fn(async () => true);
    const api = createStoreApi({ manager: manager as never, chromeVersion: '146.0.0.0', confirm, confirmRemove: async () => true });
    const result = await api('beginInstallWithManifest3', [{ id: ext, manifest: JSON.stringify({ name: 'Dark', host_permissions: ['<all_urls>'] }), localizedName: 'Dark Reader', iconUrl: 'https://lh3.googleusercontent.com/x' }]);
    expect(confirm).toHaveBeenCalledWith({ name: 'Dark Reader', warnings: ['Read and change all your data on all websites'], iconUrl: 'https://lh3.googleusercontent.com/x' });
    expect(manager.installFromStore).toHaveBeenCalledWith(ext, { confirmed: true });
    expect(result).toEqual({ result: 'success' });
  });

  it('reports a cancel and installs nothing', async () => {
    const manager = { isInstalling: () => false, get: (): null => null, installFromStore: vi.fn() };
    const api = createStoreApi({ manager: manager as never, chromeVersion: '1', confirm: async () => false, confirmRemove: async () => true });
    expect(await api('beginInstallWithManifest3', [{ id: ext, manifest: '{}' }])).toEqual({ result: 'user_cancelled' });
    expect(manager.installFromStore).not.toHaveBeenCalled();
  });

  it('tells the store which extensions are already here', async () => {
    const manager = { isInstalling: () => false, get: (id: string) => (id === ext ? { enabled: true } : null) };
    const api = createStoreApi({ manager: manager as never, chromeVersion: '1', confirm: async () => true, confirmRemove: async () => true });
    expect(await api('getExtensionStatus', [ext])).toBe('enabled');
    expect(await api('getExtensionStatus', ['b'.repeat(32)])).toBe('installable');
  });
});
