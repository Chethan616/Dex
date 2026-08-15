<#
.SYNOPSIS
One-time Full Access setup. Installs the DEX Daemon as a Windows Service (LocalSystem).
After this, DEX never asks for admin privileges again — even for registry writes.

Requires: Run as Administrator (once, ever).
#>
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
    Write-Host 'This script requires Administrator — this is the ONE-TIME prompt.' -ForegroundColor Yellow
    Write-Host 'Re-run in an elevated PowerShell, then you will never need it again.' -ForegroundColor Yellow
    exit 1
}

Write-Host 'Installing DEX Daemon as a Windows Service (LocalSystem)...' -ForegroundColor Cyan

# Stop and remove existing service if present
$svc = Get-Service -Name 'DexDaemon' -ErrorAction SilentlyContinue
if ($svc) {
    Write-Host 'Removing existing DexDaemon service...' -ForegroundColor DarkGray
    if ($svc.Status -eq 'Running') { Stop-Service 'DexDaemon' -Force }
    python daemon/daemon_service.py remove
}

# Install and start
python daemon/daemon_service.py install
python daemon/daemon_service.py start

# Confirm service is running
$svc = Get-Service -Name 'DexDaemon' -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq 'Running') {
    Write-Host 'DexDaemon service is RUNNING.' -ForegroundColor Green
} else {
    Write-Host 'WARNING: Service installed but may not have started yet. Check Event Viewer.' -ForegroundColor Yellow
}

# Set DEX_FULL_ACCESS as a system env var so the service process can read it
[System.Environment]::SetEnvironmentVariable('DEX_FULL_ACCESS', 'true', 'Machine')
Write-Host 'System env DEX_FULL_ACCESS=true set.' -ForegroundColor DarkGray

# Write FULL_ACCESS=true into .env
if (Test-Path '.env') {
    $env = Get-Content '.env' -Raw
    if ($env -match 'FULL_ACCESS=') {
        $env = $env -replace 'FULL_ACCESS=\S*', 'FULL_ACCESS=true'
    } else {
        $env = $env.TrimEnd() + "`nFULL_ACCESS=true`n"
    }
    Set-Content '.env' $env -Encoding utf8
} else {
    Add-Content '.env' 'FULL_ACCESS=true'
}

Write-Host ''
Write-Host 'Full Access enabled.' -ForegroundColor Green
Write-Host 'DEX Daemon runs as LocalSystem and auto-starts on every Windows boot.' -ForegroundColor Green
Write-Host 'No admin prompts — ever again.' -ForegroundColor Green
