"""Runs one Python engine inside its own venv (Python 3.10) and prints one JSON line:
{"stages": {...seconds...}, "torch_peak_mb": N}

    python runner.py hunyuan|triposg|triposr --repo DIR --check --device cuda|mps|cpu
    python runner.py hunyuan|triposg|triposr --repo DIR --prefetch
    python runner.py hunyuan|triposg|triposr --repo DIR --image IN --out OUT.glb [--seed N]
                     [--device cuda|mps|cpu] [--vram-cap-gb N] [--offload none|model|sequential]
    python runner.py hunyuan --variant mini|2|mv|2.1 ...
    python runner.py photos [--variant pi3|vggt] --repo DIR --image IN --out OUT.glb
    python runner.py cut --repo DIR --image IN --out OUT.png

--vram-cap-gb emulates a smaller card on this one; --offload is the memory ladder:
model = one pipeline stage on the GPU at a time, sequential = layer by layer from RAM.

Several photos of one object lie beside --image as view-1.png, view-2.png and so on.
"""

import argparse
import functools
import gc
import hashlib
import importlib
import json
import os
import sys
import threading
import time
import types
from fnmatch import fnmatch
from pathlib import Path

# Each Hugging Face repository the engines take, at one commit, with the hash of every file taken from it.
# An engine's config.yaml names the code it builds (Hunyuan3D, TripoSR), so a file that is not the one
# pinned could run anything: what arrives is checked, from Hugging Face or its mirror alike. Made, and made
# again for a new version of a model, by `node tools/bench/pins.mjs`.
PINS = {  # made by pins.mjs
    "tencent/Hunyuan3D-2mini": ("f90a0f7df7d5e6f71109cf333f6a95a0ae3194a6", {
        "hunyuan3d-dit-v2-mini-turbo/config.yaml": "git:70a77756aaa5429626f4106e2cd882ca494221ab",
        "hunyuan3d-dit-v2-mini-turbo/model.fp16.safetensors": "sha256:bdbcef30dd0149a281e17d5b5b1fdad1122c904e098a42f3100e04e03c247bc4",
        "hunyuan3d-vae-v2-mini-turbo/config.yaml": "git:e27bf69954e893d82127624b2b646d73ee610c08",
        "hunyuan3d-vae-v2-mini-turbo/model.fp16.safetensors": "sha256:5dcaca67a8da9e7079fb7b55714a572d0651ac95983bb43099913feaf6738f94",
    }),
    "tencent/Hunyuan3D-2": ("9cd649ba6913f7a852e3286bad86bfa9a2d83dcf", {
        "hunyuan3d-dit-v2-0-turbo/config.yaml": "git:e3c0f850dd87f0f1b59f604e396cf665966011a7",
        "hunyuan3d-dit-v2-0-turbo/model.fp16.safetensors": "sha256:5ee5a81e4df08a1c65b79910bf5b145a90376e526794f4607a4d5d068d62f269",
        "hunyuan3d-vae-v2-0-turbo/config.yaml": "git:d4bf4d5ee1874c8e828a5296ff5e44d4fcb5b349",
        "hunyuan3d-vae-v2-0-turbo/model.fp16.safetensors": "sha256:66b7af697118db2de00c22f63a385c75f9049709739281971837af9e4ce31cb4",
    }),
    "tencent/Hunyuan3D-2mv": ("3a761b539b29fe4ff64714813aa9560fd66f5de0", {
        "hunyuan3d-dit-v2-mv-turbo/config.yaml": "git:9d36691622a301b7962d11107e6e032ee411315d",
        "hunyuan3d-dit-v2-mv-turbo/model.fp16.safetensors": "sha256:172d7a989b99f66af760da0080d8c6f6350c72609536cf0c55b87a4afa574e45",
    }),
    "tencent/Hunyuan3D-2.1": ("0b94677654c57bb9a6b6845cd7b704ccf551d327", {
        "hunyuan3d-dit-v2-1/config.yaml": "git:695b7d5c6ba96a7f1f849430da23b21c682d8116",
        "hunyuan3d-dit-v2-1/model.fp16.ckpt": "sha256:6b519fc7242f78e9b5f47ea4d55668fe3d944a2d27332f4ca68d29a6ff603f5e",
    }),
    "VAST-AI/TripoSG": ("2c1c516d22d58db486a058d98d31bb6177344e06", {
        ".gitattributes": "git:b2fd9eefc9bc7f77fa55c60257a6bf150595a3d3",
        "README.md": "git:d48215b406cdefabfc7c390b2a9a8d7801fe0394",
        "feature_extractor_dinov2/preprocessor_config.json": "git:ff5b47c2edcd1d3556d63c01a65d93b58b9efce1",
        "image_encoder_dinov2/config.json": "git:c3f240c5cdb94dca9e2a4062ac0270bbe3d3c2e6",
        "image_encoder_dinov2/model.safetensors": "sha256:399fba97a95f22c36834418bc69373364a99af3a1153da1c0fb31db567c92e23",
        "model_index.json": "git:0afa776ede6a8db5688a859f9d2d3e3bf7c0bb6c",
        "scheduler/scheduler_config.json": "git:da0fa53502688a5768223aa7f446473365ca9b1d",
        "transformer/config.json": "git:a21d98d45b148c4831a53e002a4be20744e82b37",
        "transformer/diffusion_pytorch_model.safetensors": "sha256:9192b5923f7b605b394192809aa2ceb73bf0f4009674d8e3b999b45bb97d4bf2",
        "vae/config.json": "git:c5d72c0a6aecccd736df57dcecd42212ed35c449",
        "vae/diffusion_pytorch_model.safetensors": "sha256:a2e667c24927a5a35e5f19fcb4c75890e9399aa966b6db8131d7df733a750c8b",
    }),
    "briaai/RMBG-1.4": ("2ceba5a5efaec153162aedea169f76caf9b46cf8", {
        ".gitattributes": "git:85d164dd4039759357c6f4f14bb467c6b86bbedd",
        "MyConfig.py": "git:d50006abdaa687edd18dd39c9fb5ac9a31023773",
        "MyPipe.py": "git:f98d8de2856793cb7d6ca894559366d979519e85",
        "README.md": "git:9c1f4e48ad47f65971cb6258f2c781ddfc45a8fb",
        "briarmbg.py": "git:da8591aafb1fd74c194a665302452a2aa591d161",
        "config.json": "git:a587b1fea5d4c20cc7be9ce8790300e414ebed9d",
        "example_inference.py": "git:bb627e1952de7701331168357d9510c7c00f9fd5",
        "example_input.jpg": "git:4c51970914c075064c43b60c7e66b56be2c31463",
        "model.pth": "sha256:893c16c340b1ddafc93e78457a4d94190da9b7179149f8574284c83caebf5e8c",
        "model.safetensors": "sha256:46ef7fe46f2ae284d8f1aaa24bfa5fca5ef25a34e2c7caa890a0029eb100e87f",
        "onnx/model.onnx": "sha256:8cafcf770b06757c4eaced21b1a88e57fd2b66de01b8045f35f01535ba742e0f",
        "onnx/model_fp16.onnx": "sha256:9fdfdb41866d872e0acf4a010c35c1a8547bf0eebe0d1544406bbf1c824cb59d",
        "onnx/model_quantized.onnx": "sha256:a6648479275dfd0ede0f3a8abc20aa5c437b394681b05e5af6d268250aaf40f3",
        "onnx/quantize_config.json": "git:d0dd447b33c4757b5e90081b61a48cb2d65d4634",
        "preprocessor_config.json": "git:ef29ef503ab28b350a34ea32785f8015af34b5c1",
        "pytorch_model.bin": "sha256:59569acdb281ac9fc9f78f9d33b6f9f17f68e25086b74f9025c35bb5f2848967",
        "requirements.txt": "git:24fc6e3706df0ed5e8bf8ece6d3a14bf261679d6",
        "results.png": "sha256:2b7f08fc4c09db56b516186c0629f72523a5cbe328beaedda8b36349af4b04bc",
        "t4.png": "sha256:43a9453f567d9bff7fe4481205575bbf302499379047ee6073247315452ba8fb",
        "utilities.py": "git:77bf9e6f0ea22608c69a6e1c5528a3f225b48a63",
    }),
    "stabilityai/TripoSR": ("5b521936b01fbe1890f6f9baed0254ab6351c04a", {
        ".gitattributes": "git:3217fd3833103daf6f13706bda7ffd0f686f0ef6",
        "README.md": "git:e1bcca137e14a0aebb951187ffd3b2e71936aa7b",
        "config.yaml": "git:fa3e59a701f02679bd1dca02fbaf97306174d291",
        "figures/input800.mp4": "sha256:b2da16c42c2e03139e297d6930bcff7a99c595cc100b545861519793c662500f",
        "figures/output_examples.mp4": "sha256:c63a5fe7afea93549cc412fab612a1c2e5a46844fa75c5ff4eee892b9d3bbc4e",
        "model.ckpt": "sha256:429e2c6b22a0923967459de24d67f05962b235f79cde6b032aa7ed2ffcd970ee",
    }),
    "facebook/dino-vitb16": ("f205d5d8e640a89a2b8ef0369670dfc37cc07fc2", {
        "config.json": "git:77374d76174bf4b940cc485b61568ff27fcbbc0d",
        "preprocessor_config.json": "git:f1af49d6475dc195b4fd213692eefd721389283a",
    }),
    "facebook/map-anything-apache": ("00f9c245bbcb60522d1ed7f9e9d88462c6e3f38a", {
        ".gitattributes": "git:a6344aac8c09253b3b630fb776ae94478aa0275b",
        "README.md": "git:568b7d23ccd4345b425b08234e60812e98a7a27c",
        "config.json": "git:750a549a1d733b14097cda7edb885a0559c0e08c",
        "model.safetensors": "sha256:fa06c0fdccefc5048e072c85935d5789b1e36b307f3859033c17f9dcb9fd5201",
    }),
    "yyfz233/Pi3": ("ae722e7039287d0c8fde9f11f197f804f44b510c", {
        ".gitattributes": "git:cbee9cdc508196884ee91e33efbfce8c220fd90c",
        "README.md": "git:73d9dd6b801120f0117a67b2959182076a71e473",
        "config.json": "git:21fc6d0b0cd68f0d269ff8bd13b934b980fd11e4",
        "main.png": "sha256:59a8ec432247b5f7775e9bb48d9ef9cee0bc806a47838ecd8758f00bfbaa2eef",
        "model.safetensors": "sha256:33580e4702ac671558aedeab1148fd08118f7ce45bdbeb99f3e3cf340062875d",
    }),
    "facebook/VGGT-1B": ("860abec7937da0a4c03c41d3c269c366e82abdf9", {
        ".gitattributes": "git:a6344aac8c09253b3b630fb776ae94478aa0275b",
        "README.md": "git:b8e9a3f570877961599dc5ca652630296467f7a5",
        "config.json": "git:303bf21400e2723e8ff9c0c7ceb6d86859b1ddeb",
        "model.pt": "sha256:d15bf50a8615c8225ed48b51ea5cac673d82442ec0309036df555a053253afe0",
        "model.safetensors": "sha256:f164acf60724910d8fe1578bb499d800850c7bb0948db7555c413f9fbe60467e",
    }),
}


