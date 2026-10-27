#!/usr/bin/env python3
"""whiteboard-perf.py: measure the whiteboard's pan and zoom (web/whiteboard.js)
on a User Stories board of generated notes, with scripted input over the
DevTools protocol and a Chrome trace of each run. Writes nothing: the page's
api() is stood in for while it runs, so the board is made up in the page and its
saves go nowhere. Uses page-check.py's websocket client. Standard library only.

usage: whiteboard-perf.py <browser exe> <page url> [--headed] [options]
       whiteboard-perf.py attach <devtools port> [options]
       whiteboard-perf.py --compare <a.json> <b.json>
options:
  --sizes 40,120,300     notes on the board (default 40)
  --scenarios a,b        which runs (default: all of them; see SCENARIOS)
  --focus                every run again with a group in focus (the others dimmed)
  --inject-css a,b       CSS presets laid over the page first (see PRESETS): what-ifs, no app change
  --observe <seconds>    no script: trace while a person pans and zooms the 40-note board
  --out <file.json>      also write the JSON there
  --rdp-counters         sample Windows' RemoteFX Graphics counters during each run (Remote Desktop)
  --devtools-wheel       headless only: wheel turns through DevTools' mouseWheel (the browser's own input
                         path) instead of WheelEvents sent in the page; a headed Edge drops them, and a
                         headless one sometimes never answers
The browser is started headless with no GPU at 1920x1080 and a device scale of 2
(this machine's 4K at 200%), or --headed: a real window with the GPU, maximised,
to be left alone while it runs; either is started afresh for each run (see
Target). attach is a page already open: Tatty's companion,
started with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>.
Input sent this way skips the OS (and Remote Desktop's input), and "presented"
is when this machine showed the frame, not when a remote screen did.
Prints one JSON object (env, and per run: frames, stages, thread time, raster,
latency); a table goes to stderr, and the traces stay in a temp folder (open
them in DevTools' Performance panel or ui.perfetto.dev).
"""

import base64
import importlib.util
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

sys.dont_write_bytecode = True  # leave no __pycache__ in tools/
spec = importlib.util.spec_from_file_location("pagecheck", Path(__file__).with_name("page-check.py"))
pc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pc)

CATEGORIES = ["cc", "viz", "gpu", "benchmark", "input", "latencyInfo", "toplevel", "blink.user_timing",
              "devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame"]
STAGES = ["SendBeginMainFrameToCommit", "EndCommitToActivation", "SubmitCompositorFrameToPresentationCompositorFrame"]
SCENARIOS = ["idle", "pan", "wheel-16", "wheel-60", "wheel-220", "wheel-400", "wheel-out", "pan-after-zoom",
             "frame-ease", "scroll-baseline"]
PRESETS = {
    "layer": ".world { will-change: transform !important; }",
    "flat": ".scard { rotate: none !important; }",
    "lite-notes": ".scard { border-radius: 2px !important; box-shadow: 0 2px 4px rgba(0,0,0,.18) !important; overflow: visible !important; }"
                  " .scard:hover, .scard:focus-visible { box-shadow: 0 3px 7px rgba(0,0,0,.24) !important; z-index: auto !important; }",
    "no-shadow": ".scard, .scard:hover, .scard:focus-visible, .scard.dragging { box-shadow: none !important; }",
    "no-hover": ".scard:hover { box-shadow: 0 1px 2px rgba(0,0,0,.12), 0 6px 14px rgba(0,0,0,.12) !important; z-index: auto !important; }",
}


# ------------------------------------------------------------------ DevTools

class Cdp:
    """page-check.py's Page, keeping the events that arrive between answers
    (tracing ends with one)."""

    def __init__(self, ws):
        self.ws, self.n, self.events = ws, 0, []

    def call(self, method, **params):
        self.n += 1
        pc.ws_send(self.ws, json.dumps({"id": self.n, "method": method, "params": params}))
        while True:
            m = json.loads(pc.ws_recv(self.ws))
            if m.get("id") == self.n:
                if "error" in m:
                    raise RuntimeError(f"{method}: {m['error']}")
                return m.get("result", {})
            if "method" in m:
                self.events.append(m)

    def wait_event(self, method, timeout=120):
        end = time.time() + timeout
        while time.time() < end:
            for i, m in enumerate(self.events):
                if m["method"] == method:
                    return self.events.pop(i)
            m = json.loads(pc.ws_recv(self.ws))
            if "method" in m:
                self.events.append(m)
        raise TimeoutError(method)

    def js(self, expr):
        r = self.call("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        if "exceptionDetails" in r:
            raise RuntimeError(json.dumps(r["exceptionDetails"])[:500])
        return r.get("result", {}).get("value")


def connect(port, url):
    for _ in range(150):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=2))
            # a browser it started: its blank tab (a fresh Edge profile has dialogs of its own, e.g. sync's)
            page = next(t for t in tabs if t.get("type") == "page" and (t.get("url") == "about:blank" if url else "127.0.0.1" in t.get("url", "")))
            version = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2))
            break
        except (OSError, StopIteration, ValueError):
            time.sleep(0.2)
    else:
        return None, None, None
    p = Cdp(pc.ws_connect(page["webSocketDebuggerUrl"]))
    p.ws.settimeout(180)
    browser = Cdp(pc.ws_connect(version["webSocketDebuggerUrl"])) if version.get("webSocketDebuggerUrl") else None
    return p, browser, page.get("id")


