import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAgentPath } from '../../../src/main/hl/agentPaths';

const win = process.platform === 'win32';
const harness = win ? 'C:\\Users\\me\\AppData\\Roaming\\DEX\\harness' : '/home/me/.config/DEX/harness';

describe.runIf(win)('resolveAgentPath (Windows)', () => {
  it('turns Git Bash drive paths into Windows paths', () => {
    expect(resolveAgentPath('/c/Users/me/out/render.png', harness)).toBe('C:\\Users\\me\\out\\render.png');
    expect(resolveAgentPath('/d', harness)).toBe('D:\\');
  });
  it('maps Git Bash /tmp to the Windows temp folder', () => {
    expect(resolveAgentPath('/tmp/mh/prev1.png', harness)).toBe(path.win32.join(os.tmpdir(), 'mh', 'prev1.png'));
  });
  it('resolves relative paths against the agent’s working directory', () => {
    expect(resolveAgentPath('outputs\\s1\\house.glb', harness)).toBe(`${harness}\\outputs\\s1\\house.glb`);
    expect(resolveAgentPath('./outputs/s1/house.glb', harness)).toBe(`${harness}\\outputs\\s1\\house.glb`);
  });
  it('leaves Windows paths alone (bar quotes)', () => {
    expect(resolveAgentPath('"C:\\Users\\me\\a b.png"', harness)).toBe('C:\\Users\\me\\a b.png');
  });
});

describe.runIf(!win)('resolveAgentPath (POSIX)', () => {
  it('resolves relative paths against the agent’s working directory', () => {
    expect(resolveAgentPath('outputs/s1/house.glb', harness)).toBe(`${harness}/outputs/s1/house.glb`);
  });
});
