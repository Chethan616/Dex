/**
 * A path as an agent wrote it, as a real path on this PC.
 *
 * Agents run in Git Bash and record files every which way: `/c/Users/…`,
 * `/tmp/mh/render.png` (Git Bash's /tmp is %TEMP%), `outputs\…` relative to
 * their working directory (the harness), or a proper `C:\…`. A path Node
 * can't find means no picture card, no preview and a file the phone can't
 * fetch — so every recorded path goes through here first.
 */
import os from 'node:os';
import path from 'node:path';

export function resolveAgentPath(raw: string, cwd: string): string {
  const p = raw.trim().replace(/^(["'])(.*)\1$/, '$2');
  if (process.platform !== 'win32') return path.resolve(cwd, p);
  const drive = /^\/([a-zA-Z])(?:\/(.*))?$/.exec(p);
  if (drive) return path.win32.normalize(`${drive[1].toUpperCase()}:\\${drive[2] ?? ''}`);
  const tmp = /^\/tmp(?:\/(.*))?$/.exec(p);
  if (tmp) return path.win32.join(os.tmpdir(), tmp[1] ?? '');
  return path.win32.resolve(cwd, p);
}
