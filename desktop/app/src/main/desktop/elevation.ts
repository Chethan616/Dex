/**
 * DEX's elevated helper (docs/desktop-control/PLAN.md §6): set up once with
 * one Windows prompt, after which allowlisted admin changes run without one.
 *
 * Setup copies host.ps1 into %ProgramData%\DEX\elevated (writable only by
 * administrators) and registers the task \DEX\Elevated to run it as this
 * user with highest privileges. The Windows server starts it on demand and
 * proves itself with the secret written here, in the user's own profile.
 */
import { app } from 'electron';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mainLogger } from '../logger';

export interface ElevationStatus {
  supported: boolean;
  installed: boolean;
  /** Installed, but with an older helper than this DEX ships. */
  outdated: boolean;
}

function deskHome(): string {
  return path.join(app.getPath('userData'), 'desktop');
}

function bundled(file: string): Buffer {
  return fs.readFileSync(path.join(app.getAppPath(), 'mcp-servers', 'windows', 'host', file));
}

const installedScript = (): string => path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'DEX', 'elevated', 'host.ps1');
const sha = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

export function elevationStatus(): ElevationStatus {
  if (process.platform !== 'win32') return { supported: false, installed: false, outdated: false };
  const query = spawnSync('schtasks.exe', ['/query', '/tn', '\\DEX\\Elevated'], { windowsHide: true });
  const installed = query.status === 0;
  let outdated = false;
  if (installed) {
    try { outdated = sha(fs.readFileSync(installedScript())) !== sha(bundled('host.ps1')); } catch { outdated = true; }
  }
  return { supported: true, installed, outdated };
}

/** Run setup-elevated.ps1 as administrator: the one Windows prompt. */
function runElevated(extra: string[]): { ok: boolean; error?: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-elevate-'));
  try {
    const hostScript = path.join(dir, 'host.ps1');
    const setup = path.join(dir, 'setup-elevated.ps1');
    fs.writeFileSync(hostScript, bundled('host.ps1'));
    fs.writeFileSync(setup, bundled('setup-elevated.ps1'));
    const user = `${process.env.USERDOMAIN ?? os.hostname()}\\${process.env.USERNAME ?? os.userInfo().username}`;
    const q = (s: string) => `\\"${s.replace(/"/g, '')}\\"`;
    const inner = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', q(setup), '-HostScript', q(hostScript), '-DeskHome', q(deskHome()), '-User', q(user), ...extra].join(' ');
    const r = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '${inner.replace(/'/g, "''")}'; exit $p.ExitCode`,
    ], { encoding: 'utf-8', windowsHide: true, timeout: 5 * 60_000 });
    if (r.status === 0) return { ok: true };
    const said = `${r.stderr ?? ''}`.trim();
    return { ok: false, error: /cancel/i.test(said) ? 'You said no to the Windows prompt. Nothing changed.' : `Windows didn’t finish the setup${said ? `: ${said.split(/\r?\n/)[0]}` : '.'}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function setUpElevation(): { ok: boolean; error?: string } {
  if (process.platform !== 'win32') return { ok: false, error: 'Only on Windows.' };
  const home = deskHome();
  fs.mkdirSync(home, { recursive: true });
  const secretFile = path.join(home, 'elevated.secret');
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  const result = runElevated([]);
  mainLogger.info('desktop.elevation.setup', { ok: result.ok, error: result.error });
  return result;
}

export function removeElevation(): { ok: boolean; error?: string } {
  if (process.platform !== 'win32') return { ok: false, error: 'Only on Windows.' };
  const result = runElevated(['-Remove']);
  if (result.ok) {
    for (const f of ['elevated.secret', 'elevated.port']) fs.rmSync(path.join(deskHome(), f), { force: true });
  }
  mainLogger.info('desktop.elevation.remove', { ok: result.ok });
  return result;
}
