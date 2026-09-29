/**
 * A .blend, made viewable on the phone — which can't run Blender.
 *
 * mcp-servers/blender/scene_preview.py runs in a windowless Blender and
 * writes a render through the scene's camera (the real materials and light),
 * the whole scene as a GLB for the interactive 3D view, the world's HDRI as
 * a sky picture, and the camera in <model-viewer> terms so the 3D view opens
 * where the render was taken. The phone pulls those through the usual
 * transfers (fetch_file with mode "scene").
 *
 * Cached per file version (path + size + mtime): opening the same scene again
 * costs nothing; a changed .blend is prepared afresh.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { mainLogger } from '../logger';
import { blenderHome, findBlender } from '../startup/blender';

export interface ScenePreview {
  dir: string;
  render?: string;
  glb?: string;
  sky?: string;
  /** <model-viewer> camera: orbit, target, fov (strings), and the scene's radius. */
  view: Record<string, unknown>;
  meta: Record<string, unknown>;
}

const inFlight = new Map<string, Promise<ScenePreview>>();

function appRoot(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron');
    return app.getAppPath();
  } catch {
    return process.cwd();
  }
}

/** The script on real disk — inside an installed DEX it lives in app.asar, which Blender can't read. */
async function script(): Promise<string> {
  const source = await fs.readFile(path.join(appRoot(), 'mcp-servers', 'blender', 'scene_preview.py'));
  const target = path.join(blenderHome(), 'scene_preview.py');
  const current = await fs.readFile(target).catch(() => null);
  if (!current || !current.equals(source)) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, source);
  }
  return target;
}

async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then((s) => s.isFile() && s.size > 0, () => false);
}

async function readPreview(dir: string): Promise<ScenePreview> {
  const json = async (name: string) => JSON.parse(await fs.readFile(path.join(dir, name), 'utf-8')) as Record<string, unknown>;
  const part = async (name: string) => ((await exists(path.join(dir, name))) ? path.join(dir, name) : undefined);
  return {
    dir,
    render: await part('render.jpg'),
    glb: await part('scene.glb'),
    sky: await part('sky.jpg'),
    view: await json('view.json'),
    meta: await json('meta.json'),
  };
}

/** Drop previews nobody has opened in a week. */
async function prune(root: string): Promise<void> {
  const cutoff = Date.now() - 7 * 24 * 60 * 60_000;
  for (const name of await fs.readdir(root).catch(() => [] as string[])) {
    const dir = path.join(root, name);
    const st = await fs.stat(dir).catch(() => null);
    if (st?.isDirectory() && st.mtimeMs < cutoff) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function prepareScenePreview(blendPath: string): Promise<ScenePreview> {
  const st = await fs.stat(blendPath).catch(() => null);
  if (!st?.isFile()) throw new Error('The .blend file isn’t on your PC anymore (moved or deleted).');
  // The script's own version is part of the key: an improved converter
  // re-prepares scenes instead of serving what the old one made.
  const py = await script();
  const version = createHash('sha1').update(await fs.readFile(py)).digest('hex').slice(0, 8);
  const key = createHash('sha1').update(`${path.resolve(blendPath).toLowerCase()}|${st.size}|${st.mtimeMs}|${version}`).digest('hex').slice(0, 20);
  const root = path.join(blenderHome(), 'scene-previews');
  const dir = path.join(root, key);

  if (await exists(path.join(dir, 'meta.json'))) {
    const now = new Date();
    await fs.utimes(dir, now, now).catch(() => {});
    return readPreview(dir);
  }
  const running = inFlight.get(key);
  if (running) return running;

  const job = (async () => {
    const exe = findBlender();
    if (!exe) throw new Error('Blender isn’t installed on your PC, so the scene can’t be prepared.');
    await fs.mkdir(dir, { recursive: true });
    void prune(root);
    const started = Date.now();
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        exe,
        ['-b', blendPath, '--python-exit-code', '1', '-P', py, '--', '--out', dir],
        { windowsHide: true, timeout: 6 * 60_000, maxBuffer: 32 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const text = `${stdout}\n${stderr}`;
          if (err) reject(new Error(`Blender couldn’t prepare the scene: ${(text.match(/Error.*$/m)?.[0] ?? err.message).slice(0, 300)}`));
          else resolve(text);
        },
      );
    });
    if (!(await exists(path.join(dir, 'meta.json')))) {
      throw new Error(`Blender couldn’t prepare the scene: ${output.split('\n').filter((l) => /DEX scene|Error/.test(l)).slice(-3).join(' ').slice(0, 300)}`);
    }
    const preview = await readPreview(dir);
    mainLogger.info('scenePreview.ready', { seconds: Math.round((Date.now() - started) / 1000), glbBytes: preview.meta.glb_bytes });
    return preview;
  })()
    .catch(async (err) => {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      throw err;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}
