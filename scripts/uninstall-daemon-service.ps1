<#
.SYNOPSIS
Revoke Full Access. Removes the elevated logon task and stops the daemon.

.DESCRIPTION
After this, DEX runs with whatever rights the terminal you start it from has —
so DNS, wifi, power plans and HKLM registry writes will fail until you either
re-install or run the daemon from an Administrator terminal.

Also removes the old LocalSystem service if one is left over from before the
scheduled-task approach, so an upgrade does not leave two daemons behind.
#>
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$TaskName = 'DexDaemon'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
    Write-Host 'Removing an elevated task needs Administrator. Re-run elevated.' -ForegroundColor Yellow
    exit 1
}

& (Join-Path $PSScriptRoot 'stop-dex.ps1') -Quiet

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'." -ForegroundColor Green
} else {
    Write-Host "No scheduled task '$TaskName'." -ForegroundColor DarkGray
}

# Legacy: the LocalSystem service this project used to try to install.
$svc = Get-Service -Name $TaskName -ErrorAction SilentlyContinue
if ($svc) {
    if ($svc.Status -eq 'Running') { Stop-Service $TaskName -Force }
    & sc.exe delete $TaskName | Out-Null
    Write-Host 'Removed the legacy DexDaemon service.' -ForegroundColor Green
}

if (Test-Path '.env') {
    $envText = Get-Content '.env' -Raw
    if ($envText -match 'FULL_ACCESS=') {
        Set-Content '.env' ($envText -replace 'FULL_ACCESS=\S*', 'FULL_ACCESS=false') -Encoding utf8
    }
}
[System.Environment]::SetEnvironmentVariable('DEX_FULL_ACCESS', $null, 'Machine')

Write-Host ''
Write-Host 'Full Access revoked.' -ForegroundColor Green
Write-Host 'Start the daemon by hand with: python daemon/DexDaemon.py' -ForegroundColor DarkGray
