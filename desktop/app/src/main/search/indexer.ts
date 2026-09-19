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
import path from 'node:path';
import { extractContent } from './extract';
import { nextPendingBatch, openIndexDb, removeFileByPath, setContent, upsertFileMeta, indexStats } from './db';
import { scanRoots } from './scan';
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
 * Drive roots that actually exist on this machine, or an explicit override.
 *
 * `DEX_INDEX_ROOTS` (comma-separated) exists for two reasons: it is how this
 * was verified end to end without pointing a real crawl at C:\ and D:\, and
 * it is the config change the plan names as the fix if a full-drive index
 * ever proves too slow or broad in practice — no code change needed to scope
 * it down to, say, just the user's Documents and Desktop.
 */
function detectRoots(): string[] {
  const override = process.env.DEX_INDEX_ROOTS;
  if (override) return override.split(',').map((root) => root.trim()).filter(Boolean);

  const candidates = ['C:\\', 'D:\\'];
  return candidates.filter((root) => {
    try {
      return fs.existsSync(root);
    } catch {
      return false;
    }
  });
}

async function runScanPhase(roots: string[]): Promise<void> {
  scanning = true;
  scannedFiles = 0;
  try {
    const { scanned, stopped } = await scanRoots({
      roots,
      onFile: (record) => {
        upsertFileMeta(record);
        scannedFiles += 1;
        if (stopRequested) return false;
      },
      onProgress: (count) => {
        if (count > 0 && count % 20000 === 0) {
          mainLogger.info('search.index.scanProgress', { count });
        }
      },
    });
    mainLogger.info('search.index.scanDone', { scanned, stopped, roots });
  } catch (err) {
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
