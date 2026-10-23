#!/usr/bin/env python3
"""window-check.py: what the shell thinks of Tatty's windows. Finds the
companion's process, reports every top-level window it owns with the styles that
decide taskbar and Alt-Tab presence, and can assert the whole policy for one mode
or drive a mode switch and prove nothing was rebuilt underneath it.

The point of the switch checks: Tatty's panel is one window serving the compact
bubble, the full panel and maximised, so a mode switch must keep the same window
handle and the same WebView2 child handles. A new handle means the runtime was
rebuilt and the page reloaded with it.

Standard library only. Windows only (it skips elsewhere). Uses page-check.py's
DevTools client for --page and --switch.

usage: window-check.py [--pid <n>] [--expect <mode>] [--no-proxy] [--all]
                       [--page <devtools port>] [--switch <mode>]
       modes: hidden | compact | expanded | maximised | minimised
       --all also reports the plumbing windows .NET and WPF add to any process
Prints one JSON object; exit 1 if an --expect or --switch check failed.
"""

import ctypes
import ctypes.wintypes as wt
import importlib.util
import json
import sys
import time
from pathlib import Path

MODES = ("hidden", "compact", "expanded", "maximised", "minimised")

# The page button that asks the host for each mode (the real user path: there is
# no back door into the window, and /api/show only posts a card).
BUTTON = {"compact": "#collapse", "expanded": "#expand", "maximised": "#max",
          "minimised": "#min", "hidden": "#hide"}

GWL_STYLE, GWL_EXSTYLE = -16, -20
GW_OWNER, GA_ROOTOWNER = 4, 3
EX_FLAGS = {  # the bits that decide where a window belongs
    "toolwindow": 0x00000080,
    "appwindow": 0x00040000,
    "topmost": 0x00000008,
    "noactivate": 0x08000000,
    "layered": 0x00080000,
    "transparent": 0x00000020,
}
STYLE_FLAGS = {"visible": 0x10000000, "caption": 0x00C00000, "sysmenu": 0x00080000,
               "minimize": 0x20000000, "thickframe": 0x00040000}


# ----------------------------------------------------------------- the shell

def dpi_aware():
    """Per-monitor DPI awareness before anything asks for a rectangle: a process
    that isn't gets virtualised coordinates, which on a 200% display look halved."""
    u, sh = ctypes.windll.user32, None
    try:
        sh = ctypes.windll.shcore
    except OSError:
        pass
    if hasattr(u, "SetProcessDpiAwarenessContext"):
        if u.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4)):  # PER_MONITOR_AWARE_V2
            return "per-monitor-v2"
    if sh is not None and sh.SetProcessDpiAwareness(2) == 0:
        return "per-monitor"
    u.SetProcessDPIAware()
    return "system"


u32 = ctypes.windll.user32
ENUMPROC = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)


def text_of(fn, h, n=512):
    buf = ctypes.create_unicode_buffer(n)
    fn(h, buf, n)
    return buf.value


def rect_of(h):
    r = wt.RECT()
    u32.GetWindowRect(h, ctypes.byref(r))
    return {"x": r.left, "y": r.top, "w": r.right - r.left, "h": r.bottom - r.top}


def work_area_of(h):
    """The monitor's work area (screen minus the taskbar), as the panel's
    maximise uses it."""
    class MONITORINFO(ctypes.Structure):
        _fields_ = [("cbSize", wt.DWORD), ("rcMonitor", wt.RECT), ("rcWork", wt.RECT), ("dwFlags", wt.DWORD)]
    mi = MONITORINFO()
    mi.cbSize = ctypes.sizeof(MONITORINFO)
    mon = u32.MonitorFromWindow(h, 2)  # MONITOR_DEFAULTTONEAREST
    u32.GetMonitorInfoW(mon, ctypes.byref(mi))
    w = mi.rcWork
    return {"x": w.left, "y": w.top, "w": w.right - w.left, "h": w.bottom - w.top}


def flags_of(value, table):
    return {name: bool(value & bit) for name, bit in table.items()}


