@echo off
rem Double-click: TripoSR again, then the models on the route to print through mesh-kit and PrusaSlicer (see README.md).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" --full --print-route %*
echo.
pause
