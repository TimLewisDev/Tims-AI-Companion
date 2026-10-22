#!/usr/bin/env python3
"""Tatty's window server: the local page (and the tray companion that shows it)
an agent session can show things in and ask questions through, and that
visualises the TT toolbox's workflow. Standard library only.

Tatty is a companion to the TT toolbox, never part of it: it reads the
toolbox's documents and ledger, and runs a few of its scripts read-only, found
through the toolbox's own pointer folders (see toolbox_core and
docs/toolbox-contract.md). The toolbox works the same with or without Tatty.

The server listens on 127.0.0.1 with a random port and token, written to
<home>/server.json. The agent side talks to it through the client commands
below (scripts/tatty.sh wraps them); the page talks to it over HTTP and an SSE
stream. Everything is held in memory; nothing is written but server.json, the
log and Tatty's own settings (the root folder, the projects chosen per feature).

usage: server.py serve  [--cwd DIR] [--bash PATH]       run in the foreground
       server.py open   [--cwd DIR] [--bash PATH] [--no-browser]
                                                        start it detached if needed, open the page
       server.py status                                 attached | attached (claude mod) | not open
       server.py url                                    the page's URL
       server.py stop                                   stop the server
       server.py show <kind> <title>                    body on stdin; kind text|markdown|table|status|reply
       server.py ask [--wait S]                         questions JSON on stdin
       server.py answer <id> [--wait S]                 keep waiting on an ask
       server.py listen [--wait S]                      the next message typed in the window

Home: $TATTY_HOME, else $CLAUDE_CONFIG_DIR/tatty, else ~/.claude/tatty.
Exit: 0 ok, 1 not open, 2 usage, 5 no answer yet, 6 declined (ask in the terminal).
"""

import collections
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent  # plugins/tatty: the plugin's folder (its install, or a checkout)
WEB = HERE / "web"
STATIC = {"index.html": "text/html", "app.js": "text/javascript", "features.js": "text/javascript",
          "views.js": "text/javascript", "style.css": "text/css"}
KINDS = {"text", "markdown", "table", "status", "reply"}
MAX_BODY = 1 << 20
MAX_WAIT = 55  # seconds one long-poll request may wait server-side
MOD_FRESH = 75  # seconds since the mod last polled for it to count as attached
NO_WINDOW = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def config_dir():
    return Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")


def home():
    """Tatty's own state: server.json and its log, the root setting, projects.tsv."""
    return Path(os.environ.get("TATTY_HOME") or config_dir() / "tatty")


def info_path():
    return home() / "server.json"


