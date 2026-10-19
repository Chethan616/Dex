/**
 * The agent's side of extensions (ExtensionHost agentList / agentPress /
 * agentMenu, used by `dex-ext`): what it sees, what pressing a button does,
 * right-click items, and which extensions stay in the user's hands. Run on a
 * stand-in for the host, so no Electron browser is needed.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ WebContentsView: class {}, Notification: class {}, nativeImage: {}, webContents: {}, webFrameMain: {}, session: {}, app: { getPath: () => '' } }));

import { ExtensionHost } from '../../../src/main/extensions/ExtensionHost';
import { MenuStore } from '../../../src/main/extensions/menusApi';
import { extensionsBriefing, setExtensionsForPrompt } from '../../../src/main/hl/engines/extensions';

const ZOTERO = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PROXY = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const BITWARDEN = 'cccccccccccccccccccccccccccccccc';

function standIn() {
  const menus = new MenuStore();
  menus.create(ZOTERO, { id: 'save', title: 'Save to Zotero', contexts: ['page'] });
  menus.create(ZOTERO, { id: 'save-link', title: 'Save link to Zotero', contexts: ['link'] });
  menus.create(BITWARDEN, { id: 'fill', title: 'Autofill', contexts: ['page'] });
  const states: Record<string, { title?: string; popup?: string; badgeText?: string; enabled?: boolean }> = {
    [ZOTERO]: { title: 'Save to Zotero', popup: 'popup.html' },
    [PROXY]: { title: 'Access via library' },
    [BITWARDEN]: { title: 'Bitwarden', popup: 'popup/index.html' },
  };
  const summary = (id: string, name: string, hostPermissions: string[]) => ({ id, name, description: `${name} does things`, enabled: true, loaded: true, hostPermissions, optionsUrl: null as string | null });
  const emitted: unknown[] = [];
  const pageWc = { id: 11, isDestroyed: () => false, getURL: () => 'https://journals.example.org/article/42' };
  const host = Object.create(ExtensionHost.prototype) as ExtensionHost & Record<string, unknown>;
  Object.assign(host, {
    menus,
    activeTab: new Map<string, Set<number>>(),
    actions: { stateFor: (id: string) => states[id] ?? {} },
    platform: { sidePanelFor: () => ({ enabled: false, openOnAction: false }) },
    tabsApi: { tabFor: (_id: string, tabId: number) => ({ id: tabId }) },
    emit: (...args: unknown[]) => { emitted.push(args); },
    nameOf: (id: string) => ({ [ZOTERO]: 'Zotero Connector', [PROXY]: 'VIT Library Access', [BITWARDEN]: 'Bitwarden Password Manager' })[id] ?? id,
    menuClicked: vi.fn(),
    deps: {
      manager: { list: () => [summary(ZOTERO, 'Zotero Connector', ['<all_urls>']), summary(PROXY, 'VIT Library Access', ['https://*.vit.ac.in/*', '*://*.sciencedirect.com/*']), summary(BITWARDEN, 'Bitwarden Password Manager', ['<all_urls>'])] },
      tabs: { windows: () => [{ sessionId: 's1', tabs: [{ active: true, wc: pageWc }] }] },
    },
  });
  return { host, emitted };
}

describe('extensions, as the agent sees them', () => {
  it('lists what each does, its button, where it runs and its menu items here; marks the password manager off limits', () => {
    const { host } = standIn();
    const list = host.agentList('s1');
    expect(list.map((e) => e.name)).toEqual(['Zotero Connector', 'VIT Library Access', 'Bitwarden Password Manager']);
    expect(list[0]).toMatchObject({ button: { title: 'Save to Zotero', opens: 'popup', enabled: true }, runsOn: ['every site'], menu: ['Save to Zotero'], offLimits: null });
    expect(list[1]).toMatchObject({ button: { opens: 'acts on the page' }, runsOn: ['*.vit.ac.in', '*.sciencedirect.com'] });
    expect(list[2]).toMatchObject({ offLimits: 'password manager', menu: [] });
  });

  it('a button with a popup gives its page (opened as a tab by main); one without acts on the page', () => {
    const { host, emitted } = standIn();
    expect(host.agentPress(ZOTERO, 's1')).toEqual({ kind: 'popup', url: `chrome-extension://${ZOTERO}/popup.html` });
    expect((host as unknown as { activeTab: Map<string, Set<number>> }).activeTab.get(ZOTERO)).toEqual(new Set([11]));
    expect(emitted).toHaveLength(0);
    expect(host.agentPress(PROXY, 's1')).toEqual({ kind: 'clicked' });
    expect(emitted).toEqual([[PROXY, 'action.onClicked', [{ id: 11 }], { wake: true }]]);
  });

  it('right-click items for the page or a link, never a password manager\'s; picking one clicks it on the page', () => {
    const { host } = standIn();
    expect(host.agentMenu('s1').map((m) => m.path)).toEqual(['Save to Zotero']);
    // On a link, as in Chrome, the link's items replace the page's.
    expect(host.agentMenu('s1', { linkUrl: 'https://example.org/paper.pdf' }).map((m) => m.path)).toEqual(['Save link to Zotero']);
    expect(host.agentMenuClick('s1', ZOTERO, 'save-link', { linkUrl: 'https://example.org/paper.pdf' })).toBe(true);
    const [entry, target, tabId] = (host.menuClicked as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(entry).toMatchObject({ id: 'save-link', extensionId: ZOTERO });
    expect(target).toMatchObject({ pageUrl: 'https://journals.example.org/article/42', linkUrl: 'https://example.org/paper.pdf' });
    expect(tabId).toBe(11);
    expect(host.agentMenuClick('s1', BITWARDEN, 'fill')).toBe(true); // the host can; main's dex-ext refuses it by name first
  });

  it('password managers and wallets stay the user\'s', () => {
    expect(ExtensionHost.offLimits('Bitwarden Password Manager')).toBe('password manager');
    expect(ExtensionHost.offLimits('MetaMask')).toBe('wallet');
    expect(ExtensionHost.offLimits('Phantom')).toBe('wallet');
    expect(ExtensionHost.offLimits('Zotero Connector')).toBeNull();
    expect(ExtensionHost.agentMayUse(`chrome-extension://${ZOTERO}/popup.html`, 'Zotero Connector')).toBe(true);
    expect(ExtensionHost.agentMayUse(`chrome-extension://${ZOTERO}/home.html`, 'MetaMask')).toBe(false);
    expect(ExtensionHost.agentMayUse('https://example.org/', 'MetaMask')).toBe(true);
  });
});

describe('the extensions line in every prompt', () => {
  it('names what\'s installed, keeps the off-limits ones out of reach, and points at dex-ext', () => {
    setExtensionsForPrompt(() => [
      { name: 'Zotero Connector', description: 'Save references to Zotero from your web browser', offLimits: null },
      { name: 'Bitwarden', description: 'A secure password manager', offLimits: 'password manager' },
    ]);
    const [line] = extensionsBriefing();
    expect(line).toContain('Zotero Connector (Save references to Zotero from your web browser)');
    expect(line).toContain('Bitwarden (password manager) stays the user\'s: never use it.');
    expect(line).toContain('dex-ext click <name>');
    expect(line).toContain('dex-ext install');
  });

  it('with none installed, still says how to add one a site needs', () => {
    setExtensionsForPrompt(() => []);
    expect(extensionsBriefing()[0]).toMatch(/No Chrome extensions are installed[\s\S]*dex-ext install/);
  });
});
