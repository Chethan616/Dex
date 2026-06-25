import { expect, test, describe, vi } from 'vitest';
import { executeTool } from '../../src/tools/executor.js';
import fs from 'fs';
import path from 'path';

describe('tool executor tests', () => {
  test('exec (PowerShell) command execution', async () => {
    const res = await executeTool('exec', { c: 'Write-Output "Dex V2 test"' });
    expect(res).toBe('Dex V2 test');
  });

  test('exec accepts common command aliases', async () => {
    await expect(executeTool('exec', { cmd: 'Write-Output "cmd alias"' })).resolves.toBe('cmd alias');
    await expect(executeTool('exec', { command: 'Write-Output "command alias"' })).resolves.toBe('command alias');
  });

  test('clipboard read and write', async () => {
    // Write text to clipboard
    await executeTool('clipboard', { op: 'write', text: 'Dex Clipboard Content' });
    // Read text back
    const readVal = await executeTool('clipboard', { op: 'read' });
    expect(readVal).toContain('Dex Clipboard Content');
  });

  test('code sandbox execution (Node.js)', async () => {
    const code = `console.log(2 + 2);`;
    const res = await executeTool('code', { lang: 'node', code });
    expect(res).toBe('4');
  });

  test('search tool finds matching files', async () => {
    // Create a temporary file to search
    const testDir = process.cwd();
    const testFileName = `test_search_file_${Date.now()}.txt`;
    const testFilePath = path.join(testDir, testFileName);
    fs.writeFileSync(testFilePath, 'test content');

    try {
      const res = await executeTool('search', { query: testFileName, path: testDir });
      expect(res).toContain(testFileName);
    } finally {
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
    }
  });

  test('jq parsing tool works correctly', async () => {
    const testFile = path.join(process.cwd(), `test_jq_${Date.now()}.json`);
    fs.writeFileSync(testFile, JSON.stringify({ a: { b: 42 } }));

    try {
      const res = await executeTool('jq', { query: '.a.b', filePath: testFile });
      expect(res).toBe('42');
    } finally {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  });

  test('http tool routes fetch correctly', async () => {
    // Mock global fetch
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '{"status":"ok"}'
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await executeTool('http', { method: 'GET', url: 'https://api.example.com/status' });
    expect(res).toContain('HTTP 200');
    expect(res).toContain('{"status":"ok"}');

    vi.unstubAllGlobals();
  });
});
