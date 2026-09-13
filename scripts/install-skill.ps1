<#
.SYNOPSIS
    Renamed to install-skills.ps1 (plural) in v1.1. This stub forwards.
#>
[CmdletBinding()]
param([switch]$Force, [switch]$SkipChromium)

Write-Host "install-skill.ps1 was renamed to install-skills.ps1 in v1.1 (now registers both" -ForegroundColor Yellow
Write-Host "windows-desktop-control and browser-control). Forwarding..." -ForegroundColor DarkGray
Write-Host ""
& (Join-Path $PSScriptRoot 'install-skills.ps1') @PSBoundParameters
exit $LASTEXITCODE