def environment(p, browser):
    env = {}
    if browser:
        try:
            v = browser.call("Browser.getVersion")
            env["browser"] = v.get("product", "")
            env["userAgent"] = v.get("userAgent", "")
        except RuntimeError as e:
            env["browser"] = str(e)
        try:
            gpu = browser.call("SystemInfo.getInfo").get("gpu", {})
            aux = gpu.get("auxAttributes", {})
            env["gpu"] = {"features": gpu.get("featureStatus", {}),
                          "devices": [f"{d.get('vendorString', '')} {d.get('deviceString', '')}".strip() for d in gpu.get("devices", [])],
                          "glRenderer": aux.get("glRenderer", ""), "glImplementation": aux.get("glImplementationParts", aux.get("glImplementation", "")),
                          "displayType": aux.get("displayType", ""), "d3d11": aux.get("directComposition", "")}
        except RuntimeError as e:
            env["gpu"] = str(e)
    env.update(p.js("({ dpr: devicePixelRatio, viewport: [innerWidth, innerHeight], screen: [screen.width, screen.height],"
                    " reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches })"))
    return env


# ------------------------------------------------------------------ the board, made up in the page

FIXTURE = r"""(n => {
  const real = window.__perfReal || (window.__perfReal = { api, modes: installedModes, mode: currentMode });
  const names = ["Pickup", "Inventory", "Crafting", "Trading", "Quests", "Social", "Settings", "Onboarding"];
  const groups = names.slice(0, Math.max(4, Math.min(8, Math.round(n / 6))))
    .map((name, i) => ({ name, description: name + " stories", count: 0, colour: i % 8 }));
  const words = ("item bag slot stack drop carry trade craft recipe quest reward friend guild chat map marker "
    + "filter sort search tooltip preview confirm undo limit weight rarity colour icon badge list grid").split(" ");
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const say = k => Array.from({ length: k }, () => words[Math.floor(rnd() * words.length)]).join(" ");
  const stories = [];
  for (let i = 1; i <= n; i++) {
    const g = groups[i % groups.length];
    g.count++;
    stories.push({ id: "US-" + String(i).padStart(2, "0"), title: "Players can " + say(6 + (i % 4)), group: g.name,
      status: i % 10 === 3 ? "Proposed" : "Accepted", origin: i % 7 === 0 ? "Suggested" : "Design doc", altered: "",
      source: "§ " + g.name, article: "a", as: "player", want: "to " + say(9), soThat: "I can " + say(8),
      details: say(40), criteria: Array.from({ length: 3 + (i % 3) }, () => say(7)), hash: "h" + i });
  }
  const data = { name: "", folder: "", plugin: true, claude: false, run: null, doc: "Perf - User Stories.md", intake: "",
    meta: {}, groups, stories, retired: [], problems: [], error: "", updated: Date.now() / 1000,
    layout: { cards: {}, view: {}, items: {}, lines: {} }, exported: {} };
  api = async (path, body) => {
    if (path.startsWith("/api/design?name=__perf")) return JSON.parse(JSON.stringify({ ...data, name: decodeURIComponent(path.split("=")[1]) }));
    if (path === "/api/whiteboard" || path === "/api/stories/layout") return { ok: true };
    if (path.startsWith("/api/whiteboard?")) return data.layout;
    return real.api(path, body);
  };
  if (!installedModes.includes("design")) setInstalledModes([...installedModes, "design"]);
  applyMode("design");
  return groups.length;
})"""

PROBES = r"""(() => {
  const b = document.querySelector('#board'), w = document.querySelector('#board-world');
  const c = w.querySelector('.wbcontent');
  const P = window.__perf = { loafs: [], raf: [], on: true };
  const mark = n => performance.mark(n);
  P.down = () => mark('tt:down'); P.wheel = () => mark('tt:wheel');
  b.addEventListener('pointerdown', P.down, true);
  b.addEventListener('wheel', P.wheel, true);
  P.mo = new MutationObserver(recs => {
    for (const r of recs) mark(r.target !== w ? 'tt:content' : r.attributeName === 'class' ? 'tt:cls' : 'tt:view');
  });
  P.mo.observe(w, { attributes: true, attributeFilter: ['style', 'class'] });
  if (c) P.mo.observe(c, { attributes: true, attributeFilter: ['style'] });
  const loop = t => { P.raf.push(t); if (P.on) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  try {
    P.po = new PerformanceObserver(l => { for (const e of l.getEntries()) P.loafs.push([e.startTime, e.duration, e.blockingDuration || 0]); });
    P.po.observe({ type: 'long-animation-frame' });
  } catch { /* no LoAF in this browser */ }
  P.stop = () => {
    P.on = false; P.mo.disconnect(); if (P.po) P.po.disconnect();
    b.removeEventListener('pointerdown', P.down, true); b.removeEventListener('wheel', P.wheel, true);
    return { raf: P.raf, loafs: P.loafs };
  };
  return !!c;
})()"""


