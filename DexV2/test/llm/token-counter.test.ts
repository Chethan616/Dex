import { expect, test, describe } from 'vitest';
import { estimateTokens, estimateMessageTokens } from '../../src/llm/token-counter.js';

describe('local token counter', () => {
  test('estimates tokens based on characters', () => {
    const text = 'hello world'; // 11 chars
    expect(estimateTokens(text, 'gemini')).toBe(3); // Math.ceil(11 / 4) = 3
    expect(estimateTokens(text, 'claude')).toBe(4); // Math.ceil(11 / 3.5) = 4
  });

  test('estimates message array tokens', () => {
    const messages = [
      { role: 'system' as const, content: 'system message' }, // 14 chars
      { role: 'user' as const, content: 'hi' } // 2 chars
    ];
    expect(estimateMessageTokens(messages, 'gemini')).toBe(5);
  });
});
