"""uv run --python 3.12 --with pytest --with psutil --with trimesh --with scipy --with networkx
       --with scikit-image --with matplotlib --with fast-simplification pytest -q test_spike.py
(the mesh-kit test needs node and the node_modules that pack.py builds)"""

import json
import os
import shutil
import subprocess
import sys
import types
import zipfile
from pathlib import Path

import numpy as np
import pytest
import trimesh

import analyze
import runner
import spike


def fake_run(tmp_path, monkeypatch):
    """spike's run folders in tmp_path, as main() sets them up."""
    monkeypatch.setattr(spike, "RESULTS", tmp_path, raising=False)  # main() assigns them
    monkeypatch.setattr(spike, "LOGS", tmp_path / "logs", raising=False)
    (tmp_path / "logs").mkdir(exist_ok=True)


def py_writes(out: str, seconds: float = 0, extra: str = "") -> list[str]:
    """A stand-in engine: sleeps, then writes its output file."""
    code = ["import time", extra, f"time.sleep({seconds})", f"open(r'{out}', 'w').write('x')"]
    return [sys.executable, "-c", "; ".join(c for c in code if c)]


def test_fetch_resumes_a_cut_download(tmp_path):
    url = spike.IMAGES["goblin.png"]
    full = spike.fetch(url, tmp_path / "full.png")
    (tmp_path / "resumed.png.part").write_bytes(full.read_bytes()[:1000])  # as if the line dropped
    resumed = spike.fetch(url, tmp_path / "resumed.png")
    assert resumed.read_bytes() == full.read_bytes()
    assert not (tmp_path / "resumed.png.part").exists()


def test_owner_photos_join_the_full_runs(tmp_path, monkeypatch):
    monkeypatch.setattr(spike, "HERE", tmp_path)
    (tmp_path / "images").mkdir()
    for name in ("mine.jpg", "toy.PNG", "notes.txt"):
        (tmp_path / "images" / name).write_bytes(b"x")
    first = spike.plan(None, False, False, {"trellis"})[0]
    assert {"mine.jpg", "toy.PNG", "goblin.png"} <= set(first.images)
    assert "notes.txt" not in first.images


@pytest.mark.skipif(sys.platform != "win32", reason="the Windows job limit")
def test_a_ram_capped_run_may_map_big_weights_but_not_hold_them(tmp_path, monkeypatch):
    fake_run(tmp_path, monkeypatch)
    weights = tmp_path / "weights.bin"
    weights.write_bytes(b"\x01" * (400 << 20))
    hold = "b = bytearray(400 << 20)"  # all in its own memory, as torch loads a checkpoint
    stream = (f"import mmap; f = open(r'{weights}', 'rb'); m = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ); "
              "assert sum(m[::4096]) == len(m[::4096])")  # mapped from disk and read whole, as trellis.cpp reads GGUF
    out = tmp_path / "out.txt"
    held = spike.measure("fake", "hold", "x.png", py_writes(str(out), 0, hold), out, 600, ram_gb=0.2)
    assert not held["ok"] and "MemoryError" in held["error_tail"] and held["ram_cap_gb"] == 0.2
    streamed = spike.measure("fake", "stream", "x.png", py_writes(str(out), 0, stream), out, 600, ram_gb=0.2)
    assert streamed["ok"]
    assert spike.measure("fake", "free", "x.png", py_writes(str(out), 0, hold), out, 600)["ok"]


def test_a_resumed_run_does_only_what_is_missing(tmp_path, monkeypatch):
    fake_run(tmp_path, monkeypatch)
    ran = []

    def item(tier):
        def build(img, out):
            ran.append(tier)
            return py_writes(str(out))
        return spike.Item("fake", tier, ["a.png"], build, 60, None, ".txt")
    (tmp_path / "a.png").write_bytes(b"x")
    items = [item("one"), item("two")]
    spike.record({"engine": "fake", "tier": "one", "image": "a.png", "ok": True})
    spike.run_items(items, {"a.png": tmp_path / "a.png"}, False)
    assert ran == ["two"]
    spike.run_items(items, {"a.png": tmp_path / "a.png"}, False)  # all there: nothing runs again
    assert ran == ["two"]


