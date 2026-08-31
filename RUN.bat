@echo off
REM ============================================================================
REM  Dex - start everything.
REM
REM  Double-click this, or run it from a terminal. Arguments pass straight
REM  through to scripts\run-dev.ps1, so "RUN.bat -Console" works.
REM
REM  It exists because a first run needs four things nobody remembers in the
REM  right order: dependencies, a .env, a built Dex Bar, and PowerShell being
REM  willing to run an unsigned script. run-dev.ps1 does the last two; this
REM  does the first two and then gets out of the way.
REM
REM  Keep this file CRLF. cmd.exe mis-parses a batch file with bare LF endings,
REM  and the failure is baffling: "setlocal" came back as "tlocal".
REM ============================================================================

cd /d "%~dp0"
title Dex

echo.
echo   DEX  -  starting
echo   ----------------
echo.

REM --- Prerequisites ---------------------------------------------------------
REM Checked by hand rather than left to fail later. "npm is not recognized"
REM three screens into a build is a worse message than any of these.

where node >nul 2>&1
if errorlevel 1 (
  echo   [X] Node.js is not on PATH.
  echo       Dex needs Node 24 or newer - https://nodejs.org
  goto :fail
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 24 (
  echo   [X] Node %NODE_MAJOR% is too old. Dex needs 24 or newer.
  echo       It keeps its history in the built-in node:sqlite, which 20 lacks.
  goto :fail
)

where python >nul 2>&1
if errorlevel 1 (
  echo   [X] Python is not on PATH.
  echo       Dex needs Python 3.11 or newer - https://python.org
  goto :fail
)

REM --- Dependencies ----------------------------------------------------------

if not exist "node_modules" (
  echo   Installing Node dependencies, about a minute...
  call npm install
  if errorlevel 1 (
    echo   [X] npm install failed.
    goto :fail
  )
  echo.
)

REM --- Config ----------------------------------------------------------------
REM .env is gitignored, so a fresh clone has none. Copying the example gets Dex
REM to a running state; the model key is the one thing it cannot invent.

if not exist ".env" (
  echo   No .env found - created one from .env.example
  copy /y ".env.example" ".env" >nul
  echo.
  echo   Dex needs one model to plan with. Add a key now:
  echo.
  echo       npm run cred -- set groq_api_key
  echo.
  echo   Groq has a free tier and is what Dex is tuned for.
  echo   Then run this again.
  goto :fail
)

REM --- Go --------------------------------------------------------------------
REM -ExecutionPolicy Bypass because these scripts are unsigned and Windows
REM refuses unsigned scripts by default. Scoped to this one process; nothing is
REM changed machine-wide.

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\run-dev.ps1" %*
if errorlevel 1 goto :ranbad

REM Windowless mode returns as soon as everything is up, with Dex running in
REM the background - so there is nothing to wait for and no window worth
REM keeping open. Alt+Space summons the bar.
exit /b 0

:ranbad
echo.
echo   Dex exited with an error.
echo   Logs are in %LOCALAPPDATA%\DEX
goto :fail

:fail
echo.
pause
exit /b 1
