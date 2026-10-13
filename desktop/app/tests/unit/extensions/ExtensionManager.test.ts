import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ExtensionManager, compareVersions, crxUrl, extensionIdFrom, parseUpdateResponse, updateCheckUrl, type ExtensionsApi,
} from '../../../src/main/extensions/ExtensionManager';
import { buildCrx } from './crxFixture';

function fakeElectron(): ExtensionsApi & { loaded: Map<string, string> } {
  const loaded = new Map<string, string>();
  return {
    loaded,
    loadExtension: vi.fn(async (dir: string) => {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { name: string; version: string; key?: string };
      const id = manifest.key ? idFor(manifest.key) : 'p'.repeat(32);
      loaded.set(id, dir);
      return { id, name: manifest.name, version: manifest.version, manifest };
    }),
    removeExtension: vi.fn((id: string) => { loaded.delete(id); }),
    getExtension: (id: string) => (loaded.has(id) ? { id, path: loaded.get(id)!, manifest: {} } : null),
  };
}

// The id a fixture key gives (crx.ts derives it the same way).
let idFor: (key: string) => string = () => '';

describe('ExtensionManager', () => {
  let dir: string;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-extmgr-'));
    const { idFromPublicKey } = await import('../../../src/main/extensions/crx');
    idFor = (key) => idFromPublicKey(Buffer.from(key, 'base64'));
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  function make(packages: Record<string, Buffer>, confirm = true) {
    const electron = fakeElectron();
    const manager = new ExtensionManager({
      dir,
      extensions: electron,
      fetchBytes: async (url) => {
        const id = Object.keys(packages).find((k) => url.includes(k));
        if (!id) throw new Error('404');
        return packages[id];
      },
      fetchText: async () => '',
      chromeVersion: '146.0.0.0',
      confirmInstall: vi.fn(async () => confirm),
      clearData: vi.fn(async () => undefined),
      allowUnsignedForTests: true,
    });
    return { manager, electron };
  }

  it('installs from the store after you agree, loads it, and remembers it', async () => {
    const built = buildCrx({ 'manifest.json': JSON.stringify({ manifest_version: 3, name: 'Dark', version: '4.9.1', icons: { 48: 'i.png' } }) });
    const { manager, electron } = make({ [built.id]: built.crx });
    expect(await manager.installFromStore(built.id)).toBe('success');
    expect(electron.loaded.has(built.id)).toBe(true);
    const [summary] = manager.list();
    expect(summary).toMatchObject({ id: built.id, name: 'Dark', version: '4.9.1', enabled: true, source: 'store' });
    expect(fs.existsSync(path.join(dir, built.id, '4.9.1_0', 'manifest.json'))).toBe(true);

    // A restart loads it again.
    const again = make({});
    await again.manager.start();
    expect(again.electron.loaded.has(built.id)).toBe(true);
  });

  it('leaves nothing behind when you decline', async () => {
    const built = buildCrx({ 'manifest.json': JSON.stringify({ manifest_version: 3, name: 'X', version: '1.0' }) });
    const { manager, electron } = make({ [built.id]: built.crx }, false);
    expect(await manager.installFromStore(built.id)).toBe('user_cancelled');
    expect(electron.loaded.size).toBe(0);
    expect(manager.list()).toEqual([]);
    expect(fs.readdirSync(path.join(dir, built.id))).toEqual([]);
  });

  it("refuses a package that isn't the extension it claims to be", async () => {
    const built = buildCrx({ 'manifest.json': JSON.stringify({ manifest_version: 3, name: 'X', version: '1.0' }) });
    const other = 'a'.repeat(32);
    const { manager } = make({ [other]: built.crx });
    await expect(manager.installFromStore(other)).rejects.toThrow(/different extension/);
    expect(manager.list()).toEqual([]);
  });

  it('turns off, back on, pins and removes, deleting its files and data', async () => {
    const built = buildCrx({ 'manifest.json': JSON.stringify({ manifest_version: 3, name: 'X', version: '1.0' }) });
    const { manager, electron } = make({ [built.id]: built.crx });
    await manager.installFromStore(built.id);
    await manager.setEnabled(built.id, false);
    expect(electron.loaded.has(built.id)).toBe(false);
    expect(manager.summary(built.id)?.enabled).toBe(false);
    await manager.setEnabled(built.id, true);
    expect(electron.loaded.has(built.id)).toBe(true);
    manager.setPinned(built.id, true);
    expect(manager.summary(built.id)?.pinned).toBe(true);
    await manager.uninstall(built.id);
    expect(manager.list()).toEqual([]);
    expect(fs.existsSync(path.join(dir, built.id))).toBe(false);
  });

  it('remembers optional permissions you granted, and forgets them on request', async () => {
    const built = buildCrx({ 'manifest.json': JSON.stringify({ manifest_version: 3, name: 'X', version: '1.0' }) });
    const { manager } = make({ [built.id]: built.crx });
    await manager.installFromStore(built.id);
    manager.grant(built.id, ['tabs'], ['https://a.example/*']);
    expect(manager.granted(built.id)).toEqual({ permissions: ['tabs'], origins: ['https://a.example/*'] });
    manager.revoke(built.id, ['tabs'], []);
    expect(manager.granted(built.id).permissions).toEqual([]);
  });

  it('updates to a newer store version and drops the old files', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const v1 = buildCrx({ 'manifest.json': JSON.stringify({ manifest_version: 3, name: 'X', version: '1.0' }) }, { key: privateKey });
    const v2 = buildCrx({ 'manifest.json': JSON.stringify({ manifest_version: 3, name: 'X', version: '1.1' }) }, { key: privateKey });
    expect(v2.id).toBe(v1.id);
    const electron = fakeElectron();
    const manager = new ExtensionManager({
      dir,
      extensions: electron,
      fetchBytes: async (url) => (url.includes('v2.crx') ? v2.crx : v1.crx),
      fetchText: async () => `<gupdate><app appid="${v1.id}" status="ok"><updatecheck codebase="https://example.test/v2.crx" version="1.1" status="ok"/></app></gupdate>`,
      chromeVersion: '146',
      confirmInstall: async () => true,
      clearData: async () => undefined,
      allowUnsignedForTests: true,
    });
    await manager.installFromStore(v1.id);
    expect(await manager.checkForUpdates()).toEqual([v1.id]);
    expect(manager.summary(v1.id)?.version).toBe('1.1');
    expect(fs.existsSync(path.join(dir, v1.id, '1.0_0'))).toBe(false);
    expect(fs.existsSync(path.join(dir, v1.id, '1.1_0', 'manifest.json'))).toBe(true);
    expect(electron.loaded.get(v1.id)).toBe(path.join(dir, v1.id, '1.1_0'));
    // Nothing newer: nothing changes.
    expect(await manager.checkForUpdates()).toEqual([]);
  });

  it('marks an extension whose files went missing instead of failing to start', async () => {
    const built = buildCrx({ 'manifest.json': JSON.stringify({ manifest_version: 3, name: 'X', version: '1.0' }) });
    const { manager } = make({ [built.id]: built.crx });
    await manager.installFromStore(built.id);
    fs.rmSync(path.join(dir, built.id), { recursive: true, force: true });
    const again = make({});
    await again.manager.start();
    expect(again.manager.list()[0]?.error).toMatch(/files are missing/);
  });
});