def test_resume_picks_the_last_unfinished_run_of_the_same_kind(tmp_path, monkeypatch):
    monkeypatch.setattr(spike, "HERE", tmp_path)
    for stamp, full, done in (("20261102-1000", True, False), ("20261102-1100", True, True),
                              ("20261102-1200", False, False), ("20261102-0900", True, False)):
        d = tmp_path / "results" / stamp
        d.mkdir(parents=True)
        (d / "run.json").write_text(json.dumps({"full": full}))
        if done:
            (d / "done.txt").write_text("x")
    (tmp_path / "results" / "20261102-1300").mkdir()  # a run from a bench before run.json
    assert spike.last_run(True).name == "20261102-1000"
    assert spike.last_run(False).name == "20261102-1200"
    assert spike.last_run(True, finished=True).name == "20261102-1100"


def test_a_killed_run_is_started_again_and_both_are_recorded(tmp_path, monkeypatch):
    fake_run(tmp_path, monkeypatch)
    (tmp_path / "a.png").write_bytes(b"x")
    spike.record({"engine": "fake", "tier": "gpu", "image": "a.png", "ok": True, "seconds": 8})  # the finished run
    build = lambda img, out: py_writes(str(out), 8)  # noqa: E731
    spike.run_items([spike.Item("fake", "gpu-killed", ["a.png"], build, 60, None, ".txt", kill=True)],
                    {"a.png": tmp_path / "a.png"}, False)
    by_tier = {r["tier"]: r for r in spike.records()}
    assert by_tier["gpu-killed"]["exit"] == "timeout" and not by_tier["gpu-killed"]["ok"]
    assert by_tier["gpu-killed"]["seconds"] < 6  # stopped at half of the 8 s
    assert by_tier["gpu-after-kill"]["ok"]


def test_cuda_version_comes_from_the_driver_not_the_smi_banner(monkeypatch):
    # driver 610.88 on an RTX 5070 Ti printed no "CUDA Version:" in the banner, the run fell back
    # to "0" and would have picked cu118 torch, which has no kernels for that card
    def smi(args, **_):
        out = "NVIDIA GeForce RTX 5070 Ti, 16303, 610.88\n" if len(args) > 1 else "| NVIDIA-SMI 610.88 |\n"
        return subprocess.CompletedProcess(args, 0, out, "")
    monkeypatch.setattr(spike.subprocess, "run", smi)
    monkeypatch.setitem(sys.modules, "pynvml", types.SimpleNamespace(
        nvmlInit=lambda: None, nvmlShutdown=lambda: None, nvmlSystemGetCudaDriverVersion=lambda: 13020))
    assert spike.nvidia()["cuda"] == "13.2"


def test_installs_skip_compiled_extensions_and_transformers_5():
    # 2026-11-02 run: transformers 5 renamed DINOv2's weights, so Hunyuan's checkpoint stopped loading;
    # diso and torchmcubes need nvcc + MSVC to build, which a normal Windows PC does not have
    sg = spike.deps("triposg", "diffusers\ntransformers\nnumpy==1.22.3\ndiso\npymeshlab # face reduction\n")
    assert {"diffusers", "transformers<5", "numpy==1.22.3", "pymeshlab"} <= set(sg)
    assert "diso" not in sg and "transformers" not in sg
    sr = spike.deps("triposr", "git+https://github.com/tatsy/torchmcubes.git\ntransformers==4.35.0\ngradio\n")
    assert "transformers==4.35.0" in sr and "scikit-image" in sr
    assert "onnxruntime" in sr  # rembg made it optional; TripoSR's background removal needs it
    assert not any("torchmcubes" in r or r == "gradio" for r in sr)
    # 2026-11-04 report: the pinned trimesh calls ndarray.ptp, gone in NumPy 2, and every TripoSR run
    # died writing its GLB, after the model had done its work
    assert spike.deps("triposr", "trimesh==4.0.5\n")[0] == "trimesh>=4.4,<5"


