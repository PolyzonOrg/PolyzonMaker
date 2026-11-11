"""Checks every generated mesh, draws a preview of each and writes summary.md next to results.jsonl.

    uv run --python 3.12 --with trimesh --with scipy --with networkx --with matplotlib
           --with fast-simplification analyze.py RESULTS_DIR

"watertight" is measured after welding duplicate vertices (GLB exports split them along
normals and UV seams), so it shows whether the raw model is printable before Ark repairs it.
previews/ holds the input picture next to the model from the front, the side and above: enough
to judge a result without sending the meshes; print-*.png are the STL files after mesh-kit.
"""

import json
import sys
from pathlib import Path

PREVIEW_FACES = 40_000  # decimated to this for drawing
PREVIEW_MAX = 5_000_000  # raw decoder meshes above this are only counted


def print_route(model: str) -> bool:
    """The models Ark would hand to a slicer: each engine on its BiRefNet cut-out at seed 42, TripoSR on its own."""
    if model.startswith("triposr-") and "-full-" in model:
        return "-ram" not in model
    return "-cut-birefnet-" in model and "-q8" not in model and "-seed" not in model


def mesh_stats(path: Path) -> dict:
    import trimesh
    m = trimesh.load(path, force="mesh")
    m.merge_vertices(merge_tex=True, merge_norm=True)  # UV seams and hard edges are not holes
    return {"faces": len(m.faces), "watertight": bool(m.is_watertight), "bodies": int(m.body_count)}


def preview(mesh_path: Path, picture: Path | None, png: Path, z_up: bool = False) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np
    import trimesh
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    m = trimesh.load(mesh_path, force="mesh")
    if len(m.faces) > PREVIEW_FACES:
        m = m.simplify_quadric_decimation(face_count=PREVIEW_FACES)
    v, n = m.vertices, m.face_normals
    if not z_up:  # glTF is Y up with the front towards +Z; matplotlib is Z up
        flip = np.array([1, -1, 1])
        v, n = v[:, [0, 2, 1]] * flip, n[:, [0, 2, 1]] * flip
    mid, half = (v.max(0) + v.min(0)) / 2, (v.max(0) - v.min(0)).max() / 2
    fig = plt.figure(figsize=(8, 2), dpi=100)
    if picture and picture.exists():
        ax = fig.add_subplot(1, 4, 1)
        ax.imshow(plt.imread(picture))
        ax.set_axis_off()
    for k, (elev, azim) in enumerate([(5, -90), (5, 0), (35, -50)]):  # front, side, from above
        ax = fig.add_subplot(1, 4, k + 2, projection="3d")
        e, a = np.radians(elev), np.radians(azim)
        eye = np.array([np.cos(e) * np.cos(a), np.cos(e) * np.sin(a), np.sin(e)])
        shade = 0.2 + 0.75 * np.abs(n @ eye)  # a light at the camera; abs: some engines wind faces inward
        ax.add_collection3d(Poly3DCollection(v[m.faces], facecolors=plt.cm.gray(shade), edgecolor="none"))
        for set_lim, c in zip((ax.set_xlim, ax.set_ylim, ax.set_zlim), mid):
            set_lim(c - half, c + half)
        ax.set_box_aspect((1, 1, 1))
        ax.view_init(elev, azim)
        ax.set_axis_off()
    fig.subplots_adjust(0, 0, 1, 1, 0, 0)
    png.parent.mkdir(exist_ok=True)
    fig.savefig(png, facecolor="white")
    plt.close(fig)


def thumbnail(picture: Path, png: Path) -> None:
    from PIL import Image
    png.parent.mkdir(exist_ok=True)
    with Image.open(picture) as im:
        im.thumbnail((256, 256))
        im.save(png)


def cell(v) -> str:
    return "—" if v is None else str(v)


