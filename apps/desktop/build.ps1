# Polyzon Maker installer for Windows; BUILD.cmd runs this on a double-click.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$env:UV_PYTHON_INSTALL_DIR = "$PSScriptRoot\.work\python"
$env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host 'Installing uv (Python package manager by Astral)...'
    powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
}
uv run --python 3.12 --no-project build_app.py
