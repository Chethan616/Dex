// @vitest-environment jsdom

/**
 * The visual half of the deck — deckHasContent (PreviewDeck.test.ts) decides
 * *whether* it shows; this covers what it actually renders once it does,
 * specifically the file-result design: one row per result (matching the
 * Flutter app's file cards — name, folder, excerpt, quiet reason tags), an
 * icon identifying the file's kind with no per-type color coding, and
 * click-to-reveal still wired through.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewDeck } from '../../../src/renderer/hub/PreviewDeck';
import type { AgentSession, HlEvent } from '../../../src/renderer/hub/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function session(output: HlEvent[]): AgentSession {
  return { id: 's1', prompt: 'find my files', status: 'running', createdAt: 0, output };
}

function render(output: HlEvent[]): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PreviewDeck session={session(output)} />);
  });
  return { container, root };
}

const revealOutput = vi.fn();

describe('PreviewDeck file results', () => {
  beforeEach(() => {
    (window as unknown as { electronAPI: { sessions: { revealOutput: typeof revealOutput } } }).electronAPI = {
      sessions: { revealOutput },
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    revealOutput.mockClear();
  });

  it('renders search results as a list of rows, not a grid of cards', () => {
    const { container, root } = render([
      {
        type: 'artifact',
        kind: 'files',
        title: 'Search results for "cryptography syllabus"',
        items: [
          { label: 'BCSE_CNS_syllabus.pdf', detail: 'C:/Users/x/BCSE_CNS_syllabus.pdf', reasons: ['"cryptography" in contents'], bytes: 219044 },
          { label: 'grades.xlsx', detail: 'C:/Users/x/grades.xlsx', reasons: ['"syllabus" in filename'], bytes: 4096 },
        ],
      },
    ]);

    const items = container.querySelectorAll('.deck-card__items .deck-item');
    expect(items.length).toBe(2);

    // No per-type colored badge — an icon only, same color for every type.
    expect(container.querySelectorAll('.deck-item__badge').length).toBe(0);
    const icons = container.querySelectorAll('.deck-item__icon svg');
    expect(icons.length).toBe(2);

    // Name, folder and the match reason are all present per row.
    expect(items[0].querySelector('.deck-item__label')?.textContent).toBe('BCSE_CNS_syllabus.pdf');
    expect(items[0].querySelector('.deck-item__folder')?.textContent).toBe('C:/Users/x');
    expect(items[0].textContent).toContain('"cryptography" in contents');

    act(() => root.unmount());
  });

  it('reveals the file on click', () => {
    const { container, root } = render([
      {
        type: 'artifact',
        kind: 'files',
        title: 'Search results',
        items: [{ label: 'report.pdf', detail: 'C:/Users/x/report.pdf', reasons: [] }],
      },
    ]);

    const row = container.querySelector('.deck-item') as HTMLElement;
    act(() => { row.click(); });

    expect(revealOutput).toHaveBeenCalledWith('C:/Users/x/report.pdf');
    act(() => root.unmount());
  });

  it('renders an icon for an unrecognized extension without erroring', () => {
    const { container, root } = render([
      {
        type: 'artifact',
        kind: 'files',
        title: 'Search results',
        items: [{ label: 'weird.xyz123', detail: 'C:/x/weird.xyz123', reasons: [] }],
      },
    ]);

    // Falls through to the generic file icon — still one icon, no text tag.
    expect(container.querySelectorAll('.deck-item__icon svg').length).toBe(1);
    expect(container.querySelectorAll('.deck-item__badge').length).toBe(0);
    act(() => root.unmount());
  });

  it('shows the file name and an icon on a single-file "reading" card too, with no colored badge', () => {
    const { container, root } = render([
      { type: 'artifact', kind: 'reading', title: 'Reading', file: 'C:/Users/x/notes.docx', items: [] },
    ]);

    const fileButton = container.querySelector('.deck-card__file');
    expect(fileButton?.querySelector('svg')).toBeTruthy();
    expect(fileButton?.querySelector('.deck-item__badge')).toBeNull();
    expect(fileButton?.textContent).toContain('notes.docx');

    act(() => root.unmount());
  });
});

// dex-canvas's whole point is to take over the rect like a live page would —
// not sit as one card among the plan/activity stack. These confirm that
// exclusivity actually holds in the render, not just in the description.
describe('PreviewDeck canvas documents', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the document full-bleed, with the plan/activity stack suppressed', () => {
    const { container, root } = render([
      { type: 'task_state', state: { objective: 'Report', steps: [{ id: 'step_1', title: 'One', status: 'active', failures: [] }], currentStep: 'step_1', files: [], notes: [], updatedAt: 1 } },
      { type: 'canvas', title: 'Q3 Expense Summary', markdown: '# Q3 Expense Summary\n\nTravel is up 18%.', at: 1 },
    ]);

    expect(container.querySelector('.deck-canvas')).not.toBeNull();
    expect(container.querySelector('.deck-canvas__title')?.textContent).toBe('Q3 Expense Summary');
    expect(container.textContent).toContain('Travel is up 18%');

    // Exclusive: no plan card, no activity card, alongside the document.
    expect(container.querySelector('.deck-plan')).toBeNull();
    expect(container.querySelector('.deck-card--activity')).toBeNull();

    act(() => root.unmount());
  });

  it('shows only the latest document when dex-canvas show was called more than once', () => {
    const { container, root } = render([
      { type: 'canvas', title: 'Draft', markdown: 'draft content', at: 1 },
      { type: 'canvas', title: 'Final', markdown: 'final content', at: 2 },
    ]);

    expect(container.querySelector('.deck-canvas__title')?.textContent).toBe('Final');
    expect(container.textContent).toContain('final content');
    expect(container.textContent).not.toContain('draft content');

    act(() => root.unmount());
  });
});
