import { expect, test, describe, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

// Isolate test database folder
process.env.DEX_TEST_DIR = path.join(process.cwd(), '.temp_test_dex_regressor');

import { runMigrations } from '../../src/db/migrations.js';
import { adjustTier, recordOutcome } from '../../src/brain/adaptive-regressor.js';
import { getDexDir } from '../../src/utils/platform.js';
import { TaskIntent } from '../../src/brain/types.js';

describe('adaptive regressor (telemetry tier logic)', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const dir = getDexDir();
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (err) {}
    }
    await runMigrations();
  });

  afterAll(() => {
    const dir = getDexDir();
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (err) {}
    }
  });

  test('adjustTier defaults to base intent tier on cache miss', async () => {
    const intent: TaskIntent = {
      raw: 'sum column B in Excel',
      normalized: 'sum column b in excel',
      kind: 'single-shot',
      tier: 1,
    };
    const tier = await adjustTier(intent);
    expect(tier).toBe(1);
  });

  test('consecutive successes regression locks the tier', async () => {
    const intent: TaskIntent = {
      raw: 'sum column B in Excel',
      normalized: 'sum column b in excel',
      kind: 'single-shot',
      tier: 2,
    };

    for (let i = 0; i < 5; i++) {
      await recordOutcome(intent, 1, 'success');
    }

    const tier = await adjustTier(intent);
    expect(tier).toBe(1);
  });

  test('consecutive failures escalates the tier', async () => {
    const intent: TaskIntent = {
      raw: 'send slack report',
      normalized: 'send slack report',
      kind: 'single-shot',
      tier: 1,
    };

    for (let i = 0; i < 2; i++) {
      await recordOutcome(intent, 1, 'failed');
    }

    const tier = await adjustTier(intent);
    expect(tier).toBe(2);
  });
});
