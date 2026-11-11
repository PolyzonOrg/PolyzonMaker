@echo off
rem Double-click for the full phase-0 run: every test on this PC, several days.
rem After a reboot double-click it again: it carries on where it stopped.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" --full --resume %*
echo.
pause
