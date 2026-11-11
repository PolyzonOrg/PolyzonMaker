"""An agent's MCP session against the built Polyzon Maker on this Mac, as Claude Code, Codex or Kimi run one:
the server is `polyzon-maker --mcp` on pipes. First with the app closed (the server has to start it), then with it
open, through the calls agents make most. Any crash report of the app is printed at the end.

    python3 mcp-check.py "<path to Polyzon Maker.app>"

Exit 1 when a call got no answer, the server died, or the app crashed. Standard library only.
"""

import glob
import json
import os
import queue
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

APP = sys.argv[1]
EXE = os.path.join(APP, "Contents", "MacOS", "polyzon-maker")
HOME = Path.home()
CONF = HOME / "Library/Application Support/org.polyzon.maker"
TOKEN = "ci-" + os.urandom(8).hex()
REPORTS = HOME / "Library/Logs/DiagnosticReports"
problems = []


def setup():
    CONF.mkdir(parents=True, exist_ok=True)
    settings = {"onboarded": True, "language": "en", "analytics": False, "consent": 2, "gentle": True,
                "api_enabled": True, "api_port": 7878, "api_token": TOKEN, "updates_off": True}
    (CONF / "settings.json").write_text(json.dumps(settings))


def app_up():
    request = urllib.request.Request("http://127.0.0.1:7878/v1/status", headers={"Authorization": f"Bearer {TOKEN}"})
    try:
        with urllib.request.urlopen(request, timeout=2) as reply:
            return reply.status == 200
    except Exception:
        return False


def app_pids():
    found = subprocess.run(["pgrep", "-f", "Contents/MacOS/polyzon-maker$"], capture_output=True, text=True)
    return found.stdout.split()


def session(label, calls):
    print(f"\n== {label}")
    server = subprocess.Popen([EXE, "--mcp"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    lines = queue.Queue()
    errors = []
    readers = [threading.Thread(target=lambda: [lines.put(line) for line in server.stdout], daemon=True),
               threading.Thread(target=lambda: errors.extend(server.stderr), daemon=True)]
    for reader in readers:
        reader.start()
    serial = iter(range(1, 1000))

    def ask(method, params, wait=120):
        n = next(serial)
        server.stdin.write(json.dumps({"jsonrpc": "2.0", "id": n, "method": method, "params": params}) + "\n")
        server.stdin.flush()
        deadline = time.time() + wait
        while time.time() < deadline:
            try:
                line = lines.get(timeout=1)
            except queue.Empty:
                if server.poll() is not None:
                    problems.append(f"{label}: the server ended ({server.returncode}) during {method}")
                    return None
                continue
            try:
                reply = json.loads(line)
            except json.JSONDecodeError:
                problems.append(f"{label}: not JSON on the server's stdout: {line[:120]!r}")
                continue
            if reply.get("id") == n:
                return reply
        problems.append(f"{label}: no answer to {method} in {wait} s")
        return None

    reply = ask("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "ci-check", "version": "1"}})
    print("initialize:", "ok" if reply and "result" in reply else reply)
    server.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
    server.stdin.flush()
    reply = ask("tools/list", {})
    print("tools:", len(reply["result"]["tools"]) if reply and "result" in reply else reply)
    for name, arguments in calls:
        started = time.time()
        reply = ask("tools/call", {"name": name, "arguments": arguments})
        result = (reply or {}).get("result", {})
        kinds = [c.get("type") for c in result.get("content", [])]
        text = " ".join(c.get("text", "") for c in result.get("content", []) if c.get("type") == "text")[:160]
        print(f"{name}: {'ERROR ' if result.get('isError') else ''}{kinds} {round(time.time() - started, 1)} s | {text}")
        if reply is None or result.get("isError"):
            problems.append(f"{label}: {name} failed: {text or reply}")
    server.stdin.close()
    try:
        server.wait(30)
    except subprocess.TimeoutExpired:
        problems.append(f"{label}: the server did not end after its input closed")
        server.kill()
    # a client reads the server's output to its end: a program the server started that holds it keeps clients waiting
    for reader in readers:
        reader.join(10)
    if any(reader.is_alive() for reader in readers):
        problems.append(f"{label}: the server's output stayed open after it ended (something it started holds it)")
    print("server ended with", server.returncode, "| stderr:", "".join(errors)[-400:].strip() or "nothing")


setup()
before = set(glob.glob(str(REPORTS / "*")))
for pid in app_pids():
    subprocess.run(["kill", pid])
time.sleep(2)

# the app is closed: the first call has to start it
session("app closed", [("maker_status", {})])
time.sleep(10)
print("after the session: app running", bool(app_pids()), "| API up", app_up())
if not app_up():
    problems.append("app closed: the app the server started is not answering after the session ended")

# the app is open: what agents call most
for _ in range(60):
    if app_up():
        break
    subprocess.Popen(["open", APP]) if not app_pids() else None
    time.sleep(1)
session("app open", [
    ("maker_status", {}),
    ("maker_list_models", {}),
    ("maker_tools_list", {}),
    ("maker_tool_open", {"slug": "keychain-generator"}),
    ("maker_tool_view", {}),
    ("maker_cad_open", {"example": "helicopter"}),
    ("maker_cad_view", {}),
])
time.sleep(5)
print("at the end: app running", bool(app_pids()), "| API up", app_up())

crashes = sorted(set(glob.glob(str(REPORTS / "*"))) - before)
crashes = [c for c in crashes if "polyzon" in c.lower()]
for report in crashes:
    problems.append(f"crash report {os.path.basename(report)}")
    print(f"\n== {report}")
    print(Path(report).read_text(errors="replace")[:6000])
print("\n" + ("PROBLEMS:\n  " + "\n  ".join(problems) if problems else "no problems"))
sys.exit(1 if problems else 0)
