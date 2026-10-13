/**
 * chrome.storage.sync for extensions. Electron has the namespace but every
 * call fails ("sync is not available in this instance of Chrome"), and many
 * extensions keep their settings there (Dark Reader does). DEX has no Chrome
 * account to sync with, so "sync" is kept on this PC: one JSON file per
 * extension, with Chrome's quotas so extensions see the errors they expect.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ApiError, type CallContext, type Handler } from './types';

export const SYNC_QUOTA = { QUOTA_BYTES: 102400, QUOTA_BYTES_PER_ITEM: 8192, MAX_ITEMS: 512 };

type Store = Record<string, unknown>;
export type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;

function bytesOf(key: string, value: unknown): number {
  return key.length + JSON.stringify(value ?? null).length;
}

export class SyncStorage {
  private cache = new Map<string, Store>();

  constructor(private readonly dir: string, private readonly changed: (extensionId: string, changes: Changes) => void) {}

  private file(id: string): string { return path.join(this.dir, `${id}.json`); }

  private load(id: string): Store {
    let s = this.cache.get(id);
    if (!s) {
      try { s = JSON.parse(fs.readFileSync(this.file(id), 'utf8')) as Store; } catch { s = {}; }
      if (!s || typeof s !== 'object' || Array.isArray(s)) s = {};
      this.cache.set(id, s);
    }
    return s;
  }

  private save(id: string, s: Store): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file(id)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s));
    fs.renameSync(tmp, this.file(id));
  }

  forget(id: string): void {
    this.cache.delete(id);
    fs.rmSync(this.file(id), { force: true });
  }

  /** Chrome's get: null for all, a key, a list, or an object of defaults. */
  get(id: string, keys: unknown): Store {
    const s = this.load(id);
    if (keys === null || keys === undefined) return { ...s };
    if (typeof keys === 'string') return keys in s ? { [keys]: s[keys] } : {};
    if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k): k is string => typeof k === 'string' && k in s).map((k) => [k, s[k]]));
    if (typeof keys === 'object') {
      const out: Store = {};
      for (const [k, dflt] of Object.entries(keys as Store)) out[k] = k in s ? s[k] : dflt;
      return out;
    }
    throw new ApiError('Invalid keys for storage.sync.get');
  }

  set(id: string, items: unknown): void {
    if (!items || typeof items !== 'object' || Array.isArray(items)) throw new ApiError('storage.sync.set needs an object');
    const s = this.load(id);
    const next = { ...s };
    const changes: Changes = {};
    for (const [k, v] of Object.entries(items as Store)) {
      if (v === undefined) continue;
      if (bytesOf(k, v) > SYNC_QUOTA.QUOTA_BYTES_PER_ITEM) throw new ApiError('QUOTA_BYTES_PER_ITEM quota exceeded');
      if (JSON.stringify(s[k]) !== JSON.stringify(v)) changes[k] = { ...(k in s ? { oldValue: s[k] } : {}), newValue: v };
      next[k] = v;
    }
    if (Object.keys(next).length > SYNC_QUOTA.MAX_ITEMS) throw new ApiError('MAX_ITEMS quota exceeded');
    if (Object.entries(next).reduce((n, [k, v]) => n + bytesOf(k, v), 0) > SYNC_QUOTA.QUOTA_BYTES) throw new ApiError('QUOTA_BYTES quota exceeded');
    this.cache.set(id, next);
    this.save(id, next);
    if (Object.keys(changes).length) this.changed(id, changes);
  }

  remove(id: string, keys: unknown): void {
    const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : [];
    const s = this.load(id);
    const next = { ...s };
    const changes: Changes = {};
    for (const k of list) if (k in next) { changes[k] = { oldValue: next[k] }; delete next[k]; }
    if (!Object.keys(changes).length) return;
    this.cache.set(id, next);
    this.save(id, next);
    this.changed(id, changes);
  }

  clear(id: string): void {
    const s = this.load(id);
    const changes: Changes = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { oldValue: v }]));
    this.cache.set(id, {});
    this.save(id, {});
    if (Object.keys(changes).length) this.changed(id, changes);
  }

  bytesInUse(id: string, keys: unknown): number {
    const s = this.get(id, keys === undefined ? null : keys);
    return Object.entries(s).reduce((n, [k, v]) => n + bytesOf(k, v), 0);
  }

  handlers(fileAccess: (extensionId: string) => boolean): Record<string, Handler> {
    return {
      'storage.sync.get': (ctx: CallContext, [keys]) => this.get(ctx.extensionId, keys),
      'storage.sync.getKeys': (ctx) => Object.keys(this.load(ctx.extensionId)),
      'storage.sync.set': (ctx, [items]) => this.set(ctx.extensionId, items),
      'storage.sync.remove': (ctx, [keys]) => this.remove(ctx.extensionId, keys),
      'storage.sync.clear': (ctx) => this.clear(ctx.extensionId),
      'storage.sync.getBytesInUse': (ctx, [keys]) => this.bytesInUse(ctx.extensionId, keys),
      'storage.sync.setAccessLevel': () => undefined,
      'extension.isAllowedFileSchemeAccess': (ctx) => fileAccess(ctx.extensionId),
      'extension.isAllowedIncognitoAccess': () => false,
    };
  }
}
