<#
.SYNOPSIS
Stop every DEX background process — daemon and agent servers.

.DESCRIPTION
Development leaves these behind. A Ctrl+C in the terminal running run-dev.ps1
kills the core, but the daemon and the three agent servers were started with
Start-Process and outlive it.

That matters more than untidiness. Windows named pipes allow many server
instances under one name, so a second daemon does not fail to start — it joins
the rota and requests go to whichever instance answers first. Seven had
accumulated here, several running weeks-old code, which is why the same command
worked one minute and not the next.

The daemon now refuses to start alongside another, so this is the way to clear
the field first.
#>
param([switch]$Quiet)

$patterns = 'DexDaemon\.py', 'daemon_service\.py', 'agents[\\/](desktop|app|browser)[\\/]server\.py'
$regex = ($patterns -join '|')

# Only genuine python processes. Matching on the command line alone also matches
# whatever shell launched one, since the path appears in its command line too —
# the first version of this script killed its own terminal.

$found = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -like 'python*' -and $_.CommandLine -and $_.CommandLine -match $regex }

if (-not $found) {
    if (-not $Quiet) { Write-Host 'No DEX processes running.' -ForegroundColor DarkGray }
    return
}

foreach ($p in $found) {
    $what = if ($p.CommandLine -match 'DexDaemon|daemon_service') { 'daemon' }
            elseif ($p.CommandLine -match 'desktop') { 'desktop agent' }
            elseif ($p.CommandLine -match 'app') { 'app agent' }
            else { 'browser agent' }
    if (-not $Quiet) { Write-Host "  stopping $what (pid $($p.ProcessId))" -ForegroundColor DarkGray }
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Milliseconds 400

$left = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -like 'python*' -and $_.CommandLine -and $_.CommandLine -match $regex }

if ($left) {
    Write-Host "WARNING: $($left.Count) process(es) would not stop." -ForegroundColor Yellow
    $left | ForEach-Object { Write-Host "  pid $($_.ProcessId)" -ForegroundColor Yellow }
} elseif (-not $Quiet) {
    Write-Host "Stopped $($found.Count) DEX process(es)." -ForegroundColor Green
}
