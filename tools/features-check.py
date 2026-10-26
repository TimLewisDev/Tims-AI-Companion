#!/usr/bin/env python3
"""features-check.py: walk Tatty's Features pages in a headless
Chromium browser (or a companion's WebView2, with `attach <port>`) the way a
person would: the home page's feature cards, one feature's overview (tracker,
documents, work units, timeline), a document, a [[wikilink]] inside it, Back,
the production mode's Jira board (from a sample board) and task boards
(check_tasks), and the design mode's User Stories board (check_stories). Uses
page-check.py's DevTools client. Standard library only.

usage: features-check.py <browser exe> <page url> [feature | --stories | --tasks | --export | --whiteboard | --tabs | --split | --chats]
       features-check.py attach <devtools port> [feature | --stories | --tasks | --export | --whiteboard | --tabs | --split | --chats]
--tabs only the workflow tabs on the Features page, from sample sessions (nothing is started);
--split only the documents split beside a workflow tab: it starts two sessions (no terminal opens), uses real mouse input and
writes nothing to the features, so a throwaway home is still best;
--chats only the chats: side chats from selected text and from a code block in a workflow's reply, the "+" on
either side of the split, a reload; it starts a session (no terminal opens) and sends messages, so run it on a
throwaway home whose server has a stand-in claude (TATTY_CLAUDE), or every message is a real turn;
--stories walks only the User Stories board (a root with a board under design/);
--tasks only the task boards (a root with a board under tasks/: the fixture's Sample);
--export only Export to Tasks from the first User Stories board. It writes task
files, so only ever on a throwaway root.
--whiteboard only the whiteboard: a new blank board with text, a comment and a
line, then a story added on the first User Stories board. It writes too: a
throwaway root and home only.
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
    # this feature's rail, not the one still on screen from the last feature
    wait(p, f"(document.querySelector('#page-feature .fnav h3') || {{}}).textContent === {json.dumps(feature)}")
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
                             wikilinks: document.querySelectorAll('.fmain .chcard a.doclink:not(.idlink)').length })""")
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


def check_ids(p, feature="Draft"):
    """Planning IDs as links (ids.js): in a document's View, in a question from a
    session working on the feature, the card a hovered link shows, and following
    one to its item. Edits nothing on disk; the question is the page's own, never asked."""
    res = {}
    if not open_doc(p, feature, "Challenges"):
        return {"ids": "no Challenges document in " + feature}
    wait(p, "document.querySelectorAll('.fmain a.idlink').length > 0")
    res["doc"] = p.js("[...document.querySelectorAll('.fmain a.idlink')].map(a => a.textContent + '>' + a.dataset.file).join(' ')")
    # CH1 is its own heading, never CH10's
    res["target"] = p.js("""(() => { const m = el('div', {}, mdNode('### CH10 — ten\\n### CH1 — one\\n- **R4:** four'));
                                     const only10 = el('div', {}, mdNode('### CH10 — ten'));
                                     return { ch1: (findTarget(m, 'CH1') || {}).textContent, r4: (findTarget(m, '^r4') || {}).textContent,
                                              ch1in10: findTarget(only10, 'CH1') }; })()""")
    # a hovered link shows its item's card
    p.js("""(() => { const a = [...document.querySelectorAll('.fmain a.idlink')].find(a => a.textContent === 'R2');
                     a.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); })()""")
    wait(p, "!!document.querySelector('.peek')")
    res["peek"] = p.js("(document.querySelector('.peek') || {}).innerText || ''")
    p.js("closePeek(); 1")
    # a wikilink's block id ([[Doc#^r1|R1]]) gets a card too
    p.js("""(() => { const a = [...document.querySelectorAll('.fmain .chcard a.doclink:not(.idlink)')].find(a => a.dataset.at === '^r1');
                     a.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); })()""")
    wait(p, "!!document.querySelector('.peek')")
    res["wikipeek"] = p.js("(document.querySelector('.peek') || {}).innerText || ''")
    p.js("closePeek(); 1")
    # a question from a session on this feature, with its IDs linked (and the answer key unchanged)
    p.js("""feed.append(questionCard({ type: 'ask', id: 'ids-check', source: 'check', feature: %s,
             questions: [{ question: 'Is CH1 settled by R1 and CD1?', options: [{ label: 'Yes', description: 'as P1 says' }, { label: 'No' }] }] })); 1""" % json.dumps(feature))
    wait(p, "document.querySelectorAll('#feed .card.ask:last-child a.idlink').length >= 4")
    res["question"] = p.js("""(() => { const c = document.querySelector('#feed .card.ask:last-child');
                                      return { links: [...c.querySelectorAll('a.idlink')].map(a => a.textContent), text: c.querySelector('.q .text').textContent }; })()""")
    p.js("""(() => { const a = [...document.querySelectorAll('#feed .card.ask:last-child a.idlink')].find(a => a.textContent === 'CD1');
                     a.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); })()""")
    wait(p, "!!document.querySelector('.peek')")
    res["rowpeek"] = p.js("(document.querySelector('.peek') || {}).innerText || ''")
    p.js("closePeek(); 1")
    p.js("""(() => { const a = [...document.querySelectorAll('#feed .card.ask:last-child a.idlink')].find(a => a.textContent === 'CH1');
                     a.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); })()""")
    wait(p, "!!document.querySelector('.peek .chcard')")
    res["chpeek"] = p.js("""(() => { const c = document.querySelector('.peek');
                                    return c ? { chips: [...c.querySelectorAll('.ch-top .chip')].map(x => x.textContent), text: c.innerText.slice(0, 120) } : null; })()""")
    p.js("closePeek(); 1")
    p.js("[...document.querySelectorAll('#feed .card.ask:last-child a.idlink')].find(a => a.textContent === 'R1').click(); 1")
    wait(p, "!!document.querySelector('.fmain .target-flash')")
    res["followed"] = {"hash": p.js("decodeURIComponent(location.hash)"),
                       "flash": p.js("(document.querySelector('.fmain .target-flash') || {}).textContent || ''"),
                       "picked": p.js("document.querySelectorAll('#feed .card.ask:last-child .opt.picked').length")}
    p.js("document.querySelector('#feed .card.ask:last-child').remove(); 1")
    return res


def check_tabs(p):
    """The workflow tabs, drawn from two sample sessions in the page (nothing is
    started; the page's api() and confirm() are stood in for while it runs): the
    Features tab and a tab for each session with its status dot, the tab on screen
    and its panel, × asking before it stops a session that is going and not for an
    ended one, the closed tab gone, and a tab that is not there."""
    res = {}
    p.js("""(() => {
      window.__real = { api, confirm };
      window.__asked = []; window.__posted = [];
      window.__sample = [
        { tag: 's-t1', feature: 'Demo', name: 'Demo : Workflow', status: 'running', started: Date.now() / 1000 - 60, project: 'p', command: '/tt-workflow', usage: null },
        { tag: 's-t2', feature: 'Draft', name: 'Draft : Workflow', status: 'ended', started: Date.now() / 1000 - 120, project: 'p', command: '/tt-workflow', usage: null }];
      window.confirm = m => { window.__asked.push(m); return true; };
      api = async (path, body) => {
        if (path === '/api/sessions') return window.__sample;
        if (path === '/api/session/stop') { window.__posted.push(body.tag); window.__sample = window.__sample.filter(s => s.tag !== body.tag); return { ok: true, killed: true, said: '' }; }
        return window.__real.api(path, body);
      };
      location.hash = '#home'; return 1; })()""")
    wait(p, "!!document.querySelector('#page-home .wtabs .wtab[data-tag]')")
    tabs = """[...document.querySelectorAll('#page-home .wtabs .wtab')].map(t => t.innerText.trim() + (t.classList.contains('on') ? ' *' : '') + ' ' + [...t.querySelectorAll('.wdot')].map(d => d.className.replace('wdot ', '')).join(''))"""
    res["onList"] = p.js(tabs)
    p.js("location.hash = '#workflows/s-t1'; 1")
    wait(p, "!!document.querySelector('#page-home .live-head')")
    res["onTab"] = {"tabs": p.js(tabs), "panel": p.js("document.querySelector('#page-home .live-head h4').textContent"),
                    "open": p.js("document.querySelector('#page-home .live-head button').textContent")}
    p.js("document.querySelector('#page-home .wtab[data-tag=\"s-t1\"] .x').click(); 1")
    wait(p, "location.hash === '#home' && !document.querySelector('#page-home .wtab[data-tag=\"s-t1\"]')")
    res["afterStop"] = {"asked": p.js("window.__asked.length"), "posted": p.js("window.__posted"), "tabs": p.js(tabs), "hash": p.js("location.hash")}
    p.js("document.querySelector('#page-home .wtab[data-tag=\"s-t2\"] .x').click(); 1")
    wait(p, "!document.querySelector('#page-home .wtab[data-tag]')")
    res["afterDismiss"] = {"asked": p.js("window.__asked.length"), "posted": p.js("window.__posted"), "tabs": p.js(tabs)}
    p.js("location.hash = '#workflows/s-nope'; 1")
    wait(p, "!!document.querySelector('#page-home .wtabs') && /isn.t here/.test(document.querySelector('#page-home').innerText)")
    res["gone"] = p.js("document.querySelector('#page-home').innerText.replace(/\\s+/g, ' ').trim()")
    p.js("api = window.__real.api; window.confirm = window.__real.confirm; location.hash = '#home'; 1")
    return res