def fetch(repo, patterns=None, **options):
    """`repo` as PINS has it: at its commit, each file checked against its hash wherever it came from (HF_ENDPOINT
    may be the mirror). One that is not the file pinned is deleted before an engine can read it, and the install
    stops. The repository's `main` is then this commit: the engines ask for `main`, offline, when they run."""
    from huggingface_hub import snapshot_download
    sha, files = PINS[repo]
    if patterns is not None:
        options["allow_patterns"] = patterns
    where = Path(snapshot_download(repo, revision=sha, **options))
    for name, expected in files.items():
        if patterns is not None and not any(fnmatch(name, p) for p in patterns):
            continue
        path = where / name
        if path.is_file() and digest(path, expected.split(":")[0]) == expected:
            continue
        # the cache's file too, not only its link: it would be taken again as it is
        for gone in {path.resolve(), path}:
            gone.unlink(missing_ok=True)
        raise SystemExit(f"{repo}/{name} is not the file pinned at {sha[:12]}: it was deleted, and the install stops")
    if "local_dir" not in options:
        refs = Path(os.environ["HF_HOME"]) / "hub" / f"models--{repo.replace('/', '--')}" / "refs"
        refs.mkdir(parents=True, exist_ok=True)
        (refs / "main").write_text(sha)
    return str(where)


