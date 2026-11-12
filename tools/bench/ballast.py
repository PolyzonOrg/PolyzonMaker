"""Holds N GB of this computer's memory, so that a big computer behaves like a smaller one for a test:
16 on a 24 GB Mac leaves an 8 GB one. Start Polyzon Maker after it with POLYZON_RAM_MB set to what is left,
so that the program counts that much too:

    python3 ballast.py 16
    POLYZON_RAM_MB=8192 "/Applications/Polyzon Maker.app/Contents/MacOS/polyzon-maker"

The memory is random, so a Mac's compressor cannot shrink it, and it is touched again and again so that it
stays in memory. It lets go by itself after 10 seconds of critical memory pressure, and with Ctrl+C.
Standard library only."""

import os
import subprocess
import sys
import time

BLOCK = 256 << 20
PAGE = 4096


def level_of(darwin_level=None, psi_text=None):
    """0 normal, 1 warning, 2 critical: macOS's own level (1, 2, 4), else Linux's PSI, else nothing known."""
    if darwin_level is not None:
        return {2: 1, 4: 2}.get(darwin_level, 0)
    if psi_text:
        for line in psi_text.splitlines():
            if line.startswith("full "):
                avg10 = float(line.split("avg10=")[1].split()[0])
                return 2 if avg10 >= 25 else 1 if avg10 >= 10 else 0
    return 0


def level():
    if sys.platform == "darwin":
        out = subprocess.run(["sysctl", "-n", "kern.memorystatus_vm_pressure_level"], capture_output=True, text=True).stdout
        return level_of(darwin_level=int(out.strip() or 1))
    try:
        return level_of(psi_text=open("/proc/pressure/memory").read())
    except OSError:
        return 0


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    gb = float(sys.argv[1])
    held = []
    for i in range(int(gb * (1 << 30) // BLOCK)):
        held.append(bytearray(os.urandom(BLOCK)))
        print(f"\rholding {len(held) * BLOCK >> 20} MB", end="", flush=True)
    print(f"\nholding {gb:g} GB; Ctrl+C lets go")
    critical_since = None
    try:
        while True:
            for block in held:  # one byte of each page, so that none goes to the disk
                for at in range(0, BLOCK, PAGE):
                    block[at] ^= 0
            now = level()
            if now == 2:
                critical_since = critical_since or time.monotonic()
                if time.monotonic() - critical_since >= 10:
                    print("memory pressure critical for 10 s: letting go")
                    return
            else:
                critical_since = None
            time.sleep(1)
    except KeyboardInterrupt:
        print("let go")


if __name__ == "__main__":
    main()
