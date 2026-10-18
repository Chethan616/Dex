/**
 * The triage card (shared/triage.ts): what agents write becomes a card, the
 * card's answers become instructions, and the chat shows what the user did.
 */
import { describe, expect, it } from 'vitest';
import {
  cornerRange, normalizeScore, parseTriageCommand, quadrantOf, withinCorner, triageCommand, triageOrder, triagePrompt, typedTriage,
  type TriageItem,
} from '../../../src/shared/triage';
import { parseWidget, widgetLine } from '../../../src/shared/widgets';
import { taskTitle, typedCommand } from '../../../src/shared/slashCommands';
import { HlEventSchema } from '../../../src/shared/session-schemas';

const priya: TriageItem = {
  id: 'i1', from: 'Priya Shah', address: 'priya@acme.com', subject: 'Q3 budget sign-off',
  urgency: 9, importance: 9, draft: 'Hi Priya, signed off. Thanks!',
};

describe('where a message sits', () => {
  it('is its scores, inside its corner: urgency across, importance up', () => {
    expect(cornerRange('now')).toEqual([5, 10, 5, 10]);
    expect(cornerRange('later')).toEqual([0, 5, 0, 5]);
    expect(withinCorner({ urgency: 9, importance: 9 })).toEqual([0.8, 0.8]);
    expect(withinCorner({ urgency: 5, importance: 10 })).toEqual([0, 1]);
    expect(withinCorner({ urgency: 2.5, importance: 0 })).toEqual([0.5, 0]);
    // 4.9 urgent is "not urgent", at the far edge of its corner.
    expect(withinCorner({ urgency: 4.9, importance: 7 })[0]).toBeCloseTo(0.98);
  });
});

describe('reading what agents send', () => {
  it('takes the shapes agents write: senders as objects, words for scores, replies by other names', () => {
    const { widget, error } = parseWidget({
      type: 'inbox',
      channel: 'Gmail',
      emails: [
        { sender: { name: 'Priya Shah', email: 'priya@acme.com' }, title: 'Q3 sign-off', snippet: 'By 4 pm', urgency: 9, priority: 'high', reply: 'Done!' },
        { from: 'Swiggy', subject: 'Receipt', urgency: 0.5, importance: 'low' },
        { from: 'Mom', message: 'Call me', urgency: '7', importance: 9, id: 'abc-1' },
      ],
    });
    expect(error).toBeNull();
    expect(widget?.type).toBe('triage');
    if (widget?.type !== 'triage') return;
    expect(widget.source).toBe('gmail');
    // One scale for the card: 0.5 on a 0–10 card stays near zero.
    expect(widget.items.map((i) => [i.id, i.from, i.urgency, i.importance])).toEqual([
      ['i1', 'Priya Shah', 9, 8], ['i2', 'Swiggy', 0.5, 2], ['abc-1', 'Mom', 7, 9],
    ]);
    expect(widget.items[0]).toMatchObject({ address: 'priya@acme.com', subject: 'Q3 sign-off', preview: 'By 4 pm', draft: 'Done!' });
  });

  it('reads a card scored 0–1 or 0–100 onto 0–10', () => {
    const scores = (items: unknown[]) => {
      const { widget } = parseWidget({ type: 'triage', items });
      return widget?.type === 'triage' ? widget.items.map((i) => [i.urgency, i.importance]) : null;
    };
    expect(scores([{ from: 'A', urgency: 0.9, importance: 0.25 }, { from: 'B', urgency: 0.1, importance: 1 }])).toEqual([[9, 2.5], [1, 10]]);
    expect(scores([{ from: 'A', urgency: 90, importance: 45 }, { from: 'B', urgency: 5, importance: 100 }])).toEqual([[9, 4.5], [0.5, 10]]);
  });

  it('knows messages to triage by their scores, whatever the agent called them', () => {
    const { widget } = parseWidget({ items: [{ from: 'A', urgency: 3, importance: 4 }] });
    expect(widget?.type).toBe('triage');
  });

  it('says what to send when the spec is wrong', () => {
    const { error } = parseWidget({ type: 'triage', items: [{ from: 'A' }] });
    expect(error).toMatch(/urgency.*missing/);
    expect(error).toContain('"importance"');
  });

  it('keeps every id unique, so an answer names one message', () => {
    const { widget } = parseWidget({ type: 'triage', items: [{ id: 'x', from: 'A', urgency: 1, importance: 1 }, { id: 'x', from: 'B', urgency: 1, importance: 1 }] });
    expect(widget?.type === 'triage' && widget.items.map((i) => i.id)).toEqual(['x', 'x_']);
  });

  it('reads a score said in words or as a string', () => {
    expect([normalizeScore('7'), normalizeScore('low'), normalizeScore('Urgent'), normalizeScore(3)]).toEqual([7, 2, 9, 3]);
  });
});

