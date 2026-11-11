@echo off
rem Double-click: the last full run again, only what failed or is new, then every model through mesh-kit (see README.md).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" --full --retry-failed %*
echo.
pause
