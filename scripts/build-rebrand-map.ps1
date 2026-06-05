<#
.SYNOPSIS
    Generates scripts/rebrand-map.json by discovering identifiers, env vars,
    workspace packages, and path strings inside core/. Each finding becomes
    one exact-match entry consumed by scripts/rebrand.ps1.

.DESCRIPTION
    Phase B.2. The generator is the single source of truth for the rebrand
    map; running it should always produce the same JSON modulo
    discovery-order stability. Re-run on every Phase B pass to keep the map
    aligned with the current state of core/ source.

    Sections emitted (in this order so longer matches replace before shorter
    prefixes; this prevents `OPENCLAW_AUTH` from breaking the find of
    `OPENCLAW_AUTH_CHOICE_TEST`):

      0. internalName metadata + preserve list (never rename these)
      1. One-off package metadata (package.json name)
      2. dex-core legacy strings (Phase A artifacts -> Phase B targets)
      3. Untouched openclaw -> dex/dexagent strings (paths, CLI hints)
      4. Internal @openclaw/* workspace packages -> @dexagent/*
      5. PascalCase OpenClaw* identifiers -> Dex* (longest first)
      6. OPENCLAW_* env vars -> DEX_* (longest first)

    Heritage strings KEPT (never renamed):
      - External @openclaw/* npm deps (fs-safe, proxyline, etc.)
      - docs.openclaw.ai URLs (upstream's docs site, no Dex docs yet)
      - openclaw.mjs launcher filename (binary alias is set via package.json bin)
      - openclaw.json config file name (one-cycle hold; renamed in v1.4)
      - Per-source-file MIT/Copyright header blocks (excludeHeaderLines=10)

.PARAMETER Target
    Tree to scan. Default: D:\project1\core

.PARAMETER OutputPath
    Where to write the JSON. Default: D:\project1\scripts\rebrand-map.json

.EXAMPLE
    .\scripts\build-rebrand-map.ps1
#>

[CmdletBinding()]
param(
    [string]$Target = (Join-Path (Split-Path -Parent $PSScriptRoot) 'core'),
    [string]$OutputPath = (Join-Path $PSScriptRoot 'rebrand-map.json')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Target -PathType Container)) {
    Write-Error "Target not found: $Target"
    exit 1
}

$resolvedTarget = (Resolve-Path -LiteralPath $Target).Path
Write-Host ("Scanning: {0}" -f $resolvedTarget) -ForegroundColor Cyan

# Build-output dirs we skip entirely.
$excludeFragments = @(
    '\node_modules\', '\dist\', '\.git\', '\.turbo\',
    '\coverage\', '\.next\', '\.cache\', '\.vscode-test\', '\.venv\'
)
function Test-ExcludedPath {
    param([string]$Path)
    foreach ($frag in $excludeFragments) {
        if ($Path -like "*$frag*") { return $true }
    }
    return $false
}

# Code-file extensions: where we expect identifiers + env vars to appear.
$codeExt   = @('.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx')
# Text scan: identifiers/env vars also appear in docs + configs.
$textExt   = $codeExt + @('.json', '.yaml', '.yml', '.toml', '.md', '.mdx', '.env')

function Get-FilesOfTypes {
    param([string[]]$Extensions)
    Get-ChildItem -LiteralPath $resolvedTarget -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object {
            $ext = $_.Extension.ToLower()
            $Extensions -contains $ext -and -not (Test-ExcludedPath $_.FullName)
        }
}

Write-Host "  Enumerating files ..." -ForegroundColor DarkGray
$codeFiles = @(Get-FilesOfTypes -Extensions $codeExt)
$textFiles = @(Get-FilesOfTypes -Extensions $textExt)
Write-Host ("  code={0}  text={1}" -f $codeFiles.Count, $textFiles.Count) -ForegroundColor DarkGray

# ---- Discovery functions ----------------------------------------------------

function Get-InternalWorkspacePackages {
    $pkgsRoot = Join-Path $resolvedTarget 'packages'
    if (-not (Test-Path -LiteralPath $pkgsRoot -PathType Container)) { return @() }
    $out = @()
    Get-ChildItem -LiteralPath $pkgsRoot -Directory | ForEach-Object {
        $pj = Join-Path $_.FullName 'package.json'
        if (Test-Path -LiteralPath $pj -PathType Leaf) {
            try {
                $m = Get-Content -LiteralPath $pj -Raw -Encoding UTF8 | ConvertFrom-Json
                if ($m.name -and $m.name.StartsWith('@openclaw/')) {
                    $out += $m.name
                }
            } catch { }
        }
    }
    return $out
}

function Get-ExternalScopedDeps {
    param([string[]]$InternalNames)
    $set = New-Object System.Collections.Generic.HashSet[string]
    $internalSet = [System.Collections.Generic.HashSet[string]]::new([string[]]$InternalNames)
    $pkgJsons = $textFiles | Where-Object { $_.Name -eq 'package.json' }
    foreach ($pj in $pkgJsons) {
        try {
            $m = Get-Content -LiteralPath $pj.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
            foreach ($blockName in @('dependencies','devDependencies','peerDependencies','optionalDependencies')) {
                $block = $m.$blockName
                if (-not $block) { continue }
                foreach ($prop in $block.PSObject.Properties) {
                    if ($prop.Name.StartsWith('@openclaw/') -and -not $internalSet.Contains($prop.Name)) {
                        [void]$set.Add($prop.Name)
                    }
                }
            }
        } catch { }
    }
    return @($set | Sort-Object)
}

function Get-UniqueEnvVars {
    $set = New-Object System.Collections.Generic.HashSet[string]
    $hits = Select-String -Path $codeFiles.FullName -Pattern 'OPENCLAW_[A-Z][A-Z0-9_]+' `
                          -AllMatches -CaseSensitive -ErrorAction SilentlyContinue
    if ($hits) {
        foreach ($m in $hits) {
            foreach ($match in $m.Matches) {
                [void]$set.Add($match.Value)
            }
        }
    }
    return @($set)
}

function Get-UniqueIdentifiers {
    $set = New-Object System.Collections.Generic.HashSet[string]
    $hits = Select-String -Path $codeFiles.FullName -Pattern '\bOpenClaw[A-Z][A-Za-z0-9_]*\b' `
                          -AllMatches -CaseSensitive -ErrorAction SilentlyContinue
    if ($hits) {
        foreach ($m in $hits) {
            foreach ($match in $m.Matches) {
                [void]$set.Add($match.Value)
            }
        }
    }
    return @($set)
}

# ---- Discovery -------------------------------------------------------------

Write-Host "  Discovering internal workspace packages ..." -ForegroundColor DarkGray
$internalPackages = Get-InternalWorkspacePackages
Write-Host ("    -> {0} internal @openclaw/* packages" -f $internalPackages.Count) -ForegroundColor DarkGray

Write-Host "  Discovering external @openclaw/* npm deps ..." -ForegroundColor DarkGray
$externalPackages = Get-ExternalScopedDeps -InternalNames $internalPackages
Write-Host ("    -> {0} external @openclaw/* npm deps (preserved)" -f $externalPackages.Count) -ForegroundColor DarkGray

Write-Host "  Discovering OPENCLAW_* env vars ..." -ForegroundColor DarkGray
$envVars = Get-UniqueEnvVars
Write-Host ("    -> {0} unique env vars" -f $envVars.Count) -ForegroundColor DarkGray

Write-Host "  Discovering OpenClaw* identifiers ..." -ForegroundColor DarkGray
$identifiers = Get-UniqueIdentifiers
Write-Host ("    -> {0} unique identifiers" -f $identifiers.Count) -ForegroundColor DarkGray

# ---- Compose entries -------------------------------------------------------

# Standard glob sets used across multiple sections.
$globsTS    = @('**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs', '**/*.cjs', '**/*.jsx')
$globsText  = $globsTS + @('**/*.json', '**/*.yaml', '**/*.yml', '**/*.toml', '**/*.md', '**/*.mdx')

# Each entry is [ordered]@{ ... } so ConvertTo-Json emits the keys in this order.
function New-Section {
    param([string]$Label)
    return [ordered]@{ '_section' = $Label }
}
function New-Entry {
    param([string]$Find, [string]$Replace, [string[]]$Files, [string]$Note = $null, [switch]$Optional)
    $h = [ordered]@{
        find    = $Find
        replace = $Replace
        files   = $Files
    }
    if ($Note) { $h['_note'] = $Note }
    if ($Optional) { $h['optional'] = $true }
    return $h
}

$entries = New-Object System.Collections.Generic.List[object]

# --- Section 1: package metadata --------------------------------------------
$entries.Add( (New-Section 'Section 1: package.json metadata (npm name)') )
$entries.Add( (New-Entry -Find '"name": "dex-core",' -Replace '"name": "dexagent",' -Files @('package.json')) )
# Phase A only rewrote core/package.json; sub-packages still have @openclaw/ names handled in Section 4.

# --- Section 2: dex-core legacy strings (from Phase A) ----------------------
$entries.Add( (New-Section 'Section 2: dex-core legacy strings (Phase A artifacts -> Phase B target)') )
# Config dir paths (Phase A applied this only in openclaw.mjs; we generalise across source)
$entries.Add( (New-Entry -Find '".dex-core"' -Replace '".dex"' -Files $globsText -Note 'config dir string literal') )
$entries.Add( (New-Entry -Find "'.dex-core'" -Replace "'.dex'" -Files $globsText -Optional) )
$entries.Add( (New-Entry -Find '~/.dex-core/' -Replace '~/.dex/' -Files $globsText -Optional) )
# Log prefix
$entries.Add( (New-Entry -Find '[dex-core]' -Replace '[dex]' -Files $globsText -Optional -Note 'log prefix; Phase A landed in src/cli/**') )
# Process title in launcher
$entries.Add( (New-Entry -Find '    "dex-core",' -Replace '    "dex",' -Files @('openclaw.mjs') -Optional -Note 'process.title arg') )
# Launcher prefix in error messages
$entries.Add( (New-Entry -Find '`dex-core: Node.js v${MIN_NODE_VERSION}+ is required' -Replace '`dex: Node.js v${MIN_NODE_VERSION}+ is required' -Files @('openclaw.mjs') -Optional) )
$entries.Add( (New-Entry -Find '`[dex-core] Failed to respawn launcher:' -Replace '`[dex] Failed to respawn launcher:' -Files @('openclaw.mjs') -Optional) )
$entries.Add( (New-Entry -Find '"dex-core: missing dist/entry.(m)js (build output)."' -Replace '"dex: missing dist/entry.(m)js (build output)."' -Files @('openclaw.mjs') -Optional) )
# Version banner (Phase A wrote this)
$entries.Add( (New-Entry -Find 'process.stdout.write(commit ? `DexCore ${version} (${commit})\n` : `DexCore ${version}\n`);' -Replace 'process.stdout.write(commit ? `Dex ${version} (${commit})\n` : `Dex ${version}\n`);' -Files @('openclaw.mjs') -Optional) )
# CLI command examples in source (Phase A rewrote dex-core in src/cli/**)
$entries.Add( (New-Entry -Find 'formatCliCommand("dex-core doctor --fix")' -Replace 'formatCliCommand("dex doctor --fix")' -Files @('src/cli/**/*.ts') -Optional) )
$entries.Add( (New-Entry -Find 'formatCliCommand("dex-core doctor", env)' -Replace 'formatCliCommand("dex doctor", env)' -Files @('src/cli/**/*.ts') -Optional) )
$entries.Add( (New-Entry -Find 'formatCliCommand("dex-core onboard")' -Replace 'formatCliCommand("dex onboard")' -Files @('src/cli/**/*.ts') -Optional) )
$entries.Add( (New-Entry -Find 'formatCliCommand("dex-core gateway install --force")' -Replace 'formatCliCommand("dex gateway install --force")' -Files @('src/cli/**/*.ts') -Optional) )
$entries.Add( (New-Entry -Find 'params.inspectCommand ?? "dex-core gateway status --deep"' -Replace 'params.inspectCommand ?? "dex gateway status --deep"' -Files @('src/cli/**/*.ts') -Optional) )