describe('the four corners', () => {
  it('splits at the middle and goes through the most pressing first', () => {
    const items = [
      { urgency: 2, importance: 2 }, { urgency: 9, importance: 3 }, { urgency: 3, importance: 9 }, { urgency: 6, importance: 6 }, { urgency: 9, importance: 9 },
    ];
    expect(items.map(quadrantOf)).toEqual(['later', 'quick', 'plan', 'now', 'now']);
    expect(triageOrder(items).map(quadrantOf)).toEqual(['now', 'now', 'quick', 'plan', 'later']);
    expect(triageOrder(items)[0]).toEqual({ urgency: 9, importance: 9 });
  });

  it('describes the card in a line', () => {
    const { widget } = parseWidget({ type: 'triage', title: 'Today’s mail', items: [{ from: 'A', urgency: 9, importance: 9 }, { from: 'B', urgency: 1, importance: 1 }] });
    expect(widgetLine(widget!)).toBe('Today’s mail · 2 messages · 1 to reply now');
  });
});

describe('answers', () => {
  it('reads the card’s commands, an edited reply or a change included', () => {
    expect(parseTriageCommand(triageCommand('yes', 'w1', 'i1'))).toEqual({ decision: 'yes', widget: 'w1', item: 'i1' });
    expect(parseTriageCommand('/triage yes w1 i1 Hi Priya,\nsigned off.')).toEqual({ decision: 'yes', widget: 'w1', item: 'i1', text: 'Hi Priya,\nsigned off.' });
    expect(parseTriageCommand('/triage specify w1 i1 make it shorter')).toMatchObject({ decision: 'change', text: 'make it shorter' });
    expect(parseTriageCommand('/triage maybe w1 i1')).toBeNull();
    expect(parseTriageCommand('triage yes w1 i1')).toBeNull();
  });

  it('tells the agent exactly what to send, and how to mark it', () => {
    const prompt = triagePrompt({ decision: 'yes', widget: 'w1', item: 'i1' }, priya, 'gmail');
    expect(prompt).toContain('Hi Priya, signed off. Thanks!');
    expect(prompt).toContain('Priya Shah <priya@acme.com> (“Q3 budget sign-off”) on Gmail');
    expect(prompt).toContain('dex-ui mark w1 i1 sent');
    // The user's edit wins over the draft.
    expect(triagePrompt({ decision: 'yes', widget: 'w1', item: 'i1', text: 'Edited.' }, priya)).toContain('---\nEdited.\n---');
    const change = triagePrompt({ decision: 'change', widget: 'w1', item: 'i1', text: 'say I’ll call at 5' }, priya);
    expect(change).toContain('dex-ui redraft w1 i1');
    expect(change).toMatch(/Don't send it/);
  });

  it('shows what the user did, not the instruction', () => {
    const yes = triagePrompt({ decision: 'yes', widget: 'w1', item: 'i1' }, priya);
    expect(typedTriage(yes)).toBe('Yes, send my reply to Priya Shah.');
    expect(typedCommand(yes)).toBe('Yes, send my reply to Priya Shah.');
    expect(taskTitle(yes)).toBe('Yes, send my reply to Priya Shah.');
    const change = triagePrompt({ decision: 'change', widget: 'w1', item: 'i1', text: 'shorter' }, priya);
    expect(typedTriage(change)).toBe('Change my reply to Priya Shah: shorter');
    expect(typedTriage('Reply to Priya and say I am late')).toBeNull();
  });

  it('carries where each message stands as an event the preload accepts', () => {
    expect(HlEventSchema.safeParse({ type: 'widget_update', id: 'w1', items: { i1: { state: 'sent' }, i2: { draft: 'New text', state: 'open' } } }).success).toBe(true);
    expect(HlEventSchema.safeParse({ type: 'widget_update', id: 'w1', items: { i1: { state: 'exploded' } } }).success).toBe(false);
  });
});

describe('categories', () => {
  it('reads what a message is about from the words agents use, and lanes only what the card has', async () => {
    const { lanesOf, categoryFrom } = await import('../../../src/shared/triage');
    expect(['Studies', 'College', 'job', 'Family', 'newsletter', 'something else', ''].map(categoryFrom)).toEqual(['academics', 'academics', 'work', 'personal', 'other', 'other', undefined]);
    const { widget } = parseWidget({ type: 'triage', items: [
      { from: 'Prof', urgency: 8, importance: 8, category: 'University' },
      { from: 'Mom', urgency: 4, importance: 8, kind: 'family' },
      { from: 'Shop', urgency: 1, importance: 1 },
    ] });
    if (widget?.type !== 'triage') throw new Error('no card');
    expect(widget.items.map((i) => i.category)).toEqual(['academics', 'personal', undefined]);
    // Canonical order, only the ones present: no empty work lane.
    expect(lanesOf(widget.items)).toEqual(['academics', 'personal', 'other']);
  });
});
