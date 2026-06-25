import { expect, test, describe, beforeAll, afterAll } from 'vitest';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';

// Isolate test database folder
process.env.DEX_TEST_DIR = path.join(process.cwd(), '.temp_test_dex_telemetry');

import { runMigrations } from '../../src/db/migrations.js';
import { getStateDbPath, getTelemetryDbPath, getCredsDbPath, getDexDir } from '../../src/utils/platform.js';

function getTables(dbPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);
      db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows: any[]) => {
        db.close();
        if (err) return reject(err);
        resolve(rows.map(r => r.name));
      });
    });
  });
}

function getIndexes(dbPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);
      db.all("SELECT name FROM sqlite_master WHERE type='index'", (err, rows: any[]) => {
        db.close();
        if (err) return reject(err);
        resolve(rows.map(r => r.name));
      });
    });
  });
}

describe('database migrations', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    
    // Clean up temp dir if exists
    const dir = getDexDir();
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (err) {
        // ignore if open or locked
      }
    }
    
    await runMigrations();
  });

  afterAll(() => {
    // Clean up temp dir
    const dir = getDexDir();
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (err) {
        // ignore if locked
      }
    }
  });

  test('all database files exist', () => {
    expect(fs.existsSync(getStateDbPath())).toBe(true);
    expect(fs.existsSync(getTelemetryDbPath())).toBe(true);
    expect(fs.existsSync(getCredsDbPath())).toBe(true);
  });

  test('state.db has expected tables', async () => {
    const tables = await getTables(getStateDbPath());
    expect(tables).toContain('sessions');
    expect(tables).toContain('messages');
  });

  test('telemetry.db has expected tables and indexes', async () => {
    const tables = await getTables(getTelemetryDbPath());
    expect(tables).toContain('engine_runs');
    expect(tables).toContain('intent_cache');
    expect(tables).toContain('tier_patterns');
    expect(tables).toContain('prompt_cache_state');

    const indexes = await getIndexes(getTelemetryDbPath());
    expect(indexes).toContain('idx_engine_process');
    expect(indexes).toContain('idx_ts');
    expect(indexes).toContain('idx_intent_hits');
  });

  test('creds.db has expected tables', async () => {
    const tables = await getTables(getCredsDbPath());
    expect(tables).toContain('credentials');
  });
});
