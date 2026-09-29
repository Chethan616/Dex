import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-hf-usage-'));
vi.mock('electron', () => ({ app: { getPath: () => dir } }));

const { huggingFaceUsage, recordModel, recordQuotaExhausted } = await import('../../../src/main/threed/usage');

describe('Hugging Face usage (Settings → Accounts)', () => {
  it('counts the models made today', () => {
    expect(huggingFaceUsage().modelsToday).toBe(0);
    recordModel(158);
    recordModel(140);
    expect(huggingFaceUsage()).toEqual({ modelsToday: 2, refillsAt: undefined });
  });

  it('remembers when the GPU time refills, from the Space’s "Try again in"', () => {
    const before = Date.now();
    recordQuotaExhausted('13:45:12');
    const { refillsAt } = huggingFaceUsage();
    expect(refillsAt).toBeGreaterThanOrEqual(before + (13 * 3600 + 45 * 60 + 12) * 1000);
    expect(refillsAt).toBeLessThan(before + (13 * 3600 + 45 * 60 + 12) * 1000 + 5000);
  });

  it('assumes a day when the wait isn’t given, and a new model clears it', () => {
    recordQuotaExhausted(undefined);
    expect(huggingFaceUsage().refillsAt).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
    recordModel(120);
    expect(huggingFaceUsage().refillsAt).toBeUndefined();
  });
});
