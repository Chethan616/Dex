import { describe, expect, it, vi } from 'vitest';

// An in-memory stand-in for the few Firestore calls collectUploads makes.
const store = new Map<string, Record<string, unknown>>();
const deleted: string[] = [];

vi.mock('electron', () => ({ app: { getPath: () => '.' }, nativeImage: { createFromPath: () => ({ isEmpty: () => true }) } }));
vi.mock('../../../src/main/logger', () => ({ mainLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, path: string) => ({ path }),
  collection: (ref: { path: string } | unknown, sub?: string) => ({ path: sub ? `${(ref as { path: string }).path}/${sub}` : String(ref) }),
  getDoc: async (ref: { path: string }) => ({ exists: () => store.has(ref.path), data: () => store.get(ref.path) }),
  getDocs: async (col: { path: string }) => ({
    docs: [...store.keys()]
      .filter((k) => k.startsWith(`${col.path}/`) && !k.slice(col.path.length + 1).includes('/'))
      .map((k) => ({ ref: { path: k }, data: () => store.get(k) })),
  }),
  writeBatch: () => {
    const ops: string[] = [];
    return { delete: (ref: { path: string }) => ops.push(ref.path), commit: async () => { ops.forEach((p) => { store.delete(p); deleted.push(p); }); } };
  },
}));

import { FirebaseBridge } from '../../../src/main/firebase/bridge';

function bridge() {
  const b = new FirebaseBridge({} as never) as unknown as { db: unknown; uid: string; collectUploads: (ids: unknown) => Promise<Array<{ name: string; mime: string; bytes: Uint8Array }>> };
  b.db = {};
  b.uid = 'u1';
  return b;
}

function putUpload(id: string, name: string, mime: string, bytes: Buffer, chunkSize: number, writeMeta = true) {
  const base = `users/u1/uploads/${id}`;
  const parts = Math.max(1, Math.ceil(bytes.length / chunkSize));
  // Written out of order on purpose: the PC must sort by `i`.
  for (let i = parts - 1; i >= 0; i -= 1) {
    store.set(`${base}/chunks/${String(i).padStart(4, '0')}`, { i, data: bytes.subarray(i * chunkSize, (i + 1) * chunkSize).toString('base64') });
  }
  if (writeMeta) store.set(base, { name, mime, size: bytes.length, chunks: parts, createdAt: Date.now() });
}

describe('phone uploads → attachments', () => {
  it('reassembles chunks in order and deletes the upload', async () => {
    const photo = Buffer.from(Array.from({ length: 2500 }, (_, i) => i % 251));
    putUpload('a', 'cat.jpg', 'image/jpeg', photo, 700);
    const files = await bridge().collectUploads(['a']);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('cat.jpg');
    expect(files[0].mime).toBe('image/jpeg');
    expect(Buffer.from(files[0].bytes).equals(photo)).toBe(true);
    expect([...store.keys()].some((k) => k.startsWith('users/u1/uploads/a'))).toBe(false);
  });

  it('refuses an upload whose chunks did not all arrive', async () => {
    const doc = Buffer.from('x'.repeat(2000));
    putUpload('b', 'form.pdf', 'application/pdf', doc, 700);
    store.delete('users/u1/uploads/b/chunks/0001');
    await expect(bridge().collectUploads(['b'])).rejects.toThrow(/incomplete/);
  });

  it('refuses an upload whose meta never landed', async () => {
    putUpload('c', 'x.txt', 'text/plain', Buffer.from('hi'), 700, false);
    await expect(bridge().collectUploads(['c'])).rejects.toThrow(/didn’t arrive/);
  });

  it('no uploads → no attachments', async () => {
    expect(await bridge().collectUploads(undefined)).toEqual([]);
    expect(await bridge().collectUploads([])).toEqual([]);
  });
});