def digest(path, kind):
    """A file's hash as PINS writes it: sha256 for a large file, git's blob hash for a small one."""
    h = hashlib.sha256() if kind == "sha256" else hashlib.sha1(b"blob %d\0" % path.stat().st_size)
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return f"{kind}:{h.hexdigest()}"


class Clock:
    def __init__(self):
        self.t, self.stages = time.perf_counter(), {}

    def mark(self, name):
        now = time.perf_counter()
        self.stages[name] = round(now - self.t, 1)
        self.t = now
        print(json.dumps({"done": name}), flush=True)  # Ark shows the real stage from this


def cap_vram(gb):
    import torch
    if gb and torch.cuda.is_available():
        total = torch.cuda.get_device_properties(0).total_memory
        torch.cuda.set_per_process_memory_fraction(min(1.0, gb * 2**30 / total))


def tight(a):
    """Memory is short, as measured or as the ladder decided, or shared with the whole computer as on a Mac:
    engines cut their work into smaller pieces."""
    return bool(a.vram_cap_gb) or a.offload != "none" or a.device == "mps"


def lean(torch, build, half, parts=None):
    """Builds a model as lightly as the computer allows, and says how: "fp16" or "fp32".

    Weights are mapped from the disk instead of read whole into memory, and on a graphics device, where the
    model runs in half precision anyway, its modules are built in half precision from the start. Hunyuan3D-2.1
    read its 7.4 GB checkpoint into memory and built 13 GB of full-precision modules beside it before it
    halved them: a 24 GB Mac ran out. A build that fails in half precision, or holds a value half precision
    cannot (`parts` names the modules to look over), is made again in full, still mapped."""
    load, dtype = torch.load, torch.get_default_dtype()

    def mapped(f, *args, **kw):
        if isinstance(f, (str, os.PathLike)) and "mmap" not in kw:
            try:
                return load(f, *args, mmap=True, **kw)
            except RuntimeError:  # saved in torch's old format, which cannot be mapped
                pass
        return load(f, *args, **kw)

    def finite(made):
        return all(torch.isfinite(t).all().item() for part in (parts(made) if parts else []) for t in [*part.parameters(), *part.buffers()])

    torch.load = mapped
    try:
        if half:
            torch.set_default_dtype(torch.float16)
            try:
                made = build()
                if finite(made):
                    return made, "fp16"
            except RuntimeError:  # an operation without a half-precision kernel on this device
                pass
            finally:
                torch.set_default_dtype(dtype)
            made = None
            gc.collect()
        return build(), "fp32"
    finally:
        torch.load = load
        torch.set_default_dtype(dtype)


