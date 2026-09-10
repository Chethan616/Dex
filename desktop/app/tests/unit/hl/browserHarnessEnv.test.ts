import { existsSync } from 'node:fs';
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
