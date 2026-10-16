/**
 * Where DEX's memory lives on disk: `<userData>/memory/`, one JSON file per
 * kind (sites.json, notes.json), each written whole through a temp file so a
 * crash mid-write never leaves half of one. Logins aren't here — they're in
 * the OS credential store (siteStore.ts).
 *
 * Every change is announced on `memoryEvents`, so an open Settings page shows
 * what an agent just remembered without being reopened.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

export const memoryEvents = new EventEmitter();

let dirOverride: string | null = null;

/** Test seam: point the stores at a scratch folder. */
export function setMemoryDir(dir: string | null): void {
  dirOverride = dir;
}

export function memoryFile(name: string): string {
  if (dirOverride) return path.join(dirOverride, name);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron');
  return path.join(app.getPath('userData'), 'memory', name);
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return null; // none yet, or unreadable
  }
}

/** Throws when the disk refuses: a memory that didn't save mustn't say it did. */
export function writeJson(file: string, body: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
  memoryEvents.emit('changed');
}
