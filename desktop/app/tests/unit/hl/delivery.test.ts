/**
 * The lines every engine's prompt carries about reaching the user
 * (engines/delivery.ts): widgets for questions and results; in a chat app
 * (WhatsApp, Telegram, Discord) the short version, since they arrive there
 * as a message with buttons.
 */
import { describe, expect, it } from 'vitest';
import { deliveryBriefing } from '../../../src/main/hl/engines/delivery';
import type { SpawnContext } from '../../../src/main/hl/engines/types';

const ctx = (originChannel?: string) => ({ originChannel } as unknown as SpawnContext);

describe('the delivery briefing', () => {
  it('tells the agent to ask with widgets and show results as cards, from the desktop and the phone', () => {
    for (const channel of [undefined, 'android']) {
      const text = deliveryBriefing(ctx(channel)).join('\n');
      expect(text).toContain('never ask in prose');
      expect(text).toContain('dex-ui choose');
      expect(text).toContain('dex-ui cards');
      expect(text).toContain('dex-ui link');
    }
  });

  it('in a chat app, asks one question at a time with buttons, and keeps the answer short', () => {
    for (const [channel, name] of [['whatsapp', 'WhatsApp'], ['telegram', 'Telegram'], ['discord', 'Discord']]) {
      const text = deliveryBriefing(ctx(channel)).join('\n');
      expect(text).toContain('dex-ui choose');
      expect(text).toContain(`arrives as a ${name} message with`);
      expect(text).not.toContain('never ask in prose');
      expect(text).toContain(`This task came from ${name}`);
      expect(text).toContain(`sent to them as a ${name} message`);
    }
    expect(deliveryBriefing(ctx('whatsapp')).join('\n')).toContain('numbered answers');
    expect(deliveryBriefing(ctx('telegram')).join('\n')).toContain('buttons they tap');
  });
});
