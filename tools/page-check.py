#!/usr/bin/env python3
"""page-check.py: load Tatty's page in a headless Chromium browser
(Edge or Chrome) over the DevTools protocol, wait for it to settle, then run
JavaScript in it: report what rendered, and optionally pick an answer to the
newest open question the way a person would. Standard library only.

usage: page-check.py <browser exe> <page url> [--answer <option label>] [--say <text>]
       page-check.py attach <devtools port> [--answer <option label>] [--say <text>]
Prints one JSON object: {"text": <the page's visible text>, "cards": n, "asks": n, ...}.
"""

import base64
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request


def ws_connect(url):
    host, rest = url[len("ws://"):].split("/", 1)
    h, p = host.split(":")
    s = socket.create_connection((h, int(p)), timeout=30)
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall((f"GET /{rest} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        buf += s.recv(4096)
    if b" 101 " not in buf.split(b"\r\n")[0]:
        raise RuntimeError(buf[:200])
    return s


def ws_send(s, text):
    data = text.encode()
    head = bytearray([0x81])
    n = len(data)
    if n < 126:
        head.append(0x80 | n)
    elif n < 65536:
        head += bytes([0x80 | 126]) + n.to_bytes(2, "big")
    else:
        head += bytes([0x80 | 127]) + n.to_bytes(8, "big")
    mask = os.urandom(4)
    s.sendall(bytes(head) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))


def recv_exact(s, n):
    out = b""
    while len(out) < n:
        chunk = s.recv(n - len(out))
        if not chunk:
            raise EOFError
        out += chunk
    return out


def ws_recv(s):
    msg = b""
    while True:
        b0, b1 = recv_exact(s, 2)
        n = b1 & 0x7F
        if n == 126:
            n = int.from_bytes(recv_exact(s, 2), "big")
        elif n == 127:
            n = int.from_bytes(recv_exact(s, 8), "big")
        msg += recv_exact(s, n)
        if b0 & 0x80:
            return msg.decode("utf-8", "replace")


class Page:
    def __init__(self, ws):
        self.ws, self.n = ws, 0

    def call(self, method, **params):
        self.n += 1
        ws_send(self.ws, json.dumps({"id": self.n, "method": method, "params": params}))
        while True:
            m = json.loads(ws_recv(self.ws))
            if m.get("id") == self.n:
                return m

    def js(self, expr):
        r = self.call("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        res = r.get("result", {})
        if "exceptionDetails" in res:
            raise RuntimeError(json.dumps(res["exceptionDetails"])[:500])
        return res.get("result", {}).get("value")


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    answer = argv[argv.index("--answer") + 1] if "--answer" in argv else None
    say = argv[argv.index("--say") + 1] if "--say" in argv else None
    # attach <port>: a page already open elsewhere (Tatty's companion, started
    # with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>)
    attach = argv[0] == "attach"
    proc = None
    if attach:
        port, url = int(argv[1]), None
    else:
        exe, url = argv[0], argv[1]
        port = 9300 + os.getpid() % 500
        profile = tempfile.mkdtemp()
        proc = subprocess.Popen([exe, "--headless=new", "--disable-gpu", "--no-first-run", f"--user-data-dir={profile}",
                                 f"--remote-debugging-port={port}", "about:blank"],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=2))
                page = next(t for t in tabs if t.get("type") == "page" and (not attach or "127.0.0.1" in t.get("url", "")))
                break
            except (OSError, StopIteration, ValueError):
                time.sleep(0.2)
        else:
            print("the browser's DevTools port never answered", file=sys.stderr)
            return 2
        p = Page(ws_connect(page["webSocketDebuggerUrl"]))
        p.call("Runtime.enable")
        if url:
            p.call("Page.navigate", url=url)
        out = {}
        for _ in range(60):  # until the status table and the feed have arrived
            time.sleep(0.5)
            ready = p.js("!!document.querySelector('#status-body table, #status-body .st, #status-body p:not(.dim)') && document.querySelector('#conn').textContent === 'connected'")
            if ready:
                break
        time.sleep(0.5)
        out["body_class"] = p.js("document.body.className")
        out["visible_cards"] = p.js("[...document.querySelectorAll('#feed > .card')].filter(c => c.offsetParent !== null).length")
        out["conn"] = p.js("document.querySelector('#conn').textContent")
        out["mod"] = p.js("document.querySelector('#mod').textContent")
        out["cards"] = p.js("document.querySelectorAll('#feed .card').length")
        out["asks"] = p.js("document.querySelectorAll('#feed .card.ask:not(.done)').length")
        out["status_rows"] = p.js("document.querySelectorAll('#status-body tbody tr').length")
        out["banner"] = p.js("(document.querySelector('#status-body pre.banner')||{}).textContent||''")
        out["markdown"] = p.js("[...document.querySelectorAll('#feed .md')].map(n => n.innerHTML).join('\\n')")
        if answer is not None:
            out["answered"] = p.js(f"""(() => {{
                const open = document.querySelectorAll('#feed .card.ask:not(.done)'); const card = open[open.length - 1];
                if (!card) return 'no open question';
                const opt = [...card.querySelectorAll('.opt')].find(o => o.textContent.includes({json.dumps(answer)}));
                if (!opt) return 'no such option';
                opt.click();
                const send = [...card.querySelectorAll('button')].find(b => b.textContent === 'Send answer');
                if (send.disabled) return 'send still disabled';
                send.click();
                return 'clicked';
            }})()""")
            time.sleep(1.5)
            out["done_cards"] = p.js("document.querySelectorAll('#feed .card.ask.done').length")
        if say is not None:
            p.js(f"document.querySelector('#say').value = {json.dumps(say)}; document.querySelector('#chat').requestSubmit(); 'sent'")
            time.sleep(1)
            out["you_cards"] = p.js("document.querySelectorAll('#feed .card.you').length")
        # A section finished: the card naming it, and the confetti over the page
        # (app.js's milestoneCard and confetti). The milestone is asked for
        # through the page's own api(), so no token is needed out here. The
        # pieces take themselves away as they land, which is checked after.
        # A headless browser asks for less motion by default, which is exactly
        # the path with no confetti in it, so say otherwise for this one check.
        p.call("Emulation.setEmulatedMedia",
               features=[{"name": "prefers-reduced-motion", "value": "no-preference"}])
        p.js("api('/api/milestone', { event: 'build.complete', prefix: 'Checked' })")
        time.sleep(0.6)
        out["milestone"] = p.js("""({
            cards: [...document.querySelectorAll('#feed .card.milestone')].map(c => c.innerText.replace(/\\s+/g, ' ')),
            big: document.querySelectorAll('#feed .card.milestone.big').length,
            confetti: document.querySelectorAll('.burst span').length,
            calm: window.matchMedia('(prefers-reduced-motion: reduce)').matches })""")
        time.sleep(3)
        out["confetti_cleared"] = p.js("document.querySelectorAll('.burst').length") == 0

        # The modes: the radio over the discipline plugins installed (the one on
        # screen -- the title bar's in the companion, the header's in a browser
        # tab), the landing page, a mode's home page, and that switching mode
        # changes the app's accent colour and the nav. TATTY_MODES on the server
        # fakes the plugins installed.
        was = p.js("currentMode")
        # the segments of the radio a person can see and click
        segs = "[...document.querySelectorAll('.mode-switch .mode-seg')].filter(b => b.offsetParent !== null)"
        out["modes"] = p.js("""({ installed: installedModes, current: currentMode,
            slots: [...document.querySelectorAll('.mode-switch')].filter(s => s.offsetParent !== null).map(s => s.dataset.slot),
            segments: """ + segs + """.map(b => b.textContent + (b.classList.contains('on') ? '*' : '')),
            pressed: """ + segs + """.filter(b => b.classList.contains('on')).map(b => { const s = getComputedStyle(b);
                       return { colour: s.color, background: s.backgroundColor, inset: s.boxShadow.includes('inset') }; }),
            dots: document.querySelectorAll('.mode-switch .mode-dot').length,
            nav: [...document.querySelectorAll('.pnav a')].filter(a => a.offsetParent !== null).map(a => a.textContent),
            accent: getComputedStyle(document.body).getPropertyValue('--accent').trim() })""")
        p.js("location.hash = '#modes'; 1")
        time.sleep(0.6)
        # every discipline is there: the ones installed to pick, the rest greyed
        # with an Add button (which this check never presses: it would install)
        out["landing"] = p.js("""({ hash: location.hash, heading: (document.querySelector('.page.on h2') || {}).textContent || '',
            cards: [...document.querySelectorAll('#page-modes .mode-card')].map(a => a.dataset.mode +
                     (a.classList.contains('off') ? ' (off: ' + [...a.querySelectorAll('.mode-add button')].map(b => b.textContent).join() + ')' : '')),
            greyed: [...document.querySelectorAll('#page-modes .mode-card.off')].map(a => getComputedStyle(a).opacity) })""")
        # the radio takes you into the mode you pick (a new page, so give the
        # hash a moment), in that mode's colour and with that mode's nav
        picked = p.js("""(() => {
            const seg = """ + segs + """.filter(b => !b.classList.contains('on'));
            const next = seg[seg.length - 1];
            if (!next) return "one mode installed";
            next.click();
            return next.textContent;
        })()""")
        time.sleep(0.6)
        out["switched"] = picked if picked == "one mode installed" else p.js("""({
            picked: currentMode, mode: document.body.dataset.mode,
            accent: getComputedStyle(document.body).getPropertyValue('--accent').trim(),
            page: [...document.querySelectorAll('.page.on')].map(s => s.id).join(),
            nav: [...document.querySelectorAll('.pnav a')].filter(a => a.offsetParent !== null).map(a => a.textContent),
            segments: """ + segs + """.map(b => b.textContent + (b.classList.contains('on') ? '*' : '')),
            pressed: """ + segs + """.filter(b => b.classList.contains('on')).map(b => { const s = getComputedStyle(b);
                       return { colour: s.color, background: s.backgroundColor, inset: s.boxShadow.includes('inset') }; }) })""")
        p.js("document.querySelector('.tabs button[data-tab=docs]').click()")
        for _ in range(30):
            time.sleep(0.5)
            if p.js("!!document.querySelector('#docs-body .md')"):
                break
        out["docs_headings"] = p.js("[...document.querySelectorAll('#docs-body h1,#docs-body h2,#docs-body h3,#docs-body h4')].map(h => h.textContent).slice(0, 5)")
        out["text"] = p.js("document.body.innerText")[:1500]
        # The mode is remembered: it is the colour on screen before the server
        # has said anything, and its home page is where a fresh window opens.
        p.js("location.reload(); 1")
        time.sleep(3)
        out["remembered"] = p.js("""({ stored: localStorage.getItem('tt-mode'), mode: document.body.dataset.mode,
            current: currentMode, page: [...document.querySelectorAll('.page.on')].map(s => s.id).join() })""")
        p.js(f"localStorage.setItem('tt-mode', {json.dumps(was or '')}); 1")  # leave the mode as it was

        # What is calling, in the bubble (app.js's alerts): a question and a
        # finished section say what they are, a question goes when answered, and
        # opening one takes the person to the page it is about. Only the bubble
        # has it, so only a page opened as the companion (?mode=companion) is asked.
        if p.js("companion"):
            p.js("document.body.classList.remove('expanded'); location.hash = ''; 1")
            p.js("api('/api/ask', { questions: [{ question: 'Shall the alert say so?', options: ['Yes', 'No'] }] })")
            time.sleep(1)
            asked = p.js("""({ shown: !document.querySelector('#alert').hidden,
                visible: document.querySelector('#alert').offsetParent !== null,
                text: document.querySelector('#alert').innerText.replace(/\\s+/g, ' ') })""")
            p.js("api('/api/reply', { id: [...asks.keys()].pop(), declined: true })")
            time.sleep(1)
            out["alert_question"] = {**asked, "gone": p.js("document.querySelector('#alert').hidden")}
            p.js("api('/api/milestone', { event: 'plan.signed_off', prefix: 'Alerted' })")
            time.sleep(1)
            finished = p.js("document.querySelector('#alert').innerText.replace(/\\s+/g, ' ')")
            p.js("pushAlert({ kind: 'milestone', key: 'check', title: 'Opened', sub: '', link: '#settings' })")
            p.js("document.querySelector('#alert').click()")
            time.sleep(1)
            out["alert_finished"] = {"text": finished, "opened": p.js("""({ expanded: document.body.classList.contains('expanded'),
                hash: location.hash, page: [...document.querySelectorAll('.page.on')].map(s => s.id).join(),
                left: alerts.map(a => a.key) })""")}
            p.js("document.body.classList.remove('expanded'); 1")
        print(json.dumps(out, indent=1))  # ASCII, whatever the console's code page
        return 0
    finally:
        if proc:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
