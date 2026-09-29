/**
 * What DEX needs on this PC — and one click to install whatever is missing,
 * so someone who just ran dex-setup.exe never opens a terminal.
 *
 *   core  Git for Windows   bash, which every dex-* tool and the browser harness run in
 *         Node.js           npx, which connected services (GitHub, Slack) start through;
 *                           and npm, which installs Codex
 *         Bun               runs the browser harness (it would fetch itself mid-task otherwise)
 *   3d    Blender + uv      the 3D tools: Blender itself, and uv to run its MCP server
 *
 * Installs go through winget where Windows has it (silent, the vendors'
 * signed installers), falling back to each project's own installer. Git and
 * Node.js install for all users, so Windows may ask for permission once;
 * Bun and uv install for this user only. An install counts only when the
 * tool is then actually found — not when an installer merely exits 0.
 *
 * The engines (Claude Code, Codex) have their own install in the engine step
 * (hl/engines/installer.ts); this covers what every engine relies on.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mainLogger } from '../logger';
import { enrichedEnv, resetPathEnrichmentCache } from '../hl/engines/pathEnrich';
import { runInstallCommand } from '../hl/engines/installer';
import { findBun, findGitBash, findNpx, resetDiscoveryCaches } from '../startup/preflight';
import { findBlender, resetBlenderCache } from '../startup/blender';

export type EssentialId = 'git' | 'node' | 'bun' | 'blender' | 'uv';

export interface Essential {
  id: EssentialId;
  name: string;
  /** One line: what DEX uses it for. */
  why: string;
  group: 'core' | '3d';
  installed: boolean;
  /** Where it was found, when it was. */
  detail?: string;
  /** Windows will ask for permission (UAC) to install it. */
  asksPermission: boolean;
}

export type EssentialProgress =
  | { id: EssentialId; phase: 'installing'; line?: string }
  | { id: EssentialId; phase: 'done' }
  | { id: EssentialId; phase: 'failed'; error: string };

const META: Record<EssentialId, Omit<Essential, 'installed' | 'detail'>> = {
  git: { id: 'git', name: 'Git for Windows', why: 'DEX’s tools and its browser run in its bash shell.', group: 'core', asksPermission: true },
  node: { id: 'node', name: 'Node.js', why: 'Starts connected services like GitHub and Slack, and installs Codex.', group: 'core', asksPermission: true },
  bun: { id: 'bun', name: 'Bun', why: 'Runs DEX’s browser controller.', group: 'core', asksPermission: false },
  blender: { id: 'blender', name: 'Blender', why: 'Builds 3D models and scenes — in the background, no window.', group: '3d', asksPermission: true },
  uv: { id: 'uv', name: 'uv', why: 'Runs Blender’s connection to DEX.', group: '3d', asksPermission: false },
};

function findUvx(env: NodeJS.ProcessEnv): string | undefined {
  const exe = process.platform === 'win32' ? 'uvx.exe' : 'uvx';
  const dirs = [
    ...(env.Path ?? env.PATH ?? '').split(path.delimiter),
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.cargo', 'bin'),
  ].filter(Boolean);
  return dirs.map((d) => path.join(d, exe)).find((f) => existsSync(f));
}

/** A fresh look: caches from before an install would say it's still missing. */
export function detectEssentials(): Essential[] {
  resetPathEnrichmentCache();
  resetDiscoveryCaches();
  resetBlenderCache();
  const env = enrichedEnv(process.env);
  const found: Record<EssentialId, string | undefined | null> = {
    git: process.platform === 'win32' ? findGitBash(env) : 'bash',
    node: findNpx(env),
    bun: findBun(env),
    blender: findBlender(),
    uv: findUvx(env),
  };
  return (Object.keys(META) as EssentialId[]).map((id) => ({
    ...META[id],
    installed: Boolean(found[id]),
    detail: found[id] ?? undefined,
  }));
}

let wingetKnown: boolean | null = null;
function hasWinget(): boolean {
  if (wingetKnown !== null) return wingetKnown;
  const r = spawnSync('winget', ['--version'], { encoding: 'utf-8', timeout: 15_000, windowsHide: true, env: enrichedEnv(process.env) });
  wingetKnown = r.status === 0;
  return wingetKnown;
}

const winget = (id: string, extra = '') =>
  `winget install --id ${id} -e --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity ${extra}`.trim();

