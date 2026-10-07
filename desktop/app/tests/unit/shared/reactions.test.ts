import { describe, expect, it } from 'vitest';
import { agentEmojis, agentMessageKey, autoReaction, endedOnQuestion, foldReactions, userMessageKey, validReaction } from '../../../src/shared/reactions';
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
    // Only DEX's show: yours, from before reacting was DEX's alone, don't.
    expect(agentEmojis(r['u:prompt'])).toEqual(['👍']);
    expect(agentEmojis(r['a:5'])).toEqual([]);
  });

  it('takes one emoji of any shape, and nothing else', () => {
    for (const e of ['👍', '❤️', '👍🏽', '👨‍👩‍👧', '🇮🇳', '🏳️‍🌈', '1️⃣', '🏴󠁧󠁢󠁳󠁣󠁴󠁿']) expect(validReaction('u:prompt', e)?.emoji).toBe(e);
    for (const e of ['', 'ok', '👍 nice', '123', 'a👍']) expect(validReaction('u:prompt', e)).toBeNull();
    expect(validReaction('x:1', '👍')).toBeNull();
    expect(validReaction('u:abc', '👍')).toBeNull();
  });

  it('reacts on its own only when it says something: 👍 to a go-ahead after a question, ❤️ to thanks', () => {
    expect(autoReaction('ok go on', true)).toBe('👍');
    expect(autoReaction('Yes please!', true)).toBe('👍');
    expect(autoReaction('book it', true)).toBe('👍');
    expect(autoReaction('ok go on', false)).toBeNull();          // nothing was asked
    expect(autoReaction('Thanks so much!', false)).toBe('❤️');
    expect(autoReaction('thank you dex 🙏', true)).toBe('❤️');
    expect(autoReaction('hahaha', false)).toBe('😂');
    expect(autoReaction('ok but use the morning flight instead please', true)).toBeNull();   // a real message
    expect(autoReaction('find trains to tpt', true)).toBeNull();
    expect(autoReaction('Hyderabad (HYD)', true)).toBeNull();     // a widget's answer
  });

  it('knows when DEX’s last turn asked something', () => {
    expect(endedOnQuestion([{ type: 'user_input', text: 'x' }, { type: 'thinking', text: 'Which date? Once you tell me, I’ll search.' }])).toBe(true);
    expect(endedOnQuestion([{ type: 'user_input', text: 'x' }, { type: 'widget', widget: { type: 'ask' } }, { type: 'done', summary: '' }])).toBe(true);
    expect(endedOnQuestion([{ type: 'user_input', text: 'x' }, { type: 'confirmation', status: 'pending' }])).toBe(true);
    expect(endedOnQuestion([{ type: 'user_input', text: 'x' }, { type: 'thinking', text: 'Booked. Your seat is 12A.' }, { type: 'done', summary: 'Booked.' }])).toBe(false);
    // A question before the last tool call isn't the turn's ending.
    expect(endedOnQuestion([{ type: 'thinking', text: 'Which one? Let me check.' }, { type: 'tool_call', name: 'Bash' }, { type: 'thinking', text: 'Done — saved.' }])).toBe(false);
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
