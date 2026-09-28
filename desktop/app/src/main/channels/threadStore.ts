/**
 * Which WhatsApp message belongs to which DEX task.
 *
 * Every message DEX sends about a task, and every message of yours that
 * started or continued one, is recorded here — so a WhatsApp *reply* to any
 * of them continues that same task, even after DEX restarts. Stored in
 * userData as a small JSON file (message ids only, no text), capped so it
 * can't grow without bound.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { mainLogger } from '../logger';

const MAX_ENTRIES = 2000;

type Store = Record<string, { sessionId: string; at: number }>;

export class ThreadStore {
  private store: Store = {};
  private readonly file: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(fileName = 'whatsapp-threads.json') {
    this.file = path.join(app.getPath('userData'), fileName);
    try {
      this.store = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as Store;
    } catch {
      this.store = {};
    }
  }

  get(messageId: string | undefined): string | undefined {
    return messageId ? this.store[messageId]?.sessionId : undefined;
  }

  link(messageId: string | null | undefined, sessionId: string): void {
    if (!messageId) return;
    this.store[messageId] = { sessionId, at: Date.now() };
    const keys = Object.keys(this.store);
    if (keys.length > MAX_ENTRIES) {
      keys
        .sort((a, b) => this.store[a].at - this.store[b].at)
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((k) => delete this.store[k]);
    }
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        fs.writeFileSync(this.file, JSON.stringify(this.store), 'utf-8');
      } catch (err) {
        mainLogger.warn('channels.threads.saveFailed', { error: (err as Error).message });
      }
    }, 500);
  }
}
