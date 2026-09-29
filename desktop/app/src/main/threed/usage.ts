/**
 * How much of today's Hugging Face GPU time dex-3d has used, for the account
 * card in Settings. Hugging Face has no "time left" API, so DEX counts the
 * models it made today and, when a Space answers "quota used up — try again
 * in 13:45:12", remembers when the time refills.
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

interface UsageFile {
  /** Local date the counts belong to (YYYY-MM-DD). */
  day: string;
  models: number;
  seconds: number;
  /** When the quota refills, after a "used up" answer (ms epoch). */
  refillsAt?: number;
}

export interface HuggingFaceUsage {
  modelsToday: number;
  /** Set while the day's GPU time is known to be used up. */
  refillsAt?: number;
}

function file(): string {
  return path.join(app.getPath('userData'), 'huggingface-usage.json');
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function read(): UsageFile {
  try {
    const u = JSON.parse(fs.readFileSync(file(), 'utf-8')) as UsageFile;
    if (u.day === today()) return u;
    // A new day: the counts start over, a pending refill time still stands.
    return { day: today(), models: 0, seconds: 0, refillsAt: u.refillsAt };
  } catch {
    return { day: today(), models: 0, seconds: 0 };
  }
}

function write(u: UsageFile): void {
  try {
    fs.writeFileSync(file(), JSON.stringify(u));
  } catch {
    /* only a display nicety */
  }
}

export function recordModel(seconds: number): void {
  const u = read();
  write({ ...u, models: u.models + 1, seconds: u.seconds + Math.max(0, Math.round(seconds)), refillsAt: undefined });
}

/** `wait` is the Space's "Try again in" text, e.g. "13:45:12" or "45:12". */
export function recordQuotaExhausted(wait?: string): void {
  const parts = (wait ?? '').split(':').map(Number).filter((n) => Number.isFinite(n));
  const secs = parts.reduce((acc, n) => acc * 60 + n, 0);
  write({ ...read(), refillsAt: Date.now() + (secs > 0 ? secs * 1000 : 24 * 60 * 60_000) });
}

export function huggingFaceUsage(): HuggingFaceUsage {
  const u = read();
  const refillsAt = u.refillsAt && u.refillsAt > Date.now() ? u.refillsAt : undefined;
  return { modelsToday: u.models, refillsAt };
}