def test_a_venv_built_for_other_packages_is_built_again(tmp_path, monkeypatch):
    monkeypatch.setattr(spike, "WORK", tmp_path)
    monkeypatch.setattr(spike, "FETCHED", set())
    repo = tmp_path / "repo.zip"
    with zipfile.ZipFile(repo, "w") as z:
        z.writestr("Engine-main/requirements.txt", "transformers\n")
    monkeypatch.setattr(spike, "fetch", lambda url, dest: repo)
    steps = []

    def run_logged(cmd, step, **_):
        steps.append(step)
        (tmp_path / "venv-hunyuan").mkdir(exist_ok=True)
    monkeypatch.setattr(spike, "run_logged", run_logged)
    spike.py_env("hunyuan", None, {})
    spike.py_env("hunyuan", None, {})
    assert steps.count("hunyuan-venv") == 1  # same packages: the venv is kept
    (tmp_path / "venv-hunyuan" / ".ok").write_text("ok")  # what the 2026-11-02 run left behind
    spike.py_env("hunyuan", None, {})
    assert steps.count("hunyuan-venv") == 2


def test_weights_are_checked_on_every_run_even_in_a_kept_venv(tmp_path, monkeypatch):
    # 2026-11-02 rerun: a newer runner needed one more Hunyuan file, but the kept venv skipped the prefetch
    monkeypatch.setattr(spike, "WORK", tmp_path)
    monkeypatch.setattr(spike, "FETCHED", set())
    repo = tmp_path / "repo.zip"
    with zipfile.ZipFile(repo, "w") as z:
        z.writestr("Engine-main/requirements.txt", "trimesh\n")
    monkeypatch.setattr(spike, "fetch", lambda url, dest: repo)
    steps = []

    def run_logged(cmd, step, **_):
        steps.append(step)
        (tmp_path / "venv-triposg").mkdir(exist_ok=True)
    monkeypatch.setattr(spike, "run_logged", run_logged)
    spike.py_env("triposg", None, {})
    spike.py_env("triposg", None, {})  # the next image of the same run
    spike.FETCHED.clear()  # a new run of the bench
    spike.py_env("triposg", None, {})
    assert steps.count("triposg-venv") == 1 and steps.count("triposg-weights") == 2


def test_marching_cubes_stand_in_keeps_torchmcubes_axis_order():
    vol = np.zeros((6, 8, 20))  # read as [z][y][x], like torchmcubes does
    vol[2:4, 2:6, 3:17] = 1
    verts, faces = runner.mc_xyz(vol, 0.5)
    assert verts[:, 0].max() > 15 and verts[:, 2].max() < 5  # x runs along the long last axis
    assert faces.dtype == np.int64


def test_texture_seams_do_not_count_as_holes(tmp_path):
    # the textured TRELLIS path splits vertices along UV seams; that is not a hole in the print
    box = trimesh.creation.box()
    box.unmerge_vertices()
    n = len(box.vertices)
    box.visual = trimesh.visual.TextureVisuals(uv=np.column_stack([np.arange(n) / n, np.zeros(n)]))
    box.export(tmp_path / "seams.glb")
    assert analyze.mesh_stats(tmp_path / "seams.glb")["watertight"] is True


@pytest.mark.skipif(not shutil.which("node") or not (Path(spike.HERE) / "node_modules" / "@polyzon").exists(),
                    reason="needs node and the node_modules from pack.py")
