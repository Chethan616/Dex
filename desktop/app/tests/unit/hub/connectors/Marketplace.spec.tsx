// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MARKET_ITEMS, Marketplace } from '../../../../src/renderer/hub/connectors/Marketplace';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('the Marketplace', () => {
  let host: HTMLDivElement;
  let root: Root;
  let api: Record<string, Record<string, ReturnType<typeof vi.fn>>>;
  let viewsSetVisible: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    viewsSetVisible = vi.fn(async () => {});
    api = {
      connectors: {
        list: vi.fn(async () => [{ id: 'notion', connected: true, toolCount: 14 }, { id: 'kiwi', connected: false, toolCount: 0 }]),
        connect: vi.fn(async () => ({ ok: true, toolNames: ['search-flight'] })),
        cancel: vi.fn(async () => {}),
        disconnect: vi.fn(async () => {}),
      },
      accounts: {
        list: vi.fn(async () => [{ provider: 'google', connected: true, available: true }, { provider: 'slack', connected: false, available: false, devBuild: true }, { provider: 'reddit', connected: false, available: false, devBuild: false }]),
        connect: vi.fn(async () => ({ ok: true })),
        cancel: vi.fn(async () => {}),
        disconnect: vi.fn(async () => {}),
      },
    };
    (window as unknown as { electronAPI: unknown }).electronAPI = { settings: api, sessions: { viewsSetVisible } };
    try { window.localStorage.clear(); } catch { /* none */ }
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  const render = async (props: Partial<React.ComponentProps<typeof Marketplace>> = {}) => {
    const onClose = vi.fn();
    await act(async () => { root.render(<Marketplace onClose={onClose} {...props} />); });
    return onClose;
  };
  const names = (scope: ParentNode) => [...scope.querySelectorAll('.mk__name')].map((n) => n.textContent);
  const section = (title: string) => [...host.querySelectorAll('.mk__section')].find((s) => s.querySelector('.mk__heading')?.textContent === title)!;

  it('gets the live pages out of the way, and shows what’s installed', async () => {
    await render();
    expect(viewsSetVisible).toHaveBeenCalledWith(false);
    expect(host.querySelector('.mk__installed')?.textContent).toContain('2 installed');
    const notion = [...host.querySelectorAll('.mk__item')].find((i) => i.querySelector('.mk__name')?.textContent === 'Notion')!;
    expect(notion.querySelector('.mk__added')).not.toBeNull();
    expect(names(section('Featured'))).toEqual(expect.arrayContaining(['Google', 'Notion', 'Jira & Confluence', 'Canva', 'Kiwi.com flights', 'PubMed']));
    expect(names(section('Research & health'))).toContain('PubMed');
  });

  it('suggests by who you are', async () => {
    await render();
    const doctors = [...host.querySelectorAll<HTMLButtonElement>('.mk__audience')].find((b) => b.textContent === 'Doctors & science')!;
    act(() => doctors.click());
    expect(names(section('For you'))).toContain('PubMed');
    expect(window.localStorage.getItem('dex.market.audience')).toBe('doctor');
  });

  it('finds connectors by name or what they do, and connects one', async () => {
    await render();
    const search = host.querySelector('.mk__search input') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'flight');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(names(section('Results'))).toEqual(['Kiwi.com flights']);
    const add = section('Results').querySelector('.mk__btn') as HTMLButtonElement;
    expect(add.textContent).toBe('Add');
    await act(async () => add.click());
    expect(api.connectors.connect).toHaveBeenCalledWith('kiwi');
    expect(api.connectors.list).toHaveBeenCalledTimes(2);
  });

  it('greys out a sign-in a dev build can’t do, and leaves it out of a release', async () => {
    await render();
    const slack = [...host.querySelectorAll('.mk__item')].find((i) => i.querySelector('.mk__name')?.textContent === 'Slack')!;
    expect((slack.querySelector('.mk__btn') as HTMLButtonElement).disabled).toBe(true);
    expect(names(host)).not.toContain('Reddit');
  });

  it('opens a connector’s page, and the installed list where you can remove one', async () => {
    await render();
    const open = [...host.querySelectorAll<HTMLButtonElement>('.mk__item-open')].find((b) => b.textContent?.includes('Canva'))!;
    act(() => open.click());
    expect(host.querySelector('.mk__detail-name')?.textContent).toBe('Canva');
    expect(host.querySelector('.mk__detail-how')?.textContent).toContain('in your browser');
    act(() => (host.querySelector('.mk__back') as HTMLButtonElement).click());

    act(() => (host.querySelector('.mk__installed') as HTMLButtonElement).click());
    expect(names(host)).toEqual(['Google', 'Notion']);
    expect(host.textContent).toContain('14 tools');
    await act(async () => ([...host.querySelectorAll<HTMLButtonElement>('.mk__btn')].find((b) => b.closest('.mk__installed-row')?.textContent?.includes('Notion'))!).click());
    expect(api.connectors.disconnect).toHaveBeenCalledWith('notion');
  });

  it('shows every connector with its own logo', async () => {
    expect(MARKET_ITEMS.filter((i) => !i.logo).map((i) => i.key)).toEqual([]);
    await render();
    const notion = [...host.querySelectorAll('.mk__item')].find((i) => i.querySelector('.mk__name')?.textContent === 'Notion')!;
    // Small logos are inlined as data URLs; the file's <title> names the brand.
    expect(decodeURIComponent(notion.querySelector('.mk-mark--logo img')?.getAttribute('src') ?? '')).toMatch(/<title>Notion<\/title>|notion\.svg/);
  });

  it('shows GitHub’s sign-in code while it waits for it', async () => {
    let progress: ((event: AccountProgressEvent) => void) | undefined;
    api.accounts.onProgress = vi.fn((cb: (event: AccountProgressEvent) => void) => { progress = cb; return () => {}; });
    api.accounts.connect = vi.fn(() => new Promise(() => {}));
    await render();
    const github = () => [...host.querySelectorAll('.mk__item')].find((i) => i.querySelector('.mk__name')?.textContent === 'GitHub')!;
    act(() => (github().querySelector('.mk__btn') as HTMLButtonElement).click());
    act(() => progress?.({ provider: 'github', phase: 'code', userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device' }));
    expect(github().querySelector('.mk__code')?.textContent).toBe('WDJB-MJHT');
  });

  it('closes on Esc', async () => {
    const onClose = await render();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalled();
  });
});
