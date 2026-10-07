/**
 * `dex-ui` (dex-tools/dex-ui): every form of the command reaches DEX's
 * control server as JSON that the widget kit accepts — quotes, ₹ signs and
 * newlines included — run through the real bash script.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseWidget } from '../../../src/shared/widgets';

const SCRIPT = path.resolve(__dirname, '../../../src/main/hl/stock/dex-tools/dex-ui');
/** Git for Windows' bash (not WSL's), or the system's elsewhere. */
function findBash(): string | undefined {
  if (process.env.DEX_BASH && fs.existsSync(process.env.DEX_BASH)) return process.env.DEX_BASH;
  if (process.platform !== 'win32') return ['/bin/bash', '/usr/bin/bash'].find((p) => fs.existsSync(p));
  const found = spawnSync('where', ['bash'], { encoding: 'utf-8' }).stdout?.split(/\r?\n/).map((l) => l.trim()) ?? [];
  return [...found, 'C:\\Program Files\\Git\\bin\\bash.exe'].find((p) => /\\Git\\/i.test(p) && fs.existsSync(p));
}
const BASH = findBash();

describe.runIf(Boolean(BASH))('dex-ui', () => {
  let server: http.Server;
  let control: string;
  const bodies: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        bodies.push(JSON.parse(raw));
        res.setHeader('content-type', 'application/json');
        res.end('{"ok":true,"id":"w1"}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-ui-'));
    control = path.join(dir, 'control.json');
    fs.writeFileSync(control, JSON.stringify({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token: 't' }));
  });
  afterAll(() => { server.close(); });

  // Async: the stand-in server lives in this process, and spawnSync would block it.
  const run = async (args: string[], stdin?: string) => {
    const child = spawn(BASH!, [SCRIPT, ...args], { env: { ...process.env, DEX_CONTROL_FILE: control, DEX_SESSION_ID: 's-1' } });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdin.end(stdin ?? '');
    const status = await new Promise<number | null>((r) => child.on('close', r));
    expect(status, stderr).toBe(0);
    const body = bodies.pop()!;
    const widget = body.widget && typeof body.widget === 'object' && !('type' in body.widget) ? { ...body.widget, type: body.type } : body.widget;
    return { body, parsed: parseWidget(widget) };
  };

  it('asks a choice in one line, quotes and all', async () => {
    const { body, parsed } = await run(['choose', 'Which "cabin"?', 'Economy', 'Business — ₹12,000']);
    expect(body.sessionId).toBe('s-1');
    expect(parsed.error).toBeNull();
    expect(parsed.widget).toMatchObject({ type: 'ask', title: 'Which "cabin"?', fields: [{ kind: 'choice', options: ['Economy', 'Business — ₹12,000'] }] });
  });

  it('turns label/url pairs into buttons', async () => {
    const { parsed } = await run(['link', 'Open in Google Flights', 'https://www.google.com/travel/flights?q=Flights%20to%20DEL&hl=en', 'Directions', 'geo:17.38,78.48']);
    expect(parsed.widget).toMatchObject({ type: 'buttons', buttons: [{ label: 'Open in Google Flights' }, { label: 'Directions', url: 'geo:17.38,78.48' }] });
  });

  it('takes a full spec from stdin, with the type from the subcommand', async () => {
    const { parsed } = await run(['cards'], JSON.stringify({ title: 'Flights', items: [{ title: 'IndiGo 6E 2345', price: '₹4,850', lines: ['Line one'] }] }, null, 2));
    expect(parsed.widget).toMatchObject({ type: 'cards', items: [{ title: 'IndiGo 6E 2345', price: '₹4,850' }] });
  });
});
