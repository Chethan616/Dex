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
    the extension packed into a CRX by a command printed in a comment in
                  another script, with a signing key at the repo root that
                  nothing tracks. Repacked here, and the manifest version and
                  the update manifest are bumped together, because Chrome will
                  not re-fetch an extension whose version has not changed.
    the agents    three requirements.txt files, one of which setup.ps1
                  installs.

  Chrome is closed politely and never with -Force. Chrome writes Preferences on
  a clean exit, and that file is where an installed extension is recorded — a
  forced kill discards it, which is how a load-unpacked install disappears.

.PARAMETER Fast
  Skip the Flutter build. For a core- or agent-only change.

.PARAMETER NoStart
  Build everything and stop, without launching.

.PARAMETER Extension
  Repack the extension even when it looks unchanged.
#>
[CmdletBinding()]
param(
    [switch]$Fast,
    [switch]$NoStart,
    [switch]$Extension
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

# Chrome is deliberately left alone. It is the owner's browser with their
# session in it, and Dex has no business closing it to rebuild itself.
$chrome = @(Get-Process chrome -ErrorAction SilentlyContinue)
if ($chrome.Count -gt 0) {
    Ok "Chrome left running ($($chrome.Count) processes) - the extension reconnects on its own"
}

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

# ── the extension ───────────────────────────────────────────────────────────
Step 'Extension'
$crx = 'dist\dex-extension.crx'
$pem = 'extension.pem'
$newestExt = Get-ChildItem 'extension' -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in '.js', '.json', '.html', '.css' } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
$packed = if (Test-Path $crx) { (Get-Item $crx).LastWriteTime } else { [datetime]::MinValue }

if (-not $Extension -and $newestExt -and $newestExt.LastWriteTime -le $packed) {
    Ok 'up to date'
} elseif (-not (Test-Path $pem)) {
    # The key decides the extension id, and the id is what the force-install
    # policy names. Repacking without it would produce a different extension
    # that the policy does not install and Chrome treats as unrelated.
    Ok "no $pem - the unpacked extension still works; skipping the CRX"
} else {
    $chromeExe = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
    if (-not (Test-Path $chromeExe)) {
        Ok 'Chrome not found - skipping the CRX'
    } else {
        # Bump the version in both places, together. Chrome ignores an update
        # whose version has not moved, so a CRX with new code and an old
        # version number is a repack that changes nothing.
        $manifestPath = 'extension\manifest.json'
        $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
        $parts = $manifest.version.Split('.')
        $parts[-1] = [string]([int]$parts[-1] + 1)
        $version = $parts -join '.'
        $manifest.version = $version
        # No BOM. PowerShell 5.1's -Encoding utf8 writes one, and a manifest
        # that starts with a byte-order mark is not valid JSON to anything
        # stricter than Chrome - every tool that reads it here choked.
        [System.IO.File]::WriteAllText(
            (Join-Path $repo $manifestPath),
            ($manifest | ConvertTo-Json -Depth 20),
            (New-Object System.Text.UTF8Encoding $false)
        )
        Ok "version -> $version"

        & $chromeExe "--pack-extension=$repo\extension" "--pack-extension-key=$repo\$pem" | Out-Null
        Start-Sleep -Milliseconds 700

        if (Test-Path 'extension.crx') {
            New-Item -ItemType Directory -Force -Path 'dist' | Out-Null
            Move-Item 'extension.crx' $crx -Force
            $xml = @"
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='joachahcdjdaeeiiocbooimlfbojagmm'>
    <updatecheck codebase='http://127.0.0.1:8766/extension/dex.crx' version='$version' />
  </app>
</gupdate>
"@
            [System.IO.File]::WriteAllText(
                (Join-Path $repo 'dist\update.xml'),
                $xml,
                (New-Object System.Text.UTF8Encoding $false)
            )
            Ok "packed $crx and update.xml at $version"
        } else {
            Bad 'crx' 'chrome --pack-extension produced no crx'
        }
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

Write-Host ''
Write-Host 'If the Dex extension is not loaded in your Chrome yet:' -ForegroundColor Yellow
Write-Host "  chrome://extensions -> Developer mode -> Load unpacked -> $repo\extension"
Write-Host '  or run scripts\install-extension-policy.ps1 as administrator, once, to force-install it.'
