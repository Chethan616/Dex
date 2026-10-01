import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the Firestore writes a transfer makes.
const written = new Map<string, Record<string, unknown>>();

vi.mock('electron', () => ({ app: { getPath: () => '.' }, nativeImage: { createFromPath: () => ({ isEmpty: () => true }) } }));
vi.mock('../../../src/main/logger', () => ({ mainLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, p: string) => ({ path: p }),
  setDoc: async (ref: { path: string }, data: Record<string, unknown>) => { written.set(ref.path, data); },
  serverTimestamp: () => 'ts',
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-scene-'));
const blend = path.join(dir, 'house.blend');
fs.writeFileSync(blend, 'BLENDER-v500');
const parts = { render: path.join(dir, 'render.jpg'), sky: path.join(dir, 'sky.jpg'), glb: path.join(dir, 'scene.glb') };
fs.writeFileSync(parts.render, Buffer.alloc(1500, 1));
fs.writeFileSync(parts.sky, Buffer.alloc(800, 2));
fs.writeFileSync(parts.glb, Buffer.alloc(2 * 700 * 1024 + 10, 3));

const prepare = vi.fn(async () => ({ dir, ...parts, view: { orbit: '10deg 80deg 5m', target: '0m 1m 0m', fov: '30deg' }, meta: {} }));
vi.mock('../../../src/main/threed/scenePreview', () => ({ prepareScenePreview: prepare }));

import { FirebaseBridge } from '../../../src/main/firebase/bridge';

function bridge() {
  const host = {
    getSession: (id: string) => (id === 's1' ? { id, prompt: 'make a house', output: [] as unknown[] } : null),
    getTaskFiles: () => [{ path: blend, name: 'house.blend', size: 12 }],
  };
  const b = new FirebaseBridge(host as never) as unknown as {
    db: unknown; uid: string;
    sendSceneToPhone: (commandId: string, sessionId: string, file: string) => Promise<Record<string, unknown>>;
  };
  b.db = {};
  b.uid = 'u1';
  return b;
}

describe('fetch_file, mode scene', () => {
  it('prepares the .blend and sends render, sky and the scene GLB as their own transfers', async () => {
    const result = await bridge().sendSceneToPhone('c9', 's1', blend);
    expect(prepare).toHaveBeenCalledWith(blend);
    expect(result.mode).toBe('scene');
    expect(result.view).toEqual({ orbit: '10deg 80deg 5m', target: '0m 1m 0m', fov: '30deg' });
    const sent = result.parts as Record<string, { transferId: string; chunks: number; size: number }>;
    expect(Object.keys(sent)).toEqual(['render', 'sky', 'glb']);
    expect(sent.glb).toMatchObject({ transferId: 'c9-glb', chunks: 3 });
    expect(written.get('users/u1/transfers/c9-render')).toMatchObject({ name: 'render.jpg', chunks: 1, sessionId: 's1' });
    expect(written.has('users/u1/transfers/c9-glb/chunks/0002')).toBe(true);
  });

  it('refuses a file the task never produced', async () => {
    await expect(bridge().sendSceneToPhone('c10', 's1', path.join(dir, 'other.blend'))).rejects.toThrow(/isn’t part of this task/);
  });

  it('refuses anything that isn’t a .blend', async () => {
    const b = bridge() as unknown as { host: { getTaskFiles: () => unknown[] } } & ReturnType<typeof bridge>;
    b.host.getTaskFiles = () => [{ path: parts.render }];
    await expect(b.sendSceneToPhone('c11', 's1', parts.render)).rejects.toThrow(/Only \.blend/);
  });
});
