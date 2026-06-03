<#
.SYNOPSIS
    Dex -- prerequisite checker for Windows development.

.DESCRIPTION
    Idempotent, read-only. Verifies the host has everything Dex needs:
    Node 24 (or 22.19+), Python 3.10, Flutter SDK with Windows desktop enabled,
    git, and PowerShell 5.1+. Does NOT install anything -- humans install.

    Run anytime. Re-run after fixing anything that's red.

.EXAMPLE
    .\scripts\setup-windows.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$script:problems = @()
$script:ok = @()

function Write-Result {
    param(
        [string]$Label,
        [bool]$Pass,
        [string]$Detail
    )
    if ($Pass) {
        Write-Host ("  [OK]   {0,-26} {1}" -f $Label, $Detail) -ForegroundColor Green
        $script:ok += $Label
    } else {
        Write-Host ("  [MISS] {0,-26} {1}" -f $Label, $Detail) -ForegroundColor Red
        $script:problems += "$Label -- $Detail"
    }
}

# Resolve a command to its real path on disk. Returns $null if not installed,
# or if the only match is a Windows AppExecutionAlias stub (a zero-byte file
# under WindowsApps that pops up the Microsoft Store on invocation).
function Find-RealCommand {
    param([string]$Name)
    $candidates = Get-Command $Name -All -ErrorAction SilentlyContinue
    foreach ($c in $candidates) {
        $src = $c.Source
        if (-not $src) { continue }
        if ($src -like '*\WindowsApps\*') {
            # AppExecutionAlias stubs are zero-byte (or near-zero) reparse points.
            $item = Get-Item -LiteralPath $src -ErrorAction SilentlyContinue
            if (-not $item -or $item.Length -lt 1024) { continue }
        }
        if (Test-Path -LiteralPath $src -PathType Leaf) {
            return $src
        }
    }
    return $null
}

# Invoke a command we already proved is real, capture stdout first line.
function Get-CommandVersion {
    param([string]$Name, [string[]]$VerArgs = @('--version'))
    $path = Find-RealCommand -Name $Name
    if (-not $path) { return $null }
    try {
        $out = & $path @VerArgs 2>$null | Select-Object -First 1
        return $out
    } catch {
        return $null
    }
}

Write-Host ""
Write-Host "Dex prerequisite check" -ForegroundColor Cyan
Write-Host "----------------------"

# ---- Node ----
$nodeVer = Get-CommandVersion -Name 'node'
if ($nodeVer) {
    $clean = $nodeVer.TrimStart('v')
    $parts = $clean.Split('.')
    $major = if ($parts.Length -ge 1) { [int]$parts[0] } else { 0 }
    $minor = if ($parts.Length -ge 2) { [int]$parts[1] } else { 0 }
    $pass = ($major -ge 24) -or ($major -eq 22 -and $minor -ge 19)
    Write-Result -Label 'Node.js' -Pass $pass -Detail "$nodeVer (need 24.x or 22.19+)"
} else {
    Write-Result -Label 'Node.js' -Pass $false -Detail 'not found on PATH (install from https://nodejs.org)'
}

# ---- Python 3.10 or 3.11 (UFO2 supports both) ----
function Test-PythonOk {
    param([string]$Out)
    return ($Out -and ($Out -match 'Python 3\.10\.' -or $Out -match 'Python 3\.11\.'))
}

$pyVer = $null
$pyLauncher = Find-RealCommand -Name 'py'
if ($pyLauncher) {
    foreach ($v in @('-3.10','-3.11')) {
        try {
            $candidate = (& $pyLauncher $v --version 2>$null)
            if (Test-PythonOk -Out $candidate) { $pyVer = $candidate; break }
        } catch { }
    }
}
if ($pyVer) {
    Write-Result -Label 'Python 3.10/3.11' -Pass $true -Detail $pyVer
} else {
    $pyVer2 = Get-CommandVersion -Name 'python'
    $pass = (Test-PythonOk -Out $pyVer2)
    $detail = if ($pyVer2) { "$pyVer2 (UFO2 needs 3.10 or 3.11)" } else { 'not found -- install Python 3.10 or 3.11 (UFO2 requires one of these)' }
    Write-Result -Label 'Python 3.10/3.11' -Pass $pass -Detail $detail
}

# ---- Flutter ----
$flutterPath = Find-RealCommand -Name 'flutter'
if ($flutterPath) {
    $rawVer = (& $flutterPath --version 2>$null) -join "`n"
    $verLine = ($rawVer -split "`n" | Where-Object { $_ -match '^Flutter\s' } | Select-Object -First 1)
    if (-not $verLine) { $verLine = '(installed; version banner suppressed)' }
    Write-Result -Label 'Flutter SDK' -Pass $true -Detail $verLine

    $cfg = (& $flutterPath config 2>$null) -join "`n"
    $winEnabled = $cfg -match 'enable-windows-desktop:\s*true'
    $detail = if ($winEnabled) { 'enabled' } else { 'run: flutter config --enable-windows-desktop' }
    Write-Result -Label 'Flutter Windows target' -Pass $winEnabled -Detail $detail
} else {
    Write-Result -Label 'Flutter SDK' -Pass $false -Detail 'not found on PATH (https://docs.flutter.dev/get-started/install/windows)'
    Write-Result -Label 'Flutter Windows target' -Pass $false -Detail 'install Flutter first'
}

# ---- Git ----
$gitVer = Get-CommandVersion -Name 'git'
$detail = if ($gitVer) { $gitVer } else { 'not found on PATH' }
Write-Result -Label 'git' -Pass ([bool]$gitVer) -Detail $detail

# ---- PowerShell ----
$psVer = $PSVersionTable.PSVersion
$pass = $psVer.Major -ge 5
Write-Result -Label 'PowerShell' -Pass $pass -Detail "$psVer"

# ---- API keys (presence only -- never read or echo them) ----
$haveAnthropic = [bool]$env:ANTHROPIC_API_KEY
$detail = if ($haveAnthropic) { 'set in env' } else { 'not set (paste into OpenClaw config in Phase 1)' }
Write-Result -Label 'ANTHROPIC_API_KEY' -Pass $haveAnthropic -Detail $detail

$haveGroq = [bool]$env:GROQ_API_KEY
$detail = if ($haveGroq) { 'set in env' } else { 'not set (paste into UFO2 agents.yaml in Phase 2)' }
Write-Result -Label 'GROQ_API_KEY' -Pass $haveGroq -Detail $detail

# ---- Summary ----
Write-Host ""
if ($script:problems.Count -eq 0) {
    Write-Host "All prerequisites present. Continue to Phase 1 in PLAN.md." -ForegroundColor Green
    exit 0
} else {
    Write-Host "Fix these before continuing:" -ForegroundColor Yellow
    foreach ($p in $script:problems) { Write-Host "  - $p" -ForegroundColor Yellow }
    Write-Host ""
    Write-Host "API keys are optional at this stage -- they're checked here only as a heads-up." -ForegroundColor DarkGray
    exit 1
}
