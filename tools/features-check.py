#!/usr/bin/env python3
"""features-check.py: walk Tatty's Features pages in a headless
Chromium browser (or a companion's WebView2, with `attach <port>`) the way a
person would: the home page's feature cards, one feature's overview (tracker,
documents, work units, timeline), a document, a [[wikilink]] inside it, and
Back. Uses page-check.py's DevTools client. Standard library only.

usage: features-check.py <browser exe> <page url> [feature]
       features-check.py attach <devtools port> [feature]
Prints one JSON object of what it found at each step.
"""

import importlib.util
import json
import os
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


def wait(p, expr, tries=40):
    for _ in range(tries):
        if p.js(expr):
            return True
        time.sleep(0.25)
    return False


def open_doc(p, feature, kind):
    """Open the feature's document of this kind (View mode); False if it has none."""
    p.js("sessionStorage.removeItem('tt-doc-mode'); 1")
    p.js(f"location.hash = '#feature/' + encodeURIComponent({json.dumps(feature)}); 1")
    wait(p, "!!document.querySelector('#page-feature .fnav')")
    found = p.js(f"""(() => {{ const a = [...document.querySelectorAll('.fnav > .fnav-item')].find(a => a.querySelector('span').textContent === {json.dumps(kind)});
                               if (!a) return false; a.click(); return true; }})()""")
    if found:
        wait(p, f"(document.querySelector('.doc-head h2') || {{}}).textContent === {json.dumps(kind)}")
    return found


def check_usage(p, feature):
    """The tokens-used widget: drawn from sample figures (nothing is started or
    changed), and, when the feature has a session to show, where it sits."""
    p.js(f"location.hash = '#feature/' + encodeURIComponent({json.dumps(feature)}); 1")
    wait(p, "!!document.querySelector('#page-feature .overview')")
    return p.js(r"""(() => {
      const full = usageWidget({ input: 1200, output: 340, cacheRead: 50000, cacheWrite: 800, model: 'm',
                                 context: { tokens: 150000, window: 200000 }, costUsd: 0.42 }).node;
      const small = usageWidget({ input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }, { compact: true }).node;
      const none = usageWidget(null).node;
      const on = document.querySelector('.overview .usage');
      return { full: full.innerText.replace(/\s+/g, ' ').trim(), bar: full.querySelector('.bar').className, barWidth: full.querySelector('.bar span').style.width,
               compact: small.innerText.trim(), empty: none.innerText.replace(/\s+/g, ' ').trim(),
               onPage: on ? { text: on.innerText.replace(/\s+/g, ' ').trim(), before: (on.nextElementSibling || {innerText: ''}).innerText.split('\n')[0] } : null };
    })()""")


