/**
 * mcp-servers/remote: the bridge from an engine's stdio to a hosted MCP
 * server, run for real against a local server that speaks both transports.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

const PROXY = path.resolve(__dirname, '../../../mcp-servers/remote/server.mjs');

interface Seen { method: string; auth?: string; session?: string }

/** A tiny MCP server: Streamable HTTP at /mcp (SSE answers for tools/call), legacy SSE at /sse. */
function fakeServer(opts: { requireToken?: string } = {}) {
  const seen: Seen[] = [];
  const legacyStreams: http.ServerResponse[] = [];
  const answer = (msg: { id?: number; method?: string }) => {
    if (msg.method === 'initialize') return { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'fake' }, capabilities: {} } };
    if (msg.method === 'tools/list') return { jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } };
    return { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'hi' }] } };
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (opts.requireToken && req.headers.authorization !== `Bearer ${opts.requireToken}`) { res.writeHead(401).end(); return; }
      if (req.url === '/sse' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('event: endpoint\ndata: /messages?s=1\n\n');
        legacyStreams.push(res);
        return;
      }
      if (req.url?.startsWith('/messages') && req.method === 'POST') {
        const msg = JSON.parse(body);
        seen.push({ method: msg.method });
        res.writeHead(202).end();
        if (msg.id !== undefined) for (const s of legacyStreams) s.write(`event: message\ndata: ${JSON.stringify(answer(msg))}\n\n`);
        return;
      }
      if (req.url === '/mcp' && req.method === 'POST') {
        const msg = JSON.parse(body);
        seen.push({ method: msg.method, auth: req.headers.authorization, session: req.headers['mcp-session-id'] as string | undefined });
        if (msg.id === undefined) { res.writeHead(202).end(); return; }
        if (msg.method === 'tools/call') {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.end(`event: message\ndata: ${JSON.stringify(answer(msg))}\n\n`);
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json', ...(msg.method === 'initialize' ? { 'mcp-session-id': 'S-1' } : {}) });
        res.end(JSON.stringify(answer(msg)));
        return;
      }
      if (req.method === 'DELETE') { res.writeHead(200).end(); return; }
      res.writeHead(404).end();
    });
  });
  return { server, seen, close: () => { for (const s of legacyStreams) s.end(); server.close(); } };
}

let proxy: ChildProcess | null = null;
let stop: (() => void) | null = null;
afterEach(() => { proxy?.kill(); proxy = null; stop?.(); stop = null; });

async function start(url: string, env: Record<string, string> = {}) {
  proxy = spawn(process.execPath, [PROXY], { env: { ...process.env, DEX_REMOTE_URL: url, DEX_REMOTE_ID: 'remote_test', ...env } });
  const waiters = new Map<number, (m: { result?: unknown; error?: { message: string } }) => void>();
  createInterface({ input: proxy.stdout! }).on('line', (l) => { const m = JSON.parse(l); waiters.get(m.id)?.(m); });
  let id = 0;
  const call = (method: string, params: object = {}) => new Promise<{ result?: any; error?: { message: string } }>((resolve) => {
    const i = ++id;
    waiters.set(i, resolve);
    proxy!.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id: i, method, params })}\n`);
  });
  const notify = (method: string) => proxy!.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  return { call, notify };
}

async function listen(s: http.Server): Promise<number> {
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  return (s.address() as AddressInfo).port;
}

describe('the hosted-connector bridge', () => {
  it('speaks Streamable HTTP: the token and session ride along, and SSE answers come through', async () => {
    const fake = fakeServer({ requireToken: 'T0K' });
    stop = fake.close;
    const port = await listen(fake.server);
    const { call, notify } = await start(`http://127.0.0.1:${port}/mcp`, { DEX_REMOTE_TOKEN: 'T0K' });

    expect((await call('initialize', { protocolVersion: '2025-06-18' })).result.serverInfo.name).toBe('fake');
    notify('notifications/initialized');
    expect((await call('tools/list')).result.tools[0].name).toBe('echo');
    expect((await call('tools/call', { name: 'echo', arguments: {} })).result.content[0].text).toBe('hi');

    const later = fake.seen.filter((s) => s.method !== 'initialize');
    expect(later.every((s) => s.session === 'S-1')).toBe(true);
    expect(fake.seen.every((s) => s.auth === 'Bearer T0K')).toBe(true);
  });

  it('speaks the older SSE transport for a /sse endpoint', async () => {
    const fake = fakeServer();
    stop = fake.close;
    const port = await listen(fake.server);
    const { call } = await start(`http://127.0.0.1:${port}/sse`);
    expect((await call('initialize', { protocolVersion: '2025-06-18' })).result.serverInfo.name).toBe('fake');
    expect((await call('tools/list')).result.tools[0].name).toBe('echo');
    expect(fake.seen.map((s) => s.method)).toEqual(['initialize', 'tools/list']);
  });

  it('answers with a clear error when the sign-in has expired and DEX can’t renew it', async () => {
    const fake = fakeServer({ requireToken: 'GOOD' });
    stop = fake.close;
    const port = await listen(fake.server);
    const { call } = await start(`http://127.0.0.1:${port}/mcp`, { DEX_REMOTE_TOKEN: 'STALE', DEX_CONTROL_FILE: '' });
    const r = await call('initialize', { protocolVersion: '2025-06-18' });
    expect(r.error?.message).toMatch(/expired.*Reconnect/);
  });
});
