$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = 'dex'
  fileType       = 'exe'
  url64bit       = 'https://github.com/Chethan616/Dex/releases/download/v2.3.3/dex-setup.exe'
  checksum64     = '6D4D7EF5522A775BE23B2642FB860541A2506CC0837C3B6ECCE060DC9D1DD362'
  checksumType64 = 'sha256'
  silentArgs     = '--silent'
  validExitCodes = @(0)
}

Install-ChocolateyPackage @packageArgs
