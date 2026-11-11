"""The adapters' own logic, with the engines replaced by small stand-ins: what they ask for, not what the
models do. Real runs are tools/bench.

uv run --no-project --python 3.12 --with pytest --with numpy --with scipy --with pillow pytest -q test_runner.py"""

import json
import sys
import types
from argparse import Namespace
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

import runner


class Clock:
    def mark(self, name):
        pass


def args(**given):
    return Namespace(**{"repo": "repo", "variant": "", "prefetch": False, "image": "in.png", "out": "out.glb", "device": "cuda",
                        "seed": 7, "vram_cap_gb": 0, "offload": "none", **given})


def picture(*blocks, size=100):
    """An RGBA picture, with solid blocks given as (top, left, bottom, right)."""
    pixels = np.zeros((size, size, 4), dtype=np.uint8)
    for top, left, bottom, right in blocks:
        pixels[top:bottom, left:right] = (200, 100, 50, 255)
    return Image.fromarray(pixels)


def test_specks_around_the_subject_go_and_the_subject_is_measured():
    tidied, subject = runner.tidy(picture((30, 30, 70, 70), (5, 5, 7, 7)))
    alpha = np.array(tidied)[..., 3]
    assert alpha[50, 50] == 255
    assert alpha[6, 6] == 0, "the speck must be gone"
    assert subject == {"share": 0.16, "pieces": 1, "edges": 0}


def test_two_real_pieces_stay_and_a_frame_that_cuts_the_subject_is_seen():
    _, subject = runner.tidy(picture((0, 0, 60, 40), (40, 60, 100, 100)))
    assert subject["pieces"] == 2
    assert subject["edges"] == 4


def test_a_soft_edge_of_what_stays_stays():
    pixels = np.array(picture((30, 30, 70, 70)))
    pixels[29, 30:70, 3] = 80  # the matte fades out here
    tidied, _ = runner.tidy(Image.fromarray(pixels))
    assert np.array(tidied)[29, 50, 3] == 80


def test_an_empty_picture_says_so():
    assert runner.tidy(picture())[1] == {"share": 0, "pieces": 0, "edges": 0}


@pytest.fixture
def hunyuan21(tmp_path, monkeypatch):
    """Hunyuan's two packages and torch as stand-ins that remember how they were called."""
    calls = {}

    class Pipeline:
        device = None

        @classmethod
        def from_pretrained(cls, repo, **options):
            calls["load"] = (repo, options)
            return cls()

        def enable_flashvdm(self, **_):
            calls["flashvdm"] = True

        def to(self, device):
            calls["to"] = device

        def __call__(self, **options):
            calls["run"] = options
            return [types.SimpleNamespace(export=lambda path: calls.update(exported=path))]

    def module(name, **parts):
        monkeypatch.setitem(sys.modules, name, types.SimpleNamespace(**parts))

    module("hy3dshape.pipelines", Hunyuan3DDiTFlowMatchingPipeline=Pipeline)
    module("hy3dshape.rembg", BackgroundRemover=lambda: (lambda image: image))
    monkeypatch.setitem(sys.modules, "hy3dshape", types.ModuleType("hy3dshape"))
    module("torch", float16="half", float32="full", manual_seed=lambda seed: seed)
    module("huggingface_hub", snapshot_download=lambda repo, **options: calls.setdefault("downloads", []).append((repo, options)))
    monkeypatch.setenv("HF_HOME", str(tmp_path))
    monkeypatch.setattr(sys, "path", list(sys.path))
    image = tmp_path / "in.png"
    picture((30, 30, 70, 70)).save(image)
    calls["image"] = str(image)
    return calls


def test_hunyuan_2_1_reads_its_own_code_and_no_turbo_parts(hunyuan21):
    runner.hunyuan(args(variant="2.1", image=hunyuan21["image"], repo="pack/repo"), Clock())
    repo, options = hunyuan21["load"]
    assert repo == "tencent/Hunyuan3D-2.1"
    assert options["subfolder"] == "hunyuan3d-dit-v2-1"
    assert options["use_safetensors"] is False, "it comes only as .ckpt"
    assert "flashvdm" not in hunyuan21, "it has no turbo VAE"
    assert hunyuan21["run"]["num_inference_steps"] == 30
    assert hunyuan21["exported"] == "out.glb"
    assert str(Path("pack/repo/hy3dshape")) in sys.path


