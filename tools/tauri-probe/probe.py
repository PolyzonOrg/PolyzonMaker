"""Builds the Polyzon Ark shell probe (T-06) on this machine, opens it once and packs the report.

    START.cmd (Windows) or sh run.sh (macOS, Linux) run this; extra flags:
    --exit      the window closes itself once the report is written (runs nobody watches)
    --no-build  run what was built last time

Rust, Node and the build stay in .work and src-tauri/target next to this file: delete them to undo.
Windows also needs Microsoft C++ Build Tools, which this installs system-wide through winget.
Standard library only.
"""

import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent.parent / "packages" / "mesh-kit"
WORK = HERE / ".work"
OS = platform.system()
WIN = OS == "Windows"

RUST = "1.99.1"
RUSTUP = "1.29.1"
RUSTUP_SHA = {  # static.rust-lang.org/rustup/archive/1.29.1/<triple>/rustup-init[.exe].sha256
    "x86_64-pc-windows-msvc": "6f4bef66261261fcb43131be8720bab817d403a09edec7455c371974b90bdb7e",
    "aarch64-apple-darwin": "ec1b9233e7f72990ecd8e62063fa7f6c3dfc2bec8e97f88bff165f9100ac696a",
    "x86_64-unknown-linux-gnu": "dda7234360b7f578ca8b0ddcb80145646fa61a67c1720a5abc7051b35c9fcb71",
}
TRIPLE = {"Windows": "x86_64-pc-windows-msvc", "Darwin": "aarch64-apple-darwin", "Linux": "x86_64-unknown-linux-gnu"}
NODE = "v24.19.0"  # the bench's pin (tools/bench/spike.py)
NODE_SHA = {
    "win-x64.zip": "57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73",
    "darwin-arm64.tar.gz": "8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d",
    "linux-x64.tar.xz": "14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647",
}
NODE_KEY = {"Windows": "win-x64.zip", "Darwin": "darwin-arm64.tar.gz", "Linux": "linux-x64.tar.xz"}
BUNDLES = {"Windows": "nsis", "Darwin": "app", "Linux": "deb,appimage"}
LINUX_PACKAGES = "libwebkit2gtk-4.1-dev build-essential curl file libxdo-dev libssl-dev librsvg2-dev"
VSWHERE = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "Microsoft Visual Studio/Installer/vswhere.exe"


def say(msg: str) -> None:
    print(msg, flush=True)


def fetch(url: str, dest: Path, sha: str) -> Path:
    if not dest.exists():
        say(f"-> download {url}")
        part = dest.with_name(dest.name + ".part")
        with urllib.request.urlopen(url, timeout=120) as r, open(part, "wb") as f:
            shutil.copyfileobj(r, f)
        part.replace(dest)
    if hashlib.sha256(dest.read_bytes()).hexdigest() != sha:
        dest.unlink()
        sys.exit(f"{dest.name}: sha256 does not match the pinned one; deleted it, run again")
    return dest


def msvc() -> bool:
    if not VSWHERE.exists():
        return False
    out = subprocess.run([str(VSWHERE), "-latest", "-products", "*", "-requires",
                          "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"],
                         capture_output=True, text=True).stdout
    return bool(out.strip())


def prerequisites() -> None:
    """What the system must have; everything else this script fetches itself."""
    if WIN and not msvc():
        by_hand = ("Install «Visual Studio Build Tools 2022» with «Desktop development with C++» by hand "
                   "(visualstudio.microsoft.com/visual-cpp-build-tools), then run START.cmd again.")
        if not shutil.which("winget"):
            sys.exit("Rust on Windows needs Microsoft C++ Build Tools. " + by_hand)
        say("Rust on Windows links with Microsoft C++ Build Tools (about 5 GB). Installing them now:\n"
            "Windows will ask for permission, and the install takes 10-20 minutes.")
        subprocess.run(["winget", "install", "--id", "Microsoft.VisualStudio.2022.BuildTools", "-e",
                        "--accept-package-agreements", "--accept-source-agreements", "--override",
                        "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"])
        if not msvc():
            sys.exit("C++ Build Tools are still missing. " + by_hand)
    if OS == "Darwin" and subprocess.run(["xcode-select", "-p"], capture_output=True).returncode:
        sys.exit("First run:  xcode-select --install   then this again.")
    if OS == "Linux" and subprocess.run(["pkg-config", "--exists", "webkit2gtk-4.1", "libsoup-3.0"]).returncode:
        sys.exit(f"First run:  sudo apt install {LINUX_PACKAGES}   then this again.")


def rust() -> Path:
    """rustup and the pinned toolchain, inside .work."""
    cargo = WORK / "cargo" / "bin" / ("cargo.exe" if WIN else "cargo")
    if not cargo.exists():
        triple = TRIPLE[OS]
        name = "rustup-init.exe" if WIN else "rustup-init"
        init = fetch(f"https://static.rust-lang.org/rustup/archive/{RUSTUP}/{triple}/{name}", WORK / name,
                     RUSTUP_SHA[triple])
        init.chmod(0o755)
        subprocess.run([str(init), "-y", "--no-modify-path", "--profile", "minimal",
                        "--default-toolchain", RUST], check=True)
    return cargo.parent


