@echo off
REM ============================================================================
REM  Dex - start everything.
REM
REM  Double-click this, or run it from a terminal.
REM
REM  It used to be the only way in: it ran scripts\run-dev.ps1, which started
REM  the daemon, the agents, the core and the OLD Dex Bar in ui\dex-bar. The
REM  app in app\ had no way to start any of that, so opening it directly showed
REM  "core not running" with no way to fix it from inside. The supervisor now
REM  lives in the app, so this is a convenience rather than a requirement:
REM  it checks the prerequisites, builds once if needed, and opens Dex.
REM
REM  RUN.bat -Console still gives the developer path - run-dev.ps1 with the
REM  dex> prompt.
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
REM No .env is created here, and none is required.
REM
REM This used to copy .env.example and then refuse to start until a key was in
REM it. Dex does not read .env any more: configuration is settings.json under
REM %LOCALAPPDATA%\DEX and secrets are in the Windows credential store, both
REM written by the Settings screen. Creating a .env would put a second, stale
REM source of truth beside the real one - and refusing to start over a missing
REM one meant a fresh clone could not open the app that asks for the key.

REM --- Go --------------------------------------------------------------------
REM -ExecutionPolicy Bypass because these scripts are unsigned and Windows
REM refuses unsigned scripts by default. Scoped to this one process; nothing is
REM changed machine-wide.

if /i "%~1"=="-Console" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\run-dev.ps1" %*
  if errorlevel 1 goto :ranbad
  exit /b 0
)

set "DEX_APP=app\build\windows\x64\runner\Release\dex.exe"

if not exist "%DEX_APP%" (
  echo   Building Dex - about a minute, once.
  pushd app
  call flutter build windows --release
  popd
  if not exist "%DEX_APP%" (
    echo   [X] The Flutter build failed.
    goto :fail
  )
  echo.
)

echo   Starting Dex...
start "" "%DEX_APP%"

REM Nothing to wait for. The app is on screen and it brings the daemon, the
REM agents and the core up behind its splash, each row going green when the
REM service answers.
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
