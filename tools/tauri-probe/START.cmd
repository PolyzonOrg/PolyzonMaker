@echo off
rem Double-click: builds the Polyzon Ark shell probe, opens it once and packs the report (see README.md).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
echo.
pause
