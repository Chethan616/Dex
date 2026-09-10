/**
 * Environment preflight.
 *
 * DEX drives the browser and the desktop through small CLIs, and those CLIs
 * need things this app does not ship: Git for Windows (for bash.exe, which
 * every .cmd shim delegates to) and Bun (which runs the browser harness REPL).
 * On the machine this was built on, both existed but in places nothing looked
 * — Git on D:, set through a user environment variable that the already-running
 * app had never inherited.
 *
 * The failure mode that cost the most time was not the missing dependency. It
 * was that nothing said so: the harness quietly fell back to a degraded path
 * and the only symptom was an agent that did less than it should. So this
 * module does two things, in order of importance:
 *
 *   1. Looks much harder than a PATH lookup does — the Windows registry,
 *      winget/scoop/chocolatey layouts, GitHub Desktop's bundled git, and
 *      every fixed drive — so a working install is found wherever it lives.
 *   2. Reports what it found, with a fix, so a missing dependency is a
 *      sentence the user can act on instead of a silent capability gap.
 *
 * Runs at startup and on demand from Settings. Never installs anything on its
 * own: installing software is the user's call, so a fix is offered, not taken.
 */
import { execFileSync } from 'node:child_process';
// Named imports, not a default `fs` namespace: tests mock the named export,
// and a default import silently resolves to the real one — which made the
// suite probe this machine's actual disk instead of the fixture.
import { accessSync, constants, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

export type CheckStatus = 'ok' | 'degraded' | 'missing';

export interface PreflightFix {
  /** One sentence, plain language: what is wrong and what fixes it. */
  summary: string;
  /** A command the user can copy and run. */
  command?: string;
  url?: string;
}

export interface PreflightCheck {
  id: 'git-bash' | 'bun' | 'cdp-port' | 'harness-dir';
  label: string;
  status: CheckStatus;
  /** What was actually found — a path, a port, a reason. */
  detail: string;
  resolvedPath?: string;
  fix?: PreflightFix;
}

export interface PreflightReport {
  checks: PreflightCheck[];
  /** False when anything is missing — i.e. a capability is unavailable. */
  ok: boolean;
  platform: NodeJS.Platform;
  generatedAt: number;
}

function fileExists(candidate: string | undefined | null): candidate is string {
  if (!candidate) return false;
  try {
    return existsSync(candidate);
  } catch {
    return false;
  }
}

const registryCache = new Map<string, string | undefined>();

/**
 * Forget what discovery found last time.
 *
 * The cache is right for the spawn path — install paths do not move while the
 * app runs — but wrong for an explicit re-check: the entire point of the
 * Re-check button is that the user just installed the thing that was missing,
 * and a remembered "not found" would tell them it still is.
 */
export function resetDiscoveryCaches(): void {
  registryCache.clear();
}

/**
 * Read a value out of the Windows registry.
 *
 * This is the check that finds a Git install nothing else does. Git for
 * Windows records its real install path here whatever drive it went onto, so
 * a `D:\Git` install — invisible to a %ProgramFiles% scan and invisible to
 * PATH if the shell predates the install — is still found.
 */
function readRegistryValue(keyPath: string, valueName: string): string | undefined {
  if (process.platform !== 'win32') return undefined;
  // Registry install paths cannot change while the app is running, and this
  // sits on the path of every engine spawn, so read each key at most once.
  const cacheKey = `${keyPath}|${valueName}`;
  if (registryCache.has(cacheKey)) return registryCache.get(cacheKey);
  try {
    const out = execFileSync('reg', ['query', keyPath, '/v', valueName], {
      encoding: 'utf-8',
      timeout: 4000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // Output looks like: "    InstallPath    REG_SZ    D:\Git"
    const match = out.match(new RegExp(`${valueName}\\s+REG_[A-Z_]+\\s+(.+)`));
    const value = match?.[1]?.trim() || undefined;
    registryCache.set(cacheKey, value);
    return value;
  } catch {
    registryCache.set(cacheKey, undefined);
    return undefined;
  }
}

/** Fixed drive letters that actually exist, so we never stat a phantom E:. */
function fixedDrives(): string[] {
  if (process.platform !== 'win32') return [];
  const drives: string[] = [];
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${letter}:\\`;
    try {
      if (existsSync(root)) drives.push(letter);
    } catch {
      // An unreadable drive is simply not a candidate.
    }
  }
  return drives;
}

/**
 * Every place a bash.exe plausibly lives, cheapest and most authoritative
 * first. Order matters: an explicit override beats discovery, and the
 * registry beats guessing at directory layouts.
 */
export function gitBashCandidates(env: NodeJS.ProcessEnv): string[] {
  const candidates: Array<string | undefined> = [
    env.DEX_BASH,
    env.BROWSER_HARNESS_JS_BASH,
  ];

  // The registry records the true install path on any drive.
  for (const key of [
    'HKLM\\SOFTWARE\\GitForWindows',
    'HKLM\\SOFTWARE\\WOW6432Node\\GitForWindows',
    'HKCU\\SOFTWARE\\GitForWindows',
  ]) {
    const installPath = readRegistryValue(key, 'InstallPath');
    if (installPath) candidates.push(path.join(installPath, 'bin', 'bash.exe'));
  }

  // Standard installers.
  const roots = [
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.LocalAppData && path.join(env.LocalAppData, 'Programs'),
  ].filter((root): root is string => typeof root === 'string' && root.length > 0);
  for (const root of roots) candidates.push(path.join(root, 'Git', 'bin', 'bash.exe'));

  // Package managers, each with its own layout.
  if (env.USERPROFILE) {
    candidates.push(path.join(env.USERPROFILE, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'));
  }
  if (env.ProgramData) {
    candidates.push(path.join(env.ProgramData, 'chocolatey', 'lib', 'git', 'tools', 'bin', 'bash.exe'));
  }

  // GitHub Desktop ships its own git, versioned by app folder.
  if (env.LocalAppData) {
    const desktopRoot = path.join(env.LocalAppData, 'GitHubDesktop');
    try {
      for (const entry of readdirSync(desktopRoot)) {
        if (entry.startsWith('app-')) {
          candidates.push(path.join(desktopRoot, entry, 'resources', 'app', 'git', 'bin', 'bash.exe'));
        }
      }
    } catch {
      // GitHub Desktop is simply not installed.
    }
  }

  // Derive from wherever git itself is on PATH: git.exe sits in <root>\cmd or
  // <root>\bin, and bash.exe is in <root>\bin.
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    try {
      if (!existsSync(path.join(dir, 'git.exe'))) continue;
    } catch {
      continue;
    }
    candidates.push(path.join(path.dirname(dir), 'bin', 'bash.exe'));
    candidates.push(path.join(dir, 'bash.exe'));
  }

  // Last resort: a plain install at the root of any drive. This is what finds
  // a hand-unzipped D:\Git that never touched the registry or PATH.
  for (const drive of fixedDrives()) {
    candidates.push(`${drive}:\\Git\\bin\\bash.exe`);
    candidates.push(`${drive}:\\Program Files\\Git\\bin\\bash.exe`);
  }

  return candidates.filter((c): c is string => typeof c === 'string' && c.length > 0);
}

export function findGitBash(env: NodeJS.ProcessEnv): string | undefined {
  return gitBashCandidates(env).find(fileExists);
}

export function bunCandidates(env: NodeJS.ProcessEnv): string[] {
  const exe = process.platform === 'win32' ? 'bun.exe' : 'bun';
  const candidates: Array<string | undefined> = [];

  if (env.BUN_INSTALL) candidates.push(path.join(env.BUN_INSTALL, 'bin', exe));
  if (env.USERPROFILE) {
    candidates.push(path.join(env.USERPROFILE, '.bun', 'bin', exe));
    candidates.push(path.join(env.USERPROFILE, 'scoop', 'shims', exe));
  }
  if (env.HOME) candidates.push(path.join(env.HOME, '.bun', 'bin', exe));
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, exe));
  }

  return candidates.filter((c): c is string => typeof c === 'string' && c.length > 0);
}

export function findBun(env: NodeJS.ProcessEnv): string | undefined {
  return bunCandidates(env).find(fileExists);
}

function checkGitBash(env: NodeJS.ProcessEnv): PreflightCheck {
  const base = { id: 'git-bash' as const, label: 'Git for Windows (bash)' };

  if (process.platform !== 'win32') {
    return { ...base, label: 'bash', status: 'ok', detail: 'Not needed on this platform.' };
  }

  const found = findGitBash(env);
  if (found) {
    return { ...base, status: 'ok', detail: found, resolvedPath: found };
  }

  return {
    ...base,
    status: 'missing',
    detail: 'No bash.exe found. Browser control and the dex-* tools cannot run without it.',
    fix: {
      summary:
        'Install Git for Windows, then restart DEX. If Git is already installed somewhere unusual, ' +
        'set DEX_BASH to the full path of its bash.exe instead.',
      command: 'winget install --id Git.Git -e --source winget',
      url: 'https://gitforwindows.org/',
    },
  };
}

function checkBun(env: NodeJS.ProcessEnv): PreflightCheck {
  const base = { id: 'bun' as const, label: 'Bun' };
  const found = findBun(env);
  if (found) return { ...base, status: 'ok', detail: found, resolvedPath: found };

  // Degraded, not missing: the harness installs Bun on first use. That works,
  // but it needs network access and it happens mid-task, so it is worth
  // saying out loud rather than discovering during a run.
  return {
    ...base,
    status: 'degraded',
    detail: 'Not installed. The browser harness will download it the first time it runs, which needs network access.',
    fix: {
      summary: 'Install Bun ahead of time to avoid a slow first browser task.',
      command: 'powershell -c "irm bun.sh/install.ps1 | iex"',
      url: 'https://bun.sh/',
    },
  };
}

function checkCdpPort(port: number | null, verified: boolean | null): PreflightCheck {
  const base = { id: 'cdp-port' as const, label: 'Browser debugging port' };
  if (port == null) {
    return { ...base, status: 'degraded', detail: 'Not assigned yet.' };
  }
  if (verified === false) {
    return {
      ...base,
      status: 'degraded',
      detail: `Port ${port} is answering, but another Chromium owns it. DEX may be driving the wrong browser.`,
      fix: { summary: 'Close other Chrome/Edge instances started with --remote-debugging-port, then restart DEX.' },
    };
  }
  // The port walk means a collision is normal and already handled; saying so
  // stops a non-default port from looking like a fault.
  return {
    ...base,
    status: 'ok',
    detail: port === 9222 ? `Port ${port}.` : `Port ${port} (9222 was taken; DEX moved up automatically).`,
  };
}

function checkHarnessDir(harnessPath: string): PreflightCheck {
  const base = { id: 'harness-dir' as const, label: 'Harness directory' };
  try {
    accessSync(harnessPath, constants.W_OK);
    return { ...base, status: 'ok', detail: harnessPath, resolvedPath: harnessPath };
  } catch {
    return {
      ...base,
      status: 'missing',
      detail: `Cannot write to ${harnessPath}. The agent's tools and skills cannot be installed.`,
      fix: { summary: 'Check the folder permissions, or whether antivirus or a sync client is locking it.' },
    };
  }
}

export function runPreflight(opts: {
  env: NodeJS.ProcessEnv;
  harnessPath: string;
  cdpPort: number | null;
  cdpVerified: boolean | null;
}): PreflightReport {
  // An explicit run is always a fresh look at the machine.
  resetDiscoveryCaches();
  const checks = [
    checkGitBash(opts.env),
    checkBun(opts.env),
    checkCdpPort(opts.cdpPort, opts.cdpVerified),
    checkHarnessDir(opts.harnessPath),
  ];
  return {
    checks,
    ok: checks.every((check) => check.status !== 'missing'),
    platform: process.platform,
    generatedAt: Date.now(),
  };
}

/** One line per check, for the log. Loud on purpose — see the file header. */
export function formatPreflightForLog(report: PreflightReport): string[] {
  return report.checks.map((check) => {
    const mark = check.status === 'ok' ? 'ok  ' : check.status === 'degraded' ? 'warn' : 'FAIL';
    return `[${mark}] ${check.label}: ${check.detail}`;
  });
}
