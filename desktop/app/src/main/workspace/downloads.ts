/**
 * Downloads from a task's tabs (docs/unify/PLAN.md §3.4 guards).
 *
 * Without this, a download in a workspace tab opens Electron's Save dialog —
 * a native window in front of you, and one the agent can't answer. Instead
 * every download goes straight to your Downloads folder, like Chrome, and
 * shows in the task as a file card once it's done.
 *
 * Who started it decides whether DEX asks first. A download right after
 * your own click or key in that tab is yours and goes through. One that
 * starts while the task is running and you weren't touching the page is the
 * agent's (or the page's), and waits on the task's approval policy — the
 * same cards and "allow for this task" as shell commands. A refused one is
 * cancelled; nothing is left on disk.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface DownloadItemLike {
  getFilename(): string;
  getURL(): string;
  setSavePath(savePath: string): void;
  getSavePath(): string;
  pause(): void;
  resume(): void;
  cancel(): void;
  once(event: 'done', listener: (event: unknown, state: 'completed' | 'cancelled' | 'interrupted') => void): unknown;
}

export interface DownloadGuardDeps {
  /** The task whose tab this is, or null for DEX's own windows (left alone). */
  sessionIdOf(wc: object): string | null;
  isRunning(sessionId: string): boolean;
  /** You clicked or typed in this tab just now (userActivity). */
  userStarted(wc: object): boolean;
  /** Resolves true to let the download through (approval policy, maybe a card). */
  approve(sessionId: string, title: string, detail: string, fileName: string): Promise<boolean>;
  folder(): string;
  /** A finished download, to show as the task's file. */
  finished(sessionId: string, filePath: string, name: string): void;
  log?(event: string, data: Record<string, unknown>): void;
}

/** Downloads in flight, so two with one name don't both pick `name (1)`. */
const reserved = new Set<string>();

/** A file name Windows accepts, from whatever the site suggested. */
export function safeFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '')
    // Windows' reserved characters, and control characters.
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  const stem = base.replace(/\.[^.]*$/, '');
  if (!base || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(stem)) return `download${base ? `-${base}` : ''}`;
  return base.slice(0, 200);
}

/** `dir/name`, or `dir/name (1).ext`, … — the first that's free. */
export function uniquePath(dir: string, name: string, exists: (p: string) => boolean = fs.existsSync): string {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  const taken = (p: string) => exists(p) || exists(`${p}.crdownload`) || reserved.has(p.toLowerCase());
  let candidate = path.join(dir, name);
  for (let n = 1; taken(candidate) && n < 1000; n++) candidate = path.join(dir, `${stem} (${n})${ext}`);
  return candidate;
}

function hostOf(url: string): string {
  try { return new URL(url).host || url; } catch { return url; }
}

/**
 * Feed `session.on('will-download')` through this. Returns false when the
 * download isn't from a task's tab, leaving Electron's default behaviour.
 */
export function handleDownload(item: DownloadItemLike, wc: object | null | undefined, deps: DownloadGuardDeps): boolean {
  const sessionId = wc ? deps.sessionIdOf(wc) : null;
  if (!sessionId) return false;

  const name = safeFileName(item.getFilename());
  const target = uniquePath(deps.folder(), name);
  const key = target.toLowerCase();
  reserved.add(key);
  // Setting the path now is what keeps the Save dialog away.
  item.setSavePath(target);

  const byAgent = deps.isRunning(sessionId) && !(wc && deps.userStarted(wc));
  deps.log?.('workspace.download.start', { sessionId, name, host: hostOf(item.getURL()), byAgent });

  item.once('done', (_e, state) => {
    reserved.delete(key);
    deps.log?.('workspace.download.done', { sessionId, name, state });
    if (state === 'completed') deps.finished(sessionId, item.getSavePath() || target, path.basename(item.getSavePath() || target));
  });

  if (byAgent) {
    item.pause();
    deps
      .approve(sessionId, 'Download a file', `${name} from ${hostOf(item.getURL())}`, name)
      .then((ok) => (ok ? item.resume() : item.cancel()))
      .catch(() => item.cancel());
  }
  return true;
}
