<#
.SYNOPSIS
    Generates docs/migration/openclaw-audit.md by running category greps over
    the core/ tree. The output drives Phase B planning (rebrand-map.json size,
    config-dir migrator scope, env var shim coverage, etc.).

.DESCRIPTION
    Phase B.1 of the Dex plan. The script categorizes every "openclaw" residue
    in core/ so we know what each later commit has to touch. Categories:

      1. Config dir / config file references  (~/.openclaw, openclaw.json)
      2. Internal @openclaw/* workspace packages (core/packages/*/package.json)
      3. External @openclaw/* upstream npm deps (preserved per heritage commit)
      4. Unique OPENCLAW_* environment variable names
      5. Internal PascalCase TS identifiers matching /\bOpenClaw[A-Z]\w*\b/
      6. docs.openclaw.ai URLs
      7. Outbound openclaw.ai / clawhub telemetry-shaped strings
      8. Hardcoded "openclaw <subcommand>" example strings (tests + docs)

    The report is purely descriptive -- it does NOT modify any source. Subsequent
    Phase B commits (B.2 onwards) consume this report to size their work.

.PARAMETER Target
    Tree to audit. Default: D:\project1\core

.PARAMETER OutputPath
    Markdown report path. Default: D:\project1\docs\migration\openclaw-audit.md

.EXAMPLE
    .\scripts\audit-openclaw.ps1
    .\scripts\audit-openclaw.ps1 -Target D:\project1\dex\core
#>

[CmdletBinding()]
param(
    [string]$Target = (Join-Path (Split-Path -Parent $PSScriptRoot) 'core'),
    [string]$OutputPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'docs\migration\openclaw-audit.md')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Target -PathType Container)) {
    Write-Error "Target not found: $Target"
    exit 1
}

$outDir = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outDir -PathType Container)) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

$resolvedTarget = (Resolve-Path -LiteralPath $Target).Path
Write-Host ("Auditing: {0}" -f $resolvedTarget) -ForegroundColor Cyan

# Directories we never scan (build output, dependency caches, VCS internals).
$excludeFragments = @(
    '\node_modules\',
    '\dist\',
    '\.git\',
    '\.turbo\',
    '\coverage\',
    '\.next\',
    '\.cache\',
    '\.vscode-test\',
    '\.venv\'
)

function Test-ExcludedPath {
    param([string]$Path)
    foreach ($frag in $excludeFragments) {
        if ($Path -like "*$frag*") { return $true }
    }
    return $false
}

# File-class filters. Each category uses a different mix.
$codeExtensions = @('.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx')
$configExtensions = @('.json', '.json5', '.yaml', '.yml', '.toml', '.env', '.ini')
$docExtensions = @('.md', '.mdx', '.txt')
$allTextExtensions = $codeExtensions + $configExtensions + $docExtensions

function Get-ScanFiles {
    param([string[]]$Extensions)
    Get-ChildItem -LiteralPath $resolvedTarget -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object {
            $ext = $_.Extension.ToLower()
            $Extensions -contains $ext -and -not (Test-ExcludedPath $_.FullName)
        }
}

# Cache the canonical file lists once -- repeated Get-ChildItem on 19k+ files
# would otherwise dominate runtime.
Write-Host "  Enumerating files (this is the slow step) ..." -ForegroundColor DarkGray
$codeFiles = @(Get-ScanFiles -Extensions $codeExtensions)
$configFiles = @(Get-ScanFiles -Extensions $configExtensions)
$allTextFiles = @(Get-ScanFiles -Extensions $allTextExtensions)
Write-Host ("  code={0}  config={1}  text-total={2}" -f $codeFiles.Count, $configFiles.Count, $allTextFiles.Count) -ForegroundColor DarkGray

function Invoke-PatternScan {
    <#
    .SYNOPSIS
        Run Select-String over a fileset and return (matches, distinct files).
    #>
    param(
        [Parameter(Mandatory)] [object[]]$Files,
        [Parameter(Mandatory)] [string]$Pattern,
        [switch]$CaseSensitive
    )
    if ($Files.Count -eq 0) {
        return [pscustomobject]@{ Total = 0; Files = 0; Sample = @() }
    }
    $params = @{
        Pattern = $Pattern
        Path = $Files.FullName
        AllMatches = $true
    }
    if ($CaseSensitive) { $params['CaseSensitive'] = $true }
    $matches = Select-String @params -ErrorAction SilentlyContinue
    if (-not $matches) {
        return [pscustomobject]@{ Total = 0; Files = 0; Sample = @() }
    }
    $totalHits = ($matches | ForEach-Object { $_.Matches.Count } | Measure-Object -Sum).Sum
    $distinctPaths = $matches | Select-Object -ExpandProperty Path -Unique
    $samplePaths = $distinctPaths | Select-Object -First 5 | ForEach-Object {
        $_.Substring($resolvedTarget.Length).TrimStart('\','/')
    }
    return [pscustomobject]@{
        Total  = [int]$totalHits
        Files  = [int]$distinctPaths.Count
        Sample = $samplePaths
    }
}

# ---- Category 1: config dir / config file references --------------------
Write-Host "  [1/8] config dir + openclaw.json references ..." -ForegroundColor DarkGray
$cat1 = Invoke-PatternScan -Files $allTextFiles -Pattern '\.openclaw[\\/]|openclaw\.json|"\.openclaw"' -CaseSensitive

# ---- Category 2: internal @openclaw/* workspace packages ------------------
Write-Host "  [2/8] internal @openclaw/* workspace packages ..." -ForegroundColor DarkGray
$workspacePkgs = @()
$packagesRoot = Join-Path $resolvedTarget 'packages'
if (Test-Path -LiteralPath $packagesRoot -PathType Container) {
    Get-ChildItem -LiteralPath $packagesRoot -Directory | ForEach-Object {
        $pj = Join-Path $_.FullName 'package.json'
        if (Test-Path -LiteralPath $pj -PathType Leaf) {
            try {
                $manifest = Get-Content -LiteralPath $pj -Raw -Encoding UTF8 | ConvertFrom-Json
                if ($manifest.name -and $manifest.name.StartsWith('@openclaw/')) {
                    $workspacePkgs += [pscustomobject]@{
                        Name = $manifest.name
                        Dir  = $_.Name
                    }
                }
            } catch { }
        }
    }
}

# ---- Category 3: external @openclaw/* upstream npm deps ------------------
Write-Host "  [3/8] external @openclaw/* npm deps ..." -ForegroundColor DarkGray
$internalNames = @($workspacePkgs | ForEach-Object { $_.Name })
$externalScoped = New-Object System.Collections.Generic.HashSet[string]
$pkgJsons = @($configFiles | Where-Object { $_.Name -eq 'package.json' })
foreach ($pj in $pkgJsons) {
    try {
        $manifest = Get-Content -LiteralPath $pj.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($block in @('dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies')) {
            $deps = $manifest.$block
            if (-not $deps) { continue }
            foreach ($prop in $deps.PSObject.Properties) {
                if ($prop.Name.StartsWith('@openclaw/') -and ($internalNames -notcontains $prop.Name)) {
                    [void]$externalScoped.Add($prop.Name)
                }
            }
        }
    } catch { }
}

# ---- Category 4: unique OPENCLAW_* env var names -------------------------
Write-Host "  [4/8] unique OPENCLAW_* env var names ..." -ForegroundColor DarkGray
$envVarSet = New-Object System.Collections.Generic.HashSet[string]
$cat4Scan = Select-String -Path $codeFiles.FullName -Pattern 'OPENCLAW_[A-Z][A-Z0-9_]+' -AllMatches -CaseSensitive -ErrorAction SilentlyContinue
if ($cat4Scan) {
    foreach ($m in $cat4Scan) {
        foreach ($match in $m.Matches) {
            [void]$envVarSet.Add($match.Value)
        }
    }
}
$cat4FileCount = if ($cat4Scan) { ($cat4Scan | Select-Object -ExpandProperty Path -Unique).Count } else { 0 }

# ---- Category 5: PascalCase OpenClaw* TS identifiers ---------------------
Write-Host "  [5/8] PascalCase OpenClaw* TS identifiers ..." -ForegroundColor DarkGray
$identSet = New-Object System.Collections.Generic.HashSet[string]
$cat5Scan = Select-String -Path $codeFiles.FullName -Pattern '\bOpenClaw[A-Z][A-Za-z0-9_]*\b' -AllMatches -CaseSensitive -ErrorAction SilentlyContinue
if ($cat5Scan) {
    foreach ($m in $cat5Scan) {
        foreach ($match in $m.Matches) {
            [void]$identSet.Add($match.Value)
        }
    }
}
$cat5FileCount = if ($cat5Scan) { ($cat5Scan | Select-Object -ExpandProperty Path -Unique).Count } else { 0 }

# ---- Category 6: docs.openclaw.ai URLs -----------------------------------
Write-Host "  [6/8] docs.openclaw.ai URLs ..." -ForegroundColor DarkGray
$cat6 = Invoke-PatternScan -Files $allTextFiles -Pattern 'docs\.openclaw\.ai'

# ---- Category 7: outbound openclaw.ai / clawhub telemetry strings --------
Write-Host "  [7/8] telemetry-shaped openclaw.ai / clawhub strings ..." -ForegroundColor DarkGray
$cat7 = Invoke-PatternScan -Files $allTextFiles -Pattern '(?<!docs\.)openclaw\.ai|clawhub'

# ---- Category 8: hardcoded "openclaw <verb>" examples --------------------
Write-Host "  [8/8] hardcoded `"openclaw <verb>`" example strings ..." -ForegroundColor DarkGray
$cat8 = Invoke-PatternScan -Files $allTextFiles -Pattern '"openclaw [a-z][a-z0-9-]*"|''openclaw [a-z][a-z0-9-]*''|`openclaw [a-z][a-z0-9-]*`'

# ---- Compose the report --------------------------------------------------
$timestamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz')
$header = @"
# OpenClaw -> Dex migration audit

Generated: $timestamp
Source tree: ``$resolvedTarget``
Script: ``scripts/audit-openclaw.ps1``

This report inventories every category of ``openclaw`` residue in the fork.
Each later Phase B commit consumes one or more of these counts to size its
scope. Counts that drift by more than ``+/-10%`` on re-audit indicate the work
moved a measurable surface (good) or that exclusions need updating (bad).

Build-output dirs are excluded: ``node_modules/``, ``dist/``, ``.git/``,
``.turbo/``, ``coverage/``, ``.next/``, ``.cache/``, ``.vscode-test/``, ``.venv/``.

Files scanned:
- code (``.ts``, ``.tsx``, ``.js``, ``.mjs``, ``.cjs``, ``.jsx``): $($codeFiles.Count)
- config (``.json``, ``.yaml``, ``.toml``, ``.env``, ``.ini``): $($configFiles.Count)
- text total (code + config + docs): $($allTextFiles.Count)

## Summary table

| # | Category                                              | Files | Unique | Hits  |
|---|-------------------------------------------------------|------:|-------:|------:|
| 1 | Config dir / file refs (``.openclaw``, ``openclaw.json``) | $($cat1.Files) | - | $($cat1.Total) |
| 2 | Internal ``@openclaw/*`` workspace packages              | $($workspacePkgs.Count) | $($workspacePkgs.Count) | - |
| 3 | External ``@openclaw/*`` upstream npm deps               | - | $($externalScoped.Count) | - |
| 4 | Unique ``OPENCLAW_*`` env var names                      | $cat4FileCount | $($envVarSet.Count) | - |
| 5 | PascalCase ``OpenClaw*`` TS identifiers                  | $cat5FileCount | $($identSet.Count) | - |
| 6 | ``docs.openclaw.ai`` URLs                                | $($cat6.Files) | - | $($cat6.Total) |
| 7 | Telemetry ``openclaw.ai``/``clawhub``                    | $($cat7.Files) | - | $($cat7.Total) |
| 8 | Hardcoded ``"openclaw <verb>"`` examples                 | $($cat8.Files) | - | $($cat8.Total) |

> ``Hits`` counts every occurrence; ``Files`` counts distinct files; ``Unique``
> counts distinct identifier/name values where meaningful.

"@

$sections = New-Object System.Text.StringBuilder

# Section 1
[void]$sections.AppendLine('## 1. Config dir / config file references')
[void]$sections.AppendLine('')
[void]$sections.AppendLine("Pattern: ``\.openclaw[\\\/]|openclaw\.json|`"\.openclaw`"`` (case-sensitive).")
[void]$sections.AppendLine('')
[void]$sections.AppendLine("Hits: **$($cat1.Total)** across **$($cat1.Files)** files.")
[void]$sections.AppendLine('')
[void]$sections.AppendLine('Action (B.4): introduce a canonical config-dir constant + first-launch')
[void]$sections.AppendLine('auto-migrator (`core/src/migrations/config-dir-migrate.ts`). The 1:1 string')
[void]$sections.AppendLine('renames happen via the expanded `rebrand-map.json` (B.2).')
[void]$sections.AppendLine('')
[void]$sections.AppendLine('Sample paths:')
foreach ($p in $cat1.Sample) { [void]$sections.AppendLine("- ``$p``") }
[void]$sections.AppendLine('')

# Section 2
[void]$sections.AppendLine('## 2. Internal `@openclaw/*` workspace packages')
[void]$sections.AppendLine('')
[void]$sections.AppendLine("Found: **$($workspacePkgs.Count)** under ``core/packages/*``.")
[void]$sections.AppendLine('')
[void]$sections.AppendLine('Action (B.5): rename each to `@dexagent/*` and update every import +')
[void]$sections.AppendLine('sibling `package.json` dependency entry. `pnpm install` regenerates the')
[void]$sections.AppendLine('lockfile. Keep external `@openclaw/*` npm deps untouched (see #3).')
[void]$sections.AppendLine('')
[void]$sections.AppendLine('| Package name | Directory |')
[void]$sections.AppendLine('|---|---|')
foreach ($pkg in ($workspacePkgs | Sort-Object Name)) {
    [void]$sections.AppendLine("| ``$($pkg.Name)`` | ``packages/$($pkg.Dir)/`` |")
}
[void]$sections.AppendLine('')

# Section 3
[void]$sections.AppendLine('## 3. External `@openclaw/*` upstream npm deps (preserved)')
[void]$sections.AppendLine('')
[void]$sections.AppendLine("Found: **$($externalScoped.Count)** scoped names from the upstream npm")
[void]$sections.AppendLine('registry that are NOT workspace packages. These stay as-is per the')
[void]$sections.AppendLine('Heritage commitment (third-party libs we do not own).')
[void]$sections.AppendLine('')
if ($externalScoped.Count -gt 0) {
    foreach ($name in ($externalScoped | Sort-Object)) {
        [void]$sections.AppendLine("- ``$name``")
    }
} else {
    [void]$sections.AppendLine('_(none detected -- re-run after `pnpm install` resolves the lockfile if')
    [void]$sections.AppendLine('  external scoped deps are expected.)_')
}
[void]$sections.AppendLine('')

# Section 4
[void]$sections.AppendLine('## 4. Unique `OPENCLAW_*` environment variable names')
[void]$sections.AppendLine('')
[void]$sections.AppendLine("Unique names: **$($envVarSet.Count)** across **$cat4FileCount** code files.")
[void]$sections.AppendLine('')
[void]$sections.AppendLine('Action (B.3): introduce `dexEnv()` shim in `core/src/env/dex-env.ts` so')
[void]$sections.AppendLine('`DEX_*` is canonical with one-cycle `OPENCLAW_*` fallback + stderr')
[void]$sections.AppendLine('deprecation warning. Generated `docs/migration/env-vars.md` (B.6) lists every')
[void]$sections.AppendLine('rename pair so users updating shell profiles have a single reference.')
[void]$sections.AppendLine('')
[void]$sections.AppendLine('All unique env var names found:')
[void]$sections.AppendLine('')
[void]$sections.AppendLine('```')
foreach ($name in ($envVarSet | Sort-Object)) {
    [void]$sections.AppendLine($name)
}
[void]$sections.AppendLine('```')
[void]$sections.AppendLine('')

# Section 5
[void]$sections.AppendLine('## 5. PascalCase `OpenClaw*` TS identifiers')
[void]$sections.AppendLine('')
[void]$sections.AppendLine("Unique identifiers: **$($identSet.Count)** across **$cat5FileCount** code files.")
[void]$sections.AppendLine('')
[void]$sections.AppendLine('Action (B.2 -> B.6): the rebrand-map generator emits one exact-match')
[void]$sections.AppendLine('entry per identifier. The mechanical rename pass applies them under')
[void]$sections.AppendLine('`rebrand.ps1`. Source-file MIT header blocks are preserved verbatim via')
[void]$sections.AppendLine('`--exclude-header-lines 10`.')
[void]$sections.AppendLine('')
[void]$sections.AppendLine('Top 30 identifiers (alphabetical):')
[void]$sections.AppendLine('')
[void]$sections.AppendLine('```')
foreach ($id in (($identSet | Sort-Object) | Select-Object -First 30)) {
    [void]$sections.AppendLine($id)
}
if ($identSet.Count -gt 30) {
    [void]$sections.AppendLine("... and $($identSet.Count - 30) more")
}
[void]$sections.AppendLine('```')
[void]$sections.AppendLine('')

# Section 6
[void]$sections.AppendLine('## 6. `docs.openclaw.ai` URLs')
[void]$sections.AppendLine('')
[void]$sections.AppendLine("Hits: **$($cat6.Total)** across **$($cat6.Files)** files.")
[void]$sections.AppendLine('')
[void]$sections.AppendLine('Status: Phase A stubbed `formatDocsLink()` to return `""`, which neutralises')
[void]$sections.AppendLine('runtime output. The source strings remain because the upstream still owns')
[void]$sections.AppendLine('the docs site and there is no Dex-owned docs site yet. Reverify by checking')
[void]$sections.AppendLine('`core/dist/` for surviving runtime references after the rebrand pass.')
[void]$sections.AppendLine('')
[void]$sections.AppendLine('Sample paths:')
foreach ($p in $cat6.Sample) { [void]$sections.AppendLine("- ``$p``") }
[void]$sections.AppendLine('')

# Section 7
[void]$sections.AppendLine('## 7. Telemetry / update-channel endpoints')
[void]$sections.AppendLine('')
[void]$sections.AppendLine("Hits: **$($cat7.Total)** across **$($cat7.Files)** files (excluding `docs.openclaw.ai`).")
[void]$sections.AppendLine('')
[void]$sections.AppendLine('Action (B.8): inspect each hit. For outbound HTTP/WS calls, either stub')
[void]$sections.AppendLine('(no-op) or repoint to a Dex-owned endpoint. NPM registry queries that')
[void]$sections.AppendLine('look up package metadata become `dexagent` queries. The acceptance gate')
[void]$sections.AppendLine('for B.8 is: **fresh install makes zero outbound calls to `*.openclaw.ai` hosts**.')
[void]$sections.AppendLine('')
[void]$sections.AppendLine('Sample paths (manual review required):')
foreach ($p in $cat7.Sample) { [void]$sections.AppendLine("- ``$p``") }
[void]$sections.AppendLine('')

# Section 8
[void]$sections.AppendLine('## 8. Hardcoded `"openclaw <verb>"` example strings')
[void]$sections.AppendLine('')
[void]$sections.AppendLine("Hits: **$($cat8.Total)** across **$($cat8.Files)** files.")
[void]$sections.AppendLine('')
[void]$sections.AppendLine('Status: Phase A injected `replaceCliName()` into `formatHelpExample()` so')
[void]$sections.AppendLine('runtime help text already shows `dex <verb>`. Source-string survivors are')
[void]$sections.AppendLine('mostly in test fixtures + markdown examples. B.7 covers tests; markdown')
[void]$sections.AppendLine('docs largely stay until v1.5 (Dex has no docs site yet).')
[void]$sections.AppendLine('')
[void]$sections.AppendLine('Sample paths:')
foreach ($p in $cat8.Sample) { [void]$sections.AppendLine("- ``$p``") }
[void]$sections.AppendLine('')

# Footer + verification block
[void]$sections.AppendLine('---')
[void]$sections.AppendLine('')
[void]$sections.AppendLine('## Re-audit (Phase B verification)')
[void]$sections.AppendLine('')
[void]$sections.AppendLine('After each Phase B commit, re-run the script:')
[void]$sections.AppendLine('')
[void]$sections.AppendLine('```powershell')
[void]$sections.AppendLine('.\scripts\audit-openclaw.ps1')
[void]$sections.AppendLine('```')
[void]$sections.AppendLine('')
[void]$sections.AppendLine('Category-specific expectations:')
[void]$sections.AppendLine('')
[void]$sections.AppendLine('- **After B.2** (rebrand-map expanded): the table itself does not change yet.')
[void]$sections.AppendLine('- **After B.3** (`dexEnv()` shim): #4 stays put; new `DEX_*` strings appear alongside.')
[void]$sections.AppendLine('- **After B.4** (config-dir migrator): #1 stays put; `core/src/migrations/` exists.')
[void]$sections.AppendLine('- **After B.5** (`@openclaw/*` -> `@dexagent/*`): #2 drops to 0; #3 unchanged.')
[void]$sections.AppendLine('- **After B.6** (rename pass): #5 drops sharply; #1 drops sharply; #8 drops on src/.')
[void]$sections.AppendLine('- **After B.8** (telemetry stubs): #7 hits all marked stubbed/no-op in code review.')
[void]$sections.AppendLine('')

$report = $header + ($sections.ToString())

# Preserve UTF-8 without BOM so downstream readers (git diff, GitHub) render correctly.
[System.IO.File]::WriteAllText($OutputPath, $report, [System.Text.UTF8Encoding]::new($false))
Write-Host ""
Write-Host ("Report written: {0}" -f $OutputPath) -ForegroundColor Green
Write-Host ""
Write-Host "Category counts:" -ForegroundColor Cyan
Write-Host ("  1. Config dir / file refs:              {0} hits / {1} files" -f $cat1.Total, $cat1.Files)
Write-Host ("  2. Internal @openclaw/* workspace pkgs: {0} packages" -f $workspacePkgs.Count)
Write-Host ("  3. External @openclaw/* npm deps:       {0} packages" -f $externalScoped.Count)
Write-Host ("  4. Unique OPENCLAW_* env vars:          {0} names / {1} files" -f $envVarSet.Count, $cat4FileCount)
Write-Host ("  5. PascalCase OpenClaw* identifiers:    {0} names / {1} files" -f $identSet.Count, $cat5FileCount)
Write-Host ("  6. docs.openclaw.ai URLs:               {0} hits / {1} files" -f $cat6.Total, $cat6.Files)
Write-Host ("  7. Telemetry openclaw.ai/clawhub:       {0} hits / {1} files" -f $cat7.Total, $cat7.Files)
Write-Host ("  8. Hardcoded `"openclaw <verb>`":         {0} hits / {1} files" -f $cat8.Total, $cat8.Files)
