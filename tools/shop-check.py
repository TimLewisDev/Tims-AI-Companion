#!/usr/bin/env python3
"""shop-check.py: open Tatty's shop in a headless Chromium browser (Edge or Chrome) over
the DevTools protocol, the way a person would: the purse beside the gear, coins earned
flying into it, the shop's shelves, a hat bought and worn, a thing too dear refused, and
an avatar unlocked. It reports what rendered and any script error or Content-Security-
Policy violation, and can keep screenshots along the way. Standard library only; the
DevTools plumbing is page-check.py's.

usage: shop-check.py <browser exe> <page url, with #token=...> <ledger file> [--shots <folder>] [--dark]
The ledger file is the server's TT_EVENTS_HOME/events.jsonl: a row appended there is a
milestone, which the server pays coins for. The wallet should be new (the welcome gift).
Prints one JSON object; exits 1 when something expected didn't happen.
"""

import base64
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

_spec = importlib.util.spec_from_file_location("page_check", os.path.join(os.path.dirname(os.path.abspath(__file__)), "page-check.py"))
pc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pc)

# Every error and every CSP refusal on the page, from the first script on.
WATCH = """window.__shopErrs = [];
addEventListener('error', e => __shopErrs.push('error: ' + (e.message || e.target && e.target.src || '?')), true);
addEventListener('unhandledrejection', e => __shopErrs.push('rejection: ' + String(e.reason)));
addEventListener('securitypolicyviolation', e => __shopErrs.push('csp: ' + e.violatedDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sample || '')));"""


