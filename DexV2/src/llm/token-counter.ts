import { Message } from './types.js';

export function estimateTokens(content: string, provider: 'gemini' | 'claude' | 'groq' = 'gemini'): number {
  if (!content) return 0;
  const divisor = provider === 'claude' ? 3.5 : 4.0;
  return Math.ceil(content.length / divisor);
}

export function estimateMessageTokens(messages: Message[], provider: 'gemini' | 'claude' | 'groq' = 'gemini'): number {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m.content, provider);
  }
  return total;
}
