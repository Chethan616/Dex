import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { handleDownload, safeFileName, uniquePath, type DownloadGuardDeps } from '../../../src/main/workspace/downloads';

const DIR = path.join('C:', 'Users', 'me', 'Downloads');

function fakeItem(filename: string, url = 'https://files.example.com/get?id=1') {
  let done: ((e: unknown, state: 'completed' | 'cancelled' | 'interrupted') => void) | null = null;
  let savePath = '';
  const item = {
    getFilename: () => filename,
    getURL: () => url,
    setSavePath: vi.fn((p: string) => { savePath = p; }),
    getSavePath: () => savePath,
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    once: (_event: 'done', listener: typeof done) => { done = listener; },
  };
  return { item, finish: (state: 'completed' | 'cancelled' | 'interrupted' = 'completed') => done?.({}, state) };
}

function deps(over: Partial<DownloadGuardDeps> = {}): DownloadGuardDeps {
  return {
    sessionIdOf: () => 's1',
    isRunning: () => true,
    userStarted: () => false,
    approve: vi.fn(async () => true),
    folder: () => DIR,
    finished: vi.fn(),
    ...over,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('downloads from a task’s tabs', () => {
  it('saves yours straight to Downloads, no dialog and no question, and shows it as the task’s file', () => {
    const { item, finish } = fakeItem('Q3 report.pdf');
    const d = deps({ userStarted: () => true });
    expect(handleDownload(item, {}, d)).toBe(true);
    expect(item.setSavePath).toHaveBeenCalledWith(path.join(DIR, 'Q3 report.pdf'));
    expect(item.pause).not.toHaveBeenCalled();
    expect(d.approve).not.toHaveBeenCalled();
    finish();
    expect(d.finished).toHaveBeenCalledWith('s1', path.join(DIR, 'Q3 report.pdf'), 'Q3 report.pdf');
  });

  it('holds the agent’s until the approval policy lets it through', async () => {
    const { item } = fakeItem('setup.exe');
    let answer!: (ok: boolean) => void;
    const d = deps({ approve: vi.fn(() => new Promise<boolean>((r) => { answer = r; })) });
    handleDownload(item, {}, d);
    expect(item.pause).toHaveBeenCalled();
    expect(d.approve).toHaveBeenCalledWith('s1', 'Download a file', 'setup.exe from files.example.com', 'setup.exe');
    answer(true);
    await flush();
    expect(item.resume).toHaveBeenCalled();
    expect(item.cancel).not.toHaveBeenCalled();
  });

  it('cancels one you refuse, and records nothing', async () => {
    const { item, finish } = fakeItem('setup.exe');
    const d = deps({ approve: vi.fn(async () => false) });
    handleDownload(item, {}, d);
    await flush();
    expect(item.cancel).toHaveBeenCalled();
    finish('cancelled');
    expect(d.finished).not.toHaveBeenCalled();
  });

  it('doesn’t ask when the task isn’t running', () => {
    const { item } = fakeItem('a.zip');
    const d = deps({ isRunning: () => false });
    handleDownload(item, {}, d);
    expect(item.pause).not.toHaveBeenCalled();
    expect(d.approve).not.toHaveBeenCalled();
  });

  it('leaves downloads from DEX’s own windows alone', () => {
    const { item } = fakeItem('a.zip');
    expect(handleDownload(item, {}, deps({ sessionIdOf: () => null }))).toBe(false);
    expect(handleDownload(item, null, deps())).toBe(false);
    expect(item.setSavePath).not.toHaveBeenCalled();
  });

  it('never overwrites a file, nor one that’s still downloading', () => {
    const existing = new Set([path.join(DIR, 'a.pdf'), path.join(DIR, 'a (1).pdf.crdownload')]);
    expect(uniquePath(DIR, 'a.pdf', (p) => existing.has(p))).toBe(path.join(DIR, 'a (2).pdf'));
    expect(uniquePath(DIR, 'b.pdf', (p) => existing.has(p))).toBe(path.join(DIR, 'b.pdf'));

    const first = fakeItem('same.txt');
    const second = fakeItem('same.txt');
    handleDownload(first.item, {}, deps({ userStarted: () => true, folder: () => path.join(DIR, 'nowhere-real') }));
    handleDownload(second.item, {}, deps({ userStarted: () => true, folder: () => path.join(DIR, 'nowhere-real') }));
    expect(second.item.getSavePath()).toBe(path.join(DIR, 'nowhere-real', 'same (1).txt'));
    first.finish();
    second.finish();
  });

  it('turns whatever the site suggests into a name Windows takes', () => {
    expect(safeFileName('..\\..\\evil.txt')).toBe('evil.txt');
    expect(safeFileName('a/b/c.pdf')).toBe('c.pdf');
    expect(safeFileName('what?: "this".pdf')).toBe('what__ _this_.pdf');
    expect(safeFileName('CON.txt')).toBe('download-CON.txt');
    expect(safeFileName('trailing. ')).toBe('trailing');
    expect(safeFileName('')).toBe('download');
  });
});
