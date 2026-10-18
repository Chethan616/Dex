// @vitest-environment jsdom
/**
 * The triage card in the chat: a plot for more than five messages and a list
 * for fewer, answers that go out as commands and show at once, updates that
 * mark messages where they stand, and answers' work folded under the card's
 * turn so it stays at the bottom.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetView } from '../../../../src/renderer/hub/chat/Widgets';
import { buildTranscript } from '../../../../src/renderer/logs/transcript';
import { toTurns } from '../../../../src/renderer/hub/chat/turns';
import { parseWidget, type Widget } from '../../../../src/shared/widgets';
import { triagePrompt, type TriageItem } from '../../../../src/shared/triage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const people = ['Priya Shah', 'Arjun Rao', 'Mom', 'Swiggy', 'Prof. Iyer', 'Netflix', 'Kiran', 'HR Team'];
const card = (n: number): Widget => {
  const { widget, error } = parseWidget({
    type: 'triage',
    title: 'Today’s unread mail',
    source: 'gmail',
    items: people.slice(0, n).map((from, i) => ({
      id: `m${i + 1}`, from, subject: `Subject ${i + 1}`, preview: `Preview ${i + 1}`,
      urgency: [9, 7, 6, 1, 8, 1, 3, 4][i], importance: [9, 4, 8, 1, 9, 2, 6, 3][i],
      ...(from === 'Swiggy' || from === 'Netflix' ? {} : { draft: `Reply to ${from}` }),
    })),
  });
  if (!widget) throw new Error(error);
  return widget;
};

describe('the triage card', () => {
  let host: HTMLDivElement;
  let root: Root;
  const onReply = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    onReply.mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });
  const render = (w: Widget) => act(() => root.render(<WidgetView widget={w} wid="w9" answered onReply={onReply} />));
  const button = (label: RegExp) => [...host.querySelectorAll('button')].find((b) => label.test(b.textContent ?? ''))!;

  it('plots more than five messages, opening the most pressing first', () => {
    render(card(8));
    expect(host.querySelectorAll('.tri-pt')).toHaveLength(8);
    expect(host.textContent).toContain('Reply now');
    expect(host.textContent).toContain('Urgency');
    expect(host.textContent).toContain('Importance');
    // Priya (9, 9) is opened, with her draft.
    expect(host.querySelector('.tri-msg__from')?.textContent).toBe('Priya Shah');
    expect((host.querySelector('.tri-reply__text') as HTMLTextAreaElement).value).toBe('Reply to Priya Shah');
  });

  it('puts a point where its scores say, whatever it is about', () => {
    const { widget } = parseWidget({
      type: 'triage',
      items: [
        { id: 'a', from: 'Boss', urgency: 8, importance: 6, category: 'work' },
        { id: 'b', from: 'Sister', urgency: 8, importance: 9, category: 'personal' },
        { id: 'c', from: 'Shop', urgency: 1, importance: 1, category: 'other' },
        { id: 'd', from: 'Prof', urgency: 2, importance: 8, category: 'academics' },
        { id: 'e', from: 'Team', urgency: 6, importance: 2, category: 'work' },
        { id: 'f', from: 'Friend', urgency: 3, importance: 3, category: 'personal' },
      ],
    });
    render(widget!);
    const at = (name: string): [number, number] => {
      const g = [...host.querySelectorAll('.tri-pt')].find((p) => p.getAttribute('aria-label')?.startsWith(name))!;
      const [, x, y] = /translate\(([\d.]+) ([\d.]+)\)/.exec(g.getAttribute('transform')!)!;
      return [Number(x), Number(y)];
    };
    // Same urgency, different category: the same distance across.
    expect(at('Boss')[0]).toBeCloseTo(at('Sister')[0], 5);
    // More important is higher up, in the same corner.
    expect(at('Sister')[1]).toBeLessThan(at('Boss')[1]);
    expect(host.querySelector('[aria-label^="Boss"]')?.getAttribute('aria-label')).toContain('Urgency 8 · Importance 6 · Work');
  });

  it('opens a corner as one plot per category on the card, and comes back', () => {
    render(card(8));
    const corner = host.querySelector('.tri-corner--now') as SVGGElement;
    act(() => { corner.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(host.querySelector('.tri-plot__where')?.textContent).toBe('Reply now');
    // Priya (9, 9), Prof. Iyer (8, 9), Mom (6, 8): the corner's three.
    expect(host.querySelectorAll('.tri-pt')).toHaveLength(3);
    expect(host.querySelectorAll('.tri-sub').length).toBeGreaterThan(0);
    expect(host.textContent).toContain('urgency 5–10 across, importance 5–10 up');
    act(() => button(/All corners/).click());
    expect(host.querySelectorAll('.tri-pt')).toHaveLength(8);
  });

  it('picks out one category from the legend, fading the rest', () => {
    const { widget } = parseWidget({
      type: 'triage',
      items: people.slice(0, 6).map((from, i) => ({ id: `m${i}`, from, urgency: i + 2, importance: 8 - i, category: i % 2 ? 'work' : 'personal' })),
    });
    render(widget!);
    act(() => button(/^Work/).click());
    expect(host.querySelectorAll('.tri-pt--dim')).toHaveLength(3);
    expect(host.querySelectorAll('.tri-cat--work.tri-pt--dim')).toHaveLength(0);
    act(() => button(/^Work/).click());
    expect(host.querySelectorAll('.tri-pt--dim')).toHaveLength(0);
  });

  it('lists five or fewer instead', () => {
    render(card(4));
    expect(host.querySelector('svg.tri-pt, .tri-plot')).toBeNull();
    expect(host.querySelectorAll('.tri-row')).toHaveLength(4);
  });

  it('sends Yes as a command, shows it at once, and moves to the next', () => {
    render(card(8));
    act(() => button(/^Yes, send$/).click());
    expect(onReply).toHaveBeenCalledWith('/triage yes w9 m1');
    expect(host.querySelector('.tri-state')?.textContent).toBe('Sending…');
    act(() => { vi.advanceTimersByTime(300); });
    // Next most pressing: Prof. Iyer (8, 9).
    expect(host.querySelector('.tri-msg__from')?.textContent).toBe('Prof. Iyer');
  });

  it('sends an edited reply with the Yes, and Specify with what to change', () => {
    render(card(8));
    const box = host.querySelector('.tri-reply__text') as HTMLTextAreaElement;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(box, 'Signed off, thanks!');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => button(/Yes, send my edit/).click());
    expect(onReply).toHaveBeenLastCalledWith('/triage yes w9 m1 Signed off, thanks!');
  });

  it('marks messages from the card’s updates: sent gets a tick, a redraft replaces the text', () => {
    const t = buildTranscript('reply to my mail', [
      { type: 'widget', id: 'w9', widget: card(8) },
      { type: 'widget_update', id: 'w9', items: { m1: { state: 'sent' }, m5: { state: 'open', draft: 'New draft for the professor' } } },
    ]);
    const block = t.blocks.find((b) => b.kind === 'widget')!;
    if (block.kind !== 'widget' || block.widget.type !== 'triage') throw new Error('no card');
    expect(block.widget.items.find((i) => i.id === 'm1')?.state).toBe('sent');
    expect(block.widget.items.find((i) => i.id === 'm5')?.draft).toBe('New draft for the professor');
    render(block.widget);
    expect(host.querySelectorAll('.tri-pt--sent')).toHaveLength(1);
    // Priya is answered, so the professor opens first, with the new draft.
    expect((host.querySelector('.tri-reply__text') as HTMLTextAreaElement).value).toBe('New draft for the professor');
  });

  it('folds each answer’s work into the card’s turn, so the card stays last', () => {
    const w = card(8);
    const item = (w as { items: TriageItem[] }).items[0];
    const t = buildTranscript('reply to my unread mail', [
      { type: 'thinking', text: 'Here they are.', at: 1 },
      { type: 'widget', id: 'w9', widget: w, at: 2 },
      { type: 'done', summary: 'Here they are.', iterations: 1, at: 3 },
      { type: 'user_input', text: triagePrompt({ decision: 'yes', widget: 'w9', item: 'm1' }, item), at: 4 },
      { type: 'tool_call', name: 'mcp__google__gmail_send', args: {}, iteration: 2, at: 5 },
      { type: 'tool_result', name: 'mcp__google__gmail_send', ok: true, preview: 'sent', ms: 9, at: 6 },
      { type: 'done', summary: 'Sent.', iterations: 2, at: 7 },
      { type: 'user_input', text: 'thanks, now what is on my calendar?', at: 8 },
    ]);
    const turns = toTurns(t.blocks, false, 0);
    expect(turns).toHaveLength(2);
    expect(turns[0].widgets).toHaveLength(1);
    expect(turns[0].work.some((b) => b.kind === 'tool')).toBe(true);
    expect(turns[0].reply).toBe('Here they are.');
    expect(turns[1].user?.text).toBe('thanks, now what is on my calendar?');
    // The answer itself reads as what the user did.
    expect(t.blocks.find((b) => b.kind === 'user' && b.answer)).toMatchObject({ text: 'Yes, send my reply to Priya Shah.' });
  });
});
