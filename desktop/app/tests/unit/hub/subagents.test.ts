import { describe, expect, it } from 'vitest';
import { buildSubagents, foldSubagentEvent, subagentsList, EMPTY_SUBAGENTS } from '../../../src/shared/subagents';
import { collectSubagents, currentActivity, groupSubagentMentions, joinNames, mentionText } from '../../../src/renderer/hub/subagents';
import type { HlEvent } from '../../../src/shared/session-schemas';

function ev<T extends Partial<HlEvent> & { type: string }>(e: T, at: number): HlEvent {
  return { ...(e as object), at } as HlEvent;
}

describe('shared/subagents folding', () => {
  it('a subagent starts active with no steps', () => {
    const events: HlEvent[] = [ev({ type: 'subagent_start', id: 's1', name: 'Pdf selection review', prompt: 'Review it' }, 1)];
    const list = collectSubagents(events);
    expect(list).toEqual([
      { id: 's1', name: 'Pdf selection review', subagentType: undefined, prompt: 'Review it', status: 'active', startedAt: 1, steps: [] },
    ]);
  });

  it('a step before its subagent started is ignored rather than crashing', () => {
    const events: HlEvent[] = [ev({ type: 'subagent_step', id: 'missing', kind: 'tool_call', name: 'Read' }, 1)];
    expect(collectSubagents(events)).toEqual([]);
  });

  it('steps accumulate onto the right subagent, in order', () => {
    const events: HlEvent[] = [
      ev({ type: 'subagent_start', id: 's1', name: 'Pdf selection review', prompt: 'p' }, 1),
      ev({ type: 'subagent_step', id: 's1', kind: 'tool_call', name: 'Read', preview: 'a.kt' }, 2),
      ev({ type: 'subagent_step', id: 's1', kind: 'tool_result', name: 'Read', ok: true, preview: 'contents', ms: 12 }, 3),
    ];
    const [a] = collectSubagents(events);
    expect(a.steps).toEqual([
      { at: 2, kind: 'tool_call', name: 'Read', preview: 'a.kt', ok: undefined, ms: undefined },
      { at: 3, kind: 'tool_result', name: 'Read', preview: 'contents', ok: true, ms: 12 },
    ]);
  });

  it('subagent_done flips status and keeps the earlier steps', () => {
    const events: HlEvent[] = [
      ev({ type: 'subagent_start', id: 's1', name: 'X', prompt: 'p' }, 1),
      ev({ type: 'subagent_step', id: 's1', kind: 'tool_call', name: 'Read' }, 2),
      ev({ type: 'subagent_done', id: 's1', ok: true, summary: 'Done, filed 2 fixes.' }, 3),
    ];
    const [a] = collectSubagents(events);
    expect(a.status).toBe('done');
    expect(a.ok).toBe(true);
    expect(a.summary).toBe('Done, filed 2 fixes.');
    expect(a.endedAt).toBe(3);
    expect(a.steps).toHaveLength(1);
  });

  it('preserves launch order across several subagents', () => {
    const events: HlEvent[] = [
      ev({ type: 'subagent_start', id: 'a', name: 'A', prompt: 'p' }, 1),
      ev({ type: 'subagent_start', id: 'b', name: 'B', prompt: 'p' }, 1),
      ev({ type: 'subagent_start', id: 'c', name: 'C', prompt: 'p' }, 1),
    ];
    expect(collectSubagents(events).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('folding incrementally (foldSubagentEvent one event at a time) matches folding the whole array at once', () => {
    const events: HlEvent[] = [
      ev({ type: 'subagent_start', id: 's1', name: 'X', prompt: 'p' }, 1),
      ev({ type: 'subagent_step', id: 's1', kind: 'tool_call', name: 'Read', preview: 'a' }, 2),
      ev({ type: 'subagent_done', id: 's1', ok: false, summary: 'blocked' }, 3),
    ];
    const whole = buildSubagents(events);
    let incremental = EMPTY_SUBAGENTS;
    for (const e of events) incremental = foldSubagentEvent(incremental, e);
    expect(subagentsList(incremental)).toEqual(subagentsList(whole));
  });
});

describe('renderer hub/subagents display helpers', () => {
  it("currentActivity reads the most recent tool_call's target, verb-mapped", () => {
    const events: HlEvent[] = [
      ev({ type: 'subagent_start', id: 's1', name: 'X', prompt: 'p' }, 1),
      ev({ type: 'subagent_step', id: 's1', kind: 'tool_call', name: 'Read', preview: 'src/pointerInput.kt' }, 2),
      ev({ type: 'subagent_step', id: 's1', kind: 'tool_result', name: 'Read', ok: true, preview: '…' }, 3),
      ev({ type: 'subagent_step', id: 's1', kind: 'tool_call', name: 'Grep', preview: 'pointerInput keys' }, 4),
    ];
    const [a] = collectSubagents(events);
    expect(currentActivity(a)).toBe('inspecting pointerInput keys');
  });

  it('currentActivity is null for a subagent with no tool calls yet', () => {
    const events: HlEvent[] = [ev({ type: 'subagent_start', id: 's1', name: 'X', prompt: 'p' }, 1)];
    const [a] = collectSubagents(events);
    expect(currentActivity(a)).toBeNull();
  });

  it('three subagents started in the same turn group into one mention line', () => {
    const events: HlEvent[] = [
      ev({ type: 'subagent_start', id: 'a', name: 'Pdf selection review', prompt: 'p' }, 100),
      ev({ type: 'subagent_start', id: 'b', name: 'Xlsx ui review', prompt: 'p' }, 100),
      ev({ type: 'subagent_start', id: 'c', name: 'Glass contrast review', prompt: 'p' }, 100),
    ];
    const byId = new Map(collectSubagents(events).map((s) => [s.id, s]));
    const groups = groupSubagentMentions(events, byId);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('start');
    expect(mentionText(groups[0])).toBe('Pdf selection review, Xlsx ui review and Glass contrast review started working');
  });

  it('a subagent that finishes alone gets its own row; two finishing back-to-back group together', () => {
    const events: HlEvent[] = [
      ev({ type: 'subagent_start', id: 'a', name: 'Pdf selection review', prompt: 'p' }, 1),
      ev({ type: 'subagent_start', id: 'b', name: 'Xlsx ui review', prompt: 'p' }, 1),
      ev({ type: 'subagent_start', id: 'c', name: 'Glass contrast review', prompt: 'p' }, 1),
      // Pdf finishes first, on its own — some other work happens in between.
      ev({ type: 'subagent_done', id: 'a', ok: true, summary: 'done' }, 10),
      ev({ type: 'tool_call', name: 'Bash', args: {}, iteration: 1 }, 11),
      // The other two finish back-to-back with nothing between.
      ev({ type: 'subagent_done', id: 'b', ok: true, summary: 'done' }, 20),
      ev({ type: 'subagent_done', id: 'c', ok: true, summary: 'done' }, 21),
    ];
    const byId = new Map(collectSubagents(events).map((s) => [s.id, s]));
    const groups = groupSubagentMentions(events, byId).filter((g) => g.kind === 'done');
    expect(groups.map((g) => mentionText(g))).toEqual([
      'Pdf selection review finished',
      'Xlsx ui review and Glass contrast review finished',
    ]);
  });

  it('joinNames reads naturally for 1, 2 and 3+ names', () => {
    expect(joinNames(['a'])).toBe('a');
    expect(joinNames(['a', 'b'])).toBe('a and b');
    expect(joinNames(['a', 'b', 'c'])).toBe('a, b and c');
  });
});
