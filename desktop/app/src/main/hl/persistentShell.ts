// dex-sh session mode — a real, long-lived shell process (PTY, via the
// node-pty dependency already vendored for Codex's device-login flow) that
// keeps cwd/env/venv state across calls, matching Codex's unified_exec and
// the OpenAI CUA sample app's persistent Python REPL. The existing one-shot
// `dex-sh <shell> "<command>"` form (a fresh process every call, no state
// surviving between commands) is untouched — this is strictly additive, for
// tasks that need multi-step shell state ("cd into a repo once, then run
// several commands against it").
import { randomUUID } from 'node:crypto';
import * as pty from 'node-pty';
import { findGitBash } from '../startup/preflight';
import { mainLogger } from '../logger';

export type PersistentShellKind = 'bash' | 'cmd' | 'powershell' | 'wsl';

/** The subset of node-pty's IPty this module actually uses — narrowed so tests can inject a fake without depending on the native module. */
export interface PtyLike {
  pid: number;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  kill(): void;
}

export type PtySpawn = (command: string, args: string[], options: pty.IPtyForkOptions) => PtyLike;

const defaultSpawn: PtySpawn = (command, args, options) => pty.spawn(command, args, options) as unknown as PtyLike;

export interface ShellSpawnSpec {
  command: string;
  args: string[];
}

/** Which binary launches each shell in *interactive* (stays-alive) mode — distinct from the one-shot form's `-c`/`/c` single-command invocation. */
export function spawnSpecFor(kind: PersistentShellKind, env: NodeJS.ProcessEnv = process.env): ShellSpawnSpec {
  switch (kind) {
    case 'bash':
      return { command: findGitBash(env) ?? 'bash', args: ['--noprofile', '--norc', '-i'] };
    case 'cmd':
      return { command: 'cmd.exe', args: ['/K'] };
    case 'powershell':
      return { command: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NoExit'] };
    case 'wsl':
      return { command: 'wsl.exe', args: ['bash', '-i'] };
  }
}

const SENTINEL_PREFIX = 'DEX_SH_DONE_';

export function makeSentinel(): string {
  return `${SENTINEL_PREFIX}${randomUUID().replace(/-/g, '')}`;
}

/** The line appended after the user's command, echoing the sentinel plus the shell's own exit-code variable — the only way to know a command finished and what it returned in a plain byte stream with no message framing. */
export function sentinelLine(kind: PersistentShellKind, marker: string): string {
  switch (kind) {
    case 'bash':
    case 'wsl':
      return `\necho ${marker}_$?\n`;
    case 'cmd':
      return `\r\necho ${marker}_%errorlevel%\r\n`;
    case 'powershell':
      return `\r\nWrite-Output "${marker}_$LASTEXITCODE"\r\n`;
  }
}

export interface SentinelMatch {
  before: string;
  exitCode: number | null;
}

/** Looks for `marker` in `buffer`; when found, splits off everything before it (the command's own output) and parses the trailing exit code. */
export function findSentinel(buffer: string, marker: string): SentinelMatch | null {
  const idx = buffer.indexOf(marker);
  if (idx === -1) return null;
  const before = buffer.slice(0, idx);
  const markerLine = buffer.slice(idx).split(/\r?\n/)[0] ?? '';
  const codeMatch = markerLine.match(/_(-?\d+)\s*$/);
  return { before, exitCode: codeMatch ? Number(codeMatch[1]) : null };
}

interface Session {
  id: string;
  kind: PersistentShellKind;
  proc: PtyLike;
  buffer: string;
}

const sessions = new Map<string, Session>();

export function startSession(kind: PersistentShellKind, spawn: PtySpawn = defaultSpawn): string {
  const spec = spawnSpecFor(kind);
  const proc = spawn(spec.command, spec.args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: process.env.USERPROFILE || process.env.HOME || process.cwd(),
    env: process.env as { [key: string]: string },
  });
  const id = randomUUID();
  const session: Session = { id, kind, proc, buffer: '' };
  proc.onData((chunk) => { session.buffer += chunk; });
  proc.onExit(() => { sessions.delete(id); });
  sessions.set(id, session);
  mainLogger.info('persistentShell.start', { id, kind, pid: proc.pid });
  return id;
}

export interface RunResult {
  exitCode: number | null;
  timedOut: boolean;
  output: string;
}

const POLL_INTERVAL_MS = 40;

export function runCommand(id: string, command: string, timeoutMs = 30_000): Promise<RunResult> {
  const session = sessions.get(id);
  if (!session) return Promise.reject(new Error(`no persistent shell session ${id}`));

  return new Promise((resolve) => {
    const marker = makeSentinel();
    session.buffer = ''; // capture only this command's own output
    let settled = false;
    let poll: ReturnType<typeof setInterval>;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      resolve(result);
    };

    poll = setInterval(() => {
      const match = findSentinel(session.buffer, marker);
      if (!match) return;
      finish({ exitCode: match.exitCode, timedOut: false, output: match.before });
    }, POLL_INTERVAL_MS);

    timer = setTimeout(() => {
      finish({ exitCode: null, timedOut: true, output: session.buffer });
    }, timeoutMs);

    session.proc.write(command + sentinelLine(session.kind, marker));
  });
}

export function endSession(id: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  sessions.delete(id);
  try {
    session.proc.kill();
  } catch {
    // already gone
  }
  return true;
}

export function hasSession(id: string): boolean {
  return sessions.has(id);
}
