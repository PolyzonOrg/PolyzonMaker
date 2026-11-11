"""What a release run sends and what it leaves live, with the server stood in for:

    python -B test_publish.py
"""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError, URLError

import publish

WINDOWS = {"signature": "windows signature", "url": "https://maker.polyzon.org/0.1.1/Polyzon-Maker_0.1.1_x64-setup.exe"}
LIVE_LATEST = {
    "version": "0.1.1",
    "notes": "live notes",
    "pub_date": "2026-11-06T19:12:10Z",
    "platforms": {"windows-x86_64": WINDOWS},
}
WINDOWS_FILE = {"os": "windows", "arch": "x64", "kind": "exe", "url": "/0.1.1/Polyzon-Maker_0.1.1_x64-setup.exe", "size": 6144888}
LIVE_DOWNLOADS = {"version": "0.1.1", "date": "2026-11-06", "files": [WINDOWS_FILE]}


def built(folder: Path, *names: str) -> str:
    """A release folder: every name a file, and `signed:` before a name adds its .sig."""
    folder.mkdir()
    for name in names:
        name, signed = name.removeprefix("signed:"), name.startswith("signed:")
        (folder / name).write_bytes(b"x" * 100)
        if signed:
            (folder / f"{name}.sig").write_text(f"signature of {name}\n")
    return str(folder)