def node() -> Path:
    """The directory with node and npm."""
    key = NODE_KEY[OS]
    root = WORK / f"node-{NODE}-{key.split('.')[0]}"
    if not root.exists():
        arc = fetch(f"https://nodejs.org/dist/{NODE}/node-{NODE}-{key}", WORK / f"node-{NODE}-{key}", NODE_SHA[key])
        if WIN:
            with zipfile.ZipFile(arc) as z:
                z.extractall(WORK)
        else:
            with tarfile.open(arc) as t:
                t.extractall(WORK, filter="data")
    return root if WIN else root / "bin"


def sh(cmd: list, log, cwd: Path = HERE) -> int:
    """Runs a command; its output goes to the screen and to build.log."""
    log.write(f"\n$ {' '.join(map(str, cmd))}\n")
    log.flush()
    p = subprocess.Popen([str(c) for c in cmd], cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True, encoding="utf-8", errors="replace")
    for line in p.stdout:
        sys.stdout.write(line)
        log.write(line)
    return p.wait()


def build(node_dir: Path, log) -> dict:
    npm = [node_dir / ("node.exe" if WIN else "node"),
           node_dir / ("node_modules" if WIN else "../lib/node_modules") / "npm" / "bin" / "npm-cli.js"]
    t = time.time()
    for cmd, cwd in [(["ci"], KIT), (["run", "build"], KIT), (["ci"], HERE)]:
        if sh(npm + cmd, log, cwd):
            sys.exit(f"npm {' '.join(cmd)} failed in {cwd}, see build.log")
    code = sh(npm + ["run", "tauri", "--", "build", "--bundles", BUNDLES[OS]], log)
    return {"exit": code, "seconds": round(time.time() - t), "bundles": bundles()}


def bundles() -> dict:
    """Installer sizes, MB (a macOS .app is a folder)."""
    out = {}
    for f in (HERE / "src-tauri" / "target" / "release" / "bundle").glob("*/*"):
        size = sum(x.stat().st_size for x in f.rglob("*") if x.is_file()) if f.is_dir() else f.stat().st_size
        if f.suffix in {".exe", ".app", ".deb", ".AppImage"}:
            out[f.name] = round(size / 2**20, 1)
    return out


def display() -> dict:
    """Remote Desktop draws on a 32 Hz display: frame rates in such a session say nothing about a real screen."""
    if not WIN:
        return {}
    ask = ("Get-CimInstance Win32_VideoController | Select-Object Name,CurrentRefreshRate,"
           "CurrentHorizontalResolution,CurrentVerticalResolution | ConvertTo-Json")
    adapters = subprocess.run(["powershell", "-NoProfile", "-Command", ask], capture_output=True, text=True)
    return {"session": os.environ.get("SESSIONNAME"), "adapters": adapters.stdout.strip()}


def launch(out: Path, exit_after: bool) -> dict:
    exe = HERE / "src-tauri" / "target" / "release" / ("ark-probe.exe" if WIN else "ark-probe")
    if not exe.exists():
        return {"error": f"{exe.name} was not built"}
    env = {**os.environ, "ARK_PROBE_OUT": str(out)}
    if exit_after:
        env["ARK_PROBE_EXIT"] = "1"
    say("-> the probe window opens: wait until it says the report is saved, then close it")
    t = time.time()
    try:
        code = subprocess.run([str(exe)], env=env, timeout=3600).returncode
    except subprocess.TimeoutExpired:
        code = "timeout"
    return {"exit": code, "seconds": round(time.time() - t), "report": (out / "report.json").exists(),
            "exe_mb": round(exe.stat().st_size / 2**20, 1)}


def main() -> None:
    stamp = time.strftime("%Y%m%d-%H%M")
    out = HERE / "results" / stamp
    out.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(exist_ok=True)
    os.environ.update(RUSTUP_HOME=str(WORK / "rustup"), CARGO_HOME=str(WORK / "cargo"))
    say(f"Polyzon Ark shell probe, results in {out}")
    prerequisites()
    cargo_bin, node_dir = rust(), node()
    os.environ["PATH"] = os.pathsep.join([str(cargo_bin), str(node_dir), os.environ["PATH"]])
    summary = {"machine": {"os": platform.platform(), "machine": platform.machine(), "cpu": platform.processor(),
                           "cores": os.cpu_count(), "display": display()},
               "versions": {"rust": RUST, "node": NODE}}
    with open(out / "build.log", "w", encoding="utf-8") as log:
        if "--no-build" not in sys.argv:
            summary["build"] = build(node_dir, log)
    summary["run"] = launch(out, "--exit" in sys.argv)
    (out / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    zip_path = out.with_name(f"{stamp}-probe-report.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in out.glob("*.*"):  # the STL stays out: it is big and the report has its size
            z.write(f, f.name)
    say(json.dumps(summary, indent=2, ensure_ascii=False))
    say(f"\nDone. Send me this file:\n  {zip_path}")


if __name__ == "__main__":
    main()