def alt_tab(h):
    """Whether the shell puts this window in Alt-Tab. This is the rule, not the
    switcher's actual list, which cannot be enumerated."""
    if not u32.IsWindowVisible(h):
        return False, "not visible"
    ex = u32.GetWindowLongW(h, GWL_EXSTYLE)
    if ex & EX_FLAGS["toolwindow"]:
        return False, "WS_EX_TOOLWINDOW"
    # Not in the documented rule, but what Windows 11 does: a window that refuses
    # ever to come forward is no use to the switcher, so it is left out even with
    # WS_EX_APPWINDOW. This is what lets the taskbar proxy have a button and no
    # Alt-Tab entry; it was checked by hand before it was written down here.
    if ex & EX_FLAGS["noactivate"]:
        return False, "WS_EX_NOACTIVATE (cannot be brought forward)"
    if ex & EX_FLAGS["appwindow"]:
        return True, "WS_EX_APPWINDOW (treated as unowned)"
    walk = u32.GetAncestor(h, GA_ROOTOWNER)
    for _ in range(32):  # the owner/popup chain, as IsAltTabWindow walks it
        nxt = u32.GetLastActivePopup(walk)
        if nxt == walk:
            break
        walk = nxt
        if u32.IsWindowVisible(walk):
            break
    if walk != h:
        return False, "another visible window owns it"
    return True, "visible, unowned, not a tool window"


def children_of(h):
    """The WebView2 chain under a window. These handles dying is the other half
    of proving the runtime survived a mode switch."""
    out = []

    def each(child, _):
        out.append({"hwnd": child, "class": text_of(u32.GetClassNameW, child)})
        return True

    u32.EnumChildWindows(h, ENUMPROC(each), 0)
    return out


def process_name(pid):
    k32 = ctypes.windll.kernel32
    h = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return ""
    try:
        buf = ctypes.create_unicode_buffer(32768)
        n = wt.DWORD(32768)
        if not k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(n)):
            return ""
        return Path(buf.value).name
    finally:
        k32.CloseHandle(h)


def role_of(w):
    """Which of Tatty's windows this is. The titles are deliberately all "Tatty",
    so they are told apart by what they are made of: the panel hosts WebView2,
    Tatty himself is a layered (transparent) tool window, and the taskbar proxy is
    the only window of ours that is both visible and has a caption (it asked for
    one so the shell would draw its button an icon; the panel and Tatty have no
    chrome at all). Everything else is the plumbing .NET and WPF put in every
    process -- including a hidden owner window per ShowInTaskbar="False" window,
    which is how WPF keeps one off the taskbar."""
    # Only WPF's own windows are ours. Text services, GDI+ and the .NET event
    # window all put one up too, and the text one is layered and a tool window,
    # which is exactly what Tatty looks like.
    if not w["class"].startswith("HwndWrapper[TtCompanion"):
        return "plumbing"
    if any(c["class"].startswith("Chrome_WidgetWin") for c in w["children"]):
        return "bubble"
    if w["title"] == "Hidden Window":
        return "wpf-owner"
    # The effects stage looks exactly like Tatty -- layered, a tool window --
    # apart from the one thing that makes it a stage: the mouse goes through it.
    if w["ex"]["layered"] and w["ex"]["toolwindow"] and w["ex"]["transparent"]:
        return "effects"
    if w["ex"]["layered"] and w["ex"]["toolwindow"]:
        return "tatty"
    if w["style"]["visible"] and w["style"]["caption"]:
        return "proxy"
    return "plumbing"


def windows(pid=None):
    found = []

    def each(h, _):
        wanted = wt.DWORD()
        u32.GetWindowThreadProcessId(h, ctypes.byref(wanted))
        p = wanted.value
        if pid is not None:
            if p != pid:
                return True
        elif process_name(p).lower() != "ttcompanion.exe":
            return True
        w = {
            "hwnd": h,
            "pid": p,
            "class": text_of(u32.GetClassNameW, h),
            "title": text_of(u32.GetWindowTextW, h),
            "owner": u32.GetWindow(h, GW_OWNER) or 0,
            "iconic": bool(u32.IsIconic(h)),
            "dpi": u32.GetDpiForWindow(h) if hasattr(u32, "GetDpiForWindow") else 0,
            "rect": rect_of(h),
            "work_area": work_area_of(h),
            "style": flags_of(u32.GetWindowLongW(h, GWL_STYLE), STYLE_FLAGS),
            "ex": flags_of(u32.GetWindowLongW(h, GWL_EXSTYLE), EX_FLAGS),
            "children": children_of(h),
        }
        w["alt_tab"], w["alt_tab_why"] = alt_tab(h)
        w["role"] = role_of(w)
        found.append(w)
        return True

    u32.EnumWindows(ENUMPROC(each), 0)
    return found


