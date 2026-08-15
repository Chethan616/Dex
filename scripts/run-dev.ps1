<#
.SYNOPSIS
DEX V3 development startup.
Launches: daemon (requires elevation) + Desktop Agent server + TypeScript CLI.

.PARAMETER DaemonOnly      Start only the privileged daemon
.PARAMETER CoreOnly        Start only TypeScript core (daemon + desktop already running)
.PARAMETER NoDesktop       Skip the Desktop Agent server (Slice 1 only)
#>
param(
    [switch]$DaemonOnly,
    [switch]$CoreOnly,
    [switch]$NoDesktop
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not (Test-Path '.env')) {
    Write-Host 'ERROR: .env not found. Copy .env.example to .env and fill in ANTHROPIC_API_KEY.' -ForegroundColor Red
    exit 1
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $CoreOnly) {
    if (-not $isAdmin) {
        Write-Host 'WARNING: Not running as Administrator.' -ForegroundColor Yellow
        Write-Host 'System Agent (DNS/registry changes) requires elevation.' -ForegroundColor Yellow
        Write-Host 'Run install-daemon-service.ps1 once as Admin to set up Full Access.' -ForegroundColor Yellow
        Write-Host ''
    }

    # Check if daemon service is already running
    $svc = Get-Service -Name 'DexDaemon' -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq 'Running') {
        Write-Host 'DexDaemon service already running (Full Access mode).' -ForegroundColor Green
    } else {
        Write-Host 'Starting DEX Daemon (standalone)...' -ForegroundColor Cyan
        $daemon = Start-Process python -ArgumentList 'daemon/DexDaemon.py' -PassThru -WindowStyle Minimized
        Write-Host "Daemon PID: $($daemon.Id)" -ForegroundColor DarkGray
        Start-Sleep -Milliseconds 800
    }
}

if (-not $CoreOnly -and -not $NoDesktop) {
    Write-Host 'Starting Desktop Agent Server...' -ForegroundColor Cyan
    $desktop = Start-Process python -ArgumentList 'agents/desktop/server.py' -PassThru -WindowStyle Minimized
    Write-Host "Desktop Agent PID: $($desktop.Id)" -ForegroundColor DarkGray
    Start-Sleep -Milliseconds 1000
}

if (-not $DaemonOnly) {
    Write-Host 'Starting DEX Core (CLI)...' -ForegroundColor Cyan
    npx ts-node src/main.ts
}