def check_split(p):
    """The documents split beside a workflow tab, with a real session (started
    without opening a terminal) whose reply cites CH1 and R1 of the Draft feature:
    following a link opens it in the pane instead of leaving the workflow, tabs of
    its own (one per document, none twice), a link inside the pane stays there, the
    divider dragged with the mouse and moved with keys, the pane kept across another
    workflow tab and a reload, an unsaved edit asked about, and the pane closing with
    its last tab. Links elsewhere still navigate."""
    res = {}
    p.call("Emulation.setDeviceMetricsOverride", width=1400, height=900, deviceScaleFactor=1, mobile=False)
    HEAD = "((document.querySelector('.dpane .doc-head h2') || {}).textContent || '')"
    panes = """[...document.querySelectorAll('.dpane .wtab')].map(t => t.innerText.replace(/\\s+/g, ' ').trim() + (t.classList.contains('on') ? ' *' : ''))"""
    sizes = """(() => { const l = document.querySelector('.split-left'), s = document.querySelector('.split');
                 return l && s ? { left: Math.round(l.getBoundingClientRect().width), whole: Math.round(s.getBoundingClientRect().width),
                                   saved: localStorage.getItem('tt-split') } : null; })()"""
    p.js("window.confirm = m => { window.__asked.push(m); return window.__yes; }; window.__asked = []; window.__yes = true; location.hash = '#home'; 1")
    wait(p, "!!document.querySelector('#page-home .wtabs')")
    p.js("""window.__t = null; api('/api/root').then(r => Promise.all([
            api('/api/start', { name: 'Draft', row: 'workflow', project: r.root }),
            api('/api/start', { name: 'Demo', row: 'workflow', project: r.root })])).then(([a, b]) => {
              window.__t = [a.tag, b.tag];
              return api('/api/hello', { session: 'sess-d', tag: a.tag }).then(() => api('/api/activity', { tag: a.tag, kind: 'reply',
                text: 'The question is CH1, the requirement it concerns is R1, and the proposal is P1.' }));
            }); 1""")
    wait(p, "!!window.__t")
    tag = p.js("window.__t[0]")
    other = p.js("window.__t[1]")
    p.js(f"location.hash = '#workflows/' + encodeURIComponent('{tag}'); 1")
    wait(p, "document.querySelectorAll('.act.reply a.idlink').length >= 3")
    res["before"] = {"pane": p.js("!!document.querySelector('.dpane')"), "divider": p.js("!!document.querySelector('.split-div')"), "sizes": p.js(sizes)}
    click_link = lambda text: p.js(f"[...document.querySelectorAll('.act.reply a.idlink')].find(a => a.textContent === '{text}').click(); 1")
    click_link("CH1")
    wait(p, "!!document.querySelector('.dpane .doc-head') && !!document.querySelector('.dpane .target-flash')")
    res["ch1"] = {"hash": p.js("location.hash === '#workflows/' + encodeURIComponent(window.__t[0])"), "tabs": p.js(panes),
                  "doc": p.js(HEAD),
                  "flash": p.js("(document.querySelector('.dpane .target-flash') || { innerText: 'gone' }).innerText.slice(0, 50)"),
                  "workflowStill": p.js("!!document.querySelector('.split-left .live-head')")}
    click_link("R1")
    wait(p, "document.querySelectorAll('.dpane .wtab').length === 2 && /Plan/.test(HEAD)".replace("HEAD", HEAD))
    res["r1"] = {"tabs": p.js(panes), "doc": p.js(HEAD)}
    click_link("CH1")
    wait(p, "/Challenges/.test(HEAD)".replace("HEAD", HEAD))
    res["ch1Again"] = {"tabs": p.js(panes), "hash": p.js("location.hash === '#workflows/' + encodeURIComponent(window.__t[0])")}
    # right-clicking a link: our menu (not the browser's), Open / Open in side panel / Open in main panel
    menu = """[...document.querySelectorAll('.linkmenu button')].map(b => b.textContent + (b.disabled ? ' (off)' : ''))"""

    def right_click(target):
        prevented = p.js(f"""(() => {{ const a = {target}; const r = a.getBoundingClientRect();
                              return !a.dispatchEvent(new MouseEvent('contextmenu', {{ bubbles: true, cancelable: true, clientX: r.x + 4, clientY: r.y + 4 }})); }})()""")
        wait(p, "!!document.querySelector('.linkmenu')")
        return prevented

    reply_link = lambda text: f"[...document.querySelectorAll('.act.reply a.idlink')].find(a => a.textContent === '{text}')"
    prevented = right_click(reply_link("P1"))
    res["menuClosedDoc"] = {"prevented": prevented, "items": p.js(menu), "focused": p.js("document.activeElement.textContent")}
    p.js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1")
    res["menuEsc"] = p.js("!document.querySelector('.linkmenu')")
    right_click(reply_link("CH1"))
    res["menuOpenDoc"] = p.js(menu)
    p.js("[...document.querySelectorAll('.linkmenu button')].find(b => b.textContent === 'Navigate to').click(); 1")
    res["navigateTo"] = {"menuGone": p.js("!document.querySelector('.linkmenu')"), "tabs": p.js(panes), "doc": p.js(HEAD),
                         "hash": p.js("location.hash === '#workflows/' + encodeURIComponent(window.__t[0])")}
    right_click(reply_link("P1"))
    p.js("[...document.querySelectorAll('.linkmenu button')].find(b => b.textContent === 'Open in main panel').click(); 1")
    wait(p, "location.hash.startsWith('#feature/Draft/doc/')")
    res["mainPanel"] = {"hash": p.js("decodeURIComponent(location.hash)"), "pane": p.js("!!document.querySelector('.dpane')")}
    # off a workflow tab there is no side panel to open in
    p.js("location.hash = '#feature/Draft/doc/' + encodeURIComponent('Draft - Challenges.md'); 1")
    wait(p, "!!document.querySelector('#page-feature .fmain a.doclink')")
    right_click("document.querySelector('#page-feature .fmain a.doclink')")
    res["menuOffWorkflow"] = p.js(menu)
    p.js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 1")
    p.js(f"location.hash = '#workflows/' + encodeURIComponent('{tag}'); 1")
    wait(p, "document.querySelectorAll('.dpane .wtab').length === 2")
    res["afterMenus"] = {"tabs": p.js(panes), "doc": p.js(HEAD)}
    # a [[wikilink]] in the pane's document opens in the pane (its target is a tab already: that one comes up)
    p.js("[...document.querySelectorAll('.dpane a.doclink:not(.idlink)')].find(a => /Tech Plan/.test(a.dataset.doc)).click(); 1")
    wait(p, "/Plan/.test(HEAD)".replace("HEAD", HEAD))
    res["wikilink"] = {"tabs": p.js(panes), "hash": p.js("location.hash === '#workflows/' + encodeURIComponent(window.__t[0])")}
    # the divider: dragged with the mouse, moved with keys, reset, and kept to the minimums
    box = p.js("(() => { const r = document.querySelector('.split-div').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()")
    start = p.js(sizes)
    drag(p, box["x"], box["y"], box["x"] - 150, box["y"])
    time.sleep(0.2)
    res["drag"] = {"from": start["left"], "to": p.js(sizes), "now": p.js("document.querySelector('.split-div').getAttribute('aria-valuenow')")}
    box = p.js("(() => { const r = document.querySelector('.split-div').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()")
    drag(p, box["x"], box["y"], 5, box["y"])
    time.sleep(0.2)
    res["dragFarLeft"] = p.js(sizes)
    p.js("document.querySelector('.split-div').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); 1")
    res["arrowRight"] = p.js(sizes)
    p.js("document.querySelector('.split-div').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); 1")
    res["reset"] = p.js(sizes)
    # another workflow tab and back: the pane and its tabs stay
    p.js(f"location.hash = '#workflows/' + encodeURIComponent('{other}'); 1")
    wait(p, f"!!document.querySelector('.split-left .wtab.on[data-tag=\"{other}\"]')")
    res["otherTab"] = {"tabs": p.js(panes), "workflow": p.js("document.querySelector('.split-left .live-head h4').textContent")}
    p.js(f"location.hash = '#workflows/' + encodeURIComponent('{tag}'); 1")
    wait(p, f"!!document.querySelector('.split-left .wtab.on[data-tag=\"{tag}\"]')")
    res["back"] = {"tabs": p.js(panes), "doc": p.js(HEAD)}
    # a reload keeps the tabs and the divider
    p.js("location.reload(); 1")
    time.sleep(2)
    wait(p, "document.querySelectorAll('.dpane .wtab').length === 2 && !!document.querySelector('.dpane .doc-head')")
    res["reload"] = {"tabs": p.js(panes), "sizes": p.js(sizes)}
    # an unsaved edit is asked about before its tab closes
    p.js("window.confirm = m => { window.__asked.push(m); return window.__yes; }; window.__asked = []; window.__yes = false; 1")
    p.js("[...document.querySelectorAll('.dpane .mode-btn')].find(b => b.textContent === 'Edit').click(); 1")
    wait(p, "!!document.querySelector('.dpane textarea.doc-edit')")
    p.js("(() => { const t = document.querySelector('.dpane textarea.doc-edit'); t.value += '\\nunsaved'; t.dispatchEvent(new Event('input', { bubbles: true })); })(); 1")
    p.js("document.querySelector('.dpane .wtab.on .x').click(); 1")
    res["dirtyClose"] = {"asked": p.js("window.__asked"), "tabs": p.js(panes)}
    p.js("window.__yes = true; document.querySelector('.dpane .wtab.on .x').click(); 1")
    wait(p, "document.querySelectorAll('.dpane .wtab').length === 1")
    wait(p, HEAD + " !== ''")
    res["afterDiscard"] = {"tabs": p.js(panes), "doc": p.js(HEAD)}
    # the last tab closes the pane and its divider
    p.js("document.querySelector('.dpane .wtab .x').click(); 1")
    wait(p, "!document.querySelector('.dpane')")
    res["closed"] = {"pane": p.js("!!document.querySelector('.dpane')"), "divider": p.js("!!document.querySelector('.split-div')"), "sizes": p.js(sizes),
                     "stored": p.js("sessionStorage.getItem('tt-docpane')")}
    # the documents rail beside the workflow: its documents open in the side panel, and it collapses to a button
    rail = "document.querySelector('#page-home .frail')"
    labels = "[...document.querySelectorAll('#page-home .frail .fnav-item')].map(a => a.querySelector('span').textContent)"
    state = f"""(() => {{ const r = {rail}, n = r.querySelector('.fnav'), t = r.querySelector('.rail-toggle');
                  return {{ collapsed: r.classList.contains('collapsed'), navShown: getComputedStyle(n).display !== 'none', railWidth: Math.round(r.getBoundingClientRect().width),
                           split: Math.round(document.querySelector('.split').getBoundingClientRect().width), toggle: t.textContent + ' | ' + t.title,
                           stored: localStorage.getItem('tt-rail') }}; }})()"""
    res["rail"] = {"items": p.js(labels), "state": p.js(state)}
    p.js("[...document.querySelectorAll('#page-home .frail .fnav-item')].find(a => a.querySelector('span').textContent === 'Challenges').click(); 1")
    wait(p, "!!document.querySelector('.dpane .doc-head')")
    res["railOpen"] = {"hashStays": p.js(f"location.hash === '#workflows/' + encodeURIComponent('{tag}')"), "tabs": p.js(panes),
                       "marked": p.js("[...document.querySelectorAll('#page-home .frail .fnav-item.on')].map(a => a.querySelector('span').textContent)")}
    p.js("document.querySelector('#page-home .rail-toggle').click(); 1")
    res["railCollapsed"] = p.js(state)
    p.js("location.reload(); 1")
    time.sleep(2)
    wait(p, f"!!{rail} && !!document.querySelector('.dpane .doc-head')")
    res["railAfterReload"] = p.js(state)
    p.js("document.querySelector('#page-home .rail-toggle').click(); 1")
    res["railExpanded"] = p.js(state)
    p.js("document.querySelector('.dpane .wtab .x').click(); 1")
    wait(p, "!document.querySelector('.dpane')")
    p.js("location.hash = '#feature/Draft'; 1")
    wait(p, "!!document.querySelector('#page-feature .frail .fnav')")
    res["railOnFeaturePage"] = {"toggle": p.js("!!document.querySelector('#page-feature .frail .rail-toggle')"),
                                "items": p.js("[...document.querySelectorAll('#page-feature .fnav-item')].map(a => a.querySelector('span').textContent)"),
                                "stillNavigates": p.js("document.querySelector('#page-feature .fnav-item[href*=\"/doc/\"]').getAttribute('href')")}
    # elsewhere a link still navigates
    p.js("location.hash = '#home'; 1")
    res["offWorkflow"] = p.js("(() => { const was = location.hash; return { opened: openInPane('Draft', 'Draft - Challenges.md', 'CH1'), unchanged: location.hash === was }; })()")
    return res


