#!/usr/bin/env python3
"""test-compact-chat.py: checks of the compact chat's worker and of the question
flow the compact window relies on. Standard library only; one line a check
("ok" or "FAIL"), exit 1 when any failed.

usage: test-compact-chat.py [--project <folder>]

Part one runs the worker (plugins/tatty/app/compact_chat.py) in this process
against a stand-in for the headless claude: no agent is ever started. It checks
that each project has a history of its own, that it survives a restart, that the
turn runs in the project's folder, and that nothing but reading is allowed.

Part two talks to a running Tatty server (the one tools/test-tatty.sh opened:
TATTY_HOME names its folder, TATTY_CLAUDE its stand-in claude) and runs only with
--project, a folder a chat may work in. It checks the compact chat's API and that an
answer reaches the question's own session, by its id, and nothing else.
"""

import json
import os
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "plugins" / "tatty" / "app"))
import compact_chat  # noqa: E402

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
            print(f"      {str(detail)[:400]}")


# A stand-in for `claude -p`: it keeps what it was run with, answers once and
# says what it read. A file called "slow" in its folder makes it wait.
FAKE = r'''
import json, os, sys, time
d = os.environ["FAKE_DIR"]
prompt = sys.stdin.read()
with open(os.path.join(d, "runs.jsonl"), "a", encoding="utf-8") as f:
    f.write(json.dumps({"args": sys.argv[1:], "cwd": os.getcwd(), "prompt": prompt}) + "\n")
args = sys.argv[1:]
if "--session-id" in args:
    open(os.path.join(d, "conversation-" + args[args.index("--session-id") + 1]), "w").close()
print(json.dumps({"type": "system", "subtype": "init"}), flush=True)
if os.path.exists(os.path.join(d, "slow")):
    time.sleep(20)
print(json.dumps({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Read", "input": {"file_path": "README.md"}}]}}), flush=True)
print(json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": "It reads the README."}]}}), flush=True)
print(json.dumps({"type": "result", "subtype": "success", "is_error": False, "result": "It reads the README.", "total_cost_usd": 0.02}), flush=True)
'''


class State:
    """What the worker takes from the server."""

    def __init__(self, cwd=""):
        self.cond = threading.Condition()
        self.hub_pending = False
        self.cwd = cwd
        self.events = []

    def emit(self, kind, **fields):
        with self.cond:
            self.events.append({"type": kind, **fields})

    def touch(self):
        pass

    def done(self, project):
        with self.cond:
            return len([e for e in self.events if e["type"] == "compact-chat" and e.get("done")
                        and e["project"] == Path(project).as_posix()])


def worker(home, fake_dir, state, tools="Read,Glob,Grep,Skill", allowed=("Read", "Glob", "Grep", "Skill"), claude=True):
    script = Path(fake_dir) / "fake-claude.py"

    def argv(sid):
        resumed = (Path(fake_dir) / ("conversation-" + sid)).exists()
        return [sys.executable, str(script), "-p", "--resume" if resumed else "--session-id", sid,
                "--tools", tools, "--allowedTools", *allowed, "--permission-mode", "dontAsk"]

    hooks = compact_chat.Hooks(
        home=lambda: Path(home), claude_path=lambda: sys.executable if claude else "", argv=argv,
        git_bash_path=lambda: "", kill_tree=lambda p: p.kill(), step_label=lambda b: "Reading " + str(b["input"]["file_path"]),
        no_claude="No claude here.", timeout=60.0)
    return compact_chat.CompactChat(state, hooks)


def wait_for(cond, seconds=10):
    end = time.time() + seconds
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.05)
    return False


def runs_of(fake_dir):
    p = Path(fake_dir) / "runs.jsonl"
    return [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines()] if p.exists() else []


def flag(args, name):
    return args[args.index(name) + 1] if name in args else None


