@echo off
REM Stop every Dex process - daemon, agent servers, and the headless core.
REM
REM Use this rather than closing windows. In the default windowless mode there
REM are none, and even with -Console the daemon and agent servers outlive the
REM terminal that started them. Leftover daemons are not merely untidy: several
REM can serve the same named pipe at once and answer requests unpredictably.
REM See SETUP.md section 8.
REM
REM Keep this file CRLF - see RUN.bat.

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\stop-dex.ps1"
if errorlevel 1 pause
