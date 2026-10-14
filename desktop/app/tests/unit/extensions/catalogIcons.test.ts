/**
 * Icons for Settings › Extensions › Browse (src/main/extensions/catalogIcons.ts):
 * from each store page's og:image, Google's image host only, cached.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CatalogIcons, iconUrlFrom } from '../../../src/main/extensions/catalogIcons';

const ID = 'eimadpbcbfnmbkopoojfekhnkhdbieeh';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe('catalog icons', () => {
  it('takes the og:image only from Google’s image host', () => {
    expect(iconUrlFrom('<meta property="og:image" content="https://lh3.googleusercontent.com/abc=s128-rj">')).toBe('https://lh3.googleusercontent.com/abc=s128-rj');
    expect(iconUrlFrom('<meta property="og:image" content="https://evil.example/x.png">')).toBeNull();
    expect(iconUrlFrom('<html></html>')).toBeNull();
  });

  it('fetches each icon once, keeps it, and never fetches for an id that isn’t one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-icons-'));
    const fetched: string[] = [];
    const fetchBytes = async (url: string): Promise<Buffer> => {
      fetched.push(url);
      if (url.includes('chromewebstore')) return Buffer.from('<meta property="og:image" content="https://lh3.googleusercontent.com/icon">');
      return PNG;
    };
    const icons = new CatalogIcons({ dir, fetchBytes });
    const first = await icons.icons([ID, 'not-an-id', '../../etc']);
    expect(first[ID]).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(Object.keys(first)).toEqual([ID]);
    expect(fetched).toEqual([`https://chromewebstore.google.com/detail/${ID}`, 'https://lh3.googleusercontent.com/icon']);
    // A new instance reads the cache file: no network.
    const again = await new CatalogIcons({ dir, fetchBytes }).icons([ID]);
    expect(again[ID]).toBe(first[ID]);
    expect(fetched).toHaveLength(2);
  });
});
