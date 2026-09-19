/**
 * The alias table and initialism check are what let a query use words the
 * file itself never spells out. These are pure functions, so the tests hit
 * them directly rather than through a database.
 */
import { describe, expect, it } from 'vitest';
import { groupSatisfied, initialismMatch, literalMatch, parseQuery } from '../../../src/main/search/aliases';

describe('parseQuery', () => {
  it('splits into lowercase term-groups, deduplicated', () => {
    const groups = parseQuery('Cryptography Cryptography Syllabus');
    expect(groups.map((g) => g.original)).toEqual(['cryptography', 'syllabus']);
  });

  it('drops type words that describe the file kind, not its content', () => {
    const groups = parseQuery('cryptography syllabus sheet pdf');
    expect(groups.map((g) => g.original)).toEqual(['cryptography', 'syllabus']);
  });

  it('falls back to the raw tokens when only type words were given', () => {
    const groups = parseQuery('pdf files');
    expect(groups.length).toBeGreaterThan(0);
  });

  it('expands a known alias group', () => {
    const groups = parseQuery('da');
    expect(groups[0].variants).toContain('assessment');
    expect(groups[0].variants).toContain('ast');
  });
});

describe('literalMatch', () => {
  it('matches any variant as a substring, case-insensitively', () => {
    const [group] = parseQuery('da');
    expect(literalMatch('23BAI0093_VL2026270103245_AST01.pdf', group)).toBe(true);
    expect(literalMatch('nothing relevant here', group)).toBe(false);
  });
});

describe('initialismMatch', () => {
  it('matches consecutive word initials, skipping fillers', () => {
    expect(initialismMatch('This unit covers Speech and Language Processing basics', 'slp')).toBe(true);
  });

  it('matches an acronym across a filler-free run of words', () => {
    expect(initialismMatch('An introduction to Cryptography Network Security', 'cns')).toBe(true);
  });

  it('does not match when the letters are out of order', () => {
    expect(initialismMatch('Language Speech Processing', 'slp')).toBe(false);
  });

  it('refuses terms that are not short letter-only strings', () => {
    expect(initialismMatch('anything', '123')).toBe(false);
    expect(initialismMatch('anything', 'toolong1')).toBe(false);
  });
});

describe('groupSatisfied', () => {
  it('is satisfied by a literal alias match', () => {
    const [group] = parseQuery('assessment');
    expect(groupSatisfied('23BAI0093_VL2026270103245_AST01.pdf', group)).toBe(true);
  });

  it('is satisfied by an initialism match when no literal alias appears', () => {
    const [group] = parseQuery('slp');
    expect(groupSatisfied('Course notes on Speech and Language Processing fundamentals', group)).toBe(true);
  });

  it('is not satisfied when neither the term nor its aliases appear anywhere', () => {
    const [group] = parseQuery('syllabus');
    expect(groupSatisfied('an unrelated grocery list', group)).toBe(false);
  });
});