def test_meshkit_makes_a_closed_print_of_an_open_model(tmp_path):
    box = trimesh.creation.box((0.05, 0.03, 0.04))  # metres, as glTF has it
    trimesh.Trimesh(box.vertices, box.faces[1:]).export(tmp_path / "open.glb")  # one triangle missing
    p = subprocess.run(["node", str(spike.HERE / "meshcheck.mjs"), str(tmp_path / "open.glb"), str(tmp_path / "print"), "80"],
                       capture_output=True, text=True, timeout=300)
    kit = json.loads(p.stdout.splitlines()[-1])["meshkit"]
    assert kit["before"]["holes"] == 1 and kit["before"]["status"] == "has-errors"
    assert kit["repair"]["checks"]["closed-solid"] == "passed" and kit["repair"]["size"][2] == 80
    assert kit["printable"]
    assert trimesh.load(tmp_path / "print" / "open.stl").is_watertight


@pytest.mark.skipif(not shutil.which("node") or not (Path(spike.HERE) / "node_modules" / "@polyzon").exists(),
                    reason="needs node and the node_modules from pack.py")
def test_meshkit_keeps_a_closed_model_whose_surfaces_touch(tmp_path):
    left = trimesh.creation.box((0.05, 0.05, 0.05))
    right = left.copy()
    right.apply_translation((0.05, 0.05, 0))  # corner to corner: an edge of four faces, what TRELLIS leaves
    trimesh.util.concatenate([left, right]).export(tmp_path / "touching.glb")
    p = subprocess.run(["node", str(spike.HERE / "meshcheck.mjs"), str(tmp_path / "touching.glb"), str(tmp_path / "print"), "80"],
                       capture_output=True, text=True, timeout=300)
    kit = json.loads(p.stdout.splitlines()[-1])["meshkit"]
    assert kit["before"]["nonManifoldEdges"] > 0
    assert "remesh" not in kit and kit["repair"]["faces"] == kit["before"]["faces"]
    assert kit["final"] == {"openEdges": 0, "nonManifoldEdges": 0} and kit["printable"]
    assert trimesh.load(tmp_path / "print" / "touching.stl").is_watertight  # joins equal corners, as a slicer does


def test_each_model_gets_a_preview_next_to_its_picture(tmp_path):
    out = tmp_path / "outputs"
    out.mkdir()
    trimesh.creation.icosphere(5).export(out / "e-t-ball.glb")  # 20K faces
    trimesh.creation.box().export(out / "e-t-cube.glb")
    recs = [{"engine": "e", "tier": "t", "image": n, "ok": True, "out": f"e-t-{n}.glb"} for n in ("ball", "cube")]
    (tmp_path / "results.jsonl").write_text("\n".join(json.dumps(r) for r in recs))
    (tmp_path / "hardware.json").write_text(json.dumps({"ram_mb": 16384, "os": "test", "nvidia": None}))
    analyze.main(tmp_path)
    for n in ("ball", "cube"):
        png = tmp_path / "previews" / f"e-t-{n}.png"
        assert 5_000 < png.stat().st_size < 200_000


def test_a_crash_still_leaves_a_report_with_the_reason(tmp_path, monkeypatch):
    monkeypatch.setattr(spike, "HERE", tmp_path)
    monkeypatch.setattr(spike, "WORK", tmp_path / ".work")
    monkeypatch.setattr(spike, "hardware", lambda: {"disk_free_gb": 100, "nvidia": None})

    def offline(url, dest):
        raise RuntimeError("download failed: no network")
    monkeypatch.setattr(spike, "fetch", offline)
    console = sys.stdout
    spike.main([])
    [report] = (tmp_path / "results").glob("*-report.zip")
    log = zipfile.ZipFile(report).read("run.log").decode()
    assert "plan: trellis" in log  # what was printed before the crash
    assert "Traceback" in log and "download failed: no network" in log
    assert sys.stdout is console


