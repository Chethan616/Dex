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

function session(output: HlEvent[], status: AgentSession['status'] = 'running'): AgentSession {
  return { id: 's1', prompt: 'do the thing', status, createdAt: 0, output };
}

const EMPTY_STATE: TaskState = { objective: '', steps: [], currentStep: null, files: [], notes: [], updatedAt: 1 };

describe('deckHasContent', () => {
  it('is false for a session that has produced nothing', () => {
    expect(deckHasContent(session([]))).toBe(false);
  });

  it('is false while the agent is only thinking', () => {
    expect(deckHasContent(session([{ type: 'thinking', text: 'considering' }]))).toBe(false);
  });

  // Until the browser navigates this rect reads "No browser started yet",
  // which is indistinguishable from nothing happening — through an entire
  // filesystem or desktop task.
  it('is true once the agent actually does something', () => {
    expect(deckHasContent(session([
      { type: 'tool_call', name: 'Bash', args: {}, iteration: 1 },
    ]))).toBe(true);
  });

  // A draft is one navigation away from a real page; taking the rect would
  // mean detaching a browser view that is about to be needed.
  it('is false for a draft session whatever it has emitted', () => {
    expect(deckHasContent(session([
      { type: 'tool_call', name: 'Bash', args: {}, iteration: 1 },
    ], 'draft'))).toBe(false);
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
