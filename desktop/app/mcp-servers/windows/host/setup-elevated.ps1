# One-time setup of DEX's elevated helper (docs/desktop-control/PLAN.md §6):
# run once as administrator (the only Windows prompt). Afterwards DEX makes
# allowlisted admin changes — DNS, adapters, devices, services, Winsock, a
# restore point — without asking Windows each time; whether DEX asks *you*
# is still your Approvals setting.
#
#   1. Copy host.ps1 where only administrators can write it, so no program
#      running as you can change what runs elevated.
#   2. Register the task \DEX\Elevated: that script, as you, with highest
#      privileges, started on demand (schtasks /run — no prompt).
param(
  [Parameter(Mandatory)][string]$HostScript,
  [Parameter(Mandatory)][string]$DeskHome,
  [Parameter(Mandatory)][string]$User,
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:ProgramData 'DEX\elevated'

if ($Remove) {
  Unregister-ScheduledTask -TaskName 'Elevated' -TaskPath '\DEX\' -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
  exit 0
}

New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item -Force $HostScript (Join-Path $dir 'host.ps1')
# Administrators and SYSTEM: full. Everyone else (Users): read and run only.
& icacls.exe $dir /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null

$argLine = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dir\host.ps1`" -Elevated -DeskHome `"$DeskHome`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argLine
$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'Elevated' -TaskPath '\DEX\' -Action $action -Principal $principal -Settings $settings -Force | Out-Null
exit 0
