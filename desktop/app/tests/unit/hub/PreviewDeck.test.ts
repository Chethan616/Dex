/**
 * deckHasContent decides whether the preview deck takes the browser rect.
 *
 * That decision has a real cost attached: showing the deck means DETACHING the
 * native WebContentsView, because it composites above the renderer and React
 * cannot draw underneath it. So a false positive replaces a live page with a
 * card, and a false negative leaves the user staring at "No browser started
 * yet" while DEX is busy driving their desktop.
 *
 * The pairing with `!primarySite` lives in AgentPane; this covers the half
 * that can be tested in isolation.
 */
import { describe, expect, it } from 'vitest';
import { deckHasContent } from '../../../src/renderer/hub/PreviewDeck';
import type { AgentSession, HlEvent, TaskState } from '../../../src/renderer/hub/types';

function session(output: HlEvent[]): AgentSession {
  return { id: 's1', prompt: 'do the thing', status: 'running', createdAt: 0, output };
}

const EMPTY_STATE: TaskState = { objective: '', steps: [], currentStep: null, files: [], notes: [], updatedAt: 1 };

describe('deckHasContent', () => {
  it('is false for a session that has produced nothing', () => {
    expect(deckHasContent(session([]))).toBe(false);
  });

  it('is false for ordinary agent chatter', () => {
    expect(deckHasContent(session([
      { type: 'thinking', text: 'considering' },
      { type: 'tool_call', name: 'Bash', args: {}, iteration: 1 },
      { type: 'tool_result', name: 'Bash', ok: true, preview: 'done', ms: 12 },
    ]))).toBe(false);
  });

  it('is true once an artifact card exists', () => {
    expect(deckHasContent(session([
      { type: 'artifact', kind: 'files', title: 'Search results', items: [] },
    ]))).toBe(true);
  });

  it('is true once a screenshot exists', () => {
    expect(deckHasContent(session([
      { type: 'screenshot', path: 'C:/tmp/shot.png', mode: 'uia', at: 1 },
    ]))).toBe(true);
  });

  it('is true for a plan that has steps', () => {
    expect(deckHasContent(session([
      { type: 'task_state', state: { ...EMPTY_STATE, steps: [{ id: 'step_1', title: 'One', status: 'active', failures: [] }] } },
    ]))).toBe(true);
  });

  // An empty ledger row is written the moment anything calls dex-state — even
  // just `file` or `note`. Taking the pane for a plan with no steps would
  // blank a live page to show an empty box.
  it('is false for a ledger with no steps', () => {
    expect(deckHasContent(session([{ type: 'task_state', state: EMPTY_STATE }]))).toBe(false);
  });
});
