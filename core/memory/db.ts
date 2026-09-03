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

export interface Statement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): Row | undefined;
  all(...params: unknown[]): Row[];
}

export interface Database {
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
  finished_at  INTEGER,
  -- 1 for a thumbs-up, -1 for a thumbs-down, null for no opinion. The owner
  -- saying whether a task actually did what they wanted is the only ground
  -- truth this system has; every other signal is Dex marking its own homework.
  feedback     INTEGER
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
  run_count    INTEGER DEFAULT 0,
  -- 'learned' = saved automatically after a task succeeded; 'named' = the
  -- owner asked for it by name. Named ones outrank learned ones and are never
  -- evicted by the cap.
  origin       TEXT NOT NULL DEFAULT 'named',
  -- Replays that failed. Two and it is forgotten -- see WorkflowStore.
  fail_count   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_workflows_shape ON workflows(shape);

CREATE TABLE IF NOT EXISTS artifacts (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  kind        TEXT NOT NULL,
  name        TEXT NOT NULL,
  locator     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_created ON artifacts(created_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id);

CREATE TABLE IF NOT EXISTS plan_cache (
  id          TEXT PRIMARY KEY,
  text        TEXT NOT NULL,
  vector      BLOB NOT NULL,
  plan        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  hits        INTEGER DEFAULT 0,
  last_hit_at INTEGER
);

-- One row per logical conversation, across every channel. Dex has a single
-- owner, so a task started on a phone and followed up at the desk is one
-- session however it arrived.
-- What was actually said.
--
-- The sidebar showed history from the tasks table, so clicking a row could only
-- re-run the request: the request was the only thing on disk. There was no
-- record of a sentence either side had said, which made "history" a list of
-- things once asked rather than a record of anything.
--
-- Written as messages happen rather than reconstructed at the end. A
-- reconstruction loses what is worth keeping — the step that failed, the card
-- that was shown, the answer in the words it was given in.
CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The thread the owner sees. Not a task: a conversation holds however many
  -- requests they made without starting a new chat.
  conversation_id TEXT NOT NULL,
  -- Which task this came from, when it came from one. Null for anything said
  -- outside a request.
  request_id      TEXT,
  speaker         TEXT NOT NULL,
  text            TEXT NOT NULL,
  -- Everything needed to redraw the message that is not its text: a step's
  -- action and verdict, an artifact card. JSON because the shape belongs to
  -- the app, and a column per field means a migration every time a card gains
  -- a line.
  detail          TEXT,
  at              INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, at);
CREATE INDEX IF NOT EXISTS idx_messages_at   ON messages(at);

-- A conversation the owner has renamed. Its own table so a rename is one row
-- rather than a column on every message in the thread.
CREATE TABLE IF NOT EXISTS conversation_names (
  conversation_id TEXT PRIMARY KEY,
  name            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  started_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  channels      TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_sessions_seen ON sessions(last_seen_at);

-- Things Dex should do without being asked.
--
-- last_fired_at is what stops a restart re-running something already done: the
-- engine only fires a schedule whose due minute is newer than this.
--
-- Nobody is watching an unattended run, so what a schedule is allowed to
-- contain is decided when it is created, not when it fires at 3am.
CREATE TABLE IF NOT EXISTS schedules (
  name          TEXT PRIMARY KEY,
  cron          TEXT NOT NULL,
  request       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  last_fired_at INTEGER,
  last_status   TEXT,
  run_count     INTEGER NOT NULL DEFAULT 0,
  fail_count    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled);

-- How to get somewhere on a site whose pages do not say what they are.
--
-- The click path, not a URL: portals built on server-side session state answer
-- a bare GET of an inner page with a timeout screen, so the path is the durable
-- thing and the destination is not. See core/memory/site_routes.ts.
CREATE TABLE IF NOT EXISTS site_routes (
  origin         TEXT NOT NULL,
  goal           TEXT NOT NULL,
  steps          TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  last_worked_at INTEGER,
  run_count      INTEGER NOT NULL DEFAULT 0,
  fail_count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (origin, goal)
);
CREATE INDEX IF NOT EXISTS idx_site_routes_origin ON site_routes(origin);
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

  // A test that can write to the real store is a test that can lie about
  // production. This one did: `data/dex.db` ended up holding two `set_dns`
  // tasks marked COMPLETED, written by a suite running against a mocked agent,
  // for an action that had never once reached the daemon. Anyone reading the
  // history to find out what actually worked — including the investigation
  // that eventually found the real bug — was reading fiction.
  const resolved = path.resolve(file);
  if (process.env.DEX_TEST === '1' && resolved === path.resolve('data', 'dex.db')) {
    throw new Error(
      'A test tried to open the real database at data/dex.db.\n' +
        "Add `import '../support/isolate';` as the FIRST import of the test.",
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (p: string) => Database;
  };

  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const database = new DatabaseSync(path.resolve(file));

  // WAL so a long-running task writing telemetry never blocks the UI reading it.
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec(SCHEMA);
  migrate(database);

  handle = database;
  return handle;
}

/**
 * Columns added to a table that already exists.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a database that already has the
 * table, so a new column in SCHEMA never reaches an existing install — the
 * owner's own machine being the first place that matters. Each ALTER is tried
 * and its "duplicate column" error ignored, which is the whole migration
 * strategy this needs: additive, idempotent, and no version table to keep in
 * step with anything.
 */
function migrate(database: Database): void {
  const additions = [
    "ALTER TABLE workflows ADD COLUMN origin TEXT NOT NULL DEFAULT 'named'",
    'ALTER TABLE workflows ADD COLUMN fail_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN feedback INTEGER',
  ];
  for (const sql of additions) {
    try {
      database.exec(sql);
    } catch {
      // Already there. The only other way this fails is a database that cannot
      // be written to at all, which the next statement will report properly.
    }
  }
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
