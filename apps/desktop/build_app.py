"""Builds the Polyzon Maker installer for this computer's system, into apps/desktop/release.

    BUILD.cmd (Windows, double-click) or sh build.sh (macOS, Linux)

The pinned Rust and Node come from the shell probe's script, which keeps them in its .work folder;
Windows also needs Microsoft C++ Build Tools, which it installs through winget. Standard library only.
"""

import json
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT / "tools" / "tauri-probe"))
import probe  # noqa: E402

BUNDLES = {"Windows": "nsis", "Darwin": "app,dmg", "Linux": "deb,appimage"}
KEEP = {".exe", ".dmg", ".deb", ".AppImage", ".gz", ".sig"}


def main() -> None:
    probe.WORK.mkdir(exist_ok=True)
    os.environ.update(RUSTUP_HOME=str(probe.WORK / "rustup"), CARGO_HOME=str(probe.WORK / "cargo"))
    probe.prerequisites()
    cargo_bin, node_dir = probe.rust(), probe.node()
    os.environ["PATH"] = os.pathsep.join([str(cargo_bin), str(node_dir), os.environ["PATH"]])
    npm = [node_dir / ("node.exe" if probe.WIN else "node"),
           node_dir / ("node_modules" if probe.WIN else "../lib/node_modules") / "npm" / "bin" / "npm-cli.js"]
    with open(HERE / "build.log", "w", encoding="utf-8") as log:
        for cmd, cwd in [(["ci"], probe.KIT), (["run", "build"], probe.KIT), (["ci"], HERE)]:
            if probe.sh(npm + cmd, log, cwd):
                sys.exit(f"npm {' '.join(cmd)} failed in {cwd}, see build.log")
        build = ["run", "tauri", "--", "build", "--bundles", BUNDLES[probe.OS]]
        if os.environ.get("TAURI_SIGNING_PRIVATE_KEY"):  # a release: also the signed files updates are made of
            build += ["--config", json.dumps({"bundle": {"createUpdaterArtifacts": True}})]
        if probe.sh(npm + build, log, HERE):
            sys.exit("the build failed, see apps/desktop/build.log")
    release = HERE / "release"
    release.mkdir(exist_ok=True)
    found = [f for f in (HERE / "src-tauri" / "target" / "release" / "bundle").glob("*/*") if f.suffix in KEEP]
    for f in found:
        shutil.copy2(f, release / f.name)
    probe.say("\nDone. The installer is here:\n  " + "\n  ".join(str(release / f.name) for f in found))


if __name__ == "__main__":
    main()
