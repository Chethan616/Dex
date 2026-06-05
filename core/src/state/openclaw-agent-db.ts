import { chmodSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  clearNodeSqliteKyselyCacheForDatabase,
  executeSqliteQuerySync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { runSqliteImmediateTransactionSync } from "../infra/sqlite-transaction.js";
import { configureSqliteWalMaintenance, type SqliteWalMaintenance } from "../infra/sqlite-wal.js";
import { normalizeAgentId } from "../routing/session-key.js";
import type { DB as DexAgentKyselyDatabase } from "./openclaw-agent-db.generated.js";
import { resolveOpenClawAgentSqlitePath } from "./openclaw-agent-db.paths.js";
import { DEX_AGENT_SCHEMA_SQL } from "./openclaw-agent-schema.generated.js";
import type { DB as DexStateKyselyDatabase } from "./openclaw-state-db.generated.js";
import {
  DEX_SQLITE_BUSY_TIMEOUT_MS,
  openDexStateDatabase,
  runOpenClawStateWriteTransaction,
  type DexStateDatabaseOptions,
} from "./openclaw-state-db.js";
export { resolveOpenClawAgentSqlitePath } from "./openclaw-agent-db.paths.js";

const DEX_AGENT_SCHEMA_VERSION = 1;
const DEX_AGENT_DB_DIR_MODE = 0o700;
const DEX_AGENT_DB_FILE_MODE = 0o600;
const DEX_AGENT_DB_SIDECAR_SUFFIXES = ["", "-shm", "-wal"] as const;

export type DexAgentDatabase = {
  agentId: string;
  db: DatabaseSync;
  path: string;
  walMaintenance: SqliteWalMaintenance;
};

export type DexAgentDatabaseOptions = DexStateDatabaseOptions & {
  agentId: string;
};

export type DexRegisteredAgentDatabase = {
  agentId: string;
  path: string;
  schemaVersion: number;
  lastSeenAt: number;
  sizeBytes: number | null;
};

type DexAgentMetadataDatabase = Pick<DexAgentKyselyDatabase, "schema_meta">;
type DexAgentRegistryDatabase = Pick<DexStateKyselyDatabase, "agent_databases">;

const cachedDatabases = new Map<string, DexAgentDatabase>();

type ExistingSchemaMeta = {
  agentId: string | null;
  role: string | null;
};

function readSqliteUserVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version?: unknown } | undefined;
  return Number(row?.user_version ?? 0);
}

function assertSupportedAgentSchemaVersion(db: DatabaseSync, pathname: string): void {
  const userVersion = readSqliteUserVersion(db);
  if (userVersion > DEX_AGENT_SCHEMA_VERSION) {
    throw new Error(
      `OpenClaw agent database ${pathname} uses newer schema version ${userVersion}; this OpenClaw build supports ${DEX_AGENT_SCHEMA_VERSION}.`,
    );
  }
}

function ensureDexAgentDatabasePermissions(
  pathname: string,
  options: DexAgentDatabaseOptions,
): void {
  const dir = path.dirname(pathname);
  const defaultPath = resolveOpenClawAgentSqlitePath({
    agentId: options.agentId,
    env: options.env,
  });
  const isDefaultAgentDatabase = path.resolve(pathname) === path.resolve(defaultPath);
  const dirExisted = existsSync(dir);
  mkdirSync(dir, { recursive: true, mode: DEX_AGENT_DB_DIR_MODE });
  if (isDefaultAgentDatabase || !dirExisted) {
    chmodSync(dir, DEX_AGENT_DB_DIR_MODE);
  }
  for (const suffix of DEX_AGENT_DB_SIDECAR_SUFFIXES) {
    const candidate = `${pathname}${suffix}`;
    if (existsSync(candidate)) {
      chmodSync(candidate, DEX_AGENT_DB_FILE_MODE);
    }
  }
}

function readExistingSchemaMeta(db: DatabaseSync): ExistingSchemaMeta | null {
  const schemaMetaTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'")
    .get();
  if (!schemaMetaTable) {
    return null;
  }
  const row = db
    .prepare("SELECT role, agent_id FROM schema_meta WHERE meta_key = 'primary'")
    .get() as { agent_id?: unknown; role?: unknown } | undefined;
  if (!row) {
    return null;
  }
  return {
    agentId: typeof row.agent_id === "string" ? row.agent_id : null,
    role: typeof row.role === "string" ? row.role : null,
  };
}

function assertExistingSchemaOwner(
  existing: ExistingSchemaMeta | null,
  agentId: string,
  pathname: string,
): void {
  if (!existing) {
    return;
  }
  if (existing.role !== "agent") {
    throw new Error(
      `OpenClaw agent database ${pathname} has schema role ${existing.role ?? "unknown"}; expected agent.`,
    );
  }
  if (!existing.agentId) {
    throw new Error(`OpenClaw agent database ${pathname} has no agent owner.`);
  }
  if (normalizeAgentId(existing.agentId) !== agentId) {
    throw new Error(
      `OpenClaw agent database ${pathname} belongs to agent ${existing.agentId}; requested agent ${agentId}.`,
    );
  }
}

