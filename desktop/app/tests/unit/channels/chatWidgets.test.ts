/**
 * A task's widgets as chat messages (main/channels/chatWidgets.ts): the text,
 * the buttons, and the numbered form for WhatsApp.
 */
import { describe, expect, it } from 'vitest';
import { numbered, pickedReply, widgetToChat } from '../../../src/main/channels/chatWidgets';
import type { Widget } from '../../../src/shared/widgets';

describe('widgets in a chat', () => {
  it('a one-choice question: its answers become buttons, values as the reply', () => {
    const p = widgetToChat({ type: 'ask', title: 'Which cabin?', fields: [{ id: 'c', kind: 'choice', options: ['Economy', { label: 'Business', value: 'business class' }] }] } as Widget);
    expect(p?.asks).toBe(true);
    expect(p?.text).toContain('*Which cabin?*');
    expect(p?.rows.flat()).toEqual([{ label: 'Economy', reply: 'Economy' }, { label: 'Business', reply: 'business class' }]);
  });

  it('a form of several fields: listed, answered in one message', () => {
    const p = widgetToChat({ type: 'ask', title: 'Your trip', fields: [
      { id: 'from', kind: 'place', label: 'From', suggestions: ['Hyderabad (HYD)'] },
      { id: 'date', kind: 'date', label: 'Depart' },
    ] } as Widget);
    expect(p?.rows).toEqual([]);
    expect(p?.text).toContain('• *From*: e.g. Hyderabad (HYD)');
    expect(p?.text).toContain('• *Depart*: a date');
    expect(p?.text).toContain('Answer in one message');
  });

  it('numbered for WhatsApp, with links written out', () => {
    const p = widgetToChat({ type: 'buttons', title: 'Next?', buttons: [{ label: 'Book it', reply: 'Book it' }, { label: 'Open site', url: 'https://example.com' }] } as Widget);
    const n = numbered(p!);
    expect(n.replies).toEqual(['Book it']);
    expect(n.text).toContain('*1.* Book it');
    expect(n.text).toContain('Open site: https://example.com');
  });

  it('reads a pick: "2", "#2", "2." or the answer\'s own words', () => {
    const replies = ['economy', 'business class'];
    const labels = ['Economy', 'Business'];
    expect(pickedReply('2', replies, labels)).toBe('business class');
    expect(pickedReply('#1', replies, labels)).toBe('economy');
    expect(pickedReply('2.', replies, labels)).toBe('business class');
    expect(pickedReply('business', replies, labels)).toBe('business class');
    expect(pickedReply('3', replies, labels)).toBeNull();
    expect(pickedReply('remember the milk', replies, labels)).toBeNull();
  });

  it('what needs the app says so', () => {
    expect(widgetToChat({ type: 'custom', title: 'Dashboard', html: '<p>x</p>' } as Widget)?.text).toContain('Open the task in DEX');
  });
});
