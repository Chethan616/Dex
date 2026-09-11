/**
 * Environment preflight.
 *
 * The point of this module is that a missing dependency becomes a sentence
 * the user can act on instead of a silent capability gap, so the tests care
 * about two things: that discovery actually reaches the awkward places a real
 * install hides in, and that the status it reports is honest — `degraded` for
 * something that will self-heal, `missing` only for something that genuinely
 * stops DEX working.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, accessSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    accessSync: vi.fn(actual.accessSync),
    readdirSync: vi.fn(() => { throw new Error('ENOENT'); }),
  };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: vi.fn(() => { throw new Error('no registry'); }) };
});

const { findGitBash, findBun, runPreflight, formatPreflightForLog, resetDiscoveryCaches } = await import(
  '../../../src/main/startup/preflight'
);

const D_DRIVE_BASH = 'D:\\Git\\bin\\bash.exe';
const PROGRAM_FILES_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';

/** Only the listed paths exist; everything else is absent. */
function onlyTheseExist(paths: string[]): void {
  vi.mocked(existsSync).mockImplementation((p) => paths.includes(String(p)));
}

beforeEach(() => {
  resetDiscoveryCaches();
  onlyTheseExist([]);
  vi.mocked(execFileSync).mockImplementation(() => { throw new Error('no registry'); });
  vi.mocked(accessSync).mockImplementation(() => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('findGitBash', () => {
  it('honours an explicit override that really exists', () => {
    onlyTheseExist([D_DRIVE_BASH]);
    expect(findGitBash({ DEX_BASH: D_DRIVE_BASH })).toBe(D_DRIVE_BASH);
  });

  it('ignores an override pointing at nothing and keeps looking', () => {
    onlyTheseExist([PROGRAM_FILES_BASH]);
    expect(findGitBash({ DEX_BASH: 'C:\\nope\\bash.exe', ProgramFiles: 'C:\\Program Files' }))
      .toBe(PROGRAM_FILES_BASH);
  });

  // The case that started all of this: Git on a second drive, so no standard
  // location matches and the user env var never reached the running app.
  it('finds an install on another drive through the registry', () => {
    onlyTheseExist([D_DRIVE_BASH]);
    vi.mocked(execFileSync).mockImplementation(() => '    InstallPath    REG_SZ    D:\\Git\r\n');

    expect(findGitBash({ ProgramFiles: 'C:\\Program Files' })).toBe(D_DRIVE_BASH);
  });

  it('reads the registry at most once per key even across repeated lookups', () => {
    onlyTheseExist([D_DRIVE_BASH]);
    vi.mocked(execFileSync).mockImplementation(() => '    InstallPath    REG_SZ    D:\\Git\r\n');

    findGitBash({});
    const afterFirst = vi.mocked(execFileSync).mock.calls.length;
    findGitBash({});

    // Install paths cannot change while the app runs, and this sits on the
    // path of every engine spawn.
    expect(vi.mocked(execFileSync).mock.calls.length).toBe(afterFirst);
  });

  it('derives bash from git on PATH', () => {
    onlyTheseExist(['D:\\Git\\cmd\\git.exe', D_DRIVE_BASH]);
    expect(findGitBash({ PATH: ['C:\\Windows\\system32', 'D:\\Git\\cmd'].join(';') })).toBe(D_DRIVE_BASH);
  });

  it('finds a scoop install', () => {
    const scoop = 'C:\\Users\\me\\scoop\\apps\\git\\current\\bin\\bash.exe';
    onlyTheseExist([scoop]);
    expect(findGitBash({ USERPROFILE: 'C:\\Users\\me' })).toBe(scoop);
  });

  it('returns undefined when Git really is absent rather than a bogus path', () => {
    onlyTheseExist([]);
    expect(findGitBash({ ProgramFiles: 'C:\\Program Files', PATH: 'C:\\Windows\\system32' })).toBeUndefined();
  });
});

describe('findBun', () => {
  it('finds the default per-user install', () => {
    const bun = process.platform === 'win32'
      ? 'C:\\Users\\me\\.bun\\bin\\bun.exe'
      : 'C:\\Users\\me\\.bun\\bin\\bun';
    onlyTheseExist([bun]);
    expect(findBun({ USERPROFILE: 'C:\\Users\\me' })).toBe(bun);
  });

  it('returns undefined when Bun is absent', () => {
    onlyTheseExist([]);
    expect(findBun({})).toBeUndefined();
  });
});

describe('runPreflight', () => {
  const base = { harnessPath: 'C:\\harness', cdpPort: 9222, cdpVerified: true };

  function checkById(env: NodeJS.ProcessEnv, id: string) {
    const report = runPreflight({ ...base, env });
    const check = report.checks.find((c) => c.id === id);
    if (!check) throw new Error(`no check ${id}`);
    return { report, check };
  }

  it('reports missing bash with a fix that names a command', () => {
    onlyTheseExist([]);
    const { report, check } = checkById({}, 'git-bash');

    if (process.platform === 'win32') {
      expect(check.status).toBe('missing');
      expect(check.fix?.command).toContain('winget');
      // A missing dependency means a capability is unavailable.
      expect(report.ok).toBe(false);
    } else {
      expect(check.status).toBe('ok');
    }
  });

  // Bun self-installs on first use, so calling it 'missing' would cry wolf —
  // but it costs a slow first task, so silence would be wrong too.
  it('reports absent Bun as degraded, not missing', () => {
    onlyTheseExist([]);
    const { check } = checkById({}, 'bun');
    expect(check.status).toBe('degraded');
    expect(check.detail).toMatch(/network/i);
  });

  it('does not fail the whole report for a merely degraded check', () => {
    onlyTheseExist([PROGRAM_FILES_BASH]);
    const report = runPreflight({ ...base, env: { ProgramFiles: 'C:\\Program Files' } });
    expect(report.checks.find((c) => c.id === 'bun')?.status).toBe('degraded');
    expect(report.ok).toBe(true);
  });

  // A walked port is normal, not a fault — saying so stops it looking like one.
  it('explains a non-default CDP port instead of flagging it', () => {
    const report = runPreflight({ ...base, env: {}, cdpPort: 9224 });
    const check = report.checks.find((c) => c.id === 'cdp-port');
    expect(check?.status).toBe('ok');
    expect(check?.detail).toContain('9224');
    expect(check?.detail).toMatch(/automatically/);
  });

  it('flags a CDP port owned by a foreign browser', () => {
    const report = runPreflight({ ...base, env: {}, cdpVerified: false });
    const check = report.checks.find((c) => c.id === 'cdp-port');
    expect(check?.status).toBe('degraded');
    expect(check?.fix?.summary).toMatch(/remote-debugging-port/);
  });

  it('reports an unwritable harness directory as missing', () => {
    vi.mocked(accessSync).mockImplementation(() => { throw new Error('EACCES'); });
    const report = runPreflight({ ...base, env: {} });
    const check = report.checks.find((c) => c.id === 'harness-dir');
    expect(check?.status).toBe('missing');
    expect(report.ok).toBe(false);
  });

  // npx absence is invisible otherwise: connections verify, then fail to start
  // inside the agent, and DEX quietly drives a website instead.
  it('reports missing npx as degraded and names what it costs', () => {
    onlyTheseExist([]);
    const { check } = checkById({}, 'node');
    expect(check.status).toBe('degraded');
    expect(check.detail).toMatch(/browser/i);
    expect(check.fix?.command).toContain('NodeJS');
  });

  it('finds npx on PATH', () => {
    const isWin = process.platform === 'win32';
    const dir = isWin ? path.join('C:', 'Program Files', 'nodejs') : '/usr/bin';
    const npx = path.join(dir, isWin ? 'npx.cmd' : 'npx');
    onlyTheseExist([npx]);

    const { check } = checkById({ PATH: dir }, 'node');

    expect(check.status).toBe('ok');
    expect(check.resolvedPath).toBe(npx);
  });

  it('formats one loud line per check for the log', () => {
    onlyTheseExist([]);
    const lines = formatPreflightForLog(runPreflight({ ...base, env: {} }));
    expect(lines).toHaveLength(5);
    expect(lines.some((line) => line.startsWith('[warn]'))).toBe(true);
    if (process.platform === 'win32') {
      expect(lines.some((line) => line.startsWith('[FAIL]'))).toBe(true);
    }
  });
});
