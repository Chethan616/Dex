/**
 * The widget kit's contract (shared/widgets.ts): what an agent's spec may
 * say, the fixable error when it doesn't fit, and the message an answer sends.
 */
import { describe, expect, it } from 'vitest';
import { formatAnswer, parseWidget, quickReplies, widgetLine, type AskWidget } from '../../../src/shared/widgets';
import { appendEvent, EMPTY_TRANSCRIPT } from '../../../src/renderer/logs/transcript';
import { toTurns } from '../../../src/renderer/hub/chat/turns';

const flightForm = {
  type: 'ask',
  title: 'Where and when are you flying?',
  fields: [
    { kind: 'place', label: 'From', suggestions: ['Hyderabad (HYD)', 'Bengaluru (BLR)'] },
    { id: 'date', kind: 'date', label: 'Date' },
    { kind: 'number', label: 'Travellers', min: 1, max: 9, unit: 'adults' },
  ],
};

describe('a widget spec', () => {
  it('gets ids for fields that have none, and a submit button for a form', () => {
    const { widget } = parseWidget(flightForm);
    expect(widget?.type).toBe('ask');
    if (widget?.type !== 'ask') return;
    expect(widget.fields.map((f) => f.id)).toEqual(['f1', 'date', 'f3']);
    expect(widget.submit).toBe('Send');
  });

  it('says exactly which key is wrong, so the agent can fix it', () => {
    expect(parseWidget({ type: 'ask', title: 'When?', fields: [{ kind: 'date', default: '9/10/2026' }] }).error).toMatch(/fields\.0\.default: dates are YYYY-MM-DD/);
    expect(parseWidget({ type: 'buttons', buttons: [{ label: 'Go', url: 'javascript:alert(1)' }] }).error).toMatch(/buttons\.0\.url/);
    expect(parseWidget({ type: 'buttons', buttons: [{ label: 'Go', url: 'https://a.b', reply: 'x' }] }).error).toMatch(/a url or a reply/);
    expect(parseWidget({ type: 'ask', title: 'Pick', fields: [{ kind: 'choice', options: ['only one'] }] }).error).toMatch(/options/);
    expect(parseWidget({ type: 'banner', text: 'hi' }).error).toBeTruthy();
  });

  it('answers a one-field question with just the value, and a form with labelled lines', () => {
    const solo = parseWidget({ type: 'ask', title: 'From where?', fields: [{ kind: 'place' }] }).widget as AskWidget;
    expect(formatAnswer(solo, { f1: { kind: 'place', text: ' Hyderabad (HYD) ' } })).toBe('Hyderabad (HYD)');

    const form = parseWidget(flightForm).widget as AskWidget;
    expect(formatAnswer(form, {
      f1: { kind: 'place', text: 'Hyderabad (HYD)' },
      date: { kind: 'date', start: '2026-10-09' },
      f3: { kind: 'number', n: 2 },
    })).toBe('From: Hyderabad (HYD)\nDate: Fri 9 Oct 2026 (2026-10-09)\nTravellers: 2 adults'.replace('Fri 9 Oct 2026', new Date(2026, 9, 9).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })));
  });

  it('gives the agent the ISO date, the 24-hour time and an option’s own value', () => {
    const w = parseWidget({
      type: 'ask', title: 'Booking',
      fields: [
        { id: 'when', kind: 'date', range: true },
        { id: 'at', kind: 'time', slots: ['19:30'] },
        { id: 'cabin', kind: 'choice', options: [{ label: 'Economy', value: 'ECONOMY' }, 'Business'] },
      ],
    }).widget as AskWidget;
    const text = formatAnswer(w, {
      when: { kind: 'date', start: '2026-10-09', end: '2026-10-11' },
      at: { kind: 'time', time: '19:30' },
      cabin: { kind: 'choice', picked: ['Economy'] },
    });
    expect(text).toContain('(2026-10-09 to 2026-10-11)');
    expect(text).toContain('at: 7:30 pm (19:30)');
    expect(text).toContain('cabin: Economy (ECONOMY)');
  });

  it('offers quick replies for a choice or a place with suggestions, and a line for previews', () => {
    expect(quickReplies(parseWidget({ type: 'ask', title: 'Cabin?', fields: [{ kind: 'choice', options: ['Economy', 'Business'] }] }).widget!)).toEqual(['Economy', 'Business']);
    expect(quickReplies(parseWidget(flightForm).widget!)).toEqual([]);
    expect(widgetLine(parseWidget({ type: 'cards', title: 'Cheapest flights', items: [{ title: 'IndiGo 6E 2345' }] }).widget!)).toBe('Cheapest flights');
  });
});

describe('a widget in the chat', () => {
  it('folds into its turn, and an invalid one is dropped rather than shown broken', () => {
    let t = EMPTY_TRANSCRIPT;
    t = appendEvent(t, { type: 'user_input', text: 'find the cheapest flight to Delhi on Friday' });
    t = appendEvent(t, { type: 'thinking', text: 'Where from?' });
    t = appendEvent(t, { type: 'widget', id: 'w1', widget: { type: 'ask', title: 'Where are you flying from?', fields: [{ kind: 'place' }] } });
    t = appendEvent(t, { type: 'widget', id: 'w2', widget: { type: 'nope' } });
    expect(t.blocks.filter((b) => b.kind === 'widget')).toHaveLength(1);
    const [turn] = toTurns(t.blocks, false);
    expect(turn.widgets).toHaveLength(1);
    expect(turn.widgets[0].wid).toBe('w1');
    expect(turn.reply).toBe('Where from?');
  });
});
