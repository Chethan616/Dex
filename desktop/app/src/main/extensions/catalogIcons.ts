/**
 * Real icons for Settings › Extensions › Browse (shared/extensionCatalog.ts):
 * each extension's own store page names its 128 px icon (og:image), which
 * main downloads once and keeps as a data URL in
 * <userData>/extensions/catalog-icons.json. The hub never calls Google.
 *
 * Only the store's own pages, only images from Google's image host, small.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface CatalogIconDeps {
  dir: string;
  fetchBytes: (url: string, maxBytes: number) => Promise<Buffer>;
  now?: () => number;
}

interface Cached { icon: string; at: number }

const STALE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_ICON_BYTES = 200 * 1024;
const ID = /^[a-p]{32}$/;
const ICON_HOST = /^https:\/\/lh\d\.googleusercontent\.com\//;

/** The og:image of a store page, if it's an icon on Google's image host. */
export function iconUrlFrom(html: string): string | null {
  const m = /<meta\s+property="og:image"\s+content="([^"]+)"/i.exec(html);
  if (!m) return null;
  const url = m[1].replace(/&amp;/g, '&');
  return ICON_HOST.test(url) ? url : null;
}

export class CatalogIcons {
  private cache: Record<string, Cached> | null = null;
  private inflight = new Map<string, Promise<string | null>>();

  constructor(private readonly deps: CatalogIconDeps) {}

  private file(): string {
    return path.join(this.deps.dir, 'catalog-icons.json');
  }

  private load(): Record<string, Cached> {
    if (this.cache) return this.cache;
    try { this.cache = JSON.parse(fs.readFileSync(this.file(), 'utf-8')) as Record<string, Cached>; } catch { this.cache = {}; }
    return this.cache;
  }

  private save(): void {
    try {
      fs.mkdirSync(this.deps.dir, { recursive: true });
      fs.writeFileSync(this.file(), JSON.stringify(this.cache ?? {}));
    } catch { /* fetched again next time */ }
  }

  private async fetchOne(id: string): Promise<string | null> {
    const html = (await this.deps.fetchBytes(`https://chromewebstore.google.com/detail/${id}`, MAX_PAGE_BYTES)).toString('utf8');
    const url = iconUrlFrom(html);
    if (!url) return null;
    const bytes = await this.deps.fetchBytes(url, MAX_ICON_BYTES);
    const mime = bytes[0] === 0x89 ? 'image/png' : bytes[0] === 0xff ? 'image/jpeg' : bytes.subarray(0, 4).toString('latin1') === 'RIFF' ? 'image/webp' : null;
    return mime ? `data:${mime};base64,${bytes.toString('base64')}` : null;
  }

  /** Icons for these ids: cached ones at once, the rest fetched (a few at a time). */
  async icons(ids: string[]): Promise<Record<string, string>> {
    const cache = this.load();
    const now = this.deps.now?.() ?? Date.now();
    const out: Record<string, string> = {};
    const missing: string[] = [];
    for (const id of ids) {
      if (!ID.test(id)) continue;
      const hit = cache[id];
      if (hit?.icon) out[id] = hit.icon;
      if (!hit || now - hit.at > STALE_MS) missing.push(id);
    }
    let changed = false;
    for (let i = 0; i < missing.length; i += 4) {
      await Promise.all(missing.slice(i, i + 4).map(async (id) => {
        let p = this.inflight.get(id);
        if (!p) {
          p = this.fetchOne(id).catch(() => null).finally(() => this.inflight.delete(id));
          this.inflight.set(id, p);
        }
        const icon = await p;
        if (icon) { cache[id] = { icon, at: now }; out[id] = icon; changed = true; }
      }));
    }
    if (changed) this.save();
    return out;
  }
}
