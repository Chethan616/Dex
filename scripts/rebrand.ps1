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
    # Phase B addition: complement of $SectionFilter. Entries whose enclosing
    # `_section` label contains this substring are skipped. Used in B.6 to
    # run "everything except the already-applied Section 4 (workspace)".
    [string]$ExcludeSection = '',
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
    '\coverage\', '\.next\', '\.cache\', '\.vscode-test\', '\.venv\',
    # Legacy-bridge code legitimately references the OLD names so it can
    # migrate users from them. Mechanical rebrand would corrupt these files.
    '\src\migrations\',
    # Dex-canonical helpers that reference the legacy name as a string constant
    # (the dexEnv shim's LEGACY_PREFIX = "OPENCLAW_"). The build-time TS
    # reading the path needs OPENCLAW_ to remain literal.
    '\src\env\'
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
    # NOTE: `test-helpers/` is INTENTIONALLY NOT here. Files under test-helpers/
    # are runtime modules imported by ordinary src code (e.g. provider-test
    # contracts, config types testkits) -- the build fails if they keep stale
    # OpenClaw* names while the rest of src is renamed. Treat them as src.
    foreach ($seg in @('\test\','\tests\','\__tests__\','\fixtures\','\__fixtures__\')) {
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

# ---- Apply replacements (per-file algorithm) ------------------------------
# The map has ~1700 entries. The old per-entry loop did a recursive directory
# walk + file read for each entry -> 1700 * 20000 = 34M file reads. The new
# algorithm walks each file ONCE, then applies every entry whose globs match
# that file. Within a file, entries process in array order so longest-first
# sort (emitted by the generator) prevents prefix overlap from corrupting
# matches (`OPENCLAW_AUTH` would otherwise eat `OPENCLAW_AUTH_CHOICE`).

$stats = [ordered]@{
    entries      = 0
    hits         = 0
    filesTouched = 0
    misses       = @()  # required entries with zero hits
}
$touchedFiles = [System.Collections.Generic.HashSet[string]]::new()

# --- Pass 1: collect entries-to-apply, with hit counters ---------------------
$entriesToApply = New-Object System.Collections.ArrayList
$currentSection = ''
$skipBecauseSection = $false

foreach ($entry in $map.replacements) {
    if ($entry._section) {
        $currentSection = [string]$entry._section
        $skipReason = ''
        if ($SectionFilter -and ($currentSection -notlike "*$SectionFilter*")) {
            $skipReason = "filter=$SectionFilter"
        } elseif ($ExcludeSection -and ($currentSection -like "*$ExcludeSection*")) {
            $skipReason = "exclude=$ExcludeSection"
        }
        if ($skipReason) {
            $skipBecauseSection = $true
            Write-Host ("Section skipped ({0}): {1}" -f $skipReason, $currentSection) -ForegroundColor DarkGray
        } else {
            $skipBecauseSection = $false
            Write-Host ("Section: {0}" -f $currentSection) -ForegroundColor Cyan
        }
        continue
    }
    if ($skipBecauseSection) { continue }
    if (-not $entry.find) { continue }
    if (-not $entry.replace -and -not $entry.optional) {
        Write-Host ("Entry has `find` but no `replace`: {0}" -f $entry.find) -ForegroundColor Red
        exit 1
    }
    # We mutate a side-table for hits rather than the (immutable) JSON object.
    $entry | Add-Member -Force -NotePropertyName _hits -NotePropertyValue 0
    [void]$entriesToApply.Add($entry)
    $stats.entries++
}

# --- Pass 2: index entries by extension + by exact relative path -----------
# Glob taxonomy in this map (from build-rebrand-map.ps1):
#   - `package.json` / `openclaw.mjs`  -> EXACT relative path (no `*`).
#   - `**/*.ext`                        -> ANY file with that extension.
#   - `src/cli/**/*.ext`                -> file with extension UNDER that prefix.
$entriesByExtAndPrefix = @{}   # ext (lc) -> list of @{ entry, basePath }
$entriesByExactRel     = @{}   # relative-path (with '\' sep) -> list of entries

function Parse-Glob {
    param([string]$Glob)
    if ($Glob -notmatch '\*') {
        return [pscustomobject]@{ kind = 'exact'; relPath = ($Glob -replace '/', '\') }
    }
    # Glob like `**/*.ts` or `src/cli/**/*.ts`. Split on '/', collect non-** non-glob segments
    # as the base prefix; the last segment must be `*.ext` for our map.
    $parts = $Glob -split '/'
    $baseSegs = @()
    $ext = ''
    foreach ($p in $parts) {
        if ($p -eq '**') { continue }
        if ($p -match '^\*\.(.+)$') { $ext = '.' + $matches[1].ToLower(); break }
        if ($p -match '\*') { return $null }   # unsupported pattern shape
        $baseSegs += $p
    }
    if (-not $ext) { return $null }
    $basePath = if ($baseSegs.Count -gt 0) { ($baseSegs -join '\') + '\' } else { '' }
    return [pscustomobject]@{ kind = 'extPrefix'; ext = $ext; basePath = $basePath }
}

foreach ($entry in $entriesToApply) {
    foreach ($glob in @($entry.files)) {
        $parsed = Parse-Glob $glob
        if (-not $parsed) {
            Write-Host ("Unsupported glob (skipped): {0}" -f $glob) -ForegroundColor Yellow
            continue
        }
        if ($parsed.kind -eq 'exact') {
            if (-not $entriesByExactRel.ContainsKey($parsed.relPath)) {
                $entriesByExactRel[$parsed.relPath] = New-Object System.Collections.ArrayList
            }
            [void]$entriesByExactRel[$parsed.relPath].Add($entry)
        } else {
            if (-not $entriesByExtAndPrefix.ContainsKey($parsed.ext)) {
                $entriesByExtAndPrefix[$parsed.ext] = New-Object System.Collections.ArrayList
            }
            [void]$entriesByExtAndPrefix[$parsed.ext].Add(
                [pscustomobject]@{ entry = $entry; basePath = $parsed.basePath }
            )
        }
    }
}

Write-Host ""
Write-Host ("Entries indexed: {0} (by-ext groups: {1}, exact-path entries: {2})" -f `
    $entriesToApply.Count, $entriesByExtAndPrefix.Count, $entriesByExactRel.Count) -ForegroundColor Cyan
Write-Host "Walking files ..." -ForegroundColor Cyan

# --- Pass 3: walk files once, apply matching entries ----------------------
$processed = 0
$startTime = Get-Date

Get-ChildItem -LiteralPath $Target -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    $full = $_.FullName
    if (Test-PathExcluded $full) { return }
    if ($Mode -eq 'src'   -and (Test-IsTestFile $full)) { return }
    if ($Mode -eq 'tests' -and -not (Test-IsTestFile $full)) { return }

    $processed++
    if ($processed % 2000 -eq 0) {
        $elapsed = (Get-Date) - $startTime
        Write-Host ("  ... processed {0} files ({1:N0}s)" -f $processed, $elapsed.TotalSeconds) -ForegroundColor DarkGray
    }

    $rel = $full.Substring($Target.Length).TrimStart('\','/')
    $ext = $_.Extension.ToLower()

    # Collect entries that could match this file (by ext + path prefix; plus exact-path).
    $applicable = $null
    $entryGroup = $entriesByExtAndPrefix[$ext]
    if ($entryGroup) {
        foreach ($e in $entryGroup) {
            if ($e.basePath -eq '' -or $rel.StartsWith($e.basePath)) {
                if (-not $applicable) { $applicable = New-Object System.Collections.ArrayList }
                [void]$applicable.Add($e.entry)
            }
        }
    }
    $exactList = $entriesByExactRel[$rel]
    if ($exactList) {
        if (-not $applicable) { $applicable = New-Object System.Collections.ArrayList }
        foreach ($e in $exactList) { [void]$applicable.Add($e) }
    }
    if (-not $applicable -or $applicable.Count -eq 0) { return }

    $content = Get-Content -LiteralPath $full -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    if ($null -eq $content) { return }
    $orig = $content
    $perFileHits = 0

    foreach ($entry in $applicable) {
        if (-not $content.Contains($entry.find)) { continue }
        $count = ($content.Length - $content.Replace($entry.find, '').Length) / $entry.find.Length
        $entry._hits += [int]$count
        $perFileHits += [int]$count
        $content = $content.Replace($entry.find, $entry.replace)
    }

    if ($perFileHits -gt 0) {
        $stats.hits += $perFileHits
        if (-not $DryRun -and $content -ne $orig) {
            [System.IO.File]::WriteAllText($full, $content, [System.Text.UTF8Encoding]::new($false))
        }
        [void]$touchedFiles.Add($full)
    }
}

$stats.filesTouched = $touchedFiles.Count

# --- Pass 4: validate hit counts ------------------------------------------
foreach ($entry in $entriesToApply) {
    $isOptional = ($entry.optional -eq $true)
    if ($entry._hits -eq 0 -and -not $isOptional) {
        $stats.misses += $entry.find
    }
}

Write-Host ""
Write-Host ("Target:       {0}" -f $Target) -ForegroundColor Cyan
Write-Host ("Entries:      {0}" -f $stats.entries) -ForegroundColor Cyan
Write-Host ("Total hits:   {0}" -f $stats.hits) -ForegroundColor Cyan
Write-Host ("Files touched:{0}" -f $stats.filesTouched) -ForegroundColor Cyan
Write-Host ("Misses:       {0}" -f $stats.misses.Count) -ForegroundColor Cyan
Write-Host ""

if ($stats.misses.Count -gt 0) {
    # Misses are only an error when Mode='all' -- a full validation pass MUST
    # find every required string somewhere in the tree. With Mode='src' or
    # 'tests' we deliberately skip half the files, so entries that only appear
    # in the other half register as misses without indicating drift.
    $missesFatal = ($Mode -eq 'all')
    $color = if ($missesFatal) { 'Red' } else { 'Yellow' }
    $tag = if ($missesFatal) { 'REBRAND FAILED' } else { ('Misses (warning only, Mode={0})' -f $Mode) }
    Write-Host ("{0} -- {1} required `find` strings not found:" -f $tag, $stats.misses.Count) -ForegroundColor $color
    # In Mode=all we want every missing string listed (it is an actionable
    # failure). In src/tests modes the list can be huge (~300+); print a
    # summary count instead, and only show up to 20 examples.
    $sample = if ($missesFatal) { $stats.misses } else { $stats.misses | Select-Object -First 20 }
    foreach ($m in $sample) {
        Write-Host ("  - {0}" -f $m) -ForegroundColor $color
    }
    if (-not $missesFatal -and $stats.misses.Count -gt $sample.Count) {
        Write-Host ("  ... and {0} more (Mode={1} -- these likely live in the other half)" -f `
            ($stats.misses.Count - $sample.Count), $Mode) -ForegroundColor $color
    }
    Write-Host ""
    if ($missesFatal) {
        Write-Host "This is the upstream-drift canary. Either:" -ForegroundColor Yellow
        Write-Host "  (a) The pinned commit changed and these strings no longer exist -- update rebrand-map.json." -ForegroundColor Yellow
        Write-Host "  (b) Mark the entry optional:true if it's genuinely sometimes-absent." -ForegroundColor Yellow
        exit 2
    }
}

if ($DryRun) {
    Write-Host "Dry run -- no files written. Re-run without -DryRun to apply." -ForegroundColor Yellow
} else {
    Write-Host "Done. Re-run `pnpm install` then `pnpm build` if package.json names changed." -ForegroundColor Green
}
