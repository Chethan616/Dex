import * as fs from 'fs';
import * as path from 'path';

/**
 * Find a program on PATH the way the shell would.
 *
 * Needed because of one detail that is easy to miss and produces a completely
 * misleading symptom: npm's global "binaries" on Windows are not executables.
 * `claude` is a shell shim; what actually exists on disk is `claude.cmd`.
 * `execFile('claude', …)` therefore fails with ENOENT — and ENOENT reads as
 * "not installed", so Settings reported Claude Code as missing on a machine
 * where it was installed, signed in, and working.
 *
 * The usual fix is `shell: true`, which works and is worse: it concatenates
 * arguments into a command line instead of passing them as an array, so
 * anything with a space or a quote in it becomes a shell-injection question.
 * Node deprecated the combination for exactly that reason. Resolving the real
 * path here means every caller can keep passing a proper argument array.
 *
 * `where.exe` is not used, for the reason most things in Dex avoid shelling
 * out: it is a console program, and one more console is one more window.
 */
export function which(command: string): string | null {
  if (command.includes(path.sep) || command.includes('/')) {
    return fs.existsSync(command) ? command : null;
  }

  const pathValue = process.env.PATH ?? process.env.Path ?? '';
  const separator = process.platform === 'win32' ? ';' : ':';

  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .filter(Boolean)
          .map((e) => e.toLowerCase())
      : [''];

  for (const dir of pathValue.split(separator)) {
    if (!dir) continue;
    const base = path.join(dir, command);

    // An explicit extension, or a POSIX executable with none.
    if (path.extname(command) !== '' && fs.existsSync(base)) return base;

    for (const extension of extensions) {
      const candidate = base + extension;
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export interface CommandInvocation {
  file: string;
  args: string[];
}

/**
 * Resolve a command and turn Windows shell shims into a real executable call.
 *
 * npm installs CLIs as `.cmd` files on Windows. Node can find those files on
 * PATH, but it cannot execute one with `execFile`/`spawn` directly. Calling
 * cmd.exe with the resolved path keeps argument boundaries intact and avoids
 * relying on the caller's interactive shell or a user-specific install path.
 */
export function resolveCommand(command: string, args: string[] = []): CommandInvocation | null {
  const resolved = which(command);
  if (!resolved) return null;

  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    return {
      file: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/c', resolved, ...args],
    };
  }

  return { file: resolved, args };
}
