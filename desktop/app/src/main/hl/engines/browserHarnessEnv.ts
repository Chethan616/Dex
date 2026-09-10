import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { SpawnContext } from './types';

export function browserHarnessReplPort(sessionId: string, targetId = ''): string {
  const n = createHash('sha256').update(`${sessionId}:${targetId}`).digest().readUInt16BE(0);
  return String(18_000 + (n % 20_000));
}

/**
 * Find Git for Windows' bash.exe, which browser-harness-js.cmd needs to run
 * the POSIX launcher script.
 *
 * The .cmd does its own discovery, but only across %ProgramFiles%,
 * %ProgramFiles(x86)% and %LocalAppData%\Programs — so a Git installed
 * anywhere else (a second drive, a custom prefix) is invisible to it, and it
 * falls back to BROWSER_HARNESS_JS_BASH from the ambient environment.
 *
 * Relying on that ambient variable is what breaks in practice. Setting it at
 * User scope only reaches processes created *afterwards*, so an Electron app
 * already running — or launched from a shell that predates the change — never
 * sees it, and the harness silently degrades to the raw-CDP PowerShell path.
 * Observed directly on a machine where the variable was correctly set in the
 * registry and still absent from every running process.
 *
 * So resolve it here and pass it explicitly into the child env: deterministic,
 * and independent of when the variable was set or whether Electron sanitised
 * the environment it inherited.
 *
 * Order: an existing explicit override wins; then the standard install
 * locations; then derive it from wherever `git` actually lives on PATH, which
 * is what covers non-default drives.
 */
export function resolveGitBash(env: NodeJS.ProcessEnv): string | undefined {
  const override = env.BROWSER_HARNESS_JS_BASH;
  if (override && existsSync(override)) return override;

  const standard = [
    env.ProgramFiles && path.join(env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    env.LocalAppData && path.join(env.LocalAppData, 'Programs', 'Git', 'bin', 'bash.exe'),
  ].filter((p): p is string => typeof p === 'string');

  for (const candidate of standard) {
    if (existsSync(candidate)) return candidate;
  }

  // Derive from git on PATH. Git for Windows ships git.exe in <root>\cmd and
  // <root>\bin, with bash.exe in <root>\bin — so walk up from whichever
  // directory git was found in and look there.
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    if (!existsSync(path.join(dir, 'git.exe'))) continue;
    const candidate = path.join(path.dirname(dir), 'bin', 'bash.exe');
    if (existsSync(candidate)) return candidate;
  }

  return undefined;
}

export function applyBrowserHarnessEnv(ctx: SpawnContext, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sdkDir = path.join(ctx.harnessDir, 'browser-harness-js', 'sdk');
  env.PATH = env.PATH ? `${sdkDir}${path.delimiter}${env.PATH}` : sdkDir;
  env.CDP_REPL_PORT = env.CDP_REPL_PORT ?? browserHarnessReplPort(ctx.sessionId, ctx.targetId);
  env.CDP_REPL_LOG = env.CDP_REPL_LOG ?? path.join(ctx.harnessDir, `browser-harness-js-${ctx.sessionId}.log`);
  env.BU_SESSION_ID = ctx.sessionId;

  if (process.platform === 'win32') {
    const bash = resolveGitBash(env);
    if (bash) {
      env.BROWSER_HARNESS_JS_BASH = bash;
    } else {
      // Loud on purpose. Without bash the .cmd exits 1, the harness never
      // starts, and the agent quietly drives Chrome through raw CDP instead —
      // working, but at reduced capability, with nothing in the log saying so.
      console.error(
        '[browser-harness] Git for Windows bash.exe not found — browser-harness-js cannot start, ' +
          'so the agent will fall back to the degraded raw-CDP path. ' +
          'Install Git for Windows (https://gitforwindows.org/) or set BROWSER_HARNESS_JS_BASH to a bash.exe path.',
      );
    }
  }

  return env;
}