function ensureAgentSchema(db: DatabaseSync, agentId: string, pathname: string): void {
  assertSupportedAgentSchemaVersion(db, pathname);
  assertExistingSchemaOwner(readExistingSchemaMeta(db), agentId, pathname);
  db.exec(DEX_AGENT_SCHEMA_SQL);
  const kysely = getNodeSqliteKysely<DexAgentMetadataDatabase>(db);
  db.exec(`PRAGMA user_version = ${DEX_AGENT_SCHEMA_VERSION};`);
  const now = Date.now();
  executeSqliteQuerySync(
    db,
    kysely
      .insertInto("schema_meta")
      .values({
        meta_key: "primary",
        role: "agent",
        schema_version: DEX_AGENT_SCHEMA_VERSION,
        agent_id: agentId,
        app_version: null,
        created_at: now,
        updated_at: now,
      })
      .onConflict((conflict) =>
        conflict.column("meta_key").doUpdateSet({
          role: "agent",
          schema_version: DEX_AGENT_SCHEMA_VERSION,
          agent_id: agentId,
          app_version: null,
          updated_at: now,
        }),
      ),
  );
}

function registerAgentDatabase(params: {
  agentId: string;
  path: string;
  env?: NodeJS.ProcessEnv;
}): void {
  let sizeBytes: number | null = null;
  try {
    sizeBytes = statSync(params.path).size;
  } catch {
    sizeBytes = null;
  }
  const lastSeenAt = Date.now();
  runOpenClawStateWriteTransaction(
    (database) => {
      const db = getNodeSqliteKysely<DexAgentRegistryDatabase>(database.db);
      executeSqliteQuerySync(
        database.db,
        db
          .insertInto("agent_databases")
          .values({
            agent_id: params.agentId,
            path: params.path,
            schema_version: DEX_AGENT_SCHEMA_VERSION,
            last_seen_at: lastSeenAt,
            size_bytes: sizeBytes,
          })
          .onConflict((conflict) =>
            conflict.columns(["agent_id", "path"]).doUpdateSet({
              schema_version: DEX_AGENT_SCHEMA_VERSION,
              last_seen_at: lastSeenAt,
              size_bytes: sizeBytes,
            }),
          ),
      );
    },
    { env: params.env },
  );
}

export function listDexRegisteredAgentDatabases(
  options: DexStateDatabaseOptions = {},
): DexRegisteredAgentDatabase[] {
  const database = openDexStateDatabase(options);
  const db = getNodeSqliteKysely<DexAgentRegistryDatabase>(database.db);
  const rows = executeSqliteQuerySync(
    database.db,
    db.selectFrom("agent_databases").selectAll().orderBy("agent_id", "asc").orderBy("path", "asc"),
  ).rows;
  return rows.map((row) => ({
    agentId: normalizeAgentId(row.agent_id),
    path: row.path,
    schemaVersion: row.schema_version,
    lastSeenAt: row.last_seen_at,
    sizeBytes: row.size_bytes,
  }));
}

export function openDexAgentDatabase(
  options: DexAgentDatabaseOptions,
): DexAgentDatabase {
  const agentId = normalizeAgentId(options.agentId);
  const databaseOptions = { ...options, agentId };
  const pathname = resolveOpenClawAgentSqlitePath(databaseOptions);
  const cached = cachedDatabases.get(pathname);
  if (cached?.db.isOpen) {
    if (cached.agentId !== agentId) {
      throw new Error(
        `OpenClaw agent database ${pathname} is already open for agent ${cached.agentId}; requested agent ${agentId}.`,
      );
    }
    registerAgentDatabase({ agentId, path: pathname, env: options.env });
    return cached;
  }
  if (cached) {
    cached.walMaintenance.close();
    clearNodeSqliteKyselyCacheForDatabase(cached.db);
    cachedDatabases.delete(pathname);
  }

  ensureDexAgentDatabasePermissions(pathname, databaseOptions);
  const sqlite = requireNodeSqlite();
  const db = new sqlite.DatabaseSync(pathname);
  const walMaintenance = configureSqliteWalMaintenance(db, {
    databaseLabel: `openclaw-agent:${agentId}`,
    databasePath: pathname,
  });
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(`PRAGMA busy_timeout = ${DEX_SQLITE_BUSY_TIMEOUT_MS};`);
  db.exec("PRAGMA foreign_keys = ON;");
  try {
    ensureAgentSchema(db, agentId, pathname);
  } catch (err) {
    walMaintenance.close();
    db.close();
    throw err;
  }
  ensureDexAgentDatabasePermissions(pathname, databaseOptions);
  const database = { agentId, db, path: pathname, walMaintenance };
  cachedDatabases.set(pathname, database);
  registerAgentDatabase({ agentId, path: pathname, env: options.env });
  return database;
}

export function runOpenClawAgentWriteTransaction<T>(
  operation: (database: DexAgentDatabase) => T,
  options: DexAgentDatabaseOptions,
): T {
  const database = openDexAgentDatabase(options);
  const result = runSqliteImmediateTransactionSync(database.db, () => operation(database));
  ensureDexAgentDatabasePermissions(database.path, options);
  return result;
}

export function closeDexAgentDatabasesForTest(): void {
  for (const database of cachedDatabases.values()) {
    database.walMaintenance.close();
    clearNodeSqliteKyselyCacheForDatabase(database.db);
    database.db.close();
  }
  cachedDatabases.clear();
}
