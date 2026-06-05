/**
 * First-launch auto-migrator for the OpenClaw -> Dex config directory rename.
 *
 * Users upgrading from OpenClaw have a populated ~/.openclaw/ tree (agent
 * databases, auth profiles, plugin records, etc.). Dex now reads from ~/.dex/.
 * This module copies the old tree to the new path on first launch when the
 * new dir does not yet exist, then writes a breadcrumb at the old path so
 * the user understands what happened.
 *
 * Design contract (Phase B.4):
 *   - Idempotent. Existence of `~/.dex` short-circuits future runs.
 *   - Copy, NOT move. The original `~/.openclaw` stays in place so a user
 *     whose newly-installed Dex misbehaves can roll back by reinstalling
 *     OpenClaw without data loss. The breadcrumb tells them they can delete
 *     the old dir when comfortable.
 *   - All paths are injectable for tests (no global mutation; no real HOME
 *     manipulation needed). The single-arg form uses `os.homedir()` for
 *     production callers.
 *   - Failures surface as a returned `MigrationResult` with `error` set, not
 *     thrown exceptions. The caller decides whether a partial-migration is
 *     fatal at startup (B.4 leaves wiring to startup as a follow-up).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface MigrationPaths {
  /** Absolute path to the legacy ~/.openclaw/ directory. */
  oldDir: string;
  /** Absolute path to the canonical ~/.dex/ directory. */
  newDir: string;
}

export interface MigrationResult {
  /** True on this run's first successful copy; false on no-op + on error. */
  migrated: boolean;
  /** Resolved old dir (always populated for diagnostics). */
  from: string;
  /** Resolved new dir (always populated for diagnostics). */
  to: string;
  /** One of: "migrated", "no-legacy", "new-already-exists", "error". */
  reason: MigrationReason;
  /** Set when `reason === "error"`. */
  error?: string;
}

export type MigrationReason =
  | "migrated"
  | "no-legacy"
  | "new-already-exists"
  | "error";

const BREADCRUMB_FILENAME = "MOVED-TO-DEX.txt";

/**
 * Resolve the canonical migration paths from `os.homedir()`. Exposed so
 * tests can substitute a tmpdir without monkey-patching `os.homedir`.
 */
export function resolveMigrationPaths(homeDir = os.homedir()): MigrationPaths {
  return {
    oldDir: path.join(homeDir, ".openclaw"),
    newDir: path.join(homeDir, ".dex"),
  };
}

export interface MigrateConfigDirOptions {
  /**
   * Override the migration paths. Production callers omit this and let
   * `resolveMigrationPaths()` choose from `os.homedir()`.
   */
  paths?: MigrationPaths;
  /**
   * Sink for the "[dex] migrated ..." log line. Defaults to console.log so
   * the message lands in the gateway's normal stdout stream.
   */
  log?: (message: string) => void;
}

/**
 * Perform a one-shot ~/.openclaw -> ~/.dex copy when appropriate. Returns
 * a structured result; never throws on normal filesystem outcomes.
 */
export function migrateOpenClawConfigDir(
  options: MigrateConfigDirOptions = {},
): MigrationResult {
  const paths = options.paths ?? resolveMigrationPaths();
  const { oldDir, newDir } = paths;

  if (!fs.existsSync(oldDir)) {
    return { migrated: false, from: oldDir, to: newDir, reason: "no-legacy" };
  }

  // Legacy exists. If the canonical dir is already there, this is a
  // re-run -- short-circuit and do nothing. We do NOT compare contents;
  // once ~/.dex exists, it is the authoritative tree.
  if (fs.existsSync(newDir)) {
    return {
      migrated: false,
      from: oldDir,
      to: newDir,
      reason: "new-already-exists",
    };
  }

  try {
    // Node 22's fs.cpSync supports recursive copy with timestamp preservation.
    // We use sync so startup ordering is unambiguous; the volume is small
    // (config + auth + small dbs) and gateway boot is not in the hot path.
    fs.cpSync(oldDir, newDir, {
      recursive: true,
      preserveTimestamps: true,
      errorOnExist: false,
    });

    const breadcrumbPath = path.join(oldDir, BREADCRUMB_FILENAME);
    const breadcrumb =
      `Migrated to ${newDir} on ${new Date().toISOString()}.\n` +
      "Dex now reads from ~/.dex/. Delete this old directory once Dex starts cleanly.\n";
    // Best-effort breadcrumb: if the write fails (e.g. permissions), the
    // migration itself still succeeded -- we don't roll back.
    try {
      fs.writeFileSync(breadcrumbPath, breadcrumb, { encoding: "utf8" });
    } catch {
      // swallow -- breadcrumb is a hint, not a contract
    }

    const log = options.log ?? ((m: string) => {
      // eslint-disable-next-line no-console
      console.log(m);
    });
    log(`[dex] migrated config from ${oldDir} to ${newDir}`);

    return { migrated: true, from: oldDir, to: newDir, reason: "migrated" };
  } catch (err) {
    return {
      migrated: false,
      from: oldDir,
      to: newDir,
      reason: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
