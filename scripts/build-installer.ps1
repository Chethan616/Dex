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
#   - Engine venvs built via `dex engines setup` into ~/.dex/engines
#     (clones UFO², pip-installs browser-use + Playwright Chromium).
#     Override the source with $env:DEX_ENGINES_DIR; falls back to a
#     local vendor/ tree if one exists. Venvs are packaged as-is — they
#     are arch-specific, which is fine: x64 Windows builds for x64.
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
Stage "Staging app files (as main executable Dex.exe)"
Copy-Item "$flutterOut\*" $payload -Recurse -Force
if (Test-Path (Join-Path $payload 'dex.exe')) {
    Rename-Item (Join-Path $payload 'dex.exe') 'Dex.exe'
}

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

# ---- 4. Vendor runtimes (drivers ship INSIDE the dexagent package now) ------
# The MCP driver sources travel inside the dexagent tarball (dex/core/drivers
# → runtime\dexagent\drivers), so there's no separate drivers copy. Only the
# heavy Python venvs need staging here.
Stage "Staging UFO² + browser-use (sources + prebuilt venvs; this is the big copy)"
# Engines are NOT vendored in the repo anymore. Build them on this
# machine first with `dex engines setup` (clones UFO, pip-installs
# browser-use + Playwright) into ~/.dex/engines, then bundle from there.
# Fall back to a local vendor/ tree if one still exists (transition).
$enginesSrc = if ($env:DEX_ENGINES_DIR) { $env:DEX_ENGINES_DIR }
              elseif (Test-Path (Join-Path $env:USERPROFILE '.dex\engines\UFO')) {
                  Join-Path $env:USERPROFILE '.dex\engines'
              } else { Join-Path $repo 'vendor' }
Stage "  engine source: $enginesSrc"
$ufoSrc = Join-Path $enginesSrc 'UFO'
$browserSrc = Join-Path $enginesSrc 'browser-use'
if (-not (Test-Path (Join-Path $ufoSrc '.venv')) -or -not (Test-Path (Join-Path $browserSrc '.venv'))) {
    throw "Missing engine venvs under $enginesSrc. Run ``dex engines setup`` first (builds ~/.dex/engines)."
}
$vendorOut = Join-Path $runtime 'vendor'
New-Item -ItemType Directory -Force $vendorOut | Out-Null
# robocopy excludes the giant caches that the runtimes don't need.
robocopy $ufoSrc (Join-Path $vendorOut 'UFO') /E /NFL /NDL /NJH /NJS `
    /XD .git logs __pycache__ | Out-Null
robocopy $browserSrc (Join-Path $vendorOut 'browser-use') /E /NFL /NDL /NJH /NJS `
    /XD .git logs __pycache__ playwright-cache | Out-Null

# ---- 4b. Windowless gateway launcher (Startup-folder shortcut targets it) ---
Stage "Writing start-gateway.vbs (logon auto-start, no console window)"
$vbs = @'
' Dex gateway launcher. Starts the bundled gateway with NO console window
' (WScript.Shell.Run mode 0 = hidden, False = do not wait). The Startup-
' folder shortcut from Dex.wxs points wscript.exe at this file, so the
' gateway -- with its built-in UFO2 + browser-use engines -- is up at logon.
Dim sh, fso, base, node, entry
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
node = base & "\runtime\node\node.exe"
entry = base & "\runtime\dexagent\dex.mjs"
sh.Run """" & node & """ """ & entry & """ gateway run --port 18789", 0, False
'@
Set-Content -Path (Join-Path $payload 'start-gateway.vbs') -Value $vbs -Encoding ASCII

# ---- 4bb. CLI launcher script wrapper ---------------------------------------
Stage "Writing Dex-Cli.cmd wrapper (makes CLI executable globally)"
$cliCmd = @'
@echo off
"%~dp0runtime\node\node.exe" "%~dp0runtime\dexagent\dex.mjs" %*
'@
Set-Content -Path (Join-Path $payload 'Dex-Cli.cmd') -Value $cliCmd -Encoding ASCII

