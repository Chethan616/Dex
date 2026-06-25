import { expect, test, describe, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Isolate test database folder
process.env.DEX_TEST_DIR = path.join(process.cwd(), '.temp_test_dex_prompt_cache');

import { runMigrations } from '../../src/db/migrations.js';
import { PromptCacheManager } from '../../src/llm/prompt-cache-manager.js';
import { getDexDir } from '../../src/utils/platform.js';
import { GeminiProvider } from '../../src/llm/providers/gemini.js';

describe('prompt cache manager', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const dir = getDexDir();
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (err) {}
    }
    await runMigrations();
  });

  afterAll(() => {
    const dir = getDexDir();
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (err) {}
    }
  });

  test('non-gemini returns undefined', async () => {
    const manager = new PromptCacheManager();
    const key = await manager.getOrRefresh(1, 'claude', []);
    expect(key).toBeUndefined();
  });

  test('warms and retrieves cache keys for gemini', async () => {
    const warmSpy = vi.spyOn(GeminiProvider.prototype, 'warmCache').mockResolvedValue('cachedContents/mock-cache-key-123');

    const manager = new PromptCacheManager();
    const key = await manager.getOrRefresh(1, 'gemini', []);
    
    expect(warmSpy).toHaveBeenCalled();
    expect(key).toBe('cachedContents/mock-cache-key-123');

    warmSpy.mockClear();
    const key2 = await manager.getOrRefresh(1, 'gemini', []);
    expect(warmSpy).not.toHaveBeenCalled();
    expect(key2).toBe('cachedContents/mock-cache-key-123');
  });
});
