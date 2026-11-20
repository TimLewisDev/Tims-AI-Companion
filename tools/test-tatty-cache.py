#!/usr/bin/env python3
"""test-tatty-cache.py: proves that Tatty's server remembers what its scripts and git reads said, by counting the
processes it starts. Standard library only; one line a check ("ok" or "FAIL"), exit 1 when any failed.

usage: test-tatty-cache.py [--changes] [--models]

It imports plugins/tatty/app/server.py and runs it against a scratch copy of tools/fixtures/tatty-root and a scratch
git repository, both in a temp folder; no server is started and no window is shown. Every process the server starts
(subprocess.run goes through subprocess.Popen) is counted.

Without --changes: for each cached read (workflow_rows, stages_view, decide_item, read_stories, branch_info,
review_info), the first call (a miss) must start at least one process, and the second must start none and give
the same answer. A Features poll (features_list) and a task-board refresh (task_workflows) must start none the
second time. Any other process a call starts is printed, with its command. folder_stamp (what a hit costs) is timed
on a folder with 500 files under .tt.

With --changes: a changed document, and a new branch, are seen by the next call.

Without --changes, and alone with --models, it also checks the provider and model catalog and the settings against
a fake toolbox (no real toolbox needed for these): the 15-second cache, one scan for callers that find it expired,
stale and recovery, the shared generation and its event, and settings saved at once by threads and other processes.

The toolbox is TATTY_TOOLBOX, else a Tims-AI-Toolbox checkout next to this repo. Without one the script calls return empty without
starting anything, so the check would prove nothing and says so.
"""

import os
import shutil
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TOOLBOX = str(ROOT.parent / "Tims-AI-Toolbox")
STAMP_LIMIT_MS = 50

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"ok    {name}")
    else:
        failed += 1
        print(f"FAIL  {name}")
        if detail:
            print(f"      {str(detail)[:600]}")


def stop(message):
    print(f"FAIL  {message}")
    print(f"\n{passed} passed, {failed + 1} failed")
    sys.exit(1)


# ---------------------------------------------------------------- counting the processes the server starts

launched = []
launched_lock = threading.Lock()
real_popen = subprocess.Popen
real_run = subprocess.run


class CountingPopen(real_popen):
    def __init__(self, args, *a, **k):
        with launched_lock:
            launched.append(args)
        super().__init__(args, *a, **k)


def reset():
    with launched_lock:
        launched.clear()


def started():
    with launched_lock:
        return list(launched)


def shown(argv):
    parts = [str(x) for x in (argv if isinstance(argv, (list, tuple)) else [argv])]
    return " ".join(p if len(p) < 70 else "..." + p[-67:] for p in parts)


def forget_caches(server):
    """What a restart of the server forgets: every kept answer, so the next call is a miss."""
    with server.script_cache_lock:
        server.script_cache.clear()
        server.repo_tops.clear()
    server.decide_cache.clear()


# ---------------------------------------------------------------- the scratch folders

def git(*args, cwd):
    p = real_run(["git", "-c", "user.name=Tatty Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false",
                  *args], cwd=str(cwd), capture_output=True, text=True, stdin=subprocess.DEVNULL)
    if p.returncode:
        stop(f"git {' '.join(args)} in the scratch folder failed: {(p.stderr or p.stdout).strip()}")
    return p.stdout.strip()


def make_repo(tmp):
    """A repository with a commit, an origin and its HEAD (as a clone has), on main."""
    repo = tmp / "repo"
    repo.mkdir()
    git("init", "-b", "main", cwd=repo)
    (repo / "a.txt").write_text("a\n", encoding="utf-8")
    git("add", "a.txt", cwd=repo)
    git("commit", "-m", "first", cwd=repo)
    git("clone", "--bare", str(repo), str(tmp / "origin.git"), cwd=tmp)
    git("remote", "add", "origin", str(tmp / "origin.git"), cwd=repo)
    git("fetch", "origin", cwd=repo)
    git("remote", "set-head", "origin", "main", cwd=repo)
    return repo.as_posix()