def open_board(p, n, key, inject, focus):
    """A fresh board of n notes (its own name, so stories.js draws it anew)."""
    p.js(f"location.hash = '#design/' + encodeURIComponent('__perf-{n}-{key}'); 1")
    ok = wait(p, f"document.querySelectorAll('#board .scard').length === {n}", 15)
    if not ok:
        raise RuntimeError(f"the board of {n} never drew")
    p.js(f"""(() => {{ let s = document.getElementById('perf-inject');
              if (!s) {{ s = document.createElement('style'); s.id = 'perf-inject'; document.head.append(s); }}
              s.textContent = {json.dumps(" ".join(PRESETS[x] for x in inject))}; return 1; }})()""")
    if focus:
        p.js("document.querySelector('#group-panel .grow .gname').click(); 1")
    p.js("new Promise(r => setTimeout(r, 400))")  # fonts, the first raster, the place() save


def wait(p, expr, seconds=10):
    end = time.time() + seconds
    while time.time() < end:
        try:
            if p.js(expr):
                return True
        except RuntimeError:
            pass
        time.sleep(0.05)
    return False


def board_point(p, on_note=True):
    """A spot on the board: over a note in view (a pan from it moves the view), else the middle."""
    return p.js("""(onNote => { const b = document.querySelector('#board').getBoundingClientRect();
      const mid = [b.left + b.width * 0.45, b.top + b.height * 0.55];
      if (onNote) for (const n of document.querySelectorAll('#board .scard')) {
        const r = n.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (x > b.left + 80 && x < b.right - 300 && y > b.top + 60 && y < b.bottom - 60) return [x, y];
      }
      return mid; })(""" + ("true" if on_note else "false") + ")")


# ------------------------------------------------------------------ input

class Input:
    # page_wheel: wheel turns sent in the page, as WheelEvents on what is under the
    # point (the board's own handler, then its drawing: what is measured). DevTools'
    # mouseWheel is never delivered by a headed Edge, and now and then isn't
    # answered by a headless one either, so it is only used when asked for.
    page_wheel = True

    def __init__(self, p):
        self.p, self.acks = p, []

    def send(self, **params):
        t = time.perf_counter()
        self.p.call("Input.dispatchMouseEvent", **params)
        self.acks.append((time.perf_counter() - t) * 1000)

    def pace(self, t0, i, gap_ms):
        left = t0 + i * gap_ms / 1000 - time.perf_counter()
        if left > 0:
            time.sleep(left)

    def pan(self, x, y, moves=60, step=10, gap_ms=8):
        self.send(type="mousePressed", x=x, y=y, button="middle", buttons=4, clickCount=1)
        t0 = time.perf_counter()
        for i in range(1, moves + 1):
            self.pace(t0, i, gap_ms)
            self.send(type="mouseMoved", x=x - i * step, y=y - i * step * 0.4, button="middle", buttons=4)
        self.send(type="mouseReleased", x=x - moves * step, y=y - moves * step * 0.4, button="middle", buttons=0, clickCount=1)

    def wheel(self, x, y, deltas, gap_ms):
        t0 = time.perf_counter()
        for i, d in enumerate(deltas):
            self.pace(t0, i, gap_ms)
            if self.page_wheel:
                self.p.js(f"(() => {{ document.elementFromPoint({x}, {y}).dispatchEvent(new WheelEvent('wheel', "
                          f"{{ deltaY: {d}, clientX: {x}, clientY: {y}, bubbles: true, cancelable: true }})); return 1; }})()")
            else:
                self.send(type="mouseWheel", x=x, y=y, deltaX=0, deltaY=d)


def frames_flowing(p, tries=10):
    """Whether the page is drawing frames at all: a run in a page that has
    stopped (see Target) would measure nothing."""
    for _ in range(tries):
        n = p.js("new Promise(r => { let n = 0; const f = () => { n++; requestAnimationFrame(f); }; requestAnimationFrame(f); setTimeout(() => r(n), 300); })")
        if n and n >= 5:
            return True
        time.sleep(3)
    return False


def settle(p, extra_ms):
    p.js(f"new Promise(r => setTimeout(r, {extra_ms}))")


