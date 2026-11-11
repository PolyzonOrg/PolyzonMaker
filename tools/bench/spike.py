"""Polyzon Ark phase-0 benchmark.

Installs each candidate engine into .work next to this file, runs it on the same images at several
memory tiers (full GPU, capped VRAM, capped RAM, CPU only), measures time / peak VRAM / peak RAM,
takes every model through mesh-kit to STL, and packs the logs, tables and previews into one small
zip to send back (run.log has every console line with its time; a crash still ends with that zip).

    uv run --python 3.12 --with psutil --with nvidia-ml-py spike.py            # GPU tiers, 3-4 h
    uv run --python 3.12 --with psutil --with nvidia-ml-py spike.py --night    # + CPU tiers, hours
    uv run --python 3.12 --with psutil --with nvidia-ml-py spike.py --full --resume   # everything, days

Re-running is safe: finished downloads and installs are skipped, and --resume carries on the last
unfinished run (after a reboot, say) without repeating what it measured.
"""

from __future__ import annotations

import argparse
import ctypes
import datetime as dt
import hashlib
import json
import os
import platform
import shutil
import statistics
import subprocess
import sys
import tarfile
import threading
import time
import traceback
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Callable, NamedTuple

import psutil

import analyze

HERE = Path(__file__).resolve().parent
WORK = HERE / ".work"
OS = platform.system()  # Windows | Darwin | Linux
EXE = ".exe" if OS == "Windows" else ""
VERSION = "2026-11-05c"  # printed first in run.log: tells which copy of the bench produced a report

TRELLIS_TAG = "v0.8.1"
SD_TAG = "master-1031-c6dfa9d"
TRELLIS_SHAPE = ["birefnet", "dinov3", "ss_flow", "ss_dec", "shape_flow_512", "shape_flow_1024", "shape_dec"]
TRELLIS_TEX = ["tex_dec", "tex_flow_512", "tex_flow_1024"]
ZIMAGE = [
    ("leejet/Z-Image-Turbo-GGUF", "z_image_turbo-Q4_K.gguf"),
    ("unsloth/Qwen3-4B-Instruct-2507-GGUF", "Qwen3-4B-Instruct-2507-Q4_K_M.gguf"),
    ("Comfy-Org/z_image_turbo", "split_files/vae/ae.safetensors"),
]
KLEIN = [  # FLUX.2 [klein] 4B, Apache-2.0 like Z-Image: the second text-to-image candidate (TZ §21.2)
    ("leejet/FLUX.2-klein-4B-GGUF", "flux-2-klein-4b-Q4_0.gguf"),
    ("unsloth/Qwen3-4B-GGUF", "Qwen3-4B-Q4_K_M.gguf"),
    ("Comfy-Org/Flux-2-Klein-4B", "split_files/vae/flux2-vae.safetensors"),
]
T2I_STEPS = {"zimage": 8, "klein": 4}
NODE = "v24.19.0"  # runs mesh-kit; the archives' sha256 from nodejs.org/dist/v24.19.0/SHASUMS256.txt
NODE_SHA = {
    "win-x64.zip": "57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73",
    "darwin-arm64.tar.gz": "8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d",
    "darwin-x64.tar.gz": "d1b5e999db158c62fe8f7267a4476b035d8bd93b1a605bac24a3f0dd166e3316",
    "linux-x64.tar.xz": "14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647",
    "linux-arm64.tar.xz": "01443c1e1a29e531ccad5a46fefa6df490d2189c49f7955904aecdbb0fe86fdc",
}
PRUSA = "2.9.7"  # reads what mesh-kit wrote; the sha256 is the one its GitHub release lists
PRUSA_SHA = "5d4f395aeb6c344b300e0e1be37a0e1931622b642c3c3085eb19cdae211bc008"
IMAGES = {
    "goblin.png": "https://raw.githubusercontent.com/pwilkin/trellis.cpp/main/assets/goblin.png",
    "hunyuan_demo.png": "https://raw.githubusercontent.com/Tencent-Hunyuan/Hunyuan3D-2/main/assets/demo.png",
    "triposg_demo.png": "https://raw.githubusercontent.com/VAST-AI-Research/TripoSG/main/assets/example_data/hjswed.png",
}
REPOS = {  # code for the Python engines, pinned by branch for the spike only
    "hunyuan": "https://codeload.github.com/Tencent-Hunyuan/Hunyuan3D-2/zip/refs/heads/main",
    "triposg": "https://codeload.github.com/VAST-AI-Research/TripoSG/zip/refs/heads/main",
    "triposr": "https://codeload.github.com/VAST-AI-Research/TripoSR/zip/refs/heads/main",
}
# CUDA extensions with no Windows wheels: they need nvcc + MSVC. runner.py works without them
NO_BUILD = {"diso", "git+https://github.com/tatsy/torchmcubes.git"}
# transformers 5 renamed DINOv2's weights: Hunyuan's checkpoint no longer loads (Hunyuan3D-2 issue #382)
# trimesh 4.0.5 (TripoSR) calls ndarray.ptp, removed in NumPy 2: every run died writing its GLB
PINS = {"transformers": "transformers<5", "trimesh==4.0.5": "trimesh>=4.4,<5"}
# marching cubes in place of torchmcubes; rembg made onnxruntime optional, its background removal needs it
EXTRA = {"triposr": ["scikit-image", "onnxruntime"]}
SEEDS = (1, 2)  # extra seeds on one image: one lucky sample proves nothing
PROMPT = ("a cute ceramic dragon figurine sitting, single object, centered, full body, "
          "plain white background, soft studio light")
GPU_TIMEOUT = 45 * 60
SLOW_TIMEOUT = 6 * 3600  # capped RAM: the run pages to disk
CPU_TIMEOUT = 12 * 3600  # a CPU run counts only when it finishes (TZ §21.2), so it gets the night
MESH_TIMEOUT = 3600
SLICE_TIMEOUT = 900  # the slowest model that finished took 6 minutes
ANALYZE_DEPS = [a for d in ("trimesh", "scipy", "networkx", "matplotlib", "fast-simplification") for a in ("--with", d)]
PRINT_MM = 80  # mesh-kit scales every model to this height: a figurine


# ---------------------------------------------------------------- hardware

