#!/usr/bin/env python3
"""test-tatty-cache.py: proves that Tatty's server remembers what its scripts and git reads said, by counting the
processes it starts. Standard library only; one line a check ("ok" or "FAIL"), exit 1 when any failed.

usage: test-tatty-cache.py [--changes]

It imports plugins/tatty/app/server.py and runs it against a scratch copy of tools/fixtures/tatty-root and a scratch
git repository, both in a temp folder; no server is started and no window is shown. Every process the server starts
(subprocess.run goes through subprocess.Popen) is counted.

Without --changes: for each cached read (workflow_rows, stages_view, decide_item, read_stories, branch_info,
review_info), the first call (a miss) must start at least one process, and the second must start none and give
the same answer. A Features poll (features_list) and a task-board refresh (task_workflows) must start none the
second time. Any other process a call starts is printed, with its command. folder_stamp (what a hit costs) is timed
on a folder with 500 files under .tt.

With --changes: a changed document, and a new branch, are seen by the next call.

The toolbox is TATTY_TOOLBOX, else P:/Claude/Tims-AI-Toolbox. Without one the script calls return empty without
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
DEFAULT_TOOLBOX = "P:/Claude/Tims-AI-Toolbox"
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


def main(argv):
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
    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