def main(argv):
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    exe, url, ledger = argv[0], argv[1], argv[2]
    # A milestone pays the project whose feature it is (server.py's "coins and the shop"), so a ledger row names a real
    # feature's folder in the server's root, as the toolbox's rows do.
    base, _, token = url.partition("#token=")
    req = urllib.request.Request(base.rstrip("/") + "/api/features", headers={"X-TT-Token": token})
    feature_folder = json.load(urllib.request.urlopen(req, timeout=20))["features"][0]["folder"]
    shots = argv[argv.index("--shots") + 1] if "--shots" in argv else None
    port = 9800 + os.getpid() % 150
    proc = subprocess.Popen([exe, "--headless=new", "--disable-gpu", "--no-first-run", "--autoplay-policy=no-user-gesture-required",
                             f"--user-data-dir={tempfile.mkdtemp()}", f"--remote-debugging-port={port}", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    out, fails = {}, []
    try:
        for _ in range(100):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=2))
                page = next(t for t in tabs if t.get("type") == "page")
                break
            except (OSError, StopIteration, ValueError):
                time.sleep(0.2)
        else:
            print("the browser's DevTools port never answered", file=sys.stderr)
            return 2
        p = pc.Page(pc.ws_connect(page["webSocketDebuggerUrl"]))
        p.call("Runtime.enable")
        p.call("Page.enable")
        p.call("Page.addScriptToEvaluateOnNewDocument", source=WATCH)
        p.call("Emulation.setDeviceMetricsOverride", width=1400, height=900, deviceScaleFactor=1, mobile=False)
        if "--dark" in argv:  # the theme a dark Windows asks for
            p.call("Emulation.setEmulatedMedia", features=[{"name": "prefers-color-scheme", "value": "dark"}])

        def shot(name):
            if shots:
                os.makedirs(shots, exist_ok=True)
                data = p.call("Page.captureScreenshot", format="png").get("result", {}).get("data", "")
                with open(os.path.join(shots, name + ".png"), "wb") as fh:
                    fh.write(base64.b64decode(data))

        def wait(expr, seconds=15):
            for _ in range(int(seconds * 5)):
                if p.js(expr):
                    return True
                time.sleep(0.2)
            return False

        def check(name, ok):
            out[name] = bool(ok)
            if not ok:
                fails.append(name)

        p.call("Page.navigate", url=url)
        check("connected", wait("document.querySelector('#conn') && document.querySelector('#conn').textContent === 'connected'"))
        check("a purse beside the gear", wait("!!document.querySelector('#wallet-link + #settings-link') && /\\d/.test(document.querySelector('.purse-count').textContent)"))
        out["purse"] = p.js("document.querySelector('.purse-count').textContent")

        # coins earned: a milestone in the ledger, paid by the server, flown into the purse
        p.js("document.body.dispatchEvent(new PointerEvent('pointerdown', {clientX: 400, clientY: 400, bubbles: true})); 1")
        with open(ledger, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"v": 1, "ts": "2026-11-11T10:00:00Z", "event": "plan.signed_off", "key": "shop-check|signed",
                                 "prefix": "Shop", "folder": feature_folder, "route": "full", "qualifier": "", "skill": "tt-adversarial-plan"}) + "\n")
        check("coins fly when a milestone pays", wait("document.querySelectorAll('#coin-layer .fly-coin').length > 0", 10))
        time.sleep(0.35)
        shot("1-coins-flying")
        check("and the purse counts them in", wait("document.querySelector('.purse-count').textContent === '150'", 6))
        out["purse_after"] = p.js("document.querySelector('.purse-count').textContent")

        # the shop
        p.js("location.hash = '#shop'; 1")
        check("the shop opens", wait("document.querySelectorAll('#page-shop.on .shop-card').length > 0"))
        time.sleep(1.2)
        out["tabs"] = p.js("[...document.querySelectorAll('.shop-tab')].map(t => t.textContent)")
        out["avatar_cards"] = p.js("document.querySelectorAll('.shop-card').length")
        check("six avatars on the first shelf", out["avatar_cards"] == 6)
        check("Tatty on the stage", p.js("!!document.querySelector('#shop-stage svg.tatty[data-av=\"polished\"]')"))
        check("the balance in the shop", p.js("document.querySelector('.shop-balance .num').textContent") == "150")
        shot("2-shop")

        # the hats: try one on by hovering, buy it, and it goes on
        p.js("[...document.querySelectorAll('.shop-tab')][1].click(); 1")
        time.sleep(0.9)
        check("twenty hats", p.js("document.querySelectorAll('.shop-card').length") == 20)
        p.js("document.querySelector('.shop-card[data-id=\"top\"]').dispatchEvent(new MouseEvent('mouseenter')); 1")
        time.sleep(0.3)
        check("hovering tries it on", p.js("!!document.querySelector('#shop-stage .dress.w-hat-top') && !document.querySelector('#shop-stage .shop-trying').hidden"))
        shot("3-trying-on")
        p.js("document.querySelector('.shop-card[data-id=\"top\"]').dispatchEvent(new MouseEvent('mouseleave')); document.querySelector('.shop-card[data-id=\"top\"]').click(); 1")
        time.sleep(0.45)
        shot("4-buying")
        check("bought, worn and celebrated", wait("!!(document.querySelector('.shop-card[data-id=\"top\"].worn') && document.querySelector('#shop-stage svg.st-celebrate'))", 5))
        check("the coins went", wait("document.querySelector('.shop-balance .num').textContent === '30'", 4))
        time.sleep(0.6)
        shot("5-bought")

        # too dear: it shakes its head and says how many more
        p.js("document.querySelector('.shop-card[data-id=\"crown\"]').click(); 1")
        time.sleep(0.15)
        check("a thing too dear says how many more", p.js("document.querySelector('.shop-card[data-id=\"crown\"]').classList.contains('nope') && [...document.querySelectorAll('.coin-float.need')].some(n => n.textContent === 'Need 220 more')"))
        shot("6-too-dear")

        # every shelf draws, and the wardrobe chips take things off
        for i in range(2, 7):
            p.js(f"[...document.querySelectorAll('.shop-tab')][{i}].click(); 1")
            time.sleep(0.5)
        out["shelves"] = p.js("[...document.querySelectorAll('.shop-tab .count')].map(c => c.textContent)")
        p.js("document.querySelector('.wear-chip').click(); 1")
        check("a chip takes the hat off", wait("!document.querySelector('#shop-stage .dress.w-hat-top')", 4))

        # an avatar, earned and unlocked: more coins (a second big milestone and a bit), then buy the screen face
        with open(ledger, "a", encoding="utf-8") as fh:
            for i in range(8):
                fh.write(json.dumps({"v": 1, "ts": "2026-11-11T10:00:00Z", "event": "build.complete", "key": f"shop-check|done{i}",
                                     "prefix": "Shop", "folder": feature_folder, "route": "full", "qualifier": str(i), "skill": "tt-execute"}) + "\n")
        check("enough for an avatar", wait("+document.querySelector('.shop-balance .num').textContent.replace(/\\D/g, '') >= 400", 15))
        time.sleep(1.5)
        p.js("[...document.querySelectorAll('.shop-tab')][0].click(); 1")
        time.sleep(0.6)
        p.js("document.querySelector('.shop-card[data-id=\"screen\"]').click(); 1")
        check("the screen face unlocked and chosen", wait("!!(document.querySelector('#shop-stage svg.tatty[data-av=\"screen\"]') && document.querySelector('.shop-card[data-id=\"screen\"].worn'))", 5))
        time.sleep(0.8)
        shot("7-new-avatar")

        # Settings' Debug section: a wrong password refused, the right one unlocks it, and coins arrive
        if "--debug-password" in argv:
            secret = argv[argv.index("--debug-password") + 1]
            p.js("location.hash = '#settings'; 1")
            check("the debug section, locked", wait("!!document.querySelector('#debug-settings #debug-password')", 15))
            p.js("{ const pw = document.querySelector('#debug-password'); pw.value = 'not it'; document.querySelector('#debug-unlock').click(); } 1")
            check("a wrong password is refused", wait("document.querySelector('#debug-said').textContent === \"That isn't it.\"", 5))
            p.js(f"{{ const pw = document.querySelector('#debug-password'); pw.value = {json.dumps(secret)}; document.querySelector('#debug-unlock').click(); }} 1")
            check("the right one shows the coin buttons", wait("document.querySelectorAll('#debug-settings .debug-give').length === 3", 5))
            before = int(p.js("document.querySelector('.purse-count').textContent.replace(/\\D/g, '')"))
            p.js("{ const r = document.querySelectorAll('#debug-settings .debug-give')[1].getBoundingClientRect(); "
                 "document.body.dispatchEvent(new PointerEvent('pointerdown', {clientX: r.x + 10, clientY: r.y + 10, bubbles: true})); "
                 "document.querySelectorAll('#debug-settings .debug-give')[1].click(); } 1")
            check("debug coins fly into the purse", wait("document.querySelectorAll('#coin-layer .fly-coin').length > 0", 6))
            time.sleep(0.3)
            shot("8-debug-coins")
            check("and count in", wait(f"document.querySelector('.purse-count').textContent.replace(/\\D/g, '') === '{before + 100}'", 8))

        # what the tray app is sent: the chosen avatar in what he wears, in the window's own parts
        baked = p.js("TattyAvatar.bake('cat', {neck: 'bow', hat: 'top'}, '#3B6EA8')") or ""
        check("the tray app's description has his parts", all(x in baked for x in (
            '<tatty av="cat"', '<part name="Root"', '<part name="LegL"', '<part name="Body"', "<eyes ", "<pupils>",
            '<mouth name="neutral">', "<flag ", "<badge ", '<g p="Tail"')))
        check("and what he wears, with his collar off", "w-neck-bow" in baked and baked.count("#c9a227") == 0)
        out["errors"] = p.js("window.__shopErrs")
        check("no script errors or CSP refusals", not out["errors"])
    finally:
        proc.kill()
    out["failed"] = fails
    print(json.dumps(out, indent=1))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
