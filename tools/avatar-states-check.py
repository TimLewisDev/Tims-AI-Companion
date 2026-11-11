#!/usr/bin/env python3
"""avatar-states-check.py: look at what the tray app makes of the avatars' working states.

usage: avatar-states-check.py <browser exe> <page url, with #token=...> <TtCompanion.exe> <out folder>

Bakes every avatar in the page (avatar.js's bake, as the page sends it to the tray app), then has the tray app
draw them: `--render-states` draws each state at four moments of it into contact sheets (the drawing: props,
mouths, the parts at their places), and `--render-live` (with TATTY_ANIMATE=1) plays four states for real
out of sight and draws four frames of each, with an alert cutting in half way (the animations: easing in,
looping, coming back after a performance). No window is shown on the desktop (the live one is out of sight)
and the saved look is not touched. It prints where the pictures are and exits 1 if any step failed; the
pictures are for looking at -- a state that doesn't move shows the same frame four times.

The tray app is built the way the server builds it: a copy of app/companion with assets/tatty.ico, `dotnet build`.
Standard library only; the DevTools plumbing is page-check.py's.
"""

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("page_check", os.path.join(HERE, "page-check.py"))
pc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pc)


def bake_all(exe, url, out):
    port = 9400 + os.getpid() % 300
    proc = subprocess.Popen([exe, "--headless=new", "--disable-gpu", "--no-first-run", f"--user-data-dir={tempfile.mkdtemp()}",
                             f"--remote-debugging-port={port}", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    names = []
    try:
        for _ in range(100):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=2))
                page = next(t for t in tabs if t.get("type") == "page")
                break
            except (OSError, StopIteration, ValueError):
                time.sleep(0.2)
        else:
            raise RuntimeError("the browser's DevTools port never answered")
        p = pc.Page(pc.ws_connect(page["webSocketDebuggerUrl"]))
        p.call("Runtime.enable")
        p.call("Page.navigate", url=url)
        time.sleep(1.5)
        for av in p.js("TattyAvatar.ids"):
            xml = p.js(f"TattyAvatar.bake({json.dumps(av)}, {{}}, '#3B6EA8')")
            with open(os.path.join(out, av + ".xml"), "w", encoding="utf-8") as fh:
                fh.write(xml)
            names.append(av)
    finally:
        proc.kill()
    return names


def build_tray(out):
    plugin = os.path.dirname(HERE)
    src = os.path.join(out, "tray-src")
    shutil.copytree(os.path.join(plugin, "plugins", "tatty", "app", "companion"), src, ignore=shutil.ignore_patterns("bin", "obj"))
    shutil.copy(os.path.join(plugin, "plugins", "tatty", "assets", "tatty.ico"), src)
    p = subprocess.run(["dotnet", "build", "-c", "Release", "--nologo", "-v", "q", "-o", os.path.join(out, "tray-bin")], cwd=src,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if p.returncode:
        print(p.stdout[-2000:], p.stderr[-1000:], file=sys.stderr)
        raise RuntimeError("the tray app did not build")
    return os.path.join(out, "tray-bin", "TtCompanion.exe")


def main(argv):
    if len(argv) < 4:
        print(__doc__, file=sys.stderr)
        return 2
    browser, url, tray, out = argv[:4]
    os.makedirs(out, exist_ok=True)
    failed = []
    try:
        names = bake_all(browser, url, out)
    except Exception as e:  # noqa: BLE001
        print("bake:", e, file=sys.stderr)
        return 1
    if tray == "build":
        try:
            tray = build_tray(out)
        except Exception as e:  # noqa: BLE001
            print("build:", e, file=sys.stderr)
            return 1
    for av in names:
        xml = os.path.join(out, av + ".xml")
        p = subprocess.run([tray, "--render-states", xml, out, "1.5"], capture_output=True, text=True, timeout=120)
        sheets = [f"{av}-1.png", f"{av}-2.png"]
        ok = p.returncode == 0 and all(os.path.isfile(os.path.join(out, s)) for s in sheets)
        print(("ok    " if ok else "FAIL  ") + f"{av}: states drawn" + ("" if ok else " " + p.stderr.strip()[:300]))
        if not ok:
            failed.append(av)
        live = os.path.join(out, f"live-{av}.png")
        p = subprocess.run([tray, "--render-live", xml, live, "thinking", "reading", "delegating", "oops", "--interrupt"], capture_output=True, text=True,
                           timeout=120, env={**os.environ, "TATTY_ANIMATE": "1"})
        ok = p.returncode == 0 and os.path.isfile(live)
        print(("ok    " if ok else "FAIL  ") + f"{av}: states played" + ("" if ok else " " + p.stderr.strip()[:300]))
        if not ok:
            failed.append(av + " (live)")
    print("pictures in", out)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
