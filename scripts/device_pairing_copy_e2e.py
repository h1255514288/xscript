#!/usr/bin/env python3
"""The home screen's 配对码 dialog: 复制配对码 puts the current code on the clipboard. The code is never printed.

    ANDROID_SERIAL=emulator-5556 python3 scripts/device_pairing_copy_e2e.py com.xscript.app.perf http://127.0.0.1:19860

Clicks the observed 配对码 node, then 复制配对码 in the dialog, reads the clipboard with an on-device script (through the
HTTP API, its log lines are not echoed) and compares it with the code from the app's USB-only pairing socket
(scripts/devauth.py, read directly even when this computer is already paired), ignoring the display dashes. Prints only whether they match. Refuses to run without ANDROID_SERIAL.
"""
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import devauth  # noqa: E402
import device_guide_smoke as api  # noqa: E402

serial = os.environ.get("ANDROID_SERIAL")
if not serial or len(sys.argv) < 3:
    raise SystemExit(__doc__)
pkg, api.base = sys.argv[1], sys.argv[2].rstrip("/")


def sh(cmd):
    return subprocess.run(["adb", "-s", serial, "shell", cmd], capture_output=True, text=True, timeout=60).stdout


def click_text(label):
    # The home screen reflows as permission/root status arrives. A coordinate from a
    # UIAutomator dump can already belong to the next row by the time adb taps it.
    # Resolve the actual accessibility node and invoke its click action instead.
    code = ("from xscript.android.node import Selector\n"
            "hit = Selector().text(%s).find(timeout=5)\n"
            "_result = bool(hit and hit.click())" % json.dumps(label))
    result = api.call("POST", "/eval", json.dumps({"code": code, "timeout_ms": 10000}).encode(), "application/json")
    assert result.get("ok") and result.get("result") in (True, "true"), "could not click %r" % label


def norm(code):
    return re.sub(r"[^A-Za-z0-9]", "", code or "").upper()


status = api.call("GET", "/status")
if not status.get("pairing"):
    print("SKIP copy pairing code: pairing is switched off on this device")
    sys.exit(0)
# straight from the USB-only socket: devauth.token() returns nothing once this computer is already paired
expected = norm(devauth._from_adb(str(status.get("app_id") or pkg), serial))
assert expected, "the pairing socket did not answer"
sh("am start -n %s/com.xscript.app.LauncherActivity" % pkg)
time.sleep(2)
click_text("配对码")
click_text("复制配对码")
time.sleep(1)
lines = api.run("xs_pair_clip", "from xscript.android import system\nprint('clip=' + system.clipboard_get())\n", wait=30, quiet=True)
got = next((s[len("clip="):] for s in lines if s.startswith("clip=")), None)
assert got is not None, "the clipboard script printed nothing"
assert norm(got) == expected, "the clipboard does not hold the pairing code (lengths %d / %d)" % (len(norm(got)), len(expected))
assert re.fullmatch(r"[A-Z0-9]{4}(-[A-Z0-9]{4})+", got.strip()), "copied in the dashed display form"
print("ok  copy pairing code   clipboard matches the pairing code (not shown)")