def nvidia() -> dict | None:
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total,driver_version",
                              "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if out.returncode != 0 or not out.stdout.strip():
        return None
    name, mem, driver = [s.strip() for s in out.stdout.splitlines()[0].split(",")]
    # the highest CUDA the driver runs, from NVML itself: the nvidia-smi banner changes between drivers
    try:
        import pynvml
        pynvml.nvmlInit()
        try:
            v = pynvml.nvmlSystemGetCudaDriverVersion()
        finally:
            pynvml.nvmlShutdown()
        cuda = f"{v // 1000}.{v % 1000 // 10}"
    except Exception:
        cuda = "0"
    return {"name": name, "vram_mb": int(float(mem)), "driver": driver, "cuda": cuda}


def disk_kind(path: Path) -> str:
    if OS != "Windows":
        return "unknown"
    drive = path.resolve().drive.rstrip(":")
    ps = (f"(Get-Partition -DriveLetter {drive} | Get-Disk | Get-PhysicalDisk).MediaType")
    try:
        return subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True,
                              text=True, timeout=60).stdout.strip() or "unknown"
    except (OSError, subprocess.TimeoutExpired):
        return "unknown"


def hardware() -> dict:
    vm = psutil.virtual_memory()
    return {
        "os": f"{OS} {platform.release()} {platform.version()}",
        "machine": platform.machine(),
        "cpu": platform.processor() or platform.machine(),
        "cores": psutil.cpu_count(logical=False), "threads": psutil.cpu_count(),
        "ram_mb": vm.total // 2**20,
        "disk_free_gb": shutil.disk_usage(HERE).free // 2**30,
        "disk_kind": disk_kind(HERE),
        "nvidia": nvidia(),
        "python": sys.version.split()[0],
    }


# ---------------------------------------------------------------- downloads

def hf_base(mirror: bool) -> str:
    return "https://hf-mirror.com" if mirror else "https://huggingface.co"


