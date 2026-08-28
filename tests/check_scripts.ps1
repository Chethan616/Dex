<#
.SYNOPSIS
Every PowerShell script in the repo parses, and is encoded so it will.

.DESCRIPTION
install-daemon-service.ps1 had never once run. It could not: Windows PowerShell
5.1 reads a .ps1 as ANSI unless the file carries a UTF-8 BOM, and every script
here was written as UTF-8 without one. The em-dashes in the comments arrived as
three mojibake characters each, which was harmless until one shifted the parser
enough to break a string two sections later:

    install-daemon-service.ps1:118  The string is missing the terminator: ".

The failure only ever appeared inside an elevated window that closed itself, so
nothing surfaced it. This is the check that would have.

Run: powershell -File tests/check_scripts.ps1
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$failures = 0

foreach ($file in Get-ChildItem -Path $root -Filter '*.ps1' -Recurse |
        Where-Object { $_.FullName -notmatch '\\(node_modules|build|\.dart_tool)\\' }) {

    $relative = $file.FullName.Substring($root.Length + 1)

    # Encoding first: a file that parses today only because its non-ASCII
    # happens to land somewhere harmless is one edit away from not parsing.
    $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
    $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    $hasHighBytes = $false
    foreach ($b in $bytes) { if ($b -gt 0x7F) { $hasHighBytes = $true; break } }

    if ($hasHighBytes -and -not $hasBom) {
        $failures++
        Write-Host "FAIL $relative" -ForegroundColor Red
        Write-Host '       non-ASCII characters but no UTF-8 BOM — PowerShell 5.1 will misread it' -ForegroundColor Red
        continue
    }

    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        $file.FullName, [ref]$null, [ref]$errors) | Out-Null

    if ($errors -and $errors.Count -gt 0) {
        $failures++
        Write-Host "FAIL $relative" -ForegroundColor Red
        $errors | Select-Object -First 3 | ForEach-Object {
            Write-Host "       line $($_.Extent.StartLineNumber): $($_.Message)" -ForegroundColor Red
        }
    } else {
        Write-Host "ok   $relative" -ForegroundColor DarkGray
    }
}

Write-Host ''
if ($failures -gt 0) {
    Write-Host "FAILED — $failures script(s)" -ForegroundColor Red
    exit 1
}
Write-Host 'PASSED — every script parses' -ForegroundColor Green
