<#
.SYNOPSIS
    Dex -- phase acceptance check runner.

.DESCRIPTION
    Runs the acceptance check for a given phase number from PLAN.md.
    Each phase's check is a small self-contained block. Adding a phase
    means adding a function below and an entry in the dispatch table.

    Phases that require human verification (e.g. "did UFO2 steal focus?")
    print instructions and exit 2 -- the human reports the result.

.EXAMPLE
    .\scripts\verify-phase.ps1 0     # bootstrap
    .\scripts\verify-phase.ps1 3     # MCP server
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true, Position=0)]
    [ValidateRange(0,7)]
    [int]$Phase
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Test-Phase0 {
    $needed = @(
        'PLAN.md', 'README.md', 'LICENSES.md', 'SECURITY.md',
        'scripts\setup-windows.ps1', 'scripts\run-dev.ps1', 'scripts\verify-phase.ps1',
        'vendor', 'glue\windows-desktop-control', 'app', 'scripts'
    )
    $missing = $needed | Where-Object { -not (Test-Path (Join-Path $repoRoot $_)) }
    if ($missing.Count -gt 0) {
        Write-Host "Phase 0 FAIL -- missing:" -ForegroundColor Red
        foreach ($m in $missing) { Write-Host "  - $m" -ForegroundColor Red }
        return 1
    }
    # Run setup-windows.ps1 -- exit code 0 means all green
    Write-Host "Running prereq check..." -ForegroundColor Cyan
    & (Join-Path $repoRoot 'scripts\setup-windows.ps1')
    return $LASTEXITCODE
}

function Test-Phase1 {
    Write-Host "Phase 1 acceptance is interactive -- see PLAN.md section Phase 1." -ForegroundColor Yellow
    Write-Host "  Manually: send a 'hello' to http://127.0.0.1:18789/<route> and confirm streamed reply." -ForegroundColor DarkGray
    return 2
}

function Test-Phase2 {
    $logPath = Join-Path $repoRoot 'vendor\UFO\logs\dex-smoke.log'
    $filePath = Join-Path $env:USERPROFILE 'Desktop\dex-test.txt'
    if ((Test-Path $logPath) -and (Test-Path $filePath)) {
        Write-Host "Phase 2 PASS -- Notepad smoke artifact present at $filePath" -ForegroundColor Green
        return 0
    }
    Write-Host "Phase 2 not yet -- run UFO2 smoke script from PLAN.md section Phase 2." -ForegroundColor Yellow
    return 1
}

function Test-Phase3 {
    $server = Join-Path $repoRoot 'glue\windows-desktop-control\server.py'
    if (-not (Test-Path $server)) {
        Write-Host "Phase 3 FAIL -- server.py not found" -ForegroundColor Red
        return 1
    }
    Write-Host "Phase 3 acceptance is interactive -- run the Python REPL check from PLAN.md section Phase 3." -ForegroundColor Yellow
    return 2
}

function Test-Phase4 {
    $skill = Join-Path $repoRoot 'glue\windows-desktop-control\SKILL.md'
    if (-not (Test-Path $skill)) {
        Write-Host "Phase 4 FAIL -- SKILL.md not authored" -ForegroundColor Red
        return 1
    }
    Write-Host "Phase 4 acceptance is interactive -- send curl from PLAN.md section Phase 4." -ForegroundColor Yellow
    return 2
}

function Test-Phase5 {
    $pubspec = Join-Path $repoRoot 'app\pubspec.yaml'
    if (-not (Test-Path $pubspec)) {
        Write-Host "Phase 5 FAIL -- Flutter app not scaffolded" -ForegroundColor Red
        return 1
    }
    Write-Host "Building Flutter app for Windows..." -ForegroundColor Cyan
    Push-Location (Join-Path $repoRoot 'app')
    try {
        & flutter build windows --debug
        return $LASTEXITCODE
    } finally {
        Pop-Location
    }
}

function Test-Phase6 {
    Write-Host "Phase 6 acceptance is interactive -- run the golden path in PLAN.md section Phase 6." -ForegroundColor Yellow
    return 2
}

function Test-Phase7 {
    $checks = @{
        'run-dev.ps1 wired'      = (Test-Path (Join-Path $repoRoot 'scripts\run-dev.ps1'))
        'SECURITY.md authored'   = (Test-Path (Join-Path $repoRoot 'SECURITY.md'))
        'LICENSES.md authored'   = (Test-Path (Join-Path $repoRoot 'LICENSES.md'))
    }
    $fail = $false
    foreach ($k in $checks.Keys) {
        if ($checks[$k]) {
            Write-Host ("  [OK] {0}" -f $k) -ForegroundColor Green
        } else {
            Write-Host ("  [..] {0}" -f $k) -ForegroundColor Red
            $fail = $true
        }
    }
    if ($fail) { return 1 }
    Write-Host "Phase 7 file checks pass -- manual a11y + golden path verification still required." -ForegroundColor Yellow
    return 2
}

$dispatch = @{
    0 = ${function:Test-Phase0}
    1 = ${function:Test-Phase1}
    2 = ${function:Test-Phase2}
    3 = ${function:Test-Phase3}
    4 = ${function:Test-Phase4}
    5 = ${function:Test-Phase5}
    6 = ${function:Test-Phase6}
    7 = ${function:Test-Phase7}
}

Write-Host ""
Write-Host ("Verifying Phase {0}..." -f $Phase) -ForegroundColor Cyan
$rc = & $dispatch[$Phase]
Write-Host ""
switch ($rc) {
    0 { Write-Host ("Phase {0}: PASS" -f $Phase) -ForegroundColor Green }
    1 { Write-Host ("Phase {0}: FAIL -- fix the items above" -f $Phase) -ForegroundColor Red }
    2 { Write-Host ("Phase {0}: needs manual confirmation" -f $Phase) -ForegroundColor Yellow }
    default { Write-Host ("Phase {0}: rc={1}" -f $Phase, $rc) -ForegroundColor Yellow }
}
exit $rc