def fetch(url: str, dest: Path) -> Path:
    """Resumable download; a finished file is never fetched again."""
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    for attempt in range(5):
        have = part.stat().st_size if part.exists() else 0
        req = urllib.request.Request(url, headers={"Range": f"bytes={have}-", "User-Agent": "polyzon-ark-spike"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r, open(part, "ab" if r.status == 206 else "wb") as f:
                total = have + int(r.headers.get("Content-Length", 0)) if r.status == 206 else int(r.headers.get("Content-Length", 0))
                done, shown = (have if r.status == 206 else 0), -1
                while chunk := r.read(1 << 20):
                    f.write(chunk)
                    done += len(chunk)
                    pct = done * 100 // total if total else -1
                    if pct // 10 != shown // 10:
                        print(f"   {dest.name}: {pct}% of {total // 2**20} MB", flush=True)
                        shown = pct
            part.replace(dest)
            return dest
        except urllib.error.HTTPError as e:
            if e.code == 416:  # already complete
                part.replace(dest)
                return dest
            err = e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            err = e
        print(f"   retry {attempt + 1}/5 {dest.name}: {err}", flush=True)
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"download failed: {url}: {err}")


def unpack(archive: Path, into: Path) -> Path:
    if into.exists():
        return into
    tmp = into.with_name(into.name + ".tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as z:
            z.extractall(tmp)
    else:
        with tarfile.open(archive) as t:
            t.extractall(tmp, filter="data")
    tmp.replace(into)
    return into


def own_images() -> list[Path]:
    """The owner's photos in images/ (the demo pictures are downloaded there too).
    No WebP: trellis-cli may not decode it, and a format failure would read as an engine failure."""
    return sorted(p for p in (HERE / "images").glob("*")
                  if p.suffix.lower() in {".png", ".jpg", ".jpeg"} and p.name not in IMAGES)


def find_exe(root: Path, name: str) -> Path:
    hits = sorted(p for p in root.rglob(name + EXE) if p.is_file())
    if not hits:
        raise RuntimeError(f"{name}{EXE} not found under {root}")
    if OS != "Windows":  # zip archives (sd.cpp's) do not keep the executable bit
        hits[0].chmod(hits[0].stat().st_mode | 0o111)
    return hits[0]


def verified(arc: Path, sha: str) -> Path:
    if hashlib.sha256(arc.read_bytes()).hexdigest() != sha:
        arc.unlink()
        raise RuntimeError(f"{arc.name}: sha256 does not match the pinned one; deleted, run again")
    return arc


def node_bin() -> Path:
    """The official Node build for mesh-kit, checked against the hash pinned above."""
    plat = {"Windows": "win", "Darwin": "darwin"}.get(OS, "linux")
    arch = "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"
    key = f"{plat}-{arch}." + {"win": "zip", "darwin": "tar.gz"}.get(plat, "tar.xz")
    arc = verified(fetch(f"https://nodejs.org/dist/{NODE}/node-{NODE}-{key}", WORK / "dl" / f"node-{NODE}-{key}"),
                   NODE_SHA[key])
    root = unpack(arc, WORK / f"node-{NODE}") / f"node-{NODE}-{key.split('.')[0]}"
    return root / "node.exe" if OS == "Windows" else root / "bin" / "node"


def slicer_bin() -> Path:
    """The official portable PrusaSlicer for Windows: nothing is installed."""
    name = f"PrusaSlicer-{PRUSA}.zip"
    arc = fetch(f"https://github.com/prusa3d/PrusaSlicer/releases/download/version_{PRUSA}/{name}", WORK / "dl" / name)
    return find_exe(unpack(verified(arc, PRUSA_SHA), WORK / "prusaslicer"), "prusa-slicer-console")


# ---------------------------------------------------------------- engines

def trellis_bin(gpu: dict | None, flavor: str) -> Path:
    """flavor: cuda | vulkan | cpu. Windows/Linux use release builds; Mac builds from source."""
    if OS == "Darwin":
        src = WORK / "trellis-src"
        if not src.exists():
            run_logged(["git", "clone", "--depth", "1", "--recurse-submodules", "--branch", TRELLIS_TAG,
                        "https://github.com/pwilkin/trellis.cpp", str(src)], "trellis-clone")
        if not (src / "build").exists():
            run_logged(["cmake", "-B", "build", "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release"], "trellis-cmake", cwd=src)
            run_logged(["cmake", "--build", "build", "-j"], "trellis-build", cwd=src)
        return find_exe(src / "build", "trellis-cli")
    kind = flavor
    if flavor == "cuda":
        kind = "cuda" if float(gpu["cuda"]) >= 13.0 else "cuda12"
    if flavor == "cpu":
        kind = "vulkan"  # the Vulkan build also has the CPU backend; we pass --backend CPU
    ext = "zip" if OS == "Windows" else "tar.gz"
    plat = "windows-x64" if OS == "Windows" else "linux-x64"
    name = f"trellis-{kind}-{plat}.{ext}"
    arc = fetch(f"https://github.com/pwilkin/trellis.cpp/releases/download/{TRELLIS_TAG}/{name}", WORK / "dl" / name)
    return find_exe(unpack(arc, WORK / f"trellis-{kind}"), "trellis-cli")


def trellis_weights(mirror: bool, names: list[str], q: str = "q4") -> Path:
    d = WORK / "trellis-weights" / q
    for n in names:
        fetch(f"{hf_base(mirror)}/ilintar/trellis2-gguf/resolve/main/{q}/{n}.gguf", d / f"{n}.gguf")
    return d


def sd_bin(gpu: dict | None, kind: str) -> Path:
    """kind: cpu | gpu (CUDA on NVIDIA, Metal on a Mac, else Vulkan) | vulkan"""
    if OS == "Darwin":
        names = ["sd-master-c6dfa9d-bin-Darwin-macOS-26.6.2-arm64.zip"]
    elif OS == "Windows":
        names = (["sd-master-c6dfa9d-bin-win-cpu-x64.zip"] if kind == "cpu" else
                 ["sd-master-c6dfa9d-bin-win-cuda12-x64.zip", "cudart-sd-bin-win-cu12-x64.zip"]
                 if gpu and kind == "gpu" else ["sd-master-c6dfa9d-bin-win-vulkan-x64.zip"])
    else:  # no CUDA build for Linux: Vulkan on the GPU
        names = ["sd-master-c6dfa9d-bin-Linux-Ubuntu-24.04-x86_64.zip" if kind == "cpu" else
                 "sd-master-c6dfa9d-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip"]
    root = WORK / f"sd-{kind}"
    if not (root / ".ok").exists():
        for n in names:  # the cudart zip lands next to the binaries
            arc = fetch(f"https://github.com/leejet/stable-diffusion.cpp/releases/download/{SD_TAG}/{n}", WORK / "dl" / n)
            with zipfile.ZipFile(arc) as z:
                z.extractall(root)
        (root / ".ok").write_text("ok")
    return find_exe(root, "sd-cli")


def py_env(model: str, gpu: dict | None, env: dict) -> tuple[Path, Path]:
    """Returns (python, repo). Python 3.10: TripoSG pins numpy 1.22.3."""
    venv, repo = WORK / f"venv-{model}", WORK / f"repo-{model}"
    py = venv / ("Scripts/python.exe" if OS == "Windows" else "bin/python")
    unpack(fetch(REPOS[model], WORK / "dl" / f"{model}.zip"), repo)
    repo_root = next(p for p in repo.iterdir() if p.is_dir())
    reqs = deps(model, (repo_root / "requirements.txt").read_text())
    ok = venv / ".ok"  # holds the install list: a changed list builds the venv again
    if not (ok.exists() and ok.read_text() == " ".join(reqs)):
        uv = shutil.which("uv") or "uv"
        run_logged([uv, "venv", "--clear", "--python", "3.10", str(venv)], f"{model}-venv")
        torch = ["torch==2.7.1", "torchvision==0.22.1"]
        if gpu and OS != "Darwin":
            cuda = float(gpu["cuda"])
            tag = "cu128" if cuda >= 12.8 else "cu126" if cuda >= 12.6 else "cu118"
            torch += ["--index-url", f"https://download.pytorch.org/whl/{tag}"]
        run_logged([uv, "pip", "install", "--python", str(py), *torch], f"{model}-torch")
        torch_check(model, py, gpu)  # a torch without kernels for this card fails here, not in every run
        run_logged([uv, "pip", "install", "--python", str(py), *reqs], f"{model}-deps")
        ok.write_text(" ".join(reqs))
    if model not in FETCHED:  # once per run: a newer runner.py may need more files; cached ones are skipped
        # weights now, so the first measured run does not include the download
        run_logged([str(py), str(HERE / "runner.py"), model, "--repo", str(repo_root), "--prefetch"],
                   f"{model}-weights", env=env)
        FETCHED.add(model)
    return py, repo_root


FETCHED: set[str] = set()


def deps(model: str, requirements: str) -> list[str]:
    """The engine's requirements.txt as uv installs it: no demo server, no torch (it comes first, from
    the CUDA index), nothing that needs a compiler."""
    reqs = [ln.split("#")[0].strip() for ln in requirements.splitlines()]
    skip = {"gradio", "fastapi", "uvicorn", "torch", "torchvision", *NO_BUILD}
    reqs = [PINS.get(r, r) for r in reqs if r and r.split("=")[0] not in skip]
    return reqs + EXTRA.get(model, []) + ["accelerate", "huggingface_hub"]  # offload hooks for the ladder


def torch_check(model: str, py: Path, gpu: dict | None, check: bool = True) -> None:
    dev = "cuda" if gpu and OS != "Darwin" else "cpu"
    run_logged([str(py), str(HERE / "runner.py"), model, "--repo", str(WORK), "--check", "--device", dev],
               f"env-{model}-torch-check", timeout=600, check=check)


# ---------------------------------------------------------------- running and measuring

LOGS: Path
RESULTS: Path


class Tee:
    """Console output also goes to run.log, each line stamped with the time."""

    def __init__(self, stream, log):
        self.stream, self.log, self.fresh = stream, log, True

    def write(self, s: str) -> int:
        for part in s.splitlines(keepends=True):
            if self.fresh:
                self.log.write(time.strftime("%H:%M:%S "))
            self.log.write(part)
            self.fresh = part.endswith(("\n", "\r"))
        self.log.flush()
        self.to_console(self.stream.write, s)
        return len(s)

    def flush(self) -> None:
        self.log.flush()
        self.to_console(self.stream.flush)

    @staticmethod
    def to_console(write: Callable, *args) -> None:
        try:
            write(*args)
        except OSError:  # the window died with the memory (2026-11-05): the run and its log go on without it
            pass

    def __getattr__(self, name):  # encoding, isatty and the rest come from the console
        return getattr(self.stream, name)


def free() -> str:
    return (f"disk {shutil.disk_usage(HERE).free // 2**30} GB free, "
            f"RAM {psutil.virtual_memory().available // 2**30} GB free")


def last_lines(log: Path, n: int = 30) -> str:
    """The end of a step's log, so run.log alone shows why a step failed."""
    return "\n".join("   | " + ln for ln in log.read_text(encoding="utf-8", errors="replace").splitlines()[-n:])


def run_logged(cmd: list[str], step: str, cwd: Path | None = None, env: dict | None = None,
               timeout: int = 3 * 3600, check: bool = True) -> None:
    log = LOGS / f"{step}.log"
    print(f"-> {step}  ({free()})", flush=True)
    with open(log, "w", encoding="utf-8", errors="replace") as f:
        f.write(" ".join(map(str, cmd)) + "\n\n")
        f.flush()
        p = subprocess.run(cmd, cwd=cwd, env=env, stdout=f, stderr=subprocess.STDOUT, timeout=timeout)
    if p.returncode != 0:
        print(last_lines(log), flush=True)
        msg = f"{step} failed (exit {p.returncode}), see logs/{log.name}"
        if check:
            raise RuntimeError(msg)
        print("   " + msg, flush=True)


class Sampler:
    """Polls peak VRAM (whole GPU, minus the idle baseline) and peak RAM of the process tree. `commit`
    (Windows) is what the run needs from RAM + page file; it counts CUDA allocations too, see cap_ram."""

    def __init__(self, proc: psutil.Process):
        self.proc, self.ram, self.commit, self.vram, self._stop = proc, 0, 0, 0, threading.Event()
        self.handle = None
        try:
            import pynvml
            pynvml.nvmlInit()
            self.nvml = pynvml
            self.handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            self.base = pynvml.nvmlDeviceGetMemoryInfo(self.handle).used
        except Exception:
            pass
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self) -> None:
        while not self._stop.wait(0.25):
            try:
                procs = [self.proc, *self.proc.children(recursive=True)]
                mem = [p.memory_info() for p in procs if p.is_running()]
                self.ram = max(self.ram, sum(m.rss for m in mem))
                self.commit = max(self.commit, sum(getattr(m, "private", 0) for m in mem))
            except psutil.Error:
                pass
            if self.handle:
                used = self.nvml.nvmlDeviceGetMemoryInfo(self.handle).used - self.base
                self.vram = max(self.vram, used)

    def stop(self) -> tuple[int, int]:
        self._stop.set()
        return self.vram // 2**20, self.ram // 2**20


SEEN: set[str] = set()  # first run of an engine is cold (nothing in the OS file cache yet)


class JobLimits(ctypes.Structure):  # JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                ("LimitFlags", ctypes.c_uint32), ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", ctypes.c_uint32),
                ("Affinity", ctypes.c_size_t), ("PriorityClass", ctypes.c_uint32), ("SchedulingClass", ctypes.c_uint32),
                ("IoInfo", ctypes.c_uint64 * 6), ("ProcessMemoryLimit", ctypes.c_size_t),
                ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t),
                ("PeakJobMemoryUsed", ctypes.c_size_t)]


