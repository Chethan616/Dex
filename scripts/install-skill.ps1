<#
.SYNOPSIS
    Dex -- registers the windows-desktop-control MCP server + skill with OpenClaw.

.DESCRIPTION
    Run this AFTER OpenClaw is installed and the gateway is reachable. It:
      1. Copies the SKILL.md into the user-scope skills directory
         (%USERPROFILE%\.agents\skills\windows-desktop-control\)
      2. Registers the MCP server with OpenClaw via `openclaw mcp add`
      3. Probes it to confirm OpenClaw can spawn it
      4. Reloads OpenClaw's skill registry

    Idempotent. Safe to re-run after edits.

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

# ---- 2. Register MCP server ----
# OpenClaw's `openclaw mcp add` command was verified from vendor/openclaw/docs/cli/mcp.md.
# We invoke the UFO2 venv's python directly so the subprocess inherits UFO2's deps.
$ufoVenvPy = Join-Path $repoRoot 'vendor\UFO\.venv\Scripts\python.exe'
if (-not (Test-Path $ufoVenvPy)) {
    Write-Host "UFO2 venv not found at $ufoVenvPy. Complete Phase 2 first." -ForegroundColor Yellow
    Write-Host "(Falling back to system python -- this works if vendor/UFO is on the system venv's path, but the venv path is preferred.)" -ForegroundColor DarkGray
    $ufoVenvPy = 'python'
}

$serverPy = Join-Path $skillDir 'server.py'

Write-Host ""
Write-Host "Registering windows-desktop-control with OpenClaw..." -ForegroundColor Cyan
& openclaw mcp add windows-desktop-control `
    --command $ufoVenvPy `
    --arg $serverPy `
    --cwd $skillDir
if ($LASTEXITCODE -ne 0) {
    Write-Host "openclaw mcp add returned $LASTEXITCODE." -ForegroundColor Red
    Write-Host "If it says 'already exists', re-run with --force or use: openclaw mcp set windows-desktop-control ..." -ForegroundColor DarkGray
    exit $LASTEXITCODE
}

# ---- 3. Probe ----
Write-Host ""
Write-Host "Probing the MCP server (smoke test)..." -ForegroundColor Cyan
& openclaw mcp doctor windows-desktop-control --probe
if ($LASTEXITCODE -ne 0) {
    Write-Host "Probe failed. Check OpenClaw's logs and the MCP server's stderr." -ForegroundColor Red
    exit $LASTEXITCODE
}

# ---- 4. Reload skills ----
Write-Host ""
Write-Host "Reloading skills..." -ForegroundColor Cyan
& openclaw mcp reload

Write-Host ""
Write-Host "Done. The agent should now have 'windows-desktop-control' available." -ForegroundColor Green
Write-Host "Verify by asking from any channel: 'open Calculator and compute 12 * 9'." -ForegroundColor DarkGray
