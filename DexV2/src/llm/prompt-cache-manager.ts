import sqlite3 from 'sqlite3';
import { getTelemetryDbPath } from '../utils/platform.js';
import { logger } from '../utils/logger.js';
import { ToolDef } from './types.js';
import { GeminiProvider } from './providers/gemini.js';

const MODULE = 'PROMPT_CACHE_MANAGER';

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

export class PromptCacheManager {
  private gemini = new GeminiProvider();

  /**
   * Retrieves an active cache key, warming it if expired or missing.
   */
  async getOrRefresh(tier: number, providerId: string, tools: ToolDef[]): Promise<string | undefined> {
    if (providerId !== 'gemini') {
      // Ephemeral cache providers (like Anthropic) handle caching on-the-fly.
      return undefined;
    }

    const id = `tier_${tier}`;
    const db = await getDb();

    try {
      const now = Date.now();
      const row = await getRow(db, 'SELECT * FROM prompt_cache_state WHERE id = ? AND provider = ?', [id, providerId]);

      // If cache is active and has at least 5 minutes remaining before expiration
      if (row && row.expires_at > now + 300000) {
        await runQuery(db, 'UPDATE prompt_cache_state SET hit_count = hit_count + 1 WHERE id = ?', [id]);
        return row.cache_key;
      }

      // Expired or missing, warm cache
      logger.info(MODULE, `Warming context cache for ${id} (${providerId})...`);
      let cacheKey = '';
      try {
        cacheKey = await this.gemini.warmCache(tier, tools);
      } catch (err) {
        logger.warn(MODULE, 'Warming cache failed (API key might be missing or invalid):', err);
        return undefined;
      }

      const expiresAt = now + 3600 * 1000; // standard 1 hour TTL for Gemini

      await runQuery(db, `
        INSERT INTO prompt_cache_state (id, cache_key, provider, expires_at, hit_count)
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(id) DO UPDATE SET
          cache_key = excluded.cache_key,
          expires_at = excluded.expires_at,
          hit_count = prompt_cache_state.hit_count + 1
      `, [id, cacheKey, providerId, expiresAt]);

      return cacheKey;
    } catch (err) {
      logger.error(MODULE, 'Error managing prompt cache state:', err);
    } finally {
      await closeDb(db);
    }

    return undefined;
  }
}
