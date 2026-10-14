/**
 * `dex-workflow` (dex-tools/dex-workflow): each verb reaches DEX's control
 * server as JSON the workflow store accepts — names with quotes, a spec on
 * stdin — run through the real bash script.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseWorkflowInput } from '../../../src/shared/workflows';

const SCRIPT = path.resolve(__dirname, '../../../src/main/hl/stock/dex-tools/dex-workflow');
/** Git for Windows' bash (not WSL's), or the system's elsewhere. */
function findBash(): string | undefined {
  if (process.env.DEX_BASH && fs.existsSync(process.env.DEX_BASH)) return process.env.DEX_BASH;
  if (process.platform !== 'win32') return ['/bin/bash', '/usr/bin/bash'].find((p) => fs.existsSync(p));
  const found = spawnSync('where', ['bash'], { encoding: 'utf-8' }).stdout?.split(/\r?\n/).map((l) => l.trim()) ?? [];
  return [...found, 'C:\\Program Files\\Git\\bin\\bash.exe'].find((p) => /\\Git\\/i.test(p) && fs.existsSync(p));
}
const BASH = findBash();

describe.runIf(Boolean(BASH))('dex-workflow', () => {
  let server: http.Server;
  let control: string;
  const bodies: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        bodies.push({ path: req.url, ...JSON.parse(raw) });
        res.setHeader('content-type', 'application/json');
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-wf-cli-'));
    control = path.join(dir, 'control.json');
    fs.writeFileSync(control, JSON.stringify({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token: 't' }));
  });
  afterAll(() => { server.close(); });

  const run = async (args: string[], stdin?: string, expectStatus = 0) => {
    const child = spawn(BASH!, [SCRIPT, ...args], { env: { ...process.env, DEX_CONTROL_FILE: control, DEX_SESSION_ID: 's-1' } });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdin.end(stdin ?? '');
    const status = await new Promise<number | null>((r) => child.on('close', r));
    expect(status, stderr).toBe(expectStatus);
    return expectStatus === 0 ? bodies.pop()! : null;
  };

  it('creates from a spec on stdin, which the store accepts', async () => {
    const spec = { name: 'Morning “routine”', schedule: { every: 'weekdays', at: '7:30 am' }, steps: ['Check the weather — Hyderabad', { kind: 'notify', title: 'Send me a summary' }] };
    const body = await run(['create'], JSON.stringify(spec, null, 2));
    expect(body).toMatchObject({ path: '/dex/workflow', op: 'create', sessionId: 's-1' });
    expect(parseWorkflowInput(body!.spec).error).toBeNull();
  });

  it('names a workflow by its name, quotes and all', async () => {
    expect(await run(['run', 'Mom’s "Friday" review'])).toMatchObject({ op: 'run', ref: 'Mom’s "Friday" review' });
    expect(await run(['show'])).toMatchObject({ op: 'show', ref: '' });
    expect(await run(['update', 'Morning routine'], '{"trigger": {"kind": "daily", "time": "08:00"}}')).toMatchObject({ op: 'update', ref: 'Morning routine', spec: { trigger: { kind: 'daily', time: '08:00' } } });
  });

  it('refuses a verb that needs a name without one, before calling DEX', async () => {
    await run(['delete'], undefined, 2);
    await run(['create'], '   ', 2);
  });
});