def cap_ram(p: subprocess.Popen, gb: float) -> int:
    """Windows: each process of the run may commit at most `gb` GB of its own memory; files it maps
    from disk (GGUF weights) do not count, so this tells an engine that streams its weights from
    a model that needs them all in RAM. CUDA allocations do count (cudaMalloc fails at the cap with
    the card half empty), so this is stricter than a PC with that much RAM and a page file. The process
    was started suspended and runs from here on. Returns the job handle; closing it ends whatever
    the run left behind."""
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateJobObjectW.restype = ctypes.c_void_p
    job = k32.CreateJobObjectW(None, None)
    lim = JobLimits(LimitFlags=0x100 | 0x2000, ProcessMemoryLimit=int(gb * 2**30))  # process memory, kill on close
    h = ctypes.c_void_p(int(p._handle))
    if not (job and k32.SetInformationJobObject(ctypes.c_void_p(job), 9, ctypes.byref(lim), ctypes.sizeof(lim))
            and k32.AssignProcessToJobObject(ctypes.c_void_p(job), h)):
        err = ctypes.get_last_error()
        p.kill()
        raise OSError(err, "could not cap the run's memory")
    ctypes.WinDLL("ntdll").NtResumeProcess(h)
    return job


def ram_capped(cmd: list[str], gb: float) -> list[str]:
    """Linux: the same through a systemd scope: no swap, while pages of mapped files can be dropped
    and read again."""
    return ["systemd-run", "--user", "--scope", "--quiet", "-p", f"MemoryMax={int(gb * 1024)}M",
            "-p", "MemorySwapMax=0", "--", *cmd]


def measure(engine: str, tier: str, image: str, cmd: list[str], out: Path, timeout: float,
            env: dict | None = None, ram_gb: float = 0) -> dict:
    step = f"{engine}-{tier}-{Path(image).stem}"
    cold = engine not in SEEN
    SEEN.add(engine)
    log = LOGS / f"{step}.log"
    print(f"-> run {step}  ({free()})", flush=True)
    if ram_gb and OS == "Linux":
        cmd = ram_capped(cmd, ram_gb)
    t0 = time.perf_counter()
    with open(log, "w", encoding="utf-8", errors="replace") as f:
        f.write(" ".join(map(str, cmd)) + "\n\n")
        f.flush()
        capped = ram_gb and OS == "Windows"
        p = subprocess.Popen(cmd, stdout=f, stderr=subprocess.STDOUT, env=env,
                             creationflags=0x4 if capped else 0)  # CREATE_SUSPENDED until it is in the job
        job = cap_ram(p, ram_gb) if capped else None
        proc = psutil.Process(p.pid)
        try:  # the product will run engines like this, so the PC stays usable
            proc.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS if OS == "Windows" else 10)
        except psutil.Error:
            pass
        s = Sampler(proc)
        try:
            code = p.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            for c in [*proc.children(recursive=True), proc]:
                c.kill()
            code = "timeout"
        vram, ram = s.stop()
        if job:
            ctypes.windll.kernel32.CloseHandle(ctypes.c_void_p(job))
    out.with_suffix(".ply").unlink(missing_ok=True)  # trellis.cpp also writes a PLY copy: same mesh, double the disk
    text = log.read_text(encoding="utf-8", errors="replace")
    tail = text[-1500:]
    rec = {"engine": engine, "tier": tier, "image": image, "ok": code == 0 and out.exists(),
           "cold": cold, "exit": code, "seconds": round(time.perf_counter() - t0, 1), "peak_vram_mb": vram,
           "peak_ram_mb": ram, "peak_commit_mb": s.commit // 2**20, "out": out.name if out.exists() else None,
           "error_tail": None if code == 0 else tail, **({"ram_cap_gb": ram_gb} if ram_gb else {})}
    for line in text.splitlines()[-50:]:  # runners print one JSON line with their own stage timings
        if line.startswith("{\"stages\""):
            rec.update(json.loads(line))
    record(rec)
    print(f"   {'OK' if rec['ok'] else f'FAIL exit {code}'} {rec['seconds']} s, VRAM {vram} MB, RAM {ram} MB",
          flush=True)
    if not rec["ok"]:
        print(last_lines(log), flush=True)
    return rec