def check_modes(p, feature):
    """A Challenges document in View (cards) and Edit (the markdown), and a document
    of another kind in View (the plain markdown). Edits nothing on disk."""
    res = {}
    if not open_doc(p, feature, "Challenges"):
        return {"challenges": "no Challenges document in " + feature}
    res["toggle"] = p.js("""({ buttons: [...document.querySelectorAll('.doc-head .mode-toggle button')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')),
                              aboveBody: document.querySelector('.doc-head').nextElementSibling.className })""")
    res["view"] = p.js("""({ cards: [...document.querySelectorAll('.fmain .chcard')].map(c => [c.querySelector('.ch-num, h3').textContent,
                                      [...c.querySelectorAll('.ch-top .chip')].map(x => x.textContent).join('/'),
                                      c.className.replace('card chcard', '').trim()]),
                             headings: document.querySelectorAll('.fmain .md h3').length,
                             stages: [...document.querySelectorAll('.fmain .ch-stage')].map(h => h.textContent),
                             summary: (document.querySelector('.ch-summary') || {}).innerText || '',
                             wikilinks: document.querySelectorAll('.fmain .chcard a.doclink').length })""")
    # a filter hides the other cards and the stages left empty
    p.js("[...document.querySelectorAll('.ch-filter')].find(b => b.dataset.value === 'blocking').click(); 1")
    res["filtered"] = p.js("""({ shown: document.querySelectorAll('.chcard:not(.hidden)').length,
                                sections: document.querySelectorAll('.ch-section:not(.hidden)').length })""")
    p.js("document.querySelector('.ch-filter.on').click(); 1")
    # a [[doc#CH3]] link finds its card by the heading text
    res["target"] = p.js("""(() => { const m = document.querySelector('.fmain'); const f = findTarget(m, 'CH3');
                                     return f ? f.textContent : null; })()""")
    p.js("[...document.querySelectorAll('.mode-toggle button')].find(b => b.textContent === 'Edit').click(); 1")
    res["edit"] = p.js("""({ textarea: (document.querySelector('.doc-body textarea') || {}).value?.slice(0, 40),
                            cards: document.querySelectorAll('.chcard').length,
                            saveDisabled: (document.querySelector('.ed-bar button') || {}).disabled,
                            remembered: sessionStorage.getItem('tt-doc-mode') })""")
    p.js("""(() => { const t = document.querySelector('.doc-body textarea'); t.value += '\\nTyped in the check\\n'; t.dispatchEvent(new Event('input')); })()""")
    res["dirty"] = p.js("""({ saveDisabled: document.querySelector('.ed-bar button').disabled, note: document.querySelector('.ed-bar .small').textContent })""")
    p.js("[...document.querySelectorAll('.ed-bar button')].find(b => b.textContent === 'Revert').click(); 1")
    res["reverted"] = p.js("document.querySelector('.ed-bar button').disabled")
    # a document of another kind has no viewer: its plain markdown, in either mode
    p.js("sessionStorage.setItem('tt-doc-mode', 'view'); 1")
    other = next((k for k in ("Comprehensive Tech Plan", "Task Status") if open_doc(p, feature, k)), None)
    res["other"] = other and p.js("""({ kind: document.querySelector('.doc-head h2').textContent, md: !!document.querySelector('.doc-body > .md'),
                                       cards: document.querySelectorAll('.chcard').length })""")
    # the legacy hand-written shape and a document that isn't Challenges at all
    res["parse"] = p.js("""(() => { const a = parseChallenges('# T\\n\\n## Requirements\\n- **CH1** What if? Resolved: R1 says so.\\n- **CH2** Next?\\n');
                                   const b = parseChallenges('# Nothing\\n\\nJust prose.\\n');
                                   const c = parseChallenges('---\\ntags: x\\n---\\n\\r\\n# T\\r\\n\\r\\n## S — challenged 2026-01-02 @ `abc`\\r\\n\\r\\n### CH7 — Seven\\r\\n- **Severity:** minor · **Target:** R1\\r\\n- **Outcome:** Open\\r\\n');
                                   return { legacy: a && a.stages[0].items.map(i => i.n + ':' + i.fields.outcome), none: b,
                                            crlf: c && [c.stages[0].name, c.stages[0].date, c.stages[0].items[0].fields.severity, c.stages[0].items[0].fields.target] };
                                 })()""")
    return res


