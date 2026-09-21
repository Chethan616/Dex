/**
 * Filename-only search over the user's document folders, used when Windows
 * Search answers nothing — either because it is disabled, or (the common
 * case) because those folders are not in its indexed scope.
 *
 * Deliberately narrow. This is a safety net, not a second index: it walks
 * only on demand, only when a search already came back empty, matches
 * filenames only, and is bounded in both breadth and time. Re-extracting
 * document text here would reintroduce exactly the cost that removing the
 * old SQLite index was meant to eliminate.
 *
 * The walk runs in a `worker_thread` so even this bounded work never lands
 * on the main process thread that serves the UI's IPC.
 */
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { QueryGroup } from './aliases';
import type { SearchCandidate } from './rank';
import { mainLogger } from '../logger';

const WALK_TIMEOUT_MS = 6_000;
const MAX_FILES_VISITED = 40_000;

/** The folders a person's documents actually live in, incl. OneDrive-redirected ones. */
export function documentRoots(homeDir: string = os.homedir()): string[] {
  return [
    path.join(homeDir, 'Desktop'),
    path.join(homeDir, 'Documents'),
    path.join(homeDir, 'Downloads'),
    path.join(homeDir, 'OneDrive', 'Desktop'),
    path.join(homeDir, 'OneDrive', 'Documents'),
    path.join(homeDir, 'OneDrive', 'Downloads'),
  ];
}

/**
 * The worker body, inlined as a string so this needs no second bundled
 * entry point in the Vite/Forge build — the reason the original indexer
 * gave for not using a worker at all. A self-contained walk has no imports
 * to resolve, so that objection does not apply here.
 */
const WORKER_SOURCE = `
const fs = require('node:fs');
const path = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');

const SKIP = new Set(['node_modules', '.git', 'appdata', '.cache', '__pycache__', '.venv', 'venv',
  // A document folder often contains a whole dev checkout (this machine's
  // Desktop holds one). None of these hold documents a person searches for,
  // and walking them is most of what made the fallback slow.
  'dist', 'build', 'out', '.next', '.nuxt', 'target', 'vendor', '.gradle', '.idea', '.vscode',
  'obj', 'bin', '.venv', 'site-packages', '.terraform', 'coverage']);
const { roots, needles, cap, maxVisited } = workerData;
const out = [];
let visited = 0;

function matches(lowerName) {
  // Every group must be satisfied by the filename — the same "all groups"
  // rule rank.ts applies, just without content to match against.
  for (const variants of needles) {
    let hit = false;
    for (const v of variants) { if (lowerName.includes(v)) { hit = true; break; } }
    if (!hit) return false;
  }
  return true;
}

function walk(dir) {
  if (out.length >= cap || visited >= maxVisited) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (out.length >= cap || visited >= maxVisited) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name.toLowerCase())) continue;
      walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    visited++;
    maybePost();
    if (!matches(entry.name.toLowerCase())) continue;
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    out.push({ path: full, name: entry.name, content: '', size: stat.size, mtime: Math.floor(stat.mtimeMs) });
  }
}

let lastPost = 0;
function maybePost() {
  // Post progress periodically so a timeout on the parent side still gets
  // whatever has been found, instead of throwing the whole walk away.
  if (visited - lastPost < 2000) return;
  lastPost = visited;
  parentPort.postMessage({ partial: true, rows: out.slice() });
}

for (const root of roots) walk(root);
parentPort.postMessage({ partial: false, rows: out });
`;

export function filenameFallback(
  groups: QueryGroup[],
  cap: number,
  roots: string[] = documentRoots(),
): Promise<SearchCandidate[]> {
  const needles = groups
    .map((group) => group.variants.map((v) => v.toLowerCase()).filter(Boolean))
    .filter((variants) => variants.length > 0);
  if (needles.length === 0) return Promise.resolve([]);

  return new Promise<SearchCandidate[]>((resolve) => {
    let settled = false;
    const finish = (rows: SearchCandidate[]): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(rows);
    };

    let worker: Worker;
    try {
      worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: { roots, needles, cap, maxVisited: MAX_FILES_VISITED },
      });
    } catch (err) {
      mainLogger.warn('search.fallback.workerFailed', { error: (err as Error).message });
      resolve([]);
      return;
    }

    let latest: SearchCandidate[] = [];

    const timer = setTimeout(() => {
      mainLogger.warn('search.fallback.timedOut', { rootCount: roots.length, partialRows: latest.length });
      finish(latest);
    }, WALK_TIMEOUT_MS);

    worker.on('message', (msg: { partial: boolean; rows: SearchCandidate[] }) => {
      const rows = Array.isArray(msg?.rows) ? msg.rows : [];
      if (msg?.partial) { latest = rows; return; }
      finish(rows);
    });
    worker.on('error', (err) => {
      mainLogger.warn('search.fallback.error', { error: err.message });
      finish(latest);
    });
    worker.on('exit', () => finish(latest));
  });
}