def test_the_report_leaves_the_meshes_out(tmp_path):
    (tmp_path / "logs").mkdir()
    (tmp_path / "logs" / "step.log").write_text("x")
    (tmp_path / "outputs").mkdir()
    (tmp_path / "outputs" / "big.glb").write_bytes(b"x" * 1000)
    names = zipfile.ZipFile(spike.pack_report(tmp_path)).namelist()
    assert names == ["logs/step.log"]


def test_summary_tells_closed_from_open_meshes(tmp_path):
    out = tmp_path / "outputs"
    out.mkdir()
    box = trimesh.creation.box()
    box.export(out / "closed.glb")
    trimesh.Trimesh(box.vertices, box.faces[1:]).export(out / "open.glb")  # one triangle missing
    recs = [{"engine": "e", "tier": "t", "image": n, "ok": True, "out": f"{n}.glb", "seconds": 1}
            for n in ("closed", "open")]
    (tmp_path / "results.jsonl").write_text("\n".join(json.dumps(r) for r in recs))
    (tmp_path / "hardware.json").write_text(json.dumps({"ram_mb": 16384, "os": "test", "nvidia": None}))
    analyze.main(tmp_path)
    closed, open_ = (tmp_path / "summary.md").read_text(encoding="utf-8").splitlines()[-2:]
    assert "| True | 1 |" in closed
    assert "| False | 1 |" in open_


def test_a_retry_runs_what_failed_in_a_finished_run_and_every_model_through_meshkit(tmp_path, monkeypatch):
    run, seen = stopped_run(tmp_path, monkeypatch,
                            {"engine": "hunyuan", "tier": "full", "image": "a", "ok": True},
                            {"engine": "triposr", "tier": "full", "image": "a", "ok": False, "exit": 1},  # a bug, fixed since
                            {"engine": "zimage", "tier": "gpu-killed", "image": "prompt", "ok": False, "exit": "timeout"},  # on purpose
                            {"engine": "meshkit", "tier": "print-80mm", "image": "a.glb", "ok": True},  # mesh-kit changed
                            {"engine": "slicer", "tier": "prusa", "image": "a.stl", "ok": True})  # so is what it wrote
    spike.main(["--full", "--retry-failed"])
    assert spike.RESULTS == run  # the models of the run stay where they are
    assert [e for e, _ in seen["left"]] == ["hunyuan", "zimage"]
    assert not (run / "done.txt").exists()  # stopped halfway, --resume carries on from here


def test_a_slicer_reads_the_models_of_the_routes_ark_would_take():
    assert analyze.print_route("hunyuan-cuda-full-cut-birefnet-cat.glb")
    assert analyze.print_route("trellis-post-cuda-512-cut-birefnet-cat.glb")
    assert analyze.print_route("triposr-cuda-full-cat.glb")  # cuts out its own
    for other in ("hunyuan-cuda-full-cat.glb", "trellis-post-cuda-512-q8-cut-birefnet-cat.glb",
                  "trellis-post-cuda-512-seed1-cut-birefnet-cat.glb", "triposr-cpu-cat.glb"):
        assert not analyze.print_route(other)
    assert not analyze.print_route("triposr-cuda-full-ram8gb-goblin")  # the same model under a memory cap


FAKE_SLICER = r"""
import pathlib, sys
args = sys.argv[1:]
if "--info" in args:
    print("[m]"); print("size_x = 66.000000"); print("number_of_facets = 1200"); print("manifold = no")
    print("open_edges = 7"); print("number_of_parts =  3"); print("volume = 91000.500000")
elif "fail.stl" in args[-1]:
    print("Slicing failed", file=sys.stderr); sys.exit(1)
else:
    out = pathlib.Path(args[args.index("--output") + 1])
    out.write_text("; filament used [mm] = 5123.45\n; filament used [g] = 15.3\n"
                   "; estimated printing time (normal mode) = 1h 2m 3s\n")
"""


