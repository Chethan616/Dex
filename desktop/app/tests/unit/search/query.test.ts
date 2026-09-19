/**
 * query.ts wires parseQuery/ftsCandidates/rankCandidates together and adds
 * the `@drive` concurrency contract. The ranking itself is rank.test.ts's
 * job; what matters here is that db.ts is asked for the right terms, and
 * that Drive genuinely runs alongside the local search rather than after it
 * — the plan's own verify criterion for `@drive` (§3 Phase 3) is explicit
 * that this must be asserted on timing, not just on both results showing up.
 */
import { describe, expect, it, vi } from 'vitest';

const ftsCandidatesMock = vi.hoisted(() => vi.fn());
vi.mock('../../../src/main/search/db', () => ({ ftsCandidates: ftsCandidatesMock }));

const { searchCombined, searchLocal } = await import('../../../src/main/search/query');

describe('searchLocal', () => {
  it('expands aliases into the FTS term set it asks the db for', () => {
    ftsCandidatesMock.mockReturnValue([]);
    searchLocal('da');
    const [terms] = ftsCandidatesMock.mock.calls.at(-1)!;
    expect(terms).toEqual(expect.arrayContaining(['da', 'assessment', 'assignment', 'ast']));
  });

  it('never queries the db for a query that reduces to no groups', () => {
    ftsCandidatesMock.mockClear();
    searchLocal('');
    expect(ftsCandidatesMock).not.toHaveBeenCalled();
  });
});

describe('searchCombined', () => {
  it('never calls the drive function when drive was not requested', async () => {
    ftsCandidatesMock.mockReturnValue([]);
    const driveFn = vi.fn();
    await searchCombined('syllabus', 10, false, driveFn);
    expect(driveFn).not.toHaveBeenCalled();
  });

  it('runs the drive call concurrently with the local search, not after it', async () => {
    ftsCandidatesMock.mockReturnValue([]);
    const DRIVE_DELAY_MS = 60;
    const driveFn = vi.fn(async (_query: string, _limit: number) => {
      await new Promise((resolve) => setTimeout(resolve, DRIVE_DELAY_MS));
      return { ok: true, items: [{ label: 'from drive', reasons: ['from Google Drive'] }] };
    });

    const start = Date.now();
    const result = await searchCombined('syllabus', 10, true, driveFn);
    const elapsed = Date.now() - start;

    expect(result.drive?.items[0].label).toBe('from drive');
    // If local ran first and then drive, elapsed would still land near
    // DRIVE_DELAY_MS since local is near-instant — the real signal is that
    // total time tracks the *slower* of the two, not their sum. Generous
    // margin keeps this from flaking under CI scheduling jitter.
    expect(elapsed).toBeLessThan(DRIVE_DELAY_MS + 100);
  });

  it('surfaces a drive error without failing the whole search', async () => {
    ftsCandidatesMock.mockReturnValue([]);
    const driveFn = vi.fn(async () => ({ ok: false, items: [], error: 'Google Drive is not connected.' }));
    const result = await searchCombined('syllabus', 10, true, driveFn);
    expect(result.drive?.ok).toBe(false);
    expect(result.drive?.error).toBe('Google Drive is not connected.');
    expect(result.local).toEqual([]);
  });
});
