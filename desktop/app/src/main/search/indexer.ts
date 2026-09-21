/**
 * Orchestrates the index: a fast metadata-only scan first, so filename search
 * works within a couple of minutes, then a slow, throttled content backfill
 * behind it that never blocks the fast path or the app's own event loop.
 *
 * This does not use a worker_threads pool. The plan called for one; given the
 * time this phase had, a single throttled async loop in main — yielding with
 * `setImmediate` between batches — was the honest tradeoff: it keeps the
 * loopback server responsive without the added build-and-package surface of
 * a second bundled entry point. If cold-index CPU cost turns out to matter in
 * practice, moving the backfill loop into a worker is a contained follow-up;
 * nothing here would need to change shape to support it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractContent } from './extract';
import { nextPendingBatch, openIndexDb, removeFileByPath, setContent, upsertFileMeta, indexStats, runInTransaction } from './db';
import { scanRoots, isPathSkipped } from './scan';
import type { FileRecord } from './db';
import { mainLogger } from '../logger';

const BACKFILL_BATCH_SIZE = 8;
const BACKFILL_IDLE_DELAY_MS = 2000; // when the queue is empty, wait before checking again
const BACKFILL_BATCH_DELAY_MS = 50; // between batches, so extraction never monopolises the event loop
const WATCH_DEBOUNCE_MS = 1500;

export interface IndexStatus {
  running: boolean;
  scanning: boolean;
  scannedFiles: number;
  total: number;
  indexed: number;
  pending: number;
}

let running = false;
let scanning = false;
let scannedFiles = 0;
let stopRequested = false;
let watchers: fs.FSWatcher[] = [];

/**
 * Document-bearing roots that actually exist on this machine, or an explicit
 * override.
 *
 * This used to default to the whole of `C:\` and `D:\` — the plan's original
 * "index everywhere" scope. In practice that meant a full recursive
 * `fs.watch` sitting on both entire drives for the app's whole lifetime, plus
 * an initial walk touching every file under Windows, Program Files, and
 * every project's `node_modules` on the machine — real, sustained CPU and
 * disk I/O contention severe enough to make the whole app (including
 * completely unrelated UI, like a button's hover state) feel unresponsive
 * for as long as it ran. The user's own documents were always going to be
 * under their home directory anyway, so scanning and watching the *whole*
 * of C:\ bought nothing search-relevant for a very large, ongoing cost.
 *
 * `DEX_INDEX_ROOTS` (comma-separated) still exists to go back to a full
 * drive, or to scope even narrower (just Desktop and Documents) — no code
 * change needed either way.
 */
function detectRoots(): string[] {
  const override = process.env.DEX_INDEX_ROOTS;
  if (override) return override.split(',').map((root) => root.trim()).filter(Boolean);

  const candidates = [os.homedir(), 'D:\\'];
  const seen = new Set<string>();
  return candidates.filter((root) => {
    const key = root.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    try {
      return fs.existsSync(root);
    } catch {
      return false;
    }
  });
}

const SCAN_FLUSH_BATCH = 400;

async function runScanPhase(roots: string[]): Promise<void> {
  scanning = true;
  scannedFiles = 0;
  // better-sqlite3 is synchronous and runs on the main process thread — the
  // same thread serving every IPC call the UI makes. Writing each scanned
  // file individually meant one implicit transaction (and commit) per file,
  // hundreds of thousands of times, which is what made unrelated UI actions
  // stall for seconds while an index build was running. Buffering and
  // flushing in one transaction per batch turns that into a few hundred
  // commits instead of a few hundred thousand.
  let buffer: FileRecord[] = [];
  const flush = (): void => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    runInTransaction(() => {
      for (const record of batch) upsertFileMeta(record);
    });
  };

  try {
    const { scanned, stopped } = await scanRoots({
      roots,
      onFile: (record) => {
        buffer.push(record);
        if (buffer.length >= SCAN_FLUSH_BATCH) flush();
        scannedFiles += 1;
        if (stopRequested) return false;
      },
      onProgress: (count) => {
        if (count > 0 && count % 20000 === 0) {
          mainLogger.info('search.index.scanProgress', { count });
        }
      },
    });
    flush();
    mainLogger.info('search.index.scanDone', { scanned, stopped, roots });
  } catch (err) {
    flush();
    mainLogger.warn('search.index.scanFailed', { error: (err as Error).message });
  } finally {
    scanning = false;
  }
}