def check_chats(p):
    """Chats, with a real session (started without opening a terminal) whose reply
    holds a sentence and a code block: right-clicking selected text offers "Ask
    about this in a side chat", which opens a chat in the pane beside the workflow
    holding the text and its context, sent in front of the first message; a code
    block's own "Ask about it in a side chat"; the workflow still taking its
    activity meanwhile; the "+" in the pane's strip and in the workflow strip; the
    chats kept over a reload; a tab closed; and the old chat column gone. The
    server needs a stand-in claude (TATTY_CLAUDE) for the answers."""
    res = {}
    p.call("Emulation.setDeviceMetricsOverride", width=1400, height=900, deviceScaleFactor=1, mobile=False)
    panes = """[...document.querySelectorAll('.dpane .wtab')].map(t => t.innerText.replace(/\\s+/g, ' ').trim() + (t.classList.contains('on') ? ' *' : ''))"""
    menu = """[...document.querySelectorAll('.linkmenu button')].map(b => b.textContent + (b.disabled ? ' (off)' : ''))"""
    p.js("window.confirm = m => { (window.__asked = window.__asked || []).push(m); return true; }; location.hash = '#home'; 1")
    wait(p, "!!document.querySelector('#page-home .wtabs')")
    res["oldChat"] = p.js("""({ column: getComputedStyle(document.querySelector('.feed-col')).display,
                              box: !!document.querySelector('#say'), toggle: !!document.querySelector('#chat-toggle') })""")
    p.js("""window.__t = null; api('/api/root').then(r => api('/api/start', { name: 'Draft', row: 'workflow', project: r.root })).then(a => {
              window.__t = a.tag;
              return api('/api/hello', { session: 'sess-chat', tag: a.tag }).then(() => api('/api/activity', { tag: a.tag, kind: 'reply',
                text: 'Run the checks first.\\n\\n```bash\\nbash tools/test-tatty.sh\\n```\\n\\nThen retry the upload when they pass.' }));
            }); 1""")
    wait(p, "!!window.__t")
    tag = p.js("window.__t")
    p.js(f"location.hash = '#workflows/' + encodeURIComponent('{tag}'); 1")
    wait(p, "!!document.querySelector('.act.reply .codeblock')")
    res["codeBar"] = p.js("[...document.querySelectorAll('.act.reply .code-actions button')].map(b => b.textContent)")
    # a right-click with nothing selected is the browser's own
    res["noSelection"] = p.js("""(() => { getSelection().removeAllRanges(); const e = document.querySelector('.act.reply .md p');
                                 return { prevented: !e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
                                          menu: !!document.querySelector('.linkmenu') }; })()""")
    prevented = p.js("""(() => {
        const para = [...document.querySelectorAll('.act.reply .md p')].find(x => x.textContent.includes('retry the upload'));
        const tn = [...para.childNodes].find(n => n.nodeType === 3 && n.textContent.includes('retry the upload'));
        const i = tn.textContent.indexOf('retry the upload'), r = document.createRange();
        r.setStart(tn, i); r.setEnd(tn, i + 'retry the upload'.length);
        getSelection().removeAllRanges(); getSelection().addRange(r);
        const b = para.getBoundingClientRect();
        return !para.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.x + 4, clientY: b.y + 4 })); })()""")
    wait(p, "!!document.querySelector('.linkmenu')")
    res["selectionMenu"] = {"prevented": prevented, "items": p.js(menu)}
    p.js("[...document.querySelectorAll('.linkmenu button')].find(b => b.textContent === 'Ask about this in a side chat').click(); 1")
    wait(p, "!!document.querySelector('.dpane .chat .chat-context')")
    res["sideChat"] = {"hashStays": p.js(f"location.hash === '#workflows/' + encodeURIComponent('{tag}')"),
                       "workflowStill": p.js("!!document.querySelector('.split-left .live-head')"),
                       "tabs": p.js(panes),
                       "summary": p.js("document.querySelector('.dpane .chat-summary').textContent"),
                       "selected": p.js("document.querySelector('.dpane .chat-selected').textContent"),
                       "around": p.js("(document.querySelector('.dpane .chat-around pre') || {}).textContent || ''"),
                       "focused": p.js("document.activeElement === document.querySelector('.dpane .chat-box')")}
    p.js("(() => { document.querySelector('.dpane .chat-box').value = 'Why retry?'; document.querySelector('.dpane .chat-form').requestSubmit(); })(); 1")
    wait(p, "!!document.querySelector('.dpane .chat-msg.claude')")
    res["answered"] = {"messages": p.js("[...document.querySelectorAll('.dpane .chat-msg')].map(m => m.innerText.replace(/\\s+/g, ' ').trim())"),
                       "contextSent": p.js("document.querySelector('.dpane .chat-context').classList.contains('sent')"),
                       "workflowRows": p.js("document.querySelectorAll('.split-left .act').length")}
    # the workflow carries on meanwhile
    p.js(f"api('/api/activity', {{ tag: '{tag}', kind: 'reply', text: 'The upload went through.' }}); 1")
    wait(p, "document.querySelectorAll('.split-left .act.reply').length === 2")
    res["workflowGoesOn"] = p.js("[...document.querySelectorAll('.split-left .act.reply')].map(r => r.innerText.replace(/\\s+/g, ' ').trim().slice(0, 40))")
    # a code block's own button
    p.js("document.querySelector('.split-left .act.reply .code-ask').click(); 1")
    wait(p, "document.querySelectorAll('.dpane .wtab.chat').length === 2 && !!document.querySelector('.dpane .chat-context')")
    res["codeChat"] = {"tabs": p.js(panes), "summary": p.js("document.querySelector('.dpane .chat-summary').textContent"),
                       "selected": p.js("document.querySelector('.dpane .chat-selected').textContent"),
                       "kind": p.js("document.querySelector('.dpane .chat-context summary strong').textContent")}
    # "+" in the pane's strip: a main chat beside the workflow
    p.js("document.querySelector('.dpane .wtab-add').click(); 1")
    wait(p, "document.querySelectorAll('.dpane .wtab.chat').length === 3")
    wait(p, "!!document.querySelector('.dpane .chat-head h3')")
    res["panePlus"] = {"tabs": p.js(panes), "head": p.js("document.querySelector('.dpane .chat-head').innerText.replace(/\\s+/g, ' ').trim()"),
                       "context": p.js("!!document.querySelector('.dpane .chat-context')")}
    # a reload keeps the pane's chats
    p.js("location.reload(); 1")
    time.sleep(2)
    wait(p, "document.querySelectorAll('.dpane .wtab.chat').length === 3 && !!document.querySelector('.dpane .chat-head h3')")
    res["afterReload"] = {"tabs": p.js(panes), "messages": p.js("document.querySelectorAll('.dpane .chat-msg:not(.dim)').length")}
    p.js("[...document.querySelectorAll('.dpane .wtab.chat a')][0].click(); 1")
    wait(p, "document.querySelectorAll('.dpane .chat-msg.claude').length === 1")
    res["firstAgain"] = p.js("[...document.querySelectorAll('.dpane .chat-msg')].map(m => m.innerText.replace(/\\s+/g, ' ').trim())")
    # "+" in the workflow strip: a chat in a tab of its own, with the pane still beside it
    p.js("document.querySelector('#page-home .split-left .wtabs .wtab-add').click(); 1")
    wait(p, "/^#chats\\//.test(location.hash) && !!document.querySelector('.split-left .chat-head h3')")
    res["stripPlus"] = {"hash": p.js("location.hash.split('/')[0]"),
                        "tabs": p.js("[...document.querySelectorAll('#page-home .split-left .wtabs .wtab')].map(t => t.innerText.replace(/\\s+/g, ' ').trim() + (t.classList.contains('on') ? ' *' : ''))"),
                        "pane": p.js(panes)}
    p.js("document.querySelector('#page-home .split-left .wtabs .wtab.chat.on .x').click(); 1")
    wait(p, "location.hash === '#home'")
    res["stripClosed"] = {"hash": p.js("location.hash"), "chatTabs": p.js("document.querySelectorAll('#page-home .wtabs .wtab.chat').length")}
    # × on a pane chat closes the chat
    p.js(f"location.hash = '#workflows/' + encodeURIComponent('{tag}'); 1")
    wait(p, "document.querySelectorAll('.dpane .wtab.chat').length === 3")
    p.js("document.querySelector('.dpane .wtab.chat.on .x').click(); 1")
    wait(p, "document.querySelectorAll('.dpane .wtab.chat').length === 2")
    res["paneClosed"] = {"tabs": p.js(panes)}
    p.js("window.__open = null; api('/api/chats').then(l => { window.__open = l.length; }); 1")
    wait(p, "window.__open !== null")
    res["openChats"] = p.js("window.__open")
    for _ in range(2):
        p.js("document.querySelector('.dpane .wtab.chat .x').click(); 1")
        time.sleep(0.4)
    wait(p, "!document.querySelector('.dpane')")
    res["paneGone"] = p.js("!document.querySelector('.dpane')")
    p.js("location.hash = '#home'; 1")
    return res


