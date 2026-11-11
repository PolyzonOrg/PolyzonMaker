"""Builds the bench zip that goes to a test machine: the scripts, an empty images/ and mesh-kit with
its two dependencies under node_modules/ (the same layout is left next to this file, so
meshcheck.mjs runs here too).

    python pack.py OUT.zip        # needs node + npm: it builds packages/mesh-kit first
    python pack.py OUT.zip --mac  # all a Mac needs for phase 0: the bench, the shell probe, START-MAC.sh
"""

import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
KIT = REPO / "packages" / "mesh-kit"
FILES = ["START.cmd", "START-NIGHT.cmd", "START-FULL.cmd", "START-RETRY.cmd", "START-PRINT.cmd", "README.md",
         "run.ps1", "run.sh",
         "spike.py", "runner.py", "analyze.py", "meshcheck.mjs", "slicecheck.py", "test_spike.py"]
# what mesh-kit needs at run time: its build, manifold-3d (with the WASM) and meshoptimizer
MODULES = {
    "@polyzon/mesh-kit": (KIT, ["package.json", "LICENSE", "dist/*.js"]),
    "manifold-3d": (KIT / "node_modules" / "manifold-3d", ["package.json", "LICENSE", "manifold.js", "manifold.wasm"]),
    "meshoptimizer": (KIT / "node_modules" / "meshoptimizer", ["package.json", "LICENSE.md", "*.js", "*.mjs", "*.cjs"]),
}


def node_modules() -> Path:
    npm = shutil.which("npm") or "npm"
    subprocess.run([npm, "run", "build"], cwd=KIT, check=True, shell=sys.platform == "win32")
    nm = HERE / "node_modules"
    shutil.rmtree(nm, ignore_errors=True)
    for name, (src, globs) in MODULES.items():
        for g in globs:
            for f in src.glob(g):
                if not f.name.endswith(".test.js"):
                    dest = nm / name / f.relative_to(src)
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(f, dest)
    return nm


def pack(out: Path, root: str = "") -> Path:
    nm = node_modules()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"{root}bench/images/", "")
        for n in FILES:
            z.write(HERE / n, f"{root}bench/{n}")
        for f in sorted(nm.rglob("*")):
            if f.is_file():
                z.write(f, f"{root}bench/{f.relative_to(HERE).as_posix()}")
    return out


def pack_mac(out: Path) -> Path:
    pack(out, "ark-mac/")
    probe = subprocess.run(["git", "ls-files", "tools/tauri-probe", "packages/mesh-kit"], cwd=REPO,
                           capture_output=True, text=True, check=True).stdout.split()
    with zipfile.ZipFile(out, "a", zipfile.ZIP_DEFLATED) as z:
        z.write(HERE.parent / "START-MAC.sh", "ark-mac/START-MAC.sh")
        for f in probe:
            z.write(REPO / f, f"ark-mac/{f}")
    return out


if __name__ == "__main__":
    print((pack_mac if "--mac" in sys.argv else pack)(Path(sys.argv[1]).resolve()))