def free(torch, device):
    """What loading left behind goes back to the system before the work starts."""
    gc.collect()
    if device == "mps":
        torch.mps.empty_cache()
    elif device == "cuda":
        torch.cuda.empty_cache()


def place(pipe, offload, device):
    if offload == "model":
        pipe.enable_model_cpu_offload(device=device)
    elif offload == "sequential":
        pipe.enable_sequential_cpu_offload(device=device)
    else:
        pipe.to(device)


def hunyuan_offload(pipe, how, device):
    """Hunyuan's pipeline is not a diffusers one: its own model offload fails (it has no .components)
    and it has no layer-by-layer offload. The image encoder always moves whole: Hunyuan reads its
    parameters directly, and layer-by-layer offload leaves them on the meta device."""
    import torch
    from accelerate import cpu_offload, cpu_offload_with_hook
    _, hook = cpu_offload_with_hook(pipe.conditioner, device)
    if how == "model":
        _, hook = cpu_offload_with_hook(pipe.model, device, prev_module_hook=hook)
        cpu_offload_with_hook(pipe.vae, device, prev_module_hook=hook)
    else:
        pipe.model.register_forward_pre_hook(lambda *_: hook.offload())  # the encoder is done by then
        cpu_offload(pipe.model, device)
        cpu_offload(pipe.vae, device)
    pipe.device = torch.device(device)  # where __call__ puts its latents


