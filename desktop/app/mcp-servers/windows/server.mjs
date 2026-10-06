#!/usr/bin/env node
/**
 * DEX's Windows server: the agent uses Windows apps and reads the PC's state
 * in the BACKGROUND — the user keeps their mouse, keyboard and focus while
 * it works (docs/desktop-control/PLAN.md).
 *
 * MCP over stdio (newline JSON-RPC 2.0), run with Electron's Node like the
 * other built-in servers. The work happens in a PowerShell host
 * (host/host.ps1 + DexDesk.cs) started on the first tool call. Every call:
 * resolve the window → policy (refused apps, tier) → the pause gate → the
 * user's approval setting → the host → report any focus incident.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { TOOLS, TOOL_BY_NAME, toHostOp } from './tools.mjs';
import { blockedReason, classify } from './policy.mjs';
import { Host } from './host.mjs';
import { controlClient } from './control.mjs';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'dex-windows', version: '1.0.0' };
const here = path.dirname(fileURLToPath(import.meta.url));
const home = process.env.DEX_DESK_HOME || path.join(process.env.APPDATA || os.homedir(), 'DEX', 'desktop');
const session = (process.env.DEX_SESSION_ID || 'shared').replace(/[^A-Za-z0-9_-]/g, '_');

const log = (msg) => process.stderr.write(`dex windows: ${msg}\n`);
const control = controlClient(process.env);

/**
 * host.ps1 and DexDesk.cs on real disk: in an installed DEX this folder is
 * inside app.asar, which Electron's Node can read but PowerShell can't.
 */
function hostDir() {
  const files = ['host.ps1', 'DexDesk.cs'];
  const sources = files.map((f) => fs.readFileSync(path.join(here, 'host', f)));
  const hash = crypto.createHash('sha256');
  for (const s of sources) hash.update(s);
  const dir = path.join(home, `host-${hash.digest('hex').slice(0, 12)}`);
  fs.mkdirSync(dir, { recursive: true });
  files.forEach((f, i) => {
    const target = path.join(dir, f);
    let current = null;
    try { current = fs.readFileSync(target); } catch { /* first run */ }
    if (!current || !current.equals(sources[i])) fs.writeFileSync(target, sources[i]);
  });
  return dir;
}

function hostSpec() {
  // Tests run a fake host; only ever under the test runner.
  if (process.env.NODE_ENV === 'test' && process.env.DEX_DESK_HOST_CMD) {
    const { command, args } = JSON.parse(process.env.DEX_DESK_HOST_CMD);
    return { command, args };
  }
  const dir = hostDir();
  return {
    command: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Mta', '-File', path.join(dir, 'host.ps1'),
      '-DeskHome', home, '-DexExe', process.env.DEX_EXE_PATH || ''],
  };
}

let host = null;
function getHost() {
  host ??= new Host({
    ...hostSpec(),
    log,
    onEvent: (e) => {
      if (e.event === 'taken-over') void control.event('taken-over', { window: e.window });
    },
  });
  return host;
}

/* ── Results ──────────────────────────────────────────────────────────── */

function textResult(value, isError = false) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}

function errorResult(code, message, hint, extra) {
  return textResult({ ok: false, error: code, message, ...(hint ? { hint } : {}), ...(extra ? { extra } : {}) }, true);
}

function fromHost(res) {
  if (!res.ok) return errorResult(res.error ?? 'host_error', res.message ?? 'The helper failed.', res.hint, res.extra);
  return null;
}

/* ── The gate: Pause in DEX holds desktop actions ─────────────────────── */

