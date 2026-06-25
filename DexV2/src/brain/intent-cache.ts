import sqlite3 from 'sqlite3';
import crypto from 'crypto';
import { getTelemetryDbPath } from '../utils/platform.js';
import { logger } from '../utils/logger.js';
import { getEmbedding, cosineSimilarity } from './intent-embedder.js';

const MODULE = 'INTENT_CACHE';

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

function getRows(db: sqlite3.Database, sql: string, params: any[] = []): Promise<any[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
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

function embeddingToBuffer(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

function bufferToEmbedding(buf: Buffer): Float32Array {
  const ab = new ArrayBuffer(buf.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < buf.length; ++i) {
    view[i] = buf[i];
  }
  return new Float32Array(ab);
}

export interface CacheHit {
  kind: 'exact' | 'semantic-high' | 'semantic-medium';
  sim?: number;
  hash: string;
  normalized: string;
  intentJson: string;
  actionJson: string;
}

export async function lookupIntent(normalized: string): Promise<CacheHit | null> {
  const hash = crypto.createHash('sha1').update(normalized).digest('hex');
  const db = await getDb();
  
  try {
    // Level 1: exact hash match
    const exactRow = await getRow(db, 'SELECT * FROM intent_cache WHERE hash = ?', [hash]);
    if (exactRow) {
      logger.info(MODULE, `Exact cache hit for: "${normalized}"`);
      await runQuery(db, 'UPDATE intent_cache SET hit_count = hit_count + 1, last_hit_at = ? WHERE hash = ?', [Date.now(), hash]);
      return {
        kind: 'exact',
        hash: exactRow.hash,
        normalized: exactRow.normalized,
        intentJson: exactRow.intent_json,
        actionJson: exactRow.action_json,
      };
    }

    // Level 2: semantic cosine similarity match
    const rows = await getRows(db, 'SELECT * FROM intent_cache ORDER BY hit_count DESC LIMIT 200');
    if (rows.length === 0) return null;

    const queryEmb = await getEmbedding(normalized);

    const SIMILARITY_HIGH = 0.93;
    const SIMILARITY_MEDIUM = 0.85;

    let bestHit: any = null;
    let bestSim = -1;

    for (const row of rows) {
      if (!row.embedding) continue;
      const cachedEmb = bufferToEmbedding(row.embedding);
      const sim = cosineSimilarity(queryEmb, cachedEmb);
      if (sim > bestSim) {
        bestSim = sim;
        bestHit = row;
      }
    }

    if (bestSim >= SIMILARITY_HIGH) {
      logger.info(MODULE, `Semantic-high cache hit (sim: ${bestSim.toFixed(3)}) for: "${normalized}" (matched: "${bestHit.normalized}")`);
      await runQuery(db, 'UPDATE intent_cache SET hit_count = hit_count + 1, last_hit_at = ? WHERE hash = ?', [Date.now(), bestHit.hash]);
      return {
        kind: 'semantic-high',
        sim: bestSim,
        hash: bestHit.hash,
        normalized: bestHit.normalized,
        intentJson: bestHit.intent_json,
        actionJson: bestHit.action_json,
      };
    }

    if (bestSim >= SIMILARITY_MEDIUM) {
      logger.info(MODULE, `Semantic-medium cache hit (sim: ${bestSim.toFixed(3)}) for: "${normalized}" (matched: "${bestHit.normalized}")`);
      await runQuery(db, 'UPDATE intent_cache SET hit_count = hit_count + 1, last_hit_at = ? WHERE hash = ?', [Date.now(), bestHit.hash]);
      return {
        kind: 'semantic-medium',
        sim: bestSim,
        hash: bestHit.hash,
        normalized: bestHit.normalized,
        intentJson: bestHit.intent_json,
        actionJson: bestHit.action_json,
      };
    }
  } catch (err) {
    logger.error(MODULE, 'Error looking up intent cache:', err);
  } finally {
    await closeDb(db);
  }

  return null;
}

export async function saveIntent(normalized: string, intentJson: string, actionJson: string): Promise<void> {
  const hash = crypto.createHash('sha1').update(normalized).digest('hex');
  const db = await getDb();
  
  try {
    const embedding = await getEmbedding(normalized);
    const embeddingBuf = embeddingToBuffer(embedding);
    const now = Date.now();

    await runQuery(db, `
      INSERT INTO intent_cache (hash, normalized, embedding, intent_json, action_json, hit_count, created_at, last_hit_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(hash) DO UPDATE SET
        last_hit_at = excluded.last_hit_at,
        intent_json = excluded.intent_json,
        action_json = excluded.action_json
    `, [hash, normalized, embeddingBuf, intentJson, actionJson, now, now]);

    logger.debug(MODULE, `Cached intent: "${normalized}"`);
  } catch (err) {
    logger.error(MODULE, 'Error saving intent to cache:', err);
  } finally {
    await closeDb(db);
  }
}