HUNYUAN = {
    "mini": ("tencent/Hunyuan3D-2mini", "hunyuan3d-dit-v2-mini-turbo", "tencent/Hunyuan3D-2mini", "hunyuan3d-vae-v2-mini-turbo"),
    "2": ("tencent/Hunyuan3D-2", "hunyuan3d-dit-v2-0-turbo", "tencent/Hunyuan3D-2", "hunyuan3d-vae-v2-0-turbo"),
    # three photos: front, left, back; it shares the VAE of the full model
    "mv": ("tencent/Hunyuan3D-2mv", "hunyuan3d-dit-v2-mv-turbo", "tencent/Hunyuan3D-2", "hunyuan3d-vae-v2-0-turbo"),
    # newer code in another repository, and its one checkpoint holds the VAE too
    "2.1": ("tencent/Hunyuan3D-2.1", "hunyuan3d-dit-v2-1", None, None),
}


def views(a):
    """The other photos of a job, in the order they were given."""
    return sorted(Path(a.image).parent.glob("view-*"), key=lambda p: int(p.stem.split("-")[1]))


def hunyuan(a, clock):
    repo_id, sub, vae_repo, vae = HUNYUAN[a.variant or "mini"]
    newer = vae_repo is None
    sys.path.insert(0, str(Path(a.repo) / "hy3dshape") if newer else a.repo)
    if newer:  # it looks here before it goes to the network, and in the person's home by default
        os.environ["HY3DGEN_MODELS"] = str(Path(os.environ["HF_HOME"]) / "hy3dgen")
    import torch
    from PIL import Image
    BackgroundRemover = importlib.import_module("hy3dshape.rembg" if newer else "hy3dgen.rembg").BackgroundRemover
    Pipeline = importlib.import_module("hy3dshape.pipelines" if newer else "hy3dgen.shapegen").Hunyuan3DDiTFlowMatchingPipeline

    if a.prefetch:
        if newer:
            fetch(repo_id, [f"{sub}/*"], local_dir=Path(os.environ["HY3DGEN_MODELS"]) / repo_id)
        else:
            # Each turbo folder holds its weights twice, as .ckpt and as .safetensors. Built with use_safetensors
            # below, the engine reads only these two (hy3dgen smart_load_model, variant fp16), the turbo VAE
            # enable_flashvdm swaps in too: without the .ckpt the download is half as big (4.2 to 5.3 GB less).
            # Offline, the engine's ask for the whole folder gives what is here.
            taken = lambda folder: [f"{folder}/config.yaml", f"{folder}/model.fp16.safetensors"]
            fetch(repo_id, taken(sub))
            fetch(vae_repo, taken(vae))
        BackgroundRemover()  # rembg fetches its u2net model on first use
        return
    gpu = a.device != "cpu"
    # on the CPU first: enable_flashvdm swaps in another VAE, and two on the GPU at once ran out of 4 GB
    pipe, how = lean(torch, lambda: Pipeline.from_pretrained(
        repo_id, subfolder=sub, use_safetensors=not newer, device="cpu",  # 2.1 comes only as .ckpt: its code reads it weights-only
        dtype=torch.float16 if gpu else torch.float32), half=gpu, parts=lambda p: [p.model, p.vae, p.conditioner])
    print(json.dumps({"lean": how}), flush=True)
    if a.device == "cuda" and not newer:
        pipe.enable_flashvdm(topk_mode="merge")
    if a.offload == "none":
        pipe.to(a.device)
    else:
        hunyuan_offload(pipe, a.offload, a.device)
    free(torch, a.device)
    clock.mark("load")
    def ready(path):
        image = Image.open(path)
        if image.mode != "RGBA" or image.getextrema()[3][0] == 255:  # no real alpha: cut the background
            image = BackgroundRemover()(image.convert("RGB"))
        return image

    image = ready(a.image)
    if a.variant == "mv":
        others = views(a)
        image = {"front": image, **{side: ready(path) for side, path in zip(("left", "back"), others)}}
    clock.mark("background")
    mesh = pipe(image=image, num_inference_steps=30 if newer else 5, octree_resolution=380,  # 2.1 has no turbo weights
                num_chunks=5000 if tight(a) else 20000,  # smaller chunks = lower peak memory
                generator=torch.manual_seed(a.seed), output_type="trimesh")[0]
    clock.mark("generate")
    mesh.export(a.out)
    clock.mark("export")


