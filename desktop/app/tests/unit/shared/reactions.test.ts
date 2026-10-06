import { describe, expect, it } from 'vitest';
import { agentMessageKey, chipsFor, foldReactions, userMessageKey, validReaction } from '../../../src/shared/reactions';
import { latestUserMessageKey } from '../../../src/main/sessions/SessionManager';

describe('reactions', () => {
  it('names messages the same way on the PC and the phone', () => {
    expect(userMessageKey(undefined, true)).toBe('u:prompt');
    expect(userMessageKey(1700000000123, false)).toBe('u:1700000000123');
    expect(userMessageKey(undefined, false)).toBeNull();
    expect(agentMessageKey(42)).toBe('a:42');
  });

  it('folds the log into who reacted with what, taking back on off', () => {
    const r = foldReactions([
      { type: 'reaction', target: 'u:prompt', emoji: '👍', by: 'agent', on: true },
      { type: 'thinking', text: 'x' },
      { type: 'reaction', target: 'a:5', emoji: '❤️', by: 'user', on: true },
      { type: 'reaction', target: 'a:5', emoji: '😂', by: 'user', on: true },
      { type: 'reaction', target: 'a:5', emoji: '❤️', by: 'user', on: false },
      { type: 'reaction', target: 'u:prompt', emoji: '👍', by: 'user', on: true },
    ]);
    expect(r).toEqual({
      'u:prompt': [{ emoji: '👍', by: 'agent' }, { emoji: '👍', by: 'user' }],
      'a:5': [{ emoji: '😂', by: 'user' }],
    });
    expect(chipsFor(r['u:prompt'])).toEqual([{ emoji: '👍', count: 2, mine: true, agent: true }]);
  });

  it('takes one emoji of any shape, and nothing else', () => {
    for (const e of ['👍', '❤️', '👍🏽', '👨‍👩‍👧', '🇮🇳', '🏳️‍🌈', '1️⃣', '🏴󠁧󠁢󠁳󠁣󠁴󠁿']) expect(validReaction('u:prompt', e)?.emoji).toBe(e);
    for (const e of ['', 'ok', '👍 nice', '123', 'a👍']) expect(validReaction('u:prompt', e)).toBeNull();
    expect(validReaction('x:1', '👍')).toBeNull();
    expect(validReaction('u:abc', '👍')).toBeNull();
  });

  it('puts the agent’s reaction on your latest message', () => {
    expect(latestUserMessageKey([])).toBe('u:prompt');
    expect(latestUserMessageKey([
      { type: 'user_input', text: 'a', at: 10 },
      { type: 'thinking', text: 'b', at: 11 },
      { type: 'user_input', text: 'book it', at: 20 },
      { type: 'done', summary: 'ok', iterations: 1, at: 30 },
    ] as never)).toBe('u:20');
  });
});