async function waitForGate() {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const g = await control.gate();
    if (!g.hold) return null;
    if (Date.now() > deadline) return g.reason ?? 'paused';
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/* ── tools/call ───────────────────────────────────────────────────────── */

function takesWindow(tool) {
  return Boolean(tool.inputSchema?.properties?.window);
}

export async function callTool(name, args = {}) {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return errorResult('unknown_tool', `Unknown tool: ${name}`);
  const missing = (tool.inputSchema?.required ?? []).filter((k) => args[k] === undefined || args[k] === null || args[k] === '');
  if (missing.length) return errorResult('invalid_args', `${name} needs ${missing.join(', ')}.`);

  const h = getHost();

  // Which window, exactly — and is it one DEX may touch?
  let win = null;
  if (takesWindow(tool) && args.window) {
    const r = await h.call('resolve', { window: args.window });
    const bad = fromHost(r);
    if (bad) return bad;
    win = r.result;
  }
  const verdict = classify(name, args, win);
  if (verdict.refused) return errorResult('refused', verdict.refused, 'Tell the user what you needed instead of working around it.');

  if (verdict.tier >= 1) {
    if (win?.takenOver) return errorResult('held', 'The user took this window to use it themselves.', 'Leave it alone until they hand it back; ask if you need it.');
    const held = await waitForGate();
    if (held) return errorResult('held', 'The user paused DEX, so it isn’t touching their apps right now.', 'Wait for them to resume; don’t retry around it.');
    if (control.reachable()) {
      const approved = await control.confirm({ title: verdict.title, detail: verdict.detail, category: verdict.category, subject: verdict.subject, tier: verdict.tier });
      if (!approved) return errorResult('denied', 'The user said no to that.', 'Don’t try it another way; ask what they’d like instead.');
    } else if (verdict.tier >= 3) {
      return errorResult('denied', "DEX isn't reachable to approve a change like this.", null);
    }
  }

  const { op, args: hostArgs } = toHostOp(name, args);
  let captureFile = null;
  if (op === 'capture') {
    captureFile = path.join(home, 'captures', session, `${Date.now()}.png`);
    hostArgs.path = captureFile;
  }
  const res = await h.call(op, hostArgs);
  const bad = fromHost(res);
  if (bad) return bad;

  const result = res.result ?? {};
  const incident = res.focus?.incident ?? null;
  if (incident) {
    void control.event('focus-incident', { tool: name, incident });
    result.focus = { incident, note: 'You just interrupted the user: something came to the front or the pointer moved. Say sorry in one line and do not repeat that action the same way.' };
  }

  if (name === 'windows_list' && Array.isArray(result.windows)) {
    result.windows = result.windows.map((w) => {
      const why = blockedReason(w);
      return why ? { hwnd: w.hwnd, process: w.process, blocked: why } : w;
    });
  }

  if (captureFile) {
    let data = null;
    try { data = fs.readFileSync(captureFile).toString('base64'); } catch { /* fall through to text */ }
    void control.screenshot(captureFile, `${win?.process?.replace(/\.exe$/i, '') ?? 'Window'}${win?.title ? ` — ${win.title}` : ''}`, args.annotate ? 'uia' : 'raw');
    const content = [{ type: 'text', text: JSON.stringify(result) }];
    if (data) content.push({ type: 'image', data, mimeType: 'image/png' });
    return { content };
  }
  return textResult(result);
}

/* ── JSON-RPC over stdio ──────────────────────────────────────────────── */

function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: "Windows apps, media and PC diagnostics, in the background: these tools never bring a window to the front, move the mouse or type into the user's keyboard focus — the user is using this PC while you work. Read ./dex-tools/desktop.md first.",
      });
    case 'ping':
      return isRequest ? reply(id, {}) : undefined;
    case 'tools/list':
      return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      try {
        return reply(id, await callTool(params?.name, params?.arguments ?? {}));
      } catch (err) {
        log(`${params?.name} failed: ${err?.message}`);
        return reply(id, errorResult('host_error', err?.message ?? String(err)));
      }
    }
    default:
      if (method?.startsWith('notifications/')) return undefined;
      return isRequest ? fail(id, -32601, `Method not found: ${method}`) : undefined;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.platform !== 'win32') log('this server only works on Windows');
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try { msg = JSON.parse(trimmed); } catch { return fail(null, -32700, 'Parse error'); }
    Promise.resolve(handle(msg)).catch((err) => {
      log(`handler crashed: ${err?.message}`);
      if (msg?.id !== undefined) fail(msg.id, -32603, err?.message ?? 'Internal error');
    });
  });
  rl.on('close', () => { host?.stop(); process.exit(0); });
}
