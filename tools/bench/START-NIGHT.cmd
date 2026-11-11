@echo off
rem Double-click for the night run: adds the CPU-only tiers and can take many hours.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" --night %*
echo.
pause
