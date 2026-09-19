/**
 * Walks the configured roots collecting file metadata. Content extraction is
 * a separate, later pass (see indexer.ts) — this phase alone is what makes
 * filename search usable within the first couple of minutes on a cold index.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FileRecord } from './db';

// 'appdata' is the big one: browser caches, npm/pip/nuget caches, every
// Electron/Chromium app's own userData, IDE indexes — millions of files that
// are never a document a person is looking for, and the entire reason a
// home-directory-scoped scan still needed a skip-list at all.
const SKIP_DIR_NAMES = new Set([
  'node_modules', '.git', '$recycle.bin', 'system volume information', 'winsxs',
  'appdata', '.cache', '__pycache__', '.venv', 'venv',
]);

function shouldSkipDir(name: string): boolean {
  return SKIP_DIR_NAMES.has(name.toLowerCase());
}

/**
 * Whether a path falls under a skipped directory name at any depth — used by
 * the watcher (indexer.ts), which gets raw OS change events for a whole
 * watched subtree regardless of what the scan phase chose to walk into, so a
 * skipped directory needs its own check there too or watched-but-unwanted
 * churn (a browser writing its cache) would still get individually stat'd
 * and inserted.
 */
export function isPathSkipped(fullPath: string): boolean {
  return fullPath.toLowerCase().split(path.sep).some((segment) => SKIP_DIR_NAMES.has(segment));
}

export interface ScanOptions {
  roots: string[];
  /** Called for every file found. Returning `false` stops the whole walk. */
  onFile: (record: FileRecord) => boolean | void;
  /** Called once per directory entered, for progress reporting. */
  onProgress?: (scanned: number, currentDir: string) => void;
}

/**
 * Walks depth-first. Windows junctions (e.g. a profile's "Application Data"
 * pointing back at "AppData\Local") are not reliably reported as symlinks by
 * `Dirent.isSymbolicLink()`, so cycles are prevented by tracking each
 * directory's resolved real path rather than trusting the link bit.
 */
export async function scanRoots(opts: ScanOptions): Promise<{ scanned: number; stopped: boolean }> {
  const { roots, onFile, onProgress } = opts;
  let scanned = 0;
  let stopped = false;
  const visitedRealDirs = new Set<string>();

  const visit = async (dir: string): Promise<void> => {
    if (stopped) return;

    let real: string;
    try {
      real = (await fs.promises.realpath(dir)).toLowerCase();
    } catch {
      return; // vanished, or a broken reparse point
    }
    if (visitedRealDirs.has(real)) return; // cycle guard
    visitedRealDirs.add(real);

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return; // permission denied — routine walking C:\ as a non-elevated user
    }

    onProgress?.(scanned, dir);

    for (const entry of entries) {
      if (stopped) return;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue;
        await visit(full);
        continue;
      }
      if (!entry.isFile()) continue;

      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(full);
      } catch {
        continue;
      }

      const ext = path.extname(entry.name).replace(/^\./, '').toLowerCase();
      const record: FileRecord = {
        path: full,
        name: entry.name,
        ext,
        dir,
        size: stat.size,
        mtime: Math.floor(stat.mtimeMs),
      };
      scanned += 1;
      // Yield periodically so a huge directory (System32) never starves the
      // event loop the process also needs for the loopback control server.
      if (scanned % 500 === 0) await new Promise((resolve) => setImmediate(resolve));
      if (onFile(record) === false) {
        stopped = true;
        return;
      }
    }
  };

  for (const root of roots) {
    if (stopped) break;
    await visit(root);
  }

  return { scanned, stopped };
}
