/**
 * The pure typing-detection half of @-mentions — is the caret inside an
 * in-progress "@partial", and which known mentions match it. The risk worth
 * testing is the false positive — an email address must never trigger the
 * dropdown. The actual chip insertion is DOM surgery tested separately in
 * MentionTextField.spec.tsx, which needs a real (jsdom) Selection/Range to
 * exercise at all.
 */
import { describe, expect, it } from 'vitest';
import { activeMentionQuery, matchingMentions, MENTIONS } from '../../../src/renderer/hub/mentions';

describe('activeMentionQuery', () => {
  it('finds a bare @ at the start of the text', () => {
    expect(activeMentionQuery('@', 1)).toBe('');
  });

  it('finds a partial word after @', () => {
    expect(activeMentionQuery('@dr', 3)).toBe('dr');
  });

  it('finds an @mention preceded by whitespace mid-sentence', () => {
    const text = 'find my slp da @dri as well as pc';
    const cursor = text.indexOf('@dri') + '@dri'.length;
    expect(activeMentionQuery(text, cursor)).toBe('dri');
  });

  it('is null once the caret has moved past the mention (a space was typed)', () => {
    expect(activeMentionQuery('@drive ', 7)).toBeNull();
  });

  it('never matches an email-style @ with no preceding whitespace', () => {
    expect(activeMentionQuery('contact user@dri', 16)).toBeNull();
  });

  it('is null when the caret is not at the end of the text', () => {
    // Cursor sits before the @, not after it.
    expect(activeMentionQuery('@drive rest', 0)).toBeNull();
  });
});

describe('matchingMentions', () => {
  it('lists everything for a bare @', () => {
    expect(matchingMentions('@', 1).length).toBe(MENTIONS.length);
  });

  it('filters by the partial word typed so far', () => {
    expect(matchingMentions('@dr', 3).map((m) => m.name)).toEqual(['drive']);
    expect(matchingMentions('@zz', 3)).toEqual([]);
  });

  it('is empty outside a mention context', () => {
    expect(matchingMentions('just a normal sentence', 10)).toEqual([]);
  });
});