# ---- 4c. Generate payload.wxs to bypass 65k component limit ------------------
Stage "Generating payload.wxs component groups"
$wxsFile = Join-Path $repo 'installer\payload.wxs'
$xml = [System.Text.StringBuilder]::new()
$xml.AppendLine('<?xml version="1.0" encoding="UTF-8"?>')
$xml.AppendLine('<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">')
$xml.AppendLine('  <Fragment>')
$xml.AppendLine('    <ComponentGroup Id="PayloadComponents">')

$files = Get-ChildItem -LiteralPath "\\?\$payload" -Recurse -File
$grouped = $files | Group-Object DirectoryName
$compIndex = 0

foreach ($group in $grouped) {
    $dirPath = $group.Name
    $relPath = ""
    if ($dirPath -ne "\\?\$payload") {
        $relPath = $dirPath.Substring(("\\?\$payload").Length + 1)
    }
    
    $guid = [Guid]::NewGuid().ToString()
    $compIndex++
    
    $xml.Append("      <Component Id=`"cmp_$compIndex`" Directory=`"INSTALLFOLDER`"")
    if ($relPath) {
        $escapedRelPath = [System.Security.SecurityElement]::Escape($relPath)
        $xml.Append(" Subdirectory=`"$escapedRelPath`"")
    }
    $xml.Append(" Guid=`"$guid`"")
    $xml.AppendLine(">")

    $isFirst = $true
    foreach ($file in $group.Group) {
        $sourcePath = $file.FullName
        $relSource = "payload" + $sourcePath.Substring(("\\?\$payload").Length)
        $escapedSource = [System.Security.SecurityElement]::Escape($relSource)
        
        $fileId = "file_$($compIndex)_$([Guid]::NewGuid().ToString().Replace('-', ''))"
        
        $xml.Append("        <File Id=`"$fileId`" Source=`"$escapedSource`"")
        if ($isFirst) {
            $xml.Append(" KeyPath=`"yes`"")
            $isFirst = $false
        }
        $xml.AppendLine(" />")
    }
    $xml.AppendLine("      </Component>")
}

$xml.AppendLine('    </ComponentGroup>')
$xml.AppendLine('  </Fragment>')
$xml.AppendLine('</Wix>')

[System.IO.File]::WriteAllText($wxsFile, $xml.ToString(), [System.Text.Encoding]::UTF8)
Write-Host "WiX payload fragment written to $wxsFile with $compIndex components."

# ---- 5. WiX build -------------------------------------------------------------
Stage "Building Dex.msi (WiX)"
$wixPath = "wix"
if (-not (Get-Command wix -ErrorAction SilentlyContinue)) {
    # Search in common locations
    $wixSearch = Get-ChildItem -Path "C:\Program Files\WiX Toolset v*\bin\wix.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($wixSearch) {
        $wixPath = $wixSearch.FullName
        Write-Host "Found wix at: $wixPath"
    } else {
        $wixSearch = Get-ChildItem -Path "C:\Program Files (x86)\WiX Toolset v*\bin\wix.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($wixSearch) {
            $wixPath = $wixSearch.FullName
            Write-Host "Found wix at: $wixPath"
        }
    }
}

Push-Location (Join-Path $repo 'installer')
# Accept OSMF EULA (required for WiX v7)
& $wixPath eula accept wix7 2>$null | Out-Null
& $wixPath build Dex.wxs payload.wxs -o Dex.msi
if ($LASTEXITCODE -ne 0) { throw "wix build failed" }
Pop-Location

$msi = Join-Path $repo 'installer\Dex.msi'
$size = [math]::Round((Get-Item $msi).Length / 1MB)
Stage "DONE -> $msi (${size} MB)"
Write-Host "Smoke: install on a clean VM, launch Dex from Start Menu," -ForegroundColor Green
Write-Host "sign up -> onboarding -> paste a Gemini key -> chat works" -ForegroundColor Green
Write-Host "with ZERO terminals and ZERO external installs." -ForegroundColor Green
