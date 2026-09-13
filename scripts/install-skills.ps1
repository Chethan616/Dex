<#
.SYNOPSIS
    Dex -- registers all Dex MCP servers + skills with OpenClaw.

.DESCRIPTION
    Renamed from install-skill.ps1 (singular) in v1.1. Registers BOTH:
      - windows-desktop-control (UFO2 -> native Win32 apps)
      - browser-control          (browser-use -> web pages)

    For each it:
      1. Mirrors the SKILL.md into %USERPROFILE%\.agents\skills\<name>\
      2. Registers the MCP server via `openclaw mcp set <name> <json>`
         (Claude-Desktop-style JSON config; backslash-escaped for PS 5.1)
      3. Verifies registration with `openclaw mcp show <name>`

    The Gemini key from environment ($env:GEMINI_API_KEY) is passed through
    to browser-control so its server.py can authenticate. UFO2 reads its own
    agents.yaml so we don't plumb a key for windows-desktop-control here.

.PARAMETER Force
    Overwrite existing skill directories without confirmation.

.PARAMETER SkipChromium
    Don't run `playwright install chromium` for browser-control. Use if the
    Chromium download (~150 MB) is undesired right now -- skip means the
    browser-control server will fail at run-time until the user runs the
    Playwright install separately.

.EXAMPLE
    .\scripts\install-skills.ps1
    .\scripts\install-skills.ps1 -Force
    .\scripts\install-skills.ps1 -SkipChromium
#>

[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$SkipChromium
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

# ---- Locate Dex CLI (Phase B.9+: binary is `dex` from the dexagent package) ----
$dexCli = Get-Command dex -ErrorAction SilentlyContinue
if (-not $dexCli) {
    # Fall back to the legacy `openclaw` binary so an in-progress upgrade
    # (pre-publish, pre-link) still has a usable CLI on PATH.
    $dexCli = Get-Command openclaw -ErrorAction SilentlyContinue
}
if (-not $dexCli) {
    Write-Host "Dex CLI not on PATH. Run from dex/core/: pnpm install" -ForegroundColor Red
    Write-Host "Once dexagent is on npm: npm install -g dexagent" -ForegroundColor DarkGray
    exit 1
}
$dexCmd = "$env:APPDATA\npm\$($dexCli.Name).cmd"
if (-not (Test-Path $dexCmd)) { $dexCmd = $dexCli.Source }

$userSkillsRoot = Join-Path $env:USERPROFILE '.agents\skills'
if (-not (Test-Path $userSkillsRoot)) { New-Item -ItemType Directory -Path $userSkillsRoot -Force | Out-Null }

# ---- Helpers ----------------------------------------------------------------
function Mirror-Skill {
    param([string]$Name, [string]$SourceSkillMd)
    $target = Join-Path $userSkillsRoot $Name
    if (Test-Path $target) {
        if (-not $Force) {
            Write-Host ("Skill dir exists at {0} (re-run with -Force to overwrite)." -f $target) -ForegroundColor Yellow
            return
        }
        Remove-Item -Recurse -Force $target
    }
    New-Item -ItemType Directory -Path $target | Out-Null
    Copy-Item $SourceSkillMd $target
    Write-Host ("  mirrored SKILL.md -> {0}" -f $target) -ForegroundColor Green
}

function Register-McpServer {
    param([string]$Name, [hashtable]$Config)
    $json = $Config | ConvertTo-Json -Compress -Depth 6
    # PS 5.1 strips inner quotes when handing JSON-looking args to native exes; escape them.
    $escaped = $json -replace '"','\"'
    Write-Host ("  config = {0}" -f $json) -ForegroundColor DarkGray
    & $dexCmd mcp set $Name $escaped
    if ($LASTEXITCODE -ne 0) { throw "dex mcp set $Name returned $LASTEXITCODE" }
    & $dexCmd mcp show $Name | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "dex mcp show $Name failed -- registration may have rolled back" }
    Write-Host ("  registered + verified: {0}" -f $Name) -ForegroundColor Green
}

# ---- 1. windows-desktop-control ---------------------------------------------
Write-Host ""
Write-Host "[1/2] windows-desktop-control" -ForegroundColor Cyan
$wdcDir = Join-Path $repoRoot 'dex\core\drivers\windows-desktop-control'
$ufoVenvPy = Join-Path $repoRoot 'vendor\UFO\.venv\Scripts\python.exe'
if (-not (Test-Path $ufoVenvPy)) {
    Write-Host ("  WARNING: UFO2 venv missing at {0}" -f $ufoVenvPy) -ForegroundColor Yellow
    Write-Host "  windows-desktop-control will fail at runtime until you create it (Phase 2 setup)." -ForegroundColor DarkGray
    $ufoVenvPy = 'python'
}
Mirror-Skill -Name 'windows-desktop-control' -SourceSkillMd (Join-Path $wdcDir 'SKILL.md')
Register-McpServer -Name 'windows-desktop-control' -Config @{
    command = $ufoVenvPy
    args    = @((Join-Path $wdcDir 'server.py'))
    cwd     = $wdcDir
    # dex-core's MCP client defaults to a 60s request timeout; UFO2 tasks
    # legitimately run up to server.py's 300s cap. Without this the gateway
    # kills run_desktop_task with "MCP error -32001: Request timed out"
    # long before UFO2 finishes. 330s = server cap + wind-down margin.
    requestTimeoutMs = 330000
}

