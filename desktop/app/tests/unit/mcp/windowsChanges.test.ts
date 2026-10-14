/**
 * PC changes through the Windows server (docs/desktop-control/PLAN.md §4.2):
 * the allowlist, how each is approved, and the elevated helper's door —
 * only DEX's secret, only admin changes.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ACTIONS, categoryOf } from '../../../mcp-servers/windows/actions.mjs';
import { classify } from '../../../mcp-servers/windows/policy.mjs';

describe('the changes DEX may make', () => {
  it('checks every change’s details before anything runs', () => {
    expect(ACTIONS.gesture_set.check({ key: 'ThreeFingerSlideEnabled', value: 1 })).toBe(true);
    expect(ACTIONS.gesture_set.check({ key: 'Run', value: 1 })).toBe(false);
    expect(ACTIONS.gesture_set.check({ key: 'ThreeFingerSlideEnabled', value: '1; rm -rf' })).toBe(false);
    expect(ACTIONS.dns_set.check({ adapter: 'Wi-Fi', servers: ['1.1.1.1', '8.8.8.8'] })).toBe(true);
    expect(ACTIONS.dns_set.check({ adapter: 'Wi-Fi', servers: ['1.1.1.1; calc'] })).toBe(false);
    expect(ACTIONS.dns_set.check({ adapter: 'Wi-Fi"; calc', servers: 'dhcp' })).toBe(false);
    expect(ACTIONS.service_restart.check({ name: 'WlanSvc' })).toBe(true);
    expect(ACTIONS.service_restart.check({ name: 'a b' })).toBe(false);
    expect(ACTIONS.app_uninstall.check({ wingetId: 'Spotify.Spotify' })).toBe(true);
    expect(ACTIONS.app_uninstall.check({ wingetId: '--all' })).toBe(false);
  });

  it('asks per category: reversible, hard to undo, or admin', () => {
    expect(categoryOf('gesture_set')).toBe('system-change');
    expect(categoryOf('app_uninstall')).toBe('system-destructive');
    expect(categoryOf('dns_set')).toBe('elevation');
    expect(categoryOf('rm_rf')).toBeNull();
    expect(classify('system_change', { action: 'gesture_set', args: { key: 'ThreeFingerSlideEnabled', value: 1 }, reason: 'swipes do nothing' }))
      .toMatchObject({ tier: 2, category: 'system-change', title: 'Set touchpad ThreeFingerSlideEnabled to 1', detail: 'swipes do nothing' });
    expect(classify('system_change', { action: 'format_c', args: {} }).refused).toMatch(/isn't a change DEX makes/);
    expect(classify('system_change', { action: 'dns_set', args: { adapter: 'Wi-Fi' } }).refused).toMatch(/don't fit/);
  });

  it('switches only a startup app by its name, never a path', () => {
    expect(ACTIONS.startup_disable.check({ name: 'Steam' })).toBe(true);
    expect(ACTIONS.startup_enable.check({ name: 'Mathworks Service Host' })).toBe(true);
    expect(ACTIONS.startup_disable.check({ name: 'Spotify.lnk' })).toBe(true);
    expect(ACTIONS.startup_disable.check({ name: '..\\..\\Windows\\explorer.exe' })).toBe(false);
    expect(ACTIONS.startup_disable.check({ name: 'C:/evil' })).toBe(false);
    expect(ACTIONS.startup_disable.check({ name: '' })).toBe(false);
    expect(ACTIONS.startup_disable.check({})).toBe(false);
    expect(categoryOf('startup_disable')).toBe('system-change');
  });

  it('resets only a Store package named exactly, and asks every time', () => {
    expect(ACTIONS.app_reset.check({ package: '5319275A.WhatsAppDesktop' })).toBe(true);
    expect(ACTIONS.app_reset.check({ package: '5319275A.WhatsAppDesktop_cv1g1gvanyjgm' })).toBe(true);
    expect(ACTIONS.app_reset.check({ package: '*' })).toBe(false);
    expect(ACTIONS.app_reset.check({ package: 'WhatsApp; Remove-Item C:\\' })).toBe(false);
    // Hard to undo (the user signs in again): one approval per reset, never remembered.
    expect(categoryOf('app_reset')).toBe('system-destructive');
  });

  it('runs the device scan and the search rebuild through the admin helper', () => {
    expect(categoryOf('device_scan')).toBe('elevation');
    expect(categoryOf('search_reindex')).toBe('elevation');
    expect(categoryOf('explorer_cache_clear')).toBe('system-change');
    expect(classify('system_change', { action: 'search_reindex', args: {}, reason: 'search misses files' }))
      .toMatchObject({ tier: 2, category: 'elevation', admin: true });
  });

  it('lists every admin change in the helper too, and nothing else', () => {
    // The elevated helper refuses anything outside its own list, so the two must agree.
    const ps1 = fs.readFileSync(path.resolve(__dirname, '../../../mcp-servers/windows/host/host.ps1'), 'utf-8');
    const listed = [...(ps1.match(/\$script:AdminActions = @\(([^)]*)\)/)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    const admin = Object.entries(ACTIONS).filter(([, a]) => a.admin).map(([name]) => name).sort();
    expect(listed).toEqual(admin);
  });

  it('keeps the host script ASCII outside comments, which Windows PowerShell reads as ANSI', () => {
    const ps1 = fs.readFileSync(path.resolve(__dirname, '../../../mcp-servers/windows/host/host.ps1'), 'utf-8');
    // Split on CRLF too: a Windows checkout has it, and `.` stops at a stray \r.
    const bad = ps1.split(/\r?\n/).map((line, i) => [i + 1, line.replace(/^\s*#.*$/, '')] as const).filter(([, code]) => /[^\x00-\x7F]/.test(code));
    expect(bad.map(([n]) => n)).toEqual([]);
  });
});

let helper: ChildProcess | null = null;
afterEach(() => { helper?.kill(); helper = null; });

function ask(port: number, message: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: '127.0.0.1', port }, () => sock.write(`${JSON.stringify(message)}\n`));
    let buf = '';
    sock.on('data', (d) => { buf += d; });
    sock.on('end', () => resolve(JSON.parse(buf)));
    sock.on('error', reject);
  });
}

describe.runIf(process.platform === 'win32')('the elevated helper’s door', () => {
  it('answers only DEX’s secret, and only for admin changes', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-elev-'));
    fs.writeFileSync(path.join(home, 'elevated.secret'), 'S3CRET');
    helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.resolve(__dirname, '../../../mcp-servers/windows/host/host.ps1'), '-Elevated', '-DeskHome', home], { windowsHide: true });
    const portFile = path.join(home, 'elevated.port');
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i += 1) await new Promise((r) => setTimeout(r, 100));
    const port = Number(fs.readFileSync(portFile, 'utf-8').trim());
    expect(port).toBeGreaterThan(0);

    expect(await ask(port, { secret: 'guess', action: 'dns_flush' })).toMatchObject({ ok: false, error: 'denied' });
    expect(await ask(port, { secret: 'S3CRET', action: 'gesture_set', args: { key: 'X', value: 1 } })).toMatchObject({ ok: false, error: 'refused' });
    expect(await ask(port, { secret: 'S3CRET', action: 'Invoke-Expression' })).toMatchObject({ ok: false, error: 'refused' });
  }, 30_000);
});