def keep_awake() -> None:
    if OS == "Windows":  # ES_CONTINUOUS | ES_SYSTEM_REQUIRED: no sleep, the screen may still turn off
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)
    elif OS == "Darwin":  # the same until this process exits
        subprocess.Popen(["caffeinate", "-i", "-w", str(os.getpid())])


# ---------------------------------------------------------------- plan

class Item(NamedTuple):
    """One tier of one engine. build(image, out) installs the engine on first use, so setup time stays
    out of the measurements, and returns the command."""
    engine: str
    tier: str
    images: list[str]
    build: Callable[[str, Path], list[str]] | None
    timeout: float
    env: dict | None
    ext: str
    ram_gb: float = 0  # the most the run may keep in RAM: a PC with less memory
    kill: bool = False  # stopped halfway, then run again: what a crash leaves behind (TZ §21.2)


def plan(gpu: dict | None, night: bool, mirror: bool, only: set[str], full: bool = False) -> list[Item]:
    """What decides the most comes first, the CPU nights last. `full` is everything phase 0 needs
    on this machine (it implies `night`)."""
    night = night or full
    imgs = list(IMAGES) + [p.name for p in own_images()]
    demo, one = list(IMAGES), ["goblin.png"]
    env = {**os.environ, "HF_HOME": str(WORK / "hf"), "U2NET_HOME": str(WORK / "u2net"), "PYTHONUNBUFFERED": "1"}
    if mirror:
        env["HF_ENDPOINT"] = hf_base(True)
    run_env = {**env, "HF_HUB_OFFLINE": "1"}  # weights are prefetched; runs never touch the network
    runner = str(HERE / "runner.py")
    items: list[Item] = []

    def trellis(tier, flavor, extra, images, timeout, seed=42, post=False, q="q4", **kw):
        # post: v0.8.1 remeshes into one watertight shell and decimates only on the textured path;
        # --no-texture writes the raw decoder mesh (millions of faces, hundreds of pieces)
        def cmd(img, out):
            exe = trellis_bin(gpu, flavor)
            w = trellis_weights(mirror, TRELLIS_SHAPE + TRELLIS_TEX if post else TRELLIS_SHAPE, q)
            return [str(exe), img, str(out), "--models", str(w), "--seed", str(seed),
                    *(["--box-uv"] if post else ["--no-texture"]), *extra]
        items.append(Item("trellis-post" if post else "trellis", tier, images, cmd, timeout, None, ".glb", **kw))

    def pyeng(model, tier, device, cap, offload, images, timeout, seed=42, **kw):
        def cmd(img, out):
            py, repo = py_env(model, gpu, env)
            return [str(py), runner, model, "--repo", str(repo), "--image", img, "--out", str(out),
                    "--device", device, "--vram-cap-gb", str(cap), "--offload", offload, "--seed", str(seed)]
        items.append(Item(model, tier, images, cmd, timeout, run_env, ".glb", **kw))

    def cut(images):
        def cmd(img, out):
            py, repo = py_env("hunyuan", gpu, env)  # any venv with rembg
            return [str(py), runner, "cut", "--repo", str(repo), "--image", img, "--out", str(out)]
        items.append(Item("cut", "birefnet", images, cmd, GPU_TIMEOUT, run_env, ".png"))

    def t2i(engine, tier, kind, extra, timeout, **kw):
        files = {"zimage": ZIMAGE, "klein": KLEIN}[engine]

        def cmd(_img, out):
            exe = sd_bin(gpu, kind)
            w = [fetch(f"{hf_base(mirror)}/{r}/resolve/main/{p}", WORK / engine / Path(p).name) for r, p in files]
            return [str(exe), "--diffusion-model", str(w[0]), "--llm", str(w[1]), "--vae", str(w[2]),
                    "-p", PROMPT, "--cfg-scale", "1.0", "--steps", str(T2I_STEPS[engine]), "-W", "1024", "-H", "1024",
                    "--seed", "42", "-o", str(out), *extra]
        items.append(Item(engine, tier, ["prompt"], cmd, timeout, None, ".png", **kw))

    def meshkit():  # every model made so far through mesh-kit to STL; checked ones are skipped
        items.append(Item("meshkit", f"print-{PRINT_MM}mm", [], None, MESH_TIMEOUT, None, ".stl"))

    flavor = "cuda" if gpu else ("metal" if OS == "Darwin" else "vulkan")
    dev = "cuda" if gpu else "mps" if OS == "Darwin" else None
    trellis(f"{flavor}-512", flavor, ["--res", "512"], imgs, GPU_TIMEOUT)
    trellis(f"{flavor}-1024", flavor, ["--res", "1024"], imgs, GPU_TIMEOUT)
    for s in SEEDS:
        trellis(f"{flavor}-1024-seed{s}", flavor, ["--res", "1024"], one, GPU_TIMEOUT, seed=s)
    for res in ("512", "1024"):  # the print path: what the remesh costs and whether one shell comes out
        trellis(f"{flavor}-{res}", flavor, ["--res", res], imgs if full else demo, GPU_TIMEOUT, post=True)
    if full:
        for s in SEEDS:
            trellis(f"{flavor}-1024-seed{s}", flavor, ["--res", "1024"], one, GPU_TIMEOUT, seed=s, post=True)
    if gpu and OS != "Darwin":  # what AMD/Intel owners will get, measured on the same card
        trellis("vulkan-512", "vulkan", ["--res", "512", "--backend", "Vulkan"], one, GPU_TIMEOUT)
        if full:
            for res in ("512", "1024"):
                trellis(f"vulkan-{res}", "vulkan", ["--res", res, "--backend", "Vulkan"], demo, GPU_TIMEOUT, post=True)
    for engine in ("zimage", "klein"):
        t2i(engine, "gpu", "gpu", [], GPU_TIMEOUT)
        t2i(engine, "gpu-offload", "gpu", ["--offload-to-cpu"], GPU_TIMEOUT)
        if full and gpu and OS == "Windows":  # on Linux the GPU build already is the Vulkan one
            t2i(engine, "vulkan", "vulkan", [], GPU_TIMEOUT)
    if dev:
        for model in ("hunyuan", "triposg"):
            pyeng(model, f"{dev}-full", dev, 0, "none", imgs, GPU_TIMEOUT)
            for s in SEEDS:
                pyeng(model, f"{dev}-full-seed{s}", dev, 0, "none", one, GPU_TIMEOUT, seed=s)
        pyeng("triposr", f"{dev}-full", dev, 0, "none", imgs, GPU_TIMEOUT)  # deterministic: no seeds
    # TripoSR has a real CPU path upstream: the "no suitable GPU" route, cheap enough for the day run
    pyeng("triposr", "cpu", "cpu", 0, "none", imgs if full else one, GPU_TIMEOUT)
    if full:  # text -> image -> 3D: each generated picture through each 3D engine
        pics = [f"{e}-gpu-prompt.png" for e in ("zimage", "klein")]
        trellis(f"{flavor}-512", flavor, ["--res", "512"], pics, GPU_TIMEOUT, post=True)
        if dev:
            for model in ("hunyuan", "triposg"):
                pyeng(model, f"{dev}-full", dev, 0, "none", pics, GPU_TIMEOUT)
    if full and dev:  # one cutout for all engines, as in Ark: BiRefNet (MIT) instead of each engine's own
        cut(imgs)
        cuts = [f"cut-birefnet-{Path(i).stem}.png" for i in imgs]
        trellis(f"{flavor}-512", flavor, ["--res", "512"], cuts, GPU_TIMEOUT, post=True)
        for model in ("hunyuan", "triposg"):
            pyeng(model, f"{dev}-full", dev, 0, "none", cuts, GPU_TIMEOUT)
        # do the rough surfaces of TRELLIS come from the q4 weights? the same cutouts with q8
        trellis(f"{flavor}-512-q8", flavor, ["--res", "512"], cuts, GPU_TIMEOUT, post=True, q="q8")
        trellis(f"{flavor}-1024-q8", flavor, ["--res", "1024"], cuts[:len(demo)], GPU_TIMEOUT, post=True, q="q8")
        # a flat plate in place of the object (seed 42, 2026-11-04 report): the seed's doing, or the picture's?
        for s in SEEDS:
            trellis(f"{flavor}-512-seed{s}", flavor, ["--res", "512"], cuts, GPU_TIMEOUT, seed=s, post=True)
    if gpu:  # emulate weaker cards on this one; a real weak card still has to confirm it
        for model, cap in (("hunyuan", 4), ("triposg", 6), ("triposr", 4)):
            pyeng(model, f"cuda-cap{cap}gb", "cuda", cap, "none", one, GPU_TIMEOUT)
        for model in ("hunyuan", "triposg"):
            pyeng(model, "cuda-cap4gb-stagewise", "cuda", 4, "model", one, GPU_TIMEOUT)
            pyeng(model, "cuda-cap2gb-layerwise", "cuda", 2, "sequential", one, GPU_TIMEOUT)
    meshkit()
    if full and OS != "Darwin":  # less RAM; macOS has no per-process limit to emulate it with
        for gb in (8, 4):
            trellis(f"{flavor}-512-ram{gb}gb", flavor, ["--res", "512"], one, SLOW_TIMEOUT, post=True, ram_gb=gb)
        for engine in ("zimage", "klein"):
            t2i(engine, "gpu-offload-ram8gb", "gpu", ["--offload-to-cpu"], SLOW_TIMEOUT, ram_gb=8)
        if dev:
            for model in ("hunyuan", "triposg", "triposr"):
                pyeng(model, f"{dev}-full-ram8gb", dev, 0, "none", one, SLOW_TIMEOUT, ram_gb=8)
        if gpu:
            pyeng("triposg", "cuda-cap4gb-stagewise-ram8gb", "cuda", 4, "model", one, SLOW_TIMEOUT, ram_gb=8)
    if full:  # killed halfway through (half the finished run's time), then started again
        trellis(f"{flavor}-512-killed", flavor, ["--res", "512"], one, GPU_TIMEOUT, post=True, kill=True)
        t2i("zimage", "gpu-killed", "gpu", [], GPU_TIMEOUT, kill=True)
        if dev:
            for model in ("hunyuan", "triposg"):
                pyeng(model, f"{dev}-full-killed", dev, 0, "none", one, GPU_TIMEOUT, kill=True)
    if night:
        trellis("cpu-512", "cpu", ["--res", "512", "--backend", "CPU"], one, CPU_TIMEOUT)
        trellis("cpu-512", "cpu", ["--res", "512", "--backend", "CPU"], one, CPU_TIMEOUT, post=True)
        if full:
            trellis("cpu-1024", "cpu", ["--res", "1024", "--backend", "CPU"], one, 2 * CPU_TIMEOUT, post=True)
        for engine in ("zimage", "klein"):
            t2i(engine, "cpu", "cpu", [], CPU_TIMEOUT)
        pyeng("hunyuan", "cpu", "cpu", 0, "none", one, CPU_TIMEOUT)
        pyeng("triposg", "cpu", "cpu", 0, "none", one, CPU_TIMEOUT)
        meshkit()
    if full:
        items.append(Item("slicer", "prusa-0.2mm", [], None, SLICE_TIMEOUT, None, ".json"))
    return [i for i in items if not only or i.engine in only or i.engine in ("meshkit", "slicer")]


