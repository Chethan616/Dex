/**
 * The About-you questions and the import from another assistant: nothing
 * assumes who the user is, and what's pasted in arrives as clean facts.
 */
import { describe, expect, it } from 'vitest';
import { QUESTIONS, questionsFor } from '../../../src/shared/aboutYou';
import { looksSecret, parseImported, topicOf, topicsIn } from '../../../src/shared/memoryTopics';

describe('the About-you questions', () => {
  it('asks about studies only of someone studying, and about work only of someone working', () => {
    const ids = (a: Record<string, string>) => questionsFor(a).map((q) => q.id);
    expect(ids({})).not.toContain('study_where');
    expect(ids({})).not.toContain('work_role');
    expect(ids({ doing: 'Student' })).toEqual(expect.arrayContaining(['study_where', 'study_what', 'study_portal']));
    expect(ids({ doing: 'Student' })).not.toContain('work_role');
    expect(ids({ doing: 'Working' })).toContain('work_role');
    expect(ids({ doing: 'Student and working' })).toEqual(expect.arrayContaining(['study_where', 'work_role']));
    expect(ids({ doing: 'Retired' })).not.toContain('study_where');
  });

  it('names no particular university, city or person', () => {
    const said = JSON.stringify(QUESTIONS.map((q) => [q.ask, q.hint, q.options]));
    expect(said).not.toMatch(/VIT|vtop|Chennai|Hyderabad/i);
  });

  it('turns each answer into a note under its topic', () => {
    const q = (id: string) => QUESTIONS.find((x) => x.id === id)!;
    expect(q('city').note('Leeds, UK')).toBe('Lives in Leeds, UK');
    expect(q('seat').note('Aisle')).toBe('Prefers aisle seats when travelling');
    expect(q('never').note('Never send email without asking')).toBe('Never: send email without asking');
    expect(q('study_portal').siteAliases).toEqual(expect.arrayContaining(['attendance', 'student portal']));
  });
});

describe('topics', () => {
  it('reads a request’s topics from its words', () => {
    expect(topicsIn('fetch my attendance')).toEqual(['study']);
    expect(topicOf('Prefers window seats on flights')).toBe('travel');
    expect(topicOf('Hello there')).toBe('other');
  });
});

describe('importing from ChatGPT or Claude', () => {
  it('keeps the facts and drops bullets, headings, chatter and secrets', () => {
    const pasted = [
      "Here's what I remember about you:",
      '',
      '## Work',
      '- **Works as** a nurse on night shifts',
      '* Lives in Leeds, UK',
      '1. Prefers short answers',
      '2) Has two dogs, Pip and Moss',
      'Preferences:',
      '- Your bank password is hunter2',
      '- Lives in Leeds, UK',
      'Let me know if you want more!',
    ].join('\n');
    const { facts, skipped } = parseImported(pasted);
    expect(facts).toEqual(['Works as a nurse on night shifts', 'Lives in Leeds, UK', 'Prefers short answers', 'Has two dogs, Pip and Moss']);
    expect(skipped).toBe(1);
  });

  it('spots secrets by what they say and by their shape', () => {
    expect(looksSecret('my api key: abc')).toBe(true);
    expect(looksSecret('sk-ant-0123456789abcdefghij')).toBe(true);
    expect(looksSecret('Lives at pin code 500032')).toBe(false);
  });
});
