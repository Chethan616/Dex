// @vitest-environment jsdom
/**
 * Phase 8 (granular-tool-approval): the confirmation card gained a lifetime
 * selector next to Approve so a "yes" can cover the rest of this turn or
 * this session instead of asking again on the very next dex-registry/dex-sh
 * call. Deny stays a single, un-rememberable action — there's no "deny for
 * the rest of the session" concept.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmationCard } from '../../../src/renderer/hub/PreviewDeck';
import type { HlEvent } from '../../../src/renderer/hub/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ConfirmationEvent = Extract<HlEvent, { type: 'confirmation' }>;

function confirmEvent(): ConfirmationEvent {
  return { type: 'confirmation', id: 'c1', title: 'Set registry value', detail: 'HKCU\\Foo -> 1', status: 'pending', at: 1 };
}

function render(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ConfirmationCard sessionId="s1" event={confirmEvent()} />);
  });
  return { container, root };
}

const confirmAnswer = vi.fn().mockResolvedValue({ ok: true });

describe('ConfirmationCard approval lifetime', () => {
  beforeEach(() => {
    (window as unknown as { electronAPI: { dex: { confirmAnswer: typeof confirmAnswer } } }).electronAPI = {
      dex: { confirmAnswer },
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    confirmAnswer.mockClear();
  });

  it('defaults to "once" when Approve is clicked with no lifetime change', async () => {
    const { container } = render();
    const approveBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Approve')!;
    await act(async () => { approveBtn.click(); });
    expect(confirmAnswer).toHaveBeenCalledWith('s1', 'c1', true, 'once');
  });

  it('sends the selected lifetime when Approve is clicked after changing it', async () => {
    const { container } = render();
    const select = container.querySelector('select.deck-confirm__lifetime') as HTMLSelectElement;
    act(() => {
      select.value = 'session';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const approveBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Approve')!;
    await act(async () => { approveBtn.click(); });
    expect(confirmAnswer).toHaveBeenCalledWith('s1', 'c1', true, 'session');
  });

  it('Deny always answers with lifetime "once", ignoring whatever the selector shows', async () => {
    const { container } = render();
    const select = container.querySelector('select.deck-confirm__lifetime') as HTMLSelectElement;
    act(() => {
      select.value = 'session';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const denyBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Deny')!;
    await act(async () => { denyBtn.click(); });
    expect(confirmAnswer).toHaveBeenCalledWith('s1', 'c1', false, 'once');
  });
});
