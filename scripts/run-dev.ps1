<#
.SYNOPSIS
DEX V3 development startup.
Launches: daemon (requires elevation) + Desktop Agent server + Browser Agent server
+ TypeScript core + Dex Bar UI.

.PARAMETER DaemonOnly      Start only the privileged daemon
.PARAMETER CoreOnly        Start only TypeScript core (daemon + desktop already running)
.PARAMETER NoDesktop       Skip the Desktop Agent server (Slice 1 only)
.PARAMETER NoBrowser       Skip the Browser Agent server (no web tasks)
.PARAMETER NoApp           Skip the App Agent server (no UI Automation tier)
.PARAMETER NoUi            Skip the Flutter Dex Bar (CLI only)
.PARAMETER Console         Show every process in its own window and keep the
                           dex> prompt. Default is windowless: the Dex Bar is
                           the only thing on screen and everything logs to
                           %LOCALAPPDATA%\DEX\*.log.
#>
param(
    [switch]$DaemonOnly,
    [switch]$CoreOnly,
    [switch]$NoDesktop,
    [switch]$NoBrowser,
    [switch]$NoApp,
    [switch]$NoUi,
    [switch]$Console
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

# Windowless by default. python.exe is a console-subsystem binary, so each
# server used to put a terminal on the desktop; pythonw is the same interpreter
# built for the GUI subsystem and allocates no console at all. Their output goes
# to %LOCALAPPDATA%\DEX\*.log, which is why that logging went in first — with
# no window, the file is the only place left to look.
$py = if ($Console) { 'python' } else { 'pythonw' }
$style = if ($Console) { 'Minimized' } else { 'Hidden' }

if (-not $Console) {
    Write-Host 'Windowless. Logs: ' -NoNewline -ForegroundColor DarkGray
    Write-Host "$env:LOCALAPPDATA\DEX\*.log" -ForegroundColor DarkGray
    Write-Host 'Use -Console for windows and the dex> prompt.' -ForegroundColor DarkGray
}

if (-not $CoreOnly) {
    # Clear strays before starting anything.
    #
    # This is not tidiness. Windows named pipes allow many server instances
    # under one name, so a second daemon does not fail to start -- it joins the
    # rota and requests go to whichever instance answers first. Seven had
    # accumulated here from previous runs, several running weeks-old handler
    # code, which is why the same command worked one minute and not the next.
    & (Join-Path $PSScriptRoot 'stop-dex.ps1') -Quiet

    # Full Access installs an elevated logon task that runs the daemon in this
    # session. If it exists, let it own the daemon rather than starting a
    # second, unprivileged one alongside it.
    $task = Get-ScheduledTask -TaskName 'DexDaemon' -ErrorAction SilentlyContinue
    if ($task) {
        Write-Host 'Starting DEX Daemon via the elevated logon task (Full Access)...' -ForegroundColor Green
        Start-ScheduledTask -TaskName 'DexDaemon'
        Start-Sleep -Seconds 2
    } else {
        Write-Host 'Starting DEX Daemon (standalone)...' -ForegroundColor Cyan
        $daemon = Start-Process $py -ArgumentList 'daemon/DexDaemon.py' -PassThru -WindowStyle $style
        Write-Host "Daemon PID: $($daemon.Id)" -ForegroundColor DarkGray
        Start-Sleep -Milliseconds 800

        if (-not $isAdmin) {
            Write-Host ''
            Write-Host 'The daemon is NOT elevated. These will fail:' -ForegroundColor Yellow
            Write-Host '  set_dns, set_wifi, set_power_plan, HKLM registry writes' -ForegroundColor Yellow
            Write-Host 'Fix it once:  .\scripts\install-daemon-service.ps1  (as Administrator)' -ForegroundColor Yellow
            Write-Host ''
        }
    }
}

if (-not $CoreOnly -and -not $DaemonOnly -and -not $NoDesktop) {
    Write-Host 'Starting Desktop Agent Server...' -ForegroundColor Cyan
    $desktop = Start-Process $py -ArgumentList 'agents/desktop/server.py' -PassThru -WindowStyle $style
    Write-Host "Desktop Agent PID: $($desktop.Id)" -ForegroundColor DarkGray
    Start-Sleep -Milliseconds 1000
}

if (-not $CoreOnly -and -not $DaemonOnly -and -not $NoApp) {
    Write-Host 'Starting App Agent Server (UI Automation)...' -ForegroundColor Cyan
    $appAgent = Start-Process $py -ArgumentList 'agents/app/server.py' -PassThru -WindowStyle $style
    Write-Host "App Agent PID: $($appAgent.Id)" -ForegroundColor DarkGray
    Start-Sleep -Milliseconds 800
}

if (-not $CoreOnly -and -not $DaemonOnly -and -not $NoBrowser) {
    Write-Host 'Starting Browser Agent Server...' -ForegroundColor Cyan
    $browser = Start-Process $py -ArgumentList 'agents/browser/server.py' -PassThru -WindowStyle $style
    Write-Host "Browser Agent PID: $($browser.Id)" -ForegroundColor DarkGray
    Start-Sleep -Milliseconds 1000
}

if (-not $DaemonOnly -and -not $NoUi) {
    $exe = 'ui/dex-bar/build/windows/x64/runner/Debug/Dex.exe'
    if (-not (Test-Path $exe)) {
        Write-Host 'Dex Bar not built yet — building (first run takes ~1 min)...' -ForegroundColor Cyan
        Push-Location 'ui/dex-bar'
        flutter build windows --debug
        Pop-Location
    }
    if (Test-Path $exe) {
        Write-Host 'Starting Dex Bar (Alt+Space to summon)...' -ForegroundColor Cyan
        $ui = Start-Process $exe -PassThru
        Write-Host "Dex Bar PID: $($ui.Id)" -ForegroundColor DarkGray
    } else {
        Write-Host 'Dex Bar build failed — continuing with CLI only.' -ForegroundColor Yellow
    }
}

if (-not $DaemonOnly) {
    if ($Console) {
        Write-Host 'Starting DEX Core (CLI + UI server)...' -ForegroundColor Cyan
        npx ts-node src/main.ts
    } else {
        # Headless: no console, so no dex> prompt. main.ts skips startCli, which
        # would otherwise build a readline over a stdin that is already closed
        # and end the moment it began. The Dex Bar is the interface.
        Write-Host 'Starting DEX Core (headless — Alt+Space for the bar)...' -ForegroundColor Cyan
        $env:DEX_HEADLESS = 'true'
        # No -RedirectStandardOutput any more: under DEX_HEADLESS the core
        # writes its own %LOCALAPPDATA%\DEX\core.log (core/logging/file_log.ts).
        # Redirecting as well would put two writers on one file.
        $core = Start-Process node `
            -ArgumentList '-r', 'ts-node/register', 'src/main.ts' `
            -PassThru -WindowStyle Hidden
        Write-Host "Core PID: $($core.Id)" -ForegroundColor DarkGray
        Write-Host ''
        Write-Host 'Dex is running. Alt+Space for the bar.' -ForegroundColor Green
        Write-Host 'Stop everything with: .\scripts\stop-dex.ps1' -ForegroundColor DarkGray
    }
}
