"""What each generation took on this computer, from Polyzon Maker's own job files: model, device, detail,
memory-ladder step, the most main memory the engine held (on a Mac graphics memory too), time, and how it
ended. For the catalog's memory numbers, which are written in only after a run like this.

    python3 peaks.py                # the jobs of the last 24 hours
    python3 peaks.py --hours 0      # all of them
    python3 peaks.py --jobs DIR     # another jobs folder

Reads only; standard library only."""

import argparse
import json
import sys
import time
from pathlib import Path


def jobs_dir():
    """Where Polyzon Maker keeps its jobs on this system (Tauri's local data folder)."""
    home = Path.home()
    if sys.platform == "win32":
        import os
        return Path(os.environ.get("LOCALAPPDATA", home / "AppData" / "Local")) / "org.polyzon.maker" / "jobs"
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "org.polyzon.maker" / "jobs"
    return home / ".local" / "share" / "org.polyzon.maker" / "jobs"


def rows(folder, since=0):
    """One row per job that ran, oldest first."""
    found = []
    for path in folder.glob("*/job.json"):
        try:
            job = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            continue
        if not job.get("started") or job["started"] < since:
            continue
        found.append({
            "when": time.strftime("%m-%d %H:%M", time.localtime(job["started"])),
            "model": job.get("model", ""),
            "device": job.get("device", ""),
            "detail": job.get("preset", "") or "-",
            "step": job.get("offload", "") or "-",
            "peak_gb": round(job.get("peak_mb", 0) / 1024, 1) if job.get("peak_mb") else None,
            "seconds": round(job.get("seconds", 0)),
            "ended": job.get("error") or job.get("state", ""),
            "notes": ",".join(job.get("notes", [])),
            "started": job["started"],
        })
    return sorted(found, key=lambda r: r["started"])


def table(found):
    head = ["when", "model", "device", "detail", "step", "peak_gb", "seconds", "ended", "notes"]
    lines = [[str(r[k]) if r[k] is not None else "?" for k in head] for r in found]
    widths = [max(len(h), *(len(line[i]) for line in lines)) for i, h in enumerate(head)] if lines else [len(h) for h in head]
    say = lambda cells: "  ".join(c.ljust(w) for c, w in zip(cells, widths)).rstrip()
    return "\n".join([say(head), *(say(line) for line in lines)])


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--jobs", type=Path, default=jobs_dir())
    ap.add_argument("--hours", type=float, default=24, help="only jobs started this many hours back; 0 for all")
    a = ap.parse_args()
    if not a.jobs.is_dir():
        sys.exit(f"no jobs folder at {a.jobs}")
    found = rows(a.jobs, time.time() - a.hours * 3600 if a.hours else 0)
    print(table(found) if found else "no jobs in that time")
    print(f"\n{len(found)} jobs, {a.jobs}")


if __name__ == "__main__":
    main()
