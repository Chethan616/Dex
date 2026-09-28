import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  spawnSpecFor,
  sentinelLine,
  findSentinel,
  makeSentinel,
  startSession,
  runCommand,
  endSession,
  hasSession,
  type PtyLike,
  type PtySpawn,
} from '../../../src/main/hl/persistentShell';

describe('spawnSpecFor', () => {
  it('spawns cmd.exe with /K (stays alive) rather than /C (runs one command and exits)', () => {
    expect(spawnSpecFor('cmd')).toEqual({ command: 'cmd.exe', args: ['/K'] });
  });

  it('spawns powershell interactively with -NoExit', () => {
    expect(spawnSpecFor('powershell').args).toContain('-NoExit');
  });

  it('spawns wsl running an interactive bash inside it', () => {
    expect(spawnSpecFor('wsl')).toEqual({ command: 'wsl.exe', args: ['bash', '-i'] });
  });

  it('resolves bash via findGitBash, falling back to bare "bash" if none is found', () => {
    const spec = spawnSpecFor('bash', {});
    expect(spec.args).toEqual(['--noprofile', '--norc', '-i']);
    expect(typeof spec.command).toBe('string');
  });
});

describe('sentinelLine', () => {
  it('bash/wsl: echoes the marker with $? (the last exit code)', () => {
    expect(sentinelLine('bash', 'M1')).toBe('\necho M1_$?\n');
    expect(sentinelLine('wsl', 'M1')).toBe('\necho M1_$?\n');
  });

  it('cmd: echoes the marker with %errorlevel%', () => {
    expect(sentinelLine('cmd', 'M1')).toBe('\r\necho M1_%errorlevel%\r\n');
  });

  it('powershell: writes the marker with $LASTEXITCODE', () => {
    expect(sentinelLine('powershell', 'M1')).toBe('\r\nWrite-Output "M1_$LASTEXITCODE"\r\n');
  });
});

describe('makeSentinel', () => {
  it('produces a unique marker each call', () => {
    const a = makeSentinel();
    const b = makeSentinel();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^DEX_SH_DONE_[0-9a-f]+$/);
  });
});

describe('findSentinel', () => {
  it('returns null when the marker has not appeared yet', () => {
    expect(findSentinel('some partial output so far', 'MARK_123')).toBeNull();
  });

  it('splits off everything before the marker and parses a positive exit code', () => {
    const buffer = 'hello world\nMARK_123_0\n';
    expect(findSentinel(buffer, 'MARK_123')).toEqual({ before: 'hello world\n', exitCode: 0 });
  });

  it('parses a non-zero exit code', () => {
    const buffer = 'command failed\nMARK_123_127\n';
    expect(findSentinel(buffer, 'MARK_123')).toEqual({ before: 'command failed\n', exitCode: 127 });
  });

  it('handles CRLF line endings (cmd/powershell)', () => {
    const buffer = 'C:\\repo>dir\r\n file list\r\nMARK_123_0\r\n';
    const result = findSentinel(buffer, 'MARK_123');
    expect(result?.exitCode).toBe(0);
    expect(result?.before).toBe('C:\\repo>dir\r\n file list\r\n');
  });

  it('returns exitCode null if the marker line has no trailing number (unexpected shell output shape)', () => {
    expect(findSentinel('output\nMARK_123_\n', 'MARK_123')).toEqual({ before: 'output\n', exitCode: null });
  });
});

// A fake PTY: onData/onExit callbacks are captured so the test can push
// bytes and simulate exit; write() records what was sent so the test can
// assert the exact bytes a real shell would receive.
function fakePty(): { pty: PtyLike; push: (chunk: string) => void; writes: string[] } {
  let dataCb: ((chunk: string) => void) | null = null;
  const writes: string[] = [];
  const p: PtyLike = {
    pid: 4242,
    onData: (cb) => { dataCb = cb; },
    onExit: () => {},
    write: (data) => { writes.push(data); },
    kill: () => {},
  };
  return { pty: p, push: (chunk) => dataCb?.(chunk), writes };
}

describe('startSession / runCommand / endSession — session lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runCommand rejects for an id that was never started', async () => {
    await expect(runCommand('nope', 'echo hi')).rejects.toThrow(/no persistent shell session/);
  });

  it('startSession spawns via the injected factory and returns a usable session id', () => {
    const { pty: fake } = fakePty();
    const spawn: PtySpawn = vi.fn(() => fake);
    const id = startSession('bash', spawn);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(hasSession(id)).toBe(true);
    endSession(id);
  });

  it('runCommand writes the command plus the sentinel line, and resolves once the sentinel appears in the PTY output', async () => {
    const { pty: fake, push, writes } = fakePty();
    const id = startSession('bash', () => fake);

    const resultPromise = runCommand(id, 'echo hello', 5000);
    // The command a real shell would echo back, then its own output, then
    // our sentinel line's own output arriving asynchronously off the wire.
    push('hello\n');
    await new Promise((r) => setTimeout(r, 60)); // let the poll interval see the buffer
    const marker = writes[0].match(/echo (DEX_SH_DONE_[0-9a-f]+)_\$\?/)?.[1];
    expect(marker).toBeTruthy();
    push(`${marker}_0\n`);

    const result = await resultPromise;
    expect(result).toEqual({ exitCode: 0, timedOut: false, output: 'hello\n' });
  });

  it('a second runCommand call on the same session only sees that call\'s own output, not the first\'s leftovers', async () => {
    const { pty: fake, push, writes } = fakePty();
    const id = startSession('bash', () => fake);

    const first = runCommand(id, 'echo one', 5000);
    await new Promise((r) => setTimeout(r, 10));
    const marker1 = writes[0].match(/echo (DEX_SH_DONE_[0-9a-f]+)_\$\?/)![1];
    push(`one\n${marker1}_0\n`);
    await first;

    const second = runCommand(id, 'echo two', 5000);
    await new Promise((r) => setTimeout(r, 10));
    const marker2 = writes[1].match(/echo (DEX_SH_DONE_[0-9a-f]+)_\$\?/)![1];
    push(`two\n${marker2}_0\n`);
    const result = await second;

    expect(result.output).toBe('two\n');
    expect(marker1).not.toBe(marker2);
  });

  it('runCommand times out and reports whatever was captured so far if the sentinel never appears', async () => {
    const { pty: fake, push } = fakePty();
    const id = startSession('bash', () => fake);

    const resultPromise = runCommand(id, 'sleep 999', 80);
    push('still running...\n');
    const result = await resultPromise;

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.output).toBe('still running...\n');
  }, 2000);

  it('endSession kills the PTY and forgets the session; a later runCommand rejects', async () => {
    const { pty: fake } = fakePty();
    const killSpy = vi.fn();
    fake.kill = killSpy;
    const id = startSession('bash', () => fake);

    expect(endSession(id)).toBe(true);
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(hasSession(id)).toBe(false);
    await expect(runCommand(id, 'echo hi')).rejects.toThrow(/no persistent shell session/);
  });

  it('endSession on an unknown id is a no-op that returns false', () => {
    expect(endSession('never-existed')).toBe(false);
  });
});
