// @vitest-environment jsdom

/**
 * Document tabs in the hub (docs/unify/PLAN.md §3.9): the DocumentView reads
 * a file through sessions.readFile and draws it with its kind's viewer; links
 * inside never navigate the hub; a new revision reloads it. The WorkspaceBar
 * shows document tabs after Chat, and hides the browser toolbar while one is
 * in front.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentView } from '../../../../src/renderer/hub/workspace/docs/DocumentView';
import { WorkspaceBar } from '../../../../src/renderer/hub/workspace/WorkspaceBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const enc = new TextEncoder();
// The first render of a kind loads its viewer chunk; slow under a full run.
const LOAD = { timeout: 10_000, interval: 25 };

function doc(overrides: Partial<WorkspaceDoc> = {}): WorkspaceDoc {
  return { id: 'd1', path: 'C:/work/notes.md', name: 'notes.md', openedBy: 'agent', openedAt: 1, size: 120, mtimeMs: 1, ...overrides };
}

describe('DocumentView', () => {
  // The first test to open a viewer pays for compiling it (react-markdown is
  // big); a cold run took 9 s. Warm the chunks once, outside any test's wait.
  beforeAll(async () => {
    await Promise.all([
      import('../../../../src/renderer/hub/workspace/docs/TextView'),
      import('../../../../src/renderer/hub/workspace/docs/MediaView'),
    ]);
  }, 60_000);

  let host: HTMLDivElement;
  let root: Root;
  let files: Record<string, string>;
  let readFile: ReturnType<typeof vi.fn>;
  let openFile: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    try { window.localStorage.clear(); } catch { /* none */ }
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    files = {};
    readFile = vi.fn(async (_id: string, p: string) => {
      if (!(p in files)) throw new Error('refused: not a file this task produced');
      const bytes = enc.encode(files[p]);
      return { bytes, size: bytes.length, mtimeMs: 1 };
    });
    openFile = vi.fn(async () => ({ opened: true }));
    (window as unknown as { electronAPI: unknown }).electronAPI = { sessions: { readFile, openFile } };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  const render = async (el: React.ReactElement) => {
    await act(async () => { root.render(el); });
  };

  it('draws Markdown, with its headings as the outline', async () => {
    files['C:/work/notes.md'] = '# Plan\n\nSome text.\n\n## Risks\n\nMore.';
    await render(<DocumentView sessionId="s1" doc={doc()} revision={0} onOpenUrl={() => {}} />);
    await vi.waitFor(() => expect(host.querySelector('.dv-md h1')?.textContent).toBe('Plan'), LOAD);
    expect(readFile).toHaveBeenCalledWith('s1', 'C:/work/notes.md');
    expect(host.querySelector('.dv-crumbs__name')?.textContent).toBe('notes.md');
    expect(host.querySelector('.dv-bar__meta')?.textContent).toContain('opened by DEX');

    // The outline arrives a render after the headings do.
    await vi.waitFor(() => expect(host.querySelector('button[aria-label="Outline"]')).not.toBeNull(), LOAD);
    const outlineBtn = host.querySelector('button[aria-label="Outline"]') as HTMLButtonElement;
    await act(async () => { outlineBtn.click(); });
    const items = Array.from(host.querySelectorAll('.dv-outline__item')).map((b) => b.textContent);
    expect(items).toEqual(['Plan', 'Risks']);
  });

  it('opens web links in a workspace tab and never lets a document navigate the hub', async () => {
    files['C:/work/notes.md'] = '[site](https://example.com/a) and [bad](javascript:alert(1)) and [here](#plan)';
    const onOpenUrl = vi.fn();
    await render(<DocumentView sessionId="s1" doc={doc()} revision={0} onOpenUrl={onOpenUrl} />);
    await vi.waitFor(() => expect(host.querySelectorAll('.dv-md a').length).toBeGreaterThan(0), LOAD);
    const links = Array.from(host.querySelectorAll('.dv-md a')) as HTMLAnchorElement[];

    const click = (a: HTMLAnchorElement) => {
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
      a.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(click(links[0])).toBe(true);
    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com/a');
    for (const a of links.slice(1)) expect(click(a)).toBe(true);
    expect(onOpenUrl).toHaveBeenCalledTimes(1);
  });

  it('shows text with line numbers, and reloads when the file changes', async () => {
    const d = doc({ id: 'd2', path: 'C:/work/run.log', name: 'run.log' });
    files[d.path] = 'one\ntwo';
    await render(<DocumentView sessionId="s1" doc={d} revision={0} onOpenUrl={() => {}} />);
    await vi.waitFor(() => expect(host.querySelector('.dv-text__code')?.textContent).toBe('one\ntwo'), LOAD);
    expect(host.querySelector('.dv-text__gutter')?.textContent).toBe('1\n2');

    files[d.path] = 'one\ntwo\nthree';
    await render(<DocumentView sessionId="s1" doc={d} revision={1} onOpenUrl={() => {}} />);
    await vi.waitFor(() => expect(host.querySelector('.dv-text__code')?.textContent).toBe('one\ntwo\nthree'), LOAD);
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it('zooms with the bar and Ctrl+0 resets it', async () => {
    const d = doc({ id: 'd3', path: 'C:/work/a.txt', name: 'a.txt' });
    files[d.path] = 'x';
    await render(<DocumentView sessionId="s1" doc={d} revision={0} onOpenUrl={() => {}} />);
    await vi.waitFor(() => expect(host.querySelector('.dv-text')).not.toBeNull(), LOAD);
    const label = () => host.querySelector('.dv-zoom__label')?.textContent;
    await act(async () => { (host.querySelector('button[aria-label^="Zoom in"]') as HTMLButtonElement).click(); });
    expect(label()).toBe('110%');
    await act(async () => {
      host.querySelector('.dv')!.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true, bubbles: true }));
    });
    expect(label()).toBe('100%');
  });

  it('shows Markdown as its source on "View source", and back', async () => {
    files['C:/work/notes.md'] = '# Plan';
    await render(<DocumentView sessionId="s1" doc={doc()} revision={0} onOpenUrl={() => {}} />);
    await vi.waitFor(() => expect(host.querySelector('.dv-md h1')?.textContent).toBe('Plan'), LOAD);
    const toggle = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'View source') as HTMLButtonElement;
    await act(async () => { toggle.click(); });
    await vi.waitFor(() => expect(host.querySelector('.dv-text__code')?.textContent).toBe('# Plan'), LOAD);
    await act(async () => { toggle.click(); });
    await vi.waitFor(() => expect(host.querySelector('.dv-md h1')).not.toBeNull(), LOAD);
  });

  it('lists the task’s files beside the document and opens one on click', async () => {
    files['C:/work/notes.md'] = 'x';
    const onOpenFile = vi.fn();
    const taskFiles = [{ name: 'notes.md', path: 'C:/work/notes.md' }, { name: 'data.csv', path: 'C:/work/data/data.csv' }];
    await render(<DocumentView sessionId="s1" doc={doc()} revision={0} onOpenUrl={() => {}} files={taskFiles} onOpenFile={onOpenFile} />);
    // Two files: the panel starts open, with the open document marked.
    const rail = host.querySelector('.dv-files')!;
    expect(rail).not.toBeNull();
    expect(rail.querySelector('.dv-files__item--on')?.textContent).toContain('notes.md');
    const csv = Array.from(rail.querySelectorAll('.dv-files__item')).find((b) => b.textContent?.includes('data.csv')) as HTMLButtonElement;
    await act(async () => { csv.click(); });
    expect(onOpenFile).toHaveBeenCalledWith('C:/work/data/data.csv');
    // The breadcrumb shows where the file is.
    expect(host.querySelector('.dv-crumbs')?.textContent).toContain('work');
  });

  it('offers the file’s own app when it can’t draw it, or main refuses it', async () => {
    await render(<DocumentView sessionId="s1" doc={doc({ id: 'd4', path: 'C:/work/x.zip', name: 'x.zip' })} revision={0} onOpenUrl={() => {}} />);
    expect(host.querySelector('.dv-fallback__msg')?.textContent).toContain('can’t draw');
    expect(readFile).not.toHaveBeenCalled();
    await act(async () => { (host.querySelector('.dv-fallback .dv-chip--on') as HTMLButtonElement).click(); });
    expect(openFile).toHaveBeenCalledWith('s1', 'C:/work/x.zip', 'open');

    await render(<DocumentView sessionId="s1" doc={doc({ id: 'd5', path: 'C:/elsewhere/secret.txt', name: 'secret.txt' })} revision={0} onOpenUrl={() => {}} />);
    await vi.waitFor(() => expect(host.querySelector('.dv-fallback__msg')?.textContent).toContain('refused'), LOAD);
  });
});

