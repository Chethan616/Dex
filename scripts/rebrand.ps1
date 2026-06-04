<#
.SYNOPSIS
    Applies the OpenClaw -> DexCore rebrand to a target directory using the
    exact-match replacement table in scripts\rebrand-map.json.

.DESCRIPTION
    Phase A.3 of the Dex plan. Each entry in rebrand-map.json declares:
      - find:     EXACT string to find (no regex, no fuzzy match)
      - replace:  EXACT replacement
      - files:    glob(s) scoping which files to touch
      - optional: if true, missing `find` is allowed; default false

    The script fails loudly on misses. If a required `find` is not found in
    any matching file, the rebrand aborts -- that's the canary for upstream
    drift when we bump the vendor pin.

    Idempotent: running twice produces the same result. Replacements that
    are already applied just have zero hits in the second pass, which the
    `optional` flag tolerates.

.PARAMETER Target
    Root directory to rebrand. Default: D:\project1\core

.PARAMETER MapPath
    Path to rebrand-map.json. Default: D:\project1\scripts\rebrand-map.json

.PARAMETER DryRun
    Show what would change without writing. Recommended on first run.

.EXAMPLE
    .\scripts\rebrand.ps1 -DryRun
    .\scripts\rebrand.ps1
#>

[CmdletBinding()]
param(
    [string]$Target = (Join-Path (Split-Path -Parent $PSScriptRoot) 'core'),
    [string]$MapPath = (Join-Path $PSScriptRoot 'rebrand-map.json'),
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Target -PathType Container)) {
    Write-Host ("Target directory not found: {0}" -f $Target) -ForegroundColor Red
    exit 1
}
if (-not (Test-Path -LiteralPath $MapPath -PathType Leaf)) {
    Write-Host ("rebrand-map.json not found: {0}" -f $MapPath) -ForegroundColor Red
    exit 1
}

$mapRaw = Get-Content -LiteralPath $MapPath -Raw -Encoding UTF8
$map = $mapRaw | ConvertFrom-Json
if (-not $map.replacements) {
    Write-Host "rebrand-map.json has no `replacements` array." -ForegroundColor Red
    exit 1
}

