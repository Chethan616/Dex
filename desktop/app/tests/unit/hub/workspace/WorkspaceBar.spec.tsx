// @vitest-environment jsdom

/**
 * The toolbar's page tools (docs/unify/PLAN.md §3.2 #5): find in page, the
 * zoom pill, and the ⋯ menu.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceBar, findCount } from '../../../../src/renderer/hub/workspace/WorkspaceBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function tab(over: Partial<WorkspaceTab> = {}): WorkspaceTab {
  return {
    id: 't1', url: 'https://example.com/', title: 'Example', faviconUrl: null, loading: false,
    canGoBack: false, canGoForward: false, active: true, openedBy: 'task', isNewTab: false,
    crashed: false, temporary: false, zoom: 100, ...over,
  };
}

function setInput(el: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('WorkspaceBar page tools', () => {
  let host: HTMLDivElement;
  let root: Root;
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let openFind: (sessionId: string) => void;
  let reportFound: (sessionId: string, tabId: string, result: { active: number; matches: number }) => void;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    api = {
      tab: vi.fn(async () => true),
      shortcut: vi.fn(async () => true),
      onFocusAddress: vi.fn(() => () => {}),
      pageMenu: vi.fn(async () => true),
      find: vi.fn(async () => true),
      onFind: vi.fn((cb) => { openFind = cb; return () => {}; }),
      onFound: vi.fn((cb) => { reportFound = cb; return () => {}; }),
    };
    (window as unknown as { electronAPI: unknown }).electronAPI = { workspace: api };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  const render = (tabs: WorkspaceTab[], chatActive = false) => {
    act(() => {
      root.render(
        <WorkspaceBar
          sessionId="s1"
          tabs={tabs}
          agentActive={false}
          chat={{ active: chatActive, unread: false, working: false, onSelect: () => {} }}
        />,
      );
    });
  };

  it('opens find on Ctrl+F, searches as you type, steps with Enter, and closes with Esc', async () => {
    render([tab()]);
    expect(host.querySelector('.ws-find')).toBeNull();
    act(() => openFind('s1'));
    const input = host.querySelector('.ws-find__input') as HTMLInputElement;
    expect(input).not.toBeNull();

    act(() => setInput(input, 'resnet'));
    expect(api.find).toHaveBeenLastCalledWith('s1', { tabId: 't1', text: 'resnet' });
    act(() => reportFound('s1', 't1', { active: 2, matches: 7 }));
    expect(host.querySelector('.ws-find__count')!.textContent).toBe('2 of 7');

    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })); });
    expect(api.find).toHaveBeenLastCalledWith('s1', { tabId: 't1', text: 'resnet', next: true, forward: false });

    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(api.find).toHaveBeenLastCalledWith('s1', { tabId: 't1', stop: true });
    expect(host.querySelector('.ws-find')).toBeNull();
  });

  it('ignores Ctrl+F for another task, and while the chat is in front', () => {
    render([tab()], true);
    act(() => openFind('s1'));
    render([tab()], false);
    expect(host.querySelector('.ws-find')).toBeNull();
    act(() => openFind('s2'));
    expect(host.querySelector('.ws-find')).toBeNull();
  });

  it('ends the search when you switch tabs', () => {
    render([tab()]);
    act(() => openFind('s1'));
    render([tab({ active: false }), tab({ id: 't2', active: true })]);
    expect(host.querySelector('.ws-find')).toBeNull();
    expect(api.find).toHaveBeenLastCalledWith('s1', { tabId: 't1', stop: true });
  });

  it('shows the zoom only when it isn’t 100%, and a click puts it back', () => {
    render([tab()]);
    expect(host.querySelector('.ws-address__zoom')).toBeNull();
    render([tab({ zoom: 125 })]);
    const pill = host.querySelector('.ws-address__zoom') as HTMLButtonElement;
    expect(pill.textContent).toBe('125%');
    act(() => pill.click());
    expect(api.shortcut).toHaveBeenCalledWith('s1', 'zoom-reset');
  });

  it('opens the ⋯ menu for the tab in front, at the button', () => {
    render([tab({ active: false }), tab({ id: 't2', active: true })]);
    act(() => (host.querySelector('.ws-more') as HTMLButtonElement).click());
    expect(api.pageMenu).toHaveBeenCalledWith('s1', 't2', expect.any(Number), expect.any(Number));
  });

  it('counts matches in words', () => {
    expect(findCount('', { active: 1, matches: 3 })).toBe('');
    expect(findCount('x', null)).toBe('');
    expect(findCount('x', { active: 0, matches: 0 })).toBe('No matches');
    expect(findCount('x', { active: 3, matches: 12 })).toBe('3 of 12');
  });
});
