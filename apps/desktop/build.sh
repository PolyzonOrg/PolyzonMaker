#!/bin/sh
# Polyzon Maker installer for macOS / Linux:  sh build.sh
set -e
cd "$(dirname "$0")"
export UV_PYTHON_INSTALL_DIR="$PWD/.work/python"
if ! command -v uv >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  PATH="$HOME/.local/bin:$PATH"
fi
exec uv run --python 3.12 --no-project build_app.py
