import { describe, expect, it } from 'vitest';
import { installerSpawnSpec, runInstallCommand } from '../../../src/main/hl/engines/installer';

const posixIt = process.platform === 'win32' ? it.skip : it;

/**
 * Commands for exercising the runner's process handling: does it resolve when
 * the process exits, and does it report the exit code and stderr.
 *
 * Both are quote-free on purpose. Windows routes installs through
 * `cmd /d /s /c`, and /s strips the first and last quote of the entire command
 * line -- so any fixture carrying a quoted path or a quoted -e script arrives
 * at node already mangled, and the test fails on its own construction rather
 * than on the runner. Real install commands (`npm install -g @openai/codex`)
 * are quote-free too, so this is also the shape we actually ship.
 *
 * installerSpawnSpec's own quoting is covered by the two tests above.
 */
const SUCCEEDING_COMMAND = 'node --version';
const FAILING_COMMAND = 'node --definitely-not-a-real-flag';

describe('engine installer background runner', () => {
  it('routes Windows installs through hidden cmd.exe without opening a terminal', () => {
    const command = 'npm install -g @openai/codex';

    const spec = installerSpawnSpec(command, {
      platform: 'win32',
      env: {
        Path: 'C:\\Windows\\System32',
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      },
    });

    expect(spec.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(spec.args).toEqual(['/d', '/s', '/c', command]);
    expect(spec.spawnOptions).toEqual({ windowsHide: true });
    expect(spec.args.join(' ')).not.toContain('start');
    expect(spec.args.join(' ')).not.toContain('Installer');
  });

  it('routes POSIX installs through a background shell command runner', () => {
    const command = 'curl -fsSL https://claude.ai/install.sh | bash';

    const spec = installerSpawnSpec(command, {
      platform: 'linux',
      env: { PATH: '/usr/bin' },
    });

    expect(spec.command).toBe('sh');
    expect(spec.args).toEqual(['-lc', command]);
    expect(spec.spawnOptions).toEqual({});
  });

  it('resolves after the installer process exits successfully', async () => {
    const result = await runInstallCommand('Test Installer', SUCCEEDING_COMMAND, { timeoutMs: 10000 });

    expect(result).toMatchObject({
      opened: true,
      completed: true,
      exitCode: 0,
      signal: null,
      displayName: 'Test Installer',
    });
    expect(result.stdout.trim()).toMatch(/^v\d+\./);
    expect(result.error).toBeUndefined();
  });

  it('returns installer stderr and exit code when the process fails', async () => {
    const result = await runInstallCommand('Test Installer', FAILING_COMMAND, { timeoutMs: 10000 });

    expect(result).toMatchObject({
      opened: false,
      completed: true,
      signal: null,
      displayName: 'Test Installer',
    });
    // The exact code is the failing program's business; what this asserts is
    // that a failure is reported as one, with the program's own words.
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/bad option/i);
    expect(result.error).toMatch(/bad option/i);
  });

  posixIt('uses the signal in the fallback error when the installer is externally killed', async () => {
    const result = await runInstallCommand(
      'Test Installer',
      'kill -TERM $$',
      { timeoutMs: 5000 },
    );

    expect(result).toMatchObject({
      opened: false,
      completed: true,
      exitCode: null,
      signal: 'SIGTERM',
      displayName: 'Test Installer',
      error: 'Test Installer installer exited from signal SIGTERM',
    });
  });
});