def setup():
    tmp = Path(tempfile.mkdtemp(prefix="tatty-cache-")).resolve()
    os.environ["TATTY_HOME"] = str(tmp / "home")
    os.environ["TATTY_ROOT"] = str(tmp / "root")
    if not os.environ.get("TATTY_TOOLBOX"):
        os.environ["TATTY_TOOLBOX"] = DEFAULT_TOOLBOX
    shutil.copytree(ROOT / "tools" / "fixtures" / "tatty-root", tmp / "root")
    sys.path.insert(0, str(ROOT / "plugins" / "tatty" / "app"))
    import server
    bash = shutil.which("bash")
    if not bash:
        stop("no bash on the PATH: the toolbox's scripts are bash scripts")
    missing = [rel for rel in ("tt-common/scripts/workflow-state.sh", "tt-common/scripts/stages.sh",
                               "tt-common/scripts/decide.sh") if not server.toolbox_script(rel)]
    if not server.stories_script():
        missing.append("the design plugin's stories.sh")
    if missing:
        stop(f"the toolbox ({os.environ['TATTY_TOOLBOX']}) has no {', '.join(missing)}. Set TATTY_TOOLBOX to a "
             "Tims-AI-Toolbox checkout: with none, the script calls return empty without starting anything, "
             "and this check would prove nothing.")
    state = server.State(str(tmp), bash)
    repo = make_repo(tmp)
    # a stories document, made the way the User Stories board makes one
    design = server.design_root() / "Inventory"
    design.mkdir(parents=True)
    (design / "Bag - Design.md").write_text("# Bag\n\n## Pickup\n\nWalking over an item puts it in the bag.\n", encoding="utf-8")
    code, _, err = server.run_stories(state, ["init", "Bag - Design.md", "Inventory - User Stories.md"], cwd=str(design))
    if code != 0:
        stop(f"stories.sh couldn't start the scratch stories document: {err.strip()}")
    return server, state, tmp, repo, design / "Inventory - User Stories.md"


# ---------------------------------------------------------------- the checks

def twice(server, name, call):
    """call() twice: the first (a miss) starts a process, the second starts none and answers the same."""
    forget_caches(server)
    reset()
    first = call()
    one = started()
    check(f"{name}: the first call starts a process", bool(one), "nothing was started: the check proves nothing")
    reset()
    second = call()
    two = started()
    check(f"{name}: the second call starts nothing", not two, "started: " + "; ".join(shown(a) for a in two))
    check(f"{name}: the second call answers the same", first == second, f"first {str(first)[:200]} / second {str(second)[:200]}")


def launch_counts(server, state, tmp, repo, stories):
    draft = server.feature_dir("Draft")
    twice(server, "workflow_rows", lambda: server.workflow_rows(state, draft))
    twice(server, "stages_view", lambda: server.stages_view(state, draft))
    twice(server, "decide_item", lambda: server.decide_item(state, draft, "Draft - Challenges.md", "CH3"))
    twice(server, "read_stories", lambda: server.read_stories(state, stories))
    twice(server, "branch_info", lambda: server.branch_info(state, draft, repo))
    twice(server, "review_info", lambda: server.review_info(draft, repo))

    # a Features poll
    twice(server, "features_list", lambda: server.features_list(state))
    twice(server, "feature_summary", lambda: server.feature_summary(state, draft))

    # a task-board refresh: the cards that have a workflow started
    board = server.tasks_dir("Sample")
    b, by, _ = server.task_read(board)
    b["started"] = {tid: name for tid, name in zip(sorted(by), ("Draft", "Demo", "Lite")) if by[tid]["status"] != "Completed"}
    b.setdefault("begun", {})
    twice(server, "task_workflows", lambda: server.task_workflows(state, b, by))
    check("task_workflows: the workflows are read", len(server.task_workflows(state, b, by)) >= 2)

    stamp_time(server, tmp)


