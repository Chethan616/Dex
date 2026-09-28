/**
 * query.ts wires parseQuery/winSearchCandidates/rankCandidates together and
 * adds the `@drive` concurrency contract. The ranking itself is
 * rank.test.ts's job; what matters here is that the search backend is asked
 * for the right terms, that the filename fallback only engages when it
 * should, and that Drive genuinely runs alongside the local search rather
 * than after it — the plan's verify criterion for `@drive` is explicit that
 * this must be asserted on timing, not just on both results showing up.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const winSearchMock = vi.hoisted(() => vi.fn());
const fallbackMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/main/search/winSearch', () => ({ winSearchCandidates: winSearchMock }));
vi.mock('../../../src/main/search/fallbackScan', () => ({ filenameFallback: fallbackMock }));

const { searchCombined, searchLocal } = await import('../../../src/main/search/query');

const candidate = {
  path: 'C:/docs/syllabus.pdf',
  name: 'syllabus.pdf',
  content: 'cryptography and network security',
  size: 100,
  mtime: Date.now(),
};

beforeEach(() => {
  winSearchMock.mockReset();
  fallbackMock.mockReset();
  fallbackMock.mockResolvedValue([]);
});

describe('searchLocal', () => {
  it('expands aliases into the term set it asks Windows Search for', async () => {
    winSearchMock.mockResolvedValue({ ok: true, candidates: [] });
    await searchLocal('da');
    const [terms] = winSearchMock.mock.calls.at(-1)!;
    expect(terms).toEqual(expect.arrayContaining(['da', 'assessment', 'assignment', 'ast']));
  });

  it('never queries any backend for a query that reduces to no groups', async () => {
    await searchLocal('');
    expect(winSearchMock).not.toHaveBeenCalled();
    expect(fallbackMock).not.toHaveBeenCalled();
  });

  it('does NOT run the fallback when Windows Search returned matches', async () => {
    winSearchMock.mockResolvedValue({ ok: true, candidates: [candidate] });
    const out = await searchLocal('cryptography');
    expect(fallbackMock).not.toHaveBeenCalled();
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.note).toBeUndefined();
  });

  it('falls back to the filename walk when Windows Search is unavailable, and says so', async () => {
    winSearchMock.mockResolvedValue({ ok: false, candidates: [], error: 'service disabled' });
    fallbackMock.mockResolvedValue([candidate]);

    const out = await searchLocal('cryptography');

    expect(fallbackMock).toHaveBeenCalledTimes(1);
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.note).toMatch(/unavailable/i);
    expect(out.note).toMatch(/service disabled/);
  });

  it('falls back when Windows Search simply returned nothing, and points at the indexing setting', async () => {
    winSearchMock.mockResolvedValue({ ok: true, candidates: [] });
    fallbackMock.mockResolvedValue([candidate]);

    const out = await searchLocal('cryptography');

    expect(fallbackMock).toHaveBeenCalledTimes(1);
    expect(out.note).toMatch(/Searching Windows/i);
  });

  it('reports no note when both backends legitimately find nothing', async () => {
    winSearchMock.mockResolvedValue({ ok: true, candidates: [] });
    fallbackMock.mockResolvedValue([]);

    const out = await searchLocal('nothing-matches-this');

    expect(out.results).toEqual([]);
    expect(out.note).toBeUndefined();
  });
});

describe('searchCombined', () => {
  it('never calls the drive function when drive was not requested', async () => {
    winSearchMock.mockResolvedValue({ ok: true, candidates: [] });
    const driveFn = vi.fn();
    await searchCombined('syllabus', 10, false, driveFn);
    expect(driveFn).not.toHaveBeenCalled();
  });

  it('runs the drive call concurrently with the local search, not after it', async () => {
    const LOCAL_DELAY_MS = 60;
    const DRIVE_DELAY_MS = 60;
    winSearchMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, LOCAL_DELAY_MS));
      return { ok: true, candidates: [candidate] };
    });
    const driveFn = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, DRIVE_DELAY_MS));
      return { ok: true, items: [{ label: 'from drive', reasons: ['from Google Drive'] }] };
    });

    const start = Date.now();
    const result = await searchCombined('syllabus', 10, true, driveFn);
    const elapsed = Date.now() - start;

    expect(result.drive?.items[0].label).toBe('from drive');
    // Both sides now take real time, so sequential execution would cost
    // ~120ms and concurrent ~60ms — a gap wide enough to assert on without
    // being flaky under CI scheduling jitter.
    expect(elapsed).toBeLessThan(LOCAL_DELAY_MS + DRIVE_DELAY_MS);
  });

  it('surfaces a drive error without failing the whole search', async () => {
    winSearchMock.mockResolvedValue({ ok: true, candidates: [] });
    const driveFn = vi.fn(async () => ({ ok: false, items: [], error: 'Google Drive is not connected.' }));
    const result = await searchCombined('syllabus', 10, true, driveFn);
    expect(result.drive?.ok).toBe(false);
    expect(result.drive?.error).toBe('Google Drive is not connected.');
    expect(result.local).toEqual([]);
  });

  it('passes the local backend note through to the combined result', async () => {
    winSearchMock.mockResolvedValue({ ok: false, candidates: [], error: 'service disabled' });
    fallbackMock.mockResolvedValue([candidate]);
    const result = await searchCombined('syllabus', 10, false, vi.fn());
    expect(result.localNote).toMatch(/unavailable/i);
  });
});
