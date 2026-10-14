/**
 * The two things main runs itself for the Desk tab and the chat's Undo
 * buttons (docs/desktop-control/PLAN.md §Phase 3):
 *
 * - host/window.ps1, for "Show me" and "Hand back". Started from main at
 *   the click, so Windows lets it bring the window to the front (a process
 *   the foreground app just started); the Windows server's helper can't.
 * - the Windows server's `--undo` mode, for an Undo button: the same journal
 *   and the same admin helper the agent's own `undo` uses.
 */
import { app, screen, type BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mainLogger } from '../logger';
import { launchSpec, WINDOWS_DEFINITION } from '../mcp/catalog';
import type { WindowOpResult } from './deskLive';

export function deskHome(): string {
  return path.join(app.getPath('userData'), 'desktop');
}

/** host/window.ps1 on real disk: PowerShell can't read inside app.asar. */
function windowScript(): string {
  const source = fs.readFileSync(path.join(app.getAppPath(), 'mcp-servers', 'windows', 'host', 'window.ps1'));
  const hash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 12);
  const target = path.join(deskHome(), `window-${hash}.ps1`);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(deskHome(), { recursive: true });
    fs.writeFileSync(target, source);
  }
  return target;
}

/** One line of JSON from a child, or a failure that says why. */
function runJson(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); }, timeoutMs);
    child.stdout.setEncoding('utf-8').on('data', (d: string) => { out += d; });
    child.stderr.setEncoding('utf-8').on('data', (d: string) => { if (err.length < 4000) err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: 'helper_failed', message: e.message }); });
    child.on('close', () => {
      clearTimeout(timer);
      const line = out.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
      try {
        resolve(JSON.parse(line) as Record<string, unknown>);
      } catch {
        resolve({ ok: false, error: 'helper_failed', message: err.trim().split(/\r?\n/).slice(-2).join(' ') || 'No answer.' });
      }
    });
  });
}

/** The work area of the screen DEX's hub is on, in physical pixels: where "Show me" puts the window. */
export function hubArea(hub: BrowserWindow | null): string | undefined {
  if (!hub || hub.isDestroyed() || process.platform !== 'win32') return undefined;
  const display = screen.getDisplayMatching(hub.getBounds());
  const r = screen.dipToScreenRect(hub, display.workArea);
  return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
}

export async function runWindowOp(op: 'show' | 'park', hwnd: number, area?: string): Promise<WindowOpResult> {
  if (process.platform !== 'win32') return { ok: false, error: 'windows_only' };
  if (!Number.isSafeInteger(hwnd) || hwnd <= 0) return { ok: false, error: 'bad_window' };
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', windowScript(),
    '-Op', op, '-Hwnd', String(hwnd), '-DexExe', process.execPath, '-DeskHome', deskHome(), ...(area ? ['-Area', area] : [])];
  const r = await runJson('powershell.exe', args, process.env, 20_000);
  mainLogger.info('desktop.window-op', { op, ok: r.ok === true, error: r.error });
  return { ok: r.ok === true, foreground: r.foreground === true, error: typeof r.error === 'string' ? r.error : undefined };
}

/** The Windows server's `--undo <entry>`: the user's own click on Undo. */
export async function runUndo(sessionId: string, entry: string): Promise<{ ok: boolean; error?: string; message?: string }> {
  if (!/^\d{10,16}-[a-z_]{2,40}$/.test(entry)) return { ok: false, error: 'bad_entry', message: 'Not a change DEX recorded.' };
  const spec = launchSpec(WINDOWS_DEFINITION, {});
  const r = await runJson(spec.command, [...spec.args, '--undo', entry], { ...process.env, ...spec.env, DEX_SESSION_ID: sessionId }, 5 * 60_000);
  mainLogger.info('desktop.undo', { entry, ok: r.ok === true, error: r.error });
  return { ok: r.ok === true, error: typeof r.error === 'string' ? r.error : undefined, message: typeof r.message === 'string' ? r.message : undefined };
}

/** The task's undo journal folder (one file per change). */
export function journalDir(sessionId?: string | null): string {
  const base = path.join(deskHome(), 'journal');
  return sessionId ? path.join(base, sessionId.replace(/[^A-Za-z0-9_-]/g, '_')) : base;
}
