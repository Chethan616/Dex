<#
.SYNOPSIS
  Force-install the Dex extension into Chrome, so it is there without being
  loaded by hand.

.DESCRIPTION
  Chrome 152 removed `--load-extension`, and the feature flag that used to
  bring it back. Measured on this machine: Chrome registers zero extensions
  from that switch, while the same folder loads in two seconds under
  Playwright's Chromium. So the only route left is the one Chrome supports for
  managed machines — ExtensionInstallForcelist, pointing at a packed CRX and an
  update manifest.

  This needs Administrator because Chrome reads that policy from HKLM. Under
  HKCU it is accepted and ignored, which was tried first.

  Read this before running it. It is a Chrome *policy*, and policies are not
  per-profile:

    * The extension is installed into every Chrome profile on this machine,
      not only the one Dex uses.
    * A force-installed extension cannot be removed from chrome://extensions.
      Undo is `install-extension-policy.ps1 -Remove`, elevated.
    * Chrome will show "Managed by your organisation" in its menu, because
      from Chrome's point of view it now is.

  If that is more than you want, the alternative costs one click and no policy:
  chrome://extensions -> Developer mode -> Load unpacked -> the extension
  folder. Dex already turns Developer mode on in its own profile.

.PARAMETER Remove
  Take the policy back off and leave nothing behind.

.EXAMPLE
  # Install, from an elevated PowerShell:
  .\scripts\install-extension-policy.ps1

.EXAMPLE
  # Undo:
  .\scripts\install-extension-policy.ps1 -Remove
#>
[CmdletBinding()]
param([switch]$Remove)

$ErrorActionPreference = 'Stop'

# The id Chrome derives from the signing key in extension.pem. It is not a
# choice — repack with a different key and this changes.
$ExtensionId = 'joachahcdjdaeeiiocbooimlfbojagmm'

# Served by the browser agent on loopback. A file:// update URL is refused by
# Chrome, which is why this is not simply a path.
$UpdateUrl = 'http://127.0.0.1:8766/extension/update.xml'

$PolicyKey = 'HKLM:\SOFTWARE\Policies\Google\Chrome'
$ListKey = Join-Path $PolicyKey 'ExtensionInstallForcelist'

function Assert-Elevated {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host ''
    Write-Host '  This needs Administrator.' -ForegroundColor Yellow
    Write-Host '  Chrome reads this policy from HKLM; under HKCU it is ignored.'
    Write-Host ''
    Write-Host '  Right-click PowerShell, Run as administrator, then:'
    Write-Host "    cd '$PSScriptRoot\..'"
    Write-Host '    .\scripts\install-extension-policy.ps1'
    Write-Host ''
    exit 1
  }
}

Assert-Elevated

if ($Remove) {
  if (Test-Path $ListKey) {
    Remove-Item -Path $ListKey -Recurse -Force
    Write-Host '  Removed the force-install policy.' -ForegroundColor Green
  } else {
    Write-Host '  It was not set.' -ForegroundColor DarkGray
  }

  # Only if it is empty. Chrome may have other policies that are not ours to
  # delete.
  if (Test-Path $PolicyKey) {
    $key = Get-Item $PolicyKey
    if ($key.SubKeyCount -eq 0 -and $key.ValueCount -eq 0) {
      Remove-Item -Path $PolicyKey -Force
    }
  }
  Write-Host '  Restart Chrome for it to take effect.'
  exit 0
}

# The CRX has to exist before the policy points at it, or Chrome fetches the
# manifest, fails, and retries quietly forever.
$crx = Join-Path $PSScriptRoot '..\dist\dex-extension.crx'
if (-not (Test-Path $crx)) {
  Write-Host ''
  Write-Host '  dist\dex-extension.crx is missing.' -ForegroundColor Yellow
  Write-Host '  Pack it first:'
  Write-Host '    & "C:\Program Files\Google\Chrome\Application\chrome.exe" --pack-extension="<repo>\extension"'
  Write-Host '    move extension.crx dist\dex-extension.crx'
  Write-Host ''
  exit 1
}

New-Item -Path $ListKey -Force | Out-Null
Set-ItemProperty -Path $ListKey -Name '1' -Value "$ExtensionId;$UpdateUrl"

Write-Host ''
Write-Host '  Policy set.' -ForegroundColor Green
Write-Host "    $ExtensionId"
Write-Host "    $UpdateUrl"
Write-Host ''
Write-Host '  Two things have to be true for Chrome to install it:'
Write-Host '    the browser agent is running (it serves the manifest and the CRX)'
Write-Host '    Chrome is restarted, because it reads policy at startup'
Write-Host ''
Write-Host '  Check it at chrome://policy, and chrome://extensions for the'
Write-Host '  extension itself. To undo:  .\scripts\install-extension-policy.ps1 -Remove'
Write-Host ''
