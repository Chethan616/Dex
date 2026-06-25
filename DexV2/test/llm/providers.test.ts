import { expect, test, describe, vi, afterEach } from 'vitest';
import { GeminiProvider } from '../../src/llm/providers/gemini.js';
import { ClaudeProvider } from '../../src/llm/providers/claude.js';
import { GroqProvider } from '../../src/llm/providers/groq.js';

describe('LLM Providers fetch wrappers', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GROQ_API_KEY;
  });

  test('GeminiProvider calls correct endpoint and headers', async () => {
    process.env.GEMINI_API_KEY = 'mock-gemini-key';

    const mockResponse = {
      ok: true,
      body: {
        getReader() {
          let count = 0;
          return {
            async read() {
              if (count === 0) {
                count++;
                const encoder = new TextEncoder();
                return {
                  done: false,
                  value: encoder.encode('data: {"candidates": [{"content": {"parts": [{"text": "hello"}]}}]}\n')
                };
              }
              return { done: true, value: undefined };
            },
            releaseLock() {}
          };
        }
      }
    };

    let fetchUrl = '';
    let fetchOptions: any = null;

    global.fetch = vi.fn().mockImplementation((url, options) => {
      fetchUrl = url as string;
      fetchOptions = options;
      return Promise.resolve(mockResponse as any);
    });

    const provider = new GeminiProvider();
    const chunks = [];
    for await (const chunk of provider.chat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'gemini-2.5-flash-lite',
      tier: 1
    })) {
      chunks.push(chunk);
    }

    expect(fetchUrl).toContain('gemini-2.5-flash-lite');
    expect(fetchUrl).toContain('key=mock-gemini-key');
    expect(fetchOptions.method).toBe('POST');
    expect(chunks[0].text).toBe('hello');
  });

  test('ClaudeProvider sets Anthropic headers and cache_control', async () => {
    process.env.ANTHROPIC_API_KEY = 'mock-claude-key';

    const mockResponse = {
      ok: true,
      body: {
        getReader() {
          let count = 0;
          return {
            async read() {
              if (count === 0) {
                count++;
                const encoder = new TextEncoder();
                return {
                  done: false,
                  value: encoder.encode('data: {"type": "content_block_delta", "delta": {"text": "world"}}\n')
                };
              }
              return { done: true, value: undefined };
            },
            releaseLock() {}
          };
        }
      }
    };

    let fetchUrl = '';
    let fetchOptions: any = null;

    global.fetch = vi.fn().mockImplementation((url, options) => {
      fetchUrl = url as string;
      fetchOptions = options;
      return Promise.resolve(mockResponse as any);
    });

    const provider = new ClaudeProvider();
    const chunks = [];
    for await (const chunk of provider.chat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-sonnet-4-5',
      tier: 2
    })) {
      chunks.push(chunk);
    }

    expect(fetchUrl).toBe('https://api.anthropic.com/v1/messages');
    expect(fetchOptions.headers['x-api-key']).toBe('mock-claude-key');
    expect(fetchOptions.headers['anthropic-version']).toBe('2023-06-01');

    const body = JSON.parse(fetchOptions.body);
    expect(body.system[0].cache_control.type).toBe('ephemeral');
    expect(chunks[0].text).toBe('world');
  });
});