# ---- 2. browser-control -----------------------------------------------------
Write-Host ""
Write-Host "[2/2] browser-control" -ForegroundColor Cyan
$bcDir = Join-Path $repoRoot 'dex\core\drivers\browser-control'
$bcVenvPy = Join-Path $repoRoot 'vendor\browser-use\.venv\Scripts\python.exe'

if (-not (Test-Path $bcVenvPy)) {
    Write-Host ""
    Write-Host "  browser-use venv missing. Setting it up now..." -ForegroundColor Yellow
    Write-Host "  This installs browser-use, playwright, groq, mcp -- and downloads Chromium (~150 MB)." -ForegroundColor DarkGray
    Write-Host "  Pass -SkipChromium to defer the Chromium download." -ForegroundColor DarkGray

    $py = Get-Command 'py' -ErrorAction SilentlyContinue
    if (-not $py) {
        Write-Host "  ERROR: 'py' launcher not found. Install Python 3.11 (py launcher comes with it)." -ForegroundColor Red
        exit 1
    }
    & py -3.11 -m venv (Join-Path $repoRoot 'vendor\browser-use\.venv')
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERROR: Python 3.11 not available. Install it from python.org or the Microsoft Store." -ForegroundColor Red
        exit 1
    }
    if (-not (Test-Path $bcVenvPy)) { throw "venv creation reported success but $bcVenvPy is missing" }

    Write-Host "  Installing browser-control deps..." -ForegroundColor DarkGray
    & $bcVenvPy -m pip install --quiet --upgrade pip
    & $bcVenvPy -m pip install -r (Join-Path $bcDir 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

    if (-not $SkipChromium) {
        Write-Host "  Installing Playwright Chromium (~150 MB download)..." -ForegroundColor DarkGray
        & $bcVenvPy -m playwright install chromium
        if ($LASTEXITCODE -ne 0) { throw "playwright install chromium failed" }
    } else {
        Write-Host "  Skipped Chromium (use -SkipChromium=$false on next run)" -ForegroundColor DarkGray
    }
}

# Gemini key must be in env so the MCP server (spawned by dex-core as a
# subprocess) inherits it. If missing now we still register, but warn -- the
# user can set the env var system-wide and the spawned server will pick it up.
# Defaults to Gemini 2.5 Flash-Lite per the 2026-06-06 provider flip; flip via
# DEX_BROWSER_PROVIDER=groq|anthropic|openai if the user has those keys.
$geminiKey = $env:GEMINI_API_KEY
if (-not $geminiKey) {
    # Try .env.local at the repo root as a last-resort fallback so a user
    # who configured Dex via the .env.local pattern doesn't have to also
    # export the var into their shell before running this script.
    $envFile = Join-Path $repoRoot '.env.local'
    if (Test-Path $envFile) {
        $match = Select-String -Path $envFile -Pattern '^GEMINI_API_KEY=(.+)$' | Select-Object -First 1
        if ($match) { $geminiKey = $match.Matches[0].Groups[1].Value.Trim() }
    }
}
if (-not $geminiKey) {
    Write-Host "  WARNING: GEMINI_API_KEY not in environment." -ForegroundColor Yellow
    Write-Host "  browser-control will refuse to run tasks until you set it." -ForegroundColor DarkGray
    Write-Host "  Get a free-tier key at https://aistudio.google.com/app/apikey" -ForegroundColor DarkGray
}

Mirror-Skill -Name 'browser-control' -SourceSkillMd (Join-Path $bcDir 'SKILL.md')
Register-McpServer -Name 'browser-control' -Config @{
    command = $bcVenvPy
    args    = @((Join-Path $bcDir 'server.py'))
    cwd     = $bcDir
    # Browser tasks default to 180s in server.py; 210s leaves wind-down
    # margin over dex-core's 60s MCP-client default (see note above).
    requestTimeoutMs = 210000
    env     = @{
        GEMINI_API_KEY      = ($geminiKey | ForEach-Object { if ($_) { $_ } else { '' } })
        DEX_BROWSER_PROVIDER = 'google'
        DEX_BROWSER_MODEL   = 'gemini-2.5-flash-lite'
    }
}

# ---- Done -------------------------------------------------------------------
Write-Host ""
Write-Host "Done. Restart the Dex gateway so the new MCP servers are picked up:" -ForegroundColor Green
Write-Host "    dex gateway stop" -ForegroundColor DarkGray
Write-Host "    dex gateway run --force --port 18789" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Three-route smoke test (in Dex):" -ForegroundColor Green
Write-Host "    1. 'list my desktop'                          -> Shell chip" -ForegroundColor DarkGray
Write-Host "    2. 'compute 12 x 9 in Calculator'             -> Windows app chip" -ForegroundColor DarkGray
Write-Host "    3. 'take the typing test at livechat.com/typing-speed-test/'  -> Browser chip" -ForegroundColor DarkGray
