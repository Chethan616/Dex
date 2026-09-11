import { existsSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  applyBrowserHarnessEnv,
  browserHarnessReplPort,
  resolveGitBash,
} from '../../../src/main/hl/engines/browserHarnessEnv';
import type { SpawnContext } from '../../../src/main/hl/engines/types';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

/** Only the paths listed exist; everything else is absent. */
function onlyTheseExist(paths: string[]): void {
  vi.mocked(existsSync).mockImplementation((p) => paths.includes(String(p)));
}

function spawnContext(targetId: string): SpawnContext {
  return {
    prompt: 'Open example.com',
    harnessDir: '/tmp/harness',
    sessionId: 'session-123',
    targetId,
    cdpPort: 9222,
    attachmentRefs: [],
  };
}

describe('browser harness environment', () => {
  it('scopes the REPL port to the assigned target as well as the app session', () => {
    const firstTarget = browserHarnessReplPort('session-123', 'target-a');
    const secondTarget = browserHarnessReplPort('session-123', 'target-b');

    expect(browserHarnessReplPort('session-123', 'target-a')).toBe(firstTarget);
    expect(secondTarget).not.toBe(firstTarget);
  });

  it('gives reruns with a replacement browser target a fresh REPL port', () => {
    const firstEnv = applyBrowserHarnessEnv(spawnContext('old-target'), {});
    const rerunEnv = applyBrowserHarnessEnv(spawnContext('new-target'), {});

    expect(firstEnv.CDP_REPL_PORT).toBe(browserHarnessReplPort('session-123', 'old-target'));
    expect(rerunEnv.CDP_REPL_PORT).toBe(browserHarnessReplPort('session-123', 'new-target'));
    expect(rerunEnv.CDP_REPL_PORT).not.toBe(firstEnv.CDP_REPL_PORT);
  });

  it('preserves an explicit REPL port override', () => {
    const env = applyBrowserHarnessEnv(spawnContext('target-a'), { CDP_REPL_PORT: '9876' });

    expect(env.CDP_REPL_PORT).toBe('9876');
  });
});

/**
 * browser-harness-js.cmd only searches %ProgramFiles%, %ProgramFiles(x86)% and
 * %LocalAppData%\Programs, otherwise falling back to BROWSER_HARNESS_JS_BASH
 * from the ambient environment. That ambient variable is unreliable: setting it
 * at User scope only reaches processes started afterwards, so a running Electron
 * app never sees it and the harness silently degrades to raw CDP. These cover
 * resolving it explicitly instead.
 */
/**
 * Windows stores PATH as `Path` when the app is launched from Explorer, and as
 * `PATH` from a POSIX-style shell. A plain object copy of process.env keeps
 * whichever casing it was given, so writing to the other one silently adds a
 * second variable instead of extending the first.
 *
 * That is not theoretical: it shipped. The child received `Path` (the full
 * system path) alongside `PATH` (only the harness directories), the
 * harness-only one won, and every npx-launched MCP server failed to start
 * while browser-harness-js kept working because it lives in that directory.
 * The agent then quietly drove websites instead of calling APIs.
 */
describe('applyBrowserHarnessEnv PATH handling', () => {
  const ctx = spawnContext('target-1');
  // Built rather than written literally: a backslash-laden string is easy to
  // get wrong in a way that still passes, because both the fixture and the
  // assertion degrade together.
  const SYSTEM32 = nodePath.join('C:', 'Windows', 'system32');
  const NODEJS = nodePath.join('C:', 'Program Files', 'nodejs');

  const pathKeys = (env: NodeJS.ProcessEnv): string[] =>
    Object.keys(env).filter((key) => key.toLowerCase() === 'path');

  it('extends an existing Path (Windows casing) rather than adding a second PATH', () => {
    const env = applyBrowserHarnessEnv(ctx, { Path: [SYSTEM32, NODEJS].join(nodePath.delimiter) });

    expect(pathKeys(env)).toEqual(['Path']);
    // The system entries must survive: npx lives there, and every MCP server
    // is launched through it.
    expect(env.Path).toContain(NODEJS);
    expect(env.Path).toContain('dex-tools');
  });

  it('extends an existing PATH when that is the casing in use', () => {
    const env = applyBrowserHarnessEnv(ctx, { PATH: ['/usr/bin', '/bin'].join(nodePath.delimiter) });

    expect(pathKeys(env)).toEqual(['PATH']);
    expect(env.PATH).toContain('/usr/bin');
    expect(env.PATH).toContain('dex-tools');
  });

  it('puts the harness directories first so its own tools win', () => {
    const env = applyBrowserHarnessEnv(ctx, { Path: SYSTEM32 });
    const value = env.Path ?? '';

    expect(value.indexOf('browser-harness-js')).toBeGreaterThanOrEqual(0);
    expect(value.indexOf('browser-harness-js')).toBeLessThan(value.indexOf(SYSTEM32));
  });

  it('still works when the environment has no path at all', () => {
    const env = applyBrowserHarnessEnv(ctx, {});
    const keys = pathKeys(env);

    expect(keys).toHaveLength(1);
    expect(env[keys[0]]).toContain('dex-tools');
  });
});

describe('resolveGitBash', () => {
  const D_DRIVE_GIT = 'D:\\Git\\bin\\bash.exe';
  const PROGRAM_FILES_GIT = 'C:\\Program Files\\Git\\bin\\bash.exe';

  it('honours an explicit override when the file is really there', () => {
    onlyTheseExist([D_DRIVE_GIT]);

    expect(resolveGitBash({ BROWSER_HARNESS_JS_BASH: D_DRIVE_GIT })).toBe(D_DRIVE_GIT);
  });

  it('ignores an override pointing at a file that does not exist', () => {
    onlyTheseExist([PROGRAM_FILES_GIT]);

    const found = resolveGitBash({
      BROWSER_HARNESS_JS_BASH: 'C:\\nope\\bash.exe',
      ProgramFiles: 'C:\\Program Files',
    });

    expect(found).toBe(PROGRAM_FILES_GIT);
  });

  it('finds a standard install with no override set', () => {
    onlyTheseExist([PROGRAM_FILES_GIT]);

    expect(resolveGitBash({ ProgramFiles: 'C:\\Program Files' })).toBe(PROGRAM_FILES_GIT);
  });

  it('derives bash from git on PATH when Git lives off the standard drives', () => {
    // The real-world failing case: Git installed at D:\Git, so none of the
    // .cmd's three hardcoded locations match and no override is present.
    onlyTheseExist(['D:\\Git\\cmd\\git.exe', D_DRIVE_GIT]);

    const found = resolveGitBash({
      ProgramFiles: 'C:\\Program Files',
      PATH: ['C:\\Windows\\system32', 'D:\\Git\\cmd'].join(';'),
    });

    expect(found).toBe(D_DRIVE_GIT);
  });

  it('returns undefined when Git really is absent, rather than a bogus path', () => {
    onlyTheseExist([]);

    expect(resolveGitBash({ ProgramFiles: 'C:\\Program Files', PATH: 'C:\\Windows\\system32' })).toBeUndefined();
  });
});
