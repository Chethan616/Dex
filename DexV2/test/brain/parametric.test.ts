import { expect, test, describe } from 'vitest';
import { tryParametric } from '../../src/brain/parametric.js';

describe('parametric matchers (Tier 0.5)', () => {
  test('matches set volume correctly', () => {
    const act = tryParametric('set volume to 80%');
    expect(act).not.toBeNull();
    expect(act?.cmd).toContain('$vol=80');

    const act2 = tryParametric('volume 45');
    expect(act2).not.toBeNull();
    expect(act2?.cmd).toContain('$vol=45');
  });

  test('matches kill process correctly', () => {
    const act = tryParametric('kill chrome');
    expect(act).not.toBeNull();
    expect(act?.cmd).toBe('Stop-Process -Name "chrome" -Force -ErrorAction SilentlyContinue');

    const act2 = tryParametric('stop process notepad');
    expect(act2).not.toBeNull();
    expect(act2?.cmd).toBe('Stop-Process -Name "notepad" -Force -ErrorAction SilentlyContinue');
  });

  test('matches ping host correctly', () => {
    const act = tryParametric('ping google.com 8 times');
    expect(act).not.toBeNull();
    expect(act?.cmd).toBe('ping -n 8 google.com');

    const act2 = tryParametric('ping yahoo.com');
    expect(act2).not.toBeNull();
    expect(act2?.cmd).toBe('ping -n 4 yahoo.com');
  });

  test('matches directory creation correctly', () => {
    const act = tryParametric('mkdir C:\\temp\\newfolder');
    expect(act).not.toBeNull();
    expect(act?.cmd).toBe('New-Item -ItemType Directory -Path "C:\\temp\\newfolder" -Force');
  });

  test('returns null for non-matching commands', () => {
    expect(tryParametric('hello world')).toBeNull();
  });
});
