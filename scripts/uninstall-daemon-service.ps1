<#
.SYNOPSIS
Revoke Full Access. Stops and removes the DEX Daemon Windows Service.
#>
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
    Write-Host 'Requires Administrator to remove a Windows Service.' -ForegroundColor Red
    exit 1
}

$svc = Get-Service -Name 'DexDaemon' -ErrorAction SilentlyContinue
if ($svc) {
    if ($svc.Status -eq 'Running') { Stop-Service 'DexDaemon' -Force }
    python daemon/daemon_service.py remove
    Write-Host 'DexDaemon service removed.' -ForegroundColor Green
} else {
    Write-Host 'DexDaemon service not found — nothing to remove.' -ForegroundColor DarkGray
}

# Clear system env var
[System.Environment]::SetEnvironmentVariable('DEX_FULL_ACCESS', $null, 'Machine')

# Set FULL_ACCESS=false in .env
if (Test-Path '.env') {
    $env = Get-Content '.env' -Raw
    $env = $env -replace 'FULL_ACCESS=\S*', 'FULL_ACCESS=false'
    Set-Content '.env' $env -Encoding utf8
    Write-Host 'FULL_ACCESS set to false in .env.' -ForegroundColor Green
}
