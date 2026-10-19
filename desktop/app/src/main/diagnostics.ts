/**
 * Settings › Diagnostics, beyond the tool checks (startup/preflight): this PC
 * (Windows, memory, disk, the graphics driver and its age — an old AMD driver
 * crashed this owner's PC twice under Blender), whether DEX can reach the
 * services it talks to, and the latest errors in DEX's own logs. Plus one
 * report to paste into an issue. Nothing here is sent anywhere.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, shell } from 'electron';
import { loggerFactory } from './logger';

export interface GpuInfo { name: string; driver?: string; driverDate?: string; ageDays?: number }
export interface SystemInfo {
  os: string;
  arch: string;
  cpu: string;
  cores: number;
  memTotalGb: number;
  memFreeGb: number;
  diskFreeGb?: number;
  diskTotalGb?: number;
  uptimeHours: number;
  versions: Record<string, string>;
  gpus: GpuInfo[];
}

const gb = (n: number): number => Math.round((n / 1024 ** 3) * 10) / 10;

function powershellJson<T>(command: string, timeoutMs = 8000): Promise<T | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${command} | ConvertTo-Json -Compress`], { windowsHide: true, timeout: timeoutMs }, (err, stdout) => {
      if (err || !stdout.trim()) { resolve(null); return; }
      try { resolve(JSON.parse(stdout) as T); } catch { resolve(null); }
    });
  });
}

export async function systemInfo(): Promise<SystemInfo> {
  const cpus = os.cpus();
  const [gpuRaw, diskRaw] = await Promise.all([
    powershellJson<Array<{ Name: string; DriverVersion?: string; DriverDate?: string }> | { Name: string; DriverVersion?: string; DriverDate?: string }>(
      "Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,@{n='DriverDate';e={if($_.DriverDate){$_.DriverDate.ToString('yyyy-MM-dd')}}}"),
    powershellJson<{ Free: number; Used: number }>("Get-PSDrive -Name ($env:SystemDrive.TrimEnd(':')) | Select-Object Free,Used"),
  ]);
  const gpus = (Array.isArray(gpuRaw) ? gpuRaw : gpuRaw ? [gpuRaw] : []).map((g): GpuInfo => {
    const t = g.DriverDate ? Date.parse(g.DriverDate) : NaN;
    return { name: g.Name, driver: g.DriverVersion, driverDate: g.DriverDate, ageDays: Number.isNaN(t) ? undefined : Math.round((Date.now() - t) / 86_400_000) };
  });
  const release = os.release();
  const build = Number(release.split('.')[2] ?? 0);
  return {
    os: process.platform === 'win32' ? `Windows ${build >= 22000 ? '11' : '10'} (build ${release})` : `${os.type()} ${release}`,
    arch: os.arch(),
    cpu: cpus[0]?.model?.trim() ?? 'unknown',
    cores: cpus.length,
    memTotalGb: gb(os.totalmem()),
    memFreeGb: gb(os.freemem()),
    diskFreeGb: diskRaw ? gb(diskRaw.Free) : undefined,
    diskTotalGb: diskRaw ? gb(diskRaw.Free + diskRaw.Used) : undefined,
    uptimeHours: Math.round(os.uptime() / 360) / 10,
    versions: { DEX: app.getVersion(), Electron: process.versions.electron ?? '', Chrome: process.versions.chrome ?? '', Node: process.versions.node },
    gpus,
  };
}

export interface ReachResult { id: string; label: string; ok: boolean; ms?: number; status?: number; error?: string }

const SERVICES: Array<{ id: string; label: string; url: string }> = [
  { id: 'anthropic', label: 'Claude (Anthropic)', url: 'https://api.anthropic.com/' },
  { id: 'openai', label: 'OpenAI / Codex', url: 'https://api.openai.com/' },
  { id: 'github', label: 'GitHub (updates)', url: 'https://github.com/' },
  { id: 'firebase', label: 'Phone link (Firebase)', url: 'https://firestore.googleapis.com/' },
  { id: 'huggingface', label: 'Hugging Face (3D)', url: 'https://huggingface.co/' },
];

/** Can DEX reach the services it uses? Any HTTP answer counts: it's the network path being checked, not an API. */
export async function reachability(): Promise<ReachResult[]> {
  return Promise.all(SERVICES.map(async (s): Promise<ReachResult> => {
    const t0 = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    try {
      const r = await fetch(s.url, { method: 'HEAD', signal: ctl.signal, redirect: 'manual' });
      return { id: s.id, label: s.label, ok: true, ms: Date.now() - t0, status: r.status };
    } catch (err) {
      const e = err as Error & { cause?: { code?: string } };
      return { id: s.id, label: s.label, ok: false, ms: Date.now() - t0, error: ctl.signal.aborted ? 'timed out' : (e.cause?.code ?? e.message).slice(0, 80) };
    } finally {
      clearTimeout(timer);
    }
  }));
}

export interface LogProblem { at: string; level: 'error' | 'warn'; channel: string; msg: string; detail?: string }

/** The newest errors (and warnings, if asked) across DEX's logs, newest first. */
export function recentProblems(max = 25, withWarnings = false): LogProblem[] {
  const dir = loggerFactory.getLogsDir();
  const out: LogProblem[] = [];
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.log')); } catch { return []; }
  for (const f of files) {
    let text = '';
    try {
      const fd = fs.openSync(path.join(dir, f), 'r');
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, 400_000);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      fs.closeSync(fd);
      text = buf.toString('utf-8');
    } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.includes('"level":"error"') && !(withWarnings && line.includes('"level":"warn"'))) continue;
      try {
        const e = JSON.parse(line) as Record<string, unknown>;
        const { ts, level, channel, msg, ...rest } = e;
        const detail = typeof rest.error === 'string' ? rest.error : typeof rest.message === 'string' ? rest.message : Object.keys(rest).length ? JSON.stringify(rest).slice(0, 240) : undefined;
        out.push({ at: String(ts ?? ''), level: level === 'warn' ? 'warn' : 'error', channel: String(channel ?? f.replace(/\.log$/, '')), msg: String(msg ?? ''), detail: detail?.slice(0, 240) });
      } catch { /* a partial line at the cut */ }
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, max);
}

export function openLogsFolder(): Promise<string> {
  return shell.openPath(loggerFactory.getLogsDir());
}