def summary(hw: dict, records: list[dict]) -> str:
    gpu = hw.get("nvidia") or {}
    lines = [
        f"# Spike results — {gpu.get('name', 'no NVIDIA GPU')}, {hw['ram_mb'] // 1024} GB RAM, {hw['os']}",
        "",
        "| engine | tier | image | ok | total s | generate s | VRAM MB | RAM MB | commit MB | faces | watertight | bodies |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in records:
        if r["engine"] in ("meshkit", "slicer"):
            continue
        stages = r.get("stages") or {}
        mesh = r.get("mesh") or {}
        lines.append("| " + " | ".join(cell(x) for x in [
            r["engine"], r["tier"], r["image"], "yes" if r["ok"] else f"NO ({r.get('exit')})",
            r.get("seconds"), stages.get("generate"), r.get("torch_peak_mb") or r.get("peak_vram_mb"),
            r.get("peak_ram_mb"), r.get("peak_commit_mb"), mesh.get("faces"), mesh.get("watertight"), mesh.get("bodies"),
        ]) + " |")
    kit = [r for r in records if r["engine"] == "meshkit"]
    if kit:
        lines += ["", f"## mesh-kit: each model to a print ({kit[0]['tier']})", "",
                  "| model | size mm | before | parts | holes | repair | remesh voxel, max dev. mm | simplify faces, how, max dev. mm "
                  "| STL + 3MF read back | printable | largest plane | s |",
                  "|---|---|---|---|---|---|---|---|---|---|---|---|"]
        for r in kit:
            k = r.get("meshkit") or {}
            b, rep, rem, sim = (k.get(x) or {} for x in ("before", "repair", "remesh", "simplify"))
            lines.append("| " + " | ".join(cell(x) for x in [
                r["image"], "×".join(str(round(v)) for v in rep.get("size") or []), b.get("status"), b.get("components"),
                b.get("holes"),
                rep.get("error") or rep.get("status"),
                rem and (rem.get("error") or f"{rem.get('voxel')}, {((rem.get('changes') or {}).get('deviation') or {}).get('max')}"),
                sim and (sim.get("error") or f"{sim.get('before')} → {sim.get('after')}, {sim.get('method')}, {(sim.get('deviation') or {}).get('max')}"),
                k.get("files") and all(f["ready"] for f in k["files"]),
                k.get("printable") if r["ok"] else f"NO ({r.get('exit')})", b.get("flatShare"), r.get("seconds"),
            ]) + " |")
    sliced = [r for r in records if r["engine"] == "slicer"]
    if sliced:
        lines += ["", f"## PrusaSlicer: the print files ({sliced[0]['tier']})", "",
                  "| STL | manifold | open edges | parts | 3MF manifold | sliced | filament mm | print time | s |",
                  "|---|---|---|---|---|---|---|---|---|"]
        for r in sliced:
            s = r.get("slicer") or {}
            stl, three = s.get("stl") or {}, s.get("3mf") or {}
            lines.append("| " + " | ".join(cell(x) for x in [
                r["image"], stl.get("manifold"), stl.get("open_edges"), stl.get("number_of_parts"), three.get("manifold"),
                s.get("sliced") if r["ok"] else f"NO ({r.get('exit')})", s.get("filament used [mm]"),
                s.get("estimated printing time (normal mode)"), r.get("seconds"),
            ]) + " |")
    return "\n".join(lines) + "\n"


def image_facts(images: Path) -> dict:
    """What each input really is: a .jpg may be anything, and alpha decides how an engine cuts it."""
    from PIL import Image

    facts = {}
    for p in sorted(images.iterdir()):
        try:
            with Image.open(p) as im:
                facts[p.name] = {"format": im.format, "mode": im.mode, "size": im.size,
                                 "alpha": im.convert("RGBA").getextrema()[3]}
        except OSError as e:
            facts[p.name] = str(e)
    return facts


def main(results: Path) -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # the Windows default cannot print the tables' arrows
    records = [json.loads(ln) for ln in (results / "results.jsonl").read_text(encoding="utf-8").splitlines() if ln]
    images = results.parent.parent / "images"
    if images.exists():
        (results / "images.json").write_text(json.dumps(image_facts(images), indent=1, ensure_ascii=False), encoding="utf-8")
    for r in records:
        out = results / "outputs" / (r.get("out") or "")
        if r["engine"] == "meshkit" and r["ok"] and print_route(r["image"]):
            try:  # always drawn again: a retry writes these files anew
                preview(results / "outputs" / "print" / r["out"], None,
                        results / "previews" / f"print-{Path(r['out']).stem}.png", z_up=True)
            except Exception as e:
                print(f"{r['out']}: {e}")
        if not r["ok"] or r["engine"] in ("meshkit", "slicer"):
            continue
        png = results / "previews" / f"{out.stem}.png"
        try:  # a broken file is itself a finding
            if out.suffix == ".png":  # a text-to-image result: the picture itself
                png.exists() or thumbnail(out, png)
                continue
            r["mesh"] = mesh_stats(out)
            if not png.exists() and r["mesh"]["faces"] <= PREVIEW_MAX:
                src = images / r["image"] if (images / r["image"]).exists() else results / "outputs" / r["image"]
                preview(out, src, png)
        except Exception as e:
            r["mesh"] = {**r.get("mesh", {}), "faces": r.get("mesh", {}).get("faces", f"unreadable: {e}"[:80])}
            print(f"{out.name}: {e}")
    hw = json.loads((results / "hardware.json").read_text(encoding="utf-8"))
    (results / "summary.md").write_text(summary(hw, records), encoding="utf-8")
    print(summary(hw, records))


if __name__ == "__main__":
    main(Path(sys.argv[1]))
