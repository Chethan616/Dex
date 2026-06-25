import sqlite3 from 'sqlite3';
import crypto from 'crypto';
import { getTelemetryDbPath } from '../utils/platform.js';
import { logger } from '../utils/logger.js';
import { TaskIntent } from './types.js';

const MODULE = 'ADAPTIVE_REGRESSOR';
const REGRESSION_THRESHOLD = 5;
const ESCALATION_THRESHOLD = 2;

function getDb(): Promise<sqlite3.Database> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(getTelemetryDbPath(), (err) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

function runQuery(db: sqlite3.Database, sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function getRow(db: sqlite3.Database, sql: string, params: any[] = []): Promise<any> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function closeDb(db: sqlite3.Database): Promise<void> {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export async function adjustTier(intent: TaskIntent): Promise<number> {
  const hash = crypto.createHash('sha1').update(intent.normalized).digest('hex');
  const db = await getDb();

  try {
    const row = await getRow(db, 'SELECT locked_tier FROM tier_patterns WHERE cluster_hash = ?', [hash]);
    if (row && row.locked_tier !== null) {
      logger.info(MODULE, `Telemetry locked tier: ${row.locked_tier} for intent: "${intent.normalized}" (original tier: ${intent.tier})`);
      return row.locked_tier;
    }
  } catch (err) {
    logger.error(MODULE, 'Error adjusting tier from telemetry:', err);
  } finally {
    await closeDb(db);
  }

  return intent.tier;
}

export async function recordOutcome(intent: TaskIntent, tier: number, outcome: 'success' | 'failed'): Promise<void> {
  const hash = crypto.createHash('sha1').update(intent.normalized).digest('hex');
  const db = await getDb();

  try {
    const row = await getRow(db, 'SELECT * FROM tier_patterns WHERE cluster_hash = ?', [hash]);
    const now = Date.now();

    if (!row) {
      const success_t0 = (tier === 0 && outcome === 'success') ? 1 : 0;
      const success_t05 = (tier === 0.5 && outcome === 'success') ? 1 : 0;
      const success_t1 = (tier === 1 && outcome === 'success') ? 1 : 0;
      const success_t2 = (tier === 2 && outcome === 'success') ? 1 : 0;
      const fail_t1 = (tier === 1 && outcome === 'failed') ? 1 : 0;
      const fail_t2 = (tier === 2 && outcome === 'failed') ? 1 : 0;

      let locked_tier: number | null = null;
      if (success_t0 >= REGRESSION_THRESHOLD) locked_tier = 0;
      if (success_t05 >= REGRESSION_THRESHOLD) locked_tier = 0.5;
      if (success_t1 >= REGRESSION_THRESHOLD) locked_tier = 1;
      if (success_t2 >= REGRESSION_THRESHOLD) locked_tier = 2;
      
      if (fail_t1 >= ESCALATION_THRESHOLD) locked_tier = 2;
      if (fail_t2 >= ESCALATION_THRESHOLD) locked_tier = 2;

      await runQuery(db, `
        INSERT INTO tier_patterns (cluster_hash, centroid_json, current_tier, success_t0, success_t05, success_t1, success_t2, fail_t1, fail_t2, locked_tier, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [hash, JSON.stringify({ pattern: intent.normalized }), tier, success_t0, success_t05, success_t1, success_t2, fail_t1, fail_t2, locked_tier, now]);
    } else {
      let success_t0 = row.success_t0;
      let success_t05 = row.success_t05;
      let success_t1 = row.success_t1;
      let success_t2 = row.success_t2;
      let fail_t1 = row.fail_t1;
      let fail_t2 = row.fail_t2;

      if (outcome === 'success') {
        if (tier === 0) success_t0++;
        else if (tier === 0.5) success_t05++;
        else if (tier === 1) success_t1++;
        else if (tier === 2) success_t2++;
      } else {
        if (tier === 1) fail_t1++;
        else if (tier === 2) fail_t2++;
      }

      let locked_tier: number | null = row.locked_tier;
      if (success_t0 >= REGRESSION_THRESHOLD) locked_tier = 0;
      else if (success_t05 >= REGRESSION_THRESHOLD) locked_tier = 0.5;
      else if (success_t1 >= REGRESSION_THRESHOLD) locked_tier = 1;
      else if (success_t2 >= REGRESSION_THRESHOLD) locked_tier = 2;

      if (fail_t1 >= ESCALATION_THRESHOLD) locked_tier = 2;
      else if (fail_t2 >= ESCALATION_THRESHOLD) locked_tier = 2;

      await runQuery(db, `
        UPDATE tier_patterns SET
          success_t0 = ?,
          success_t05 = ?,
          success_t1 = ?,
          success_t2 = ?,
          fail_t1 = ?,
          fail_t2 = ?,
          locked_tier = ?,
          updated_at = ?
        WHERE cluster_hash = ?
      `, [success_t0, success_t05, success_t1, success_t2, fail_t1, fail_t2, locked_tier, now, hash]);
    }
  } catch (err) {
    logger.error(MODULE, 'Error recording execution outcome:', err);
  } finally {
    await closeDb(db);
  }
}
