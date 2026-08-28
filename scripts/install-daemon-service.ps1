<#
.SYNOPSIS
Full Access, one time. Registers the DEX daemon to start elevated at logon.

.DESCRIPTION
Consent once, here, and DEX never asks for administrator again.

WHY A SCHEDULED TASK AND NOT A SERVICE
--------------------------------------
This script used to install DexDaemon as a Windows Service running as
LocalSystem. That was the wrong target twice over.

First, it never worked: daemon/daemon_service.py could not even be imported
(it reassigned __bases__ on a plain class, which CPython refuses), so the
one-time setup had never once completed. Nothing checked, so nobody noticed.

Second, and more important, it would have made things worse if it had. A
LocalSystem service runs in session 0, isolated from the desktop since Vista.
From there the audio endpoint is not yours, so set_volume would silently stop
working, and a launched app would appear on a desktop nobody is looking at.
Fixing DNS by breaking volume and app launching is not a fix.

What is actually needed is elevation *inside your own session*. A scheduled
task with RunLevel Highest, triggered at logon and running as you, gives
exactly that: administrator rights, your desktop, your audio endpoint, and no
UAC prompt after this one.

.PARAMETER NoStart
Register the task but do not start the daemon now.
#>
param([switch]$NoStart)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$TaskName = 'DexDaemon'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
    Write-Host ''
    Write-Host 'This needs Administrator once — and only once.' -ForegroundColor Yellow
    Write-Host 'Right-click PowerShell, Run as administrator, then:' -ForegroundColor Yellow
    Write-Host "    cd '$(Get-Location)'" -ForegroundColor DarkGray
    Write-Host '    .\scripts\install-daemon-service.ps1' -ForegroundColor DarkGray
    Write-Host ''
    Write-Host 'After that DEX starts elevated at logon and never prompts again.' -ForegroundColor Yellow
    exit 1
}

# Resolve a real python.exe. "python" on PATH is often a shim that re-launches
# a second process, which would leave the task tracking the wrong one.
$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { throw 'python is not on PATH.' }
$resolved = & $python -c "import sys; print(sys.executable)"
if ($resolved) { $python = $resolved.Trim() }

# pythonw.exe, not python.exe. python.exe is a console-subsystem binary, so
# Windows gives it a console window -- an "Administrator: python.exe" terminal
# sitting on the desktop for the life of the session. Setting Hidden on the task
# does not reliably suppress it. pythonw is the GUI-subsystem build of the same
# interpreter and allocates no console at all.
#
# The daemon logs to %LOCALAPPDATA%\DEX\daemon.log, which is the only output
# once there is no console -- and DexDaemon._log_handlers skips its stream
# handler when sys.stdout is None, which under pythonw it always is.
$pythonw = Join-Path (Split-Path $python -Parent) 'pythonw.exe'
if (Test-Path $pythonw) {
    $python = $pythonw
} else {
    Write-Host 'pythonw.exe not found beside python.exe — the daemon will have a console window.' -ForegroundColor Yellow
}

$daemon = Join-Path (Get-Location) 'daemon\DexDaemon.py'
if (-not (Test-Path $daemon)) { throw "Not found: $daemon" }

Write-Host "Python : $python" -ForegroundColor DarkGray
Write-Host 'Window : none (pythonw, hidden task)' -ForegroundColor DarkGray
Write-Host "Daemon : $daemon" -ForegroundColor DarkGray

# Stop anything already running, including strays from earlier dev sessions.
# Several daemons can serve one named pipe at once and answer unpredictably.
& (Join-Path $PSScriptRoot 'stop-dex.ps1') -Quiet

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host 'Replacing the existing task...' -ForegroundColor DarkGray
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute $python `
    -Argument "`"$daemon`"" -WorkingDirectory (Get-Location).Path

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Run as the logged-in user, elevated. Interactive is what keeps it in your
# session rather than session 0.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew -Hidden

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings `
    -Description 'DEX privileged daemon — elevated, in the owner session.' | Out-Null

Write-Host "Registered scheduled task '$TaskName' (elevated, at logon)." -ForegroundColor Green

if (-not $NoStart) {
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 2
    $info = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
    if ($info.LastTaskResult -eq 0 -or $info.LastTaskResult -eq 267009) {
        Write-Host 'Daemon started.' -ForegroundColor Green
    } else {
        Write-Host "Task result: $($info.LastTaskResult) — check Task Scheduler." -ForegroundColor Yellow
    }
}

# FULL_ACCESS relaxes confirmation tiers. It does NOT relax the RED registry
# band: security and policy keys stay refused whatever the privilege level.
# Elevation decides who gets asked; the band decides what is done at all.
if (Test-Path '.env') {
    $envText = Get-Content '.env' -Raw
    if ($envText -match 'FULL_ACCESS=') {
        $envText = $envText -replace 'FULL_ACCESS=\S*', 'FULL_ACCESS=true'
    } else {
        $envText = $envText.TrimEnd() + "`nFULL_ACCESS=true`n"
    }
    Set-Content '.env' $envText -Encoding utf8
} else {
    Set-Content '.env' "FULL_ACCESS=true`n" -Encoding utf8
}
[System.Environment]::SetEnvironmentVariable('DEX_FULL_ACCESS', 'true', 'Machine')

Write-Host ''
Write-Host 'Full Access enabled.' -ForegroundColor Green
Write-Host 'Verify it:  npm run conformance' -ForegroundColor DarkGray
Write-Host '  describe should now report elevated=true, session=1 (not 0),' -ForegroundColor DarkGray
Write-Host '  and set_dns should pass.' -ForegroundColor DarkGray
Write-Host 'Undo it:    .\scripts\uninstall-daemon-service.ps1' -ForegroundColor DarkGray
