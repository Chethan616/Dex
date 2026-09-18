param(
  [Parameter(Mandatory=$true)][string]$Op,
  [string]$Path = "",
  [string]$Name = "",
  [string]$Value = "",
  [string]$Type = "String",
  [string]$File = "",
  [string]$Query = "",
  [int]$MaxResults = 50
)

# Individual registry operations only - no confirmation logic here. The
# bash wrapper (dex-registry) is what decides set/delete/import need a
# backup + a blocking human confirmation before calling this script again
# with the actual write. Keeping that orchestration in bash, next to the
# dex_post helper every other tool already uses, means this stays a small,
# single-purpose executor: give it a verb and registry path, it does exactly
# that and nothing else.

$ErrorActionPreference = "Stop"

# Deliberately NOT applied to the reg.exe calls in Do-Export/Do-Import below:
# a native command's stderr, once redirected inside PowerShell, gets wrapped
# in an ErrorRecord regardless of the process's own exit code — and with
# $ErrorActionPreference set to Stop, that ErrorRecord becomes a thrown
# exception even on success. reg.exe writes its own success confirmation to
# that stream on this machine, which turned a working `import` into a
# reported failure the first time this was tested end to end. Those two
# functions check $LASTEXITCODE directly instead and never redirect stderr.

function Resolve-RegPath([string]$p) {
  $map = @{
    "HKLM" = "HKLM:"; "HKEY_LOCAL_MACHINE" = "HKLM:";
    "HKCU" = "HKCU:"; "HKEY_CURRENT_USER" = "HKCU:";
    "HKCR" = "HKCR:"; "HKEY_CLASSES_ROOT" = "HKCR:";
    "HKU"  = "HKU:";  "HKEY_USERS" = "HKU:";
    "HKCC" = "HKCC:"; "HKEY_CURRENT_CONFIG" = "HKCC:";
  }
  $parts = $p -split '\\', 2
  $hive = $parts[0].ToUpper()
  if (-not $map.ContainsKey($hive)) {
    throw "unrecognised hive '$hive' - use HKLM, HKCU, HKCR, HKU or HKCC"
  }
  $rest = if ($parts.Length -gt 1) { $parts[1] } else { "" }
  if ($rest) { return "$($map[$hive])\$rest" } else { return $map[$hive] }
}

function Json([object]$obj) {
  $obj | ConvertTo-Json -Depth 6 -Compress
}

function Do-Read([string]$regPath) {
  $resolved = Resolve-RegPath $regPath
  if (-not (Test-Path -LiteralPath $resolved)) {
    return @{ ok = $false; error = "key does not exist: $regPath" }
  }
  $item = Get-Item -LiteralPath $resolved
  $props = Get-ItemProperty -LiteralPath $resolved
  $values = @()
  foreach ($prop in $item.Property) {
    $values += @{ name = $prop; value = "$($props.$prop)" }
  }
  $subkeys = @(Get-ChildItem -LiteralPath $resolved -ErrorAction SilentlyContinue | ForEach-Object { $_.PSChildName })
  return @{ ok = $true; path = $regPath; values = $values; subkeys = $subkeys }
}

function Do-Get([string]$regPath, [string]$name) {
  $resolved = Resolve-RegPath $regPath
  if (-not (Test-Path -LiteralPath $resolved)) {
    return @{ ok = $false; error = "key does not exist: $regPath" }
  }
  $props = Get-ItemProperty -LiteralPath $resolved -ErrorAction SilentlyContinue
  if ($null -eq $props -or -not (Get-Member -InputObject $props -Name $name -ErrorAction SilentlyContinue)) {
    return @{ ok = $false; error = "value '$name' not found under $regPath" }
  }
  return @{ ok = $true; path = $regPath; name = $name; value = "$($props.$name)" }
}

$Script:SearchDepthCap = 10