def run_slicecheck(tmp_path, model):
    (tmp_path / "fake.py").write_text(FAKE_SLICER)
    if sys.platform == "win32":
        console = tmp_path / "fake.cmd"
        console.write_text(f'@"{sys.executable}" "{tmp_path / "fake.py"}" %*\n')
    else:
        console = tmp_path / "fake"
        console.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{tmp_path / "fake.py"}" "$@"\n')
        console.chmod(0o755)
    stl, out = tmp_path / model, tmp_path / "m.slice.json"
    stl.write_text("x")
    (stl.with_suffix(".3mf")).write_text("x")
    return subprocess.run([sys.executable, str(spike.HERE / "slicecheck.py"), str(console), str(stl), str(out)],
                          capture_output=True, text=True, timeout=60), out


def test_slicecheck_keeps_what_the_slicer_found_and_not_the_gcode(tmp_path):
    p, out = run_slicecheck(tmp_path, "m.stl")
    assert p.returncode == 0, p.stderr
    found = json.loads(p.stdout.splitlines()[-1])["slicer"]
    assert found["stl"]["manifold"] == "no" and found["stl"]["open_edges"] == "7"
    assert found["3mf"]["number_of_parts"] == "3"
    assert found["sliced"] and found["filament used [mm]"] == "5123.45"
    assert found["estimated printing time (normal mode)"] == "1h 2m 3s"
    assert out.exists() and not out.with_suffix(".gcode").exists()


def test_a_model_the_slicer_refuses_is_a_failed_run(tmp_path):
    p, out = run_slicecheck(tmp_path, "fail.stl")
    assert p.returncode == 1 and not json.loads(p.stdout.splitlines()[-1])["slicer"]["sliced"]
    assert not out.exists()


def test_the_slicer_pass_takes_route_models_once(tmp_path, monkeypatch):
    fake_run(tmp_path, monkeypatch)
    for name in ("hunyuan-cuda-full-cut-birefnet-a", "hunyuan-cuda-full-a"):
        spike.record({"engine": "meshkit", "tier": "print-80mm", "image": f"{name}.glb", "ok": True, "out": f"{name}.stl"})
    monkeypatch.setattr(spike, "OS", "Windows")
    monkeypatch.setattr(spike, "slicer_bin", lambda: Path("console"))
    seen = []
    monkeypatch.setattr(spike, "measure", lambda _e, _t, image, *_a, **_k: seen.append(image))
    it = spike.Item("slicer", "prusa-0.2mm", [], None, 60, None, ".json")
    spike.slicer_pass(it, tmp_path, set(), set())
    assert seen == ["hunyuan-cuda-full-cut-birefnet-a.stl"]
    done = {("slicer", "prusa-0.2mm", "hunyuan-cuda-full-cut-birefnet-a.stl")}
    seen.clear()
    spike.slicer_pass(it, tmp_path, done, set())
    assert not seen


def test_summary_shows_the_slicer_and_a_flat_model(tmp_path):
    (tmp_path / "hardware.json").write_text(json.dumps({"ram_mb": 16384, "os": "test", "nvidia": None}))
    recs = [{"engine": "meshkit", "tier": "print-80mm", "image": "a.glb", "ok": True, "out": "a.stl", "seconds": 1,
             "meshkit": {"before": {"status": "needs-check", "flatShare": 0.97}, "printable": False}},
            {"engine": "slicer", "tier": "prusa-0.2mm", "image": "a.stl", "ok": True, "seconds": 2, "out": "a.slice.json",
             "slicer": {"stl": {"manifold": "no", "open_edges": "7", "number_of_parts": "3"}, "3mf": {"manifold": "yes"},
                        "sliced": True, "filament used [mm]": "5123.45",
                        "estimated printing time (normal mode)": "1h 2m 3s"}}]
    (tmp_path / "results.jsonl").write_text("\n".join(json.dumps(r) for r in recs))
    analyze.main(tmp_path)
    text = (tmp_path / "summary.md").read_text(encoding="utf-8")
    assert "| 0.97 |" in text
    assert "| a.stl | no | 7 | 3 | yes | True | 5123.45 | 1h 2m 3s | 2 |" in text


