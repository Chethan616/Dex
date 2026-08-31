import * as fs from 'fs';
import * as path from 'path';

/**
 * Tee the core's console output into `%LOCALAPPDATA%\DEX\core.log`.
 *
 * The core has never written its own log. It did not need to: `run-dev.ps1`
 * started it with `-RedirectStandardOutput`, so the shell captured everything.
 *
 * Now the application starts it, with CREATE_NO_WINDOW and no redirection, and
 * that arrangement quietly stopped working — output goes to a console nobody
 * can see and nothing keeps it. The core became the one process in Dex with no
 * diagnostics at all, in the release where it also became the one nobody
 * launches from a terminal.
 *
 * So it logs for itself now, the way the daemon and the agents already do. The
 * Logs screen reads these files, and the splash reads the last ERROR line out
 * of one when a process fails to start.
 *
 * ANSI colour is stripped on the way in. The core paints its output for a
 * terminal, and a file full of `\x1b[36m` is harder to read than plain text —
 * particularly in a text view inside the app, which is where these are read.
 */

/** Matches SGR escape sequences — the only kind the core emits. */
const ANSI = /\x1b\[[0-9;]*m/g;

/** Past this, the file is started again. Days of daemon chatter get large. */
const MAX_BYTES = 5 * 1024 * 1024;

let stream: fs.WriteStream | undefined;

export function logDirectory(): string {
  const base =
    process.env.LOCALAPPDATA ??
    path.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', 'AppData', 'Local');
  return path.join(base, 'DEX');
}

/**
 * Start mirroring console output to `<name>.log`.
 *
 * Returns the path, or null if the file could not be opened — in which case
 * the console still works and nothing else changes. A logger that throws on
 * startup would take the whole core down over a permissions problem in a
 * directory that only exists to help diagnose problems.
 */
export function mirrorConsoleToFile(name = 'core'): string | null {
  if (stream) return stream.path.toString();

  try {
    const dir = logDirectory();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.log`);

    // Rotated by truncation rather than by keeping numbered copies. What is
    // wanted here is the last few minutes before something broke; a week of
    // history has never once been the thing that answered the question.
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) {
      fs.renameSync(file, `${file}.1`);
    }

    stream = fs.createWriteStream(file, { flags: 'a' });
    stream.on('error', () => {
      // Disk full, file locked. Keep the console; stop trying to write.
      stream = undefined;
    });

    tee('log', 'INFO');
    tee('warn', 'WARN');
    tee('error', 'ERROR');

    write('INFO', `--- core started, pid ${process.pid} ---`);
    return file;
  } catch {
    return null;
  }
}

/** Flush and close. Best-effort — an exiting process is not worth blocking. */
export function closeLogFile(): void {
  stream?.end();
  stream = undefined;
}

type ConsoleMethod = 'log' | 'warn' | 'error';

function tee(method: ConsoleMethod, level: string): void {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]): void => {
    original(...args);
    write(level, args.map(render).join(' '));
  };
}

function write(level: string, message: string): void {
  if (!stream) return;
  const clean = message.replace(ANSI, '');
  // The same shape the Python side writes, so the Logs screen does not need to
  // know which process a line came from to lay it out.
  stream.write(`${timestamp()} [${level}] core - ${clean}\n`);
}

function render(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function timestamp(): string {
  const now = new Date();
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())},` +
    `${pad(now.getMilliseconds(), 3)}`
  );
}
