/**
 * The PowerShell host (host/host.ps1), as a promise-based client: one JSON
 * line out, one JSON line back, matched by id. Started on the first call,
 * restarted if it dies, killed if an op wedges past its timeout.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** How long each op may take before the host is presumed wedged. */
export function timeoutFor(op, args = {}) {
  if (op === 'wait') return Math.min(30_000, Number(args.timeoutMs) || 10_000) + 8_000;
  if (op === 'launch') return 30_000;
  if (op === 'sys' || op === 'media') return 60_000;
  if (op === 'borrow') {
    const steps = Array.isArray(args.steps) ? args.steps : [];
    const waits = steps.reduce((t, s) => t + Math.min(5_000, Number(s?.wait) || 0), 0);
    const typed = steps.reduce((t, s) => t + (typeof s?.type === 'string' ? s.type.length : 0), 0);
    return Math.min(30_000, Number(args.maxWaitMs) || 20_000) + waits + steps.length * 1_500 + typed * 20 + 15_000;
  }
  return 25_000;
}

export class Host {
  /**
   * @param {{command: string, args: string[], env?: Record<string,string>, log?: (m: string) => void, onEvent?: (e: object) => void}} spec
   */
  constructor(spec) {
    this.spec = spec;
    this.child = null;
    this.ready = null;
    this.pending = new Map();
    this.nextId = 1;
  }

  start() {
    if (this.ready) return this.ready;
    const { command, args, env, log, onEvent } = this.spec;
    const child = spawn(command, args, { env: { ...process.env, ...env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.ready = new Promise((resolve, reject) => {
      const startup = setTimeout(() => reject(new Error("DEX's Windows helper didn't start within 60 s.")), 60_000);
      let stderr = '';
      child.stderr.setEncoding('utf-8');
      child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 8000) stderr = stderr.slice(-8000); log?.(`host stderr: ${String(d).trim()}`); });
      createInterface({ input: child.stdout }).on('line', (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { log?.(`host said: ${line.slice(0, 300)}`); return; }
        if (msg.event === 'ready') { clearTimeout(startup); resolve(); return; }
        if (msg.event) { onEvent?.(msg); return; }
        const waiter = this.pending.get(msg.id);
        if (waiter) { this.pending.delete(msg.id); waiter.resolve(msg); }
      });
      child.on('error', (err) => { clearTimeout(startup); reject(err); });
      child.on('exit', (code) => {
        clearTimeout(startup);
        const why = new Error(`DEX's Windows helper stopped (exit ${code}).${stderr ? ` ${stderr.trim().split(/\r?\n/).slice(-3).join(' ')}` : ''}`);
        reject(why);
        for (const waiter of this.pending.values()) waiter.reject(why);
        this.pending.clear();
        if (this.child === child) { this.child = null; this.ready = null; }
      });
    });
    // A failed start leaves nothing behind for the next call to trip on.
    this.ready.catch(() => { if (this.child === child) { this.stop(); } });
    return this.ready;
  }

  async call(op, args = {}, timeoutMs = timeoutFor(op, args)) {
    await this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // A UIA provider that never answers wedges the host's only thread.
        this.spec.log?.(`op ${op} timed out after ${timeoutMs} ms; restarting the helper`);
        this.stop();
        resolve({ id, ok: false, error: 'provider_timeout', message: "The app didn't answer in time.", hint: 'It may be busy or hung. Try again, or try another route.' });
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (m) => { clearTimeout(timer); resolve(m); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.child.stdin.write(`${JSON.stringify({ id, op, args })}\n`);
    });
  }

  stop() {
    const child = this.child;
    this.child = null;
    this.ready = null;
    if (child && child.exitCode === null) {
      try { child.stdin.end(); } catch { /* gone */ }
      try { child.kill(); } catch { /* gone */ }
    }
  }
}
