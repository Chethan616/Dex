/**
 * The Windows server (mcp-servers/windows): its policy, and every call's
 * path — resolve the window, refuse what DEX never drives, wait while the
 * user has paused DEX, ask per the approval setting, report a focus incident
 * — against a fake host and a fake DEX control server.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { blockedReason, classify } from '../../../mcp-servers/windows/policy.mjs';

const SERVER = path.resolve(__dirname, '../../../mcp-servers/windows/server.mjs');
const FAKE_HOST = path.resolve(__dirname, 'fixtures/fake-desk-host.mjs');

describe('the Windows policy', () => {
  it('never drives password managers, Windows security, terminals or other agents — not even to read', () => {
    expect(blockedReason({ process: '1Password.exe' })).toMatch(/passwords/);
    expect(blockedReason({ process: 'SecHealthUI.exe' })).toMatch(/security/);
    expect(blockedReason({ process: 'powershell.exe', className: 'ConsoleWindowClass' })).toMatch(/terminal/);
    expect(blockedReason({ process: 'ChatGPT.exe' })).toMatch(/agent/);
    // PowerShell hosting an ordinary window is fine.
    expect(blockedReason({ process: 'powershell.exe', className: 'WindowsForms10.Window' })).toBeNull();
    expect(classify('window_tree', {}, { process: 'KeePassXC.exe' }).refused).toMatch(/KeePassXC/);
  });

  it('reads freely, acts inside apps as app-control, and treats closing your window as destructive', () => {
    const notepad = { process: 'notepad.exe', title: 'notes.txt - Notepad', openedByDex: false };
    expect(classify('window_tree', {}, notepad)).toEqual({ tier: 0 });
    expect(classify('media', { action: 'status' })).toEqual({ tier: 0 });
    expect(classify('ui_invoke', { target: { name: 'Save' } }, notepad)).toMatchObject({ tier: 1, category: 'app-control', title: 'Press “Save” in notepad' });
    expect(classify('media', { action: 'shuffle', value: true })).toMatchObject({ tier: 1, category: 'app-control' });
    expect(classify('window_manage', { action: 'close' }, notepad)).toMatchObject({ tier: 3, category: 'system-destructive' });
    expect(classify('window_manage', { action: 'close' }, { ...notepad, openedByDex: true })).toMatchObject({ tier: 1 });
  });
});

let server: ChildProcess | null = null;
let control: http.Server | null = null;
afterEach(() => { server?.kill(); server = null; control?.close(); control = null; });

/** DEX's control server, faked: the gate, approvals and events it hears. */
async function fakeControl(opts: { hold?: boolean; approve?: boolean } = {}) {
  const heard: Array<{ path: string; body: Record<string, unknown> }> = [];
  control = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      heard.push({ path: req.url ?? '', body });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/dex/desktop-gate') return res.end(JSON.stringify({ hold: opts.hold ?? false, reason: 'paused' }));
      if (req.url === '/dex/confirm') return res.end(JSON.stringify({ approved: opts.approve ?? true }));
      res.end('{}');
    });
  });
  await new Promise<void>((r) => control!.listen(0, '127.0.0.1', () => r()));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-win-'));
  const file = path.join(dir, 'control.json');
  fs.writeFileSync(file, JSON.stringify({ url: `http://127.0.0.1:${(control!.address() as AddressInfo).port}`, token: 't' }));
  return { heard, file, dir };
}

