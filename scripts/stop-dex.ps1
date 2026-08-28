<#
.SYNOPSIS
Stop every DEX background process — daemon and agent servers.

.DESCRIPTION
Development leaves these behind. Ctrl+C in the terminal running run-dev.ps1
kills the core, but the daemon and agent servers were started with Start-Process
and outlive it.

Two things make "did I stop it?" harder than it looks, and both were got wrong
the first time:

  * An unelevated process cannot read the command line of an elevated one. The
    first version filtered on CommandLine, so once Full Access was installed it
    reported "No DEX processes running" while the elevated daemon was very much
    alive. Reporting success while the thing is still running is worse than
    failing, because the next start then silently contends for the pipe.

  * The elevated daemon is owned by a scheduled task, so killing the process is
    the wrong verb — the task is what has to be stopped.

So this stops the task, kills what it can see, and then *checks the pipe*.
Whether something answers is the only honest answer to "is a daemon running".
#>
param([switch]$Quiet)

$ErrorActionPreference = 'Stop'
$PipeName = 'dex_privileged_daemon'

function Test-DaemonAlive {
    $client = New-Object System.IO.Pipes.NamedPipeClientStream(
        '.', $PipeName, [System.IO.Pipes.PipeDirection]::InOut)
    try {
        $client.Connect(600)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Say($text, $colour) { if (-not $Quiet) { Write-Host $text -ForegroundColor $colour } }

$stopped = 0

# 1. The scheduled task owns the elevated daemon. Stopping the task is what
#    actually ends it; you can stop your own task without elevation.
$task = Get-ScheduledTask -TaskName 'DexDaemon' -ErrorAction SilentlyContinue
if ($task -and $task.State -eq 'Running') {
    Say '  stopping the DexDaemon logon task' DarkGray
    try { Stop-ScheduledTask -TaskName 'DexDaemon'; $stopped++ } catch {
        Say "  could not stop the task: $($_.Exception.Message)" Yellow
    }
    Start-Sleep -Milliseconds 700
}

# 2. Anything started by hand, which we can see and identify.
$patterns = 'DexDaemon\.py', 'daemon_service\.py', 'agents[\\/](desktop|app|browser)[\\/]server\.py'
$regex = ($patterns -join '|')

# The headless core is a node process with no window, so there is nothing to
# close by hand. Matched separately because it is not python.
$coreRegex = 'ts-node.*src[\/]main\.ts'

$visible = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -like 'python*' -and $_.CommandLine -and $_.CommandLine -match $regex }

foreach ($p in $visible) {
    $what = if ($p.CommandLine -match 'DexDaemon|daemon_service') { 'daemon' }
            elseif ($p.CommandLine -match 'desktop') { 'desktop agent' }
            elseif ($p.CommandLine -match 'app') { 'app agent' }
            else { 'browser agent' }
    Say "  stopping $what (pid $($p.ProcessId))" DarkGray
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    $stopped++
}

# 2b. The headless core.
$cores = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -like 'node*' -and $_.CommandLine -and $_.CommandLine -match $coreRegex }
foreach ($p in $cores) {
    Say "  stopping core (pid $($p.ProcessId))" DarkGray
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    $stopped++
}

Start-Sleep -Milliseconds 500

# 3. Ask the pipe, rather than trusting the process list. This is the check the
#    first version lacked, and the reason it could claim a clear field.
if (Test-DaemonAlive) {
    Write-Host 'WARNING: a daemon is still answering on the pipe.' -ForegroundColor Yellow
    $hidden = Get-Process python* -ErrorAction SilentlyContinue |
        Where-Object { -not (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine }
    if ($hidden) {
        Write-Host '  It is running at a higher integrity level than this shell,' -ForegroundColor Yellow
        Write-Host '  so its command line is hidden and it cannot be stopped from here.' -ForegroundColor Yellow
        Write-Host ('  Candidate pids: ' + (($hidden | ForEach-Object { $_.Id }) -join ', ')) -ForegroundColor Yellow
    }
    Write-Host '  Stop it with:  Stop-ScheduledTask -TaskName DexDaemon' -ForegroundColor Yellow
    Write-Host '  or re-run this script from an Administrator terminal.' -ForegroundColor Yellow
    exit 1
}

if ($stopped -eq 0) {
    Say 'No DEX processes running.' DarkGray
} else {
    Say "Stopped $stopped DEX process(es); the pipe is clear." Green
}