/** A PowerShell script, run from a file (no quoting through cmd.exe). */
function powershell(name: string, script: string): string {
  const dir = path.join(os.tmpdir(), 'dex-setup');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.ps1`);
  writeFileSync(file, `$ErrorActionPreference = 'Stop'\n$ProgressPreference = 'SilentlyContinue'\n${script}\n`);
  return `powershell -NoProfile -ExecutionPolicy Bypass -File "${file}"`;
}

/** Ways to install each, tried in order until the tool is found. */
function attempts(id: EssentialId): string[] {
  const viaWinget = hasWinget();
  switch (id) {
    case 'git':
      return [
        // Git's installer can install for just this user: no permission prompt.
        ...(viaWinget ? [winget('Git.Git', '--scope user'), winget('Git.Git')] : []),
        // The latest tag from gitforwindows.org, not api.github.com: the API's
        // 60 requests an hour per IP run out behind a shared (campus/ISP) NAT.
        powershell('git', [
          "$tag = (Invoke-RestMethod 'https://gitforwindows.org/latest-tag.txt').Trim()",
          "if ($tag -notmatch '^v(\\d+\\.\\d+\\.\\d+)\\.windows\\.(\\d+)$') { throw \"Unexpected Git for Windows tag: $tag\" }",
          'if ($Matches[2] -eq \'1\') { $ver = $Matches[1] } else { $ver = "$($Matches[1]).$($Matches[2])" }',
          '$name = "Git-$ver-64-bit.exe"',
          '$f = Join-Path $env:TEMP $name',
          'Invoke-WebRequest "https://github.com/git-for-windows/git/releases/download/$tag/$name" -OutFile $f -UseBasicParsing',
          "Start-Process $f -ArgumentList '/VERYSILENT','/NORESTART','/NOCANCEL','/SP-','/CURRENTUSER' -Wait",
        ].join('\n')),
      ];
    case 'node':
      return [
        ...(viaWinget ? [winget('OpenJS.NodeJS.LTS')] : []),
        powershell('node', [
          "$lts = (Invoke-RestMethod 'https://nodejs.org/dist/index.json') | Where-Object { $_.lts } | Select-Object -First 1",
          "$f = Join-Path $env:TEMP ('node-' + $lts.version + '-x64.msi')",
          "Invoke-WebRequest ('https://nodejs.org/dist/' + $lts.version + '/node-' + $lts.version + '-x64.msi') -OutFile $f -UseBasicParsing",
          "Start-Process msiexec.exe -Verb RunAs -ArgumentList '/i', ('\"' + $f + '\"'), '/qn', '/norestart' -Wait",
        ].join('\n')),
      ];
    case 'bun':
      return [powershell('bun', 'Invoke-RestMethod https://bun.sh/install.ps1 | Invoke-Expression')];
    case 'uv':
      return [powershell('uv', 'Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression')];
    case 'blender':
      return viaWinget ? [winget('BlenderFoundation.Blender')] : [];
  }
}

function isInstalled(id: EssentialId): boolean {
  return detectEssentials().find((e) => e.id === id)?.installed ?? false;
}

/**
 * Install each missing one, in order (Git before the rest: several
 * installers expect it), reporting as it goes. Returns the fresh picture.
 */
export async function installEssentials(ids: EssentialId[], onProgress: (p: EssentialProgress) => void): Promise<Essential[]> {
  const order: EssentialId[] = ['git', 'node', 'bun', 'uv', 'blender'];
  for (const id of order.filter((x) => ids.includes(x))) {
    if (isInstalled(id)) { onProgress({ id, phase: 'done' }); continue; }
    onProgress({ id, phase: 'installing' });
    let lastError = 'No way to install it on this PC.';
    let ok = false;
    for (const command of attempts(id)) {
      const result = await runInstallCommand(META[id].name, command, {
        timeoutMs: 20 * 60_000,
        onOutput: (line) => onProgress({ id, phase: 'installing', line }),
      });
      mainLogger.info('setup.essentials.attempt', { id, command: command.split(' ').slice(0, 4).join(' '), exitCode: result.exitCode, completed: result.completed });
      if (isInstalled(id)) { ok = true; break; }
      lastError = (result.error ?? `The installer exited with code ${result.exitCode}.`).split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300);
    }
    if (ok) onProgress({ id, phase: 'done' });
    else onProgress({ id, phase: 'failed', error: lastError });
  }
  return detectEssentials();
}

let installing: Promise<Essential[]> | null = null;

/** setup:essentials (what's there), setup:install (fetch what isn't); progress on setup:progress. */
export function registerSetupIpc(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BrowserWindow, ipcMain } = require('electron') as typeof import('electron');
  const valid = new Set<EssentialId>(Object.keys(META) as EssentialId[]);
  ipcMain.handle('setup:essentials', () => detectEssentials());
  ipcMain.handle('setup:install', (_e, ids: unknown) => {
    const wanted = (Array.isArray(ids) ? ids : []).filter((x): x is EssentialId => valid.has(x as EssentialId));
    // One install run at a time; a second click joins the first.
    installing ??= installEssentials(wanted, (p) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('setup:progress', p);
      }
    }).finally(() => { installing = null; });
    return installing;
  });
}
