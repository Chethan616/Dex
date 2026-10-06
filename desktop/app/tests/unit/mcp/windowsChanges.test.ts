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
