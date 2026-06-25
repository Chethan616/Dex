import { expect, test, describe, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

// Isolate test database folder
process.env.DEX_TEST_DIR = path.join(process.cwd(), '.temp_test_dex_cache');

import { runMigrations } from '../../src/db/migrations.js';
import { lookupIntent, saveIntent } from '../../src/brain/intent-cache.js';
import { getDexDir } from '../../src/utils/platform.js';

describe('intent cache lookup and storage', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const dir = getDexDir();
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (err) {}
    }
    await runMigrations();
  }, 30000);

  afterAll(() => {
    const dir = getDexDir();
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (err) {}
    }
  });

  test('returns null for empty cache lookups', async () => {
    const hit = await lookupIntent('hello world');
    expect(hit).toBeNull();
  });

  test('saves and matches exact hash hits', async () => {
    const norm = 'open notepad';
    const intentJson = JSON.stringify({ raw: 'open notepad', tier: 0 });
    const actionJson = JSON.stringify({ tool: 'shell', cmd: 'Start-Process notepad' });

    await saveIntent(norm, intentJson, actionJson);

    const hit = await lookupIntent(norm);
    expect(hit).not.toBeNull();
    expect(hit?.kind).toBe('exact');
    expect(hit?.intentJson).toBe(intentJson);
    expect(hit?.actionJson).toBe(actionJson);
  }, 20000);

  test('matches semantic-high similarity hits', async () => {
    const normSaved = 'open google chrome';
    const intentJson = JSON.stringify({ raw: 'open google chrome', tier: 1 });
    const actionJson = JSON.stringify({ tool: 'shell', cmd: 'Start-Process chrome' });

    await saveIntent(normSaved, intentJson, actionJson);

    const query = 'launch google chrome';
    const hit = await lookupIntent(query);
    
    expect(hit).not.toBeNull();
    expect(['exact', 'semantic-high', 'semantic-medium']).toContain(hit?.kind);
    expect(hit?.normalized).toBe(normSaved);
  }, 30000);
});