# --- Section 3: untouched openclaw -> dex/dexagent paths --------------------
$entries.Add( (New-Section 'Section 3: untouched openclaw -> dex paths (Phase A did not reach these)') )
# Config-dir string literals (the 2947 hits / 827 files from B.1 audit category 1).
# The path constant rebrand lives behind a single source-of-truth in B.4
# (core/src/config/io.ts CONFIG_DIR_NAME). These string-level entries cover
# the file/test/doc residue that bypasses the constant.
$entries.Add( (New-Entry -Find '".openclaw"' -Replace '".dex"' -Files $globsText -Optional -Note 'string-literal config-dir name across source') )
$entries.Add( (New-Entry -Find "'.openclaw'" -Replace "'.dex'" -Files $globsText -Optional) )
$entries.Add( (New-Entry -Find '~/.openclaw/' -Replace '~/.dex/' -Files $globsText -Optional) )
$entries.Add( (New-Entry -Find '~/.openclaw' -Replace '~/.dex' -Files $globsText -Optional -Note 'no-trailing-slash variant') )
# Note: openclaw.json (the file inside the config dir) stays for one cycle per
# locked open decision #3. v1.4 renames it.

# --- Section 4: internal @openclaw/* workspace packages --------------------
$entries.Add( (New-Section ('Section 4: internal @openclaw/* workspace packages ({0} packages -> @dexagent/*)' -f $internalPackages.Count)) )
# Sort longest first to prevent prefix overlap.
$sortedPkgs = $internalPackages | Sort-Object @{ Expression = { $_.Length }; Descending = $true }
foreach ($pkg in $sortedPkgs) {
    $dexagent = '@dexagent/' + $pkg.Substring('@openclaw/'.Length)
    $entries.Add( (New-Entry -Find $pkg -Replace $dexagent -Files $globsText) )
}

