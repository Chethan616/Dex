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
    [switch]$DryRun,
    # Phase B addition: process only entries whose enclosing `_section` label
    # contains this substring. Empty/unset means "process everything". Used so
    # B.5 / B.6 / B.7 can run isolated passes of the same canonical map.
    [string]$SectionFilter = '',
    # Phase B addition: split src vs tests passes. `all` (default) processes
    # every file. `src` skips test files. `tests` ONLY processes test files.
    [ValidateSet('all','src','tests')]
    [string]$Mode = 'all'
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

Write-Host ("Target:         {0}" -f $Target) -ForegroundColor Cyan
Write-Host ("Map:            {0}" -f $MapPath) -ForegroundColor Cyan
Write-Host ("Mode:           {0}" -f $Mode) -ForegroundColor Cyan
if ($SectionFilter) {
    Write-Host ("SectionFilter:  {0}" -f $SectionFilter) -ForegroundColor Cyan
}
if ($DryRun) {
    Write-Host "DryRun: ON (no files will be written)" -ForegroundColor Yellow
}
Write-Host ""

$mapRaw = Get-Content -LiteralPath $MapPath -Raw -Encoding UTF8
$map = $mapRaw | ConvertFrom-Json
if (-not $map.replacements) {
    Write-Host "rebrand-map.json has no `replacements` array." -ForegroundColor Red
    exit 1
}

# ---- Path exclusions (build outputs we never modify) -----------------------
# Without this, broad globs like `**/*.ts` would rewrite TS sources inside
# node_modules and the build output dir, which silently corrupts deps and
# regenerates on next install. The audit script uses the same list.
$ExcludeFragments = @(
    '\node_modules\', '\dist\', '\.git\', '\.turbo\',
    '\coverage\', '\.next\', '\.cache\', '\.vscode-test\', '\.venv\'
)
# Lockfiles record exact-version + integrity hashes; rewriting them via
# string substitution corrupts the hash. Let `pnpm install` regenerate
# the lockfile after the rebrand instead.
$ExcludeFiles = @('pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'shrinkwrap.json')
function Test-PathExcluded {
    param([string]$Path)
    $name = [System.IO.Path]::GetFileName($Path)
    if ($ExcludeFiles -contains $name) { return $true }
    foreach ($frag in $ExcludeFragments) {
        if ($Path -like "*$frag*") { return $true }
    }
    return $false
}

# Test-file detection: anything matching *.test.*, *.spec.*, or under
# `/test/`, `/tests/`, `/__tests__/`, `/fixtures/`, `/__fixtures__/`.
function Test-IsTestFile {
    param([string]$Path)
    $name = [System.IO.Path]::GetFileName($Path)
    if ($name -match '\.(test|spec)\.[a-z]+$') { return $true }
    foreach ($seg in @('\test\','\tests\','\__tests__\','\fixtures\','\__fixtures__\','\test-helpers\')) {
        if ($Path -like "*$seg*") { return $true }
    }
    return $false
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
        Where-Object {
            (-not (Test-PathExcluded $_.FullName)) -and
            ($Mode -eq 'all' -or
             ($Mode -eq 'src'   -and -not (Test-IsTestFile $_.FullName)) -or
             ($Mode -eq 'tests' -and       (Test-IsTestFile $_.FullName)))
        } |
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
$globCache = @{}
$currentSection = ''
$skipBecauseSection = $false

foreach ($entry in $map.replacements) {
    # Track which `_section` we are inside, so $SectionFilter can scope a run.
    if ($entry._section) {
        $currentSection = [string]$entry._section
        if ($SectionFilter -and ($currentSection -notlike "*$SectionFilter*")) {
            $skipBecauseSection = $true
            Write-Host ("Section skipped (filter={0}): {1}" -f $SectionFilter, $currentSection) -ForegroundColor DarkGray
        } else {
            $skipBecauseSection = $false
            Write-Host ("Section: {0}" -f $currentSection) -ForegroundColor Cyan
        }
        continue
    }
    if ($skipBecauseSection) { continue }
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
        # Cache glob -> files per (Target, Mode). The rebrand-map has 1700+
        # entries sharing a small set of globs; without caching, each entry
        # triggers a fresh Get-ChildItem -Recurse over core/ (~20k files).
        $cacheKey = "${Mode}::$glob"
        if ($globCache.ContainsKey($cacheKey)) {
            $files = $globCache[$cacheKey]
        } else {
            $files = Resolve-Glob -Target $Target -Pattern $glob
            $globCache[$cacheKey] = $files
        }
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
