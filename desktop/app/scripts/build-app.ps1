# Build the DEX app itself — the unpacked folder with dex.exe in it.
#
# Use this while developing: it is the faster of the two builds and produces
# something you can run straight away. Use build-installer.ps1 when you need
# something to give to somebody else.
#
#   .\scripts\build-app.ps1
#   .\scripts\build-app.ps1 -SkipChecks     # skip lint/typecheck/tests

param(
    [switch] $SkipChecks
)

. (Join-Path $PSScriptRoot 'dex-build-lib.ps1')

$appRoot = Get-AppRoot
$nodeBin = Resolve-BuildNode
$staging = Resolve-StagingDir -AppRoot $appRoot

if (-not $SkipChecks) {
    Write-Host "`n== checks ==" -ForegroundColor Cyan
    Invoke-DexYarn -WorkingDir $appRoot -NodeBin $nodeBin -YarnArgs @('qa')
}

Write-Host "`n== packaging ==" -ForegroundColor Cyan
Sync-Staging -AppRoot $appRoot -Staging $staging
Invoke-DexYarn -WorkingDir $staging -NodeBin $nodeBin -YarnArgs @('package')

$exe = Join-Path $staging 'out\DEX-win32-x64\dex.exe'
if (-not (Test-Path $exe)) {
    throw "packaging reported success but $exe is missing"
}

$size = [math]::Round((Get-Item $exe).Length / 1MB, 1)
Write-Host "`nBuilt DEX ($size MB)" -ForegroundColor Green
Write-Host "  $exe"
Write-Host "`nRun it:  & '$exe'"
