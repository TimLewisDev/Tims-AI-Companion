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


def pool_run(label, fn, slots=("*",)):
    """One job on the pool, waited for: the old one-request shape (http code, answer)."""
    code, ans = server.pool_submit("test", label, list(slots), lambda p, j: fn(p), None)
    return server.pool_wait(ans["_job"]) if code == 200 else (code, ans)


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
    code, v = pool_run("make", lambda p: p.init(2))
    check("create makes the slots", code == 200 and len(v["made"]) == 2, v)
    code, v = pool_run("make", lambda p: p.init(2))
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

    code, v = pool_run("free", lambda p: server.pool_release_slot(State(), p, "slot-1"))
    check("freeing is refused while a session runs there", code == 409 and "session running" in v["error"], v)
    State.sessions = {}
    (Path(got["path"]) / "dirty.txt").write_text("x")
    code, v = pool_run("free", lambda p: server.pool_release_slot(State(), p, "slot-1"))
    check("freeing is refused with uncommitted files", code == 409 and "uncommitted" in v["error"], v)
    check("and the feature keeps its link", records["widget"].get("worktree") == got["path"])
    (Path(got["path"]) / "dirty.txt").unlink()
    code, v = pool_run("free", lambda p: server.pool_release_slot(State(), p, "slot-1"))
    check("a clean slot is freed", code == 200 and v["branchKept"] == "feature/widget", v)
    check("and the feature's link to it is cut", "worktree" not in records["widget"] and "pooled" not in records["widget"] and records["widget"]["branch"] == "feature/widget")
    code, v = pool_run("delete", lambda p: p.remove("slot-1"))
    check("a free slot is deleted", code == 200 and not Path(got["path"]).exists(), v)
    code, v = server.pool_view()
    check("and the page shows the rest", [s["slot"] for s in v["slots"]] == ["slot-2"])

    # jobs on different slots run side by side; one that needs a slot in use says who has it, and may wait for it
    import threading
    hold, started = threading.Event(), threading.Event()
    def slow(p, j):
        started.set()
        hold.wait(30)
        return {"slow": True}
    code, a1 = server.pool_submit("test", "Mending", ["slot-2"], slow, None)
    started.wait(10)
    check("a job on one slot starts", code == 200 and a1["job"]["state"] == "running", a1)
    code, a2 = server.pool_submit("test", "Checking", ["slot-9"], lambda p, j: {"fast": True}, None)
    check("a job on another slot runs beside it", code == 200 and a2["job"]["state"] == "running", a2)
    server.pool_wait(a2["_job"])
    code, v = server.pool_submit("test", "Checking", ["slot-2"], lambda p, j: {"later": True}, None)
    check("a job on the same slot is refused and says who has it", code == 409 and v.get("conflict") and v.get("canQueue") and v["blockedBy"][0]["label"] == "Mending", v)
    code, q = server.pool_submit("test", "Checking", ["slot-2"], lambda p, j: {"later": True}, None, queue=True)
    check("it can be queued", code == 200 and q["job"]["state"] == "queued" and q["job"]["waitingFor"] == [a1["job"]["id"]], q)
    code, v = server.pool_submit("test", "Whole", ["*"], lambda p, j: {}, None)
    check("a job on the whole pool waits for every slot", code == 409 and v.get("conflict"), v)
    code, v = server.pool_view()
    check("the page's list shows both", {j["state"] for j in v["jobs"]} >= {"running", "queued"} and v["busy"] == "Mending", v.get("jobs"))
    code, v = server.pool_cancel(q["job"]["id"])
    check("a waiting job can be taken off", code == 200, v)
    code, q = server.pool_submit("test", "Checking", ["slot-2"], lambda p, j: {"later": True}, None, queue=True)
    code, v = server.pool_cancel(a1["job"]["id"])
    check("one that has started cannot", code == 409, v)
    check("a Start does not take a slot a job is on", server.pool_busy_slots(str(top)) == {"slot-2"}, server.pool_busy_slots(str(top)))
    hold.set()
    code, v = server.pool_wait(a1["_job"])
    check("the first finishes", code == 200 and v["slow"] is True, v)
    code, v = server.pool_wait(q["_job"])
    check("the queued one then runs", code == 200 and v["later"] is True, v)
    code, v = server.pool_view()
    check("finished jobs stay listed for the page", [j["state"] for j in v["jobs"]].count("done") >= 3 and v["busy"] == "", v.get("jobs"))
    server.pool_dismiss("")
    code, v = server.pool_view()
    check("until they are dismissed", v["jobs"] == [], v.get("jobs"))
    code, v = pool_run("config", lambda p: {"config": p.set_config(["size=1", "max=2"])})
    check("settings are saved", code == 200 and v["config"]["max"] == 2, v)
    code, v = pool_run("add", lambda p: p.add(1))
    check("add is held to the most", code == 200, v)
    code, v = pool_run("add", lambda p: p.add(1))
    check("past the most is refused", code == 409, v)

    # two slots downloaded at once take different numbers, and a check of one waits only for its own download
    pool_run("config", lambda p: {"config": p.set_config(["max=6"])})
    n0 = len(server.worktreepool.Pool(top).slot_names())
    code, a = server.pool_add_job()
    code2, b2 = server.pool_add_job()
    check("two adds at once are two slots", code == 200 and code2 == 200 and a["job"]["slots"] != b2["job"]["slots"], (a, b2))
    code, v = server.pool_validate_jobs([a["job"]["slots"][0]])
    check("a check of a slot being downloaded is blocked", v.get("blocked") and v["blocked"][0]["slot"] == a["job"]["slots"][0], v)
    code, v = server.pool_validate_jobs([a["job"]["slots"][0]], queue=True)
    check("and can be queued behind the download", code == 200 and v["queued"] == a["job"]["slots"], v)
    server.pool_wait(a["_job"]); server.pool_wait(b2["_job"])
    for j in v["_jobs"]:
        j["event"].wait(120)
    check("both slots arrive", len(server.worktreepool.Pool(top).slot_names()) == n0 + 2)
    check("and the queued check ran on the finished slot", server.POOL_CHECK[server.pool_key(top)]["slots"][a["job"]["slots"][0]]["level"] in ("ok", "warn"), server.POOL_CHECK)

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