def stamp_time(server, tmp):
    """folder_stamp is what a hit costs: it must stay cheap on a folder with a lot under .tt."""
    folder = tmp / "many"
    for i in range(500):
        d = folder / ".tt" / f"Part {i % 10} - Status" / "results"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"T{i:03d}.md").write_text("x\n", encoding="utf-8")
    (folder / "Many - Plan.md").write_text("# Many\n", encoding="utf-8")
    runs = []
    for _ in range(5):
        t = time.perf_counter()
        got = server.folder_stamp(folder)
        runs.append((time.perf_counter() - t) * 1000)
    ms = statistics.median(runs)
    print(f"      folder_stamp over 500 files under .tt: {ms:.1f} ms (the limit is {STAMP_LIMIT_MS} ms)")
    check("folder_stamp lists the files", got is not None and len(got[1]) >= 500)
    check(f"folder_stamp over 500 files is under {STAMP_LIMIT_MS} ms", ms <= STAMP_LIMIT_MS, f"{ms:.1f} ms")


def changes(server, state, tmp, repo):
    # a document that is added or edited is seen by the next call
    draft = server.feature_dir("Draft")
    forget_caches(server)
    before = server.workflow_rows(state, draft)
    reset()
    server.workflow_rows(state, draft)
    check("changes: before the change the answer is kept", not started())
    shutil.copy(server.feature_dir("Lite") / "Lite - Lite Brief.md", draft / "Draft - Lite Brief.md")
    reset()
    after = server.workflow_rows(state, draft)
    check("changes: a new document runs the script again", bool(started()))
    check("changes: a new document gives the new state",
          after != before and any(r.get("phase") == "lite-brief" for r in after),
          f"{[r.get('phase') for r in before]} -> {[r.get('phase') for r in after]}")
    doc = draft / "Draft - Lite Brief.md"
    doc.write_text(doc.read_text(encoding="utf-8") + "\nA line added by hand.\n", encoding="utf-8")
    reset()
    server.workflow_rows(state, draft)
    check("changes: an edited document runs the script again", bool(started()))

    # a branch made in the repository is seen by the next call
    forget_caches(server)
    check("changes: the branch is main", server.current_branch(repo) == "main")
    reset()
    server.current_branch(repo)
    server.local_branches(repo)
    reset()
    check("changes: the branches are kept", server.local_branches(repo) == ["main"] and not started())
    git("checkout", "-b", "other", cwd=repo)
    check("changes: a new branch is seen by current_branch", server.current_branch(repo) == "other")
    check("changes: a new branch is seen by local_branches", sorted(server.local_branches(repo)) == ["main", "other"])
    check("changes: a new branch is seen by branch_exists", server.branch_exists(repo, "other") is True)


# ---------------------------------------------------------------- the model catalog and the settings
# Run against a fake toolbox whose llms.sh answers from files in a control folder, so each scan's outcome is chosen
# here and every scan is counted. Other Tatty server processes are real child processes sharing the scratch home.

FAKE_LLMS = """#!/usr/bin/env bash
d="$FAKE_LLMS"
case "$1" in
	capabilities) [ -f "$d/caps-fail" ] && exit 1; cat "$d/caps" ;;
	status) cat "$d/status" ;;
	models)
		echo m >>"$d/scans"
		[ -f "$d/slow" ] && sleep 0.4
		[ -f "$d/models-fail" ] && { echo "scan broke" >&2; exit 1; }
		cat "$d/models" ;;
	*) exit 1 ;;
esac
"""

CAPS = "provider-model-config-v1\nprovider-actions-v1\n"


def tsv(*rows):
    return "".join("\t".join(r) + "\n" for r in rows)


MODELS = tsv(("claude", "sonnet", "Sonnet", "-", "yes", "any"), ("claude", "haiku", "Haiku", "-", "yes", "any"))
MODELS_MORE = MODELS + tsv(("claude", "opus", "Opus", "-", "yes", "any"))
STATUS = tsv(("claude", "connected", "1.0", "2", "2", "-"))

CHILD_SCAN = """
import sys, time
sys.path.insert(0, sys.argv[1])
import server
class S:
    cwd = "."
    bash = sys.argv[2]
    def emit(self, *a, **k): pass
got = server.llm_catalog(S(), fresh=True)
print(got["state"], got["generation"], time.time())
"""

CHILD_SAVE = """
import sys
sys.path.insert(0, sys.argv[1])
import server
key = sys.argv[2]
for i in range(int(sys.argv[3])):
    server.save_settings({key: f"{key}-{i}"})
server.save_settings({"providerEnabled": {sys.argv[4]: False}})
"""


