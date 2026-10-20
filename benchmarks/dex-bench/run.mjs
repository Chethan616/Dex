// Runs DEX-Bench and checks every task.
//
//   node run.mjs --agent dex            DEX (Claude Code engine, Opus), driven through the hub
//   node run.mjs --agent claude-code    plain Claude Code CLI, same model, same prompts (baseline)
//   options: --only id,id  --timeout 900  --root C:\Users\you\DEX-Bench  --cdp 9224  --model opus
//
// DEX must be running with a CDP port for the hub (AGB_CDP_PORT=9224). For the
// run its approval mode is set to Full access (as OSWorld agents run
// unattended) and put back afterwards.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { server } from './server.mjs';
import { TASKS } from './tasks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const AGENT = arg('agent', 'dex');
const MODEL = arg('model', 'opus');
const ONLY = arg('only', '')?.split(',').filter(Boolean);
const TIMEOUT_S = Number(arg('timeout', 900));
const ROOT = arg('root', path.join(os.homedir(), 'DEX-Bench'));
const CDP = arg('cdp', '9224');
const PORT = 8765;
const SITE = `http://127.0.0.1:${PORT}`;

const tasks = TASKS.filter((t) => !ONLY.length || ONLY.includes(t.id));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ── Facts about this PC the checkers compare against ─────────────── */
function sysFacts() {
  const ps = (cmd) => { try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8', windowsHide: true }).trim(); } catch { return ''; } };
  const physical = ps('Get-CimInstance Win32_VideoController | Where-Object CurrentHorizontalResolution | ForEach-Object { "$($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution)" }').split(/\r?\n/).filter(Boolean);
  const logical = ps('Add-Type -AssemblyName System.Windows.Forms; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; "$($b.Width)x$($b.Height)"');
  return { cpus: os.cpus().length, resolutions: [...new Set([...physical, logical].filter(Boolean))] };
}

/* ── Agents ──────────────────────────────────────────────────────── */
async function dexAgent() {
  const { chromium } = await import(pathToFileURL(path.resolve(HERE, '../../desktop/app/node_modules/@playwright/test/index.mjs')).href);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP}`);
  const hub = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('/hub/hub.html'));
  if (!hub) throw new Error(`no DEX hub on CDP port ${CDP}`);
  const before = await hub.evaluate(() => window.electronAPI.settings.approvals.get());
  await hub.evaluate(() => window.electronAPI.settings.approvals.set('full'));
  log('DEX approval mode', before.mode, '→ full for the run');
  return {
    name: `DEX (Claude Code engine, ${MODEL})`,
    async run(prompt) {
      const t0 = Date.now();
      const id = await hub.evaluate(({ prompt, model }) => window.electronAPI.sessions.create({ prompt, engine: 'claude-code', model }), { prompt, model: MODEL });
      await hub.evaluate((id) => window.electronAPI.sessions.start(id), id);
      let s = null;
      while (Date.now() - t0 < TIMEOUT_S * 1000) {
        await new Promise((r) => setTimeout(r, 3000));
        s = await hub.evaluate((id) => window.electronAPI.sessions.get(id), id);
        const ended = s && (s.status === 'idle' || s.status === 'stopped') && Date.now() - t0 > 8000;
        if (ended) break;
      }
      const out = s?.output ?? [];
      const timedOut = !(s && (s.status === 'idle' || s.status === 'stopped'));
      if (timedOut) await hub.evaluate((id) => window.electronAPI.sessions.cancel(id), id).catch(() => {});
      const done = [...out].reverse().find((e) => e.type === 'done');
      const reply = [...out].reverse().find((e) => e.type === 'thinking' && e.text)?.text ?? '';
      const answer = String(done?.summary || reply || s?.error || '');
      return {
        sessionId: id, answer, timedOut,
        seconds: Math.round((Date.now() - t0) / 1000),
        steps: out.filter((e) => e.type === 'tool_call').length,
        error: s?.status === 'stopped' ? s?.error : undefined,
        costUsd: s?.costUsd,
      };
    },
    async close() {
      await hub.evaluate((mode) => window.electronAPI.settings.approvals.set(mode), before.mode).catch(() => {});
      log('DEX approval mode back to', before.mode);
    },
  };
}

function claudeCodeAgent() {
  return {
    name: `Claude Code CLI alone (${MODEL})`,
    run(prompt, dir) {
      return new Promise((resolve) => {
        const t0 = Date.now();
        const env = { ...process.env };
        for (const k of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT']) delete env[k];
        // The prompt goes in on stdin: through Windows' shell an argument with
        // spaces arrives split, and Claude Code saw only its first word.
        const child = spawn('claude', ['-p', '--model', MODEL, '--output-format', 'json', '--dangerously-skip-permissions'], { cwd: dir, env, shell: true, windowsHide: true });
        child.stdin.end(prompt);
        let out = '';
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', () => {});
        const timer = setTimeout(() => { child.kill(); }, TIMEOUT_S * 1000);
        child.on('close', () => {
          clearTimeout(timer);
          let j = {};
          try { j = JSON.parse(out.trim().split(/\r?\n/).filter(Boolean).at(-1)); } catch { /* not JSON */ }
          resolve({
            answer: String(j.result ?? out.slice(-2000)),
            timedOut: Date.now() - t0 >= TIMEOUT_S * 1000,
            seconds: Math.round((Date.now() - t0) / 1000),
            steps: j.num_turns,
            costUsd: j.total_cost_usd,
          });
        });
      });
    },
    async close() {},
  };
}

/* ── The plan's usage limit ──────────────────────────────────────── */
// "You've hit your session limit · resets 6:40pm (Asia/Kolkata)": not a
// result. Wait for the reset and run the task again.
const LIMIT = /hit your (?:session|usage|weekly|daily)?\s*limit|usage limit|limit reached|rate.?limit/i;
function resetAt(answer) {
  const m = /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(answer);
  const now = new Date();
  if (!m) return new Date(now.getTime() + 30 * 60_000);
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  const at = new Date(now);
  at.setHours(h, Number(m[2] || 0), 0, 0); // the PC's own time zone (this one is Asia/Kolkata)
  if (at <= now) at.setDate(at.getDate() + 1);
  return new Date(at.getTime() + 2 * 60_000);
}

/* ── The run ─────────────────────────────────────────────────────── */
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
log('site on', SITE);
const sys = sysFacts();
log('this PC:', JSON.stringify(sys));
const agent = AGENT === 'dex' ? await dexAgent() : claudeCodeAgent();
const results = [];
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outFile = path.join(HERE, 'results', `${AGENT}-${stamp}.json`);
fs.mkdirSync(path.dirname(outFile), { recursive: true });

try {
  for (const task of tasks) {
    const dir = path.join(ROOT, 'work', task.id);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    task.setup(dir);
    await fetch(`${SITE}/__reset`, { method: 'POST' });
    const prompt = task.prompt(dir, SITE);
    log(`▶ ${task.id}: ${prompt}`);
    let r;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        r = await agent.run(prompt, dir);
      } catch (err) {
        r = { answer: '', error: err.message, seconds: 0, steps: 0 };
      }
      if (!LIMIT.test(r.answer) || r.steps > 3) break;
      const until = resetAt(r.answer);
      log(`⏸ usage limit (${r.answer.slice(0, 80)}); waiting until ${until.toLocaleTimeString()} and running ${task.id} again`);
      await new Promise((res) => setTimeout(res, Math.max(0, until.getTime() - Date.now())));
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      task.setup(dir);
      await fetch(`${SITE}/__reset`, { method: 'POST' });
    }
    const state = await (await fetch(`${SITE}/__state`)).json();
    let verdict;
    try { verdict = task.check({ dir, answer: r.answer, state, sys }); } catch (err) { verdict = { pass: false, why: `checker error: ${err.message}` }; }
    const row = { id: task.id, category: task.category, prompt, ...r, pass: verdict.pass, why: verdict.why };
    results.push(row);
    log(`${verdict.pass ? '✔ PASS' : '✘ FAIL'} ${task.id} · ${r.seconds}s · ${r.steps ?? '?'} steps · ${verdict.why}`);
    fs.writeFileSync(outFile, JSON.stringify({ agent: agent.name, model: MODEL, startedAt: stamp, sys, results }, null, 2));
  }
} finally {
  await agent.close();
  server.close();
}
const passed = results.filter((r) => r.pass).length;
log(`${agent.name}: ${passed}/${results.length} passed (${Math.round((100 * passed) / Math.max(1, results.length))}%) → ${path.relative(HERE, outFile)}`);
process.exit(0);
