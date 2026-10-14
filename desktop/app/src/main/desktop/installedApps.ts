/**
 * The apps on this PC, for Settings › Desktop control's "Ask first" and
 * "Never use" pickers: every Start-menu shortcut's program, and every Store
 * app's own executable — each with the name Windows shows for it, and the
 * process name the Windows tools see when DEX uses it (what the lists hold).
 *
 * One PowerShell read (a few seconds), kept for ten minutes.
 */
import { execFile } from 'node:child_process';

export interface InstalledApp {
  /** As Windows shows it: "WhatsApp", "Spotify". */
  name: string;
  /** Its process, lower case: "whatsapp.exe" — what DEX's lists match. */
  exe: string;
}

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$out = @{}
$add = { param($exe, $name) if ($exe -and $name -and -not $out.ContainsKey($exe)) { $out[$exe] = $name } }
$shell = New-Object -ComObject WScript.Shell
foreach ($dir in @("$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs")) {
  Get-ChildItem $dir -Recurse -Filter *.lnk | ForEach-Object {
    $target = $shell.CreateShortcut($_.FullName).TargetPath
    if ($target -and $target.ToLower().EndsWith('.exe')) {
      $exe = [IO.Path]::GetFileName($target).ToLower()
      if ($exe -notmatch '^(unins|uninstall|setup|update|install|helper|crashpad|elevate)') { & $add $exe $_.BaseName }
    }
  }
}
$names = @{}
Get-StartApps | ForEach-Object { $names[$_.AppID] = $_.Name }
foreach ($p in Get-AppxPackage -PackageTypeFilter Main) {
  if ($p.IsFramework -or -not $p.InstallLocation) { continue }
  $manifest = Join-Path $p.InstallLocation 'AppxManifest.xml'
  if (-not (Test-Path $manifest)) { continue }
  [xml]$x = Get-Content $manifest -Raw
  foreach ($a in @($x.Package.Applications.Application)) {
    if (-not $a.Executable) { continue }
    $name = $names["$($p.PackageFamilyName)!$($a.Id)"]
    if (-not $name) { continue }
    & $add ([IO.Path]::GetFileName($a.Executable).ToLower()) $name
  }
}
@($out.GetEnumerator() | ForEach-Object { [pscustomobject]@{ exe = $_.Key; name = $_.Value } }) | ConvertTo-Json -Compress
`;

let cache: { at: number; apps: InstalledApp[] } | null = null;
let inflight: Promise<InstalledApp[]> | null = null;
const TTL_MS = 10 * 60_000;

/** Parse the script's JSON into a clean, sorted list (one entry per process). */
export function parseInstalledApps(json: string): InstalledApp[] {
  let raw: unknown;
  try { raw = JSON.parse(json.trim() || '[]'); } catch { return []; }
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const byExe = new Map<string, InstalledApp>();
  for (const item of list as Array<{ exe?: unknown; name?: unknown }>) {
    const exe = typeof item.exe === 'string' ? item.exe.toLowerCase().trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!/^[\w .()&+-]{1,80}\.exe$/.test(exe) || !name || byExe.has(exe)) continue;
    byExe.set(exe, { exe, name: name.slice(0, 80) });
  }
  return [...byExe.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function installedApps(): Promise<InstalledApp[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.apps);
  inflight ??= new Promise<InstalledApp[]>((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
      { windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      (_err, stdout) => {
        const apps = parseInstalledApps(String(stdout ?? ''));
        if (apps.length) cache = { at: Date.now(), apps };
        inflight = null;
        resolve(apps);
      });
  });
  return inflight;
}
