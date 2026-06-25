import { expect, test, describe, afterAll } from 'vitest';
import { resolveModel } from '../../src/llm/model-router.js';

describe('model router routing and fallbacks', () => {
  const originalEnv = { ...process.env };

  afterAll(() => {
    process.env = originalEnv;
  });

  test('resolves primary when keys are present', () => {
    process.env.GEMINI_API_KEY = 'mock-key';
    const resolved = resolveModel(1);
    expect(resolved.model).toBe('gemini-2.5-flash-lite');
    expect(resolved.providerId).toBe('gemini');
  });

  test('falls back to alternate provider when primary key is missing', () => {
    delete process.env.GEMINI_API_KEY;
    process.env.GROQ_API_KEY = 'mock-key';

    const resolved = resolveModel(1);
    expect(resolved.model).toBe('groq/llama-4-scout-17b');
    expect(resolved.providerId).toBe('groq');
  });
});
