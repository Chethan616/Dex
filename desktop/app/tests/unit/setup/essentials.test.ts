import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const commands: string[] = [];

vi.mock('../../../src/main/logger', () => ({ mainLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../src/main/hl/engines/pathEnrich', () => ({
  enrichedEnv: (env: NodeJS.ProcessEnv) => env,
  resetPathEnrichmentCache: vi.fn(),
}));
// Every installer "fails", so each id walks through all of its attempts.
vi.mock('../../../src/main/hl/engines/installer', () => ({
  runInstallCommand: vi.fn(async (_name: string, command: string) => {
    commands.push(command);
    return { completed: true, exitCode: 1, error: 'installer exited 1' };
  }),
}));
vi.mock('../../../src/main/startup/preflight', () => ({
  findBun: (): undefined => undefined,
  findGitBash: (): undefined => undefined,
  findNpx: (): undefined => undefined,
  resetDiscoveryCaches: vi.fn(),
}));
vi.mock('../../../src/main/startup/blender', () => ({ findBlender: (): null => null, resetBlenderCache: vi.fn() }));
// …and no uv, even on a PC that has it (it's found by looking for uvx on disk).
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, existsSync: (p: import('node:fs').PathLike) => (/uvx(\.exe)?$/i.test(String(p)) ? false : fs.existsSync(p)) };
});
// No winget on this "PC": only the vendors' own installers are left.
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawnSync: vi.fn(() => ({ status: 1, stdout: '', stderr: '' })),
}));

const scriptOf = (command: string): string => {
  const file = /-File "([^"]+)"/.exec(command)?.[1];
  if (!file) throw new Error(`not a script command: ${command}`);
  return readFileSync(file, 'utf-8');
};

describe('essentials installers', () => {
  beforeEach(() => { commands.length = 0; });

  it('finds the latest Git without api.github.com, whose hourly limit runs out behind a shared NAT', async () => {
    const { installEssentials } = await import('../../../src/main/setup/essentials');
    const progress: unknown[] = [];

    await installEssentials(['git'], (p) => progress.push(p));

    expect(commands).toHaveLength(1);
    const script = scriptOf(commands[0]);
    expect(script).toContain('https://gitforwindows.org/latest-tag.txt');
    expect(script).not.toContain('api.github.com');
    expect(script).toContain('/CURRENTUSER');
    expect(progress.at(-1)).toMatchObject({ id: 'git', phase: 'failed' });
  });

  it('says so when there is no way to install Blender without winget', async () => {
    const { installEssentials } = await import('../../../src/main/setup/essentials');
    const progress: unknown[] = [];

    await installEssentials(['blender'], (p) => progress.push(p));

    expect(commands).toHaveLength(0);
    expect(progress.at(-1)).toEqual({ id: 'blender', phase: 'failed', error: 'No way to install it on this PC.' });
  });

  it.runIf(process.platform === 'win32')('writes scripts PowerShell parses, and turns Git tags into installer names', async () => {
    const { spawnSync } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    const { installEssentials } = await import('../../../src/main/setup/essentials');
    await installEssentials(['git', 'node', 'bun', 'uv'], () => undefined);
    expect(commands).toHaveLength(4);

    for (const command of commands) {
      const file = /-File "([^"]+)"/.exec(command)?.[1];
      const check = spawnSync('powershell', [
        '-NoProfile', '-Command',
        `$e = $null; $t = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${file}', [ref]$t, [ref]$e); $e.Count`,
      ], { encoding: 'utf-8' });
      expect(check.stdout.trim(), file).toBe('0');
    }

    // The tag → file-name lines of the Git script, fed known tags.
    const naming = scriptOf(commands[0]).split('\n').filter((l) => /^if \(|^\$name/.test(l)).join('\n');
    const name = (tag: string) => spawnSync('powershell', ['-NoProfile', '-Command', `$tag = '${tag}'\n${naming}\n$name`], { encoding: 'utf-8' }).stdout.trim();
    expect(name('v2.56.0.windows.1')).toBe('Git-2.56.0-64-bit.exe');
    expect(name('v2.35.1.windows.2')).toBe('Git-2.35.1.2-64-bit.exe');
  });
});
