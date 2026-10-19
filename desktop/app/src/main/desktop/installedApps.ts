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
  /** Where its program is, for its icon (kept in main, never sent to the page). */
  path?: string;
  /** A Store app's own logo image, which looks better than its exe's icon. */
  logo?: string;
}

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$out = @{}
$paths = @{}
$logos = @{}
$add = { param($exe, $name, $path, $logo) if ($exe -and $name -and -not $out.ContainsKey($exe)) { $out[$exe] = $name; if ($path) { $paths[$exe] = $path }; if ($logo) { $logos[$exe] = $logo } } }
$shell = New-Object -ComObject WScript.Shell
foreach ($dir in @("$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs")) {
  Get-ChildItem $dir -Recurse -Filter *.lnk | ForEach-Object {
    $target = $shell.CreateShortcut($_.FullName).TargetPath
    if ($target -and $target.ToLower().EndsWith('.exe')) {
      $exe = [IO.Path]::GetFileName($target).ToLower()
      if ($exe -notmatch '^(unins|uninstall|setup|update|install|helper|crashpad|elevate)') { & $add $exe $_.BaseName $target $null }
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
    # The tile logo: Assets\Square44x44Logo.png names a family of scaled files; take the biggest that exists.
    $logo = $null
    $ve = $a.VisualElements
    $rel = if ($ve.Square44x44Logo) { $ve.Square44x44Logo } elseif ($ve.Square150x150Logo) { $ve.Square150x150Logo } else { $null }
    if ($rel) {
      $base = Join-Path $p.InstallLocation $rel
      $dir = Split-Path $base
      $stem = [IO.Path]::GetFileNameWithoutExtension($base)
      if (Test-Path $base) { $logo = $base }
      # "altform-unplated" is the full-colour taskbar icon; the plated ones can be white glyphs meant for a coloured tile.
      $all = @(Get-ChildItem $dir -Filter "$stem*.png" -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch 'contrast|lightunplated' })
      $best = $all | Sort-Object @{ e = { if ($_.Name -match 'altform-unplated') { 0 } else { 1 } } }, @{ e = { $_.Length }; Descending = $true } | Select-Object -First 1
      if ($best) { $logo = $best.FullName }
    }
    & $add ([IO.Path]::GetFileName($a.Executable).ToLower()) $name (Join-Path $p.InstallLocation $a.Executable) $logo
  }
}
@($out.GetEnumerator() | ForEach-Object { [pscustomobject]@{ exe = $_.Key; name = $_.Value; path = $paths[$_.Key]; logo = $logos[$_.Key] } }) | ConvertTo-Json -Compress
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
  const file = (v: unknown): string | undefined => (typeof v === 'string' && /^[A-Za-z]:\\/.test(v) && v.length < 600 ? v : undefined);
  for (const item of list as Array<{ exe?: unknown; name?: unknown; path?: unknown; logo?: unknown }>) {
    const exe = typeof item.exe === 'string' ? item.exe.toLowerCase().trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!/^[\w .()&+-]{1,80}\.exe$/.test(exe) || !name || byExe.has(exe)) continue;
    const app: InstalledApp = { exe, name: name.slice(0, 80) };
    const path = file(item.path);
    const logo = file(item.logo);
    if (path) app.path = path;
    if (logo) app.logo = logo;
    byExe.set(exe, app);
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
