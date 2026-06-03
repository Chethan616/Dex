<#
.SYNOPSIS
    Dex -- registers the windows-desktop-control MCP server + skill with OpenClaw.

.DESCRIPTION
    Run this AFTER OpenClaw is installed and the gateway is reachable. It:
      1. Copies the SKILL.md into the user-scope skills directory
         (%USERPROFILE%\.agents\skills\windows-desktop-control\)
      2. Registers the MCP server with OpenClaw via `openclaw mcp set`
         (the real command shape on this OpenClaw version takes a JSON blob).
      3. Verifies the registration with `openclaw mcp show`.

    Idempotent. Safe to re-run -- `mcp set` overwrites the existing entry.

.EXAMPLE
    .\scripts\install-skill.ps1
#>

[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$skillDir = Join-Path $repoRoot 'glue\windows-desktop-control'

# ---- Locate openclaw CLI ----
$openclaw = Get-Command openclaw -ErrorAction SilentlyContinue
if (-not $openclaw) {
    Write-Host "openclaw CLI not on PATH. Install with: npm install -g openclaw@latest" -ForegroundColor Red
    exit 1
}

# ---- 1. Mirror SKILL.md into the user-scope skills directory ----
$userSkillsRoot = Join-Path $env:USERPROFILE '.agents\skills'
$targetSkillDir = Join-Path $userSkillsRoot 'windows-desktop-control'

if (-not (Test-Path $userSkillsRoot)) {
    New-Item -ItemType Directory -Path $userSkillsRoot -Force | Out-Null
}
if (Test-Path $targetSkillDir) {
    if (-not $Force) {
        Write-Host ("Skill dir already exists at {0}." -f $targetSkillDir) -ForegroundColor Yellow
        Write-Host "Re-run with -Force to overwrite." -ForegroundColor DarkGray
    } else {
        Remove-Item -Recurse -Force $targetSkillDir
        New-Item -ItemType Directory -Path $targetSkillDir | Out-Null
        Copy-Item (Join-Path $skillDir 'SKILL.md') $targetSkillDir
        Write-Host ("Skill mirrored to {0}" -f $targetSkillDir) -ForegroundColor Green
    }
} else {
    New-Item -ItemType Directory -Path $targetSkillDir | Out-Null
    Copy-Item (Join-Path $skillDir 'SKILL.md') $targetSkillDir
    Write-Host ("Skill installed at {0}" -f $targetSkillDir) -ForegroundColor Green
}

# ---- 2. Register MCP server via `openclaw mcp set <name> <json>` ----
# Confirmed from `openclaw mcp set --help` on OpenClaw 2026.5.28 (e932160):
#   Arguments: name, value (JSON object, e.g. {"command":"uvx","args":["context7-mcp"]})
# Subcommands available: list, serve, set, show, unset. There is no `add`,
# `doctor`, or `reload` in this version.

$ufoVenvPy = Join-Path $repoRoot 'vendor\UFO\.venv\Scripts\python.exe'
if (-not (Test-Path $ufoVenvPy)) {
    Write-Host ("UFO2 venv not found at {0}. Complete Phase 2 first (create venv + pip install)." -f $ufoVenvPy) -ForegroundColor Yellow
    Write-Host "Falling back to system 'python' on PATH. The MCP server will fail at runtime unless that python can `import ufo`." -ForegroundColor DarkGray
    $ufoVenvPy = 'python'
}

$serverPy = Join-Path $skillDir 'server.py'

$configObj = [ordered]@{
    command = $ufoVenvPy
    args    = @($serverPy)
    cwd     = $skillDir
}
$configJson = ($configObj | ConvertTo-Json -Compress)

Write-Host ""
Write-Host "Registering windows-desktop-control with OpenClaw..." -ForegroundColor Cyan
Write-Host ("  config = {0}" -f $configJson) -ForegroundColor DarkGray

# PowerShell 5.1 strips the inner quotes when handing a JSON-looking string
# to a native .exe / Node CLI. Escape each `"` with a backslash so the
# Node argv parser receives the literal JSON intact.
$configEscaped = $configJson -replace '"', '\"'
& openclaw mcp set windows-desktop-control $configEscaped
if ($LASTEXITCODE -ne 0) {
    Write-Host ("openclaw mcp set returned {0}." -f $LASTEXITCODE) -ForegroundColor Red
    Write-Host "If you see 'Invalid JSON' above, your shell may be eating quotes." -ForegroundColor DarkGray
    Write-Host "Workaround: write the JSON to a file and use --% stop-parsing, or run in cmd.exe." -ForegroundColor DarkGray
    exit $LASTEXITCODE
}

# ---- 3. Verify with `openclaw mcp show` ----
Write-Host ""
Write-Host "Verifying registration..." -ForegroundColor Cyan
& openclaw mcp show windows-desktop-control
if ($LASTEXITCODE -ne 0) {
    Write-Host "show returned non-zero -- the entry may not have been written." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Done. To pick up the new server, restart the OpenClaw gateway:" -ForegroundColor Green
Write-Host "    openclaw gateway stop" -ForegroundColor DarkGray
Write-Host "    openclaw gateway --port 18789 --verbose" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Then try the golden path from Dex or any connected channel:" -ForegroundColor Green
Write-Host "    open Calculator and compute 12 * 9" -ForegroundColor DarkGray
