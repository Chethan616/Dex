// @vitest-environment jsdom

/**
 * The Subagents tab's surface: Active/Done lists (name, live activity line,
 * elapsed/"…ago"), and clicking a row opens that subagent's own transcript.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubagentsPane } from '../../../../src/renderer/hub/workspace/SubagentsPane';
import type { Subagent } from '../../../../src/shared/subagents';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function subagent(overrides: Partial<Subagent> = {}): Subagent {
  return {
    id: 's1',
    name: 'Pdf selection review',
    subagentType: 'general-purpose',
    prompt: 'Review the PDF selection handling and file fixes.',
    status: 'done',
    ok: true,
    summary: 'Filed two fixes: dialog labels and dismiss affordance.',
    startedAt: 400_000,
    endedAt: 460_000,
    steps: [],
    ...overrides,
  };
}

let root: Root | null = null;
let container: HTMLDivElement;

function render(subagents: Subagent[]): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<SubagentsPane subagents={subagents} />); });
  return container;
}

describe('SubagentsPane', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(500_000);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('splits subagents into Active and Done sections with counts', () => {
    const el = render([
      subagent({ id: 'a', name: 'Xlsx ui review', status: 'active', startedAt: 490_000, endedAt: undefined }),
      subagent({ id: 'b', name: 'Pdf selection review', status: 'done' }),
      subagent({ id: 'c', name: 'Issues audit', status: 'done' }),
    ]);
    expect(el.querySelector('.sa-section__title')?.textContent).toBe('Active · 1');
    const titles = [...el.querySelectorAll('.sa-section__title')].map((t) => t.textContent);
    expect(titles).toEqual(['Active · 1', 'Done · 2']);
    const names = [...el.querySelectorAll('.sa-row__name')].map((n) => n.textContent);
    expect(names).toEqual(['Xlsx ui review', 'Pdf selection review', 'Issues audit']);
  });

  it('says so when nothing is active', () => {
    const el = render([subagent()]);
    expect(el.textContent).toContain('No active subagents');
  });

  it('shows a live activity line for an active subagent, derived from its latest tool call', () => {
    const el = render([
      subagent({
        id: 'a',
        status: 'active',
        startedAt: 490_000,
        endedAt: undefined,
        steps: [
          { kind: 'tool_call', name: 'Read', preview: 'Settings.kt' },
          { kind: 'tool_result', name: 'Read', ok: true, preview: '…' },
          { kind: 'tool_call', name: 'Grep', preview: 'Settings composition' },
        ],
      }),
    ]);
    expect(el.querySelector('.sa-row__activity')?.textContent).toBe('inspecting Settings composition');
  });

  it('a done row has no activity line and shows "…ago" instead of elapsed time', () => {
    const el = render([subagent({ endedAt: 440_000 })]); // 60s before the fake system time (500_000)
    expect(el.querySelector('.sa-row__activity')).toBeNull();
    expect(el.querySelector('.sa-row__time')?.textContent).toBe('1m ago');
  });

  it('clicking a row opens its transcript: prompt, steps and result', () => {
    const el = render([
      subagent({
        steps: [
          { kind: 'tool_call', name: 'Read', preview: 'dialog.kt' },
          { kind: 'tool_result', name: 'Read', ok: true, preview: 'contents here', ms: 40 },
        ],
      }),
    ]);
    const row = el.querySelector('.sa-row') as HTMLButtonElement;
    act(() => row.click());

    expect(el.querySelector('.sa-detail__name')?.textContent).toBe('Pdf selection review');
    expect(el.querySelector('.sa-detail__prompt')?.textContent).toBe('Review the PDF selection handling and file fixes.');
    expect(el.querySelectorAll('.sa-step')).toHaveLength(2);
    expect(el.querySelector('.sa-detail__result')?.textContent).toBe('Filed two fixes: dialog labels and dismiss affordance.');

    // Back returns to the list.
    const back = el.querySelector('.sa-back') as HTMLButtonElement;
    act(() => back.click());
    expect(el.querySelector('.sa-detail__name')).toBeNull();
    expect(el.querySelector('.sa-row__name')?.textContent).toBe('Pdf selection review');
  });

  it("an active subagent's detail says it is still working, even with no steps yet", () => {
    const el = render([subagent({ status: 'active', startedAt: 490_000, endedAt: undefined, steps: [] })]);
    act(() => (el.querySelector('.sa-row') as HTMLButtonElement).click());
    expect(el.querySelector('.sa-detail__meta')?.textContent).toContain('Working');
    expect(el.textContent).toContain('no steps yet');
  });
});