def check_jira(p):
    """The Jira board, drawn from a sample board in the page (nothing is fetched
    from Jira, nothing started): its columns, a ticket's panel, Esc, and the nav
    item shown in the production mode only."""
    res = {}
    was = p.js("({ modes: installedModes, mode: currentMode })")
    p.js("setInstalledModes(['engineering', 'production']); applyMode('engineering'); 1")
    res["navInEngineering"] = p.js("!document.querySelector('.pnav a[data-page=jira]').classList.contains('hidden')")
    p.js("location.hash = '#jira'; 1")
    # the page's own (empty) board first, so the sample isn't drawn over by it
    wait(p, "currentMode === 'production' && !!document.querySelector('#page-jira.on .jira-page')")
    res["mode"] = p.js("currentMode")
    res["navInProduction"] = p.js("!document.querySelector('.pnav a[data-page=jira]').classList.contains('hidden')")
    p.js("""(() => {
      const t = (key, status, cat, type) => ({ key, summary: 'Sample ' + key, type, status, statusCategory: cat, priority: 'P3',
                                              parent: { key: 'S-9', summary: 'The epic' }, url: 'https://example.atlassian.net/browse/' + key });
      jiraNow = { fetchedAt: Date.now() / 1000 - 120, site: 'example.atlassian.net', jql: 'assignee = currentUser()',
                  usage: { tokens: 16000, seconds: 18 }, busy: [], started: { 'S-4': 'S-4 - Sample S-4' }, project: '', cached: [],
                  issues: [t('S-1', 'Closed', 'done', 'Task'), t('S-2', 'Open', 'todo', 'Bug'), t('S-3', 'In Review', 'inprogress', 'Story'),
                           t('S-4', 'Open', 'todo', 'Story')] };
      jiraDetail.set('S-2', { key: 'S-2', description: '### Steps\\n\\n1. Open it', labels: ['ui'], fetchedAt: Date.now() / 1000 });
      drawJira(); })(); 1""")
    res["columns"] = p.js("[...document.querySelectorAll('#jira-board .jcol')].map(c => c.querySelector('h3').textContent)")
    res["cards"] = p.js("[...document.querySelectorAll('#jira-board .jcol')].map(c => c.querySelectorAll('.jcard').length)")
    res["startedCard"] = p.js("(document.querySelector('.jcard[data-key=S-4] .jstarted') || {}).textContent || ''")
    p.js("document.querySelector('.jcard[data-key=S-2]').click(); 1")
    wait(p, "!!document.querySelector('.jticket')")
    res["panel"] = p.js("""({ title: (document.querySelector('.jticket h3') || {}).textContent,
                             desc: (document.querySelector('.jticket .jdesc h3') || {}).textContent,
                             link: (document.querySelector('.jticket-head a') || {}).href,
                             name: (document.querySelector('#jira-name') || {}).value,
                             startDisabled: (document.querySelector('#jira-start') || {}).disabled })""")
    p.js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 1")
    res["closedByEsc"] = p.js("!document.querySelector('.jticket') && !document.querySelector('.jshade')")
    p.js("document.querySelector('.jcard[data-key=S-3]').click(); 1")
    wait(p, "!!document.querySelector('.jticket')")
    res["notLoaded"] = p.js("""({ load: (document.querySelector('#jira-load') || {}).textContent, start: !!document.querySelector('#jira-start') })""")
    p.js("closeTicket(); 1")
    # a refresh running: what it is doing, and for how long
    p.js("jiraNow.busy = ['board']; jiraNow.since = { board: Date.now() / 1000 - 5 }; drawJira(); 1")
    res["progress"] = p.js("(document.querySelector('#jira-progress') || {}).textContent || ''")
    res["refreshDisabled"] = p.js("document.querySelector('#jira-refresh').disabled")
    # a page whose script didn't load says so, rather than staying blank
    p.js("window.renderJiraWas = renderJira; renderJira = undefined; route(); 1")
    res["staleServer"] = p.js("document.querySelector('#page-jira').textContent.slice(0, 40)")
    p.js("renderJira = window.renderJiraWas; 1")
    p.js(f"setInstalledModes({json.dumps(was['modes'])}); applyMode({json.dumps(was['mode'])}); jiraNow = null; jiraDetail.clear(); location.hash = '#home'; 1")
    return res