def test_each_print_on_a_route_gets_a_preview_of_its_own(tmp_path):
    (tmp_path / "hardware.json").write_text(json.dumps({"ram_mb": 16384, "os": "test", "nvidia": None}))
    print_dir = tmp_path / "outputs" / "print"
    print_dir.mkdir(parents=True)
    trimesh.creation.box((40, 30, 80)).export(print_dir / "hunyuan-cuda-full-cut-birefnet-a.stl")
    rec = {"engine": "meshkit", "tier": "print-80mm", "image": "hunyuan-cuda-full-cut-birefnet-a.glb", "ok": True,
           "out": "hunyuan-cuda-full-cut-birefnet-a.stl", "seconds": 1, "meshkit": {}}
    (tmp_path / "results.jsonl").write_text(json.dumps(rec))
    analyze.main(tmp_path)
    assert (tmp_path / "previews" / "print-hunyuan-cuda-full-cut-birefnet-a.png").stat().st_size > 1000


def stopped_run(tmp_path, monkeypatch, *recs, done=True):
    """A run of an earlier version in tmp_path/results, and what main() leaves of it for bench()."""
    run = tmp_path / "results" / "20261102-1000"
    (run / "logs").mkdir(parents=True)
    (run / "run.json").write_text(json.dumps({"full": True}))
    if done:
        (run / "done.txt").write_text("x")
    monkeypatch.setattr(spike, "HERE", tmp_path)
    monkeypatch.setattr(spike, "RESULTS", run, raising=False)
    for rec in recs:
        spike.record(rec)
    seen = {}
    monkeypatch.setattr(spike, "hardware", dict)
    monkeypatch.setattr(spike, "wrap_up", lambda *_: None)
    monkeypatch.setattr(spike, "bench", lambda *_: seen.update(left=[(r["engine"], r["image"]) for r in spike.records()]))
    return run, seen


MESHKIT = {"engine": "meshkit", "tier": "print-80mm", "image": "a.glb", "ok": True}


def test_a_second_copy_of_the_bench_leaves_the_run_alone(tmp_path, monkeypatch):
    run, seen = stopped_run(tmp_path, monkeypatch, MESHKIT)
    held = spike.only_copy()
    spike.main(["--full", "--retry-failed"])
    held.close()
    assert not seen and not (run / "run.log").exists()
    assert (run / "done.txt").exists() and spike.records()
    spike.only_copy().close()  # the file itself does not stay in the way, after a crash too


def test_a_lost_console_stops_neither_the_run_nor_its_log(tmp_path):
    class Gone:
        def write(self, s):
            raise OSError(22, "Invalid argument")

        def flush(self):
            raise OSError(22, "Invalid argument")

    with open(tmp_path / "run.log", "a+", encoding="utf-8") as log:
        print("still here", file=spike.Tee(Gone(), log), flush=True)
        log.seek(0)
        assert "still here" in log.read()


def test_resume_does_not_start_a_finished_run_over(tmp_path, monkeypatch):
    run, seen = stopped_run(tmp_path, monkeypatch, MESHKIT)
    spike.main(["--full", "--resume"])
    assert not seen
    assert [p.name for p in (tmp_path / "results").iterdir()] == [run.name]


def test_a_retry_stopped_halfway_is_carried_on_until_the_bench_changes(tmp_path, monkeypatch):
    run, seen = stopped_run(tmp_path, monkeypatch, MESHKIT)
    spike.main(["--full", "--retry-failed"])
    assert seen["left"] == []
    spike.record(MESHKIT)  # done before the window closed
    spike.main(["--full", "--retry-failed"])
    assert seen["left"] == [("meshkit", "a.glb")]  # mesh-kit is hours: not again
    monkeypatch.setattr(spike, "VERSION", "next")
    spike.main(["--full", "--retry-failed"])
    assert seen["left"] == []


