import { expect, test, describe, vi, beforeEach, afterEach } from 'vitest';
import * as child_process from 'child_process';
import fs from 'fs';
import WebSocket from 'ws';
import { startCommand } from '../../src/cli/start.js';

// Mock ws
vi.mock('ws', () => {
  return {
    default: vi.fn().mockImplementation((url) => {
      return {
        on: vi.fn().mockImplementation((event, callback) => {
          if (event === 'open') {
            // Trigger open callback to simulate server is running
            setTimeout(callback, 10);
          }
        }),
        close: vi.fn()
      };
    })
  };
});

// Mock child_process
vi.mock('child_process', () => {
  return {
    spawn: vi.fn().mockReturnValue({
      pid: 9999,
      unref: vi.fn()
    })
  };
});

describe('CLI startCommand tests', () => {
  let logSpy: any;
  let errorSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('reports already running if WebSocket connection succeeds', async () => {
    // Run command
    await startCommand();

    // Check log output
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('already running'));
    expect(child_process.spawn).not.toHaveBeenCalled();
  });

  test('spawns launcher process if WebSocket connection fails', async () => {
    // Override ws mock temporarily to simulate connection failure
    const WebSocketMock = vi.mocked(WebSocket);
    WebSocketMock.mockImplementationOnce(() => {
      return {
        on: vi.fn().mockImplementation((event, callback) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('Connection refused')), 10);
          }
        }),
        close: vi.fn()
      } as any;
    });

    // Mock launcher file check
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    // Run command
    await startCommand();

    expect(child_process.spawn).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('successfully launched'));

    existsSpy.mockRestore();
  });
});