# --- Section 5: PascalCase OpenClaw* identifiers ---------------------------
$entries.Add( (New-Section ('Section 5: PascalCase OpenClaw* identifiers ({0} unique -> Dex*, longest first)' -f $identifiers.Count)) )
$sortedIds = $identifiers | Sort-Object @{ Expression = { $_.Length }; Descending = $true }
foreach ($id in $sortedIds) {
    $dex = 'Dex' + $id.Substring('OpenClaw'.Length)
    $entries.Add( (New-Entry -Find $id -Replace $dex -Files $globsTS) )
}

# --- Section 6: OPENCLAW_* env vars ----------------------------------------
$entries.Add( (New-Section ('Section 6: OPENCLAW_* env vars ({0} unique -> DEX_*, longest first)' -f $envVars.Count)) )
$sortedEnv = $envVars | Sort-Object @{ Expression = { $_.Length }; Descending = $true }
foreach ($v in $sortedEnv) {
    $dex = 'DEX_' + $v.Substring('OPENCLAW_'.Length)
    $entries.Add( (New-Entry -Find $v -Replace $dex -Files $globsText) )
}

# ---- Compose final map -----------------------------------------------------

$map = [ordered]@{
    '_doc' = @(
        'Exact-match replacement table for the Phase B Dex ownership migration.',
        'Generated by scripts/build-rebrand-map.ps1. Edit the generator, not this file.',
        '',
        'RULES:',
        '  1. Exact string match. No regex, no fuzzy, no whole-word mode.',
        '  2. Each entry has find + replace + files. Required entries fail loud',
        '     when find is not found anywhere (canary for vendor pin drift).',
        '     Optional entries (`optional: true`) tolerate zero hits.',
        '  3. Replacements are applied in array order. Longer finds come before',
        '     their shorter prefixes so substring overlap does not eat the longer match.',
        '  4. PRESERVE (never rename):',
        '       - External @openclaw/* npm deps (see preserve.externalScopedDeps)',
        '       - docs.openclaw.ai URLs (no Dex docs site yet)',
        '       - openclaw.mjs filename (alias is set via package.json bin field)',
        '       - openclaw.json config-file name (one-cycle hold; v1.4 renames)',
        '       - Per-source-file MIT/Copyright header blocks',
        '         (rebrand.ps1 honours excludeHeaderLines)',
        '  5. Brand vocabulary:',
        '       - PascalCase: Dex',
        '       - kebab-case: dex',
        '       - npm package: dexagent',
        '       - npm scope:   @dexagent',
        '       - env prefix:  DEX_',
        '       - config dir:  .dex'
    )
    'internalName' = [ordered]@{
        'pascalCase'        = 'Dex'
        'kebabCase'         = 'dex'
        'displayName'       = 'Dex'
        'configDirName'     = '.dex'
        'envVarPrefix'      = 'DEX_'
        'npmPackageName'    = 'dexagent'
        'npmWorkspaceScope' = '@dexagent'
    }
    'excludeHeaderLines' = 10
    'preserve' = [ordered]@{
        'externalScopedDeps' = $externalPackages
        'urls'               = @('docs.openclaw.ai')
        'fileNames'          = @('openclaw.mjs', 'openclaw.json')
    }
    'replacements' = $entries
}

