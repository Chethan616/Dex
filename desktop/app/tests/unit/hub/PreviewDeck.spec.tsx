// @vitest-environment jsdom

/**
 * The visual half of the deck — deckHasContent (PreviewDeck.test.ts) decides
 * *whether* it shows; this covers what it actually renders once it does,
 * specifically the file-card redesign: a colored type badge per extension,
 * a wrapping grid of cards rather than a list of rows, and click-to-reveal
 * still wired through after the restructure.
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

describe('PreviewDeck file cards', () => {
  beforeEach(() => {
    (window as unknown as { electronAPI: { sessions: { revealOutput: typeof revealOutput } } }).electronAPI = {
      sessions: { revealOutput },
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    revealOutput.mockClear();
  });

  it('renders search results as a grid of cards, not a list of rows', () => {
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

    // The type badge is a text tag colored per extension, not per-format art.
    const badges = Array.from(container.querySelectorAll('.deck-item__badge')).map((el) => el.textContent);
    expect(badges).toEqual(['PDF', 'XLS']);

    act(() => root.unmount());
  });

  it('reveals the file on click, after the badge/body restructure', () => {
    const { container, root } = render([
      {
        type: 'artifact',
        kind: 'files',
        title: 'Search results',
        items: [{ label: 'report.pdf', detail: 'C:/Users/x/report.pdf', reasons: [] }],
      },
    ]);

    const card = container.querySelector('.deck-item') as HTMLElement;
    act(() => { card.click(); });

    expect(revealOutput).toHaveBeenCalledWith('C:/Users/x/report.pdf');
    act(() => root.unmount());
  });

  it('falls back to an uppercase extension tag for an unknown file type', () => {
    const { container, root } = render([
      {
        type: 'artifact',
        kind: 'files',
        title: 'Search results',
        items: [{ label: 'weird.xyz123', detail: 'C:/x/weird.xyz123', reasons: [] }],
      },
    ]);

    expect(container.querySelector('.deck-item__badge')?.textContent).toBe('XYZ1');
    act(() => root.unmount());
  });

  it('shows a colored badge on a single-file "reading" card too', () => {
    const { container, root } = render([
      { type: 'artifact', kind: 'reading', title: 'Reading', file: 'C:/Users/x/notes.docx', items: [] },
    ]);

    const fileButton = container.querySelector('.deck-card__file');
    expect(fileButton?.querySelector('.deck-item__badge')?.textContent).toBe('DOC');
    expect(fileButton?.textContent).toContain('notes.docx');

    act(() => root.unmount());
  });
});
