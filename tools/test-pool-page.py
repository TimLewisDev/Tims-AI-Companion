#!/usr/bin/env python3
"""test-pool-page.py: the server side of the Worktrees page (server.py's "the worktrees page") on a throwaway
repository: the view with and without a pool, create, measure, a claim shown against its feature, freeing a
slot (and cutting the feature's link to it), refusing while a session runs there, deleting a free slot.
The page itself is walked by features-check.py --pool.  Run: python tools/test-pool-page.py"""
import json
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "plugins" / "tatty" / "app"))
import server  # noqa: E402

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print("ok    " + name)
    else:
        failed += 1
        print("FAIL  " + name, detail)


def sh(*args, cwd):
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=cwd, check=True, capture_output=True)


with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    sh("init", "-q", "-b", "main", "origin", cwd=tmp)
    origin = tmp / "origin"
    (origin / "ProjectSettings").mkdir()
    (origin / "ProjectSettings" / "ProjectVersion.txt").write_text("v")
    (origin / "a.txt").write_text("x")
    (origin / ".gitignore").write_text("Library/\n")
    sh("add", "-A", cwd=origin)
    sh("commit", "-qm", "init", cwd=origin)
    sh("clone", "-q", "origin", "proj", cwd=tmp)
    (tmp / "proj" / "Library").mkdir()
    (tmp / "proj" / "Library" / "c.bin").write_text("cache")
    top = server.worktreepool.repo_top(str(tmp / "proj"))
    records = {}
    server.pool_top = lambda: top
    server.branch_records = lambda: records
    server.save_branch = lambda f, r: records.__setitem__(f.lower(), r)
    server.feature_dir = lambda n: Path("/features/" + n) if n == "Widget" else None

    code, v = server.pool_view()
    check("no pool yet", code == 200 and v["exists"] is False and v["disk"]["free"] > 0 and v["seed"]["warm"] == ["Library"])
    code, v = server.pool_run("make", lambda p: p.init(2))
    check("create makes the slots", code == 200 and len(v["made"]) == 2, v)
    code, v = server.pool_run("make", lambda p: p.init(2))
    check("a second create is refused", code == 409, v)
    server.pool_measure_start()
    for _ in range(100):
        if not server.POOL_MEASURING:
            break
        time.sleep(0.1)
    code, v = server.pool_view()
    check("measuring gives an estimate", v.get("estimate", {}).get("bytes", 0) > 0 and v["estimate"]["from"] == "a slot", v.get("estimate"))
    check("and a size per slot", all(s["size"] for s in v["slots"]))

    pool = server.worktreepool.Pool(top)
    got = pool.claim("feature/widget", owner="Widget")
    records["widget"] = {"repo": str(top), "branch": "feature/widget", "base": "main", "worktree": got["path"], "pooled": True}
    code, v = server.pool_view()
    held = {s["slot"]: s for s in v["slots"]}
    check("a claimed slot shows its feature", held["slot-1"]["state"] == "claimed" and held["slot-1"]["feature"] == "Widget" and held["slot-1"]["featureExists"], held["slot-1"])
    check("a free slot shows none", held["slot-2"]["state"] == "free" and held["slot-2"]["feature"] == "")
    check("one of two is free", v["free"] == 1)

    class State:
        cond = threading.Condition()
        sessions = {"s1": {"feature": "Widget", "closed": False, "status": "running"}}

        def session_view(self, s):
            return s

    code, v = server.pool_run("free", lambda p: server.pool_release_slot(State(), p, "slot-1"))
    check("freeing is refused while a session runs there", code == 409 and "session running" in v["error"], v)
    State.sessions = {}
    (Path(got["path"]) / "dirty.txt").write_text("x")
    code, v = server.pool_run("free", lambda p: server.pool_release_slot(State(), p, "slot-1"))
    check("freeing is refused with uncommitted files", code == 409 and "uncommitted" in v["error"], v)
    check("and the feature keeps its link", records["widget"].get("worktree") == got["path"])
    (Path(got["path"]) / "dirty.txt").unlink()
    code, v = server.pool_run("free", lambda p: server.pool_release_slot(State(), p, "slot-1"))
    check("a clean slot is freed", code == 200 and v["branchKept"] == "feature/widget", v)
    check("and the feature's link to it is cut", "worktree" not in records["widget"] and "pooled" not in records["widget"] and records["widget"]["branch"] == "feature/widget")
    code, v = server.pool_run("delete", lambda p: p.remove("slot-1"))
    check("a free slot is deleted", code == 200 and not Path(got["path"]).exists(), v)
    code, v = server.pool_view()
    check("and the page shows the rest", [s["slot"] for s in v["slots"]] == ["slot-2"])

    server.POOL_BUSY[str(top)] = "busy"
    code, v = server.pool_run("again", lambda p: {})
    check("one change at a time", code == 409 and "Wait" in v["error"], v)
    server.POOL_BUSY.clear()
    code, v = server.pool_run("config", lambda p: {"config": p.set_config(["size=1", "max=2"])})
    check("settings are saved", code == 200 and v["config"]["max"] == 2, v)
    code, v = server.pool_run("add", lambda p: p.add(1))
    check("add is held to the most", code == 200, v)
    code, v = server.pool_run("add", lambda p: p.add(1))
    check("past the most is refused", code == 409, v)

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