def part_one():
    print("# the compact chat's worker")
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        home, fake = t / "home", t / "fake"
        a, b = t / "project-a", t / "project-b"
        for d in (home, fake, a, b):
            d.mkdir()
        (fake / "fake-claude.py").write_text(FAKE, encoding="utf-8")
        os.environ["FAKE_DIR"] = str(fake)
        state = State(cwd=str(a))
        w = worker(home, fake, state)

        check("the same folder is the same project however it is written",
              compact_chat.project_key(a) == compact_chat.project_key(str(a) + os.sep)
              and compact_chat.project_key(a) == compact_chat.project_key(str(a).replace("\\", "/")))
        check("another folder is another project", compact_chat.project_key(a) != compact_chat.project_key(b))

        ro = ["x", "--tools", "Read,Glob", "--allowedTools", "Read", "Glob", "--permission-mode", "dontAsk"]
        check("a command that only reads is allowed", compact_chat.read_only_argv(ro))
        check("a command with no tools list is refused", not compact_chat.read_only_argv(["x", "--permission-mode", "dontAsk"]))
        for tool in ("Write", "Edit", "Bash"):
            check(f"{tool} among the tools is refused", not compact_chat.read_only_argv(["x", "--tools", f"Read,{tool}"]))
            check(f"{tool} among the allowed tools is refused",
                  not compact_chat.read_only_argv(["x", "--tools", "Read", "--allowedTools", "Read", tool]))

        code, ans = w.get(str(t / "gone"))
        check("a folder that isn't there has no chat", code == 400, ans)
        state.hub_pending = True
        code, ans = w.say({"text": "Hi"})
        check("with no project chosen there is no chat, and no fallback to a global one", code == 400, ans)
        check("and nothing is written", not (home / "compact-chats").exists())
        state.hub_pending = False
        code, ans = w.get("")
        check("with none named it is the server's current project", code == 200 and ans["project"] == a.as_posix(), ans)
        code, ans = w.say({"project": str(a), "text": "   "})
        check("an empty message is refused", code == 400, ans)

        code, ans = w.say({"project": str(a), "text": "What is this?"})
        check("a message starts a turn", code == 202 and ans["busy"] is True, ans)
        check("the turn ends", wait_for(lambda: state.done(a) == 1))
        code, got = w.get(str(a))
        check("the message and the answer are kept",
              [(m["role"], m["text"]) for m in got["messages"]] == [("you", "What is this?"), ("claude", "It reads the README.")], got)
        check("with its steps, and it is no longer busy",
              got["messages"][1]["steps"] == ["Reading README.md"] and got["busy"] is False and got["cost"] == 0.02, got)
        runs = runs_of(fake)
        check("the turn ran in the project's folder", len(runs) == 1 and Path(runs[0]["cwd"]).resolve() == a.resolve(), runs)
        check("and was given the message", runs[0]["prompt"].strip() == "What is this?")
        check("the first turn names its conversation", flag(runs[0]["args"], "--session-id") is not None)
        check("and tells it that it can only read", "only read" in (flag(runs[0]["args"], "--append-system-prompt") or ""))
        check("the command allowed only reading", compact_chat.read_only_argv(runs[0]["args"]))

        sid = w.read(a)["claudeSession"]
        code, ans = w.say({"project": str(a), "text": "And then?"})
        check("a second turn", code == 202 and wait_for(lambda: state.done(a) == 2))
        second = runs_of(fake)[1]["args"]
        check("goes on with the same conversation", flag(second, "--resume") == sid and "--session-id" not in second, second)

        code, other = w.get(str(b))
        check("another project starts with no history", code == 200 and other["messages"] == [], other)
        check("and keeps nothing until it is spoken to", len(list((home / "compact-chats").glob("*.json"))) == 1)
        code, ans = w.say({"project": str(b), "text": "Hello from b"})
        check("it has a conversation of its own", code == 202 and wait_for(lambda: state.done(b) == 1))
        files = sorted(p.name for p in (home / "compact-chats").glob("*.json"))
        check("in a file of its own", len(files) == 2, files)
        code, got_a = w.get(str(a))
        code, got_b = w.get(str(b))
        check("the first project's history is untouched",
              [m["text"] for m in got_a["messages"] if m["role"] == "you"] == ["What is this?", "And then?"], got_a)
        check("and the second has only its own",
              [m["text"] for m in got_b["messages"] if m["role"] == "you"] == ["Hello from b"], got_b)
        check("with a conversation id of its own", w.read(a)["claudeSession"] != w.read(b)["claudeSession"])
        check("run in its own folder", Path(runs_of(fake)[2]["cwd"]).resolve() == b.resolve())

        again = worker(home, fake, State(cwd=str(a)))
        code, back = again.get(str(a))
        check("after a restart the history is still there", back["messages"] == got_a["messages"], back)
        check("with the same conversation to go on with", again.read(a)["claudeSession"] == sid)
        check("and the other project's too", again.get(str(b))[1]["messages"] == got_b["messages"])

        before = len(runs_of(fake))
        unsafe = worker(home, fake, State(cwd=str(a)), tools="Read,Bash")
        code, ans = unsafe.say({"project": str(a), "text": "Run it"})
        check("a command that could do more than read is refused", code == 500, ans)
        check("and no agent is started", len(runs_of(fake)) == before and not unsafe.runs)
        unsafe = worker(home, fake, State(cwd=str(a)), allowed=("Read", "Write"))
        check("so is one that allows writing", unsafe.say({"project": str(a), "text": "Write it"})[0] == 500)

        missing = worker(home, fake, State(cwd=str(a)), claude=False)
        code, ans = missing.say({"project": str(a), "text": "Hi"})
        check("without claude it says so", code == 501 and ans["error"] == "No claude here.", ans)

        (fake / "slow").write_text("")
        code, ans = w.say({"project": str(a), "text": "Slowly"})
        check("a slow turn starts", code == 202)
        wait_for(lambda: len(runs_of(fake)) == before + 1)
        code, ans = w.say({"project": str(a), "text": "Again"})
        check("one turn at a time", code == 409, ans)
        check("another project may answer meanwhile", w.say({"project": str(b), "text": "Meanwhile"})[0] == 202)
        check("stopping says there was a turn", w.stop(str(a)) is True)
        check("a stopped turn ends", wait_for(lambda: state.done(a) == 3))
        last = w.get(str(a))[1]["messages"][-1]
        check("and says so", (last["role"], last["text"]) == ("error", "Stopped."), last)
        check("nothing is left to stop", w.stop(str(a)) is False)
        w.stop(str(b))
        wait_for(lambda: state.done(b) == 2)
        (fake / "slow").unlink()

        for i in range(compact_chat.MAX_KEPT + 20):
            w.change(a, lambda c, i=i: c["messages"].append({"role": "you", "text": str(i), "ts": 0}))
        kept = w.read(a)["messages"]
        check("only the latest messages are kept", len(kept) == compact_chat.MAX_KEPT and kept[-1]["text"] == str(compact_chat.MAX_KEPT + 19))