async function runBackfillLoop(): Promise<void> {
  while (!stopRequested) {
    const batch = nextPendingBatch(BACKFILL_BATCH_SIZE);
    if (batch.length === 0) {
      // Keep checking: the scan phase may still be discovering files, or a
      // watcher may enqueue new ones, well after this loop starts.
      await new Promise((resolve) => setTimeout(resolve, BACKFILL_IDLE_DELAY_MS));
      continue;
    }

    for (const file of batch) {
      if (stopRequested) break;
      const { content, state } = await extractContent(file.path, file.ext, file.size);
      setContent(file.id, content, state);
    }

    await new Promise((resolve) => setTimeout(resolve, BACKFILL_BATCH_DELAY_MS));
  }
}

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: NodeJS.Timeout | null = null;
  return ((...args: never[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

/**
 * Best-effort freshness. `fs.watch` on a whole drive can silently overflow
 * its change buffer on a huge tree — acceptable here, since the periodic
 * rescan this function does NOT replace is what a lost event eventually
 * self-heals through. A watch failing to start (permissions, an unsupported
 * filesystem) never stops indexing itself.
 */
function startWatchers(roots: string[]): void {
  for (const root of roots) {
    try {
      const onChange = debounce((eventType: string, filename: string | Buffer | null) => {
        if (!filename) return;
        const full = path.join(root, filename.toString());
        // The native OS watch still fires for a skipped subtree (AppData,
        // node_modules, ...) even though the scan phase never walked into
        // it — Windows has no concept of our skip-list. Bail before the
        // stat call rather than after, so a chatty excluded directory (a
        // browser cache, an active npm install) costs nothing per event.
        if (isPathSkipped(full)) return;
        fs.promises.stat(full).then(
          (stat) => {
            if (!stat.isFile()) return;
            const ext = path.extname(full).replace(/^\./, '').toLowerCase();
            upsertFileMeta({ path: full, name: path.basename(full), ext, dir: path.dirname(full), size: stat.size, mtime: Math.floor(stat.mtimeMs) });
          },
          () => removeFileByPath(full), // stat failed: the file is gone
        );
      }, WATCH_DEBOUNCE_MS);

      const watcher = fs.watch(root, { recursive: true }, onChange);
      watcher.on('error', (err) => mainLogger.warn('search.index.watchError', { root, error: err.message }));
      watchers.push(watcher);
    } catch (err) {
      mainLogger.warn('search.index.watchFailed', { root, error: (err as Error).message });
    }
  }
}

/**
 * Start indexing in the background. Safe to call once at app bootstrap;
 * idempotent so a second call (e.g. a settings toggle) is a no-op while
 * already running.
 */
export function startIndexing(userDataPath: string): void {
  if (running) return;
  if (process.env.DEX_DISABLE_FILE_INDEX === '1') {
    mainLogger.info('search.index.disabledByEnv');
    return;
  }
  running = true;
  stopRequested = false;
  openIndexDb(userDataPath);

  const roots = detectRoots();
  mainLogger.info('search.index.starting', { roots });

  void runScanPhase(roots).then(() => startWatchers(roots));
  void runBackfillLoop();
}

export function stopIndexing(): void {
  stopRequested = true;
  running = false;
  for (const watcher of watchers) {
    try {
      watcher.close();
    } catch {
      // Already closed.
    }
  }
  watchers = [];
}

export function getIndexStatus(): IndexStatus {
  const stats = indexStats();
  return { running, scanning, scannedFiles, ...stats };
}
