"""Lathe: a vase turned from a picture's silhouette. Each height of the thing in the picture gives the vase its
width there. An example of a model a plugin brings (PLUGINS.md): it uses nothing but Python itself, so the app
downloads nothing for it, and it runs on any computer in seconds.

    python lathe.py --weights DIR --check --device cpu
    python lathe.py --weights DIR --image IN.png --out OUT.glb --device cpu --seed N [--sides 96]

It prints {"stage": "generate"} and {"stage": "export"} as it goes, and the app shows them.
"""

import argparse
import json
import math
import struct
import sys
import zlib

HEIGHT_MM = 100
LEAST_MM = 2  # the thinnest the vase gets, so that it stands and prints
ROWS = 120


def picture(path):
    """Whether each point of a PNG is the thing and not its background: not white and not see-through.
    8-bit grey, grey with alpha, RGB or RGBA."""
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        sys.exit("cannot identify image: not a PNG")
    at, parts, head = 8, [], None
    while at < len(data):
        size, kind = struct.unpack(">I4s", data[at : at + 8])
        body = data[at + 8 : at + 8 + size]
        at += 12 + size
        if kind == b"IHDR":
            head = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            parts.append(body)
        elif kind == b"IEND":
            break
    width, height, depth, colour, _, _, interlaced = head
    step = {0: 1, 2: 3, 4: 2, 6: 4}.get(colour)
    if depth != 8 or step is None or interlaced:
        sys.exit("unsupported image: 8-bit grey, RGB or RGBA, not interlaced")
    raw, stride = zlib.decompress(b"".join(parts)), width * step
    rows, above = [], bytearray(stride)
    for y in range(height):
        start = y * (stride + 1)
        kind, line = raw[start], bytearray(raw[start + 1 : start + 1 + stride])
        for i in range(stride):
            left = line[i - step] if i >= step else 0
            up, corner = above[i], above[i - step] if i >= step else 0
            if kind == 1:
                line[i] = (line[i] + left) & 255
            elif kind == 2:
                line[i] = (line[i] + up) & 255
            elif kind == 3:
                line[i] = (line[i] + (left + up) // 2) & 255
            elif kind == 4:
                guess = left + up - corner
                line[i] = (line[i] + min((abs(guess - left), 0, left), (abs(guess - up), 1, up), (abs(guess - corner), 2, corner))[2]) & 255
        rows.append(line)
        above = line

    def thing(x, y):
        px = rows[y][x * step : (x + 1) * step]
        light = px[0] if step < 3 else (px[0] + px[1] + px[2]) / 3
        seen = px[-1] if step in (2, 4) else 255
        return seen > 128 and light < 235

    return width, height, thing


def profile(width, height, thing):
    """The vase's radius in mm from its top down: half the thing's width at each of ROWS heights."""
    found = [y for y in range(0, height, max(1, height // 400)) if any(thing(x, y) for x in range(0, width, 2))]
    if not found:
        sys.exit("cannot identify image: nothing but background")
    top, bottom = found[0], found[-1]
    mm = HEIGHT_MM / max(1, bottom - top)
    radii = []
    for r in range(ROWS + 1):
        y = top + (bottom - top) * r // ROWS
        xs = [x for x in range(width) if thing(x, y)]
        radii.append(max(LEAST_MM, (xs[-1] - xs[0]) / 2 * mm if xs else 0))
    # one jagged row is a picture's noise, not a shape
    return [sum(radii[max(0, i - 1) : i + 2]) / len(radii[max(0, i - 1) : i + 2]) for i in range(len(radii))]


def lathe(radii, sides):
    """One closed solid, rings from the top down and a flat cap at each end, in metres with Y up, as glTF has it."""
    points, faces = [], []
    for r, radius in enumerate(radii):
        y = HEIGHT_MM * (1 - r / (len(radii) - 1)) / 1000
        for s in range(sides):
            turn = 2 * math.pi * s / sides
            points += [radius * math.cos(turn) / 1000, y, radius * math.sin(turn) / 1000]
    ring = lambda r, s: r * sides + s % sides
    for r in range(len(radii) - 1):
        for s in range(sides):
            faces += [ring(r, s), ring(r, s + 1), ring(r + 1, s), ring(r, s + 1), ring(r + 1, s + 1), ring(r + 1, s)]
    top, bottom = len(points) // 3, len(points) // 3 + 1
    points += [0.0, HEIGHT_MM / 1000, 0.0, 0.0, 0.0, 0.0]
    last = len(radii) - 1
    for s in range(sides):
        faces += [top, ring(0, s + 1), ring(0, s), bottom, ring(last, s), ring(last, s + 1)]
    return points, faces


def glb(points, faces):
    where = struct.pack(f"<{len(points)}f", *points)
    which = struct.pack(f"<{len(faces)}I", *faces)
    box = [[f(points[k::3]) for k in range(3)] for f in (min, max)]
    doc = {
        "asset": {"version": "2.0", "generator": "Lathe, a Polyzon Maker plugin"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
        "buffers": [{"byteLength": len(where) + len(which)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(where), "target": 34962},
            {"buffer": 0, "byteOffset": len(where), "byteLength": len(which), "target": 34963},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(points) // 3, "type": "VEC3", "min": box[0], "max": box[1]},
            {"bufferView": 1, "componentType": 5125, "count": len(faces), "type": "SCALAR"},
        ],
    }
    text = json.dumps(doc).encode()
    text += b" " * (-len(text) % 4)
    body = where + which
    total = 12 + 8 + len(text) + 8 + len(body)
    return struct.pack("<III", 0x46546C67, 2, total) + struct.pack("<I4s", len(text), b"JSON") + text + struct.pack("<I4s", len(body), b"BIN\0") + body


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True, help="this model has none")
    ap.add_argument("--code", help="nor code of its own")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--image")
    ap.add_argument("--out")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--seed", type=int, default=0, help="a vase comes out the same each time")
    ap.add_argument("--sides", type=int, default=96)
    a = ap.parse_args()
    if a.check:
        print(json.dumps({"ok": True, "python": sys.version.split()[0]}))
        return
    width, height, thing = picture(a.image)
    print(json.dumps({"stage": "generate"}), flush=True)
    points, faces = lathe(profile(width, height, thing), max(12, min(a.sides, 360)))
    print(json.dumps({"stage": "export"}), flush=True)
    with open(a.out, "wb") as out:
        out.write(glb(points, faces))
    print(json.dumps({"points": len(points) // 3, "triangles": len(faces) // 3}))


if __name__ == "__main__":
    main()
