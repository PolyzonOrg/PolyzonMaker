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
import importlib
import json
import os
import sys
import threading
import time
import types
from pathlib import Path


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
        from huggingface_hub import snapshot_download
        if newer:
            snapshot_download(repo_id, allow_patterns=[f"{sub}/*"], local_dir=Path(os.environ["HY3DGEN_MODELS"]) / repo_id)
        else:
            # enable_flashvdm below swaps in the turbo VAE from its own subfolder
            snapshot_download(repo_id, allow_patterns=[f"{sub}/*"])
            snapshot_download(vae_repo, allow_patterns=[f"{vae}/*"])
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

    weights, rmbg_dir = snapshot_download("VAST-AI/TripoSG"), snapshot_download("briaai/RMBG-1.4")
    if a.prefetch:
        return
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
    from huggingface_hub import snapshot_download

    if a.prefetch:
        # one file at a time: huggingface_hub 0.17 marks symlinks as supported before it tests them, so a
        # parallel download made a symlink anyway and failed on Windows without Developer Mode (WinError 1314)
        snapshot_download("stabilityai/TripoSR", max_workers=1)
        snapshot_download("facebook/dino-vitb16", allow_patterns=["*.json"], max_workers=1)  # the encoder's config
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
    from huggingface_hub import snapshot_download

    if a.prefetch:
        snapshot_download(PHOTOS[a.variant][0])
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
