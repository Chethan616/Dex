import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isRunnable, resolveRecordedFile } from '../../../src/main/sessions/recordedFiles';
import type { HlEvent } from '../../../src/shared/session-schemas';

const HARNESS = path.resolve('/dex/harness');
const DOWNLOADS = path.resolve('/Users/me/Downloads/report.pdf');

const output = [
  { type: 'file_output', name: 'report.pdf', path: DOWNLOADS, size: 10, mime: 'application/pdf' },
  { type: 'file_output', name: 'chart.png', path: 'outputs/s1/chart.png', size: 10, mime: 'image/png' },
  { type: 'task_state', state: { objective: '', steps: [], currentStep: null, files: [{ path: path.resolve('/Users/me/notes.md'), name: 'notes.md', at: 1 }], notes: [], updatedAt: 1 } },
  { type: 'file_output', name: 'setup.exe', path: path.resolve('/Users/me/Downloads/setup.exe'), size: 10, mime: 'application/octet-stream' },
] as unknown as HlEvent[];

describe('recorded files', () => {
  it('opens files the task recorded, wherever they were saved', () => {
    expect(resolveRecordedFile(DOWNLOADS, output, HARNESS)).toBe(DOWNLOADS);
    expect(resolveRecordedFile(path.resolve('/Users/me/notes.md'), output, HARNESS)).toBe(path.resolve('/Users/me/notes.md'));
    expect(resolveRecordedFile('outputs/s1/chart.png', output, HARNESS)).toBe(path.join(HARNESS, 'outputs/s1/chart.png'));
    expect(resolveRecordedFile(path.join(HARNESS, 'outputs/s1/chart.png'), output, HARNESS)).toBe(path.join(HARNESS, 'outputs/s1/chart.png'));
  });

  it('refuses any other path, including tricks that normalise to one', () => {
    expect(resolveRecordedFile(path.resolve('/Windows/System32/calc.exe'), output, HARNESS)).toBeNull();
    expect(resolveRecordedFile(`${path.resolve('/Users/me/Downloads')}/../Downloads/other.pdf`, output, HARNESS)).toBeNull();
    expect(resolveRecordedFile(`${DOWNLOADS}\0.txt`, output, HARNESS)).toBeNull();
    expect(resolveRecordedFile('', output, HARNESS)).toBeNull();
  });

  it('knows which files Windows would run instead of open', () => {
    expect(isRunnable('C:/x/setup.EXE')).toBe(true);
    expect(isRunnable('C:/x/run.ps1')).toBe(true);
    expect(isRunnable('C:/x/Shortcut.lnk')).toBe(true);
    expect(isRunnable('C:/x/report.pdf')).toBe(false);
    expect(isRunnable('C:/x/notes.md')).toBe(false);
  });
});