def plugin_version():
    try:
        return json.loads((PLUGIN / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8")).get("version", "0")
    except (OSError, ValueError):
        return "0"


def installed():
    """True when every session already loads Tatty: it runs from Claude Code's
    plugin cache, or it is installed at user scope (a folder marketplace is read
    in place, so its plugin runs from the checkout yet is installed). Only
    otherwise do the sessions Start opens need --plugin-dir."""
    if "/plugins/cache/" in PLUGIN.as_posix().lower():
        return True
    try:
        recorded = json.loads((config_dir() / "plugins" / "installed_plugins.json").read_text(encoding="utf-8"))
        return any(name.split("@")[0] == "tatty" and any(e.get("scope") == "user" for e in installs)
                   for name, installs in recorded.get("plugins", {}).items())
    except (OSError, ValueError, AttributeError, TypeError):
        return False


# ---------------------------------------------------------------- the toolbox
# Tatty reads the TT toolbox but the toolbox never knows about Tatty. Its core
# plugin keeps a pointer folder, ${TT_PLUGINS_HOME:-~/.claude/tt-plugins}/core,
# at its install; TATTY_TOOLBOX may name a toolbox checkout instead (for
# development and the tests). See docs/toolbox-contract.md.

TOOLBOX_MISSING = ("Tatty can't find the TT toolbox (its core plugin). Install the toolbox, "
                   "or set TATTY_TOOLBOX to a Tims-AI-Toolbox checkout.")


def toolbox_core():
    """The toolbox's core skills folder (holding tt-common, tt-guide, ...), or None."""
    tries = []
    own = os.environ.get("TATTY_TOOLBOX")
    if own:
        tries += [Path(own) / "plugins" / "core" / "skills", Path(own) / "skills", Path(own)]
    tries.append(Path(os.environ.get("TT_PLUGINS_HOME") or config_dir() / "tt-plugins") / "core" / "skills")
    return next((t for t in tries if (t / "tt-common" / "scripts" / "workflow-state.sh").is_file()), None)


def toolbox_script(rel):
    """A toolbox script, by its path under core's skills folder, or None."""
    core = toolbox_core()
    return core / rel if core and (core / rel).is_file() else None


# ---------------------------------------------------------------- state


class State:
    def __init__(self, cwd, bash):
        self.cwd = cwd
        self.bash = bash
        self.cond = threading.Condition()
        self.events = []  # [{seq, type, ...}], replayed to every page
        self.questions = {}  # id -> {questions, answers, declined}
        self.inbox = collections.defaultdict(collections.deque)  # tag -> typed messages ("" the main session)
        self.mod_seen = 0.0
        self.mod_session = ""
        self.sessions = {}  # tag -> a session Start opened (see start_session)
        self.last_activity = time.time()

    def touch(self):
        self.last_activity = time.time()

    def emit(self, type_, **data):
        with self.cond:
            ev = {"seq": len(self.events) + 1, "type": type_, "ts": time.time(), **data}
            self.events.append(ev)
            self.cond.notify_all()
            return ev

    def mod_attached(self):
        return time.time() - self.mod_seen < MOD_FRESH

    def session_view(self, s):
        """A started session as the page sees it. status: starting (opened, its
        mod not heard from yet), running, lost (not heard from lately), unseen
        (never heard from: the mod isn't loaded there), ended."""
        now = time.time()
        if s["status"] == "ended":
            status = "ended"
        elif s.get("seen") and now - s["seen"] < MOD_FRESH:
            status = "running"
        elif s.get("seen"):
            status = "lost"
        else:
            status = "starting" if now - s["started"] < 120 else "unseen"
        return {**s, "status": status}

    def session_event(self, tag):
        self.emit("session", **self.session_view(self.sessions[tag]))

    def wait_for(self, check, wait):
        """Wait up to `wait` seconds for check() to return something not None."""
        end = time.time() + max(0.0, min(wait, MAX_WAIT))
        with self.cond:
            while True:
                got = check()
                if got is not None:
                    return got
                left = end - time.time()
                if left <= 0:
                    return None
                self.cond.wait(left)


# ---------------------------------------------------------------- views

# The read-only toolbox scripts the page may run, by argv: no shell, nothing the
# page sends becomes a command, only an argument after a fixed script.
VIEWS = {
    "hello": ["tt-common/scripts/tatty.sh", "banner"],
    "where": ["tt-common/scripts/workflow-state.sh", "--tsv", "{dir}"],
    "connections": ["tt-connections/scripts/connections.sh", "status", "{dir}"],
    "about": ["tt-guide/scripts/guide.sh", "about", "{name}"],
    "start": ["tt-guide/scripts/guide.sh", "start"],
}


def run_view(state, name, query):
    spec = VIEWS.get(name)
    if not spec:
        return None
    d = query.get("dir", [state.cwd])[0] or state.cwd
    if not os.path.isdir(d):
        return {"exit": 2, "stdout": "", "stderr": f"no such folder: {d}"}
    topic = query.get("name", [""])[0]
    script = toolbox_script(spec[0])
    if not script:
        return {"exit": 2, "stdout": "", "stderr": TOOLBOX_MISSING}
    argv = [state.bash, str(script)]
    for a in spec[1:]:
        if a == "{dir}":
            argv.append(d)
        elif a == "{name}":
            argv.extend(topic.split() if topic else [])
        else:
            argv.append(a)
    try:
        # No window for the script, however the server itself was started.
        p = subprocess.run(argv, cwd=d, capture_output=True, timeout=90, stdin=subprocess.DEVNULL,
                           encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
        return {"exit": p.returncode, "stdout": p.stdout, "stderr": p.stderr}
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"exit": 2, "stdout": "", "stderr": str(e)}


# ---------------------------------------------------------------- features (Tatty's root)

# The documents a feature can have, in the order the workflow writes them.
DOC_ORDER = ["Familiarisation", "Comprehensive Tech Plan", "Tech Plan", "Tech Proposals", "Challenges",
             "Future Iterations", "Task Breakdown", "Task Status", "Lite Brief", "Debug Report"]
STATE_COLS = ["prefix", "kind", "phase", "skill", "verb", "arg", "text", "hint", "stage"]
LITE_PHASES = {"lite-focus", "lite-brief", "lite-exploring"}
DEBUG_PHASES = {"debugging", "debug-done", "debugged"}


def tatty_root():
    """(root, is_set). The same rule as scripts/tatty-root.sh: TATTY_ROOT, else the
    one line in <Tatty's home>/root, else ~/Tatty (unset)."""
    if os.environ.get("TATTY_ROOT"):
        return Path(os.environ["TATTY_ROOT"]), True
    setting = home() / "root"
    try:
        line = setting.read_text(encoding="utf-8").splitlines()[0].strip()
        if line:
            return Path(line), True
    except (OSError, IndexError):
        pass
    return Path.home() / "Tatty", False


def root_info():
    root, is_set = tatty_root()
    features = root / "features"
    return {"root": root.as_posix(), "features": features.as_posix(), "isSet": is_set,
            "exists": features.is_dir(), "default": (Path.home() / "Tatty").as_posix(), "picker": picker_argv() is not None}


def root_from_pick(path):
    """A folder picked as the root. One that is itself a features folder (and has
    no features folder inside) means its parent."""
    p = Path(path)
    if p.name.lower() == "features" and not (p / "features").is_dir() and p.parent != p:
        return p.parent.as_posix()
    return p.as_posix()


def picker_argv(build=False):
    """How to ask for a folder in Windows' own dialog: Tatty's companion exe in
    --pick-folder mode. TATTY_PICKER names a stand-in (a bash script taking
    the same --start/--out arguments), for tests. None where there is no picker.
    Without build it only says whether there could be one (no build is started)."""
    fake = os.environ.get("TATTY_PICKER")
    if fake:
        return ["bash", fake]
    if os.name != "nt":
        return None
    if COMPANION_EXE.exists():
        return [str(COMPANION_EXE)]
    if not build:
        import shutil
        return [str(COMPANION_EXE)] if shutil.which("dotnet") else None
    return [str(COMPANION_EXE)] if companion_ready() else None


def pick_folder(state, start, title=""):
    """Show the folder dialog and wait for the person (10 minutes at most): the folder, or None."""
    argv = picker_argv(build=True)
    if not argv:
        return None
    if argv[0] == "bash":
        argv[0] = state.bash
    out = home() / f"pick-{secrets.token_hex(4)}.txt"
    extra = ["--title", title] if title else []
    try:
        subprocess.run(argv + ["--pick-folder", "--start", start or str(Path.home()), "--out", str(out)] + extra,
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600)
        chosen = out.read_text(encoding="utf-8").strip() if out.exists() else ""
    except (OSError, subprocess.TimeoutExpired):
        chosen = ""
    finally:
        try:
            out.unlink()
        except OSError:
            pass
    return chosen or None


def quiet_run(state, argv, cwd=None, timeout=60):
    return subprocess.run(argv, cwd=cwd, capture_output=True, timeout=timeout, stdin=subprocess.DEVNULL,
                          encoding="utf-8", errors="replace", creationflags=NO_WINDOW)


def set_root(state, path, create):
    """Set the root through tatty-root.sh, which refuses relative paths and the Claude folder."""
    argv = [state.bash, str(PLUGIN / "scripts" / "tatty-root.sh"), "set", path] + (["--create"] if create else [])
    try:
        p = quiet_run(state, argv, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as e:
        return 2, str(e)
    return p.returncode, (p.stderr or p.stdout).strip()


def feature_dir(name):
    """The feature's folder, or None: a direct subfolder of <root>/features. It may
    be a link (a junction to a folder in a vault, say): the name is one plain path
    part, and documents are checked against where the folder really is (doc_path)."""
    if not name or name.startswith(".") or any(c in name for c in "/\\") or ".." in name:
        return None
    base = (tatty_root()[0] / "features").resolve()
    d = base / name
    return d if d.parent == base and d.is_dir() else None


def folder_keys(folder):
    """The ways a record elsewhere (a link, the ledger) may name this folder: as
    it is under features/, and where it really is when it is a link."""
    keys = {folder.as_posix().rstrip("/").lower()}
    try:
        keys.add(folder.resolve().as_posix().rstrip("/").lower())
    except OSError:
        pass
    return keys


def is_folder(path, folder):
    return str(path).replace("\\", "/").rstrip("/").lower() in folder_keys(folder)


def workflow_rows(state, folder):
    """The toolbox's own word on where the folder's features stand (workflow-state.sh --tsv)."""
    script = toolbox_script("tt-common/scripts/workflow-state.sh")
    if not script:
        return []
    try:
        p = quiet_run(state, [state.bash, str(script), "--tsv", folder.as_posix()], cwd=str(folder))
    except (OSError, subprocess.TimeoutExpired):
        return []
    return [dict(zip(STATE_COLS, line.split("\t"))) for line in p.stdout.splitlines() if line.strip()]


def route_of(phase, docs=(), notes=()):
    """full, lite, bug or new. The documents decide once a lite feature or a bug
    fix reaches building (its phase is then the same as a full feature's)."""
    kinds = {d["doc"] for d in docs if d["prefix"]}
    debugged = "Debug Report" in kinds or any(n["group"].endswith(" - Debug") for n in notes)
    if debugged or phase in DEBUG_PHASES:
        return "bug"
    if "Lite Brief" in kinds or phase in LITE_PHASES:
        return "lite"
    return "new" if phase in ("empty", "") else "full"


def command(row):
    """The next command a workflow-state row names, as the user types it."""
    if not row or row.get("skill") in ("-", "", None):
        return ""
    c = "/" + row["skill"]
    if row.get("verb"):
        c += " " + row["verb"]
    if row.get("arg"):
        c += f' "{row["arg"]}"'
    if row.get("hint"):
        c += " " + row["hint"]
    return c


def md_table(text, marker):
    """The first markdown table after the line starting with `marker`, as dicts
    keyed by its header (column order may change; names are what count)."""
    lines = text.replace("\r", "").split("\n")
    start = next((i for i, l in enumerate(lines) if l.strip().startswith(marker)), None)
    if start is None:
        return []
    head, rows = None, []
    for line in lines[start + 1:start + 400]:
        s = line.strip()
        if not s.startswith("|"):
            if head is None:
                continue
            break
        cells = [c.strip() for c in s.strip("|").split("|")]
        if head is None:
            head = cells
        elif not all(set(c) <= set("-: ") for c in cells):
            rows.append(dict(zip(head, cells)))
    return rows


def docs_of(folder):
    """The feature's documents, in workflow order: <Prefix> - <Doc>.md first, then other .md files."""
    out = []
    for f in folder.iterdir():
        if f.is_file() and f.suffix.lower() == ".md":
            prefix, _, doc = f.stem.rpartition(" - ")
            out.append({"file": f.name, "prefix": prefix, "doc": doc if prefix else f.stem,
                        "updated": f.stat().st_mtime})
    rank = {d: i for i, d in enumerate(DOC_ORDER)}
    return sorted(out, key=lambda d: (rank.get(d["doc"], len(DOC_ORDER)) if d["prefix"] else len(DOC_ORDER) + 1,
                                      d["prefix"], d["file"]))


def notes_of(folder):
    """The .tt/ working notes: focus and debug logs, step logs, results."""
    tt = folder / ".tt"
    out = []
    if tt.is_dir():
        for f in sorted(tt.rglob("*.md")):
            rel = f.relative_to(folder).as_posix()
            if rel.count("/") <= 4 and len(out) < 200:
                out.append({"file": rel, "group": f.relative_to(tt).parts[0], "name": f.stem,
                            "updated": f.stat().st_mtime})
    return out


def read_doc(folder, name):
    try:
        return (folder / name).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def events_of(folder):
    """Ledger rows for this folder, oldest first (tt-common/events.md)."""
    ledger = Path(os.environ.get("TT_EVENTS_HOME") or config_dir() / "tt-events") / "events.jsonl"
    out = []
    try:
        with open(ledger, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                if is_folder(ev.get("folder", ""), folder):
                    out.append({k: ev.get(k) for k in ("event", "ts", "prefix", "qualifier", "approx", "skill", "route")})
    except OSError:
        return []
    return sorted(out, key=lambda e: str(e.get("ts") or ""))


PLAN_EVENTS = {"Familiarisation": "plan.familiarisation_closed", "Requirements": "plan.requirements_closed",
               "Scope & Constraints": "plan.scope_closed", "Approach": "plan.approach_closed",
               "Technical Design": "plan.design_closed", "Whole plan": "plan.whole_closed", "Sign-off": "plan.signed_off"}


def stages_of(plan_text, events):
    """Planning stages: the draft plan's Stages table, or, once it is signed off
    (the table is removed then), every stage closed, dated from the ledger."""
    when = {e["event"]: e.get("ts") for e in events}
    rows = md_table(plan_text, "**Stages**") if plan_text else []
    if rows:
        return [{"stage": r.get("Stage", ""), "status": r.get("Status", ""), "ts": when.get(PLAN_EVENTS.get(r.get("Stage", "")))}
                for r in rows]
    if plan_text:
        return [{"stage": s, "status": "Closed", "ts": when.get(e)} for s, e in PLAN_EVENTS.items()]
    return []


def progress_of(status_text):
    """(units, tasks) from a Task Status: [{id, outcome, status}], {done, total}."""
    units = [{"id": r.get("ID", ""), "outcome": r.get("Outcome", ""), "status": r.get("Status", "")}
             for r in md_table(status_text, "# Work Unit Board")]
    tasks = [r.get("Status", "") for r in md_table(status_text, "# Task Board")]
    tasks = [t for t in tasks if t != "Dropped"]
    return units, {"done": sum(t in ("Done", "Implemented") for t in tasks), "total": len(tasks)}


def first_doc(docs, kind):
    return next((d["file"] for d in docs if d["doc"] == kind and d["prefix"]), None)


def feature_summary(state, folder, detail=False):
    """What the home page shows for a feature; with detail, everything the feature page needs."""
    rows = workflow_rows(state, folder)
    primary = next((r for r in rows if r.get("kind") == "primary"), rows[0] if rows else {})
    docs = docs_of(folder)
    notes = notes_of(folder)
    status = first_doc(docs, "Task Status")
    units, tasks = progress_of(read_doc(folder, status)) if status else ([], {"done": 0, "total": 0})
    stamps = [d["updated"] for d in docs + notes] or [folder.stat().st_mtime]
    out = {"name": folder.name, "folder": folder.as_posix(), "phase": primary.get("phase", ""),
           "route": route_of(primary.get("phase", ""), docs, notes), "stage": primary.get("stage", ""),
           "text": primary.get("text", ""), "next": command(primary), "updated": max(stamps),
           "docs": len(docs), "units": {"done": sum(u["status"] == "Done" for u in units), "total": len(units)},
           "tasks": tasks,
           "live": next(({"name": x["name"], "status": x["status"], "tag": x["tag"]} for x in sessions_of(state, folder)
                         if x["status"] in ("starting", "running", "lost")), None)}
    if detail:
        events = events_of(folder)
        plan = first_doc(docs, "Comprehensive Tech Plan")
        project, project_from = feature_project(folder, docs)
        out.update({"rows": rows, "workflowStep": workflow_row(folder), "toolbox": toolbox_core() is not None, "docList": docs, "notes": notes, "events": events, "unitList": units,
                    "stages": stages_of(read_doc(folder, plan) if plan else "", events),
                    "project": project, "projectFrom": project_from, "sessions": sessions_of(state, folder)})
    return out


def features_list(state):
    info = root_info()
    base = Path(info["features"])
    toolbox = toolbox_core() is not None
    if not base.is_dir():
        return {"root": info, "features": [], "toolbox": toolbox}
    folders = [d for d in base.iterdir() if d.is_dir() and not d.name.startswith(".")]
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=6) as pool:
        found = list(pool.map(lambda d: feature_summary(state, d), folders))
    return {"root": info, "features": sorted(found, key=lambda f: -f["updated"]), "toolbox": toolbox}


# ---------------------------------------------------------------- starting a session

def same_folder(a, b):
    return str(a).replace("\\", "/").rstrip("/").lower() == str(b).replace("\\", "/").rstrip("/").lower()


def chosen_projects():
    """feature folder -> project chosen for it on its page (<tatty home>/projects.tsv)."""
    out = {}
    try:
        for line in (home() / "projects.tsv").read_text(encoding="utf-8").splitlines():
            f, _, p = line.partition("\t")
            if f and p:
                out[f.replace("\\", "/").rstrip("/").lower()] = p
    except OSError:
        pass
    return out


def choose_project(folder, project):
    rows = chosen_projects()
    rows[folder.as_posix().rstrip("/").lower()] = Path(project).as_posix()
    home().mkdir(parents=True, exist_ok=True)
    (home() / "projects.tsv").write_text("".join(f"{f}\t{p}\n" for f, p in sorted(rows.items())), encoding="utf-8")


def feature_project(folder, docs):
    """The project (repo) a session for this feature starts in, and where that came from:
    chosen on its page, a tt-workflow(-lite) link, the events ledger, or a Repo path in its documents."""
    chosen = next((chosen_projects()[k] for k in folder_keys(folder) if k in chosen_projects()), None)
    if chosen and os.path.isdir(chosen):
        return chosen, "chosen"
    links = Path(os.environ.get("TT_WORKFLOW_HOME") or config_dir() / "tt-workflow")
    best = None
    for name in ("links.tsv", "lite-links.tsv"):
        try:
            for line in (links / name).read_text(encoding="utf-8").splitlines():
                cols = line.split("\t")
                if len(cols) >= 2 and is_folder(cols[1], folder) and os.path.isdir(cols[0]):
                    date = cols[2] if len(cols) > 2 else ""
                    if not best or date >= best[1]:
                        best = (cols[0], date)
        except OSError:
            pass
    if best:
        return best[0], "link"
    ledger =Path(os.environ.get("TT_EVENTS_HOME") or config_dir() / "tt-events") / "events.jsonl"
    try:
        found = None
        with open(ledger, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                if is_folder(ev.get("folder", ""), folder) and ev.get("project") and os.path.isdir(ev["project"]):
                    found = ev["project"]
        if found:
            return found, "ledger"
    except OSError:
        pass
    for kind in ("Task Breakdown", "Lite Brief", "Task Status", "Debug Report"):
        f = first_doc(docs, kind)
        for m in re.finditer(r"Repo[^`\n]*`([A-Za-z]:[/\\][^`]+|/[^`]+)`", read_doc(folder, f) if f else ""):
            if os.path.isdir(m.group(1)):
                return Path(m.group(1)).as_posix(), "docs"
    return None, None


PLACEHOLDER = re.compile(r"<([^<>]{1,60})>")  # what the person fills in: <idea, spec or ticket>


def workflow_row(folder):
    """The step every feature has: let the toolbox's tt-workflow carry it on (or,
    for a new feature, start it). It links the folder and works out the next step
    itself, so Tatty needs nothing more from the workflow than its usual command."""
    return {"prefix": "", "kind": "alt", "phase": "workflow", "skill": "tt-workflow", "verb": "",
            "arg": folder.as_posix(), "text": "Or let tt-workflow work out the next step and carry on.",
            "hint": "", "stage": "Workflow"}


def session_name(base):
    """<Feature> : <Stage>, with " (2)", " (3)", ... when an open Claude session has
    it already (live sessions keep a <pid>.json naming themselves)."""
    taken = set()
    for f in (config_dir() / "sessions").glob("*.json"):
        try:
            taken.add(json.loads(f.read_text(encoding="utf-8")).get("name", ""))
        except (OSError, ValueError):
            pass
    name, n = base, 2
    while name in taken:
        name, n = f"{base} ({n})", n + 1
    return name


def launch(state, project, name, prompt, tag):
    """Open a new terminal running claude in the project, named, started with the
    prompt, carrying TATTY_SESSION so Tatty's mod there reports to this window.
    From a checkout (not an install) the session loads this plugin with
    --plugin-dir. Windows Terminal, else a cmd window; elsewhere Terminal.app;
    else the command to run is given. TATTY_DRYRUN=1 opens nothing.
    Returns (ok, what happened or the command to run)."""
    import shlex
    import shutil
    claude = shutil.which("claude")
    if not claude:
        return False, "There's no claude command on this machine's PATH."
    args = [] if installed() else ["--plugin-dir", PLUGIN.as_posix()]
    exports = {"TATTY_SESSION": tag}
    if os.environ.get("TATTY_HOME"):
        exports["TATTY_HOME"] = Path(os.environ["TATTY_HOME"]).as_posix()
    run = " ".join(shlex.quote(a) for a in [Path(claude).as_posix(), *args, "-n", name, prompt])
    script = "\n".join([
        "#!/usr/bin/env bash",
        "export MSYS2_ARG_CONV_EXCL='*'",  # no path conversion of /tt-workflow and friends
        f"printf '\\033]0;%s\\007' {shlex.quote(name)}",  # the terminal tab's title
        *[f"export {k}={shlex.quote(v)}" for k, v in exports.items()],
        f"cd {shlex.quote(Path(project).as_posix())} || exit 1",
        f"exec {run}", ""])
    manual = f"cd {shlex.quote(Path(project).as_posix())} && " + " ".join(f"{k}={shlex.quote(v)}" for k, v in exports.items()) + " " + run
    if os.environ.get("TATTY_DRYRUN") == "1":
        return True, f"Name: {name}\nPrompt: {prompt}\nWould run: {manual}"
    out = Path(os.environ.get("TEMP") or os.environ.get("TMPDIR") or "/tmp") / f"tatty-session-{tag}.sh"
    out.write_text(script, encoding="utf-8", newline="\n")
    try:
        if os.name == "nt":
            bash = shutil.which(state.bash) or state.bash
            for argv in (["wt.exe", "-d", str(Path(project)), bash, str(out)],
                         ["cmd.exe", "/c", "start", "", "/D", str(Path(project)), bash, str(out)]):
                try:
                    if subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                      timeout=20, creationflags=NO_WINDOW).returncode == 0:
                        return True, f"opened a new terminal in {Path(project).as_posix()}"
                except (OSError, subprocess.TimeoutExpired):
                    continue
        elif sys.platform == "darwin":
            if subprocess.run(["osascript", "-e", f'tell application "Terminal" to do script "bash {out}"',
                               "-e", 'tell application "Terminal" to activate'], capture_output=True).returncode == 0:
                return True, f"opened Terminal in {project}"
    except OSError:
        pass
    return False, f"Open a new terminal and run:\n  {manual}"


def start_session(state, folder, body):
    """Open a new Claude session in the feature's project, started with one of
    its next commands (Tatty's own launcher). Returns (http code, answer)."""
    rows = workflow_rows(state, folder)
    try:
        row = workflow_row(folder) if body.get("row") == "workflow" else rows[int(body.get("row", 0))]
    except (ValueError, IndexError, TypeError):
        return 400, {"error": "no such step"}
    cmd = command(row)
    if not cmd:
        return 400, {"error": "nothing left to run"}
    values = body.get("values") or {}
    for ph in PLACEHOLDER.findall(cmd):
        v = " ".join(str(values.get(ph, "")).split())[:2000]
        if not v:
            return 400, {"error": f"say what goes in <{ph}>"}
        cmd = cmd.replace(f"<{ph}>", v, 1)
    project = str(body.get("project") or "").strip()
    if project:
        if not os.path.isdir(project):
            return 400, {"error": f"no such folder: {project}"}
        choose_project(folder, project)
    else:
        project = feature_project(folder, docs_of(folder))[0]
    if not project:
        return 400, {"error": "choose the project this should run in"}
    if row.get("phase") in ("empty", "workflow"):
        base = f"{folder.name} : Start" if row.get("phase") == "empty" else f"{folder.name} : Workflow"
    else:
        base = f"{row.get('prefix') or folder.name} : {row.get('stage') or 'Next'}"
    name = session_name(base)
    # The new session carries a tag naming it (TATTY_SESSION): Tatty's mod there
    # joins this window and reports what it does, for this feature's page.
    tag = "s-" + secrets.token_hex(4)
    ok, said = launch(state, project, name, cmd, tag)
    answer = {"ok": ok, "name": name, "command": cmd, "project": project, "said": said, "tag": tag}
    if ok:
        with state.cond:
            state.sessions[tag] = {"tag": tag, "feature": folder.name, "folder": folder.as_posix(), "name": name,
                                   "command": cmd, "project": project, "started": time.time(), "status": "starting",
                                   "seen": 0.0, "claude": "", "doing": ""}
        state.session_event(tag)
    return 200, answer


NAME_REFUSED = re.compile(r'^\.{1,2}$|[/\\:*?"<>|]')  # the names workflow.sh new refuses


def new_feature(name):
    """Make <root>/features/<name> for a new feature: (http code, answer). The
    workflow takes it from there (Start runs /tt-workflow "<folder>")."""
    name = " ".join(str(name).split())
    if not name or NAME_REFUSED.search(name):
        return 400, {"error": "Not a usable folder name (no / \\ : * ? \" < > |)."}
    base = tatty_root()[0] / "features"
    if not base.is_dir():
        return 400, {"error": "Set Tatty's root folder first."}
    d = base / name
    if d.exists() and (not d.is_dir() or any(d.iterdir())):
        return 409, {"error": f"{name} already exists and isn't empty."}
    d.mkdir(parents=True, exist_ok=True)
    return 200, {"name": name, "folder": d.as_posix()}


def sessions_of(state, folder):
    """The sessions Start opened for this feature, newest first."""
    return sorted((state.session_view(s) for s in state.sessions.values() if is_folder(s["folder"], folder)),
                  key=lambda s: -s["started"])


def resolve_link(folder, target):
    """The document a [[wikilink]] names, as Obsidian finds it: by file name, any
    case, in this feature first (its documents, then its .tt notes), then in the
    other features under Tatty's root. (feature name, file) or None."""
    want = target.replace("\\", "/").split("/")[-1].strip()
    if want.lower().endswith(".md"):
        want = want[:-3]
    want = want.lower()
    if not want:
        return None
    base = folder.parent
    others = sorted((d for d in base.iterdir() if d.is_dir() and not d.name.startswith(".") and d != folder),
                    key=lambda d: d.name.lower()) if base.is_dir() else []
    for f in [folder] + others:
        for d in docs_of(f) + notes_of(f):
            if Path(d["file"]).stem.lower() == want:
                return f.name, d["file"]
    return None


def doc_path(folder, file):
    """The document's path, or None: a .md file in the feature folder or under its .tt/."""
    if not file or "\\" in file or ".." in file.split("/") or not file.lower().endswith(".md"):
        return None
    real = folder.resolve()
    p = (real / file).resolve()
    inside = p.parent == real or (real / ".tt").resolve() in p.parents
    return p if inside and p.is_file() else None


def save_doc(p, text, expected):
    """Write text over the document at p (from doc_path), but only if it hasn't
    changed since the page read it (expected is the mtime /api/doc gave): the
    toolbox's skills edit these files in place too. Returns (status, answer)."""
    if abs(p.stat().st_mtime - expected) > 1e-6:
        return 409, {"error": "the document changed on disk since you opened it", "updated": p.stat().st_mtime}
    # The page's text has \n line ends (it read them through text mode); keep the file's own.
    crlf = b"\r\n" in p.read_bytes()
    data = text.replace("\r\n", "\n").replace("\n", "\r\n" if crlf else "\n").encode("utf-8")
    tmp = p.with_name(f".{p.name}.tatty-tmp")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, p)
    except OSError as e:
        tmp.unlink(missing_ok=True)
        return 500, {"error": f"couldn't save: {e}"}
    return 200, {"updated": p.stat().st_mtime}


# ---------------------------------------------------------------- questions


def clean_questions(body):
    qs = body.get("questions") if isinstance(body, dict) else body
    if not isinstance(qs, list) or not 1 <= len(qs) <= 4:
        raise ValueError("questions: a list of 1 to 4")
    out = []
    for q in qs:
        if not isinstance(q, dict) or not str(q.get("question", "")).strip():
            raise ValueError("each question needs a question")
        opts = q.get("options") or []
        if not isinstance(opts, list) or not 2 <= len(opts) <= 4:
            raise ValueError("each question needs 2 to 4 options")
        clean = []
        for o in opts:
            if isinstance(o, str):
                o = {"label": o}
            if not isinstance(o, dict) or not str(o.get("label", "")).strip():
                raise ValueError("each option needs a label")
            clean.append({"label": str(o["label"]), "description": str(o.get("description", "")),
                          "preview": str(o.get("preview", ""))})
        out.append({"question": str(q["question"]), "header": str(q.get("header", ""))[:12],
                    "multiSelect": bool(q.get("multiSelect")), "options": clean})
    return out


# ---------------------------------------------------------------- HTTP


class Handler(BaseHTTPRequestHandler):
    server_version = "tatty/0.1"
    state: State = None
    token = ""
    port = 0

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    # -- helpers

    def send(self, code, body=b"", ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:")
        self.end_headers()
        self.wfile.write(body)

    def host_ok(self):
        host = self.headers.get("Host", "")
        return host in (f"127.0.0.1:{self.port}", f"localhost:{self.port}")

    def token_ok(self, query):
        got = self.headers.get("X-TT-Token") or query.get("token", [""])[0]
        return bool(got) and secrets.compare_digest(got, self.token)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("body too large")
        raw = self.rfile.read(n) if n else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def gate(self):
        """Parse the URL and refuse what isn't for us. Returns (path, query) or None."""
        u = urllib.parse.urlsplit(self.path)
        q = urllib.parse.parse_qs(u.query)
        if not self.host_ok():
            self.send(403, {"error": "bad host"})
            return None
        if (u.path.startswith("/api/") or u.path == "/events") and not self.token_ok(q):
            self.send(403, {"error": "bad token"})
            return None
        return u.path, q

    # -- GET

    def do_GET(self):
        g = self.gate()
        if not g:
            return
        path, q = g
        st = self.state
        if path in ("/", "/index.html"):
            return self.static("index.html")
        if path.startswith("/static/"):
            return self.static(path[len("/static/"):])
        if path == "/events":
            return self.sse(q)
        st.touch()
        if path == "/api/status":
            return self.send(200, {"open": True, "mod": st.mod_attached(), "cwd": st.cwd,
                                   "session": st.mod_session})
        if path == "/api/events":
            since = int(q.get("since", ["0"])[0] or 0)
            with st.cond:
                return self.send(200, st.events[since:])
        if path.startswith("/api/answer/"):
            qid = path[len("/api/answer/"):]
            wait = float(q.get("wait", ["0"])[0] or 0)
            if qid not in st.questions:
                return self.send(404, {"error": "no such question"})
            rec = st.questions[qid]
            got = st.wait_for(lambda: rec if (rec["answers"] is not None or rec["declined"]) else None, wait)
            if got is None:
                return self.send(200, {"status": "pending", "id": qid})
            if got["declined"]:
                return self.send(200, {"status": "declined", "id": qid})
            return self.send(200, {"status": "answered", "id": qid, "answers": got["answers"],
                                   "questions": got["questions"]})
        if path == "/api/inbox":
            wait = float(q.get("wait", ["0"])[0] or 0)
            tag = q.get("tag", [""])[0][:20]
            if tag:
                if tag in st.sessions:
                    was = st.session_view(st.sessions[tag])["status"]
                    st.sessions[tag]["seen"] = time.time()
                    if was != "running":
                        st.session_event(tag)
            elif q.get("client", [""])[0] == "claude-mod":
                st.mod_seen = time.time()
            box = st.inbox[tag]
            msg = st.wait_for(lambda: box.popleft() if box else None, wait)
            return self.send(200, {"status": "message", "text": msg} if msg is not None else {"status": "empty"})
        if path == "/api/sessions":
            folder = feature_dir(q.get("name", [""])[0])
            if not folder:
                return self.send(404, {"error": "no such feature"})
            return self.send(200, sessions_of(st, folder))
        if path == "/api/root":
            return self.send(200, root_info())
        if path == "/api/features":
            return self.send(200, features_list(st))
        if path == "/api/resolve":
            folder = feature_dir(q.get("name", [""])[0])
            if not folder:
                return self.send(404, {"error": "no such feature"})
            hit = resolve_link(folder, q.get("target", [""])[0])
            if not hit:
                return self.send(404, {"error": "no document by that name under Tatty's root"})
            return self.send(200, {"name": hit[0], "file": hit[1]})
        if path in ("/api/feature", "/api/doc"):
            folder = feature_dir(q.get("name", [""])[0])
            if not folder:
                return self.send(404, {"error": "no such feature"})
            if path == "/api/feature":
                return self.send(200, feature_summary(st, folder, detail=True))
            file = q.get("file", [""])[0]
            p = doc_path(folder, file)
            if not p:
                return self.send(403, {"error": "not a document of this feature"})
            return self.send(200, {"file": file, "path": p.as_posix(), "updated": p.stat().st_mtime,
                                   "text": p.read_text(encoding="utf-8", errors="replace")})
        if path.startswith("/api/view/"):
            res = run_view(st, path[len("/api/view/"):], q)
            return self.send(200, res) if res is not None else self.send(404, {"error": "no such view"})
        return self.send(404, {"error": "not found"})

    def static(self, name):
        if name not in STATIC:
            return self.send(404, {"error": "not found"})
        return self.send(200, (WEB / name).read_bytes(), STATIC[name])

    def sse(self, q):
        st = self.state
        last = int(self.headers.get("Last-Event-ID") or q.get("since", ["0"])[0] or 0)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            while True:
                with st.cond:
                    if len(st.events) <= last:
                        st.cond.wait(15)
                    batch = st.events[last:]
                if not batch:
                    self.wfile.write(b": keepalive\n\n")
                for ev in batch:
                    last = ev["seq"]
                    self.wfile.write(f"id: {last}\ndata: {json.dumps(ev)}\n\n".encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            return

    # -- POST

    def do_POST(self):
        g = self.gate()
        if not g:
            return
        path, _ = g
        st = self.state
        st.touch()
        try:
            b = self.body()
        except (ValueError, json.JSONDecodeError) as e:
            return self.send(400, {"error": str(e)})
        # Which session sent this: a tag Start gave the session ("" is the main one).
        tag = str(b.get("tag", ""))[:20] if isinstance(b, dict) else ""
        if tag and tag in st.sessions:
            st.sessions[tag]["seen"] = time.time()
        if path == "/api/show":
            kind = b.get("kind", "text")
            if kind not in KINDS:
                return self.send(400, {"error": f"kind must be one of {sorted(KINDS)}"})
            ev = st.emit("card", kind=kind, title=str(b.get("title", "")), body=str(b.get("body", "")), tag=tag)
            return self.send(200, {"seq": ev["seq"]})
        if path == "/api/activity":
            # What a started session is doing: a tool starting or finishing, a prompt, a reply.
            what = str(b.get("kind", ""))
            if what not in ("tool", "tool-done", "prompt", "reply", "note"):
                return self.send(400, {"error": "kind: tool, tool-done, prompt, reply or note"})
            text = str(b.get("text", ""))[:6000 if what == "reply" else 400]
            ev = st.emit("activity", tag=tag, kind=what, tool=str(b.get("tool", ""))[:60], text=text,
                         id=str(b.get("id", ""))[:80], ok=b.get("ok") is not False)
            if tag in st.sessions and what in ("tool", "prompt"):
                st.sessions[tag]["doing"] = (str(b.get("tool", "")) + " " + text).strip()[:200]
            return self.send(200, {"seq": ev["seq"]})
        if path == "/api/ask":
            try:
                qs = clean_questions(b)
            except ValueError as e:
                return self.send(400, {"error": str(e)})
            qid = secrets.token_hex(4)
            with st.cond:
                st.questions[qid] = {"questions": qs, "answers": None, "declined": False, "tag": tag}
            source = str(b.get("source", ""))
            if tag in st.sessions:
                source = st.sessions[tag]["name"]
            st.emit("ask", id=qid, questions=qs, source=source, tag=tag)
            return self.send(200, {"id": qid})
        if path == "/api/reply":
            qid = str(b.get("id", ""))
            rec = st.questions.get(qid)
            if not rec:
                return self.send(404, {"error": "no such question"})
            with st.cond:
                if rec["answers"] is not None or rec["declined"]:
                    return self.send(409, {"error": "already answered"})
                if b.get("declined"):
                    rec["declined"] = True
                else:
                    ans = b.get("answers")
                    if not isinstance(ans, dict):
                        return self.send(400, {"error": "answers: an object keyed by question"})
                    rec["answers"] = {str(k): str(v) for k, v in ans.items()}
            st.emit("answered", id=qid, declined=rec["declined"], answers=rec["answers"], tag=rec.get("tag", ""))
            return self.send(200, {"ok": True})
        if path == "/api/say":
            text = str(b.get("text", "")).strip()
            if not text:
                return self.send(400, {"error": "empty"})
            with st.cond:
                st.inbox[tag].append(text)
                st.cond.notify_all()
            st.emit("say", text=text, tag=tag)
            return self.send(200, {"ok": True})
        if path == "/api/root":
            code, said = set_root(st, root_from_pick(str(b.get("path", "")).strip()), bool(b.get("create")))
            if code != 0:
                return self.send(400, {"error": said or "couldn't set the root"})
            return self.send(200, root_info())
        if path == "/api/pick-folder":
            if not picker_argv():
                return self.send(501, {"error": "no folder dialog on this machine"})
            chosen = pick_folder(st, str(b.get("start", "")), str(b.get("title", ""))[:100])
            return self.send(200, {"path": chosen} if chosen else {"cancelled": True})
        if path == "/api/new-feature":
            code, answer = new_feature(b.get("name", ""))
            return self.send(code, answer)
        if path == "/api/doc/save":
            folder = feature_dir(str(b.get("name", "")))
            if not folder:
                return self.send(404, {"error": "no such feature"})
            p = doc_path(folder, str(b.get("file", "")))
            if not p:
                return self.send(403, {"error": "not a document of this feature"})
            text, expected = b.get("text"), b.get("expected")
            if not isinstance(text, str) or isinstance(expected, bool) or not isinstance(expected, (int, float)):
                return self.send(400, {"error": "text (a string) and expected (the mtime /api/doc gave) are required"})
            code, answer = save_doc(p, text, float(expected))
            return self.send(code, answer)
        if path in ("/api/start", "/api/project"):
            folder = feature_dir(str(b.get("name", "")))
            if not folder:
                return self.send(404, {"error": "no such feature"})
            if path == "/api/start":
                code, answer = start_session(st, folder, b)
                return self.send(code, answer)
            project = str(b.get("path", "")).strip()
            if not os.path.isdir(project):
                return self.send(400, {"error": f"no such folder: {project}"})
            choose_project(folder, project)
            return self.send(200, {"project": Path(project).as_posix(), "projectFrom": "chosen"})
        if path == "/api/hello":
            if tag:
                # A session Start opened has loaded the mod. (One this server didn't
                # start, e.g. after a restart, is still shown, under no feature.)
                with st.cond:
                    s = st.sessions.setdefault(tag, {"tag": tag, "feature": "", "folder": "", "name": tag, "command": "",
                                                     "project": "", "started": time.time(), "status": "starting",
                                                     "doing": "", "watched": True})
                    s.update({"status": "running", "seen": time.time(), "claude": str(b.get("session", ""))[:80]})
                st.session_event(tag)
                return self.send(200, {"ok": True})
            st.mod_seen = time.time()
            st.mod_session = str(b.get("session", ""))[:80]
            st.emit("status", mod=True, session=st.mod_session)
            return self.send(200, {"ok": True})
        if path == "/api/bye":
            if tag:
                if tag in st.sessions:
                    st.sessions[tag]["status"] = "ended"
                    st.session_event(tag)
                return self.send(200, {"ok": True})
            st.mod_seen = 0.0
            st.emit("status", mod=False, session="")
            return self.send(200, {"ok": True})
        if path == "/api/stop":
            self.send(200, {"ok": True})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        return self.send(404, {"error": "not found"})


def serve(cwd, bash):
    h = home()
    h.mkdir(parents=True, exist_ok=True)
    state = State(cwd, bash)
    token = secrets.token_urlsafe(24)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    httpd.daemon_threads = True
    port = httpd.server_address[1]
    Handler.state, Handler.token, Handler.port = state, token, port
    url = f"http://127.0.0.1:{port}/#token={token}"
    tmp = h / "server.json.tmp"
    tmp.write_text(json.dumps({"port": port, "token": token, "pid": os.getpid(), "url": url,
                               "cwd": cwd, "started": time.time()}))
    os.replace(tmp, info_path())

    idle = float(os.environ.get("TATTY_IDLE", "7200"))

    def watchdog():
        while True:
            time.sleep(30)
            if time.time() - state.last_activity > idle:
                httpd.shutdown()
                return

    threading.Thread(target=watchdog, daemon=True).start()
    try:
        httpd.serve_forever(poll_interval=0.5)
    finally:
        try:
            if json.loads(info_path().read_text()).get("pid") == os.getpid():
                info_path().unlink()
        except (OSError, ValueError):
            pass


# ---------------------------------------------------------------- client


def load_info():
    try:
        return json.loads(info_path().read_text())
    except (OSError, ValueError):
        return None


def call(info, method, path, body=None, timeout=10):
    url = f"http://127.0.0.1:{info['port']}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"X-TT-Token": info["token"], "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def alive():
    info = load_info()
    if not info:
        return None
    try:
        return info if call(info, "GET", "/api/status", timeout=3).get("open") else None
    except (OSError, urllib.error.URLError, ValueError):
        return None


def need():
    info = alive()
    if not info:
        print("not open")
        sys.exit(1)
    return info


def opt(args, name, default=None):
    if name in args:
        i = args.index(name)
        if i + 1 >= len(args):
            usage()
        v = args[i + 1]
        del args[i:i + 2]
        return v
    return default


def flag(args, name):
    if name in args:
        args.remove(name)
        return True
    return False


def start_detached(cwd, bash):
    h = home()
    h.mkdir(parents=True, exist_ok=True)
    log = open(h / "server.log", "ab")
    argv = [sys.executable, str(Path(__file__).resolve()), "serve", "--cwd", cwd, "--bash", bash]
    kw = {"stdin": subprocess.DEVNULL, "stdout": log, "stderr": log, "close_fds": True, "cwd": cwd}
    if os.name == "nt":
        # A hidden console, not none: a console program started by a process
        # with no console (DETACHED_PROCESS) gets a visible window of its own,
        # so every view's bash would pop up a terminal. This way they share it.
        base = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
        try:
            subprocess.Popen(argv, creationflags=base | subprocess.CREATE_BREAKAWAY_FROM_JOB, **kw)
        except OSError:
            subprocess.Popen(argv, creationflags=base, **kw)
    else:
        subprocess.Popen(argv, start_new_session=True, **kw)
    for _ in range(100):
        time.sleep(0.1)
        info = alive()
        if info:
            return info
    print(f"the window server didn't start; see {h / 'server.log'}", file=sys.stderr)
    sys.exit(2)


COMPANION = HERE / "companion"  # its sources, shipped with the plugin
# Built outside the plugin's folder (an install is Claude Code's cache, which an
# update replaces): the sources are copied there and built there, per version.
BUILD = Path(os.environ.get("LOCALAPPDATA") or home()) / "Tatty" / "companion" / plugin_version()
COMPANION_EXE = BUILD / "bin" / "TtCompanion.exe"
SOURCES = (".cs", ".xaml", ".csproj", ".manifest")


def companion_stale():
    """True when the companion isn't built, or a source is newer than the build."""
    if not COMPANION_EXE.exists():
        return True
    built = COMPANION_EXE.stat().st_mtime
    return any(p.stat().st_mtime > built for p in COMPANION.iterdir() if p.suffix in SOURCES)


def companion_ready():
    """Build the companion if needed (once; quietly, into the log). True when it can run."""
    if not companion_stale():
        return True
    import shutil
    dotnet = shutil.which("dotnet")
    if not dotnet:
        return False
    print("building Tatty's tray companion (first time only, about a minute)...", file=sys.stderr)
    src = BUILD / "src"
    src.mkdir(parents=True, exist_ok=True)
    for p in COMPANION.iterdir():
        if p.suffix in SOURCES:
            shutil.copy2(p, src / p.name)
    with open(home() / "server.log", "ab") as log:
        try:
            p = subprocess.run([dotnet, "build", "-c", "Release", "--nologo", "-v", "q", "-o", str(BUILD / "bin")],
                               cwd=src, stdin=subprocess.DEVNULL, stdout=log, stderr=log, timeout=600,
                               creationflags=NO_WINDOW)
        except (OSError, subprocess.TimeoutExpired):
            return False
    return p.returncode == 0 and COMPANION_EXE.exists()


def companion_running():
    """True when Tatty's companion is already up (it holds this named mutex). It
    then serves this window as it is: rebuilding would fail on its locked exe."""
    import ctypes
    k32 = ctypes.windll.kernel32
    h = k32.OpenMutexW(0x00100000, False, "Local\\tatty-companion")  # SYNCHRONIZE
    if h:
        k32.CloseHandle(h)
    return bool(h)


def show_ui(info):
    """Show the window: Tatty's tray companion on Windows, else (or when it can't
    be built, or TATTY_UI=browser) a browser tab. Returns which."""
    want = os.environ.get("TATTY_UI", "auto")
    if os.name == "nt" and want in ("auto", "companion") and companion_running():
        return "companion (already running)"
    if os.name == "nt" and want in ("auto", "companion") and companion_ready():
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP  # a GUI app: no console wanted
        kw = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL, "close_fds": True}
        argv = [str(COMPANION_EXE), "--home", str(home())]
        try:
            subprocess.Popen(argv, creationflags=flags | subprocess.CREATE_BREAKAWAY_FROM_JOB, **kw)
        except OSError:
            subprocess.Popen(argv, creationflags=flags, **kw)
        return "companion"
    import webbrowser
    webbrowser.open(info["url"])
    return "browser"


def greet(info, cwd, bash):
    """A fresh window's first cards: Tatty's banner and where the documents in the
    folder stand, both from the toolbox when it is installed."""
    def run(rel, *args):
        script = toolbox_script(rel)
        if not script:
            return None
        try:
            p = subprocess.run([bash, str(script), *args], cwd=cwd, capture_output=True, timeout=60, stdin=subprocess.DEVNULL,
                               encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
            return p.stdout if p.returncode == 0 and p.stdout.strip() else None
        except (OSError, subprocess.TimeoutExpired):
            return None
    try:
        banner = run("tt-common/scripts/tatty.sh", "banner")
        call(info, "POST", "/api/show", {"kind": "text", "title": "Tatty", "body": banner or "Hello! (The TT toolbox isn't installed, so there's no workflow to show yet.)"})
        rows = run("tt-common/scripts/workflow-state.sh", "--tsv", cwd)
        if rows:
            call(info, "POST", "/api/show", {"kind": "table", "title": f"Where things stand in {cwd}", "body": rows})
    except (OSError, urllib.error.URLError, ValueError):
        pass


def poll(info, path, wait):
    """Long-poll path until it stops saying pending/empty or `wait` seconds pass."""
    end = time.time() + wait
    while True:
        left = max(0.0, end - time.time())
        sep = "&" if "?" in path else "?"
        res = call(info, "GET", f"{path}{sep}wait={min(left, MAX_WAIT):.1f}", timeout=MAX_WAIT + 10)
        if res.get("status") not in ("pending", "empty") or time.time() >= end:
            return res


def stdin_text():
    # The scripts write UTF-8 whatever the console's code page says.
    return sys.stdin.buffer.read().decode("utf-8", "replace")


def print_answers(res):
    for q in res["questions"]:
        ans = res["answers"].get(q["question"], "")
        print(f"{q['header'] or q['question']}\t{ans}")


def usage():
    print(__doc__.split("\n\n", 2)[2].split("\n\nHome:")[0], file=sys.stderr)
    sys.exit(2)


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        usage()
    cmd, args = argv[0], argv[1:]
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    cwd = opt(args, "--cwd", os.getcwd())
    bash = opt(args, "--bash", "bash")
    wait = float(opt(args, "--wait", "100"))
    if cmd == "serve":
        return serve(cwd, bash)
    if cmd == "open":
        no_browser = flag(args, "--no-browser")
        info = alive()
        if not info:
            info = start_detached(cwd, bash)
            greet(info, cwd, bash)
        print(info["url"])
        if not no_browser:
            print(f"ui={show_ui(info)}")
        return 0
    if cmd == "status":
        info = alive()
        if not info:
            print("not open")
            return 1
        st = call(info, "GET", "/api/status")
        print("attached (claude mod)" if st.get("mod") else "attached")
        return 0
    if cmd == "url":
        print(need()["url"])
        return 0
    if cmd == "stop":
        info = alive()
        if not info:
            print("not open")
            return 0
        call(info, "POST", "/api/stop", {})
        print("stopped")
        return 0
    if cmd == "show":
        if len(args) != 2:
            usage()
        info = need()
        body = stdin_text().replace("\r\n", "\n")
        call(info, "POST", "/api/show", {"kind": args[0], "title": args[1], "body": body})
        return 0
    if cmd == "ask":
        info = need()
        try:
            qs = json.loads(stdin_text() or "null")
        except json.JSONDecodeError as e:
            print(f"ask: questions aren't JSON: {e}", file=sys.stderr)
            return 2
        try:
            qid = call(info, "POST", "/api/ask", qs)["id"]
        except urllib.error.HTTPError as e:
            print(f"ask: {json.loads(e.read() or b'{}').get('error', e)}", file=sys.stderr)
            return 2
        return finish(info, qid, wait)
    if cmd == "answer":
        if len(args) != 1:
            usage()
        info = need()
        try:
            return finish(info, args[0], wait)
        except urllib.error.HTTPError:
            print(f"answer: no such question: {args[0]}", file=sys.stderr)
            return 2
    if cmd == "listen":
        info = need()
        res = poll(info, "/api/inbox", wait)
        if res.get("status") != "message":
            print("no message yet")
            return 5
        print(res["text"])
        return 0
    usage()


def finish(info, qid, wait):
    res = poll(info, f"/api/answer/{qid}", wait)
    if res["status"] == "answered":
        print_answers(res)
        return 0
    if res["status"] == "declined":
        print("declined: ask in the terminal")
        return 6
    print(f"id={qid}")
    print("no answer yet")
    return 5


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]) or 0)
    except urllib.error.HTTPError as e:
        try:
            why = json.loads(e.read() or b"{}").get("error", e.reason)
        except ValueError:
            why = e.reason
        print(f"window: {why}", file=sys.stderr)
        sys.exit(2)
    except (OSError, urllib.error.URLError) as e:
        print(f"window: the server didn't answer: {e}", file=sys.stderr)
        sys.exit(2)
