// @vitest-environment jsdom
/**
 * The chat's widgets (Widgets.tsx): one tap answers a one-field question, a
 * form sends once it's filled, an answered question folds away, and cards
 * and buttons open links or send their reply.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetView } from '../../../../src/renderer/hub/chat/Widgets';
import { parseWidget, type Widget } from '../../../../src/shared/widgets';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const spec = (raw: unknown): Widget => {
  const { widget, error } = parseWidget(raw);
  if (!widget) throw new Error(error);
  return widget;
};

describe('widgets in the chat', () => {
  let host: HTMLDivElement;
  let root: Root;
  const onReply = vi.fn();
  const onOpenUrl = vi.fn();

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    onReply.mockReset();
    onOpenUrl.mockReset();
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  const render = (w: Widget, answered = false) => act(() => root.render(<WidgetView widget={w} answered={answered} onReply={onReply} onOpenUrl={onOpenUrl} />));
  const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

  it('answers a one-field choice in one tap, then folds to "answered"', () => {
    render(spec({ type: 'ask', title: 'Which cabin?', fields: [{ kind: 'choice', options: ['Economy', 'Business'] }] }));
    act(() => button('Business').click());
    expect(onReply).toHaveBeenCalledWith('Business');
    expect(host.querySelector('.cx-w--done')?.textContent).toContain('Which cabin?');
    expect(button('Economy')).toBeUndefined();
  });

  it('answers a place from a suggestion, or from what you type', () => {
    render(spec({ type: 'ask', title: 'Where are you flying from?', fields: [{ kind: 'place', suggestions: ['Hyderabad (HYD)'] }] }));
    act(() => button('Hyderabad (HYD)').click());
    expect(onReply).toHaveBeenLastCalledWith('Hyderabad (HYD)');
  });

  it('sends a day from the strip with its ISO date', () => {
    render(spec({ type: 'ask', title: 'Which day?', fields: [{ kind: 'date' }] }));
    act(() => button('Today').click());
    const now = new Date();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(onReply.mock.calls[0][0]).toContain(`(${iso})`);
  });

  it('holds a form until every field is filled, then sends labelled lines', () => {
    render(spec({
      type: 'ask', title: 'Your trip', submit: 'Find flights',
      fields: [{ kind: 'place', label: 'From', suggestions: ['Hyderabad (HYD)'] }, { kind: 'time', label: 'Leaving', slots: ['07:00', '19:30'] }, { kind: 'number', label: 'Travellers', min: 1, unit: 'adults' }],
    }));
    const send = button('Find flights');
    expect(send.disabled).toBe(true);
    act(() => button('Hyderabad (HYD)').click());
    act(() => button('7:30 pm').click());
    expect(onReply).not.toHaveBeenCalled();
    act(() => [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'More')!.click());
    expect(send.disabled).toBe(false);
    act(() => send.click());
    expect(onReply).toHaveBeenCalledWith('From: Hyderabad (HYD)\nLeaving: 7:30 pm (19:30)\nTravellers: 2 adults');
  });

  it('shows an answered question as one quiet line', () => {
    render(spec({ type: 'ask', title: 'Which cabin?', fields: [{ kind: 'choice', options: ['Economy', 'Business'] }] }), true);
    expect(host.querySelector('.cx-w--done')).not.toBeNull();
    expect(host.querySelectorAll('.cx-w-opt')).toHaveLength(0);
  });

  it('opens a card’s link and sends its reply; a geo: link opens as a map', () => {
    render(spec({
      type: 'cards', title: 'Cheapest flights', icon: 'flight',
      items: [{ title: 'IndiGo 6E 2345', subtitle: '07:05 → 09:15', price: '₹4,850', badge: 'Cheapest',
        actions: [{ label: 'Select', reply: 'Book IndiGo 6E 2345 at 07:05' }, { label: 'Open', url: 'https://www.google.com/travel/flights?q=x' }] }],
    }));
    expect(host.textContent).toContain('₹4,850');
    act(() => button('Select').click());
    expect(onReply).toHaveBeenCalledWith('Book IndiGo 6E 2345 at 07:05');
    act(() => button('Open').click());
    expect(onOpenUrl).toHaveBeenCalledWith('https://www.google.com/travel/flights?q=x');

    render(spec({ type: 'buttons', buttons: [{ label: 'Directions', url: 'geo:17.385,78.4867' }] }));
    act(() => button('Directions').click());
    expect(onOpenUrl).toHaveBeenLastCalledWith('https://www.google.com/maps/search/?api=1&query=17.385,78.4867');
  });
});