def test_the_print_run_redoes_the_route_and_leaves_the_rest(tmp_path, monkeypatch):
    route = "hunyuan-cuda-full-cut-birefnet-a"
    keep = [{"engine": "triposr", "tier": "cpu", "image": "a.png", "ok": True},
            {"engine": "hunyuan", "tier": "cuda-cap4gb", "image": "a.png", "ok": False, "exit": 1},
            {**MESHKIT, "image": "hunyuan-cuda-full-a.glb"}]
    redo = [{"engine": "triposr", "tier": "cuda-full", "image": "a.png", "ok": True},
            {**MESHKIT, "image": "triposr-cuda-full-a.glb"}, {**MESHKIT, "image": route + ".glb"},
            {"engine": "slicer", "tier": "prusa", "image": route + ".stl", "ok": True}]
    _, seen = stopped_run(tmp_path, monkeypatch, *keep, *redo, keep[-1])  # two copies ran: a twin of a row
    spike.main(["--full", "--print-route"])
    assert seen["left"] == [(r["engine"], r["image"]) for r in keep]


def test_triposr_is_stood_up_the_way_its_own_app_does():
    source = Path(runner.__file__).read_text(encoding="utf-8")
    assert "mesh = to_gradio_3d_orientation(mesh)" in source


def test_a_mac_plan_runs_on_metal_and_mps_and_leaves_the_windows_tiers_out(monkeypatch):
    monkeypatch.setattr(spike, "OS", "Darwin")
    items = spike.plan(None, False, False, set(), full=True)
    tiers = {i.tier for i in items}
    assert {"metal-512", "metal-1024", "mps-full"} <= tiers
    assert not [t for t in tiers if "cuda" in t or "vulkan" in t or "ram" in t]
    assert analyze.print_route("triposr-mps-full-goblin")  # the previews follow the same route as on the PC


@pytest.mark.skipif(not shutil.which("sh"), reason="needs a POSIX shell")
def test_the_mac_start_installs_the_tools_runs_both_checks_and_carries_on(tmp_path):
    def script(path, text):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("#!/bin/sh\n" + text + "\n", encoding="utf-8", newline="\n")

    root, stubs = tmp_path / "ark-mac", tmp_path / "stubs"
    log = (tmp_path / "log").as_posix()
    shutil.copy(Path(spike.HERE).parent / "START-MAC.sh", root.mkdir() or root)
    script(stubs / "caffeinate", "exit 0")
    script(stubs / "sleep", "exit 0")
    script(stubs / "open", f'echo "open $1" >> {log}')
    script(stubs / "xcode-select", f'[ -f {log}.tools ] && exit 0\n'
                                   f'[ "$1" = --install ] && {{ echo install >> {log}; touch {log}.tools; }}\nexit 2')
    script(root / "tools/tauri-probe/run.sh", f'echo "probe $*" >> {log}\n'
                                              'mkdir -p tools/tauri-probe/results\n'
                                              'echo x > tools/tauri-probe/results/1-probe-report.zip\nexit 1')
    script(root / "bench/run.sh", f'echo "bench $*" >> {log}\nmkdir -p bench/results\necho x > bench/results/1-report.zip')
    env = {**os.environ, "PATH": f"{stubs}{os.pathsep}{os.environ['PATH']}"}
    for _ in range(2):  # a reboot halfway: the same command again
        p = subprocess.run(["sh", "START-MAC.sh"], cwd=root, env=env, capture_output=True, text=True, timeout=60)
        assert "DONE" in p.stdout, p.stdout + p.stderr
    assert (tmp_path / "log").read_text().split("\n")[:-1] == [
        "install", "probe --exit", "bench --full --resume", "open reports", "bench --full --resume", "open reports"]
    assert {f.name for f in (root / "reports").iterdir()} == {"1-probe-report.zip", "1-report.zip"}
