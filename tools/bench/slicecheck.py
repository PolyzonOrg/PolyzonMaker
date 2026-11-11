"""One print file in PrusaSlicer: what a slicer makes of the STL and 3MF mesh-kit wrote (TZ §21.2).

    python slicecheck.py PRUSA_CONSOLE MODEL.stl OUT.json

Reads both files with --info (the slicer's own count of open edges and parts), slices the STL at
0.2 mm and keeps the numbers, not the G-code. Prints one JSON line {"stages": ..., "slicer": ...}
for spike.py and writes it to OUT.json; exits 1 when the slicer refuses the model.
"""

import json
import re
import subprocess
import sys
import time
from pathlib import Path

# The default printer on a bed as big as the one mesh-kit checks against
SLICE = ["--export-gcode", "--bed-shape", "0x0,256x0,256x256,0x256", "--layer-height", "0.2",
         "--first-layer-height", "0.2"]
SETTINGS_TAIL = 2**18  # the numbers sit just before the settings at the end of a G-code file


def read(console: str, model: Path) -> dict:
    out = subprocess.run([console, "--info", str(model)], capture_output=True, text=True, errors="replace")
    return dict(re.findall(r"^(\w+) = +(.+?)\s*$", out.stdout, re.M))


def gcode_facts(gcode: Path) -> dict:
    with open(gcode, "rb") as f:
        f.seek(max(0, gcode.stat().st_size - SETTINGS_TAIL))
        tail = f.read().decode("utf-8", "replace")
    return dict(re.findall(r"^; (filament used \[\w+\]|estimated printing time \(normal mode\)) = (.+?)\s*$", tail, re.M))


def main(console: str, stl: Path, out: Path) -> int:
    gcode = out.with_suffix(".gcode")
    t = time.perf_counter()
    found = {f: read(console, stl.with_suffix(f".{f}")) for f in ("stl", "3mf") if stl.with_suffix(f".{f}").exists()}
    stages = {"read": round(time.perf_counter() - t, 1)}
    t = time.perf_counter()
    done = subprocess.run([console, *SLICE, "--output", str(gcode), str(stl)])
    stages["slice"] = round(time.perf_counter() - t, 1)
    found["sliced"] = done.returncode == 0 and gcode.exists()
    if found["sliced"]:
        found.update(gcode_facts(gcode))
    gcode.unlink(missing_ok=True)
    line = json.dumps({"stages": stages, "slicer": found}, ensure_ascii=False)
    if found["sliced"]:
        out.write_text(line, encoding="utf-8")
    print(line, flush=True)
    return 0 if found["sliced"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])))
