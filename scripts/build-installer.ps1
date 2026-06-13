# build-installer.ps1 — assemble the all-in-one Dex.msi
#
# Bundles EVERYTHING the user needs into one installer: the Flutter app,
# a portable Node runtime, the dexagent gateway, the MCP drivers, and
# the UFO² / browser-use Python runtimes with their prebuilt venvs.
# After install, launching Dex.exe spawns its own gateway (see
# app/lib/core/gateway_process.dart) — no npm, no Python, no terminal.
#
# Prereqs (build machine only):
#   - Flutter SDK, Node 24, pnpm (the dev stack you already have)
#   - WiX v5:  dotnet tool install --global wix
#   - Working venvs at vendor/UFO/.venv + vendor/browser-use/.venv
#     (they are packaged as-is — venvs are machine-arch specific, which
#     is fine: we build on x64 Windows for x64 Windows)
#
# Usage:
#   .\scripts\build-installer.ps1                 # full build
#   .\scripts\build-installer.ps1 -SkipFlutter    # reuse existing release build
#   .\scripts\build-installer.ps1 -SkipNodeDownload
#
# Output: installer\Dex.msi

param(
    [switch]$SkipFlutter,
    [switch]$SkipNodeDownload,
    [string]$NodeVersion = "24.4.1"
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$payload = Join-Path $repo 'installer\payload'
$runtime = Join-Path $payload 'runtime'

function Stage([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# ---- 0. clean payload -------------------------------------------------------
Stage "Cleaning payload staging dir"
if (Test-Path $payload) { Remove-Item $payload -Recurse -Force }
New-Item -ItemType Directory -Force $runtime | Out-Null

# ---- 1. Flutter release build ----------------------------------------------
if (-not $SkipFlutter) {
    Stage "Building Flutter app (release)"
    Push-Location (Join-Path $repo 'app')
    flutter build windows --release
    if ($LASTEXITCODE -ne 0) { throw "flutter build failed" }
    Pop-Location
}
$flutterOut = Join-Path $repo 'app\build\windows\x64\runner\Release'
if (-not (Test-Path "$flutterOut\dex.exe")) { throw "missing $flutterOut\dex.exe -- run without -SkipFlutter" }
Stage "Staging app files"
Copy-Item "$flutterOut\*" $payload -Recurse -Force

# ---- 2. Portable Node -------------------------------------------------------
$nodeDir = Join-Path $runtime 'node'
if (-not $SkipNodeDownload) {
    Stage "Fetching portable Node $NodeVersion (~30 MB)"
    $zip = Join-Path $env:TEMP "node-v$NodeVersion-win-x64.zip"
    if (-not (Test-Path $zip)) {
        Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" -OutFile $zip
    }
    Expand-Archive $zip -DestinationPath $env:TEMP -Force
    New-Item -ItemType Directory -Force $nodeDir | Out-Null
    Copy-Item "$env:TEMP\node-v$NodeVersion-win-x64\*" $nodeDir -Recurse -Force
} else {
    Stage "Skipping Node download (copy node.exe into payload\runtime\node manually)"
    New-Item -ItemType Directory -Force $nodeDir | Out-Null
}

# ---- 3. dexagent (gateway) --------------------------------------------------
# npm pack + install the tarball with production deps only -- clean,
# reproducible, no dev cruft, no junctions.
Stage "Packing dexagent (pnpm build must be current)"
Push-Location (Join-Path $repo 'dex\core')
$tarball = (npm pack --silent | Select-Object -Last 1).Trim()
Pop-Location
$tarPath = Join-Path $repo "dex\core\$tarball"
Stage "Installing dexagent runtime into payload (production deps)"
$tmpPrefix = Join-Path $env:TEMP 'dex-installer-npm'
if (Test-Path $tmpPrefix) { Remove-Item $tmpPrefix -Recurse -Force }
New-Item -ItemType Directory -Force $tmpPrefix | Out-Null
npm install --prefix $tmpPrefix $tarPath --omit=dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm install of dexagent tarball failed" }
Copy-Item "$tmpPrefix\node_modules\dexagent" (Join-Path $runtime 'dexagent') -Recurse -Force
# Hoisted production deps must travel with the package:
New-Item -ItemType Directory -Force (Join-Path $runtime 'dexagent\node_modules') | Out-Null
Get-ChildItem "$tmpPrefix\node_modules" -Exclude 'dexagent','.package-lock.json' |
    Copy-Item -Destination (Join-Path $runtime 'dexagent\node_modules') -Recurse -Force
Remove-Item $tarPath -Force

# ---- 4. Drivers + vendor runtimes -------------------------------------------
Stage "Staging MCP drivers"
Copy-Item (Join-Path $repo 'dex\drivers') (Join-Path $runtime 'drivers') -Recurse -Force

Stage "Staging UFO² + browser-use (sources + prebuilt venvs; this is the big copy)"
$vendorOut = Join-Path $runtime 'vendor'
New-Item -ItemType Directory -Force $vendorOut | Out-Null
# robocopy excludes the giant caches that the runtimes don't need.
robocopy (Join-Path $repo 'vendor\UFO') (Join-Path $vendorOut 'UFO') /E /NFL /NDL /NJH /NJS `
    /XD .git logs __pycache__ | Out-Null
robocopy (Join-Path $repo 'vendor\browser-use') (Join-Path $vendorOut 'browser-use') /E /NFL /NDL /NJH /NJS `
    /XD .git logs __pycache__ playwright-cache | Out-Null

# ---- 5. WiX build -------------------------------------------------------------
Stage "Building Dex.msi (WiX v5)"
Push-Location (Join-Path $repo 'installer')
wix build Dex.wxs -o Dex.msi
if ($LASTEXITCODE -ne 0) { throw "wix build failed (dotnet tool install --global wix)" }
Pop-Location

$msi = Join-Path $repo 'installer\Dex.msi'
$size = [math]::Round((Get-Item $msi).Length / 1MB)
Stage "DONE -> $msi (${size} MB)"
Write-Host "Smoke: install on a clean VM, launch Dex from Start Menu," -ForegroundColor Green
Write-Host "sign up -> onboarding -> paste a Gemini key -> chat works" -ForegroundColor Green
Write-Host "with ZERO terminals and ZERO external installs." -ForegroundColor Green
