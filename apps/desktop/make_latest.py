"""latest.json, which installed copies of Polyzon Maker read to find a new version, and downloads.json, which
the site reads to offer it. publish.py writes and sends them.

A release is one version in both files. A run for one system adds to what is live for that version. A
newer version starts both over, so an update never offers a file of the version before it.
"""

import sys
from pathlib import Path
from urllib.parse import quote

BASE = "https://maker.polyzon.org"

# The end of a file's name: the updater's name for that system (None: updates do not use the file), and how
# the site lists it (None: only updates use it). The site's list keeps this order. A macOS update archive
# comes out of the build with no chip in its name: release-mac.sh gives it one.
FILES = {
    "-setup.exe": ("windows-x86_64", ("windows", "x64", "exe")),
    ".AppImage": ("linux-x86_64", ("linux", "x64", "AppImage")),
    ".deb": ("linux-x86_64-deb", ("linux", "x64", "deb")),
    "_aarch64.dmg": (None, ("macos", "arm64", "dmg")),
    "_x64.dmg": (None, ("macos", "x64", "dmg")),
    "_aarch64.app.tar.gz": ("darwin-aarch64", None),
    "_x64.app.tar.gz": ("darwin-x86_64", None),
}


def public(name: str) -> str:
    """The name a file goes by on the release site: addresses do without spaces."""
    return name.replace(" ", "-")


def role(name: str) -> tuple:
    return next((r for end, r in FILES.items() if name.endswith(end)), (None, None))


def release_files(folder: Path, version: str) -> list[Path]:
    """What of a build folder goes out: signed files with their signatures, and disk images, which have none."""
    found = []
    for f in sorted(folder.iterdir()):
        updater, listed = role(f.name)
        sig = f.with_name(f"{f.name}.sig")
        if f"_{version}_" in f.name and (sig.exists() if updater else listed):
            found += [f, sig] if updater else [f]
    return found


def carried(live: dict | None, version: str) -> dict:
    """What of a live file stays: all of it for the same version, nothing for a newer one."""
    number = lambda v: tuple(map(int, v.split(".")))  # noqa: E731
    if live and number(live["version"]) > number(version):
        sys.exit(f"{live['version']} is live, {version} would take it back.")
    return live if live and live["version"] == version else {}


def merged_latest(live: dict | None, version: str, notes: str, now: str, files: list[Path]) -> dict:
    kept = carried(live, version)
    platforms = {
        role(f.name)[0]: {"signature": f.with_name(f"{f.name}.sig").read_text().strip(), "url": f"{BASE}/{version}/{quote(public(f.name))}"}
        for f in files if role(f.name)[0]
    }
    if not platforms:
        sys.exit("No signed files found: build with TAURI_SIGNING_PRIVATE_KEY set.")
    notes = notes or kept.get("notes")
    if not notes:
        sys.exit(f"{version} is not live yet, so it needs notes.")
    return {
        "version": version,
        "notes": notes,
        "pub_date": kept.get("pub_date", now),
        "platforms": {**kept.get("platforms", {}), **platforms},
    }


def merged_downloads(live: dict | None, latest: dict, files: list[Path]) -> dict:
    version = latest["version"]
    listed = {(f["os"], f["arch"], f["kind"]): f for f in carried(live, version).get("files", [])}
    for f in files:
        kind = role(f.name)[1]
        if kind:
            listed[kind] = dict(zip(("os", "arch", "kind"), kind)) | {"url": f"/{version}/{quote(public(f.name))}", "size": f.stat().st_size}
    return {
        "version": version,
        "date": latest["pub_date"][:10],
        "files": [listed[kind] for _, kind in FILES.values() if kind in listed],
    }
