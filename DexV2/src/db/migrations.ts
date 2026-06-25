import sqlite3 from 'sqlite3';
import { getStateDbPath, getTelemetryDbPath, getCredsDbPath, ensureDirs } from '../utils/platform.js';
import { logger } from '../utils/logger.js';

const MODULE = 'DB_MIGRATIONS';

function openDatabase(dbPath: string): Promise<sqlite3.Database> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(db);
      }
    });
  });
}

function runQuery(db: sqlite3.Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function closeDatabase(db: sqlite3.Database): Promise<void> {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

export async function runMigrations(): Promise<void> {
  logger.info(MODULE, 'Starting database migrations...');
  ensureDirs();

  // 1. State DB
  const stateDb = await openDatabase(getStateDbPath());
  try {
    await runQuery(stateDb, `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        peer_id TEXT,
        created_at INTEGER NOT NULL,
        last_msg_at INTEGER NOT NULL,
        metadata TEXT
      )
    `);

    await runQuery(stateDb, `
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tokens_in INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        tokens_cached INTEGER DEFAULT 0,
        model TEXT,
        tier REAL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      )
    `);
    logger.debug(MODULE, 'State DB migrated successfully.');
  } finally {
    await closeDatabase(stateDb);
  }

  // 2. Telemetry DB
  const telemetryDb = await openDatabase(getTelemetryDbPath());
  try {
    await runQuery(telemetryDb, `
      CREATE TABLE IF NOT EXISTS engine_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        engine_id TEXT NOT NULL,
        process_name TEXT NOT NULL,
        app_family TEXT NOT NULL,
        task_kind TEXT NOT NULL,
        task_hint TEXT,
        latency_ms INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        fallback INTEGER DEFAULT 0,
        error_class TEXT,
        model_used TEXT,
        tokens_used INTEGER DEFAULT 0,
        tokens_cached INTEGER DEFAULT 0,
        tier_used REAL DEFAULT 1
      )
    `);

    await runQuery(telemetryDb, `
      CREATE INDEX IF NOT EXISTS idx_engine_process ON engine_runs(engine_id, process_name)
    `);

    await runQuery(telemetryDb, `
      CREATE INDEX IF NOT EXISTS idx_ts ON engine_runs(ts)
    `);

    await runQuery(telemetryDb, `
      CREATE TABLE IF NOT EXISTS intent_cache (
        hash TEXT PRIMARY KEY,
        normalized TEXT NOT NULL,
        embedding BLOB,
        intent_json TEXT NOT NULL,
        action_json TEXT NOT NULL,
        hit_count INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        last_hit_at INTEGER NOT NULL
      )
    `);

    await runQuery(telemetryDb, `
      CREATE INDEX IF NOT EXISTS idx_intent_hits ON intent_cache(hit_count DESC)
    `);

    await runQuery(telemetryDb, `
      CREATE TABLE IF NOT EXISTS tier_patterns (
        cluster_hash TEXT PRIMARY KEY,
        centroid_json TEXT NOT NULL,
        current_tier REAL NOT NULL,
        success_t0 INTEGER DEFAULT 0,
        success_t05 INTEGER DEFAULT 0,
        success_t1 INTEGER DEFAULT 0,
        success_t2 INTEGER DEFAULT 0,
        fail_t1 INTEGER DEFAULT 0,
        fail_t2 INTEGER DEFAULT 0,
        locked_tier REAL,
        updated_at INTEGER NOT NULL
      )
    `);

    await runQuery(telemetryDb, `
      CREATE TABLE IF NOT EXISTS prompt_cache_state (
        id TEXT PRIMARY KEY,
        cache_key TEXT NOT NULL,
        provider TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        hit_count INTEGER DEFAULT 0
      )
    `);
    logger.debug(MODULE, 'Telemetry DB migrated successfully.');
  } finally {
    await closeDatabase(telemetryDb);
  }

  // 3. Credentials DB
  const credsDb = await openDatabase(getCredsDbPath());
  try {
    await runQuery(credsDb, `
      CREATE TABLE IF NOT EXISTS credentials (
        service TEXT PRIMARY KEY,
        auth_type TEXT NOT NULL,
        token_data BLOB NOT NULL,
        expires_at INTEGER,
        updated_at INTEGER NOT NULL
      )
    `);
    logger.debug(MODULE, 'Credentials DB migrated successfully.');
  } finally {
    await closeDatabase(credsDb);
  }

  logger.info(MODULE, 'All database migrations finished.');
}
