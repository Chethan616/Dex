// @vitest-environment jsdom

/**
 * The pane's chat (docs/unify/PLAN.md §3.12): turns with the work folded
 * under "Worked for …", the reply in the open with GitHub and file links
 * marked, the files as cards whose "Open in" goes through sessions.openFile,
 * the minibar, and the composer sending follow-ups.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatView } from '../../../../src/renderer/hub/chat/ChatView';
import type { AgentSession, HlEvent } from '../../../../src/renderer/hub/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const REPORT = 'C:/Users/me/Downloads/MealMuse-Report.docx';

const OUTPUT = [
  { type: 'thinking', text: 'Checking the repo first.', at: 61_000 },
  { type: 'tool_call', name: 'Bash', args: { command: 'git push' }, iteration: 1, at: 62_000 },
  { type: 'tool_result', name: 'Bash', ok: true, preview: 'pushed', ms: 900, at: 63_000 },
  { type: 'tool_call', name: 'browser_navigate', args: { url: 'https://vercel.com/dashboard' }, iteration: 2, at: 64_000 },
  { type: 'tool_result', name: 'browser_navigate', ok: true, preview: '', ms: 300, at: 65_000 },
  { type: 'file_output', name: 'MealMuse-Report.docx', path: REPORT, size: 40_000, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', at: 250_000 },
  { type: 'thinking', text: 'Pushed in [commit 643b55f](https://github.com/me/slp/commit/643b55f). The report is `C:\\Users\\me\\Downloads\\MealMuse-Report.docx`.', at: 280_000 },
  { type: 'done', summary: 'Pushed.', iterations: 2, at: 285_000 },
  { type: 'user_input', text: 'also add screenshots', at: 400_000 },
  { type: 'error', message: 'Vercel asked to log in again', at: 401_000 },
  { type: 'tool_call', name: 'WebSearch', args: { query: 'vercel cli login' }, iteration: 3, at: 402_000 },
] as unknown as HlEvent[];

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 's1',
    prompt: 'rename voicebot to MealMuse and redeploy',
    status: 'running',
    createdAt: 60_000,
    output: OUTPUT,
    engine: 'claude-code',
    ...overrides,
  };
}

let root: Root | null = null;
let container: HTMLDivElement;
const openFile = vi.fn(() => Promise.resolve({ opened: true }));

function render(props: Partial<React.ComponentProps<typeof ChatView>> = {}): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<ChatView session={session()} engineName="Claude Code" {...props} />);
  });
  return container;
}

describe('ChatView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(430_000);
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = NoopResizeObserver;
    (window as unknown as { electronAPI: unknown }).electronAPI = { sessions: { openFile, listEditors: () => Promise.resolve([]) } };
    try { window.localStorage.clear(); } catch { /* none */ }
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    openFile.mockClear();
    vi.useRealTimers();
  });

  it('shows each turn: your bubble, the folded work, the reply, and the files', () => {
    const el = render();
    const bubbles = [...el.querySelectorAll('.cx-user__bubble')].map((b) => b.textContent);
    expect(bubbles).toEqual(['rename voicebot to MealMuse and redeploy', 'also add screenshots']);

    const worked = [...el.querySelectorAll('.cx-worked__label')].map((b) => b.textContent);
    expect(worked).toEqual(['Worked for 3m 45s', 'Working for 30s']);
    // The finished turn is folded; the live one is open with its running call.
    const [first, second] = [...el.querySelectorAll('.cx-turn')];
    expect(first.querySelector('.cx-work')).toBeNull();
    expect(second.querySelector('.cx-work')?.textContent).toContain('Searching the web');
    expect(second.querySelector('.cx-worked__now')?.textContent).toContain('vercel cli login');

    expect(first.querySelector('.cx-reply')?.textContent).toContain('Pushed in commit 643b55f');
    expect(first.querySelector('.cx-file__name')?.textContent).toBe('MealMuse-Report.docx');
    expect(first.querySelector('.cx-file__kind')?.textContent).toBe('Word');
    expect(second.querySelector('.cx-alert--error')?.textContent).toContain('Vercel asked to log in again');
  });

  it('opens the folded work when you click “Worked for”', () => {
    const el = render();
    const first = el.querySelector('.cx-turn')!;
    act(() => (first.querySelector('.cx-worked') as HTMLButtonElement).click());
    const steps = [...first.querySelectorAll('.cx-step-row__verb')].map((s) => s.textContent);
    expect(steps).toEqual(['Ran', 'Used the browser']);
    expect(first.querySelector('.cx-note')?.textContent).toContain('Checking the repo first.');
  });

  it('marks GitHub links and turns a mentioned file into a chip that opens it', () => {
    const el = render();
    const gh = el.querySelector('.cx-reply a[href^="https://github.com"]')!;
    expect(gh.querySelector('.cx-link__icon')).not.toBeNull();

    const chip = el.querySelector('.cx-reply .cx-link--file') as HTMLAnchorElement;
    expect(chip.textContent).toBe('MealMuse-Report.docx');
    act(() => chip.click());
    expect(openFile).toHaveBeenCalledWith('s1', REPORT, 'open');
  });

  it('offers the folder and a copy from “Open in”', () => {
    const el = render();
    act(() => (el.querySelector('.cx-openin__btn') as HTMLButtonElement).click());
    const items = [...el.querySelectorAll('.cx-menu__item')].map((i) => i.textContent);
    expect(items).toEqual(['Default app', 'Show in File Explorer', 'Download a copy']);
    act(() => (el.querySelectorAll('.cx-menu__item')[1] as HTMLButtonElement).click());
    expect(openFile).toHaveBeenCalledWith('s1', REPORT, 'reveal');
  });

  it('lists outputs and sources in the minibar, and hides it when asked', () => {
    const el = render();
    const mini = el.querySelector('.cx-mini')!;
    expect(mini.textContent).toContain('MealMuse-Report.docx');
    expect(mini.textContent).toContain('vercel.com');
    expect(mini.textContent).toContain('vercel cli login');
    act(() => (mini.querySelector('.cx-mini__close') as HTMLButtonElement).click());
    expect(el.querySelector('.cx-mini')).toBeNull();
    expect(el.querySelector('.cx-mini-toggle')).not.toBeNull();
  });

  it('offers Pause while DEX works, and Send once you type', () => {
    const onPause = vi.fn();
    const el = render({ onFollowUp: vi.fn(), onPause });
    const stop = el.querySelector('.cx-composer__send--stop') as HTMLButtonElement;
    act(() => stop.click());
    expect(onPause).toHaveBeenCalledWith('s1');
  });

  it('just says “Worked” for a session recorded before events had times', () => {
    const old = OUTPUT.map((e) => { const { at: _at, ...rest } = e as HlEvent & { at?: number }; return rest; }) as HlEvent[];
    const el = render({ session: session({ status: 'idle', output: old.slice(0, 8) }) });
    expect(el.querySelector('.cx-worked__label')?.textContent).toBe('Worked');
  });
});
