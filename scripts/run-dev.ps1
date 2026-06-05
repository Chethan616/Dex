<#
.SYNOPSIS
    Dex -- local dev launcher. Starts gateway + MCP server + Flutter app.

.DESCRIPTION
    One command to bring up the whole stack for local development.

    Phases until this is fully wired:
      - Phase 0: skeleton only (this file is a placeholder)
      - Phase 4: starts OpenClaw gateway + MCP server (no Flutter yet)
      - Phase 7: starts everything, including the Flutter desktop app

    All three processes are spawned as background jobs so you can Ctrl+C
    in this window to tear them down together.

.EXAMPLE
    .\scripts\run-dev.ps1
#>

[CmdletBinding()]
param(
    [switch]$NoFlutter,
    [switch]$NoMcp
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$jobs = @()

function Start-DevProcess {
    param(
        [string]$Name,
        [string]$WorkDir,
        [string]$Cmd,
        [string[]]$ArgsList
    )
    Write-Host ("Starting {0} ..." -f $Name) -ForegroundColor Cyan
    $proc = Start-Process -FilePath $Cmd -ArgumentList $ArgsList -WorkingDirectory $WorkDir -NoNewWindow -PassThru
    return [pscustomobject]@{ Name = $Name; Process = $proc }
}

# Trap Ctrl+C to clean up
$cleanup = {
    Write-Host ""
    Write-Host "Shutting down Dex dev stack..." -ForegroundColor Yellow
    foreach ($j in $jobs) {
        if ($j.Process -and -not $j.Process.HasExited) {
            try { Stop-Process -Id $j.Process.Id -Force -ErrorAction SilentlyContinue } catch {}
            Write-Host ("  stopped {0}" -f $j.Name) -ForegroundColor DarkGray
        }
    }
}
try {
    # 1. Dex gateway -- Phase 1 must be complete. After Phase B.9 the forked
    # OpenClaw brain lives at dex/core/. The user-facing binary is `dex`
    # (bin alias in dex/core/package.json) launching `dex gateway --port ...`.
    $dexCoreDir = Join-Path $repoRoot 'dex\core'
    if (-not (Test-Path $dexCoreDir)) {
        Write-Host "[skip] Dex gateway: dex\core not found (Phase 1 incomplete)" -ForegroundColor DarkGray
    } else {
        $jobs += Start-DevProcess -Name 'dex-gateway' -WorkDir $dexCoreDir -Cmd 'dex' -ArgsList @('gateway','--port','18789','--verbose')
    }

    # 2. MCP driver server -- Phase 3 must be complete. After Phase B.9 the
    # MCP glue lives under dex/drivers/.
    if (-not $NoMcp) {
        $driverDir = Join-Path $repoRoot 'dex\drivers\windows-desktop-control'
        $serverPy = Join-Path $driverDir 'server.py'
        if (-not (Test-Path $serverPy)) {
            Write-Host "[skip] MCP server: dex\drivers\windows-desktop-control\server.py not found (Phase 3 incomplete)" -ForegroundColor DarkGray
        } else {
            # MCP servers usually launch over stdio from the gateway host.
            # If the gateway is configured to spawn this server itself, we do
            # not start it here -- this branch is only for standalone testing.
            Write-Host "[note] MCP server is launched by the gateway via mcporter; not starting standalone." -ForegroundColor DarkGray
        }
    }

    # 3. Flutter desktop app -- Phase 5 must be complete
    if (-not $NoFlutter) {
        $appDir = Join-Path $repoRoot 'app'
        $pubspec = Join-Path $appDir 'pubspec.yaml'
        if (-not (Test-Path $pubspec)) {
            Write-Host "[skip] Flutter app: app\pubspec.yaml not found (Phase 5 incomplete)" -ForegroundColor DarkGray
        } else {
            $jobs += Start-DevProcess -Name 'dex-flutter' -WorkDir $appDir -Cmd 'flutter' -ArgsList @('run','-d','windows')
        }
    }

    if ($jobs.Count -eq 0) {
        Write-Host ""
        Write-Host "Nothing to launch yet. Continue building from PLAN.md." -ForegroundColor Yellow
        exit 0
    }

    Write-Host ""
    Write-Host ("Running {0} process(es). Ctrl+C to stop." -f $jobs.Count) -ForegroundColor Green

    # Wait -- exits when any child exits
    while ($jobs | Where-Object { -not $_.Process.HasExited }) {
        Start-Sleep -Seconds 1
    }
}
finally {
    & $cleanup
}
