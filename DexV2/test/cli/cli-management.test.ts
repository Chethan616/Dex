import { expect, test, describe, vi, beforeEach, afterEach } from 'vitest';
import * as child_process from 'child_process';
import { stopCommand } from '../../src/cli/stop.js';
import { restartCommand } from '../../src/cli/restart.js';
import { AgentOrchestrator } from '../../src/gateway/orchestrator.js';

// Mock child_process.exec
vi.mock('child_process', () => {
  return {
    exec: vi.fn().mockImplementation((cmd, callback) => {
      setTimeout(() => callback(null, 'stopped', ''), 10);
    }),
    execSync: vi.fn().mockReturnValue(Buffer.from('admin')),
    spawn: vi.fn().mockReturnValue({
      pid: 12345,
      unref: vi.fn()
    })
  };
});

describe('CLI stop and restart commands', () => {
  let logSpy: any;
  let startSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('stopCommand executes process kill and prints success log', async () => {
    await stopCommand();
    expect(child_process.exec).toHaveBeenCalledWith(
      expect.stringContaining('18789'),
      expect.any(Function)
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('stopped successfully'));
  });

  test('restartCommand runs stop followed by startCommand', async () => {
    const startModule = await import('../../src/cli/start.js');
    startSpy = vi.spyOn(startModule, 'startCommand').mockResolvedValue();

    await restartCommand();

    expect(child_process.exec).toHaveBeenCalled();
    expect(startSpy).toHaveBeenCalled();
  });
});

describe('Resilient JSON parser tests', () => {
  test('recovers from trailing commas and single/multi-line comments', () => {
    const orchestrator = new AgentOrchestrator() as any;

    const testJson = `
      {
        "t": "exec", // Single-line comment here
        "a": {
          "c": "echo 'hello'",
        }, /* Multi-line
              comment here */
      }
    `;

    const cleaned = orchestrator.extractJson(testJson);
    const parsed = JSON.parse(cleaned);

    expect(parsed.t).toBe('exec');
    expect(parsed.a.c).toBe("echo 'hello'");
  });
});
