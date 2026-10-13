import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCrx, safeEntryPath, unpackCrx, verifyCrx, isExtensionId } from '../../../src/main/extensions/crx';
import { buildCrx } from './crxFixture';

const MANIFEST = JSON.stringify({ manifest_version: 3, name: 'Fixture', version: '1.2.3' });

describe('CRX3', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-crx-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('reads the extension id from the package and checks every signature', () => {
    const built = buildCrx({ 'manifest.json': MANIFEST, 'bg.js': 'console.log(1)' });
    const crx = parseCrx(built.crx);
    expect(crx.id).toBe(built.id);
    expect(isExtensionId(crx.id)).toBe(true);
    expect(() => verifyCrx(crx, { expectedId: built.id, requireWebStore: false })).not.toThrow();
  });

  it('refuses a package with one byte changed', () => {
    const built = buildCrx({ 'manifest.json': MANIFEST });
    const bad = Buffer.from(built.crx);
    bad[bad.length - 30] ^= 0xff;
    expect(() => verifyCrx(parseCrx(bad), { requireWebStore: false })).toThrow(/bad signature/);
  });

  it("refuses a package for another extension than the one asked for", () => {
    const built = buildCrx({ 'manifest.json': MANIFEST });
    expect(() => verifyCrx(parseCrx(built.crx), { expectedId: 'a'.repeat(32), requireWebStore: false })).toThrow(/different extension/);
  });

  it("refuses a store install the Chrome Web Store didn't sign", () => {
    const built = buildCrx({ 'manifest.json': MANIFEST });
    expect(() => verifyCrx(parseCrx(built.crx), { requireWebStore: true })).toThrow(/Chrome Web Store/);
  });

  it("refuses anything that isn't a CRX3", () => {
    expect(() => parseCrx(Buffer.from('PK\x03\x04 not a crx'))).toThrow();
    const v2 = Buffer.from(buildCrx({ 'manifest.json': MANIFEST }).crx);
    v2.writeUInt32LE(2, 4);
    expect(() => parseCrx(v2)).toThrow(/CRX3/);
  });

  it('unpacks and stamps the developer key so Electron keeps the store id', () => {
    const built = buildCrx({ 'manifest.json': MANIFEST, 'js/app.js': 'x' });
    const crx = parseCrx(built.crx);
    const manifest = unpackCrx(crx, path.join(dir, 'out'));
    expect(manifest.key).toBe(built.publicKey.toString('base64'));
    expect(fs.readFileSync(path.join(dir, 'out', 'js', 'app.js'), 'utf8')).toBe('x');
  });

  it('refuses zip paths that climb out of the folder', () => {
    const root = path.join(dir, 'x');
    expect(safeEntryPath(root, '../evil.js')).toBeNull();
    expect(safeEntryPath(root, 'a/../../evil.js')).toBeNull();
    expect(safeEntryPath(root, 'C:/Windows/evil.js')).toBeNull();
    expect(safeEntryPath(root, '/etc/passwd')).toBeNull();
    expect(safeEntryPath(root, 'ok/fine.js')).toBe(path.join(root, 'ok', 'fine.js'));
  });
});
