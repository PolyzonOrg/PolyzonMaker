@echo off
rem Double-click to start the Polyzon Ark hardware check (see README.md).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
echo.
pause