def scenario(p, inp, name):
    """One run's input, between its marks."""
    if name == "idle":
        settle(p, 2000)
    elif name == "pan":
        settle(p, 600)
        inp.pan(*board_point(p))
        settle(p, 700)
    elif name.startswith("wheel-") and name != "wheel-out":
        gap = int(name.split("-")[1])
        x, y = board_point(p, False)
        inp.wheel(x, y, [-100] * 6 + [100] * 6, gap)
        settle(p, 900)
    elif name == "wheel-out":
        x, y = board_point(p, False)
        inp.wheel(x, y, [100] * 12, 60)
        settle(p, 900)
    elif name == "pan-after-zoom":
        x, y = board_point(p, False)
        inp.wheel(x, y, [-100] * 3, 60)
        # the moment the zoom settles, and 10 ms more
        p.js("""new Promise(r => { const w = document.querySelector('#board-world');
                 const t = setInterval(() => { if (!w.classList.contains('moving')) { clearInterval(t); setTimeout(r, 10); } }, 2); })""")
        inp.pan(*board_point(p))
        settle(p, 700)
    elif name == "frame-ease":
        p.call("Emulation.setEmulatedMedia", features=[{"name": "prefers-reduced-motion", "value": "no-preference"}])
        p.js("document.querySelector('#group-panel .grow:not(.on) .gname').click(); 1")
        settle(p, 900)
        p.js("document.querySelector('#board-fit').click(); 1")
        settle(p, 900)
        p.js("(document.querySelector('#group-panel .grow.on .gname') || { click() {} }).click(); 1")
        p.call("Emulation.setEmulatedMedia", features=[])
    elif name == "scroll-baseline":
        # the same notes in a plain scrolling box over the board: what the compositor
        # alone does with them on this machine, the floor for a pan
        p.js("""(() => { const b = document.querySelector('#board'), r = b.getBoundingClientRect();
          const box = document.createElement('div'); box.id = 'perf-scroll';
          Object.assign(box.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px',
            overflow: 'auto', zIndex: 30, background: getComputedStyle(b).backgroundColor });
          const inner = document.createElement('div'); Object.assign(inner.style, { position: 'relative', width: '6000px', height: '6000px' });
          for (const n of document.querySelectorAll('#board .scard')) { const c = n.cloneNode(true);
            c.style.left = (parseFloat(n.style.left) + 1200) + 'px'; c.style.top = (parseFloat(n.style.top) + 1200) + 'px'; inner.append(c); }
          box.append(inner); document.body.append(box); box.scrollLeft = 1100; box.scrollTop = 1100; return 1; })()""")
        settle(p, 600)
        x, y = board_point(p, False)
        try:
            p.call("Input.synthesizeScrollGesture", x=int(x), y=int(y), xDistance=-500, yDistance=-300, speed=1200, gestureSourceType="mouse")
        except RuntimeError as e:
            print(f"scroll-baseline: {e}", file=sys.stderr)
        settle(p, 600)
        p.js("document.getElementById('perf-scroll').remove(); 1")


# ------------------------------------------------------------------ tracing

def trace(p, body):
    p.call("Tracing.start", transferMode="ReturnAsStream", streamFormat="json",
           traceConfig={"recordMode": "recordAsMuchAsPossible", "includedCategories": CATEGORIES, "excludedCategories": ["*"]})
    time.sleep(0.3)
    try:
        body()
    finally:
        p.call("Tracing.end")
    done = p.wait_event("Tracing.tracingComplete")
    handle, chunks = done["params"]["stream"], []
    while True:
        r = p.call("IO.read", handle=handle, size=4 << 20)
        chunks.append(base64.b64decode(r["data"]) if r.get("base64Encoded") else r["data"].encode())
        if r.get("eof"):
            break
    p.call("IO.close", handle=handle)
    raw = b"".join(chunks)
    data = json.loads(raw.decode("utf-8", "replace"))
    return raw, data["traceEvents"] if isinstance(data, dict) else data


def pct(xs, q):
    if not xs:
        return None
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(q * (len(xs) - 1) + 0.5))], 1)


def union_ms(spans, a, b):
    """Busy time inside [a, b] (microseconds in, ms out): overlapping slices count once."""
    total, end = 0, a
    for s, e in sorted((max(a, s), min(b, e)) for s, e in spans if e > a and s < b):
        if e > end:
            total += e - max(s, end)
            end = e
    return round(total / 1000, 1)


