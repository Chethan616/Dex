$ErrorActionPreference = 'Stop'

# DEX is a Squirrel.Windows install: per user, under %LocalAppData%\dex_desktop,
# with Update.exe as its uninstaller. It needs no elevation, and must run as
# the user who installed it (an elevated run under another account would look
# in the wrong %LocalAppData%).
$updateExe = Join-Path $env:LOCALAPPDATA 'dex_desktop\Update.exe'

if (Test-Path $updateExe) {
  $proc = Start-Process -FilePath $updateExe -ArgumentList '--uninstall', '-s' -Wait -PassThru
  if ($proc.ExitCode -ne 0) {
    throw "DEX's uninstaller exited with code $($proc.ExitCode)."
  }
} else {
  Write-Warning "DEX's uninstaller wasn't found at $updateExe; it may already be removed."
}
