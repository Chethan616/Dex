<#
.SYNOPSIS
  Rebuild every part of Dex and start it.

.DESCRIPTION
  There was no such command, and "rebuild the core" meant different things in
  different places:

    the core      runs from TypeScript through ts-node, so it has no build at
                  all. `npm run build` compiles to dist/, which nothing on the
                  runtime path executes. A core change needs a restart, and the
                  thing that can actually fail is the typecheck — so that is
                  what this runs.
    the app       RUN.bat builds it only when the exe is missing, so every
                  change after the first was invisible until someone deleted
                  the binary by hand. This builds it whenever the source is
                  newer.
    the agents    three requirements.txt files, one of which setup.ps1
                  installs.
#>
[CmdletBinding()]
param(
    [switch]$Fast,
    [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$failed = @()
function Step($name) { Write-Host "`n== $name" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "   $msg" -ForegroundColor DarkGray }
function Bad($name, $msg) {
    Write-Host "   $msg" -ForegroundColor Red
    $script:failed += $name
}

# ── stop what is running ────────────────────────────────────────────────────
Step 'Stopping Dex'
& "$PSScriptRoot\stop-dex.ps1" -Quiet
Ok 'agents, core and app stopped'

# ── dependencies ────────────────────────────────────────────────────────────
Step 'Dependencies'
if (-not (Test-Path 'node_modules')) {
    Ok 'node_modules missing - npm install'
    npm install --no-fund --no-audit
    if ($LASTEXITCODE -ne 0) { Bad 'npm install' "npm install exited $LASTEXITCODE" }
} else {
    Ok 'node_modules present'
}

# All three, not one. SETUP.md also names agents/app/requirements.txt, which
# does not exist - the app agent's dependencies come from the desktop one.
foreach ($req in @('daemon\requirements.txt', 'agents\browser\requirements.txt', 'agents\desktop\requirements.txt')) {
    if (-not (Test-Path $req)) { continue }
    $stamp = Join-Path $env:LOCALAPPDATA "DEX\deps-$((Split-Path $req -Parent) -replace '[\\/]', '-').txt"
    $hash  = (Get-FileHash $req -Algorithm SHA256).Hash
    if ((Test-Path $stamp) -and (Get-Content $stamp -Raw).Trim() -eq $hash) {
        Ok "$req unchanged"
        continue
    }
    Ok "installing $req"
    python -m pip install --quiet --disable-pip-version-check -r $req
    if ($LASTEXITCODE -eq 0) {
        New-Item -ItemType Directory -Force -Path (Split-Path $stamp) | Out-Null
        Set-Content -Path $stamp -Value $hash -Encoding utf8
    } else {
        Bad 'pip' "$req failed"
    }
}

# ── the core ────────────────────────────────────────────────────────────────
Step 'Core'
Ok 'typechecking (the core runs from source - this is its build)'
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { Bad 'typecheck' 'tsc reported errors - the core will not be restarted' }
else { Ok 'clean' }

# ── the Flutter app ─────────────────────────────────────────────────────────
$exe = 'app\build\windows\x64\runner\Release\dex.exe'
if ($Fast) {
    Step 'App'
    Ok 'skipped (-Fast)'
} else {
    Step 'App'
    $newest = Get-ChildItem 'app\lib', 'app\pubspec.yaml', 'app\windows' -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $built = if (Test-Path $exe) { (Get-Item $exe).LastWriteTime } else { [datetime]::MinValue }

    if ($newest -and $newest.LastWriteTime -le $built) {
        Ok 'up to date'
    } else {
        Ok 'flutter build windows --release'
        Push-Location 'app'
        flutter build windows --release
        $code = $LASTEXITCODE
        Pop-Location
        if ($code -ne 0) { Bad 'flutter' "flutter build exited $code" } else { Ok 'built' }
    }
}

# ── report ──────────────────────────────────────────────────────────────────
Write-Host ''
if ($failed.Count -gt 0) {
    Write-Host "Rebuild failed: $($failed -join ', ')" -ForegroundColor Red
    exit 1
}
Write-Host 'Rebuild complete.' -ForegroundColor Green

if ($NoStart) { exit 0 }

Step 'Starting Dex'
if (-not (Test-Path $exe)) {
    Bad 'start' "$exe does not exist - run without -Fast"
    exit 1
}
# The app is the supervisor: it probes each port and starts only what is down.
Start-Process $exe
Ok 'started - the app brings up the daemon, agents and core'