class FakeState:
    cwd = "."

    def __init__(self, bash):
        self.bash = bash
        self.events = []

    def emit(self, kind, **kw):
        self.events.append((time.time(), kind, kw))

    def models_events(self):
        return [e for e in self.events if e[1] == "models"]


class Rig:
    def __init__(self, server, tmp, bash):
        self.server, self.tmp, self.bash = server, tmp, bash
        self.ctl = tmp / "ctl"
        self.ctl.mkdir()
        self.home = tmp / "home"
        skills = tmp / "toolbox" / "plugins" / "core" / "skills"
        (skills / "tt-common" / "scripts").mkdir(parents=True)
        (skills / "tt-common" / "scripts" / "workflow-state.sh").write_text("#!/usr/bin/env bash\n", encoding="utf-8")
        self.llms = skills / "tt-connections" / "scripts" / "llms.sh"
        self.llms.parent.mkdir(parents=True)
        with open(self.llms, "w", encoding="utf-8", newline="\n") as f:
            f.write(FAKE_LLMS)
        os.environ["TATTY_TOOLBOX"] = (tmp / "toolbox").as_posix()
        os.environ["FAKE_LLMS"] = self.ctl.as_posix()
        os.environ["TATTY_HOME"] = self.home.as_posix()
        for v in ("TATTY_STORIES_MODEL", "TATTY_TASKS_MODEL", "TATTY_QA_MODEL", "TATTY_QA_MODEL_PLAN"):
            os.environ.pop(v, None)
        self.state = FakeState(bash)
        self.reset()

    def put(self, name, text):
        with open(self.ctl / name, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)

    def flag(self, name, on):
        if on:
            self.put(name, "x")
        elif (self.ctl / name).exists():
            (self.ctl / name).unlink()

    def scans(self):
        p = self.ctl / "scans"
        return len(p.read_text(encoding="utf-8").split()) if p.exists() else 0

    def reset(self):
        """A new process, as far as this one can tell: nothing scanned, nothing shared, the models all good."""
        s = self.server
        shutil.rmtree(self.home, ignore_errors=True)
        with s._models_lock:
            s._models.update(at=0.0, rows=None, state="cold", error="", flight=None)
            s._catalog_seen["generation"] = None
        s._provider_states.update(at=0.0, states={})
        self.put("caps", CAPS)
        self.put("models", MODELS)
        self.put("status", STATUS)
        for f in ("caps-fail", "models-fail", "slow", "scans"):
            self.flag(f, False)
        self.state.events.clear()

    def expire(self):
        with self.server._models_lock:
            self.server._models["at"] = 0.0

    def gen(self):
        return self.server.coordination_read()["generation"]

    def child_scan(self):
        p = real_run([sys.executable, "-c", CHILD_SCAN, str(ROOT / "plugins" / "tatty" / "app"), self.bash],
                     capture_output=True, text=True, env=os.environ.copy(), timeout=120, stdin=subprocess.DEVNULL)
        parts = p.stdout.split()
        if p.returncode or len(parts) != 3:
            stop(f"the second Tatty process failed: {(p.stderr or p.stdout).strip()[:400]}")
        return parts[0], int(parts[1]), float(parts[2])


