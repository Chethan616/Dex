/**
 * Files a task made outside its outputs/ folder still get their card
 * (main/hl/engines/artifacts.ts): a Blender render saved to the user's home
 * showed nothing in the chat.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { artifactTracker, pathsIn } from '../../../src/main/hl/engines/artifacts';

describe('paths in agent text', () => {
  it('finds Windows paths, escaped or not, and stops at the extension', () => {
    expect(pathsIn('Output path: C:\\Users\\cheth\\robot_render.png\nStarting render...')).toEqual(['C:\\Users\\cheth\\robot_render.png']);
    // A tool's JSON output doubles the backslashes and escapes the newline.
    expect(pathsIn('{"result":"Output path: C:\\\\Users\\\\cheth\\\\robot_render.png\\nStarting render"}')).toEqual(['C:\\Users\\cheth\\robot_render.png']);
    expect(pathsIn('Saved to `C:/Users/me/My Pictures/lamp.glb`.')).toEqual(['C:/Users/me/My Pictures/lamp.glb']);
    expect(pathsIn('Two files: C:\\a\\one.pdf and D:\\b\\two.csv, done.')).toEqual(['C:\\a\\one.pdf', 'D:\\b\\two.csv']);
  });

  it('finds Git Bash paths but not URLs', () => {
    expect(pathsIn('wrote /c/Users/me/Desktop/chart.png')).toEqual(['/c/Users/me/Desktop/chart.png']);
    expect(pathsIn('see /tmp/mh/render.png')).toEqual(['/tmp/mh/render.png']);
    expect(pathsIn('https://example.com/a/img.png and https://x.y/c/d.png')).toEqual([]);
  });

  it('ignores code and other files that are not results', () => {
    expect(pathsIn('Edited C:\\repo\\src\\index.ts and C:\\repo\\package.json')).toEqual([]);
  });
});

describe('the run’s artifacts', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-art-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('records a result file written during the run, once', () => {
    const png = path.join(dir, 'render.png');
    const t = artifactTracker({ startedAt: Date.now() - 1000, cwd: dir });
    fs.writeFileSync(png, 'png-bytes');
    expect(t.take(`Saved ${png}`, false)).toEqual([{ name: 'render.png', path: png, size: 9 }]);
    expect(t.take(`Here it is: ${png}`, true)).toEqual([]);
  });

  it('skips files from before the run, missing files, empty ones and the outputs folder', () => {
    const old = path.join(dir, 'old.png');
    fs.writeFileSync(old, 'x');
    const past = (Date.now() - 60_000) / 1000;
    fs.utimesSync(old, past, past);
    const empty = path.join(dir, 'empty.pdf');
    fs.writeFileSync(empty, '');
    const outputs = path.join(dir, 'outputs', 's1');
    fs.mkdirSync(outputs, { recursive: true });
    const inOutputs = path.join(outputs, 'chart.png');
    fs.writeFileSync(inOutputs, 'x');
    const t = artifactTracker({ startedAt: Date.now(), cwd: dir, skipDir: outputs });
    expect(t.take(`${old} ${empty} ${path.join(dir, 'gone.png')} ${inOutputs}`, true)).toEqual([]);
  });

  it('takes text files only when the agent names them itself', () => {
    const poem = path.join(dir, 'poem.txt');
    fs.writeFileSync(poem, 'roses');
    const t = artifactTracker({ startedAt: Date.now() - 1000, cwd: dir });
    expect(t.take(`File created successfully at: ${poem}`, false)).toEqual([]);
    expect(t.take(`Your poem is saved at ${poem}.`, true)).toHaveLength(1);
  });
});