def mouse(p, kind, x, y, **extra):
    p.call("Input.dispatchMouseEvent", type=kind, x=x, y=y, button="left", buttons=1 if kind != "mouseReleased" else 0,
           clickCount=1, **extra)


def drag(p, x0, y0, x1, y1):
    mouse(p, "mousePressed", x0, y0)
    for i in range(1, 6):
        mouse(p, "mouseMoved", x0 + (x1 - x0) * i / 5, y0 + (y1 - y0) * i / 5)
    mouse(p, "mouseReleased", x1, y1)


def check_stories(p):
    """The User Stories board, with real mouse input: the boards list, a board's
    notes and group panel, panning, zooming, a group in focus (with and without
    reduced motion), a card opened and its edit form, and a note dragged and
    dragged back. Changes nothing in the stories document."""
    res = {}
    p.call("Emulation.setDeviceMetricsOverride", width=1400, height=900, deviceScaleFactor=1, mobile=False)
    p.js("location.hash = '#designs'; 1")
    wait(p, "document.querySelectorAll('#page-designs .board-card, #page-designs .empty-state').length > 0")
    res["list"] = p.js("[...document.querySelectorAll('#page-designs .board-card')].map(c => c.innerText.replace(/\\s+/g, ' ').trim())")
    if not res["list"]:
        return {**res, "board": "no board to open"}
    p.js("document.querySelector('#page-designs .board-card').click(); 1")
    wait(p, "document.querySelectorAll('#board .scard').length > 0")
    time.sleep(0.5)
    res["board"] = p.js("""({ cards: document.querySelectorAll('#board .scard').length,
                             proposed: document.querySelectorAll('#board .scard.proposed').length,
                             colours: [...new Set([...document.querySelectorAll('#board .scard')].map(c => (c.className.match(/\\bg(\\d|u)\\b/) || [''])[0]))],
                             groups: [...document.querySelectorAll('#group-panel .grow')].map(g => g.innerText.replace(/\\s+/g, ' ').trim()),
                             panelPinned: getComputedStyle(document.querySelector('#group-panel')).position,
                             zoom: document.querySelector('.zoom-pct').textContent,
                             noteBg: getComputedStyle(document.querySelector('#board .scard')).backgroundColor })""")
    box = p.js("(() => { const r = document.querySelector('#board').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()")
    bx, by = box[0] + 30, box[1] + box[3] - 60  # the board's bottom-left, clear of notes and the panel
    t0 = p.js("document.querySelector('#board-world').style.transform")
    drag(p, bx + 40, by - 20, bx + 140, by - 70)
    res["pan"] = {"before": t0, "after": p.js("document.querySelector('#board-world').style.transform")}
    p.call("Input.dispatchMouseEvent", type="mouseWheel", x=box[0] + box[2] / 2, y=box[1] + box[3] / 2, deltaX=0, deltaY=-240)
    time.sleep(0.2)
    res["wheel"] = {"zoom": p.js("document.querySelector('.zoom-pct').textContent"),
                    "transform": p.js("document.querySelector('#board-world').style.transform")}
    # a group in focus: once as this machine has it (reduced motion: a jump), once with motion
    for media in ("reduce", "no-preference"):
        p.call("Emulation.setEmulatedMedia", features=[{"name": "prefers-reduced-motion", "value": media}])
        before = p.js("document.querySelector('#board-world').style.transform")
        p.js("(() => { const g = document.querySelector('#group-panel .grow:not(.on) .gname'); if (g) g.click(); return 1; })()")
        res["focus-" + media] = p.js(f"""({{ group: (document.querySelector('#group-panel .grow.on') || {{}}).dataset ? document.querySelector('#group-panel .grow.on').dataset.group : '',
                                            hl: document.querySelectorAll('#board .scard.hl').length,
                                            dimmed: document.querySelectorAll('#board .scard.dim').length,
                                            frame: !document.querySelector('.gframe').hidden,
                                            easing: document.querySelector('#board-world').classList.contains('easing'),
                                            moved: document.querySelector('#board-world').style.transform !== {json.dumps(before)} }})""")
        p.js("document.querySelector('#group-panel .grow.on .gname') && document.querySelector('#group-panel .grow.on .gname').click(); 1")
    res["unfocus"] = p.js("document.querySelectorAll('#board .scard.hl, #board .scard.dim').length")
    p.js("document.querySelector('#board-fit').click(); 1")
    time.sleep(0.5)
    # a note dragged, then dragged back (its place is Tatty's own, not the document's)
    c = p.js("(() => { const n = document.querySelector('#board .scard'); const r = n.getBoundingClientRect(); return [n.dataset.id, r.left + 30, r.top + 20, n.style.left, n.style.top]; })()")
    drag(p, c[1], c[2], c[1] + 80, c[2] + 50)
    moved = p.js(f"(() => {{ const n = document.querySelector('#board .scard[data-id={json.dumps(c[0])}]'); return [n.style.left, n.style.top]; }})()")
    drag(p, c[1] + 80, c[2] + 50, c[1], c[2])
    res["drag"] = {"id": c[0], "from": c[3:5], "moved": moved, "overlay": p.js("!document.querySelector('#card-overlay').hidden")}
    # a click (no movement) opens the note
    mouse(p, "mousePressed", c[1], c[2])
    mouse(p, "mouseReleased", c[1], c[2])
    wait(p, "!document.querySelector('#card-overlay').hidden")
    res["open"] = p.js("""({ hash: decodeURIComponent(location.hash), title: (document.querySelector('.ocard .otitle') || {}).textContent || '',
                            criteria: document.querySelectorAll('.ocard .ocrit li').length,
                            proposedButtons: !!document.querySelector('#card-accept') })""")
    p.js("document.querySelector('#card-edit').click(); 1")
    res["edit"] = p.js("""({ title: (document.querySelector('#edit-title') || {}).value || '', group: (document.querySelector('#edit-group') || {}).value || '',
                            criteria: document.querySelectorAll('#edit-criteria input').length,
                            groupsOffered: [...document.querySelectorAll('#edit-group option')].map(o => o.value) })""")
    p.js("[...document.querySelectorAll('.oedit button')].find(b => b.textContent === 'Cancel').click(); 1")
    p.js("document.querySelector('.oclose').click(); 1")
    res["closed"] = {"overlay": p.js("document.querySelector('#card-overlay').hidden"), "hash": p.js("decodeURIComponent(location.hash)")}
    return res


