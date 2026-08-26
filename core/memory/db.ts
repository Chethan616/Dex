import * as fs from 'fs';
import * as path from 'path';

/**
 * The local database. One file, `data/dex.db`, holding what Dex remembers about
 * its own use: every task, every step, and every saved workflow.
 *
 * Uses Node's built-in `node:sqlite` rather than better-sqlite3. That removes a
 * native module from the dependency tree — no compiler toolchain, no prebuilt
 * binaries to go stale on a Node upgrade, nothing to rebuild on a fresh clone.
 * It is flagged experimental, which is worth knowing but not worth a native
 * dependency for a local, single-writer, few-thousand-rows-a-year workload.
 *
 * Nothing here leaves the machine.
 */

type Row = Record<string, unknown>;

interface Statement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): Row | undefined;
  all(...params: unknown[]): Row[];
}

interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  request_id   TEXT PRIMARY KEY,
  session_id   TEXT,
  source       TEXT,
  text         TEXT NOT NULL,
  shape        TEXT NOT NULL,
  intent       TEXT,
  status       TEXT,
  step_count   INTEGER DEFAULT 0,
  duration_ms  INTEGER,
  provider     TEXT,
  workflow     TEXT,
  started_at   INTEGER NOT NULL,
  finished_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tasks_shape   ON tasks(shape);
CREATE INDEX IF NOT EXISTS idx_tasks_started ON tasks(started_at);

CREATE TABLE IF NOT EXISTS steps (
  request_id   TEXT NOT NULL,
  step_id      TEXT NOT NULL,
  capability   TEXT,
  action       TEXT,
  tier         INTEGER,
  status       TEXT,
  verification TEXT,
  escalated_to TEXT,
  ts           INTEGER NOT NULL,
  PRIMARY KEY (request_id, step_id, ts)
);
CREATE INDEX IF NOT EXISTS idx_steps_action ON steps(action);

CREATE TABLE IF NOT EXISTS workflows (
  name         TEXT PRIMARY KEY,
  description  TEXT,
  trigger_text TEXT NOT NULL,
  shape        TEXT NOT NULL,
  params       TEXT NOT NULL,
  plan         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_run_at  INTEGER,
  run_count    INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_workflows_shape ON workflows(shape);
`;

let handle: Database | null = null;

/**
 * `DEX_DB` points this somewhere else — used by tests, which must not read the
 * owner's real history or match against workflows they never saved. That is not
 * hypothetical: a workflow saved during development silently hijacked six
 * confirmation-tier tests, because the requests they submit now matched it and
 * replayed instead of planning.
 */
export function db(file = process.env.DEX_DB || path.join('data', 'dex.db')): Database {
  if (handle) return handle;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (p: string) => Database;
  };

  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const database = new DatabaseSync(path.resolve(file));

  // WAL so a long-running task writing telemetry never blocks the UI reading it.
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec(SCHEMA);

  handle = database;
  return handle;
}

export function closeDb(): void {
  handle?.close();
  handle = null;
}

/**
 * `node:sqlite` prints an ExperimentalWarning on first use. It is accurate but
 * it fires on every start, above the prompt, and says nothing the owner can act
 * on — so it is filtered rather than left to train them into ignoring warnings.
 */
export function quietSqliteWarning(): void {
  const original = process.emitWarning.bind(process);
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning?.message ?? '';
    if (text.includes('SQLite is an experimental feature')) return;
    return (original as (...a: unknown[]) => void)(warning, ...rest);
  }) as typeof process.emitWarning;
}
