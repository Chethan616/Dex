$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = 'dex'
  fileType       = 'exe'
  url64bit       = 'https://github.com/Chethan616/Dex/releases/download/v2.3.2/dex-setup.exe'
  checksum64     = '02A806377525028B5EFF662AE0191881635712E30B3FEAB33A831E68F29BF8DE'
  checksumType64 = 'sha256'
  silentArgs     = '--silent'
  validExitCodes = @(0)
}

Install-ChocolateyPackage @packageArgs