describe('store links and update checks', () => {
  it('finds the id in a pasted store link, or takes a bare id', () => {
    expect(extensionIdFrom('https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh')).toBe('eimadpbcbfnmbkopoojfekhnkhdbieeh');
    expect(extensionIdFrom('https://chromewebstore.google.com/detail/eimadpbcbfnmbkopoojfekhnkhdbieeh?hl=en')).toBe('eimadpbcbfnmbkopoojfekhnkhdbieeh');
    expect(extensionIdFrom('  eimadpbcbfnmbkopoojfekhnkhdbieeh ')).toBe('eimadpbcbfnmbkopoojfekhnkhdbieeh');
    expect(extensionIdFrom('https://evil.example/eimadpbcbfnmbkopoojfekhnkhdbieeh')).toBeNull();
    expect(extensionIdFrom('dark reader')).toBeNull();
  });

  it('asks Google for the package and for updates the way Chrome does', () => {
    expect(crxUrl('eimadpbcbfnmbkopoojfekhnkhdbieeh', '146.0.0.0')).toBe(
      'https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx3&prodversion=146.0.0.0&x=id%3Deimadpbcbfnmbkopoojfekhnkhdbieeh%26uc%3D',
    );
    expect(updateCheckUrl([{ id: 'a'.repeat(32), version: '1.0' }], '146')).toContain('response=updatecheck');
  });

  it("reads Google's update answer: only real updates, only https", () => {
    const xml = `<?xml version="1.0"?><gupdate protocol="2.0">
      <app appid="${'a'.repeat(32)}" status="ok"><updatecheck codebase="https://clients2.googleusercontent.com/crx/a.crx" version="2.0" status="ok"/></app>
      <app appid="${'b'.repeat(32)}" status="ok"><updatecheck status="noupdate"/></app>
      <app appid="${'c'.repeat(32)}" status="ok"><updatecheck codebase="http://insecure/c.crx" version="3.0" status="ok"/></app>
    </gupdate>`;
    expect(parseUpdateResponse(xml)).toEqual([{ id: 'a'.repeat(32), version: '2.0', codebase: 'https://clients2.googleusercontent.com/crx/a.crx' }]);
  });

  it('compares versions number by number', () => {
    expect(compareVersions('4.10', '4.9')).toBe(1);
    expect(compareVersions('1.0.0', '1')).toBe(0);
    expect(compareVersions('2026.1012.1545', '2026.1101.0')).toBe(-1);
  });
});
