/**
 * The two cases from the field that motivated this module in the first
 * place — see majestic-baking-parasol.md §3 Phase 3 "Verify". Both are
 * unrankable by plain keyword frequency: the winner shares no single term
 * with the query, only a *distinct* term per group, spread across the
 * filename and the extracted content.
 */
import { describe, expect, it } from 'vitest';
import { rankCandidates, type SearchCandidate } from '../../../src/main/search/rank';

const NOW = Date.now();

function file(overrides: Partial<SearchCandidate>): SearchCandidate {
  return { path: 'C:/x', name: 'x', content: '', size: 1024, mtime: NOW, ...overrides };
}

describe('rankCandidates', () => {
  it('ranks the syllabus PDF first for "cryptography syllabus sheet pdf"', () => {
    const candidates: SearchCandidate[] = [
      file({
        path: 'C:/Users/cheth/Downloads/BCSE_CNS_syllabus.pdf',
        name: 'BCSE_CNS_syllabus.pdf',
        content: 'Course: Cryptography and Network Security. Module 1: classical ciphers...',
      }),
      file({
        path: 'C:/Users/cheth/Downloads/random_notes.pdf',
        name: 'random_notes.pdf',
        content: 'Grocery list: milk, eggs, bread.',
      }),
      file({
        path: 'C:/Users/cheth/Downloads/syllabus_only_name.pdf',
        name: 'syllabus_only_name.pdf',
        content: 'Nothing about the subject in here.',
      }),
    ];

    const results = rankCandidates('cryptography syllabus sheet pdf', candidates, 10);
    expect(results[0].detail).toBe('C:/Users/cheth/Downloads/BCSE_CNS_syllabus.pdf');
    expect(results[0].reasons.some((r) => r.includes('syllabus'))).toBe(true);
    expect(results[0].reasons.some((r) => r.includes('cryptography'))).toBe(true);
    // The grocery list matches nothing and must not appear at all.
    expect(results.some((r) => r.detail.includes('random_notes'))).toBe(false);
  });

  it('ranks the AST01 PDF first for "slp da - 1" via initialism + alias, not literal overlap', () => {
    const candidates: SearchCandidate[] = [
      file({
        path: 'C:/Users/cheth/Downloads/23BAI0093_VL2026270103245_AST01.pdf',
        name: '23BAI0093_VL2026270103245_AST01.pdf',
        content: 'Speech and Language Processing Lab Assessment -1. Submit your transcription pipeline.',
      }),
      file({
        path: 'C:/Users/cheth/Downloads/unrelated_report.pdf',
        name: 'unrelated_report.pdf',
        content: 'Quarterly financial summary for the department.',
      }),
      file({
        path: 'C:/Users/cheth/Downloads/other_ast.pdf',
        name: 'other_ast.pdf',
        content: 'A completely different assessment about database design.',
      }),
    ];

    const results = rankCandidates('slp da - 1', candidates, 10);
    expect(results[0].detail).toBe('C:/Users/cheth/Downloads/23BAI0093_VL2026270103245_AST01.pdf');
  });

  it('prefers a file matching every distinct term over one repeating a single term', () => {
    const candidates: SearchCandidate[] = [
      file({
        path: 'C:/a.pdf', name: 'a.pdf',
        content: 'budget budget budget budget budget',
      }),
      file({
        path: 'C:/b.pdf', name: 'budget_report.pdf',
        content: 'annual report for the finance team',
      }),
    ];
    const results = rankCandidates('budget report', candidates, 10);
    expect(results[0].detail).toBe('C:/b.pdf');
  });

  it('drops candidates that satisfy none of the query groups', () => {
    const candidates: SearchCandidate[] = [file({ content: 'nothing relevant at all' })];
    expect(rankCandidates('cryptography syllabus', candidates)).toEqual([]);
  });

  it('returns nothing for a query that reduces to no groups', () => {
    expect(rankCandidates('', [file({})])).toEqual([]);
  });

  it('breaks ties on recency when scores are equal', () => {
    const older = file({ path: 'C:/old.pdf', name: 'report.pdf', content: 'report', mtime: NOW - 40 * 24 * 60 * 60 * 1000 });
    const newer = file({ path: 'C:/new.pdf', name: 'report.pdf', content: 'report', mtime: NOW });
    const results = rankCandidates('report', [older, newer], 10);
    expect(results[0].detail).toBe('C:/new.pdf');
  });

  it('produces an excerpt around the matched content', () => {
    const candidates = [file({ name: 'x.pdf', content: 'a'.repeat(200) + ' cryptography basics here ' + 'b'.repeat(200) })];
    const results = rankCandidates('cryptography', candidates, 10);
    expect(results[0].excerpt).toContain('cryptography');
    expect(results[0].excerpt!.length).toBeLessThan(200);
  });
});