# A hand-rolled recursive walk rather than `Get-ChildItem -Recurse` — that
# cmdlet materialises the ENTIRE subtree before anything can look at it, so
# MaxResults only trimmed the result list, not the walk itself. A search
# rooted at HKCU\Software (a few hundred installed apps' worth of keys) took
# about a minute to return a single hit before this fix, which defeats the
# point of a "quick lookup" tool. This stops descending the moment enough
# hits are found, and caps depth as a second, independent guard.
function Search-Walk([string]$keyPath, [string]$query, [int]$maxResults, [System.Collections.ArrayList]$hits, [int]$depth) {
  if ($hits.Count -ge $maxResults -or $depth -gt $Script:SearchDepthCap) { return }

  $childName = Split-Path -Leaf $keyPath
  if ($childName -like "*$query*") {
    [void]$hits.Add(@{ kind = "key"; path = $keyPath })
  }

  $props = Get-ItemProperty -LiteralPath $keyPath -ErrorAction SilentlyContinue
  if ($props) {
    $propNames = @($props.PSObject.Properties.Name | Where-Object { $_ -notlike "PS*" })
    foreach ($prop in $propNames) {
      if ($hits.Count -ge $maxResults) { return }
      if ($prop -like "*$query*" -or "$($props.$prop)" -like "*$query*") {
        [void]$hits.Add(@{ kind = "value"; path = $keyPath; name = $prop; value = "$($props.$prop)" })
      }
    }
  }

  $children = Get-ChildItem -LiteralPath $keyPath -ErrorAction SilentlyContinue
  foreach ($child in $children) {
    if ($hits.Count -ge $maxResults) { return }
    Search-Walk $child.PSPath.Replace('Microsoft.PowerShell.Core\Registry::', '') $query $maxResults $hits ($depth + 1)
  }
}

function Do-Search([string]$root, [string]$query, [int]$maxResults) {
  $resolved = Resolve-RegPath $root
  if (-not (Test-Path -LiteralPath $resolved)) {
    return @{ ok = $false; error = "root does not exist: $root" }
  }
  $hits = New-Object System.Collections.ArrayList
  Search-Walk $resolved $query $maxResults $hits 0
  return @{ ok = $true; count = $hits.Count; hits = @($hits) }
}

function Do-Export([string]$regPath, [string]$file) {
  $dir = Split-Path -Parent $file
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  # reg.exe wants the plain "HKCU\Software\Foo" form, not the PowerShell
  # drive-qualified "HKCU:\Software\Foo".
  $regExeArg = $regPath -replace '^([A-Za-z_]+)[:\\]*\\?', '$1\'
  $regExeArg = $regExeArg.TrimEnd('\')
  & reg.exe export $regExeArg $file /y | Out-Null
  if ($LASTEXITCODE -ne 0) {
    return @{ ok = $false; error = "reg export exited with code $LASTEXITCODE - the key may not exist" }
  }
  return @{ ok = $true; file = $file }
}

function Do-Import([string]$file) {
  if (-not (Test-Path -LiteralPath $file)) {
    return @{ ok = $false; error = "backup file not found: $file" }
  }
  & reg.exe import $file | Out-Null
  if ($LASTEXITCODE -ne 0) {
    return @{ ok = $false; error = "reg import exited with code $LASTEXITCODE" }
  }
  return @{ ok = $true }
}

function Do-Set([string]$regPath, [string]$name, [string]$value, [string]$type) {
  $resolved = Resolve-RegPath $regPath
  if (-not (Test-Path -LiteralPath $resolved)) {
    New-Item -Path $resolved -Force | Out-Null
  }
  $typedValue = $value
  switch ($type) {
    "DWord"  { $typedValue = [int64]$value }
    "QWord"  { $typedValue = [int64]$value }
    "Binary" { $typedValue = [byte[]]($value -split ',' | ForEach-Object { [byte]$_ }) }
    "MultiString" { $typedValue = $value -split ';' }
    default  { $typedValue = $value }
  }
  New-ItemProperty -Path $resolved -Name $name -Value $typedValue -PropertyType $type -Force | Out-Null
  $readBack = Get-ItemProperty -LiteralPath $resolved
  return @{ ok = $true; path = $regPath; name = $name; value = "$($readBack.$name)" }
}

function Do-Delete([string]$regPath, [string]$name) {
  $resolved = Resolve-RegPath $regPath
  if (-not (Test-Path -LiteralPath $resolved)) {
    return @{ ok = $false; error = "key does not exist: $regPath" }
  }
  if ($name) {
    Remove-ItemProperty -LiteralPath $resolved -Name $name -Force -ErrorAction Stop
    return @{ ok = $true; path = $regPath; deletedName = $name }
  } else {
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
    return @{ ok = $true; path = $regPath; deletedKey = $true }
  }
}

try {
  $result = switch ($Op) {
    "read"    { Do-Read $Path }
    "get"     { Do-Get $Path $Name }
    "search"  { Do-Search $Path $Query $MaxResults }
    "export"  { Do-Export $Path $File }
    "import"  { Do-Import $File }
    "set"     { Do-Set $Path $Name $Value $Type }
    "delete"  { Do-Delete $Path $Name }
    default   { @{ ok = $false; error = "unknown op '$Op'" } }
  }
  Write-Output (Json $result)
} catch {
  Write-Output (Json @{ ok = $false; error = $_.Exception.Message })
  exit 1
}
