// @vitest-environment jsdom

/**
 * The New-tab page (docs/unify/PLAN.md §3.6): Tools one click away, and the
 * task's files — recent ones listed, any of them found by name — opening as
 * document tabs.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewTabPage } from '../../../../src/renderer/hub/workspace/NewTabPage';
import type { AgentSession } from '../../../../src/renderer/hub/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function session(): AgentSession {
  return {
    id: 's1',
    prompt: 'Make the Q3 report',
    status: 'stopped',
    createdAt: 0,
    output: [
      { type: 'file_output', name: 'Q3-report.docx', path: 'C:/out/Q3-report.docx', size: 10, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      { type: 'file_output', name: 'chart.png', path: 'C:/out/chart.png', size: 10, mime: 'image/png' },
      { type: 'file_output', name: 'notes.md', path: 'C:/out/notes.md', size: 10, mime: 'text/markdown' },
    ],
  } as unknown as AgentSession;
}

describe('NewTabPage', () => {
  let host: HTMLDivElement;
  let root: Root;
  let docOpen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    docOpen = vi.fn(() => Promise.resolve({}));
    (window as unknown as { electronAPI: unknown }).electronAPI = { workspace: { docOpen }, sessions: { openFile: vi.fn(() => Promise.resolve({})) } };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  const render = (props: Partial<React.ComponentProps<typeof NewTabPage>> = {}) => {
    act(() => { root.render(<NewTabPage session={session()} onOpen={() => {}} {...props} />); });
  };

  it('offers its tools, and Accounts opens Settings at that section', () => {
    const onOpenLogs = vi.fn();
    const opened: unknown[] = [];
    const listen = (e: Event) => opened.push((e as CustomEvent).detail);
    window.addEventListener('dex:open-settings', listen);
    render({ onOpenLogs });
    const labels = Array.from(host.querySelectorAll('.ws-ntp-tool__label')).map((l) => l.textContent);
    expect(labels).toEqual(['Find a file', 'Logs', 'Accounts']);
    act(() => (host.querySelectorAll('.ws-ntp-tool')[1] as HTMLButtonElement).click());
    expect(onOpenLogs).toHaveBeenCalled();
    act(() => (host.querySelectorAll('.ws-ntp-tool')[2] as HTMLButtonElement).click());
    expect(opened).toEqual(['settings-integrations']);
    window.removeEventListener('dex:open-settings', listen);
  });

  it('finds a task file by name and opens it as a document tab', async () => {
    render();
    const find = host.querySelector('.ws-ntp-find') as HTMLInputElement;
    expect(find.placeholder).toContain('3 files');
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(find, 'q3');
      find.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const rows = Array.from(host.querySelectorAll('.ws-ntp-file__name')).map((n) => n.textContent);
    expect(rows).toEqual(['Q3-report.docx']);
    await act(async () => (host.querySelector('.ws-ntp-file') as HTMLButtonElement).click());
    expect(docOpen).toHaveBeenCalledWith('s1', 'C:/out/Q3-report.docx');
  });
});
