<#
.SYNOPSIS
DEX V3 first-time setup. Installs all dependencies.
#>
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host 'DEX V3 — Setup' -ForegroundColor Cyan
Write-Host '==============' -ForegroundColor Cyan

# Node.js
try {
    $v = node --version
    Write-Host "Node.js $v" -ForegroundColor Green
} catch {
    Write-Host 'ERROR: Node.js not found. Install from https://nodejs.org (v20+)' -ForegroundColor Red
    exit 1
}

# Python
try {
    $v = python --version
    Write-Host "Python $v" -ForegroundColor Green
} catch {
    Write-Host 'ERROR: Python not found. Install Python 3.12 from https://python.org' -ForegroundColor Red
    exit 1
}

# Node deps
Write-Host "`nInstalling Node.js dependencies..." -ForegroundColor Cyan
npm install

# Python deps
Write-Host "`nInstalling Python dependencies..." -ForegroundColor Cyan
pip install -r daemon/requirements.txt

# .env
if (-not (Test-Path '.env')) {
    Copy-Item '.env.example' '.env'
    Write-Host "`nCreated .env from .env.example" -ForegroundColor Yellow
    Write-Host 'Edit it and set ANTHROPIC_API_KEY before running DEX.' -ForegroundColor Yellow
} else {
    Write-Host '.env already exists' -ForegroundColor Green
}

# Data dirs
foreach ($dir in @('data/evidence', 'data/sessions', 'data/cache')) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

Write-Host "`nSetup complete!" -ForegroundColor Green
Write-Host "Next: .\scripts\run-dev.ps1  (as Administrator for DNS/registry changes)" -ForegroundColor Cyan