def triposg(a, clock):
    root = Path(a.repo)
    sys.path[:0] = [str(root), str(root / "scripts")]
    import numpy as np
    import torch
    import trimesh
    from huggingface_hub import snapshot_download

    if a.prefetch:
        fetch("VAST-AI/TripoSG")
        fetch("briaai/RMBG-1.4")
        return
    weights, rmbg_dir = snapshot_download("VAST-AI/TripoSG"), snapshot_download("briaai/RMBG-1.4")  # offline: the pinned
    # diso (the flash decoder's marching cubes) is a CUDA extension with no Windows wheels; without it
    # TripoSG runs its own hierarchical decoder (scikit-image marching cubes) and never touches DiffDMC
    sys.modules["diso"] = types.SimpleNamespace(DiffDMC=None)
    from briarmbg import BriaRMBG
    from image_process import prepare_image
    from triposg.pipelines.pipeline_triposg import TripoSGPipeline

    if a.device != "cuda":  # image_process.py calls .cuda() on its tensors
        torch.Tensor.cuda = lambda t, *_, **__: t.to(a.device)
        # inference_utils.py asks for device='cuda' outright, in float16, which max_pool3d may not do on a CPU
        zeros = torch.zeros
        torch.zeros = lambda *s, **k: zeros(*s, **({**k, "device": a.device, "dtype": torch.float32}
                                                   if k.get("device") == "cuda" else k))
    # TripoSG does not declare its stage order, which diffusers needs to offload one stage at a time
    TripoSGPipeline.model_cpu_offload_seq = "image_encoder_dinov2->transformer->vae"
    gpu = a.device != "cpu"
    rmbg = BriaRMBG.from_pretrained(rmbg_dir).to(a.device).eval()
    # built in the precision it runs in: a full-precision copy first and a half one after needed both at once
    pipe = TripoSGPipeline.from_pretrained(weights, torch_dtype=torch.float16 if gpu else torch.float32)
    place(pipe, a.offload, a.device)
    if tight(a):  # the decoder asks about 17M grid points 50K at a time; at 2 GB that ran out of memory
        pipe.vae._decode = functools.partial(pipe.vae._decode, num_chunks=10000)
    free(torch, a.device)
    clock.mark("load")
    with torch.no_grad():
        img = prepare_image(a.image, bg_color=np.array([1.0, 1.0, 1.0]), rmbg_net=rmbg)
        clock.mark("background")
        out = pipe(image=img, generator=torch.Generator().manual_seed(a.seed),
                   num_inference_steps=50, guidance_scale=7.0, use_flash_decoder=False).samples[0]
    clock.mark("generate")
    trimesh.Trimesh(out[0].astype(np.float32), np.ascontiguousarray(out[1])).export(a.out)
    clock.mark("export")


def triposr(a, clock):
    """Deterministic (no sampling), so --seed does not apply. Mirrors upstream run.py."""
    sys.path.insert(0, a.repo)
    import rembg

    if a.prefetch:
        # one file at a time: huggingface_hub 0.17 marks symlinks as supported before it tests them, so a
        # parallel download made a symlink anyway and failed on Windows without Developer Mode (WinError 1314)
        fetch("stabilityai/TripoSR", max_workers=1)
        fetch("facebook/dino-vitb16", ["*.json"], max_workers=1)  # the encoder's config
        rembg.new_session()  # fetches u2net
        return
    import numpy as np
    import torch
    from PIL import Image
    # torchmcubes needs nvcc + MSVC to build on Windows; TripoSR only calls its marching_cubes
    sys.modules["torchmcubes"] = types.SimpleNamespace(marching_cubes=lambda vol, level: tuple(
        torch.from_numpy(x) for x in mc_xyz(vol.detach().cpu().numpy(), level)))
    from tsr.system import TSR
    from tsr.utils import remove_background, resize_foreground, to_gradio_3d_orientation

    # mapped from the disk, in full precision: TripoSR runs in it
    model, _ = lean(torch, lambda: TSR.from_pretrained("stabilityai/TripoSR", config_name="config.yaml", weight_name="model.ckpt"), half=False)
    model.renderer.set_chunk_size(2048 if tight(a) else 8192)  # smaller chunks = lower peak memory
    model.to(a.device)
    free(torch, a.device)
    clock.mark("load")
    image = resize_foreground(remove_background(Image.open(a.image), rembg.new_session()), 0.85)
    image = np.array(image).astype(np.float32) / 255.0
    image = image[:, :, :3] * image[:, :, 3:4] + (1 - image[:, :, 3:4]) * 0.5
    image = Image.fromarray((image * 255.0).astype(np.uint8))
    clock.mark("background")
    with torch.no_grad():
        codes = model([image], device=a.device)
    mesh = model.extract_mesh(codes, True, resolution=256)[0]
    mesh.fix_normals()  # the stand-in may wind triangles the other way round; a print needs them outward
    mesh = to_gradio_3d_orientation(mesh)  # TripoSR stands on Z, a GLB on Y: read as it came, the model lay on its side
    mesh.apply_transform(np.diag([-1.0, 1.0, -1.0, 1.0]))  # and showed its back to the front: a half turn about y
    clock.mark("generate")
    mesh.export(a.out)
    clock.mark("export")


