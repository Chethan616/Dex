# Build dex-setup.exe — the installer you give to other people.
#
# Slower than build-app.ps1 because it packages and then compresses the whole
# thing into a Squirrel installer. Produces three files: the setup exe, a
# .nupkg, and a RELEASES manifest. All three are needed if you publish an
# update feed; the setup exe alone is enough to install by hand.
#
#   .\scripts\build-installer.ps1
#   .\scripts\build-installer.ps1 -SkipChecks
#   .\scripts\build-installer.ps1 -OutDir D:\releases    # copy the exe out

param(
    [switch] $SkipChecks,
    [string] $OutDir
)

. (Join-Path $PSScriptRoot 'dex-build-lib.ps1')

$appRoot = Get-AppRoot
$nodeBin = Resolve-BuildNode
$staging = Resolve-StagingDir -AppRoot $appRoot

if (-not $SkipChecks) {
    Write-Host "`n== checks ==" -ForegroundColor Cyan
    Invoke-DexYarn -WorkingDir $appRoot -NodeBin $nodeBin -YarnArgs @('qa')
}

Write-Host "`n== building installer (this takes a few minutes) ==" -ForegroundColor Cyan
Sync-Staging -AppRoot $appRoot -Staging $staging
Invoke-DexYarn -WorkingDir $staging -NodeBin $nodeBin -YarnArgs @('make')

$made = Join-Path $staging 'out\make\squirrel.windows\x64'
$setup = Join-Path $made 'dex-setup.exe'
if (-not (Test-Path $setup)) {
    throw "make reported success but $setup is missing"
}

$size = [math]::Round((Get-Item $setup).Length / 1MB, 1)
Write-Host "`nBuilt dex-setup.exe ($size MB)" -ForegroundColor Green
Write-Host "  $setup"

if ($OutDir) {
    if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }
    # The whole folder: Squirrel's updater needs RELEASES and the .nupkg
    # alongside the exe, and copying only the exe is a mistake you find out
    # about later, when an update silently does nothing.
    Copy-Item (Join-Path $made '*') -Destination $OutDir -Force
    Write-Host "`nCopied setup, .nupkg and RELEASES to $OutDir" -ForegroundColor Green
}