class Release(unittest.TestCase):
    def setUp(self):
        room = tempfile.TemporaryDirectory()
        self.addCleanup(room.cleanup)
        self.addCleanup(os.chdir, os.getcwd())
        os.chdir(room.name)
        self.room = Path(room.name)
        self.orders, self.refused = [], []
        self.linux = str(self.room / "linux")
        for name, value in (("HOST", "maker@example.test"), ("KEY", "upload.key")):
            patcher = mock.patch.object(publish, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_without_the_server_and_its_key_nothing_is_sent(self):
        built(self.room / "linux", "signed:Polyzon Maker_0.1.1_amd64.deb")
        with mock.patch.object(publish, "HOST", ""), self.assertRaises(SystemExit):
            self.publish("0.1.1", "", self.linux)
        self.assertEqual(self.orders, [])
        self.assertFalse(Path("latest.json").exists())

    def ssh(self, command, stdin, check):
        order = command[-1]
        self.orders.append(order)
        if order.split()[0] in self.refused:
            raise subprocess.CalledProcessError(2, command)

    def publish(self, version, notes, *folders, latest=LIVE_LATEST, downloads=LIVE_DOWNLOADS):
        live = {"latest.json": latest, "downloads.json": downloads}
        with mock.patch.object(publish, "live", live.get), mock.patch.object(publish.subprocess, "run", self.ssh):
            publish.main(version, notes, *folders)

    def written(self, name):
        return json.loads(Path(name).read_text())

    def test_a_second_system_joins_what_is_live(self):
        built(self.room / "linux", "signed:Polyzon Maker_0.1.1_amd64.AppImage", "signed:Polyzon Maker_0.1.1_amd64.deb")
        self.publish("0.1.1", "", self.linux)
        latest, downloads = self.written("latest.json"), self.written("downloads.json")
        self.assertEqual(latest["version"], "0.1.1")
        self.assertEqual(latest["notes"], "live notes")
        self.assertEqual(latest["pub_date"], LIVE_LATEST["pub_date"])
        self.assertEqual(latest["platforms"]["windows-x86_64"], WINDOWS)
        self.assertEqual(latest["platforms"]["linux-x86_64"]["url"], "https://maker.polyzon.org/0.1.1/Polyzon-Maker_0.1.1_amd64.AppImage")
        self.assertEqual(latest["platforms"]["linux-x86_64"]["signature"], "signature of Polyzon Maker_0.1.1_amd64.AppImage")
        self.assertIn("linux-x86_64-deb", latest["platforms"])
        self.assertEqual(downloads["date"], "2026-11-06")
        self.assertEqual(downloads["files"], [
            WINDOWS_FILE,
            {"os": "linux", "arch": "x64", "kind": "AppImage", "url": "/0.1.1/Polyzon-Maker_0.1.1_amd64.AppImage", "size": 100},
            {"os": "linux", "arch": "x64", "kind": "deb", "url": "/0.1.1/Polyzon-Maker_0.1.1_amd64.deb", "size": 100},
        ])

    def test_files_go_first_then_downloads_then_latest(self):
        built(self.room / "linux", "signed:Polyzon Maker_0.1.1_amd64.deb")
        self.publish("0.1.1", "", self.linux)
        latest_size = Path("latest.json").stat().st_size
        downloads_size = Path("downloads.json").stat().st_size
        self.assertEqual(self.orders, [
            "0.1.1 Polyzon-Maker_0.1.1_amd64.deb 100",
            f"0.1.1 Polyzon-Maker_0.1.1_amd64.deb.sig {len('signature of Polyzon Maker_0.1.1_amd64.deb') + len(os.linesep)}",
            f"downloads.json {downloads_size}",
            f"latest.json {latest_size}",
        ])

    def test_both_macs_go_out_without_a_signature_on_the_disk_image(self):
        arm = built(self.room / "arm", "Polyzon Maker_0.1.1_aarch64.dmg", "signed:Polyzon Maker_0.1.1_aarch64.app.tar.gz")
        intel = built(self.room / "intel", "Polyzon Maker_0.1.1_x64.dmg", "signed:Polyzon Maker_0.1.1_x64.app.tar.gz")
        self.publish("0.1.1", "", arm, intel)
        platforms = self.written("latest.json")["platforms"]
        self.assertEqual(platforms["darwin-aarch64"]["url"], "https://maker.polyzon.org/0.1.1/Polyzon-Maker_0.1.1_aarch64.app.tar.gz")
        self.assertEqual(platforms["darwin-x86_64"]["url"], "https://maker.polyzon.org/0.1.1/Polyzon-Maker_0.1.1_x64.app.tar.gz")
        self.assertIn("0.1.1 Polyzon-Maker_0.1.1_aarch64.dmg 100", self.orders)
        self.assertIn("0.1.1 Polyzon-Maker_0.1.1_x64.dmg 100", self.orders)
        files = self.written("downloads.json")["files"]
        self.assertEqual([(f["os"], f["arch"], f["kind"]) for f in files],
                         [("windows", "x64", "exe"), ("macos", "arm64", "dmg"), ("macos", "x64", "dmg")])

    def test_the_same_run_twice_leaves_the_same_files(self):
        built(self.room / "linux", "signed:Polyzon Maker_0.1.1_amd64.deb")
        self.publish("0.1.1", "", self.linux)
        first = self.written("latest.json"), self.written("downloads.json")
        self.publish("0.1.1", "", self.linux, latest=first[0], downloads=first[1])
        self.assertEqual((self.written("latest.json"), self.written("downloads.json")), first)

    def test_a_new_version_starts_both_lists_over(self):
        built(self.room / "linux", "signed:Polyzon Maker_0.2.0_amd64.deb")
        self.publish("0.2.0", "what is new", self.linux)
        latest, downloads = self.written("latest.json"), self.written("downloads.json")
        self.assertEqual((latest["version"], latest["notes"]), ("0.2.0", "what is new"))
        self.assertEqual(list(latest["platforms"]), ["linux-x86_64-deb"])
        self.assertNotEqual(latest["pub_date"], LIVE_LATEST["pub_date"])
        self.assertEqual(downloads["version"], "0.2.0")
        self.assertEqual(downloads["date"], latest["pub_date"][:10])
        self.assertEqual([f["kind"] for f in downloads["files"]], ["deb"])

    def test_a_new_version_needs_notes(self):
        built(self.room / "linux", "signed:Polyzon Maker_0.2.0_amd64.deb")
        with self.assertRaises(SystemExit):
            self.publish("0.2.0", "", self.linux)
        self.assertEqual(self.orders, [])

    def test_an_older_version_never_replaces_a_newer_one(self):
        built(self.room / "linux", "signed:Polyzon Maker_0.1.0_amd64.deb")
        with self.assertRaises(SystemExit):
            self.publish("0.1.0", "old", self.linux)
        self.assertEqual(self.orders, [])

    def test_0_1_10_is_newer_than_0_1_9(self):
        built(self.room / "linux", "signed:Polyzon Maker_0.1.10_amd64.deb")
        self.publish("0.1.10", "ten", self.linux, latest=LIVE_LATEST | {"version": "0.1.9"}, downloads=None)
        self.assertEqual(self.written("latest.json")["version"], "0.1.10")

    def test_files_of_another_version_in_the_folder_stay_home(self):
        built(self.room / "linux", "signed:Polyzon Maker_0.1.0_amd64.deb", "signed:Polyzon Maker_0.1.1_amd64.deb")
        self.publish("0.1.1", "", self.linux)
        self.assertFalse([o for o in self.orders if "0.1.0" in o])
        self.assertIn("0.1.1", self.written("latest.json")["platforms"]["linux-x86_64-deb"]["url"])

    def test_nothing_signed_sends_nothing(self):
        built(self.room / "linux", "Polyzon Maker_0.1.1_amd64.deb")
        with self.assertRaises(SystemExit):
            self.publish("0.1.1", "", self.linux)
        self.assertEqual(self.orders, [])

    def test_a_first_release_has_nothing_live(self):
        built(self.room / "linux", "signed:Polyzon Maker_0.1.1_amd64.deb")
        self.publish("0.1.1", "first", self.linux, latest=None, downloads=None)
        self.assertEqual(list(self.written("latest.json")["platforms"]), ["linux-x86_64-deb"])
        self.assertEqual(len(self.written("downloads.json")["files"]), 1)

    def test_a_refused_downloads_list_does_not_hold_back_the_update(self):
        built(self.room / "linux", "signed:Polyzon Maker_0.1.1_amd64.deb")
        self.refused = ["downloads.json"]
        with self.assertRaises(SystemExit) as stop:
            self.publish("0.1.1", "", self.linux)
        self.assertIn("downloads.json", str(stop.exception))
        self.assertEqual(self.orders[-1].split()[0], "latest.json")

    def test_a_refused_file_stops_before_any_list_goes_out(self):
        built(self.room / "linux", "signed:Polyzon Maker_0.1.1_amd64.deb")
        self.refused = ["0.1.1"]
        with self.assertRaises(subprocess.CalledProcessError):
            self.publish("0.1.1", "", self.linux)
        self.assertEqual(len(self.orders), 1)

    def test_a_failed_look_at_the_live_files_stops_the_run(self):
        """Taking it for "nothing is live" would wipe the other systems."""
        built(self.room / "linux", "signed:Polyzon Maker_0.1.1_amd64.deb")
        broken = HTTPError("https://maker.polyzon.org/latest.json", 502, "Bad Gateway", None, None)
        for failure in broken, URLError("no route"):
            with mock.patch.object(publish, "urlopen", side_effect=failure), mock.patch.object(publish.subprocess, "run", self.ssh):
                with self.assertRaises(OSError):
                    publish.main("0.1.1", "", self.linux)
        self.assertEqual(self.orders, [])

    def test_only_a_404_means_nothing_is_live(self):
        missing = HTTPError("https://maker.polyzon.org/downloads.json", 404, "Not Found", None, None)
        with mock.patch.object(publish, "urlopen", side_effect=missing):
            self.assertIsNone(publish.live("downloads.json"))


if __name__ == "__main__":
    unittest.main()