$json = $map | ConvertTo-Json -Depth 100

# Preserve UTF-8 without BOM (matches Phase A's rebrand-map.json on disk).
[System.IO.File]::WriteAllText($OutputPath, $json, [System.Text.UTF8Encoding]::new($false))

# Validate by reading it back.
try {
    $verify = Get-Content -LiteralPath $OutputPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    Write-Error "Generator produced invalid JSON: $_"
    exit 2
}
$entryCount = ($verify.replacements | Where-Object { $_.find }).Count

Write-Host ""
Write-Host ("Wrote: {0}" -f $OutputPath) -ForegroundColor Green
Write-Host ("Entries with find/replace/files: {0}" -f $entryCount) -ForegroundColor Cyan
Write-Host ("Section dividers: {0}" -f ($verify.replacements | Where-Object { $_._section }).Count) -ForegroundColor DarkGray
Write-Host ("External @openclaw/* deps preserved: {0}" -f $verify.preserve.externalScopedDeps.Count) -ForegroundColor DarkGray
Write-Host ""
Write-Host "Section breakdown:" -ForegroundColor Cyan
Write-Host ("  1. package metadata:   1 entry") -ForegroundColor DarkGray
Write-Host ("  2. dex-core legacy:    ~15 entries (mostly optional)") -ForegroundColor DarkGray
Write-Host ("  3. openclaw paths:     ~4 entries (mostly optional)") -ForegroundColor DarkGray
Write-Host ("  4. workspace pkgs:     {0} entries" -f $internalPackages.Count) -ForegroundColor DarkGray
Write-Host ("  5. PascalCase idents:  {0} entries" -f $identifiers.Count) -ForegroundColor DarkGray
Write-Host ("  6. env vars:           {0} entries" -f $envVars.Count) -ForegroundColor DarkGray