async function start(env: Record<string, string>) {
  server = spawn(process.execPath, [SERVER], {
    env: { ...process.env, NODE_ENV: 'test', DEX_DESK_HOST_CMD: JSON.stringify({ command: process.execPath, args: [FAKE_HOST] }), DEX_SESSION_ID: 's1', ...env },
  });
  const waiters = new Map<number, (m: any) => void>();
  createInterface({ input: server.stdout! }).on('line', (l) => { const m = JSON.parse(l); waiters.get(m.id)?.(m); });
  let id = 0;
  const rpc = (method: string, params: object = {}) => new Promise<any>((r) => { const i = ++id; waiters.set(i, r); server!.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id: i, method, params })}\n`); });
  const tool = async (name: string, args: object) => {
    const r = await rpc('tools/call', { name, arguments: args });
    const text = r.result.content.find((c: { type: string }) => c.type === 'text').text;
    return { r: r.result, body: JSON.parse(text) };
  };
  await rpc('initialize', { protocolVersion: '2025-06-18' });
  return { rpc, tool };
}

describe('the Windows server', () => {
  it('lists its tools, and keeps blocked apps’ titles out of the window list', async () => {
    const c = await fakeControl();
    const { rpc, tool } = await start({ DEX_CONTROL_FILE: c.file, DEX_DESK_HOME: c.dir });
    const tools = (await rpc('tools/list')).result.tools.map((t: { name: string }) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['windows_list', 'window_tree', 'ui_invoke', 'media', 'system_info', 'app_launch']));
    const { body } = await tool('windows_list', {});
    expect(body.windows.find((w: { hwnd: number }) => w.hwnd === 2)).toEqual({ hwnd: 2, process: '1Password.exe', blocked: 'it holds your passwords' });
    expect(body.windows.find((w: { hwnd: number }) => w.hwnd === 1).title).toBe('Untitled - Notepad');
  });

  it('refuses a blocked app before anything reaches it', async () => {
    const c = await fakeControl();
    const { tool } = await start({ DEX_CONTROL_FILE: c.file, DEX_DESK_HOME: c.dir });
    const { r, body } = await tool('ui_invoke', { window: { hwnd: 3 }, target: 'e1' });
    expect(r.isError).toBe(true);
    expect(body.error).toBe('refused');
    expect(c.heard.some((h) => h.path === '/dex/confirm')).toBe(false);
  });

  it('asks per the approval setting, and stops at a no', async () => {
    const c = await fakeControl({ approve: false });
    const { tool } = await start({ DEX_CONTROL_FILE: c.file, DEX_DESK_HOME: c.dir });
    const { body } = await tool('ui_invoke', { window: { hwnd: 1 }, target: { name: 'Save' } });
    expect(body.error).toBe('denied');
    const asked = c.heard.find((h) => h.path === '/dex/confirm')!.body;
    expect(asked).toMatchObject({ sessionId: 's1', category: 'app-control', title: 'Press “Save” in notepad', tier: 1 });
  });

  it('leaves a window alone once the user has taken it', async () => {
    const c = await fakeControl();
    const { tool } = await start({ DEX_CONTROL_FILE: c.file, DEX_DESK_HOME: c.dir });
    const { body } = await tool('ui_invoke', { window: { hwnd: 4 }, target: 'e1' });
    expect(body.error).toBe('held');
  });

  it('reports a focus incident to DEX and tells the agent', async () => {
    const c = await fakeControl();
    const { tool } = await start({ DEX_CONTROL_FILE: c.file, DEX_DESK_HOME: c.dir });
    const { body } = await tool('ui_invoke', { window: { hwnd: 1 }, target: 'e9' });
    expect(body.focus.note).toMatch(/interrupted the user/);
    await new Promise((r) => setTimeout(r, 100));
    expect(c.heard.find((h) => h.path === '/dex/desktop-event')!.body).toMatchObject({ kind: 'focus-incident', sessionId: 's1' });
  });

  it('returns a capture as an image, and puts it in the task’s chat', async () => {
    const c = await fakeControl();
    const { tool } = await start({ DEX_CONTROL_FILE: c.file, DEX_DESK_HOME: c.dir });
    const { r } = await tool('window_capture', { window: { hwnd: 1 } });
    expect(r.content.some((x: { type: string; mimeType?: string }) => x.type === 'image' && x.mimeType === 'image/png')).toBe(true);
    await new Promise((res) => setTimeout(res, 100));
    expect(c.heard.find((h) => h.path === '/dex/screenshot')!.body).toMatchObject({ sessionId: 's1', mode: 'raw' });
  });
});