def catalog_checks(rig):
    s, st = rig.server, rig.state

    # a first scan has to succeed
    rig.flag("caps-fail", True)
    got = s.llm_catalog(st)
    check("catalog: a first scan that can't list the capabilities leaves nothing usable",
          got["state"] == "error" and not got["usable"] and got["rows"] == [] and got["error"] == s.TOOLBOX_TOO_OLD, got)
    check("catalog: and goes no further than the capabilities", rig.scans() == 0)
    rig.reset()
    rig.llms.rename(rig.llms.with_name("llms.off"))
    try:
        got = s.llm_catalog(st)
    finally:
        rig.llms.with_name("llms.off").rename(rig.llms)
    check("catalog: a toolbox without the catalog script is unavailable, with a reason",
          got["state"] == "error" and not got["usable"] and bool(got["error"]), got)
    rig.reset()
    rig.flag("models-fail", True)
    got = s.llm_catalog(st)
    check("catalog: a failed first scan says why", got["state"] == "error" and not got["usable"] and "scan broke" in got["error"], got)
    rig.reset()
    rig.put("models", "")
    got = s.llm_catalog(st)
    check("catalog: a scan that finds no models is unavailable",
          got["state"] == "error" and not got["usable"] and "no models" in got["error"], got)

    # a good scan, and what it costs
    rig.reset()
    g0 = rig.gen()
    got = s.llm_catalog(st)
    check("catalog: a good first scan is fresh and usable", got["state"] == "fresh" and got["usable"] and len(got["rows"]) == 2, got)
    check("catalog: the first good scan moves the generation once", rig.gen() == g0 + 1, f"{g0} -> {rig.gen()}")
    n, g = rig.scans(), rig.gen()
    for _ in range(3):
        s.llm_catalog(st)
    check("catalog: reads within the 15 seconds are served from the cache", rig.scans() == n, f"{rig.scans() - n} more scans")
    check("catalog: cached reads don't move the generation", rig.gen() == g)

    rig.expire()
    rig.flag("slow", True)
    answers = []
    threads = [threading.Thread(target=lambda: answers.append(s.llm_catalog(st))) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    rig.flag("slow", False)
    check("catalog: callers that find it expired share one scan", rig.scans() == n + 1, f"{rig.scans() - n} scans")
    check("catalog: and all of them get the new answer", len(answers) == 6 and all(a["usable"] for a in answers))
    check("catalog: a refresh that finds the same models doesn't move the generation", rig.gen() == g)

    # a failed refresh after a good one
    n = rig.scans()
    rig.flag("models-fail", True)
    rig.expire()
    got = s.llm_catalog(st)
    check("catalog: a failed refresh keeps the last good rows to show, and is stale",
          got["state"] == "stale" and not got["usable"] and len(got["rows"]) == 2 and bool(got["error"]), got)
    check("catalog: going stale moves the generation once", rig.gen() == g + 1, f"{g} -> {rig.gen()}")
    why = s.resolve_model(st, "claude:sonnet")
    check("catalog: stale rows can't start new work", why[0] == "" and bool(why[1]), why)
    rig.expire()
    s.llm_catalog(st)
    check("catalog: a failure after a failure doesn't move the generation", rig.gen() == g + 1, f"{g} -> {rig.gen()}")
    rig.flag("models-fail", False)
    rig.expire()
    got = s.llm_catalog(st)
    check("catalog: a good scan clears stale", got["state"] == "fresh" and got["usable"] and got["error"] == "", got)
    check("catalog: recovery moves the generation once", rig.gen() == g + 2, f"{g} -> {rig.gen()}")
    s._provider_states.update(at=0.0, states={})
    check("catalog: and new work can start again", s.resolve_model(st, "claude:sonnet") == ("sonnet", ""), s.resolve_model(st, "claude:sonnet"))


def other_process_checks(rig):
    s, st = rig.server, rig.state
    rig.reset()
    s.llm_catalog(st)
    g = rig.gen()

    # another process's failed refresh makes the list stale for this one too
    rig.flag("models-fail", True)
    state, _, _ = rig.child_scan()
    check("other process: its own first scan failed", state == "error", state)
    check("other process: that moved the shared generation", rig.gen() == g + 1, f"{g} -> {rig.gen()}")
    snap = s.catalog_snapshot()
    check("other process: this process shows the list as stale, though its own rows are good",
          snap["state"] == "stale" and not snap["usable"], snap)
    rig.flag("models-fail", False)
    n = rig.scans()
    got = s.llm_catalog(st)
    check("other process: the next read scans again, inside the 15 seconds", rig.scans() == n + 1, f"{rig.scans() - n} scans")
    check("other process: and the list is fresh again", got["state"] == "fresh" and got["usable"], got)
    check("other process: that is one more generation", rig.gen() == g + 2, f"{g} -> {rig.gen()}")


def generation_event_checks(rig):
    s, st = rig.server, rig.state
    rig.reset()
    threading.Thread(target=s.watch_catalog, args=(st,), daemon=True).start()
    end = time.time() + 20
    while time.time() < end and not (s._models["state"] == "fresh" and st.models_events()):
        time.sleep(0.1)
    check("events: the watcher scans once at the start", s._models["state"] == "fresh" and rig.scans() == 1, rig.scans())
    time.sleep(2.5)
    base = len(st.models_events())
    check("events: a change this process made is told once, not again by the watcher", base == 1, base)

    n = rig.scans()
    rig.put("models", MODELS_MORE)
    _, g, wrote = rig.child_scan()
    end = time.time() + 5
    while time.time() < end and len(st.models_events()) == base:
        time.sleep(0.05)
    events = st.models_events()
    check("events: another process's change reaches this one's pages", len(events) == base + 1, f"{len(events)} events")
    if len(events) > base:
        lag = events[-1][0] - wrote
        check("events: within about a second of the change", lag <= 1.3, f"{lag:.2f}s")
        check("events: and names the new generation", events[-1][2].get("generation") == g, events[-1])
    time.sleep(2.5)
    check("events: no second event for it", len(st.models_events()) == base + 1, len(st.models_events()))
    got = s.llm_catalog(st)
    check("events: the next read scans, as the change expired the local rows", rig.scans() == n + 2 and len(got["rows"]) == 3,
          f"{rig.scans() - n} scans, {len(got['rows'])} rows")


def concurrent_settings_checks(rig):
    s = rig.server
    rig.reset()
    app = str(ROOT / "plugins" / "tatty" / "app")
    kids = [real_popen([sys.executable, "-c", CHILD_SAVE, app, key, "25", provider], env=os.environ.copy(),
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            for key, provider in (("jiraSite", "codex"), ("jiraWorkdir", "copilot"))]
    errors = []

    def writer(key, provider):
        try:
            for i in range(25):
                s.save_settings({key: f"w{i}/" if key == "branchPrefix" else f"{key}-{i}"})
            s.save_settings({"providerEnabled": {provider: False}})
        except Exception as e:
            errors.append(repr(e))

    threads = [threading.Thread(target=writer, args=a) for a in
               (("jiraJql", "claude"), ("jiraServer", "claude"), ("jiraProject", "claude"), ("branchPrefix", "claude"))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    outs = [k.communicate(timeout=120) for k in kids]
    check("settings: concurrent saves from threads and two other processes all finish",
          not errors and all(k.returncode == 0 for k in kids), f"{errors} {[o[1][-300:] for o in outs]}")
    got = s.load_settings()
    want = {"jiraJql": "jiraJql-24", "jiraServer": "jiraServer-24", "jiraProject": "jiraProject-24",
            "branchPrefix": "w24/", "jiraSite": "jiraSite-24", "jiraWorkdir": "jiraWorkdir-24"}
    check("settings: every writer's last value survives the others", all(got[k] == v for k, v in want.items()),
          {k: got[k] for k in want})
    check("settings: so do the providers each one switched off",
          got["providerEnabled"] == {"claude": False, "codex": False, "copilot": False}, got["providerEnabled"])


def models_checks():
    tmp = Path(tempfile.mkdtemp(prefix="tatty-models-")).resolve()
    bash = shutil.which("bash")
    if not bash:
        stop("no bash on the PATH: the toolbox's scripts are bash scripts")
    sys.path.insert(0, str(ROOT / "plugins" / "tatty" / "app"))
    import server
    try:
        rig = Rig(server, tmp, bash)
        catalog_checks(rig)
        other_process_checks(rig)
        concurrent_settings_checks(rig)
        generation_event_checks(rig)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main(argv):
    if "--models" in argv:
        models_checks()
        print(f"\n{passed} passed, {failed} failed")
        return 1 if failed else 0
    server, state, tmp, repo, stories = setup()
    subprocess.Popen = CountingPopen
    try:
        if "--changes" in argv:
            changes(server, state, tmp, repo)
        else:
            launch_counts(server, state, tmp, repo, stories)
    finally:
        subprocess.Popen = real_popen
        shutil.rmtree(tmp, ignore_errors=True)
    if "--changes" not in argv:
        models_checks()
    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