def server_info():
    p = Path(os.environ.get("TATTY_HOME", "")) / "server.json"
    try:
        info = json.loads(p.read_text(encoding="utf-8"))
        return f"http://127.0.0.1:{info['port']}", info["token"]
    except (OSError, ValueError, KeyError):
        return None, None


def part_two(project):
    print("# the compact chat and the questions, through the server")
    url, token = server_info()
    if not url:
        print("skip  no Tatty server is open (TATTY_HOME has no server.json)")
        return

    def call(path, body=None):
        req = urllib.request.Request(url + path, data=None if body is None else json.dumps(body).encode(),
                                     headers={"X-TT-Token": token, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    project = Path(project)
    other = project.parent / (project.name + "-other")
    other.mkdir(exist_ok=True)
    shown = lambda p: Path(p).as_posix()
    stand_in = Path(os.environ.get("TATTY_CLAUDE", "")).parent

    def finished(p, n):
        return wait_for(lambda: len([e for e in call("/api/events")[1] if e["type"] == "compact-chat" and e.get("done")
                                     and e.get("project") == shown(p)]) >= n)

    def last_args():
        return (stand_in / "chat.args").read_text(encoding="utf-8").split("\n")

    chats_before = call("/api/chats")[1]
    code, got = call("/api/compact-chat?project=" + shown(project))
    check("the project has an empty compact chat", code == 200 and got["messages"] == [] and got["busy"] is False, got)
    check("a folder that isn't there has none", call("/api/compact-chat?project=" + shown(project / "gone"))[0] == 400)
    check("and takes no message", call("/api/compact-chat/say", {"project": shown(project / "gone"), "text": "Hi"})[0] == 400)
    code, got = call("/api/compact-chat/say", {"project": shown(project), "text": "What is this?"})
    check("a message starts a turn", code == 202, got)
    check("the turn ends", finished(project, 1))
    got = call("/api/compact-chat?project=" + shown(project))[1]
    check("the message and the answer are kept",
          [(m["role"], m["text"]) for m in got["messages"]] == [("you", "What is this?"), ("claude", "It reads the README.")], got)
    args = last_args()
    check("the turn may only read", args[args.index("--tools") + 1] == "Read,Glob,Grep,Skill"
          and not {"Write", "Edit", "Bash"} & set(args), args)
    check("in the project's folder", project.name in (stand_in / "chat.cwd").read_text(encoding="utf-8"))
    sid = args[args.index("--session-id") + 1] if "--session-id" in args else ""
    check("the first turn names its conversation", bool(sid))
    check("a second turn", call("/api/compact-chat/say", {"project": shown(project), "text": "And then?"})[0] == 202 and finished(project, 2))
    args = last_args()
    check("goes on with the same one", args[args.index("--resume") + 1] == sid and "--session-id" not in args, args)
    check("another project has a history of its own", call("/api/compact-chat?project=" + shown(other))[1]["messages"] == [])
    check("the first one's is as it was", len(call("/api/compact-chat?project=" + shown(project))[1]["messages"]) == 4)
    check("the full panel's chats don't list it", call("/api/chats")[1] == chats_before)
    files = list((Path(os.environ["TATTY_HOME"]) / "compact-chats").glob("*.json"))
    check("kept in a folder of its own", len(files) == 1, files)

    for tag in ("s-cq1", "s-cq2"):
        call("/api/hello", {"tag": tag, "session": "cq-" + tag})
    qs = lambda text: [{"question": text, "options": ["Yes", "No"]}]
    id1 = call("/api/ask", {"questions": qs("First question?"), "tag": "s-cq1", "source": "one"})[1]["id"]
    id2 = call("/api/ask", {"questions": qs("Second question?"), "tag": "s-cq2", "source": "two"})[1]["id"]
    events = {e["id"]: e for e in call("/api/events")[1] if e["type"] == "ask"}
    check("each question says which session asked it", events[id1]["tag"] == "s-cq1" and events[id2]["tag"] == "s-cq2")
    check("and carries what was asked, with a place in the order", events[id1]["seq"] < events[id2]["seq"]
          and events[id2]["questions"][0]["question"] == "Second question?")
    check("both wait", call("/api/answer/" + id1)[1]["status"] == "pending" and call("/api/answer/" + id2)[1]["status"] == "pending")
    check("an answer to a question that isn't there is refused", call("/api/reply", {"id": "nosuchid", "answers": {}})[0] == 404)
    check("so is one without its answers", call("/api/reply", {"id": id2})[0] == 400)
    code, _ = call("/api/reply", {"id": id1, "answers": {"First question?": "Yes"}})
    check("an answer is taken by the question's id", code == 200)
    got = call("/api/answer/" + id1)[1]
    check("and is the answer of the session that asked", got["status"] == "answered" and got["answers"] == {"First question?": "Yes"}, got)
    check("the other question is still waiting", call("/api/answer/" + id2)[1]["status"] == "pending")
    done = {e["id"]: e for e in call("/api/events")[1] if e["type"] == "answered"}
    check("the answer is announced for its own session only", done[id1]["tag"] == "s-cq1" and id2 not in done, done)
    check("a question is answered once", call("/api/reply", {"id": id1, "answers": {"First question?": "No"}})[0] == 409)
    check("what was left unanswered can still be answered later",
          call("/api/reply", {"id": id2, "answers": {"Second question?": "No"}})[0] == 200
          and call("/api/answer/" + id2)[1]["answers"] == {"Second question?": "No"})
    for tag in ("s-cq1", "s-cq2"):
        call("/api/bye", {"tag": tag})


def main(argv):
    part_one()
    if "--project" in argv:
        part_two(argv[argv.index("--project") + 1])
    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
