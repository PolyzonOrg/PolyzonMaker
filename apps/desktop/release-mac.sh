#!/bin/sh
# Polyzon Maker for macOS, on a Mac with Apple Silicon: builds for it and for Intel, signs the updates and
# publishes all of it. From the unpacked source tree, about an hour the first time:
#
#   MAKER_UPLOAD_HOST=<user@host> sh apps/desktop/release-mac.sh <signing key file> <upload key file> [notes file]
#   sh apps/desktop/release-mac.sh --unsigned
#
# The maintainers keep the keys and the server's address. Notes are needed only for a version that is not live
# yet. Run it again after a failure: finished steps go fast.
# --unsigned builds the same two disk images and stops there: no update signatures, nothing published. It is what
# .github/workflows/mac.yml runs on a GitHub Mac, where the signing key never goes.
set -eu

unsigned=
if [ "${1:-}" = --unsigned ]; then
  unsigned=1
else
  [ $# -ge 2 ] && [ -n "${MAKER_UPLOAD_HOST:-}" ] || { sed -n 5,6p "$0"; exit 2; }
fi
if [ "$(uname -s)" != Darwin ] || [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" != 1 ]; then
  echo "This needs a Mac with Apple Silicon: the Rust and Node it fetches are built for one."
  exit 1
fi
if [ -z "$unsigned" ]; then
  signing=$(cat "$1")
  upload=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
  notes=
  [ $# -lt 3 ] || notes=$(cd "$(dirname "$3")" && pwd)/$(basename "$3")
  chmod 600 "$upload"  # ssh will not use a key other people can read, and a copied file often is
fi

cd "$(dirname "$0")"
caffeinate -i -w $$ &  # the Mac stays awake while this runs; the screen may turn off

# clang and git come with the Command Line Tools, and macOS installs them through its own window
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install
  echo "Press Install in the window that opened. This carries on by itself when it is done."
  until xcode-select -p >/dev/null 2>&1; do sleep 10; done
fi

# The pinned Rust and Node, from the same place build_app.py takes them
export UV_PYTHON_INSTALL_DIR="$PWD/.work/python"
export RUSTUP_HOME="$PWD/../../tools/tauri-probe/.work/rustup" CARGO_HOME="$PWD/../../tools/tauri-probe/.work/cargo"
if ! command -v uv >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  PATH="$HOME/.local/bin:$PATH"
fi
tools=$(uv run -q --python 3.12 --no-project python -B -c '
import os, sys
sys.path.insert(0, "../../tools/tauri-probe")
import probe
probe.WORK.mkdir(exist_ok=True)
print(os.pathsep.join(map(str, (probe.rust(), probe.node()))))' | tail -1)
PATH="$tools:$PATH"
rustup target add aarch64-apple-darwin x86_64-apple-darwin

(cd ../../packages/mesh-kit && npm ci --no-audit --no-fund && npm run build)
npm ci --no-audit --no-fund

version=$(node -p "require('./src-tauri/tauri.conf.json').version")
updates=true
if [ -n "$unsigned" ]; then
  updates=false
else
  export TAURI_SIGNING_PRIVATE_KEY="$signing" TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
  unset signing
fi
# "-" signs for this machine only, not as a known developer. Without it a downloaded copy is not "unverified"
# but "damaged". CI keeps Tauri from asking for control over Finder.
export CI=true
config="{\"bundle\":{\"createUpdaterArtifacts\":$updates,\"macOS\":{\"signingIdentity\":\"-\"}}}"

# The disk image with its window laid out (src-tauri/dmg): dmgbuild writes the layout into the image, so no Finder
# is asked to arrange it. One picture for both sharpnesses, as Finder wants it.
mkdir -p release
background="$PWD/release/background.tiff"
tiffutil -cathidpicheck src-tauri/dmg/background.png src-tauri/dmg/background@2x.png -out "$background"
disk() {  # <app> <disk image>
  uv run -q --no-project --python 3.12 --with dmgbuild==1.6.7 --with ds_store==1.3.3 --with mac_alias==2.2.3 \
    dmgbuild -s src-tauri/dmg/settings.py -D app="$1" -D background="$background" "Polyzon Maker" "$2"
}

build() {  # <chip in the Rust target> <chip in the file names>
  bundle="src-tauri/target/$1-apple-darwin/release/bundle"
  out="release/$2"
  npx --no-install tauri build --target "$1-apple-darwin" --bundles app --config "$config" &&
    rm -rf "$out" && mkdir -p "$out" &&
    disk "$bundle/macos/Polyzon Maker.app" "$out/Polyzon Maker_${version}_$2.dmg" &&
    { [ -n "$unsigned" ] || {
      cp "$bundle/macos/Polyzon Maker.app.tar.gz" "$out/Polyzon Maker_${version}_$2.app.tar.gz" &&
      cp "$bundle/macos/Polyzon Maker.app.tar.gz.sig" "$out/Polyzon Maker_${version}_$2.app.tar.gz.sig"; }; }
}

build aarch64 aarch64
intel=x64
if ! build x86_64 x64; then
  intel=
  echo "The Intel build failed. Going on with Apple Silicon alone: the Intel files stay as they are on the site."
fi
unset TAURI_SIGNING_PRIVATE_KEY

if [ -n "$unsigned" ]; then
  echo
  echo "DONE: unsigned Polyzon Maker $version for macOS in apps/desktop/release/aarch64${intel:+ and release/x64}. Nothing was published."
  exit 0
fi

cd release
# shellcheck disable=SC2086 # no Intel build means no word at all
MAKER_UPLOAD_KEY="$upload" uv run -q --no-project --python 3.12 python -B ../publish.py "$version" "$notes" aarch64 $intel
echo
echo "DONE: Polyzon Maker $version for macOS is published. Live list: https://maker.polyzon.org/downloads.json"
