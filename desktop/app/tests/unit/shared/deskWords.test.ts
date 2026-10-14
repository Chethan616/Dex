/**
 * The Windows tools in plain words (shared/deskWords.ts): what the chat and
 * the Desk tab say for each troubleshooting step.
 */
import { describe, expect, it } from 'vitest';
import { deskWords, storeName } from '../../../src/shared/deskWords';
import { ACTION_NAMES } from '../../../mcp-servers/windows/actions.mjs';
import { TOOL_BY_NAME } from '../../../mcp-servers/windows/tools.mjs';

describe('desk words', () => {
  it('has its own words for every change DEX can make', () => {
    for (const action of ACTION_NAMES) {
      expect(deskWords('system_change', { action, args: {} }).done, action).not.toBe('Changed a setting');
    }
  });

  it('has its own words for every PC topic DEX can read', () => {
    const topics = (TOOL_BY_NAME.get('system_info')!.inputSchema.properties as any).topic.enum as string[];
    for (const topic of topics) {
      expect(deskWords('system_info', { topic, name: 'WhatsApp' }).done, topic).not.toBe('Checked your PC');
    }
  });

  it('names the app it checks or resets the way people say it', () => {
    expect(deskWords('system_info', { topic: 'app', name: 'WhatsApp' }).active).toBe('Checking WhatsApp');
    expect(storeName('5319275A.WhatsAppDesktop_cv1g1gvanyjgm')).toBe('WhatsApp Desktop');
    expect(deskWords('system_change', { action: 'app_reset', args: { package: '5319275A.WhatsAppDesktop' } }).done).toBe('Reset WhatsApp Desktop');
    expect(deskWords('system_change', { action: 'startup_disable', args: { name: 'Steam' } }).done).toBe('Stopped Steam from starting with Windows');
  });
});
