/**
 * @dexagent/file-intel — public façade.
 *
 * Phase G.2 scaffold. Every method here returns
 * `{ ok: false, error: notYetImplemented(...) }` until G.3+ wires the
 * real pipeline. Callers can import + bind to these types today; their
 * own code stays unchanged when implementations land.
 *
 * See README.md for the gating rationale.
 */

import {
  notYetImplemented,
  type FileMetadata,
  type Result,
  type SearchRequest,
  type SearchResponse,
} from "./types.js";

export * from "./types.js";

export interface FileIntel {
  /** Start watching the configured roots (Desktop, Documents, Downloads,
   *  Pictures by default). Returns when the watcher is online; indexing
   *  continues in the background. */
  start(): Promise<Result<void>>;

  /** Stop the watcher and flush pending state. */
  stop(): Promise<Result<void>>;

  /** Pause indexing (watcher keeps listening; jobs queue up). Useful when
   *  the user wants a focused window of zero CPU/disk activity. */
  pause(): Promise<Result<void>>;

  /** Resume after pause. */
  resume(): Promise<Result<void>>;

  /** Run a natural-language search. */
  search(req: SearchRequest): Promise<Result<SearchResponse>>;

  /** Get the current metadata snapshot for a file by absolute path. */
  getByPath(path: string): Promise<Result<FileMetadata>>;

  /** Force a re-extract + re-embed of a specific file (e.g. after a
   *  classifier-prior update). */
  reindex(path: string): Promise<Result<void>>;

  /** Drop a file from the index without deleting the file on disk. */
  forget(path: string): Promise<Result<void>>;
}

/**
 * Build the file-intel facade. Today this returns a façade whose every
 * method short-circuits to a "not yet implemented" error -- callers can
 * import and bind without crashing. G.3 replaces the body with the real
 * pipeline assembly.
 */
export function createFileIntel(): FileIntel {
  return {
    async start() {
      return { ok: false, error: notYetImplemented("start") };
    },
    async stop() {
      return { ok: false, error: notYetImplemented("stop") };
    },
    async pause() {
      return { ok: false, error: notYetImplemented("pause") };
    },
    async resume() {
      return { ok: false, error: notYetImplemented("resume") };
    },
    async search(_req) {
      return { ok: false, error: notYetImplemented("search") };
    },
    async getByPath(_path) {
      return { ok: false, error: notYetImplemented("getByPath") };
    },
    async reindex(_path) {
      return { ok: false, error: notYetImplemented("reindex") };
    },
    async forget(_path) {
      return { ok: false, error: notYetImplemented("forget") };
    },
  };
}