# Weights and, for models MapAnything only hosts, the wrapper in its code. Those wrappers need CUDA.
PHOTOS = {
    "": ("facebook/map-anything-apache", None),  # the Apache 2.0 weights
    "pi3": ("yyfz233/Pi3", "Pi3Wrapper"),
    "vggt": ("facebook/VGGT-1B", "VGGTWrapper"),
}


def points_of(view):
    """A hosted model's points of one photo, without its least sure third."""
    import torch
    sure = view["conf"][0].float().squeeze(-1)
    return view["pts3d"][0][sure >= torch.quantile(sure, 0.3)].float().cpu().numpy()


def by_wrapper(a, pictures, clock):
    import torch
    from mapanything.utils.image import load_images

    module = importlib.import_module(f"mapanything.models.external.{a.variant}")
    model = getattr(module, PHOTOS[a.variant][1])(name=a.variant, torch_hub_force_reload=False).to(a.device).eval()
    clock.mark("load")
    pictures = load_images(pictures, norm_type="identity")  # these models normalise for themselves
    for view in pictures:
        view["img"] = view["img"].to(a.device)
    with torch.no_grad():
        return [points_of(view) for view in model(pictures)]


def by_mapanything(a, pictures, clock):
    from mapanything.models import MapAnything
    from mapanything.utils.image import load_images

    model = MapAnything.from_pretrained(PHOTOS[""][0]).to(a.device)
    clock.mark("load")
    amp = a.device == "cuda"
    found = model.infer(load_images(pictures), memory_efficient_inference=True, minibatch_size=1, use_amp=amp, amp_dtype="bf16",
                        apply_mask=True, mask_edges=True, apply_confidence_mask=True, confidence_percentile=30)
    return [p["pts3d"][0][p["mask"][0].squeeze(-1) > 0].float().cpu().numpy() for p in found]


def upright(points):
    """MapAnything and the models it hosts place points as the first photo's camera saw them, OpenCV's way:
    y down, z away from the camera. A GLB stands on +y and faces +z, so read as they came, the thing lay
    on its head with its back to the front: a half turn about x."""
    return points * (1.0, -1.0, -1.0)


def photos(a, clock):
    """Several photos of one thing from any sides: a model's points, then a surface through them."""
    sys.path.insert(0, a.repo)
    import numpy as np
    import open3d as o3d
    import trimesh

    if a.prefetch:
        fetch(PHOTOS[a.variant][0])
        return
    pictures = [str(p) for p in (Path(a.image), *views(a))]
    points = (by_wrapper if a.variant else by_mapanything)(a, pictures, clock)
    clock.mark("generate")
    cloud = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(upright(np.concatenate(points).astype(np.float64))))
    span = float(np.linalg.norm(cloud.get_max_bound() - cloud.get_min_bound()))
    cloud = cloud.voxel_down_sample(span / 400)
    cloud, _ = cloud.remove_statistical_outlier(nb_neighbors=24, std_ratio=2.0)
    cloud.estimate_normals(o3d.geometry.KDTreeSearchParamHybrid(radius=span / 60, max_nn=40))
    cloud.orient_normals_consistent_tangent_plane(24)
    mesh, density = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(cloud, depth=9)
    mesh.remove_vertices_by_mask(np.asarray(density) < np.quantile(np.asarray(density), 0.08))  # Poisson's skin over empty space
    mesh.remove_degenerate_triangles()
    clock.mark("surface")
    trimesh.Trimesh(np.asarray(mesh.vertices), np.asarray(mesh.triangles), process=False).export(a.out)
    clock.mark("export")