def by_role(found):
    """One window per role, so the checks can name them. A duplicate is itself
    worth reporting."""
    out = {}
    for w in found:
        out.setdefault(w["role"], []).append(w)
    return out


# ------------------------------------------------------------- the policy

def check(found, mode, want_proxy=True):
    """Assert the whole policy for one mode. Returns a list of failures, so a
    run says everything that is wrong, not just the first thing."""
    bad, roles = [], by_role(found)

    def one(role):
        got = roles.get(role, [])
        if len(got) != 1:
            bad.append(f"{role}: expected one window, found {len(got)}")
            return None
        return got[0]

    def want(w, path, value):
        here = w
        for key in path.split("."):
            here = here[key]
        if here != value:
            bad.append(f"{w['role']}.{path}: {here!r}, expected {value!r}")

    bubble, tatty = one("bubble"), one("tatty")
    if bubble is not None:
        panel = mode in ("expanded", "maximised")
        if mode == "hidden":
            want(bubble, "style.visible", False)
        else:
            want(bubble, "style.visible", True)
            want(bubble, "iconic", mode == "minimised")
            if mode != "minimised":  # an icon keeps the styles of the shape it had
                want(bubble, "ex.toolwindow", not panel)
                want(bubble, "ex.appwindow", panel)
                want(bubble, "ex.topmost", not panel)
                want(bubble, "alt_tab", panel)
            if mode == "maximised" and bubble["rect"] != bubble["work_area"]:
                bad.append(f"bubble.rect: {bubble['rect']}, expected the work area {bubble['work_area']}")
        if not bubble["children"]:
            bad.append("bubble: no WebView2 child windows — the runtime is gone")
    if tatty is not None:
        # Tatty never joins either list, and never takes the keyboard.
        want(tatty, "ex.toolwindow", True)
        want(tatty, "ex.noactivate", True)
        want(tatty, "alt_tab", False)
        # Tatty is his own window on the desktop: putting the panel down into the
        # taskbar leaves him where he is, and he is the way back to it.
        want(tatty, "style.visible", mode != "hidden")
        if mode != "hidden":
            want(tatty, "ex.topmost", True)
    stage = one("effects")
    if stage is not None:
        # The confetti's window: there all the time, seen only while something is
        # flying, and never in the way -- the mouse goes through it, it takes no
        # keyboard, and it is in neither list. Whether it is on screen is the
        # animation's business, not the view's, so that isn't asserted here.
        want(stage, "ex.transparent", True)
        want(stage, "ex.noactivate", True)
        want(stage, "ex.toolwindow", True)
        want(stage, "alt_tab", False)
    if want_proxy:
        # The button that is always there, except while the panel has one of its
        # own. It is a button and never a window: minimised for good, asking for
        # a taskbar place it would not otherwise get, refusing ever to come
        # forward, and so staying out of Alt-Tab.
        # Who has the button is asked of the window itself, not of the mode: a
        # panel down in the taskbar still has its own, which is what makes it
        # clickable, so the proxy must have stood down.
        panel_has_one = bubble is not None and bubble["style"]["visible"] and bubble["ex"]["appwindow"]
        got = roles.get("proxy", [])
        if panel_has_one:
            if got:
                bad.append("proxy: still has a button while the panel has one of its own")
        elif len(got) != 1:
            bad.append(f"proxy: expected one window, found {len(got)}")
        else:
            want(got[0], "style.visible", True)
            want(got[0], "iconic", True)
            want(got[0], "ex.appwindow", True)
            want(got[0], "ex.noactivate", True)
            want(got[0], "alt_tab", False)
            want(got[0], "style.sysmenu", True)
    return bad