def analyse(events, scn):
    """The numbers for one run, from its trace."""
    pname, tname = {}, {}
    for e in events:
        if e.get("ph") == "M":
            if e.get("name") == "process_name":
                pname[e["pid"]] = e.get("args", {}).get("name", "")
            elif e.get("name") == "thread_name":
                tname[(e["pid"], e.get("tid"))] = e.get("args", {}).get("name", "")
    marks = [e for e in events if e.get("cat") == "blink.user_timing" and str(e.get("name", "")).startswith("tt:")]
    renderer = marks[0]["pid"] if marks else None
    at = lambda n: [m["ts"] for m in marks if m["name"] == n]
    a, b = (at(f"tt:scn:{scn}:a") or [0])[0], (at(f"tt:scn:{scn}:b") or [0])[0]
    if not a or not b:
        return {"error": "the run's marks aren't in the trace"}

    # async slices: begin/end pairs, matched on process, id and name
    open_, pairs = {}, []
    for e in sorted((e for e in events if e.get("ph") in ("b", "e")), key=lambda e: e["ts"]):
        aid = e.get("id") or (e.get("id2") or {}).get("local") or (e.get("id2") or {}).get("global")
        k = (e["pid"], aid, e.get("name"))
        if e["ph"] == "b":
            open_.setdefault(k, []).append(e)
        elif open_.get(k):
            s = open_[k].pop()
            pairs.append({"name": e.get("name"), "id": aid, "pid": e["pid"], "ts": s["ts"], "end": e["ts"],
                          "args": {**s.get("args", {}), **e.get("args", {})}})
    inwin = lambda x: x["end"] > a and x["ts"] < b
    reporters = [x for x in pairs if x["name"] == "PipelineReporter" and x["pid"] == renderer and inwin(x)]
    stages = {}
    for x in pairs:
        if x["name"] in STAGES:
            stages.setdefault((x["pid"], x["id"]), []).append(x)
    states, presented, stage_ms, main_frames = {}, [], {s: [] for s in STAGES}, []
    for r in reporters:
        fr = r["args"].get("frame_reporter") or r["args"].get("chrome_frame_reporter") or {}
        st = str(fr.get("state", "?")).replace("STATE_", "")
        states[st] = states.get(st, 0) + 1
        mine = [s for s in stages.get((r["pid"], r["id"]), []) if s["ts"] >= r["ts"] - 1 and s["end"] <= r["end"] + 1]
        for s in mine:
            stage_ms[s["name"]].append((s["end"] - s["ts"]) / 1000)
        if st.startswith("PRESENTED"):
            presented.append(r["end"])
            if any(s["name"] == "SendBeginMainFrameToCommit" for s in mine):
                main_frames.append((r["ts"], r["end"]))
    presented = sorted(set(presented))  # a frame's reporters share its presentation
    gaps = [(y - x) / 1000 for x, y in zip(presented, presented[1:])]
    dropped = states.get("DROPPED", 0) + states.get("PRESENTED_PARTIAL", 0)

    # what each style write took to reach the screen: the presented main frame it was in, or the next one
    def to_screen(ts):
        hit = next((e for s, e in main_frames if s <= ts <= e), None) or next((e for e in presented if e >= ts), None)
        return (hit - ts) / 1000 if hit else None

    views = [t for t in at("tt:view") if a <= t <= b]
    view_lat = [x for x in (to_screen(t) for t in views) if x is not None]
    out = {"frames": {"presented": len(presented), "dropped+partial": dropped, "states": states,
                      "gapP50": pct(gaps, 0.5), "gapP95": pct(gaps, 0.95), "gapMax": round(max(gaps), 1) if gaps else None},
           "stagesP95": {s: pct(v, 0.95) for s, v in stage_ms.items()},
           "viewToScreen": {"n": len(view_lat), "p50": pct(view_lat, 0.5), "p95": pct(view_lat, 0.95)}}
    downs = [t for t in at("tt:down") if a <= t <= b]
    if downs:
        first = next((t for t in views if t > downs[0]), None)
        if first:
            lat = to_screen(first)
            out["panStartMs"] = round((first - downs[0]) / 1000 + lat, 1) if lat is not None else None
    settles = [t for t in at("tt:content") + at("tt:cls") if a <= t <= b]
    if settles:
        lat = to_screen(max(settles))
        out["settleMs"] = round(lat, 1) if lat is not None else None
        out["redraws"] = len([t for t in at("tt:content") if a <= t <= b])

    # time spent per thread, and raster and paint inside it
    spans, named = {}, {}
    for e in events:
        if e.get("ph") == "X" and "dur" in e and e["ts"] < b and e["ts"] + e["dur"] > a:
            k = (e["pid"], e.get("tid"))
            spans.setdefault(k, []).append((e["ts"], e["ts"] + e["dur"]))
            named.setdefault(e.get("name"), []).append((e["pid"], e["dur"]))
    busy = {}
    for (pid, tid), sp in spans.items():
        proc, th = pname.get(pid, ""), tname.get((pid, tid), "")
        if pid == renderer:
            label = {"CrRendererMain": "main", "Compositor": "compositor"}.get(th, "")
        elif proc.startswith("GPU"):
            label = {"CrGpuMain": "gpu", "VizCompositorThread": "viz"}.get(th, "")
        else:
            label = ""
        if label:
            busy[label] = round(busy.get(label, 0) + union_ms(sp, a, b), 1)
    count = lambda n, pids=None: [d for pid, d in named.get(n, []) if pids is None or pid in pids]
    gpu_pids = {pid for pid, n in pname.items() if n.startswith("GPU")}
    gpu_raster = [d for n, v in named.items() if n and "Raster" in n for pid, d in v if pid in gpu_pids]
    for n, label in (("RasterTask", "rasterTasks"), ("Paint", "paints"), ("Layerize", "layerize"), ("UpdateLayer", "updateLayer")):
        xs = count(n, {renderer})
        out[label] = {"n": len(xs), "ms": round(sum(xs) / 1000, 1)}
    out["gpuRaster"] = {"n": len(gpu_raster), "ms": round(sum(gpu_raster) / 1000, 1)}
    busy["raster"] = union_ms([(e["ts"], e["ts"] + e["dur"]) for e in events
                               if e.get("name") == "RasterTask" and e.get("pid") == renderer and "dur" in e], a, b)
    out["busyMs"] = busy
    out["windowMs"] = round((b - a) / 1000)
    lat = {}
    for x in pairs:
        if x["name"] == "EventLatency" and x["pid"] == renderer and inwin(x):
            t = x["args"].get("event_latency", {}).get("event_type", "?")
            lat.setdefault(t, []).append((x["end"] - x["ts"]) / 1000)
    out["eventLatency"] = {t: {"n": len(v), "p50": pct(v, 0.5), "p95": pct(v, 0.95)} for t, v in lat.items()}
    return out


