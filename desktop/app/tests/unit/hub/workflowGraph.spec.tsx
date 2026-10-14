// @vitest-environment jsdom
/**
 * The workflow cards and graph (hub/workflows/): the snake layout, the cards
 * in the chat, View opening the graph, and `/workflow` in a task's composer.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { columnsFor, fitView, layoutGraph, NODE_H, NODE_W, GAP_X } from '../../../src/renderer/hub/workflows/layout';
import { WidgetView } from '../../../src/renderer/hub/chat/Widgets';
import { expandSlashCommand } from '../../../src/renderer/hub/slashCommands';
import type { Workflow } from '../../../src/shared/workflows';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no ResizeObserver.
  (globalThis as any).ResizeObserver ??= class { observe() {} disconnect() {} };
});
let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  delete (window as any).electronAPI;
});

function render(el: React.ReactElement): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}

/** The button or text whose own text is exactly this. */
function byText(text: string | RegExp): HTMLElement {
  const all = [...document.body.querySelectorAll<HTMLElement>('span, button, h2, div')];
  const hit = all.find((e) => [...e.childNodes].some((n) => n.nodeType === 3 && (typeof text === 'string' ? n.textContent === text : text.test(n.textContent ?? ''))));
  if (!hit) throw new Error(`no element with text ${text}`);
  return hit;
}

const click = (el: HTMLElement) => act(() => { (el.closest('button') ?? el).dispatchEvent(new MouseEvent('click', { bubbles: true })); });

const routine: Workflow = {
  id: 'wf_abc123', name: 'Morning routine', description: 'Before work',
  trigger: { kind: 'weekly', days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '07:30' },
  steps: [
    { id: 's1', kind: 'web', title: 'Check the weather', detail: 'Hyderabad' },
    { id: 's2', kind: 'task', title: 'Summarise unread mail' },
    { id: 's3', kind: 'notify', title: 'Send me the summary' },
  ],
  enabled: true, createdAt: 0, updatedAt: 0,
};

describe('the graph layout', () => {
  it('snakes the nodes: left to right, down, then right to left', () => {
    const l = layoutGraph(6, 3);
    expect(l.nodes.map((n) => [n.row, n.col])).toEqual([[0, 0], [0, 1], [0, 2], [1, 2], [1, 1], [1, 0]]);
    expect(l.edges.map((e) => e.enters)).toEqual(['left', 'left', 'top', 'right', 'right']);
    expect(l.width).toBe(3 * NODE_W + 2 * GAP_X);
  });

  it('joins rows straight down, from the bottom of one node to the top of the next', () => {
    const l = layoutGraph(4, 2);
    const down = l.edges[1];
    expect(down.start).toEqual([l.nodes[1].x + NODE_W / 2, l.nodes[1].y + NODE_H]);
    expect(down.end).toEqual([l.nodes[2].x + NODE_W / 2, l.nodes[2].y]);
  });

  it('uses one column on a phone-narrow view and never more nodes than there are', () => {
    expect(columnsFor(360, 8)).toBe(1);
    expect(columnsFor(1100, 8)).toBe(3);
    expect(columnsFor(1100, 2)).toBe(2);
  });

  it('fits the whole graph, never larger than life', () => {
    expect(fitView({ width: 200, height: 100 }, 1000, 800).k).toBe(1);
    expect(fitView({ width: 4000, height: 100 }, 1000, 800).k).toBeLessThan(1);
  });
});

describe('the workflow cards', () => {
  it('shows each workflow with when it runs, its steps, View and Run now', () => {
    (window as any).electronAPI = { workflows: { get: vi.fn(async () => null), run: vi.fn(async () => ({ sessionId: 'x' })), showInChat: vi.fn() } };
    render(<WidgetView widget={{ type: 'workflows', items: [routine] }} answered={false} />);
    expect(byText('Morning routine')).toBeTruthy();
    expect(byText('Weekdays at 7:30 am')).toBeTruthy();
    expect(document.querySelector('.cx-wc__line')?.textContent).toMatch(/^3 steps · Next: /);
    click(byText('Run now'));
    expect((window as any).electronAPI.workflows.run).toHaveBeenCalledWith('wf_abc123');
  });

  it('opens the graph on View, with the trigger and every step as a node, and closes on Escape', () => {
    (window as any).electronAPI = { workflows: { get: vi.fn(async () => null), run: vi.fn(), showInChat: vi.fn() } };
    render(<WidgetView widget={{ type: 'workflows', items: [routine] }} answered={false} />);
    click(byText('View'));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelectorAll('.wfg__node')).toHaveLength(4);
    expect(dialog.querySelector('.wfg__node--trigger')?.textContent).toMatch(/Weekdays at 7:30 am/);
    expect(dialog.textContent).toMatch(/Summarise unread mail/);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('says how to make one when there are none', () => {
    render(<WidgetView widget={{ type: 'workflows', items: [] }} answered={false} />);
    expect(byText('No workflows yet')).toBeTruthy();
  });
});

describe('/workflow', () => {
  it('is answered by DEX itself in a task, and goes to the agent with words after it', () => {
    const bare = expandSlashCommand('/workflow');
    expect(bare.command?.name).toBe('workflow');
    expect(bare.command?.inTask).toBeTypeOf('function');
    expect(bare.prompt).toMatch(/dex-workflow show/);
    expect(expandSlashCommand('/workflow make one for Friday evenings').prompt).toMatch(/^About my workflows and routines: make one for Friday evenings/);
  });
});
