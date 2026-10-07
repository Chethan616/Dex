/**
 * The lines every engine's prompt carries about reaching the user
 * (engines/delivery.ts): widgets for questions and results, except on
 * WhatsApp and Telegram, where nothing but text arrives.
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

  it('keeps plain questions on WhatsApp and Telegram, which can’t show a widget', () => {
    for (const [channel, name] of [['whatsapp', 'WhatsApp'], ['telegram', 'Telegram']]) {
      const text = deliveryBriefing(ctx(channel)).join('\n');
      expect(text).not.toContain('dex-ui');
      expect(text).toContain(`This task came from ${name}`);
      expect(text).toContain(`sent to them as a ${name} message`);
    }
  });
});