def test_short_memory_cuts_the_work_into_smaller_pieces(hunyuan21):
    runner.hunyuan(args(variant="2.1", image=hunyuan21["image"]), Clock())
    assert hunyuan21["run"]["num_chunks"] == 20000
    assert not runner.tight(args())
    assert runner.tight(args(offload="model")) and runner.tight(args(vram_cap_gb=4))


def test_hunyuan_2_1_stays_inside_the_pack(hunyuan21, tmp_path):
    runner.hunyuan(args(variant="2.1", prefetch=True, repo="pack/repo"), Clock())
    repo, options = hunyuan21["downloads"][0]
    assert repo == "tencent/Hunyuan3D-2.1"
    assert options["allow_patterns"] == ["hunyuan3d-dit-v2-1/*"]
    assert Path(options["local_dir"]).is_relative_to(tmp_path), "never into the person's home"


class Numbers(np.ndarray):
    """Enough of a tensor for what the adapter asks of one."""

    def float(self):
        return self

    def cpu(self):
        return self

    def numpy(self):
        return np.asarray(self)


def test_a_hosted_model_drops_its_least_sure_points(monkeypatch):
    monkeypatch.setitem(sys.modules, "torch", types.SimpleNamespace(quantile=np.quantile))
    sure = np.arange(10.0).reshape(1, 10, 1).view(Numbers)
    points = np.arange(30.0).reshape(1, 10, 3).view(Numbers)
    found = runner.points_of({"conf": sure, "pts3d": points})
    assert len(found) == 7
    assert found[0].tolist() == [9.0, 10.0, 11.0], "the three least sure are gone"


def test_what_the_first_camera_saw_stands_up_and_faces_the_front_of_the_glb():
    # as the camera sees it, OpenCV's way: y down, z away from the camera
    top, near, far, right = runner.upright(np.array([[0.0, -1.0, 3.0], [0.0, 0.0, 2.0], [0.0, 0.0, 4.0], [1.0, 0.0, 3.0]]))
    assert top[1] > 0, "the top of the photo is up, a GLB's +y"
    assert near[2] > far[2], "the side the camera saw faces +z, where a GLB's front is"
    assert right[0] > 0, "and stays on the right: a turn, not a mirror, so no surface turns inside out"


@pytest.mark.parametrize("variant, weights", [("", "facebook/map-anything-apache"), ("pi3", "yyfz233/Pi3"), ("vggt", "facebook/VGGT-1B")])
def test_each_photo_model_fetches_its_own_weights(variant, weights, monkeypatch):
    got = []
    monkeypatch.setitem(sys.modules, "numpy", np)
    monkeypatch.setitem(sys.modules, "open3d", types.SimpleNamespace())
    monkeypatch.setitem(sys.modules, "trimesh", types.SimpleNamespace())
    monkeypatch.setitem(sys.modules, "huggingface_hub", types.SimpleNamespace(snapshot_download=got.append))
    monkeypatch.setattr(sys, "path", list(sys.path))
    runner.photos(args(variant=variant, prefetch=True), Clock())
    assert got == [weights]


def test_the_cut_writes_what_it_found_beside_the_picture(tmp_path, monkeypatch):
    source = tmp_path / "in.png"
    picture((30, 30, 70, 70)).convert("RGB").save(source)
    keep = lambda image, session: picture((30, 30, 70, 70))
    monkeypatch.setitem(sys.modules, "rembg", types.SimpleNamespace(new_session=lambda name: name, remove=keep))
    out = tmp_path / "cut-input.png"
    runner.cut(args(image=str(source), out=str(out)), Clock())
    assert out.exists()
    assert json.loads(out.with_suffix(".json").read_text())["pieces"] == 1


def test_a_photo_taken_sideways_is_turned_before_the_cut(tmp_path, monkeypatch):
    wide = Image.new("RGB", (40, 20), "red")
    exif = Image.Exif()
    exif[0x0112] = 6  # the phone was held upright
    source = tmp_path / "in.jpg"
    wide.save(source, exif=exif)
    seen = {}
    def cut_out(image, session):
        seen["size"] = image.size
        return picture((30, 30, 70, 70))
    monkeypatch.setitem(sys.modules, "rembg", types.SimpleNamespace(new_session=lambda name: name, remove=cut_out))
    runner.cut(args(image=str(source), out=str(tmp_path / "cut.png")), Clock())
    assert seen["size"] == (20, 40)
