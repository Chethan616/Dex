#!/usr/bin/env node
/**
 * DEX's bridge to a hosted MCP server (a Marketplace connector): the engine
 * talks MCP over stdio here, exactly as with the built-in servers, and this
 * forwards each message to the service over HTTP with the user's token.
 *
 * Both of MCP's HTTP transports:
 *   - Streamable HTTP (the current one): POST each message; the answer comes
 *     back as JSON or as an SSE stream; the server's Mcp-Session-Id rides on
 *     every later request.
 *   - the older HTTP+SSE (a URL ending in /sse): one GET event stream whose
 *     first "endpoint" event says where to POST; answers arrive on the stream.
 *
 * A token that expires mid-task is renewed through DEX (POST
 * /dex/connector-token), which holds the refresh token — this process never
 * sees it.
 *
 * Env: DEX_REMOTE_URL, DEX_REMOTE_TOKEN (absent for no-sign-in servers),
 * DEX_REMOTE_ID, DEX_CONTROL_FILE. Runs with Electron's Node.
 */
import fs from 'node:fs';
import { createInterface } from 'node:readline';

const URL_ = process.env.DEX_REMOTE_URL;
const ID = process.env.DEX_REMOTE_ID || 'remote';
let token = process.env.DEX_REMOTE_TOKEN || '';
const log = (msg) => process.stderr.write(`dex remote (${ID}): ${msg}\n`);

if (!URL_) {
  log('DEX_REMOTE_URL is missing');
  process.exit(2);
}

const out = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const failRequest = (msg, text) => {
  if (msg && msg.id !== undefined && msg.id !== null) out({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: text } });
};

/** Ask DEX for a renewed token; false when it can't (the user signs in again). */
async function renewToken() {
  try {
    const { url, token: bearer } = JSON.parse(fs.readFileSync(process.env.DEX_CONTROL_FILE || '', 'utf-8'));
    const res = await fetch(`${url}/dex/connector-token`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: ID }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.token) { token = body.token; return true; }
  } catch { /* DEX not reachable */ }
  return false;
}

function headers(extra = {}) {
  return { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra };
}

/** Each SSE event's data as parsed JSON, as they arrive. */
async function* sseEvents(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  let event = 'message';
  let data = [];
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (line === '') {
        if (data.length) yield { event, data: data.join('\n') };
        event = 'message';
        data = [];
      } else if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (data.length) yield { event, data: data.join('\n') };
}

function emitJson(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return; }
  for (const m of Array.isArray(parsed) ? parsed : [parsed]) out(m);
}

/* ── Streamable HTTP ──────────────────────────────────────────────────── */

let sessionId = null;
let protocolVersion = null;

async function postStreamable(msg, retried = false) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: headers({
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      ...(protocolVersion ? { 'mcp-protocol-version': protocolVersion } : {}),
    }),
    body: JSON.stringify(msg),
  });
  if (res.status === 401 && !retried && (await renewToken())) return postStreamable(msg, true);
  if (res.status === 401) return failRequest(msg, 'The sign-in for this connector has expired. Reconnect it in DEX → Connectors.');
  if (res.status === 404 && sessionId && msg.method !== 'initialize') {
    // The server dropped our session; the engine will re-initialize.
    sessionId = null;
    return failRequest(msg, 'The connector restarted its session; try again.');
  }
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  if (res.status === 202 || res.status === 204) return;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return failRequest(msg, `The service answered ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`);
  }
  const type = res.headers.get('content-type') || '';
  if (type.includes('text/event-stream')) {
    for await (const e of sseEvents(res.body)) if (e.event === 'message') emitJson(e.data);
  } else {
    const text = await res.text();
    if (msg.method === 'initialize') {
      try { protocolVersion = JSON.parse(text)?.result?.protocolVersion ?? null; } catch { /* keep none */ }
    }
    emitJson(text);
  }
}

/* ── The older HTTP+SSE transport ─────────────────────────────────────── */

let postUrl = null;
let streamReady = null;

function openLegacyStream(retried = false) {
  streamReady = new Promise((resolve, reject) => {
    (async () => {
      const res = await fetch(URL_, { headers: headers({ accept: 'text/event-stream' }) });
      if (res.status === 401 && !retried && (await renewToken())) { openLegacyStream(true).then(resolve, reject); return; }
      if (!res.ok) throw new Error(`The service answered ${res.status} to its event stream.`);
      for await (const e of sseEvents(res.body)) {
        if (e.event === 'endpoint') { postUrl = new URL(e.data.trim(), URL_).toString(); resolve(); }
        else if (e.event === 'message') emitJson(e.data);
      }
      log('event stream closed');
      postUrl = null;
      streamReady = null;
    })().catch(reject);
  });
  return streamReady;
}

async function postLegacy(msg, retried = false) {
  if (!streamReady) openLegacyStream();
  await streamReady;
  const res = await fetch(postUrl, {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify(msg),
  });
  if (res.status === 401 && !retried && (await renewToken())) return postLegacy(msg, true);
  if (!res.ok && res.status !== 202) failRequest(msg, `The service answered ${res.status}.`);
}

/* ── stdio ────────────────────────────────────────────────────────────── */

const legacy = /\/sse\/?$/.test(new URL(URL_).pathname);
const send = legacy ? postLegacy : postStreamable;

// The first message (initialize) goes alone, so the session id it creates
// is on every message after it; the rest may run side by side.
let initialized = null;
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); } catch { return; }
  const run = async () => {
    try { await send(msg); } catch (err) {
      log(`${msg.method ?? 'message'} failed: ${err.message}`);
      failRequest(msg, `Couldn’t reach the service: ${err.message}`);
    }
  };
  if (msg.method === 'initialize') { initialized = run(); return; }
  void (initialized ?? Promise.resolve()).then(run);
});
rl.on('close', async () => {
  if (sessionId && !legacy) {
    try { await fetch(URL_, { method: 'DELETE', headers: headers({ 'mcp-session-id': sessionId }), signal: AbortSignal.timeout(3000) }); } catch { /* best effort */ }
  }
  process.exit(0);
});
