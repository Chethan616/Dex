import { describe, it, expect, vi } from 'vitest';
import { searchWeb } from '../../../src/main/search/websearch';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('searchWeb', () => {
  it('returns an error with no items when no API key is configured', async () => {
    const result = await searchWeb('node lts version', 10, fakeFetch(200, {}), null);
    expect(result.ok).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.error).toMatch(/no web search api key/i);
  });

  it('maps Brave Search web results into the shared {title,url,snippet} shape', async () => {
    const fetchImpl = fakeFetch(200, {
      web: {
        results: [
          { title: 'Node.js', url: 'https://nodejs.org', description: 'Node.js LTS release info' },
          { title: 'Missing url', description: 'should be dropped' },
        ],
      },
    });
    const result = await searchWeb('node lts version', 10, fetchImpl, 'fake-key');
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([
      { title: 'Node.js', url: 'https://nodejs.org', snippet: 'Node.js LTS release info' },
    ]);
  });

  it('sends the query, count, and subscription token header', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(String(url)).toContain('q=node');
      expect(String(url)).toContain('count=5');
      return { ok: true, status: 200, json: async () => ({ web: { results: [] } }) };
    }) as unknown as typeof fetch;
    await searchWeb('node', 5, fetchImpl, 'my-key');
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ 'X-Subscription-Token': 'my-key' });
  });

  it('clamps an out-of-range limit into Brave\'s accepted count range', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(String(url)).toContain('count=20');
      return { ok: true, status: 200, json: async () => ({ web: { results: [] } }) };
    }) as unknown as typeof fetch;
    await searchWeb('node', 500, fetchImpl, 'my-key');
  });

  it('reports a non-2xx response as an error rather than throwing', async () => {
    const result = await searchWeb('node', 10, fakeFetch(401, {}), 'bad-key');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/401/);
  });

  it('reports a network failure as an error rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    const result = await searchWeb('node', 10, fetchImpl, 'my-key');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ECONNRESET/);
  });
});