def tidy(picture):
    """Specks the cut left around the subject become crumbs floating in the model: they go. What stays
    is measured, because a subject cut by the frame or lost in the picture makes a poor model."""
    import numpy as np
    from PIL import Image
    from scipy import ndimage

    pixels = np.array(picture)
    solid = pixels[..., 3] > 127
    groups, count = ndimage.label(solid, structure=np.ones((3, 3)))
    sizes = np.bincount(groups.ravel(), minlength=count + 1)[1:]
    if not count:
        return picture, {"share": 0, "pieces": 0, "edges": 0}
    big = 1 + np.flatnonzero(sizes >= sizes.max() * 0.02)
    kept = np.isin(groups, big)
    pixels[..., 3][~ndimage.binary_dilation(kept, iterations=3)] = 0  # the soft rim around what stays stays
    rim = (kept[0].any(), kept[-1].any(), kept[:, 0].any(), kept[:, -1].any())
    return Image.fromarray(pixels), {"share": round(float(kept.mean()), 4), "pieces": len(big), "edges": int(sum(rim))}


def cut(a, clock):
    """The background off, as a step of its own: Ark does this once for every engine, with BiRefNet
    (MIT). All engines keep the alpha of an RGBA picture."""
    import rembg
    from PIL import Image, ImageOps

    session = rembg.new_session("birefnet-general")  # about 1 GB on first use
    if a.prefetch:
        return
    clock.mark("load")
    # a phone stores which way is up beside the picture, and the models read only the picture
    picture = ImageOps.exif_transpose(Image.open(a.image)).convert("RGB")
    picture, subject = tidy(rembg.remove(picture, session=session).convert("RGBA"))
    picture.save(a.out)
    Path(a.out).with_suffix(".json").write_text(json.dumps(subject))
    clock.mark("cut")


def mc_xyz(vol, level):
    """Marching cubes in torchmcubes' convention: it reads vol[z][y][x] and returns vertices as (x, y, z),
    the array axes reversed. scikit-image returns them in array order."""
    from skimage import measure
    verts, faces, _, _ = measure.marching_cubes(vol, level)
    return verts[:, ::-1].copy(), faces.astype("int64")


def stop_with_parent(getppid=os.getppid, wait=time.sleep, end=os._exit):
    """An engine whose program has gone stops too: nobody would take its result or stop it, and it would hold
    its memory meanwhile. On Windows the job it runs in ends it."""
    parent = getppid()
    while True:
        wait(2)
        if getppid() != parent:
            end(1)
            return


def check(a):
    """Can torch compute on the device at all? Prints what a failure report needs."""
    import torch
    print("torch", torch.__version__, "| built for CUDA", torch.version.cuda,
          "| CUDA available", torch.cuda.is_available())
    if a.device == "cuda":
        print(torch.cuda.get_device_name(0), "| capability", torch.cuda.get_device_capability(0),
              "| kernels for", torch.cuda.get_arch_list())
    # a torch without kernels for this card ("no kernel image is available") fails here
    print("sum on", a.device, (torch.ones(8, device=a.device) * 2).sum().item())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model", choices=["hunyuan", "triposg", "triposr", "cut", "photos"])
    ap.add_argument("--variant", default="", help="which weights of the family")
    ap.add_argument("--repo", required=True)
    ap.add_argument("--check", action="store_true", help="only test that torch works on --device")
    ap.add_argument("--prefetch", action="store_true")
    ap.add_argument("--image")
    ap.add_argument("--out")
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--vram-cap-gb", type=float, default=0)
    ap.add_argument("--offload", choices=["none", "model", "sequential"], default="none")
    a = ap.parse_args()
    if os.name != "nt":
        threading.Thread(target=stop_with_parent, daemon=True).start()
    if a.check:
        return check(a)
    if not a.prefetch:
        cap_vram(a.vram_cap_gb)
    clock = Clock()
    {"hunyuan": hunyuan, "triposg": triposg, "triposr": triposr, "cut": cut, "photos": photos}[a.model](a, clock)
    if a.prefetch:
        return
    import torch
    peak = torch.cuda.max_memory_allocated() // 2**20 if torch.cuda.is_available() else None
    print(json.dumps({"stages": clock.stages, "torch_peak_mb": peak}))


if __name__ == "__main__":
    main()
