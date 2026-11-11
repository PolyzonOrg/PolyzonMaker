#!/bin/sh
# Polyzon Ark shell probe for macOS / Linux:  sh run.sh [--exit] [--no-build]
set -e
cd "$(dirname "$0")"
# Python for probe.py stays inside .work next to this file
export UV_PYTHON_INSTALL_DIR="$PWD/.work/python"
if command -v python3 >/dev/null && python3 -c 'import sys; sys.exit(sys.version_info < (3, 12))'; then
  exec python3 probe.py "$@"
fi
if ! command -v uv >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  PATH="$HOME/.local/bin:$PATH"
fi
exec uv run --python 3.12 --no-project probe.py "$@"
