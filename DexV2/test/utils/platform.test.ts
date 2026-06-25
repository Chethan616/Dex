import { expect, test, describe } from 'vitest';
import { getDexDir, getStateDbPath, getTelemetryDbPath, getCredsDbPath, ensureDirs } from '../../src/utils/platform.js';
import fs from 'fs';
import path from 'path';

describe('platform utils', () => {
  test('paths are defined properly', () => {
    const dir = getDexDir();
    if (process.env.NODE_ENV === 'test') {
      expect(dir).toContain('.temp_test_dex');
    } else {
      expect(dir).toContain('.dex');
      expect(dir).toContain('dexv2');
    }
    expect(getStateDbPath()).toBe(path.join(dir, 'state.db'));
    expect(getTelemetryDbPath()).toBe(path.join(dir, 'telemetry.db'));
    expect(getCredsDbPath()).toBe(path.join(dir, 'creds.db'));
  });

  test('ensureDirs creates directory successfully', () => {
    ensureDirs();
    expect(fs.existsSync(getDexDir())).toBe(true);
  });
});