def check_export(p):
    """Export to Tasks, clicked through: the panel on the first User Stories board
    (its accepted stories ticked, the boards offered), two of them exported, the
    task IDs on their notes, the backlog they land in, one task's panel, and the
    panel again without them. Writes task files: a throwaway root only."""
    res = {}
    p.js("location.hash = '#designs'; 1")
    wait(p, "document.querySelectorAll('#page-designs .board-card').length > 0")
    p.js("document.querySelector('#page-designs .board-card').click(); 1")
    if not wait(p, "!!document.querySelector('#export-tasks')"):
        return {"export": "no Export to Tasks button"}
    design = p.js("location.hash")
    p.js("document.querySelector('#export-tasks').click(); 1")
    wait(p, "!!document.querySelector('#export-go')")
    panel = """({ rows: [...document.querySelectorAll('#export-list .xrow')].map(r => r.innerText.replace(/\\s+/g, ' ').trim()),
                 groups: [...document.querySelectorAll('#export-list legend')].map(l => l.textContent),
                 ticked: document.querySelectorAll('#export-list input:checked').length,
                 boards: [...document.querySelectorAll('#export-board option')].map(o => o.textContent),
                 button: (document.querySelector('#export-go') || {}).textContent || '' })"""
    res["panel"] = p.js(panel)
    p.js("[...document.querySelectorAll('#export-list input')].slice(2).forEach(c => c.click()); 1")
    res["picked"] = p.js("document.querySelector('#export-go').textContent")
    p.js("document.querySelector('#export-go').click(); 1")
    wait(p, "!!document.querySelector('#export-open')")
    res["done"] = p.js("(document.querySelector('.xcard p') || {}).textContent || ''")
    wait(p, "document.querySelectorAll('#board .stask').length >= 2")
    res["chips"] = p.js("[...document.querySelectorAll('#board .stask')].map(c => c.closest('.scard').dataset.id + ':' + c.textContent)")
    p.js("document.querySelector('#export-open').click(); 1")
    wait(p, "document.querySelectorAll('#page-taskboard .trow').length > 0")
    res["backlog"] = {"hash": p.js("decodeURIComponent(location.hash)"), "mode": p.js("currentMode"),
                      "rows": p.js("[...document.querySelectorAll('#page-taskboard .trow')].map(r => r.dataset.id + ' ' + r.getAttribute('aria-label'))")}
    p.js("location.hash += '/task/' + document.querySelector('#page-taskboard .trow').dataset.id; 1")
    wait(p, "!!document.querySelector('.tpanel .tsection')")
    res["task"] = p.js("""({ sections: [...document.querySelectorAll('.tpanel .tsection h4')].map(h => h.textContent),
                            facts: [...document.querySelectorAll('.tpanel .jfacts dt')].map(d => d.textContent),
                            labels: (document.querySelector('#task-labels') || {}).value || '' })""")
    p.js(f"location.hash = {json.dumps(design)}; 1")
    wait(p, "!!document.querySelector('#export-tasks')")
    p.js("document.querySelector('#export-tasks').click(); 1")
    wait(p, "!!document.querySelector('#export-go') || !!document.querySelector('.xcard p')")
    time.sleep(0.3)
    res["again"] = p.js(panel)
    p.js("document.querySelector('.xcard .oclose').click(); 1")
    return res


def click(p, x, y):
    mouse(p, "mousePressed", x, y)
    mouse(p, "mouseReleased", x, y)


def key(p, name, code):
    for kind in ("keyDown", "keyUp"):
        p.call("Input.dispatchKeyEvent", type=kind, key=name, code=name, windowsVirtualKeyCode=code)


def check_whiteboard(p):
    """The whiteboard, with real mouse and keys: a new blank board, a text field
    written by the Text tool, a second by double-click, a comment pinned to the
    first, a line between the two texts with a label, the first text dragged
    (its comment and the line follow), all of it again after a reload, then the
    second text deleted (its line with it). Then on the first User Stories
    board, a story added with the Story tool where it was clicked. Writes: a
    throwaway root and home only."""
    res = {}
    try:
        whiteboard_steps(p, res)
    except Exception as e:  # report how far it got
        res["error"] = str(e)[:400]
    return res


