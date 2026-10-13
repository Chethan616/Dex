import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { check, decide, decisionKey, describePermission, SitePermissionStore } from '../../../src/main/workspace/sitePermissions';

function memoryStore() {
  const data = new Map<string, 'allow' | 'block'>();
  return {
    get: (o: string, k: string) => data.get(`${o}|${k}`) ?? null,
    set: (o: string, k: string, d: 'allow' | 'block') => { data.set(`${o}|${k}`, d); },
    data,
  };
}

const origin = 'https://meet.example.com';

describe('decide', () => {
  it('lets fullscreen and clipboard writes through without asking', async () => {
    const ask = vi.fn();
    for (const permission of ['fullscreen', 'clipboard-sanitized-write']) {
      expect(await decide({ origin, permission, details: {}, userActive: false }, { store: memoryStore(), ask })).toBe(true);
    }
    expect(ask).not.toHaveBeenCalled();
  });

  it('never grants the camera to a page nobody is looking at', async () => {
    const ask = vi.fn();
    const ok = await decide({ origin, permission: 'media', details: { mediaTypes: ['video'] }, userActive: false }, { store: memoryStore(), ask });
    expect(ok).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks you when you were using the tab, and remembers the answer when you tick the box', async () => {
    const store = memoryStore();
    const ask = vi.fn().mockResolvedValue({ allow: true, remember: true });
    const req = { origin, permission: 'media', details: { mediaTypes: ['audio', 'video'] }, userActive: true };
    expect(await decide(req, { store, ask })).toBe(true);
    expect(ask).toHaveBeenCalledWith('meet.example.com', 'use your camera and microphone');
    // Remembered: no second question, even unattended.
    expect(await decide({ ...req, userActive: false }, { store, ask })).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('asks again next time when you did not tick remember', async () => {
    const ask = vi.fn().mockResolvedValue({ allow: false, remember: false });
    const store = memoryStore();
    const req = { origin, permission: 'geolocation', details: {}, userActive: true };
    expect(await decide(req, { store, ask })).toBe(false);
    expect(await decide(req, { store, ask })).toBe(false);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('shows one question when a page asks twice at once', async () => {
    let answer!: (v: { allow: boolean; remember: boolean }) => void;
    const ask = vi.fn(() => new Promise<{ allow: boolean; remember: boolean }>((r) => { answer = r; }));
    const req = { origin, permission: 'notifications', details: {}, userActive: true };
    const store = memoryStore();
    const a = decide(req, { store, ask });
    const b = decide(req, { store, ask });
    answer({ allow: true, remember: false });
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('refuses permissions DEX never offers, like screen capture or unknown ones', async () => {
    const ask = vi.fn();
    for (const permission of ['display-capture', 'unknown', 'hid']) {
      expect(await decide({ origin, permission, details: {}, userActive: true }, { store: memoryStore(), ask })).toBe(false);
    }
    expect(ask).not.toHaveBeenCalled();
  });

  it('remembers opening another app per scheme: mailto is not steam', async () => {
    const store = memoryStore();
    const ask = vi.fn().mockResolvedValue({ allow: true, remember: true });
    await decide({ origin, permission: 'openExternal', details: { externalURL: 'mailto:a@b.c' }, userActive: true }, { store, ask });
    expect(ask).toHaveBeenLastCalledWith('meet.example.com', 'open your email app');
    expect(await decide({ origin, permission: 'openExternal', details: { externalURL: 'steam://run/1' }, userActive: false }, { store, ask })).toBe(false);
  });

  it('treats a failed question as a no', async () => {
    const ask = vi.fn().mockRejectedValue(new Error('window gone'));
    expect(await decide({ origin, permission: 'geolocation', details: {}, userActive: true }, { store: memoryStore(), ask })).toBe(false);
  });
});

describe('check', () => {
  it('answers yes only for quiet permissions and ones you allowed', () => {
    const store = memoryStore();
    expect(check(origin, 'fullscreen', store)).toBe(true);
    expect(check(origin, 'geolocation', store)).toBe(false);
    store.set(origin, 'geolocation', 'allow');
    expect(check(origin, 'geolocation', store)).toBe(true);
  });

  it('counts a camera-and-mic allow for a camera check', () => {
    const store = memoryStore();
    store.set(origin, decisionKey('media', { mediaTypes: ['video', 'audio'] }), 'allow');
    expect(check(origin, 'media', store, { mediaType: 'video' })).toBe(true);
    expect(check('https://other.example', 'media', store, { mediaType: 'video' })).toBe(false);
  });
});

describe('describePermission', () => {
  it('names camera and mic precisely', () => {
    expect(describePermission('media', { mediaTypes: ['video'] })).toBe('use your camera');
    expect(describePermission('media', { mediaTypes: ['audio'] })).toBe('use your microphone');
  });
});

describe('SitePermissionStore', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-siteperm-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('keeps answers across restarts, and forgets a site on request', () => {
    const file = path.join(dir, 'site-permissions.json');
    const a = new SitePermissionStore(file);
    a.set(origin, 'geolocation', 'allow');
    a.flush();
    const b = new SitePermissionStore(file);
    expect(b.get(origin, 'geolocation')).toBe('allow');
    b.forget(origin);
    b.flush();
    expect(new SitePermissionStore(file).get(origin, 'geolocation')).toBeNull();
  });

  it('never overwrites the file when nothing changed', () => {
    const file = path.join(dir, 'site-permissions.json');
    fs.writeFileSync(file, JSON.stringify({ [origin]: { geolocation: 'block' } }));
    new SitePermissionStore(file).flush();
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ [origin]: { geolocation: 'block' } });
  });
});
