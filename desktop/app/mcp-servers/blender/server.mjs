#!/usr/bin/env node
/**
 * DEX's Blender connection: MCP for Blender (`uvx mcp-for-blender`, MIT,
 * github.com/ahujasid/mcp-for-blender) talking to a Blender that runs in the
 * BACKGROUND — no window, nothing to keep focused. The user keeps their
 * desktop (browse, type, game) while the agent models.
 *
 * One background Blender per task (host.py), started on the agent's first
 * Blender tool call — tasks that never touch Blender never start one — and
 * reused by the task's later turns. It autosaves the scene after every change
 * to <DEX_BLENDER_HOME>/<session>/scene.blend and quits after 15 idle minutes;
 * the next call starts it again from that file.
 *
 * Run with Electron's Node (ELECTRON_RUN_AS_NODE=1), like the other built-in
 * servers. stdio is MCP: stdout passes straight through from the server;
 * stdin is read line by line so a tools/call can wait for Blender to be up.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const IDLE_SECONDS = 900;

const log = (msg) => process.stderr.write(`dex blender: ${msg}\n`);

// ── Detached launch helper: `server.mjs --spawn-host <json>` ─────────────────
// Blender is started by a short-lived middleman so it isn't a child of this
// server: an engine that kills its MCP servers' process trees at the end of a
// turn must not take the task's Blender (and its unsaved seconds) with it.
if (process.argv[2] === '--spawn-host') {
  const { exe, args, logFile } = JSON.parse(process.argv[3]);
  const out = fs.openSync(logFile, 'a');
  const child = spawn(exe, args, { detached: true, stdio: ['ignore', out, out], windowsHide: true });
  child.unref();
  process.stdout.write(String(child.pid));
  process.exit(0);
}

const session = (process.env.DEX_SESSION_ID || 'shared').replace(/[^A-Za-z0-9_-]/g, '_');
const home = process.env.DEX_BLENDER_HOME
  || path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'DEX', 'blender');
const dir = path.join(home, session);
const sceneFile = path.join(dir, 'scene.blend');
const hostFile = path.join(dir, 'host.json');
const statusFile = path.join(dir, 'host.status');
const hostLog = path.join(dir, 'host.log');

function blenderExe() {
  const fromEnv = process.env.DEX_BLENDER;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  if (process.platform !== 'win32') {
    return ['/Applications/Blender.app/Contents/MacOS/Blender', '/usr/bin/blender', '/snap/bin/blender'].find((p) => fs.existsSync(p)) ?? null;
  }
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]
    .filter(Boolean).map((r) => path.join(r, 'Blender Foundation'));
  const found = [];
  for (const root of roots) {
    let names = [];
    try { names = fs.readdirSync(root); } catch { continue; }
    for (const name of names) {
      const exe = path.join(root, name, 'blender.exe');
      if (fs.existsSync(exe)) found.push({ exe, v: (name.match(/(\d+(?:\.\d+)*)/)?.[1] ?? '0').split('.').map(Number) });
    }
  }
  found.sort((a, b) => {
    for (let i = 0; i < Math.max(a.v.length, b.v.length); i += 1) {
      const d = (b.v[i] ?? 0) - (a.v[i] ?? 0);
      if (d) return d;
    }
    return 0;
  });
  return found[0]?.exe ?? null;
}

function listening(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.setTimeout(800, () => done(false));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

// This task's port: the running host's, or a fresh one the host will take.
const previous = readJson(hostFile);
const port = previous?.port && (await listening(previous.port)) ? previous.port : await freePort();
let hostUp = previous?.port === port;

/**
 * host.py on real disk: in an installed DEX this folder is inside app.asar,
 * which Electron's Node can read but Blender can't.
 */
function hostScript() {
  const target = path.join(home, 'host.py');
  const source = fs.readFileSync(path.join(here, 'host.py'));
  let current = null;
  try { current = fs.readFileSync(target); } catch { /* first run */ }
  if (!current || !current.equals(source)) fs.writeFileSync(target, source);
  return target;
}

async function startHost() {
  const exe = blenderExe();
  if (!exe) throw new Error("Blender isn't installed on this PC. Install it (winget install BlenderFoundation.Blender) and try again.");
  fs.mkdirSync(dir, { recursive: true });
  const script = hostScript();
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try { fs.rmSync(statusFile, { force: true }); } catch { /* not there */ }
    const args = [
      '-b', ...(fs.existsSync(sceneFile) ? [sceneFile] : []),
      '-P', script,
      '--', '--port', String(port), '--autosave', sceneFile, '--idle', String(IDLE_SECONDS),
    ];
    const spawned = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--spawn-host', JSON.stringify({ exe, args, logFile: hostLog })], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8', windowsHide: true,
    });
    const pid = Number(spawned.stdout);
    if (!pid) throw new Error(`couldn't start Blender: ${spawned.stderr || spawned.error?.message || 'no process'}`);
    fs.writeFileSync(hostFile, JSON.stringify({ pid, port, exe, startedAt: new Date().toISOString() }));
    log(`starting Blender in the background for this task (pid ${pid}, port ${port})`);

    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (await listening(port)) return;
      if (!alive(pid)) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    const status = readJson(statusFile);
    if (status?.error === 'addon-missing' && attempt === 1) {
      log('installing the MCP for Blender add-on');
      spawnSync('uvx mcp-for-blender install-addon', [], { env: process.env, windowsHide: true, encoding: 'utf-8', shell: true });
      continue;
    }
    throw new Error(`Blender didn't come up in the background${status?.error ? ` (${status.error})` : ''} — its log is ${hostLog}`);
  }
}

let starting = null;
function ensureHost() {
  if (hostUp) return listening(port).then((ok) => (ok ? undefined : (hostUp = false, ensureHost())));
  starting ??= startHost().then(() => { hostUp = true; }).finally(() => { starting = null; });
  return starting;
}

// ── The MCP server itself ────────────────────────────────────────────────────
// uvx may be a shim that needs a shell on Windows; one command line, as launch.mjs does.
const win = process.platform === 'win32';
const child = spawn(win ? 'uvx mcp-for-blender' : 'uvx', win ? [] : ['mcp-for-blender'], {
  stdio: ['pipe', 'inherit', 'inherit'],
  env: { ...process.env, BLENDER_HOST: '127.0.0.1', BLENDER_PORT: String(port) },
  windowsHide: true,
  shell: win,
});
child.on('error', (err) => { log(`mcp-for-blender failed to start: ${err.message}`); process.exit(1); });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));

const queue = [];
let pumping = false;
let pending = '';

function reply(line, text) {
  let id = null;
  try { id = JSON.parse(line).id ?? null; } catch { /* not JSON: nothing to answer */ }
  if (id === null) return;
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } })}\n`);
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const line = queue.shift();
      if (/"method"\s*:\s*"tools\/call"/.test(line)) {
        try {
          await ensureHost();
        } catch (err) {
          log(err.message);
          reply(line, `DEX couldn't start Blender in the background: ${err.message}`);
          continue;
        }
      }
      child.stdin.write(line);
    }
  } finally {
    pumping = false;
  }
}

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  pending += chunk;
  let nl;
  while ((nl = pending.indexOf('\n')) >= 0) {
    queue.push(pending.slice(0, nl + 1));
    pending = pending.slice(nl + 1);
  }
  void pump();
});
process.stdin.on('end', () => {
  if (pending) queue.push(pending);
  void pump().then(() => child.stdin.end());
});