# ------------------------------------------------------------------ Remote Desktop's own counters

class RdpCounters:
    PATHS = [r"\RemoteFX Graphics(*)\Output Frames/Second", r"\RemoteFX Graphics(*)\Input Frames/Second",
             r"\RemoteFX Graphics(*)\Average Encoding Time",
             r"\RemoteFX Graphics(*)\Frames Skipped/Second - Insufficient Server Resources",
             r"\RemoteFX Graphics(*)\Frames Skipped/Second - Insufficient Network Resources",
             r"\RemoteFX Graphics(*)\Frames Skipped/Second - Insufficient Client Resources"]

    def __init__(self):
        self.proc, self.file = None, None

    def start(self):
        self.file = tempfile.mktemp(suffix=".csv")
        try:
            self.proc = subprocess.Popen(["typeperf", *self.PATHS, "-si", "1", "-o", self.file, "-f", "CSV", "-y"],
                                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError:
            self.proc = None

    def stop(self):
        if not self.proc:
            return None
        self.proc.terminate()
        self.proc.wait(5)
        try:
            rows = [r.strip().strip('"').split('","') for r in Path(self.file).read_text(errors="replace").splitlines() if r.strip()]
        except OSError:
            return None
        if len(rows) < 2:
            return None
        head, out = rows[0], {}
        for i, h in enumerate(head[1:], 1):
            vals = [float(r[i]) for r in rows[1:] if len(r) > i and r[i].strip().replace(".", "", 1).isdigit()]
            if vals:
                out[h.split("\\")[-1]] = round(sum(vals) / len(vals), 1)
        return out or None


# ------------------------------------------------------------------ runs

class Target:
    """Where the runs happen. A browser this script starts is started afresh for
    each run: in one browser, the second or third trace of runs like these leaves
    it drawing no frames at all (Edge 156, with every set of categories tried; it
    never happens untraced), so each run gets the first trace of a browser of its
    own. An attached page (the companion) can't be, so its later runs may stall:
    they are marked so."""

    def __init__(self, argv):
        self.argv, self.proc, self.p, self.browser, self.count = argv, None, None, None, 0
        self.kind = "attach" if argv[0] == "attach" else "headed" if "--headed" in argv else "headless"
        self.url = None if self.kind == "attach" else argv[1]

    def open(self, n):
        """The page, with n made-up notes ready to be drawn."""
        if self.kind == "attach":
            if not self.p:
                self.p, self.browser, _ = connect(int(self.argv[1]), None)
                if not self.p:
                    raise RuntimeError("the page's DevTools port never answered")
                self.p.call("Runtime.enable")
                self.p.js("document.querySelector('#expand') && document.querySelector('#expand').click(); 1")  # the companion's full panel
                time.sleep(0.5)
            self.p.js(FIXTURE + f"({n})")
            return self.p
        self.close()
        self.count += 1
        port = 9300 + (os.getpid() + self.count) % 500
        flags = ["--no-first-run", "--no-default-browser-check", f"--user-data-dir={tempfile.mkdtemp()}", f"--remote-debugging-port={port}"]
        if self.kind == "headed":
            flags += ["--window-position=0,0", "--window-size=1920,1040", "--disable-backgrounding-occluded-windows",
                      "--disable-renderer-backgrounding", "--disable-features=CalculateNativeWinOcclusion"]
        else:
            flags += ["--headless=new", "--disable-gpu", "--window-size=1920,1080", "--force-device-scale-factor=2"]
        self.proc = subprocess.Popen([self.argv[0], *flags, "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.p, self.browser, _ = connect(port, self.url)
        if not self.p:
            raise RuntimeError("the browser's DevTools port never answered")
        p = self.p
        p.call("Runtime.enable")
        if self.kind == "headless":
            p.call("Emulation.setDeviceMetricsOverride", width=1920, height=1080, deviceScaleFactor=2, mobile=False)
        else:  # the window as a person has it: maximised
            try:
                win = p.call("Browser.getWindowForTarget")["windowId"]
                p.call("Browser.setWindowBounds", windowId=win, bounds={"windowState": "maximized"})
            except RuntimeError as e:
                print(f"couldn't maximise the window: {e}", file=sys.stderr)
            time.sleep(1)
        p.call("Page.navigate", url=self.url)
        time.sleep(1.5)
        p.js(FIXTURE + f"({n})")
        return p

    def close(self):
        if self.proc:
            self.proc.terminate()
            try:
                self.proc.wait(10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
            self.proc = self.p = self.browser = None
        elif self.p:  # an attached page: as it was
            self.p.js("""(() => { const r = window.__perfReal; if (r) { api = r.api; setInstalledModes(r.modes); applyMode(r.mode); delete window.__perfReal; }
                     const s = document.getElementById('perf-inject'); if (s) s.remove(); location.hash = '#home'; return 1; })()""")


def run_all(t, opts, folder):
    runs = []
    for n in opts["sizes"]:
        for focus in ([False, True] if opts["focus"] else [False]):
            for scn in opts["scenarios"]:
                key = f"{scn}{'-f' if focus else ''}-{int(time.time() * 1000) % 100000}"
                p = t.open(n)
                if not frames_flowing(p):
                    res = {"size": n, "scenario": scn, "focus": focus, "stalled": True}
                    runs.append(res)
                    print(f"{n:>4} {scn:<17} stalled: the page draws no frames", file=sys.stderr)
                    continue
                open_board(p, n, key, opts["inject"], focus)
                if scn == "wheel-out":  # from 156%: two clicks on +
                    p.js("[...document.querySelectorAll('#board .zoomctl button')].find(x => x.textContent === '+').click(); 1")
                    p.js("[...document.querySelectorAll('#board .zoomctl button')].find(x => x.textContent === '+').click(); 1")
                    settle(p, 600)
                p.js(PROBES)
                inp = Input(p)
                rdp = RdpCounters() if opts["rdp"] else None

                def body():
                    if rdp:
                        rdp.start()
                    p.js(f"performance.mark('tt:scn:{scn}:a'); 1")
                    scenario(p, inp, scn)
                    p.js(f"performance.mark('tt:scn:{scn}:b'); 1")

                raw, events = trace(p, body)
                page = p.js("window.__perf ? window.__perf.stop() : null") or {}
                name = f"{n}-{scn}{'-focus' if focus else ''}.json"
                (folder / name).write_bytes(raw)
                res = {"size": n, "scenario": scn, "focus": focus, "inject": opts["inject"], "trace": str(folder / name)}
                res.update(analyse(events, scn))
                raf = page.get("raf", [])
                gaps = [y - x for x, y in zip(raf, raf[1:])]
                res["rafP50"], res["rafP95"] = pct(gaps, 0.5), pct(gaps, 0.95)
                if not gaps or (res["rafP50"] or 0) > 100:
                    res["stalled"] = True  # frames stopped part way (see frames_flowing)
                loafs = page.get("loafs", [])
                res["loafs"] = {"n": len(loafs), "maxMs": round(max((x[1] for x in loafs), default=0), 1),
                                "blockingMs": round(sum(x[2] for x in loafs), 1)}
                if inp.acks:
                    res["inputAckMs"] = {"p50": pct(inp.acks, 0.5), "p95": pct(inp.acks, 0.95), "max": round(max(inp.acks), 1)}
                if rdp:
                    res["rdp"] = rdp.stop()
                runs.append(res)
                print(row(res), file=sys.stderr)
    return runs


def observe(t, seconds, folder):
    """A person's own pans and zooms: how the input arrives, and the frames."""
    p = t.open(40)
    open_board(p, 40, f"observe-{int(time.time())}", [], False)
    p.js(PROBES)
    p.js("""(() => { const b = document.querySelector('#board'); const O = window.__obs = { moves: [], wheels: [] };
      b.addEventListener('pointermove', e => O.moves.push([e.timeStamp, e.getCoalescedEvents ? e.getCoalescedEvents().length : 1, e.buttons]), true);
      b.addEventListener('wheel', e => O.wheels.push([e.timeStamp, e.deltaY, e.deltaMode]), true); return 1; })()""")
    print(f"pan and zoom the board for {seconds} s now…", file=sys.stderr)

    def body():
        p.js("performance.mark('tt:scn:observe:a'); 1")
        time.sleep(seconds)
        p.js("performance.mark('tt:scn:observe:b'); 1")

    raw, events = trace(p, body)
    (folder / "observe.json").write_bytes(raw)
    o = p.js("window.__obs") or {}
    moves = [m for m in o.get("moves", []) if m[2]]
    wheels = o.get("wheels", [])
    mg = [y[0] - x[0] for x, y in zip(moves, moves[1:]) if y[0] - x[0] < 200]
    wg = [y[0] - x[0] for x, y in zip(wheels, wheels[1:]) if y[0] - x[0] < 1000]
    res = {"scenario": "observe", "trace": str(folder / "observe.json"), **analyse(events, "observe"),
           "pointer": {"moves": len(moves), "gapP50": pct(mg, 0.5), "gapP95": pct(mg, 0.95),
                       "coalescedP95": pct([m[1] for m in moves], 0.95)},
           "wheel": {"ticks": len(wheels), "gapP50": pct(wg, 0.5), "gapP95": pct(wg, 0.95),
                     "deltas": sorted({round(w[1]) for w in wheels})[:12]}}
    p.js("window.__perf && window.__perf.stop(); 1")
    print(row(res), file=sys.stderr)
    return [res]


def row(r):
    f = r.get("frames", {})
    v = r.get("viewToScreen", {})
    st = r.get("stagesP95", {})
    if r.get("stalled") and not r.get("frames"):
        return f"{r.get('size', ''):>4} {r['scenario']:<17} stalled"
    return (f"{r.get('size', ''):>4} {r['scenario'] + (' F' if r.get('focus') else ''):<17} " + ("STALLED " if r.get("stalled") else "") +
            f"pres {f.get('presented', '-'):>4} drop {f.get('dropped+partial', '-'):>3} "
            f"gap p50/p95/max {f.get('gapP50')}/{f.get('gapP95')}/{f.get('gapMax')}  "
            f"view->screen p50/p95 {v.get('p50')}/{v.get('p95')}  panStart {r.get('panStartMs', '-')}  settle {r.get('settleMs', '-')}  "
            f"commit->act p95 {st.get('EndCommitToActivation')}  main {r.get('busyMs', {}).get('main')} raster {r.get('busyMs', {}).get('raster')} "
            f"gpu {r.get('busyMs', {}).get('gpu')}  paints {r.get('paints', {}).get('n')} rasterTasks {r.get('rasterTasks', {}).get('n')}")


def compare(a_file, b_file):
    a, b = (json.loads(Path(f).read_text(encoding="utf-8")) for f in (a_file, b_file))
    key = lambda r: (r.get("size"), r["scenario"], r.get("focus"))
    bm = {key(r): r for r in b["runs"]}
    pick = [("presented", lambda r: r.get("frames", {}).get("presented")),
            ("dropped", lambda r: r.get("frames", {}).get("dropped+partial")),
            ("gapP95", lambda r: r.get("frames", {}).get("gapP95")),
            ("gapMax", lambda r: r.get("frames", {}).get("gapMax")),
            ("view->screen p95", lambda r: r.get("viewToScreen", {}).get("p95")),
            ("panStartMs", lambda r: r.get("panStartMs")),
            ("settleMs", lambda r: r.get("settleMs")),
            ("commit->act p95", lambda r: r.get("stagesP95", {}).get("EndCommitToActivation")),
            ("main ms", lambda r: r.get("busyMs", {}).get("main")),
            ("raster ms", lambda r: r.get("busyMs", {}).get("raster")),
            ("gpu ms", lambda r: r.get("busyMs", {}).get("gpu")),
            ("paints", lambda r: r.get("paints", {}).get("n")),
            ("rasterTasks", lambda r: r.get("rasterTasks", {}).get("n"))]
    print(f"a: {a_file}\nb: {b_file}")
    for r in a["runs"]:
        o = bm.get(key(r))
        if not o:
            continue
        print(f"\n{r.get('size')} {r['scenario']}{' focus' if r.get('focus') else ''}")
        for label, fn in pick:
            print(f"  {label:<17} {str(fn(r)):>9} -> {str(fn(o)):>9}")
    return 0


def main(argv):
    if len(argv) >= 3 and argv[0] == "--compare":
        return compare(argv[1], argv[2])
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    arg = lambda name, d=None: argv[argv.index(name) + 1] if name in argv else d
    opts = {"sizes": [int(x) for x in arg("--sizes", "40").split(",")],
            "scenarios": [x for x in arg("--scenarios", ",".join(SCENARIOS)).split(",") if x],
            "inject": [x for x in arg("--inject-css", "").split(",") if x],
            "focus": "--focus" in argv, "rdp": "--rdp-counters" in argv}
    bad = [x for x in opts["scenarios"] if x not in SCENARIOS] + [x for x in opts["inject"] if x not in PRESETS]
    if bad:
        print(f"unknown: {', '.join(bad)}", file=sys.stderr)
        return 2
    t = Target(argv)
    Input.page_wheel = t.kind != "headless" or "--devtools-wheel" not in argv
    try:
        p = t.open(max(opts["sizes"]))
        env = {"target": t.kind, **environment(p, t.browser), "wheel": "page" if Input.page_wheel else "devtools"}
        print(f"{t.kind}: {env.get('browser', '')} dpr {env.get('dpr')} viewport {env.get('viewport')} "
              f"gl {env.get('gpu', {}).get('glRenderer', '?') if isinstance(env.get('gpu'), dict) else env.get('gpu')}", file=sys.stderr)
        folder = Path(tempfile.mkdtemp(prefix="wb-perf-"))
        print(f"traces: {folder}", file=sys.stderr)
        observe_s = arg("--observe")
        runs = observe(t, float(observe_s), folder) if observe_s else run_all(t, opts, folder)
        out = {"env": env, "options": opts, "runs": runs,
               "note": "input sent over DevTools skips the OS and Remote Desktop; 'presented' is this machine's, not the remote screen's"}
        text = json.dumps(out, indent=1)
        print(text)
        if arg("--out"):
            Path(arg("--out")).write_text(text, encoding="utf-8")
        return 0
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 2
    finally:
        t.close()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