# ---- Glob expansion -------------------------------------------------------
# Expand a glob like "src/cli/**/*.ts" relative to $Target into a list of
# real files. PowerShell's Get-ChildItem -Recurse + Include handles **/*.ext
# patterns once we split the leading-most directory from the extension glob.
function Resolve-Glob {
    param([string]$Target, [string]$Pattern)
    if ($Pattern -notmatch '\*') {
        # Plain file -- check existence.
        $p = Join-Path $Target $Pattern
        if (Test-Path -LiteralPath $p -PathType Leaf) { return @($p) }
        return @()
    }
    # Split "src/cli/**/*.ts" into base="src/cli" + filter="*.ts".
    $parts = $Pattern -split '/'
    $baseSegs = @()
    $filter = $null
    for ($i = 0; $i -lt $parts.Length; $i++) {
        if ($parts[$i] -eq '**') { continue }
        if ($parts[$i] -match '\*') { $filter = $parts[$i]; break }
        $baseSegs += $parts[$i]
    }
    if (-not $filter) { $filter = '*' }
    $base = if ($baseSegs.Count -gt 0) { Join-Path $Target ($baseSegs -join '\') } else { $Target }
    if (-not (Test-Path -LiteralPath $base -PathType Container)) { return @() }
    return Get-ChildItem -LiteralPath $base -Recurse -File -Filter $filter -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty FullName
}

# ---- Apply replacements ---------------------------------------------------
$stats = [ordered]@{
    entries      = 0
    hits         = 0
    filesTouched = 0
    misses       = @()  # required entries with zero hits
}
$touchedFiles = [System.Collections.Generic.HashSet[string]]::new()

foreach ($entry in $map.replacements) {
    # Skip section dividers (have only _section).
    if (-not $entry.find) { continue }
    if (-not $entry.replace -and -not $entry.optional) {
        Write-Host ("Entry has `find` but no `replace`: {0}" -f $entry.find) -ForegroundColor Red
        exit 1
    }

    $stats.entries++
    $isOptional = ($entry.optional -eq $true)
    $entryHits  = 0

    foreach ($glob in @($entry.files)) {
        $files = Resolve-Glob -Target $Target -Pattern $glob
        foreach ($file in $files) {
            $content = Get-Content -LiteralPath $file -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
            if ($null -eq $content) { continue }
            if (-not $content.Contains($entry.find)) { continue }

            $countInFile = ($content.Length - $content.Replace($entry.find, '').Length) / $entry.find.Length
            $entryHits += [int]$countInFile

            if (-not $DryRun) {
                $newContent = $content.Replace($entry.find, $entry.replace)
                # Preserve UTF-8 without BOM
                [System.IO.File]::WriteAllText($file, $newContent, [System.Text.UTF8Encoding]::new($false))
            }
            $null = $touchedFiles.Add($file)

            $rel = $file.Substring($Target.Length).TrimStart('\','/')
            $arrow = if ($DryRun) { '[would]' } else { '[done]' }
            Write-Host ("  {0} {1,-50}  hits={2}" -f $arrow, $rel, [int]$countInFile) -ForegroundColor DarkGray
        }
    }

    $stats.hits += $entryHits

    if ($entryHits -eq 0 -and -not $isOptional) {
        $stats.misses += $entry.find
        Write-Host ("  [MISS] find not found anywhere: {0}" -f $entry.find) -ForegroundColor Red
    } else {
        $tag = if ($isOptional -and $entryHits -eq 0) { 'optional, 0 hits' } else { ("{0} hits" -f $entryHits) }
        Write-Host ("  -> entry done: {0}" -f $tag) -ForegroundColor DarkGreen
    }
    Write-Host ""
}

$stats.filesTouched = $touchedFiles.Count

Write-Host ""
Write-Host ("Target:       {0}" -f $Target) -ForegroundColor Cyan
Write-Host ("Entries:      {0}" -f $stats.entries) -ForegroundColor Cyan
Write-Host ("Total hits:   {0}" -f $stats.hits) -ForegroundColor Cyan
Write-Host ("Files touched:{0}" -f $stats.filesTouched) -ForegroundColor Cyan
Write-Host ("Misses:       {0}" -f $stats.misses.Count) -ForegroundColor Cyan
Write-Host ""

if ($stats.misses.Count -gt 0) {
    Write-Host "REBRAND FAILED -- required `find` strings not found:" -ForegroundColor Red
    foreach ($m in $stats.misses) {
        Write-Host ("  - {0}" -f $m) -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "This is the upstream-drift canary. Either:" -ForegroundColor Yellow
    Write-Host "  (a) The pinned commit changed and these strings no longer exist -- update rebrand-map.json." -ForegroundColor Yellow
    Write-Host "  (b) Mark the entry optional:true if it's genuinely sometimes-absent." -ForegroundColor Yellow
    exit 2
}

if ($DryRun) {
    Write-Host "Dry run -- no files written. Re-run without -DryRun to apply." -ForegroundColor Yellow
} else {
    Write-Host "Done. core/ now identifies as DexCore on user-visible surfaces." -ForegroundColor Green
    Write-Host ""
    Write-Host "Next:" -ForegroundColor Green
    Write-Host "  cd D:\project1\core" -ForegroundColor DarkGray
    Write-Host "  npm install     # (or pnpm install if you have it)" -ForegroundColor DarkGray
    Write-Host "  npm run build" -ForegroundColor DarkGray
    Write-Host "  .\bin\dex-core.cmd gateway --help    # expect 'DexCore Gateway' banner" -ForegroundColor DarkGray
}