def whiteboard_steps(p, res):
    p.call("Emulation.setDeviceMetricsOverride", width=1400, height=900, deviceScaleFactor=1, mobile=False)
    p.js("location.hash = '#whiteboards'; 1")
    wait(p, "!!document.querySelector('#new-wb')")
    res["nav"] = p.js("currentMode + ':' + !document.querySelector('.pnav a[data-page=whiteboards]').classList.contains('hidden')")
    p.js("document.querySelector('#new-wb').click(); document.querySelector('#wb-name').value = 'Plan'; document.querySelector('#wb-create').click(); 1")
    if not wait(p, "!!document.querySelector('#wboard')"):
        return {**res, "board": "the new whiteboard didn't open: " + p.js("document.querySelector('#wb-msg') ? document.querySelector('#wb-msg').textContent : location.hash")}
    res["empty"] = p.js("!document.querySelector('#wboard .wbempty').hidden")
    box = p.js("(() => { const r = document.querySelector('#wboard').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()")
    ax, ay = box[0] + 300, box[1] + 160
    bx, by = box[0] + 700, box[1] + 360
    server = "(async () => JSON.stringify(await api('/api/whiteboard?kind=blank&ref=Plan')))()"
    # a text field: the Text tool, a click, words, and a click away
    p.js("document.querySelector('#wboard .wbtool[data-tool=text]').click(); 1")
    click(p, ax, ay)
    res.setdefault("focused", []).append(wait(p, "document.activeElement && document.activeElement.classList.contains('wbtext-edit')"))
    p.call("Input.insertText", text="Hello **board**")
    click(p, box[0] + 900, box[1] + 560)
    wait(p, "!!document.querySelector('#wboard .wbtext .md strong')")
    # a second, by double-click on the background
    mouse(p, "mousePressed", bx, by)
    mouse(p, "mouseReleased", bx, by)
    p.call("Input.dispatchMouseEvent", type="mousePressed", x=bx, y=by, button="left", buttons=1, clickCount=2)
    p.call("Input.dispatchMouseEvent", type="mouseReleased", x=bx, y=by, button="left", buttons=0, clickCount=2)
    res.setdefault("focused", []).append(wait(p, "document.activeElement && document.activeElement.classList.contains('wbtext-edit')"))
    p.call("Input.insertText", text="Second")
    click(p, box[0] + 900, box[1] + 560)
    wait(p, "document.querySelectorAll('#wboard .wbtext').length === 2 && !document.querySelector('.wbtext-edit')")
    res["texts"] = p.js("[...document.querySelectorAll('#wboard .wbtext')].map(n => n.innerText.trim())")
    # a comment on the first text
    p.js("document.querySelector('#wboard .wbtool[data-tool=comment]').click(); 1")
    click(p, ax + 20, ay + 4)
    res["focused"].append(wait(p, "document.activeElement === document.querySelector('#wboard .wbbubble textarea')"))
    p.call("Input.insertText", text="Check this")
    res["commentTyped"] = p.js("({ active: (document.activeElement || {}).tagName, value: (document.querySelector('#wboard .wbbubble textarea') || {}).value })")
    p.js("document.querySelector('#wboard .wbbubble .primary').click(); 1")
    wait(p, "!document.querySelector('#wboard .wbbubble')")
    # a line from the first text to the second, then a label
    p.js("document.querySelector('#wboard .wbtool[data-tool=line]').click(); 1")
    click(p, ax + 40, ay + 6)
    click(p, bx + 20, by + 6)
    wait(p, "document.querySelectorAll('#wboard .wbline').length === 1")
    res["line"] = p.js("""({ lines: document.querySelectorAll('#wboard .wbline').length, arrow: !!document.querySelector('#wboard .wbstroke[marker-end]'),
                            pop: !document.querySelector('#wboard .wbpop').hidden, tool: document.querySelector('#wboard').dataset.tool })""")
    p.js("(() => { const i = document.querySelector('#wboard .wblabel-in'); i.value = 'leads to'; i.dispatchEvent(new Event('change')); return 1; })()")
    time.sleep(0.4)
    res["label"] = p.js("(document.querySelector('#wboard .wblabel') || {}).textContent || ''")
    saved = json.loads(p.js(server))
    res["saved"] = {"items": sorted((v["type"], v["text"]) for v in saved["items"].values()),
                    "pinned": any(v["pin"] in saved["items"] for v in saved["items"].values() if v["type"] == "comment"),
                    "lines": [(l["label"], l["arrow"]) for l in saved["lines"].values()]}
    # drag the first text: its comment and the line's end follow
    before = p.js("""({ d: document.querySelector('#wboard .wbstroke').getAttribute('d'), c: document.querySelector('#wboard .wbcomment').style.left })""")
    drag(p, ax + 60, ay + 6, ax + 60, ay + 126)
    time.sleep(0.4)
    after = p.js("""({ d: document.querySelector('#wboard .wbstroke').getAttribute('d'), c: document.querySelector('#wboard .wbcomment').style.top })""")
    res["drag"] = {"lineMoved": before["d"] != after["d"], "commentTop": after["c"]}
    # after a reload, all of it is still there
    p.js("location.reload(); 1")
    time.sleep(1.5)
    wait(p, "document.querySelectorAll('#wboard .wbtext').length === 2")
    res["reloaded"] = p.js("""({ texts: document.querySelectorAll('#wboard .wbtext').length, comments: document.querySelectorAll('#wboard .wbcomment').length,
                                lines: document.querySelectorAll('#wboard .wbline').length, label: (document.querySelector('#wboard .wblabel') || {}).textContent || '' })""")
    # delete the second text: select it, Delete; its line goes too
    c2 = p.js("(() => { const n = [...document.querySelectorAll('#wboard .wbtext')].find(n => n.innerText.includes('Second')); const r = n.getBoundingClientRect(); return [r.left + 20, r.top + 10]; })()")
    click(p, c2[0], c2[1])
    key(p, "Delete", 46)
    time.sleep(0.5)
    res["deleted"] = p.js("({ texts: document.querySelectorAll('#wboard .wbtext').length, lines: document.querySelectorAll('#wboard .wbline').length })")
    # a story where the Story tool was clicked, on the first User Stories board
    p.js("location.hash = '#designs'; 1")
    wait(p, "document.querySelectorAll('#page-designs .board-card').length > 0")
    p.js("document.querySelector('#page-designs .board-card').click(); 1")
    if not wait(p, "!!document.querySelector('#board .wbtool[data-tool=story]')"):
        return {**res, "story": "no Story tool"}
    n0 = p.js("document.querySelectorAll('#board .scard').length")
    r = p.js("(() => { const r = document.querySelector('#board').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()")
    spot = None
    for fx, fy in ((0.55, 0.92), (0.35, 0.92), (0.75, 0.92), (0.5, 0.6)):
        x, y = r[0] + r[2] * fx, r[1] + r[3] * fy
        if p.js(f"(() => {{ const t = document.elementFromPoint({x}, {y}); return !!t && !t.closest('.scard, .wbui, .wbtext, .wbcomment'); }})()"):
            spot = (x, y)
            break
    p.js("document.querySelector('#board .wbtool[data-tool=story]').click(); 1")
    click(p, *spot)
    wait(p, "!!document.querySelector('#edit-title')")
    p.js("""(() => { const set = (sel, v) => { const n = document.querySelector(sel); n.value = v; };
                   set('#edit-title', 'Throw an item'); set('.oedit input[aria-label="As a"]', 'player');
                   set('.oedit input[aria-label="I want"]', 'to throw items'); set('.oedit input[aria-label="so that"]', 'I can hit things');
                   set('#edit-criteria input', 'Given an item, when I throw it, then it flies');
                   document.querySelector('#edit-save').click(); return 1; })()""")
    wait(p, f"document.querySelectorAll('#board .scard').length === {n0 + 1}")
    res["story"] = p.js(f"""(() => {{ const n = [...document.querySelectorAll('#board .scard')].find(c => c.innerText.includes('Throw an item'));
                                    if (!n) return null; const r = n.getBoundingClientRect();
                                    return {{ id: n.dataset.id, dx: Math.round(r.left + r.width / 2 - {spot[0]}), overlayHidden: document.querySelector('#card-overlay').hidden }}; }})()""")
    # a feature's whiteboard: its documents as cards; a click opens one
    p.js("location.hash = '#feature/Demo/whiteboard'; 1")
    if wait(p, "document.querySelectorAll('#fboard .wbdoc').length > 0"):
        time.sleep(0.3)
        res["feature"] = p.js("""({ docs: document.querySelectorAll('#fboard .wbdoc').length, mode: currentMode,
                                  nav: (document.querySelector('.fnav-item.on') || {}).textContent || '' })""")
        c = p.js("(() => { const r = document.querySelector('#fboard .wbdoc').getBoundingClientRect(); return [r.left + 30, r.top + 20]; })()")
        click(p, *c)
        wait(p, "location.hash.includes('/doc/')")
        res["feature"]["opened"] = p.js("decodeURIComponent(location.hash)")
    else:
        res["feature"] = "no document cards"
    return res