def check_breakdown(p, feature):
    """A Task Breakdown as a ticket list: units and tickets that fold, status from the
    Task Status, a filter, Expand/Collapse all, and a link that opens a folded ticket."""
    if not open_doc(p, feature, "Task Breakdown"):
        return {"breakdown": "no Task Breakdown document in " + feature}
    res = {}
    wait(p, "document.querySelectorAll('.bdview .tk .tk-status .chip').length > 0")
    res["view"] = p.js("""({ units: document.querySelectorAll('.bdview details.wu').length,
                             unitsOpen: document.querySelectorAll('.bdview details.wu[open]').length,
                             tickets: [...document.querySelectorAll('.bdview details.tk')].map(d => d.querySelector('.ch-num').textContent + ' ' + d.querySelector('.tk-title span:last-child').textContent
                                        + ' | ' + [...d.querySelectorAll(':scope > summary > .chip')].map(c => c.textContent).join('/')),
                             open: document.querySelectorAll('.bdview details.tk[open]').length,
                             progress: [...document.querySelectorAll('.wu-progress .bar')].map(b => b.title),
                             unitStatus: [...document.querySelectorAll('.wu-status .chip')].map(c => c.textContent),
                             summary: (document.querySelector('.bd-toolbar .ch-summary') || {}).innerText || '',
                             plain: (document.querySelector('.bdview details.tk .tk-plain') || {}).textContent || '',
                             tail: document.querySelectorAll('.bdview details.bd-tail').length })""")
    p.js("document.querySelector('.bdview details.tk > summary').click(); 1")
    res["expanded"] = p.js("""(() => { const d = document.querySelector('.bdview details.tk'); return { open: d.open,
                               facts: [...d.querySelectorAll('.ch-facts dt')].map(x => x.textContent + '=' + x.nextElementSibling.textContent),
                               card: [...d.querySelectorAll('.tk-card strong')].map(x => x.textContent), checkbox: (document.querySelector('.wu-card') || {}).textContent.includes('☐') }; })()""")
    p.js("[...document.querySelectorAll('.bd-toolbar button')].find(b => b.textContent === 'Collapse all').click(); 1")
    res["collapsed"] = p.js("document.querySelectorAll('.bdview details[open]').length")
    p.js("[...document.querySelectorAll('.bd-toolbar button')].find(b => b.textContent === 'Expand all').click(); 1")
    res["expandedAll"] = p.js("document.querySelectorAll('.bdview details:not([open])').length")
    p.js("[...document.querySelectorAll('.ch-filter')].find(b => b.dataset.value === 'Done').click(); 1")
    res["filtered"] = p.js("""({ shown: [...document.querySelectorAll('.bdview details.tk:not(.hidden) .ch-num')].map(x => x.textContent),
                                 units: document.querySelectorAll('.bdview details.wu:not(.hidden)').length })""")
    p.js("document.querySelector('.ch-filter.on').click(); 1")
    # a [[Doc#T03]] link: the ticket is folded; following it opens it (and its unit)
    p.js("[...document.querySelectorAll('.bd-toolbar button')].find(b => b.textContent === 'Collapse all').click(); 1")
    res["target"] = p.js("""(() => { const m = document.querySelector('.fmain'); goToTarget(m, 'T03');
                                     const d = document.querySelector('.bdview details.tk:nth-of-type(1)');
                                     const t = [...document.querySelectorAll('.bdview details.tk')].find(x => x.querySelector('.ch-num').textContent === 'T03');
                                     return { ticket: t.open, unit: t.closest('details.wu').open }; })()""")
    # parseBreakdown / parseStatus on odd inputs (the samples are passed in as JSON strings)
    samples = {
        "fence": "# X: Task Breakdown\n\n## WU1 — One\n\n```checks\n## not a heading\n```\n\n### T01 — First\n\n**In plain English:** Does a thing.\n\n## Coverage\nAll of it.\n",
        "none": "# X: Task Breakdown\n\nJust prose.\n",
        "crlf": "---\ntags: x\n---\r\n# X\r\n\r\n## Task Map\r\n| ID | Task | Executor | Depends on | Work unit | Plan step | Traces to |\r\n"
                "|---|---|---|---|---|---|---|\r\n| T01 | Mapped | Agent | — | WU1 | §1 | R1 |\r\n\r\n## WU1 — One\r\n",
        "status": "# Status\n- State: x\n\n# Task Board\n| ID | Task | Status | Notes |\n|---|---|---|---|\n| T01 | a | Done | ok |\n",
    }
    res["parse"] = p.js("(() => { const s = " + json.dumps(samples) + """;
      const a = parseBreakdown(s.fence), crlf = parseBreakdown(s.crlf);
      return { fence: a && [a.units.length, a.units[0].tasks.map(t => t.id + ':' + t.plain), a.tail.map(t => t.title)], none: parseBreakdown(s.none),
               crlf: crlf && crlf.units[0].tasks.map(t => t.id + ':' + t.title + ':' + t.facts.executor + ':' + t.facts['plan step']),
               status: parseStatus(s.status) }; })()""")
    p.js("sessionStorage.removeItem('tt-doc-mode'); 1")
    return res


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    feature = argv[2] if len(argv) > 2 else "Demo"
    proc = None
    if argv[0] == "attach":
        port, url = int(argv[1]), None
    else:
        port, url = 9300 + os.getpid() % 500, argv[1]
        proc = subprocess.Popen([argv[0], "--headless=new", "--disable-gpu", "--no-first-run", "--window-size=1400,900",
                                 f"--user-data-dir={tempfile.mkdtemp()}", f"--remote-debugging-port={port}", "about:blank"],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=2))
                page = next(t for t in tabs if t.get("type") == "page" and (url or "127.0.0.1" in t.get("url", "")))
                break
            except (OSError, StopIteration, ValueError):
                time.sleep(0.2)
        else:
            print("the browser's DevTools port never answered", file=sys.stderr)
            return 2
        p = pc.Page(pc.ws_connect(page["webSocketDebuggerUrl"]))
        p.call("Runtime.enable")
        if url:
            p.call("Page.navigate", url=url)
            time.sleep(1)
            p.js("location.hash = '#home'; 1")  # a window opens on its mode's home page
        else:  # the companion: open its full panel on the Features page
            p.js("document.querySelector('#expand') && document.querySelector('#expand').click(); location.hash = '#home'; 1")
        out = {}
        wait(p, "document.querySelectorAll('#page-home .fcard, #page-home .root-setup').length > 0")
        out["home"] = p.js("""({ cards: [...document.querySelectorAll('#page-home .fcard')].map(c => c.querySelector('strong').textContent + ' · ' + c.querySelector('.chip:not(.route)').textContent),
                               setup: !!document.querySelector('#page-home .root-setup'),
                               bars: document.querySelectorAll('#page-home .fcard .bar span').length,
                               barWidth: (document.querySelector('#page-home .fcard .bar span') || {style: {}}).style.width || '' })""")
        p.js(f"location.hash = '#feature/' + encodeURIComponent({json.dumps(feature)}); 1")
        wait(p, "!!document.querySelector('#page-feature .tracker')")
        out["feature"] = p.js("""({ tracker: [...document.querySelectorAll('.tracker li')].map(li => li.querySelector('.label').textContent + ':' + li.className),
                                  substeps: [...document.querySelectorAll('.tracker .substeps .chip')].map(c => c.textContent + ':' + c.className.replace('chip ', '')),
                                  docs: [...document.querySelectorAll('.fnav > .fnav-item')].map(a => a.querySelector('span').textContent),
                                  notes: document.querySelectorAll('.fnav-notes .fnav-item').length,
                                  units: [...document.querySelectorAll('table.units tr')].map(tr => tr.innerText.replace(/\\s+/g, ' ').trim()),
                                  timeline: [...document.querySelectorAll('.timeline li')].map(li => li.innerText.replace(/\\s+/g, ' ').trim()),
                                  stand: (document.querySelector('.stand') || {}).innerText || '' })""")
        # open the first document from the left rail
        p.js("document.querySelectorAll('.fnav > .fnav-item')[1].click(); 1")
        wait(p, "!!document.querySelector('.fmain .doc-head')")
        out["doc"] = p.js("""({ hash: decodeURIComponent(location.hash), title: document.querySelector('.doc-head h2').textContent,
                              headings: document.querySelectorAll('.fmain .md h1, .fmain .md h2, .fmain .md h3').length,
                              doclinks: [...document.querySelectorAll('.fmain a.doclink')].map(a => a.dataset.doc) })""")
        # follow a [[wikilink]] that names another document of the feature
        followed = p.js("""(() => { const own = new Set([...document.querySelectorAll('.fnav-item')].map(a => a.querySelector('span').textContent));
                                    const a = [...document.querySelectorAll('.fmain a.doclink')].find(a => a.dataset.doc !== document.querySelector('.doc-head h2').textContent);
                                    if (!a) return 'no doclink'; a.click(); return a.dataset.doc; })()""")
        time.sleep(1.2)
        out["wikilink"] = {"clicked": followed, "hash": p.js("decodeURIComponent(location.hash)"),
                           "title": p.js("(document.querySelector('.doc-head h2') || {}).textContent || ''")}
        p.js("history.back(); history.back(); 1")
        time.sleep(1.2)
        out["back"] = {"hash": p.js("decodeURIComponent(location.hash)"), "overview": p.js("!!document.querySelector('.overview')")}
        out["usage"] = check_usage(p, feature)
        out["modes"] = check_modes(p, feature)
        out["breakdown"] = check_breakdown(p, feature)
        print(json.dumps(out, indent=1))
        return 0
    finally:
        if proc:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
