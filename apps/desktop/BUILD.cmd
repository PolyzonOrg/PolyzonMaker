@echo off
rem Double-click: builds the Polyzon Maker installer for this computer (see README.md).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"
echo.
pause
