/**
 * Files a task recorded — what the chat's file cards may open.
 *
 * The older output handlers only open files inside DEX's own `outputs/`
 * folder. Tasks often save to the user's real folders (Downloads,
 * Documents), so the chat opens any path *this task recorded*: a
 * `file_output`, a `dex-state file`, a screenshot. It never opens a path the
 * renderer merely asks for, and never runs a program: an executable is only
 * shown in its folder.
 */
import path from 'node:path';
import type { HlEvent } from '../../shared/session-schemas';

/** Windows would run these rather than open them. */
const RUNNABLE = new Set([
  'exe', 'com', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'ws', 'msi', 'msp', 'mst',
  'scr', 'pif', 'lnk', 'url', 'hta', 'cpl', 'msc', 'jar', 'reg', 'inf', 'sct', 'application', 'appref-ms',
  'gadget', 'dll', 'sys', 'appx', 'msix', 'appinstaller', 'settingcontent-ms',
]);

export function isRunnable(filePath: string): boolean {
  return RUNNABLE.has(path.extname(filePath).slice(1).toLowerCase());
}

function key(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function recordedPaths(output: ReadonlyArray<HlEvent>): string[] {
  const out: string[] = [];
  for (const event of output) {
    const e = event as HlEvent & Record<string, unknown>;
    if ((e.type === 'file_output' || e.type === 'screenshot') && typeof e.path === 'string') out.push(e.path);
    if (e.type === 'task_state') {
      const files = (e.state as { files?: Array<{ path?: unknown }> } | undefined)?.files ?? [];
      for (const f of files) if (typeof f.path === 'string') out.push(f.path);
    }
  }
  return out;
}

/**
 * The absolute path of `requested` if this task recorded it, else null.
 * Relative paths (`outputs/<session>/<file>`) are the harness folder's.
 */
export function resolveRecordedFile(requested: string, output: ReadonlyArray<HlEvent>, harnessDir: string): string | null {
  if (!requested || requested.includes('\0')) return null;
  const abs = (p: string) => (path.isAbsolute(p) ? path.resolve(p) : path.resolve(harnessDir, p));
  const wanted = key(abs(requested));
  for (const p of recordedPaths(output)) {
    if (key(abs(p)) === wanted) return abs(requested);
  }
  return null;
}
