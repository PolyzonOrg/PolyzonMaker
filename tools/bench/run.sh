#!/bin/sh
# Polyzon Ark spike for macOS / Linux.
#   sh run.sh            # GPU tiers
#   sh run.sh --night    # plus CPU-only tiers, hours
#   sh run.sh --full --resume   # everything for phase 0, days; run again after a reboot to carry on
set -e
cd "$(dirname "$0")"
# everything (Python, packages, weights) stays inside .work next to this file
export UV_PYTHON_INSTALL_DIR="$PWD/.work/python" UV_CACHE_DIR="$PWD/.work/uv-cache"
if ! command -v uv >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  PATH="$HOME/.local/bin:$PATH"
fi
RUN="uv run --python 3.12 --with psutil --with nvidia-ml-py"
if [ "$(uname)" = Darwin ]; then
  # cmake and ninja build TRELLIS.2 here; uv brings them, so no Homebrew. Awake until the run ends.
  exec caffeinate -i $RUN --with cmake --with ninja spike.py "$@"
fi
exec $RUN spike.py "$@"
