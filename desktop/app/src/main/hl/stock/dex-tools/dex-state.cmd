@echo off
rem dex-state Windows launcher. The tool itself is a POSIX shell script (curl,
rem pipes, heredocs), so this delegates to Git for Windows' bash rather than
rem re-implementing it in cmd.exe — the same arrangement browser-harness-js
rem uses, and for the same reason.
rem
rem Discovery order:
rem   1. %DEX_BASH%                    (resolved by the app and injected)
rem   2. %BROWSER_HARNESS_JS_BASH%     (shared with the browser harness)
rem   3. the standard Git for Windows install locations
rem
rem `exit /b` with no argument propagates the current ERRORLEVEL. Inside a
rem parenthesised block `exit /b %errorlevel%` would expand at parse time and
rem report 0 even when the script failed.

setlocal

set "SCRIPT_DIR=%~dp0"
set "BASH_SCRIPT=%SCRIPT_DIR%dex-state"

if defined DEX_BASH (
  if exist "%DEX_BASH%" (
    "%DEX_BASH%" "%BASH_SCRIPT%" %*
    exit /b
  )
)

if defined BROWSER_HARNESS_JS_BASH (
  if exist "%BROWSER_HARNESS_JS_BASH%" (
    "%BROWSER_HARNESS_JS_BASH%" "%BASH_SCRIPT%" %*
    exit /b
  )
)

for %%P in (
  "%ProgramFiles%\Git\bin\bash.exe"
  "%ProgramFiles(x86)%\Git\bin\bash.exe"
  "%LocalAppData%\Programs\Git\bin\bash.exe"
) do (
  if exist %%P (
    %%P "%BASH_SCRIPT%" %*
    exit /b
  )
)

>&2 echo dex-state: bash.exe not found. Install Git for Windows from https://gitforwindows.org/ or set DEX_BASH to a bash.exe path.
exit /b 1
