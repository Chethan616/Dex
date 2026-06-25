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

  test('returns null for non-matching commands', () => {
    expect(tryDeterministic('hello world')).toBeNull();
    expect(tryDeterministic('open notepad and draw a circle')).toBeNull();
  });
});
