import { describe, expect, it } from 'vitest';
import { friendlyModel } from '../../../../src/renderer/hub/chat/modelName';

describe('friendlyModel', () => {
  it('says models the way people do', () => {
    expect(friendlyModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(friendlyModel('claude-opus-5-5')).toBe('Opus 5.5');
    expect(friendlyModel('claude-sonnet-5')).toBe('Sonnet 5');
    expect(friendlyModel('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5');
    expect(friendlyModel('openai/gpt-5.1-codex')).toBe('GPT-5.1 Codex');
    expect(friendlyModel('qwen3-coder-plus')).toBe('qwen3-coder-plus');
    expect(friendlyModel(undefined)).toBeNull();
  });
});
