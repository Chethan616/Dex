/**
 * The widget kit's contract (shared/widgets.ts): what an agent's spec may
 * say, the fixable error when it doesn't fit, and the message an answer sends.
 */
import { describe, expect, it } from 'vitest';
import { fieldShown, formatAnswer, parseWidget, quickReplies, widgetLine, type AskWidget } from '../../../src/shared/widgets';
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
    expect(parseWidget({ type: 'buttons', buttons: [{ label: 'Go' }] }).error).toMatch(/a url or a reply/);
    // Both given: the link wins, rather than refusing the button.
    expect(parseWidget({ type: 'buttons', buttons: [{ label: 'Go', url: 'https://a.b', reply: 'x' }] }).widget).toMatchObject({ buttons: [{ url: 'https://a.b' }] });
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

describe('what agents actually write', () => {
  it('reads the spec a live run sent — fields as a map, `type` for kind, `value` for default — that "Invalid input" refused twice', () => {
    const live = {
      from: { type: 'text', label: 'Departure city', placeholder: 'e.g., Bangalore, Chennai' },
      date: { type: 'date', label: 'Travel date' },
      passengers: { type: 'number', label: 'Number of passengers', value: 1 },
    };
    const { widget, error } = parseWidget(live, { type: 'ask' });
    expect(error).toBeNull();
    expect(widget).toMatchObject({
      type: 'ask', title: 'A few details', submit: 'Send',
      fields: [
        { id: 'from', kind: 'place', label: 'Departure city', placeholder: 'e.g., Bangalore, Chennai' },
        { id: 'date', kind: 'date', label: 'Travel date' },
        { id: 'passengers', kind: 'number', label: 'Number of passengers', default: 1 },
      ],
    });
    expect(parseWidget(live, { type: 'ask', title: 'Flight details' }).widget).toMatchObject({ title: 'Flight details' });
  });

  it('reads common names for kinds and keys', () => {
    const { widget } = parseWidget({
      question: 'Your trip',
      fields: [
        { name: 'cabin', type: 'select', choices: ['Economy', { title: 'Business', description: 'Lie-flat' }] },
        { label: 'Dates', type: 'date_range' },
        { label: 'Extras', type: 'checkboxes', options: ['Bag', 'Meal'] },
        { label: 'Return?', type: 'boolean' },
        { label: 'Leave at', type: 'time', options: ['07:00', '19:30'] },
        { label: 'Bags', type: 'integer', min: '0', max: '3' },
      ],
    });
    expect(widget).toMatchObject({
      type: 'ask', title: 'Your trip',
      fields: [
        { kind: 'choice', label: 'cabin', options: ['Economy', { label: 'Business', detail: 'Lie-flat' }] },
        { kind: 'date', range: true },
        { kind: 'choice', multi: true, options: ['Bag', 'Meal'] },
        { kind: 'choice', options: ['Yes', 'No'] },
        { kind: 'time', slots: ['07:00', '19:30'] },
        { kind: 'number', min: 0, max: 3 },
      ],
    });
    expect(parseWidget({ facts: { Flight: '6E 2345', Price: 4850 } }, { type: 'facts' }).widget).toMatchObject({ type: 'facts', rows: [{ label: 'Flight', value: '6E 2345' }, { label: 'Price', value: '4850' }] });
    expect(parseWidget([{ text: 'Open', href: 'https://a.b' }], { type: 'buttons' }).widget).toMatchObject({ type: 'buttons', buttons: [{ label: 'Open', url: 'https://a.b' }] });
    expect(parseWidget({ results: [{ name: 'IndiGo', description: '07:05', buttons: [{ label: 'Select', message: 'Book it' }] }] }, { type: 'cards' }).widget)
      .toMatchObject({ type: 'cards', items: [{ title: 'IndiGo', subtitle: '07:05', actions: [{ label: 'Select', reply: 'Book it' }] }] });
  });

  it('when it still doesn’t fit, says what and shows the shape to use', () => {
    const { error } = parseWidget({ type: 'ask', title: 'When?', fields: [{ kind: 'date', default: '9/10/2026' }] });
    expect(error).toMatch(/fields\.0\.default: dates are YYYY-MM-DD/);
    expect(error).toMatch(/A ask looks like \{"title":"Where and when are you flying\?"/);
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

describe('conditional fields (showIf)', () => {
  const trip = parseWidget({
    type: 'ask',
    title: 'Flight',
    fields: [
      { id: 'trip', kind: 'choice', label: 'Trip', options: ['One way', 'Round trip'] },
      { id: 'depart', kind: 'date', label: 'Depart' },
      { id: 'back', kind: 'date', label: 'Return', showIf: { field: 'trip', is: 'Round trip' } },
    ],
  }).widget as AskWidget;
  const [tripField, , back] = trip.fields;

  it('shows the return date only for a round trip', () => {
    expect(fieldShown(trip, back, {})).toBe(false);
    expect(fieldShown(trip, back, { trip: { kind: 'choice', picked: ['One way'] } })).toBe(false);
    expect(fieldShown(trip, back, { trip: { kind: 'choice', picked: ['round TRIP'] } })).toBe(true);
    expect(fieldShown(trip, tripField, {})).toBe(true);
  });

  it('leaves a hidden field out of the answer, even if it was filled before switching', () => {
    const values = {
      trip: { kind: 'choice' as const, picked: ['One way'] },
      depart: { kind: 'date' as const, start: '2026-10-09' },
      back: { kind: 'date' as const, start: '2026-10-12' },
    };
    const text = formatAnswer(trip, values);
    expect(text).toContain('Trip: One way');
    expect(text).toContain('Depart: ');
    expect(text).not.toContain('Return');
  });

  it('reads the names agents tend to use, and a list of answers', () => {
    const w = parseWidget({
      type: 'ask',
      title: 'Stay',
      fields: [
        { id: 'kind', kind: 'choice', options: ['Hotel', 'Hostel', 'Apartment'] },
        { id: 'rooms', kind: 'number', when: { field: 'kind', equals: ['Hotel', 'Hostel'] } },
      ],
    }).widget as AskWidget;
    expect(w.fields[1].showIf).toEqual({ field: 'kind', is: ['Hotel', 'Hostel'] });
  });
});
