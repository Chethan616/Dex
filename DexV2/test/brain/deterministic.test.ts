import { expect, test, describe } from 'vitest';
import { tryDeterministic } from '../../src/brain/deterministic.js';

describe('deterministic matchers (Tier 0)', () => {
  test('matches valid commands and returns correct tool/cmd', () => {
    const notepadAction = tryDeterministic('open notepad');
    expect(notepadAction).not.toBeNull();
    expect(notepadAction?.tool).toBe('shell');
    expect(notepadAction?.cmd).toBe('Start-Process notepad');

    const lockAction = tryDeterministic('lock computer');
    expect(lockAction).not.toBeNull();
    expect(lockAction?.cmd).toBe('rundll32.exe user32.dll,LockWorkStation');

    const muteAction = tryDeterministic('mute');
    expect(muteAction).not.toBeNull();
  });

  test('opens web through the default browser instead of shortcut discovery', () => {
    const action = tryDeterministic('open web');
    expect(action).not.toBeNull();
    expect(action?.tool).toBe('shell');
    expect(action?.cmd).toBe('Start-Process "https://www.google.com"');
  });

  test('matches desktop recipes for Word, Paint, and Explorer', () => {
    const wordAction = tryDeterministic('type hello world in word');
    expect(wordAction).not.toBeNull();
    expect(wordAction?.tool).toBe('desktop');
    expect(wordAction?.app_hint).toBe('Microsoft Word');
    expect(wordAction?.label).toBe('Word Writing Recipe');

    const paintAction = tryDeterministic('draw a blue circle in paint');
    expect(paintAction).not.toBeNull();
    expect(paintAction?.tool).toBe('desktop');
    expect(paintAction?.app_hint).toBe('Paint');

    const explorerAction = tryDeterministic('open explorer to downloads');
    expect(explorerAction).not.toBeNull();
    expect(explorerAction?.tool).toBe('desktop');
    expect(explorerAction?.cmd).toContain('Start-Process explorer.exe');
  });

  test('returns null for non-matching commands', () => {
    expect(tryDeterministic('hello world')).toBeNull();
    expect(tryDeterministic('open notepad and draw a circle')).toBeNull();
  });
});
