$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = 'dex'
  fileType       = 'exe'
  url64bit       = 'https://github.com/Chethan616/Dex/releases/download/v2.3.0/dex-setup.exe'
  checksum64     = '003674AA448DB98C4574185977762EE970C4963AC183917FFEEA20C37EB097F3'
  checksumType64 = 'sha256'
  silentArgs     = '--silent'
  validExitCodes = @(0)
}

Install-ChocolateyPackage @packageArgs
