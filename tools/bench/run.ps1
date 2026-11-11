# Polyzon Ark spike for Windows. START.cmd / START-NIGHT.cmd run this on a double-click.
#   powershell -ExecutionPolicy Bypass -File run.ps1              # GPU tiers, about 1 hour
#   powershell -ExecutionPolicy Bypass -File run.ps1 --night      # plus CPU-only tiers, hours
#   powershell -ExecutionPolicy Bypass -File run.ps1 --full --resume   # everything, days (START-FULL.cmd)
#   add --hf-mirror if Hugging Face downloads stall
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
# everything (Python, packages, weights) stays inside .work next to this file
$env:UV_PYTHON_INSTALL_DIR = "$PSScriptRoot\.work\python"
$env:UV_CACHE_DIR = "$PSScriptRoot\.work\uv-cache"
# where the uv installer puts it; a window opened before the install does not have it on PATH yet
$env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host 'Installing uv (Python package manager by Astral)...'
    powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
}
uv run --python 3.12 --with psutil --with nvidia-ml-py spike.py @args
