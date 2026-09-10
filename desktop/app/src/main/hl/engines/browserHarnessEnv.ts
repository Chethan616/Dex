import { createHash } from 'node:crypto';
import path from 'node:path';
import { findGitBash } from '../../startup/preflight';
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
 * The search itself lives in startup/preflight.ts, which also reports what it
 * found to the user. Keeping one implementation matters: a machine where the
 * agent cannot start bash but Settings claims everything is fine would be a
 * worse outcome than either failure alone.
 */
export function resolveGitBash(env: NodeJS.ProcessEnv): string | undefined {
  return findGitBash(env);
}

export function applyBrowserHarnessEnv(ctx: SpawnContext, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sdkDir = path.join(ctx.harnessDir, 'browser-harness-js', 'sdk');
  const dexToolsDir = path.join(ctx.harnessDir, 'dex-tools');
  const toolDirs = [sdkDir, dexToolsDir].join(path.delimiter);
  env.PATH = env.PATH ? `${toolDirs}${path.delimiter}${env.PATH}` : toolDirs;
  env.CDP_REPL_PORT = env.CDP_REPL_PORT ?? browserHarnessReplPort(ctx.sessionId, ctx.targetId);
  env.CDP_REPL_LOG = env.CDP_REPL_LOG ?? path.join(ctx.harnessDir, `browser-harness-js-${ctx.sessionId}.log`);
  env.BU_SESSION_ID = ctx.sessionId;
  // The dex-* tools address the app over its loopback control server. Passing
  // the control file explicitly beats letting each tool guess a path relative
  // to its cwd, which only happens to work while cwd is the harness dir.
  env.DEX_SESSION_ID = ctx.sessionId;
  env.DEX_CONTROL_FILE = path.join(path.dirname(ctx.harnessDir), 'local-task-server.json');

  if (process.platform === 'win32') {
    const bash = resolveGitBash(env);
    if (bash) {
      env.BROWSER_HARNESS_JS_BASH = bash;
      // Same interpreter, its own name: the dex-* shims should not have to
      // know they are borrowing the browser harness's variable.
      env.DEX_BASH = bash;
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
