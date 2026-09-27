/**
 * "Your DEX" — the bot that represents you across the desktop and the phone:
 * which of the eighteen bot-avatars bodies, an optional colour, and the name
 * you call it.
 *
 * Until you choose, it's a random bot — but a *stable* random one, derived
 * from this install (and, once the phone bridge signs in, from the account),
 * so it doesn't reshuffle on every launch. When the bridge is online the
 * profile lives at users/{uid}.profile in Firestore and follows you to the
 * phone; this file is the local copy.
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { getInstallId } from './installId';
import { mainLogger } from './logger';

export const BOT_TYPES = [
  'clover', 'flower', 'triangle', 'square', 'blob', 'ghost', 'circle', 'drop', 'star',
  'droid', 'mech', 'alien', 'hexagon', 'cat', 'cloud', 'pill', 'pebble', 'puddle',
] as const;

export interface DexProfile {
  bot: string;
  /** #RRGGBB, or null for the bot's own colour. */
  color: string | null;
  /** What you call your DEX. */
  name: string | null;
  /** False until the user has chosen (drives the onboarding step). */
  chosen: boolean;
  updatedAt: number;
}

export const profileEvents = new EventEmitter();

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A stable random bot for a seed (install id or account uid). */
export function defaultProfile(seed: string): DexProfile {
  return { bot: BOT_TYPES[hash(seed) % BOT_TYPES.length], color: null, name: null, chosen: false, updatedAt: 0 };
}

function file(): string {
  return path.join(app.getPath('userData'), 'dex-profile.json');
}

let cached: DexProfile | null = null;

export function getProfile(): DexProfile {
  if (cached) return cached;
  try {
    cached = sanitize(JSON.parse(fs.readFileSync(file(), 'utf-8')));
  } catch {
    cached = defaultProfile(getInstallId());
  }
  return cached;
}

function sanitize(input: unknown): DexProfile {
  const p = (input ?? {}) as Partial<DexProfile>;
  const bot = typeof p.bot === 'string' && (BOT_TYPES as readonly string[]).includes(p.bot) ? p.bot : defaultProfile(getInstallId()).bot;
  const color = typeof p.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : null;
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 32) : null;
  return { bot, color, name, chosen: p.chosen === true, updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : 0 };
}

/**
 * Save a profile. `source` says where it came from, so the bridge doesn't
 * echo a change back to Firestore that Firestore just sent it.
 */
export function setProfile(next: Partial<DexProfile>, source: 'local' | 'remote' = 'local'): DexProfile {
  const merged = sanitize({ ...getProfile(), ...next, updatedAt: next.updatedAt ?? Date.now() });
  cached = merged;
  try {
    fs.writeFileSync(file(), JSON.stringify(merged, null, 2), 'utf-8');
  } catch (err) {
    mainLogger.warn('profile.save.failed', { error: (err as Error).message });
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('profile:changed', merged);
  }
  profileEvents.emit('changed', merged, source);
  return merged;
}

export function registerProfileIpc(): void {
  ipcMain.handle('profile:get', () => getProfile());
  ipcMain.handle('profile:set', (_e, next: unknown) => setProfile(sanitize({ ...getProfile(), ...(next as object), chosen: true })));
}