describe('WorkspaceBar document tabs', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    (window as unknown as { electronAPI: unknown }).electronAPI = { workspace: { tab: vi.fn(), onFocusAddress: () => () => {} } };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  const webTab = { id: 't1', url: 'https://example.com/', title: 'Example', active: true, loading: false, canGoBack: false, canGoForward: false, isNewTab: false, openedBy: 'task' } as unknown as WorkspaceTab;

  it('lists docs after Chat, marks the one in front, and hides the browser toolbar for it', async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const docs = [doc(), doc({ id: 'd2', name: 'data.csv', path: 'C:/work/data.csv', openedBy: 'user' })];
    await act(async () => {
      root.render(
        <WorkspaceBar
          sessionId="s1"
          tabs={[webTab]}
          agentActive={false}
          chat={{ active: false, unread: false, working: false, onSelect: () => {} }}
          docs={{ items: docs, activeId: 'd2', onSelect, onClose }}
        />,
      );
    });
    const titles = Array.from(host.querySelectorAll('.ws-tab .ws-tab__title')).map((t) => t.textContent);
    expect(titles).toEqual(['Chat', 'notes.md', 'data.csv', 'Example']);
    const active = Array.from(host.querySelectorAll('.ws-tab--active .ws-tab__title')).map((t) => t.textContent);
    expect(active).toEqual(['data.csv']);
    expect(host.querySelector('.ws-toolbar')).toBeNull();

    const first = host.querySelectorAll('.ws-tab--doc')[0] as HTMLElement;
    await act(async () => { first.click(); });
    expect(onSelect).toHaveBeenCalledWith('d1');
    await act(async () => { (first.querySelector('.ws-tab__close') as HTMLButtonElement).click(); });
    expect(onClose).toHaveBeenCalledWith('d1');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('shows the toolbar again when the page is in front, and no web chrome without a browser', async () => {
    await act(async () => {
      root.render(<WorkspaceBar sessionId="s1" tabs={[webTab]} agentActive={false} docs={{ items: [doc()], activeId: null, onSelect: () => {}, onClose: () => {} }} />);
    });
    expect(host.querySelector('.ws-toolbar')).not.toBeNull();
    expect(host.querySelector('.ws-newtab')).not.toBeNull();

    await act(async () => {
      root.render(<WorkspaceBar sessionId="s1" tabs={[]} browser={false} agentActive={false} docs={{ items: [doc()], activeId: 'd1', onSelect: () => {}, onClose: () => {} }} />);
    });
    expect(host.querySelector('.ws-toolbar')).toBeNull();
    expect(host.querySelector('.ws-newtab')).toBeNull();
    expect(host.querySelectorAll('.ws-tab').length).toBe(1);
  });
});
