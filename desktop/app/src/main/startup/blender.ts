/**
 * Where Blender is installed, for the agent (DEX_BLENDER) and the Blender
 * connection. The Blender tools drive a Blender that runs in the background
 * with no window (mcp-servers/blender), and `dex-blender run/render` use the
 * same exe for one-off headless work.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Where the background Blenders keep each task's scene (<home>/<session>/
 * scene.blend, autosaved) — mcp-servers/blender and `dex-blender` agree on it.
 */
export function blenderHome(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron');
    return path.join(app.getPath('userData'), 'blender');
  } catch {
    return path.join(process.env.APPDATA ?? process.cwd(), 'DEX', 'blender');
  }
}

let cached: string | null | undefined;

/** Look again next time — Blender may have just been installed. */
export function resetBlenderCache(): void {
  cached = undefined;
}

/** Newest blender.exe under the usual install roots, or null. */
export function findBlender(): string | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (process.platform !== 'win32') {
    for (const p of ['/Applications/Blender.app/Contents/MacOS/Blender', '/usr/bin/blender', '/snap/bin/blender']) {
      if (fs.existsSync(p)) return (cached = p);
    }
    return cached;
  }
  const roots = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Blender Foundation'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)']!, 'Blender Foundation'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Blender Foundation'),
  ].filter((r): r is string => Boolean(r));
  const found: Array<{ exe: string; version: number[] }> = [];
  for (const root of roots) {
    let dirs: string[] = [];
    try { dirs = fs.readdirSync(root); } catch { continue; }
    for (const dir of dirs) {
      const exe = path.join(root, dir, 'blender.exe');
      if (!fs.existsSync(exe)) continue;
      const version = (dir.match(/(\d+(?:\.\d+)*)/)?.[1] ?? '0').split('.').map(Number);
      found.push({ exe, version });
    }
  }
  found.sort((a, b) => {
    for (let i = 0; i < Math.max(a.version.length, b.version.length); i += 1) {
      const d = (b.version[i] ?? 0) - (a.version[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  });
  return (cached = found[0]?.exe ?? null);
}
