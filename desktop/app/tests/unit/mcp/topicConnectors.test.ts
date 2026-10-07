/**
 * Keyless connectors join a task by its topic (main/mcp/catalog.ts
 * connectionsForPrompt): a travel task searches Kiwi.com and trivago
 * instead of driving Google Flights page by page.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/main/logger', () => ({
  mainLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { connectionsForPrompt, connectorHint, findServerDefinition } from '../../../src/main/mcp/catalog';
import { usableServers } from '../../../src/main/mcp/config';

const ids = (text: string, stored: Array<{ id: string; enabled: boolean }> = []) => connectionsForPrompt(text, stored).map((c) => c.id);

describe('topic connectors', () => {
  it('gives flights to flight tasks, hotels to hotel tasks, and both to a trip', () => {
    expect(ids('cheapest flight to canada')).toEqual(['remote_kiwi']);
    expect(ids('find a hotel in Goa under 4000 a night')).toEqual(['remote_trivago']);
    expect(ids('plan a 3-day trip to Jaipur')).toEqual(['remote_kiwi', 'remote_trivago']);
  });

  it('stays out of everything else', () => {
    for (const prompt of ['clean up my downloads folder', 'turn on night light', 'reply to the mail about the room booking form', 'stay signed in to github']) {
      expect(ids(prompt)).toEqual([]);
    }
  });

  it('respects a connector the user switched off', () => {
    expect(ids('flights to delhi', [{ id: 'remote_kiwi', enabled: false }])).toEqual([]);
  });

  it('names the tools and how to use them, and resolves to the hosted servers', () => {
    const [kiwi] = connectionsForPrompt('flights to delhi', []);
    expect(kiwi.toolNames).toContain('search-flight');
    expect(connectorHint('remote_kiwi')).toMatch(/dex-ui cards/);
    expect(findServerDefinition('remote_trivago')?.displayName).toBe('trivago hotels');
    // Keyless: usable with no credential at all.
    expect(usableServers(connectionsForPrompt('a trip to Goa', [])).map((s) => s.definition.id)).toEqual(['remote_kiwi', 'remote_trivago']);
  });
});
