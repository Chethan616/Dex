import { expect, test, describe, afterEach } from 'vitest';
import { resolveModel } from '../../src/llm/model-router.js';

describe('model router routing and fallbacks', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('prefers Groq automatically when a Groq key is present', () => {
    process.env.GEMINI_API_KEY = 'mock-key';
    process.env.GROQ_API_KEY = 'mock-groq-key';
    const resolved = resolveModel(1);
    expect(resolved.model).toBe('openai/gpt-oss-20b');
    expect(resolved.providerId).toBe('groq');
  });

  test('falls back to Gemini when Groq is unavailable', () => {
    delete process.env.GROQ_API_KEY;
    process.env.GEMINI_API_KEY = 'mock-gemini-key';

    const resolved = resolveModel(1);
    expect(resolved.model).toBe('gemini-2.5-flash-lite');
    expect(resolved.providerId).toBe('gemini');
  });

  test('supports explicit auto mode for multi-provider routing', () => {
    process.env.DEX_PROVIDER_MODE = 'auto';
    process.env.GEMINI_API_KEY = 'mock-gemini-key';
    process.env.GROQ_API_KEY = 'mock-groq-key';

    const resolved = resolveModel(1);
    expect(resolved.model).toBe('gemini-2.5-flash-lite');
    expect(resolved.providerId).toBe('gemini');
  });

  test('falls back to Groq when the preferred provider key is missing', () => {
    process.env.DEX_PROVIDER_MODE = 'auto';
    delete process.env.GEMINI_API_KEY;
    process.env.GROQ_API_KEY = 'mock-key';

    const resolved = resolveModel(1);
    expect(resolved.model).toBe('openai/gpt-oss-20b');
    expect(resolved.providerId).toBe('groq');
  });
});