def check_tasks(p):
    """The production mode's task boards, with real mouse input: the boards list,
    a board's columns, a card dragged to another column and back, a reorder in a
    column and back, a backlog card dragged onto the board and back, Alt+arrows,
    the task panel (Write/Preview, Cancel, Esc), the backlog list and the
    Completed page under both motion settings. Every move is undone and the done
    column is never used, so each task's file ends as it began (board.json's
    order may not: Alt+left puts a card at the end of its column)."""
    res = {}
    p.call("Emulation.setDeviceMetricsOverride", width=1400, height=900, deviceScaleFactor=1, mobile=False)
    was = p.js("({ modes: installedModes, mode: currentMode })")
    p.js("setInstalledModes(['engineering', 'production']); applyMode('engineering'); 1")
    res["navInEngineering"] = p.js("!document.querySelector('.pnav a[data-page=tasks]').classList.contains('hidden')")
    p.js("location.hash = '#tasks'; 1")
    wait(p, "currentMode === 'production' && document.querySelectorAll('#page-tasks .task-board-card, #page-tasks .empty-state').length > 0")
    res["navInProduction"] = p.js("!document.querySelector('.pnav a[data-page=tasks]').classList.contains('hidden')")
    res["list"] = p.js("[...document.querySelectorAll('#page-tasks .task-board-card')].map(c => c.innerText.replace(/\\s+/g, ' ').trim())")
    if not res["list"]:
        return {**res, "board": "no board to open"}
    name = p.js("document.querySelector('#page-tasks .task-board-card').dataset.board")
    p.js("document.querySelector('#page-tasks .task-board-card').click(); 1")
    wait(p, "document.querySelectorAll('#tasks-board .tcard').length > 0")
    cols = "[...document.querySelectorAll('#tasks-board .tcol[data-col]')].map(c => c.dataset.col + ':' + [...c.querySelectorAll('.tcard')].map(x => x.dataset.id).join(','))"
    res["board"] = {"columns": p.js("[...document.querySelectorAll('#tasks-board .tcol h3')].map(h => h.textContent)"), "cards": p.js(cols),
                    "clear": p.js("document.querySelector('#tasks-clear').textContent")}
    status = lambda tid: p.js(f"api('/api/tasks/task?name=' + encodeURIComponent({json.dumps(name)}) + '&id={tid}').then(d => d.status)")
    centre = lambda sel: p.js(f"(() => {{ const n = document.querySelector({json.dumps(sel)}); if (!n) return null; const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }})()")
    settle = lambda: (time.sleep(0.6), wait(p, "!document.querySelector('.tghost')"))

    # a card dragged from the first column to the second, then back
    first, second = p.js("[...document.querySelectorAll('#tasks-board .tcol[data-col^=c]')].slice(0, 2).map(c => c.dataset.col)")
    tid = p.js(f"document.querySelector('.tcol[data-col={first}] .tcard').dataset.id")
    a, b = centre(f".tcol[data-col={first}] .tcard[data-id='{tid}']"), centre(f".tcol[data-col={second}] .tcards")
    drag(p, a[0], a[1], b[0], b[1])
    settle()
    res["dragAcross"] = {"id": tid, "status": status(tid), "inSecond": p.js(f"!!document.querySelector('.tcol[data-col={second}] .tcard[data-id=\"{tid}\"]')"),
                         "live": p.js("document.querySelector('#tasks-live').textContent")}
    a, b = centre(f".tcard[data-id='{tid}']"), centre(f".tcol[data-col={first}] .tcard")
    drag(p, a[0], a[1], b[0], b[1] - 12)  # onto the top half of the first card: before it
    settle()
    res["dragBack"] = {"status": status(tid), "cards": p.js(cols)}

    # a reorder in the first column, and back
    ids = p.js(f"[...document.querySelectorAll('.tcol[data-col={first}] .tcard')].map(x => x.dataset.id)")
    if len(ids) >= 2:
        a, b = centre(f".tcard[data-id='{ids[0]}']"), p.js(f"(() => {{ const r = document.querySelector('.tcard[data-id=\"{ids[1]}\"]').getBoundingClientRect(); return [r.left + r.width / 2, r.bottom - 4]; }})()")
        drag(p, a[0], a[1], b[0], b[1] + 2)
        settle()
        res["reorder"] = p.js(f"[...document.querySelectorAll('.tcol[data-col={first}] .tcard')].map(x => x.dataset.id)")
        a, b = centre(f".tcard[data-id='{ids[0]}']"), centre(f".tcard[data-id='{ids[1]}']")
        drag(p, a[0], a[1], b[0], b[1] - 12)
        settle()
        res["reorderBack"] = p.js(f"[...document.querySelectorAll('.tcol[data-col={first}] .tcard')].map(x => x.dataset.id)")

    # the backlog rail: a card onto the board, and back
    if p.js("!document.querySelector('.tcol.trail')"):
        p.js("document.querySelector('#tasks-rail').click(); 1")
    back = p.js("(document.querySelector('.tcol.trail .tcard') || {}).dataset?.id || ''")
    if back:
        a, b = centre(f".tcol.trail .tcard[data-id='{back}']"), centre(f".tcol[data-col={first}] .tcards")
        drag(p, a[0], a[1], b[0], b[1] + 200)
        settle()
        res["fromBacklog"] = {"id": back, "status": status(back)}
        a, b = centre(f".tcard[data-id='{back}']"), centre(".tcol.trail .tcard")
        drag(p, a[0], a[1], b[0], b[1] - 12)
        settle()
        res["toBacklog"] = {"status": status(back), "railFirst": p.js("document.querySelector('.tcol.trail .tcard').dataset.id")}

    # Alt+→ and Alt+← on a focused card
    def key(k, code, vk):
        for kind in ("rawKeyDown", "keyUp"):
            p.call("Input.dispatchKeyEvent", type=kind, key=k, code=code, windowsVirtualKeyCode=vk, modifiers=1)
    p.js(f"document.querySelector('.tcard[data-id=\"{tid}\"]').focus(); 1")
    key("ArrowRight", "ArrowRight", 39)
    time.sleep(0.8)
    res["altRight"] = {"status": status(tid), "focused": p.js("(document.activeElement || {}).dataset?.id || ''"),
                       "live": p.js("document.querySelector('#tasks-live').textContent")}
    key("ArrowLeft", "ArrowLeft", 37)
    time.sleep(0.8)
    res["altLeft"] = {"status": status(tid), "cards": p.js(cols)}

    # a click (no movement) opens the panel; Write / Preview; Cancel; Esc
    a = centre(f".tcard[data-id='{tid}']")
    mouse(p, "mousePressed", a[0], a[1])
    mouse(p, "mouseReleased", a[0], a[1])
    wait(p, "!!document.querySelector('.tpanel #task-title')")
    res["panel"] = p.js("""({ hash: decodeURIComponent(location.hash), title: document.querySelector('#task-title').value,
                             status: document.querySelector('#task-status').selectedOptions[0].textContent,
                             preview: !document.querySelector('#task-preview').hidden, previewText: document.querySelector('#task-preview').innerText.slice(0, 60),
                             start: !!document.querySelector('#task-start'), sections: document.querySelectorAll('.tsection').length })""")
    p.js("document.querySelector('#task-write').click(); document.querySelector('#task-desc').value += ' (typed)'; 1")
    res["write"] = p.js("({ textarea: !document.querySelector('#task-desc').hidden, preview: document.querySelector('#task-preview').hidden })")
    p.js("document.querySelector('#task-show').click(); 1")
    res["previewTyped"] = p.js("document.querySelector('#task-preview').innerText.includes('(typed)')")
    p.js("window.confirm = () => true; document.querySelector('#task-cancel').click(); 1")
    res["cancelled"] = p.js("!document.querySelector('.tpanel') && !decodeURIComponent(location.hash).includes('/task/')")
    p.js("location.hash = location.hash + '/task/new'; 1")
    wait(p, "!!document.querySelector('.tpanel #task-title')")
    res["new"] = p.js("({ save: document.querySelector('#task-save').textContent, focus: document.activeElement.id })")
    p.js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); 1")
    res["closedByEsc"] = p.js("!document.querySelector('.tpanel') && !document.querySelector('.tshade')")

    # the backlog list, and Completed (its cheer is there whatever the motion setting)
    p.js("document.querySelector('.ttab[data-view=backlog]').click(); 1")
    wait(p, "!!document.querySelector('.tlist-page')")
    res["backlog"] = p.js("[...document.querySelectorAll('.tlist .tcard')].map(x => x.dataset.id)")
    for media in ("reduce", "no-preference"):
        p.call("Emulation.setEmulatedMedia", features=[{"name": "prefers-reduced-motion", "value": media}])
        p.js("location.hash = '#tasks/' + encodeURIComponent(" + json.dumps(name) + ") + '/completed'; 1")
        wait(p, "!!document.querySelector('#tasks-cheer')")
        res["completed-" + media] = p.js("""({ total: document.querySelector('#tasks-total').textContent,
                                               stats: [...document.querySelectorAll('.tstat')].map(s => s.innerText.replace(/\\s+/g, ' ')),
                                               cheer: document.querySelector('#tasks-cheer').textContent,
                                               bars: document.querySelectorAll('#tasks-weeks .tbar').length,
                                               barHeights: [...document.querySelectorAll('#tasks-weeks .tbar')].map(b => b.style.height).filter(h => h !== '3px'),
                                               rows: [...document.querySelectorAll('.tdone-list .tcard')].map(x => x.dataset.id),
                                               groups: [...document.querySelectorAll('.tgroup')].map(g => g.textContent) })""")
        p.js("location.hash = '#tasks/' + encodeURIComponent(" + json.dumps(name) + "); 1")
        wait(p, "!!document.querySelector('#tasks-board')")
    p.js(f"setInstalledModes({json.dumps(was['modes'])}); applyMode({json.dumps(was['mode'])}); location.hash = '#home'; 1")
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
        if feature in ("--stories", "--tasks", "--export", "--whiteboard", "--tabs", "--split", "--chats"):
            out[feature[2:]] = {"--stories": check_stories, "--tasks": check_tasks, "--export": check_export,
                                "--whiteboard": check_whiteboard, "--tabs": check_tabs, "--split": check_split,
                                "--chats": check_chats}[feature](p)
            print(json.dumps(out, indent=1))
            return 0
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
        p.js("document.querySelector('.fnav > .fnav-item[href*=\"/doc/\"]').click(); 1")
        wait(p, "!!document.querySelector('.fmain .doc-head')")
        out["doc"] = p.js("""({ hash: decodeURIComponent(location.hash), title: document.querySelector('.doc-head h2').textContent,
                              headings: document.querySelectorAll('.fmain .md h1, .fmain .md h2, .fmain .md h3').length,
                              doclinks: [...document.querySelectorAll('.fmain a.doclink:not(.idlink)')].map(a => a.dataset.doc) })""")
        # follow a [[wikilink]] that names another document of the feature
        followed = p.js("""(() => { const own = new Set([...document.querySelectorAll('.fnav-item')].map(a => a.querySelector('span').textContent));
                                    const a = [...document.querySelectorAll('.fmain a.doclink:not(.idlink)')].find(a => a.dataset.doc !== document.querySelector('.doc-head h2').textContent);
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
        out["ids"] = check_ids(p)
        out["tabs"] = check_tabs(p)
        out["split"] = check_split(p)
        out["jira"] = check_jira(p)
        out["tasks"] = check_tasks(p)
        out["stories"] = check_stories(p)  # last: it sets the viewport and the motion setting
        print(json.dumps(out, indent=1))
        return 0
    finally:
        if proc:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
