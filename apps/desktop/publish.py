"""Publishes a release to maker.polyzon.org: the files, then downloads.json, then latest.json, so that nobody
sees a version before its files. A run for one system adds to what is live for that version.

    python publish.py 0.2.0 notes.md release-windows release-linux

The notes are text or a file: `## Heading` lines and `- item` lines under them. For a version already live
they can be "", and the live notes stay. The two json files land in the current folder. MAKER_UPLOAD_HOST is
the server's user@host and MAKER_UPLOAD_KEY the upload key's file: the maintainers keep both. The key can only
hand files to the server's receiving script, and it is not the signing key: that one never leaves the build
machine.
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen

from make_latest import BASE, merged_downloads, merged_latest, public, release_files

HOST = os.environ.get("MAKER_UPLOAD_HOST", "")
KEY = os.environ.get("MAKER_UPLOAD_KEY", "")


def send(what: str, file: Path) -> None:
    with file.open("rb") as stream:
        order = f"{what} {file.stat().st_size}"
        subprocess.run(["ssh", "-i", KEY, "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=accept-new", HOST, order], stdin=stream, check=True)
    print("sent", what)


def live(name: str) -> dict | None:
    """A file as published now. Only a 404 means there is none: any other failure stops the run, or it would
    wipe what other systems published."""
    try:
        with urlopen(f"{BASE}/{name}", timeout=30) as reply:
            return json.load(reply)
    except HTTPError as error:
        if error.code == 404:
            return None
        raise


def main(version: str, notes: str, *folders: str) -> None:
    if not HOST or not KEY:
        sys.exit("Set MAKER_UPLOAD_HOST and MAKER_UPLOAD_KEY first.")
    files =[f for folder in folders for f in release_files(Path(folder), version)]
    text = Path(notes).read_text(encoding="utf-8") if Path(notes).is_file() else notes
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    latest = merged_latest(live("latest.json"), version, text, now, files)
    downloads = merged_downloads(live("downloads.json"), latest, files)
    Path("latest.json").write_text(json.dumps(latest, indent=2) + "\n")
    Path("downloads.json").write_text(json.dumps(downloads, indent=2) + "\n")
    print("latest.json:", ", ".join(latest["platforms"]))
    print("downloads.json:", ", ".join(f"{f['os']} {f['arch']} {f['kind']}" for f in downloads["files"]))

    for f in files:
        send(f"{version} {public(f.name)}", f)
    try:
        send("downloads.json", Path("downloads.json"))
    except subprocess.CalledProcessError:  # the site's list can lag behind, an update should not wait for it
        refused = True
    else:
        refused = False
    send("latest.json", Path("latest.json"))
    if refused:
        sys.exit("downloads.json was refused: the update is out, the site's list is not. Run this again.")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
