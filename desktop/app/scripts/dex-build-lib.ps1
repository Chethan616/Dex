# Shared setup for the two DEX build scripts.
#
# It exists because building this app on this machine has two traps that have
# nothing to do with the code, and both produce errors that do not name their
# real cause:
#
#   1. Node 24 on PATH. yarn refuses outright ("engine node is incompatible"),
#      because the app pins 20.x || 22.x. fnm has a compatible version but
#      only inside a shell that has run `fnm use`.
#   2. The repo lives under OneDrive. Windows keeps a handle on the 170 MB
#      app.asar from the previous build, so packaging dies with
#      "EBUSY: resource busy or locked" and no process visibly owns the file.
#
# So: find a supported Node ourselves, and build in a staging directory
# outside OneDrive with node_modules junctioned in, so nothing is copied and
# nothing is left locked.
#
# Dot-source this; do not run it directly.

$ErrorActionPreference = 'Stop'

function Get-AppRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

# A Node the app will actually accept. Prefers whatever is already on PATH so
# a correctly-set-up shell is never second-guessed.
function Resolve-BuildNode {
    $current = $null
    try { $current = (& node -v) 2>$null } catch { }
    if ($current -match '^v(20|22)\.') {
        Write-Host "node $current (already on PATH)" -ForegroundColor DarkGray
        return $null
    }

    if ($current) {
        Write-Host "node $current is not supported by this app (needs 20.x or 22.x)" -ForegroundColor Yellow
    }

    $versionsRoot = Join-Path $env:APPDATA 'fnm\node-versions'
    if (Test-Path $versionsRoot) {
        $match = Get-ChildItem $versionsRoot -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^v(22|20)\.' } |
            Sort-Object Name -Descending |
            Select-Object -First 1
        if ($match) {
            $bin = Join-Path $match.FullName 'installation'
            if (Test-Path (Join-Path $bin 'node.exe')) {
                Write-Host "using $($match.Name) from fnm" -ForegroundColor DarkGray
                return $bin
            }
        }
    }

    throw @"
No Node 20.x or 22.x found.

  Install one:   fnm install 22
  Then retry.    (or run 'fnm use 22' in this shell first)
"@
}

# Where to build. Building in place is fine unless the repo is inside a synced
# folder, which is where the app.asar lock comes from.
function Resolve-StagingDir {
    param([string] $AppRoot)

    if ($AppRoot -notmatch 'OneDrive') {
        return $AppRoot
    }

    $staging = Join-Path $env:LOCALAPPDATA 'dex-build'
    Write-Host "repo is inside OneDrive; staging the build at $staging" -ForegroundColor DarkGray
    return $staging
}

# Mirror the source into staging and junction node_modules across, so the copy
# stays small and there is only ever one installed dependency tree.
function Sync-Staging {
    param([string] $AppRoot, [string] $Staging)

    if ($Staging -eq $AppRoot) { return }

    $skip = @('node_modules', 'out', '.vite', '.git')

    if (-not (Test-Path $Staging)) {
        New-Item -ItemType Directory -Path $Staging -Force | Out-Null
    } else {
        # Clear everything except node_modules (the junction) and out (the
        # previous build, which Forge reuses where it can).
        Get-ChildItem $Staging -Force | Where-Object { $_.Name -notin @('node_modules', 'out') } | ForEach-Object {
            Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    Get-ChildItem $AppRoot -Force | Where-Object { $_.Name -notin $skip } | ForEach-Object {
        Copy-Item $_.FullName -Destination $Staging -Recurse -Force
    }

    $link = Join-Path $Staging 'node_modules'
    if (-not (Test-Path $link)) {
        $real = Join-Path $AppRoot 'node_modules'
        if (-not (Test-Path $real)) {
            throw "node_modules is missing. Run 'yarn install' in $AppRoot first."
        }
        & cmd /c mklink /J "`"$link`"" "`"$real`"" | Out-Null
    }
}

# Run a yarn script with the resolved Node in front of PATH.
function Invoke-DexYarn {
    param([string] $WorkingDir, [string] $NodeBin, [string[]] $YarnArgs)

    Push-Location $WorkingDir
    try {
        $originalPath = $env:PATH
        if ($NodeBin) { $env:PATH = "$NodeBin;$env:PATH" }
        try {
            & yarn @YarnArgs
            if ($LASTEXITCODE -ne 0) { throw "yarn $($YarnArgs -join ' ') failed with exit code $LASTEXITCODE" }
        } finally {
            $env:PATH = $originalPath
        }
    } finally {
        Pop-Location
    }
}