# ---------------------------------------------------------------- main

def only_copy():
    """A file this process keeps locked: the system frees it after a crash too, and a second window gets
    None. Two copies in one folder share step logs and overwrite each other's models."""
    f = open(HERE / "bench.lock", "a+")
    try:
        if OS == "Windows":
            import msvcrt
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        f.close()
        return None
    return f


def main(argv: list[str] | None = None) -> None:
    lock = only_copy()
    if not lock:
        print("The bench is already running from this folder, its window may be hidden. This window can be closed.")
        return
    try:
        run_bench(argv)
    finally:
        lock.close()


def run_bench(argv: list[str] | None) -> None:
    global LOGS, RESULTS
    ap = argparse.ArgumentParser()
    ap.add_argument("--night", action="store_true", help="also run CPU-only tiers (hours)")
    ap.add_argument("--hf-mirror", action="store_true", help="download weights via hf-mirror.com")
    ap.add_argument("--only", default="",
                    help="comma list: trellis,trellis-post,hunyuan,triposg,triposr,zimage,klein,cut "
                         "(mesh-kit always checks what they make)")
    ap.add_argument("--dry-run", action="store_true", help="print the plan, download nothing")
    ap.add_argument("--full", action="store_true", help="everything phase 0 needs on this machine (days)")
    ap.add_argument("--resume", action="store_true", help="carry on the last unfinished run of the same kind")
    ap.add_argument("--retry-failed", action="store_true",
                    help="the last run of the same kind, finished or not: what failed or is new in this version, "
                         "then every model through mesh-kit again")
    ap.add_argument("--print-route", action="store_true",
                    help="a retry of the route to print only: TripoSR again, then mesh-kit and the slicer on its models")
    a = ap.parse_args(argv)
    a.retry_failed = a.retry_failed or a.print_route

    earlier = last_run(a.full, finished=a.retry_failed) if a.resume or a.retry_failed else None
    if a.resume and not earlier and last_run(a.full, finished=True):
        print("The last run of this kind is finished, nothing to carry on. To start anew, move its folder out of results.")
        return
    RESULTS = earlier or HERE / "results" / dt.datetime.now().strftime("%Y%m%d-%H%M")
    LOGS = RESULTS / "logs"
    LOGS.mkdir(parents=True, exist_ok=True)
    resumed = (RESULTS / "run.json").exists()
    if not resumed:
        (RESULTS / "run.json").write_text(json.dumps({"full": a.full, "started_by": VERSION}))
    console = sys.stdout, sys.stderr
    log = open(RESULTS / "run.log", "a", encoding="utf-8", errors="replace")
    sys.stdout, sys.stderr = Tee(console[0], log), Tee(console[1], log)
    hw: dict = {}
    try:
        print(f"Polyzon Ark bench {VERSION}, {OS}, args: {' '.join(argv if argv is not None else sys.argv[1:])}")
        if resumed:  # setup failures are tried again: the cause is often a dropped download
            mark, kind = RESULTS / "retry.txt", f"{VERSION} {a.print_route}"
            # a retry this bench stopped halfway is carried on, not started over: mesh-kit alone takes hours
            again = a.retry_failed and ((RESULTS / "done.txt").exists() or not mark.exists() or mark.read_text() != kind)
            kept = {(r["engine"], r["tier"], r["image"]): r for r in records()
                    if r.get("exit") != "setup" and not (again and retried(r, a.print_route))}
            (RESULTS / "results.jsonl").write_text(
                "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in kept.values()), encoding="utf-8")
            if again:
                mark.write_text(kind)
            (RESULTS / "done.txt").unlink(missing_ok=True)  # a retry stopped halfway is carried on by --resume
            print(f"   resuming {RESULTS.name}: {len(kept)} results kept, the rest runs now")
        hw.update(hardware())
        bench(a, hw)
    except BaseException:  # Ctrl+C too: what ran so far is still worth sending
        traceback.print_exc()
        print("\n!! The run stopped early. The report below still has everything up to this point.")
    finally:
        try:
            wrap_up(a.dry_run, hw.get("nvidia"))
        finally:
            sys.stdout, sys.stderr = console
            log.close()


def last_run(full: bool, finished: bool = False) -> Path | None:
    """The newest run of the same kind (full or not) that did not reach its end, or with `finished` any."""
    runs = [p for p in sorted((HERE / "results").glob("2*"))
            if (p / "run.json").exists() and (finished or not (p / "done.txt").exists())
            and json.loads((p / "run.json").read_text()).get("full") == full]
    return runs[-1] if runs else None


def retried(r: dict, route: bool = False) -> bool:
    """What --retry-failed runs again: failures (not the runs killed on purpose), mesh-kit on every
    model, since a fix there changes them all, and the slicer on what it wrote. With --print-route
    only the slicer, mesh-kit on the models of the route and TripoSR's own run on that route."""
    if route:
        return (r["engine"], r["tier"]) == ("triposr", "cuda-full") or r["engine"] == "slicer" \
            or (r["engine"] == "meshkit" and analyze.print_route(r["image"]))
    return r["engine"] in ("meshkit", "slicer") or (not r.get("ok") and not r["tier"].endswith("-killed"))


def bench(a: argparse.Namespace, hw: dict) -> None:
    (RESULTS / "hardware.json").write_text(json.dumps(hw, indent=2, ensure_ascii=False))
    print(json.dumps(hw, indent=2, ensure_ascii=False))
    if hw["nvidia"]:  # raw driver view: CUDA version, other programs holding VRAM, clocks
        run_logged(["nvidia-smi"], "nvidia-smi", check=False)
        run_logged(["nvidia-smi", "-q"], "nvidia-smi-q", check=False)
    if hw["disk_free_gb"] < 50:
        print(f"!! only {hw['disk_free_gb']} GB free here; the benchmark needs about 50 GB")
        if not a.dry_run:
            input("   Free up space or move this folder to a bigger disk and start again.\n"
                  "   Press Enter to run anyway, or close the window to stop: ")

    items = plan(hw["nvidia"], a.night, a.hf_mirror, {s for s in a.only.split(",") if s}, a.full)
    for it in items:
        print(f"   plan: {it.engine:12} {it.tier:30} {len(it.images) or 'each model so far'} image(s)")
    if a.dry_run:
        return
    keep_awake()
    imgs = {n: fetch(u, HERE / "images" / n) for n, u in IMAGES.items()}
    imgs.update({p.name: p for p in own_images()})
    run_items(items, imgs, a.hf_mirror)
    (RESULTS / "done.txt").write_text(VERSION)  # a finished run is not resumed


def records() -> list[dict]:
    f = RESULTS / "results.jsonl"
    return [json.loads(ln) for ln in f.read_text(encoding="utf-8").splitlines() if ln] if f.exists() else []


def record(rec: dict) -> None:
    with open(RESULTS / "results.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps({**rec, "bench": VERSION}, ensure_ascii=False) + "\n")


def run_items(items: list[Item], imgs: dict[str, Path], mirror: bool) -> None:
    """Runs what is not in results.jsonl yet, so a resumed run picks up where it stopped."""
    out_dir = RESULTS / "outputs"
    out_dir.mkdir(exist_ok=True)
    done = {(r["engine"], r["tier"], r["image"]) for r in records()}
    broken: set[str] = set()  # engines whose setup failed once: don't retry a 20-minute install per tier
    for it in items:
        if it.engine == "meshkit":
            meshkit_pass(it, out_dir, done, broken)
            continue
        if it.engine == "slicer":
            slicer_pass(it, out_dir, done, broken)
            continue
        base = it.tier.removesuffix("-killed")
        for name in it.images:
            if (it.engine, base + "-after-kill" if it.kill else it.tier, name) in done:
                continue
            src = imgs.get(name) or out_dir / name  # a picture made by text-to-image earlier in the run
            out = out_dir / f"{it.engine}-{it.tier}-{Path(name).stem}{it.ext}"
            try:
                if it.engine in broken:
                    raise RuntimeError("setup failed earlier, skipped")
                if name != "prompt" and not src.exists():
                    raise FileNotFoundError(f"no input {name}: the step that makes it did not")
                cmd = it.build(str(src) if name != "prompt" else "", out)
            except Exception as e:  # record it and go on with the next engine
                missing = isinstance(e, FileNotFoundError)
                if it.engine not in broken and not missing:
                    traceback.print_exc()
                    broken.add(it.engine)
                record({"engine": it.engine, "tier": it.tier, "image": name, "ok": False,
                        "exit": "no input" if missing else "setup", "error_tail": str(e)[-1500:]})
                print(f"   SKIP {it.engine} {it.tier} {name}: {e}", flush=True)
                continue
            if it.kill:
                kill_test(it, base, name, src, out, cmd)
                continue
            rec = measure(it.engine, it.tier, name, cmd, out, it.timeout, it.env, it.ram_gb)
            if it.engine == "trellis" and not rec["ok"] and "tex_" in (rec["error_tail"] or ""):
                trellis_weights(mirror, TRELLIS_TEX)  # the CLI wanted the texture files after all
                measure(it.engine, it.tier + "-withtex", name, cmd, out, it.timeout, it.env)


def kill_test(it: Item, base: str, name: str, src: Path, out: Path, cmd: list[str]) -> None:
    """Stops the run halfway through, then starts it again: does a crash leave a broken file or
    cache behind, and does the next run finish (TZ §21.2, recovery)."""
    runs = [r["seconds"] for r in records() if (r["engine"], r["tier"], r["image"]) == (it.engine, base, name) and r["ok"]]
    if not runs:
        print(f"   SKIP {it.engine} {it.tier}: no finished {base} run to time the kill by", flush=True)
        return
    measure(it.engine, it.tier, name, cmd, out, max(1.0, runs[0] / 2), it.env)
    time.sleep(10)  # the driver frees a killed run's VRAM late: read too soon, it hides the next run's peak
    again = out.with_name(f"{it.engine}-{base}-after-kill-{Path(name).stem}{it.ext}")
    measure(it.engine, base + "-after-kill", name, it.build(str(src) if name != "prompt" else "", again),
            again, it.timeout, it.env)


def meshkit_pass(it: Item, out_dir: Path, done: set, broken: set) -> None:
    """Every model made so far through mesh-kit (meshcheck.mjs): scaled to PRINT_MM, repaired, rebuilt
    on a grid when repair leaves it open, simplified, written as STL and 3MF and read back."""
    todo = [r for r in records() if r.get("ok") and str(r.get("out") or "").endswith(".glb")
            # raw decoder meshes have tens of millions of faces: the demo pictures show enough of them
            and (r["engine"] != "trellis" or r["image"] in IMAGES)
            and ("meshkit", it.tier, r["out"]) not in done]
    if not todo or "meshkit" in broken:
        return
    try:
        node = node_bin()
        if not (HERE / "node_modules" / "@polyzon" / "mesh-kit" / "dist").exists():
            raise RuntimeError("node_modules/@polyzon/mesh-kit is missing: this copy was not made by pack.py")
    except Exception as e:
        traceback.print_exc()
        broken.add("meshkit")
        record({"engine": "meshkit", "tier": it.tier, "image": "", "ok": False, "exit": "setup", "error_tail": str(e)})
        return
    heap = min(16384, psutil.virtual_memory().total // 2**20 * 6 // 10)  # MB for V8; the meshes live outside it
    for r in todo:
        glb = out_dir / r["out"]
        stl = out_dir / "print" / f"{glb.stem}.stl"
        measure("meshkit", it.tier, r["out"], [str(node), f"--max-old-space-size={heap}", str(HERE / "meshcheck.mjs"),
                                               str(glb), str(stl.parent), str(PRINT_MM)], stl, it.timeout)
        done.add(("meshkit", it.tier, r["out"]))


def slicer_pass(it: Item, out_dir: Path, done: set, broken: set) -> None:
    """A slicer's reading of the print files (slicecheck.py), on each engine's route to Ark. The files
    are the same on every OS: one run answers it, on Windows, where a portable build needs no install."""
    todo = [r["out"] for r in records() if r["engine"] == "meshkit" and r.get("out") and analyze.print_route(r["image"])
            and ("slicer", it.tier, r["out"]) not in done]
    if OS != "Windows" or not todo or "slicer" in broken:
        return
    try:
        console = slicer_bin()
    except Exception as e:
        traceback.print_exc()
        broken.add("slicer")
        record({"engine": "slicer", "tier": it.tier, "image": "", "ok": False, "exit": "setup", "error_tail": str(e)})
        return
    for stl in todo:
        src = out_dir / "print" / stl
        found = src.with_suffix(".slice.json")
        measure("slicer", it.tier, stl, [sys.executable, str(HERE / "slicecheck.py"), str(console), str(src), str(found)],
                found, it.timeout)
        done.add(("slicer", it.tier, stl))


def wrap_up(dry_run: bool, gpu: dict | None) -> None:
    """Runs after a crash too: what each engine has installed, the mesh table, one small zip."""
    if not dry_run:
        uv = shutil.which("uv") or "uv"
        for venv in sorted(WORK.glob("venv-*")):  # half-built ones too: that is where the trouble is
            model = venv.name.removeprefix("venv-")
            py = venv / ("Scripts/python.exe" if OS == "Windows" else "bin/python")
            run_logged([uv, "pip", "freeze", "--python", str(py)], f"env-{model}-packages", check=False)
            torch_check(model, py, gpu, check=False)
    if (RESULTS / "results.jsonl").exists():
        run_logged(["uv", "run", "--python", "3.12", *ANALYZE_DEPS, str(HERE / "analyze.py"), str(RESULTS)],
                   "analyze", check=False)
    print(f"\nDONE. Send this file: {pack_report(RESULTS)}")
    if (RESULTS / "outputs").exists():
        print(f"The models are in {RESULTS / 'outputs'}; keep them, some may be asked for.")


def pack_report(results: Path) -> Path:
    """Logs, tables and hardware without the meshes: small enough to send in a chat."""
    zp = results.with_name(results.name + "-report.zip")
    with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(results.rglob("*")):
            if p.is_file() and p.relative_to(results).parts[0] != "outputs":
                z.write(p, p.relative_to(results).as_posix())
    return zp


if __name__ == "__main__":
    main()