# ------------------------------------------------------------- the switching

def devtools(port):
    sys.dont_write_bytecode = True  # leave no __pycache__ in tools/
    spec = importlib.util.spec_from_file_location("pagecheck", Path(__file__).with_name("page-check.py"))
    pc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pc)
    import urllib.request
    for _ in range(50):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=2))
            page = next(t for t in tabs if t.get("type") == "page" and "127.0.0.1" in t.get("url", ""))
            break
        except (OSError, StopIteration, ValueError):
            time.sleep(0.2)
    else:
        return None
    p = pc.Page(pc.ws_connect(page["webSocketDebuggerUrl"]))
    p.call("Runtime.enable")
    return p


def load_id(p):
    """The page's load id, counted in sessionStorage, which survives a reload in
    the same WebView2: if this changes, the page reloaded."""
    try:
        return p.js("window.ttLoad || null")
    except RuntimeError:
        return None


def identity(found):
    """What has to come through a mode switch alive: the window itself, and the
    WebView2 host windows under it. The render widget's own window is not in
    here -- it comes and goes with visibility, so hiding the panel drops it and
    showing it again makes a new one, with the page none the wiser."""
    b = next((w for w in found if w["role"] == "bubble"), None)
    if b is None:
        return None
    return {"hwnd": b["hwnd"],
            "runtime": sorted(c["hwnd"] for c in b["children"]
                              if c["class"].startswith("Chrome_WidgetWin"))}


def switch(p, mode, pid):
    """Click the page's own button for this mode, then report whether the window
    and its WebView2 children came through it alive."""
    before, was = identity(windows(pid)), load_id(p)
    clicked = p.js(f"(() => {{ const b = document.querySelector({json.dumps(BUTTON[mode])});"
                   f" if (!b) return 'no such button'; b.click(); return 'clicked'; }})()")
    time.sleep(1.5)
    after, now = identity(windows(pid)), load_id(p)
    out = {
        "mode": mode, "clicked": clicked,
        "same_hwnd": bool(before and after and before["hwnd"] == after["hwnd"]),
        "same_runtime": bool(before and after and before["runtime"] == after["runtime"]),
        "page_load": [was, now], "same_page": was == now,
        "before": before, "after": after,
    }
    return out


# ------------------------------------------------------------------ main

def main(argv):
    if sys.platform != "win32":
        print(json.dumps({"skip": "Tatty's windows are Windows-only"}))
        return 0

    def arg(name, cast=str):
        return cast(argv[argv.index(name) + 1]) if name in argv else None

    for name in ("--expect", "--switch"):
        if name in argv and arg(name) not in MODES:
            print(f"{name} wants one of: {' '.join(MODES)}", file=sys.stderr)
            return 2

    out = {"dpi_awareness": dpi_aware()}
    pid = arg("--pid", int)
    def report(found):
        """Tatty's own four windows are the whole story; --all adds the plumbing."""
        out["roles"] = {role: len(ws) for role, ws in sorted(by_role(found).items())}
        out["windows"] = found if "--all" in argv else \
            [w for w in found if w["role"] in ("bubble", "tatty", "proxy", "effects")]

    found = windows(pid)
    report(found)
    if not found:
        out["error"] = "no TtCompanion.exe window found — is Tatty open?"
        print(json.dumps(out, indent=1))
        return 1

    failed = False
    port = arg("--page", int)
    p = devtools(port) if port else None
    if port and p is None:
        out["error"] = "the companion's DevTools port never answered"
        failed = True
    if p is not None:
        out["page_load"] = load_id(p)
    mode = arg("--switch")
    if mode:
        if p is None:
            out["error"] = "--switch needs --page <devtools port> to drive the page"
            failed = True
        else:
            out["switch"] = switch(p, mode, pid)
            failed = failed or not all(out["switch"][k] for k in ("same_hwnd", "same_runtime", "same_page"))
            found = windows(pid)
            report(found)
    want = arg("--expect")
    if want:
        out["expect"] = want
        out["failures"] = check(found, want, want_proxy="--no-proxy" not in argv)
        failed = failed or bool(out["failures"])

    print(json.dumps(out, indent=1))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
