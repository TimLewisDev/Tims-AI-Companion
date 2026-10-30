"""The compact chat: one read-only Claude conversation per project, for the
compact window.

It is kept apart from the chats of the full panel (see "chats" in server.py):
it has its own records, its own runs and its own events, and no tab to close.
Each project has exactly one conversation, kept in <home>/compact-chats/<key>.json
where the key comes from the project's folder. Each turn is one headless
`claude -p` run in that folder (first with --session-id, then --resume), so the
conversation is Claude Code's own and the project's documents are read on demand
rather than handed over. The run may only read: a turn whose command would allow
anything else is refused.

The server gives this module what it needs from itself (Hooks), so nothing here
imports the server. Standard library only.
"""

import hashlib
import json
import os
import subprocess
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

MAX_MESSAGE = 20000
MAX_KEPT = 200  # messages kept per project; older ones drop off the front
READ_ONLY_TOOLS = frozenset({"Read", "Glob", "Grep", "Skill"})
SYSTEM_NOTE = ("You are Tatty's compact chat for the project in the current folder. You can only read: look "
               "through the project's documents and code when a question needs them, and answer briefly. "
               "You cannot change files or run commands.")


@dataclass
class Hooks:
    """What the compact chat takes from the server."""
    home: Callable[[], Path]
    claude_path: Callable[[], str]
    argv: Callable[[str], list]  # session id -> the claude command for one turn
    git_bash_path: Callable[[], str]
    kill_tree: Callable[[object], None]
    step_label: Callable[[dict], str]  # a tool call -> a line for the page
    no_claude: str
    no_window: int = 0
    timeout: float = 600.0


def project_key(project):
    """The same folder gives the same key however it is written."""
    norm = os.path.normcase(os.path.abspath(str(project))).replace("\\", "/").rstrip("/")
    return hashlib.sha1(norm.encode("utf-8")).hexdigest()[:16]


def read_only_argv(argv):
    """True when the command's tools are all read-only tools and nothing else is allowed."""
    try:
        tools = [t for t in argv[argv.index("--tools") + 1].split(",") if t]
    except (ValueError, IndexError):
        return False
    allowed = []
    if "--allowedTools" in argv:
        i = argv.index("--allowedTools") + 1
        while i < len(argv) and not argv[i].startswith("--"):
            allowed.append(argv[i])
            i += 1
    return bool(tools) and set(tools) <= READ_ONLY_TOOLS and set(allowed) <= READ_ONLY_TOOLS


class CompactChat:
    def __init__(self, state, hooks):
        self.state = state
        self.hooks = hooks
        self.runs = {}  # project key -> the turn it is answering now
        self.lock = threading.Lock()  # one change to a project's file at a time

    # -- records

    def dir(self):
        return self.hooks.home() / "compact-chats"

    def path(self, key):
        return self.dir() / f"{key}.json"

    def read(self, project):
        """The project's conversation as kept, or a new one that isn't written until its first message."""
        key = project_key(project)
        try:
            got = json.loads(self.path(key).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            got = None
        if isinstance(got, dict) and got.get("key") == key and isinstance(got.get("messages"), list):
            return got
        return {"key": key, "project": Path(project).as_posix(), "claudeSession": str(uuid.uuid4()),
                "messages": [], "cost": 0.0, "created": time.time()}

    def write(self, c):
        self.dir().mkdir(parents=True, exist_ok=True)
        tmp = self.dir() / f"{c['key']}.json.tmp"
        tmp.write_text(json.dumps(c, indent=2), encoding="utf-8")
        os.replace(tmp, self.path(c["key"]))

    def change(self, project, change):
        """Read the project's conversation, change(c) it and write it back: the conversation."""
        with self.lock:
            c = self.read(project)
            change(c)
            c["messages"] = c["messages"][-MAX_KEPT:]
            self.write(c)
            return c

    # -- operations

    def resolve(self, given):
        """The project a request is about: the one named, else the server's current one.
        (project or None, error). There is never a conversation without a project."""
        project = str(given or "").strip()
        if not project and not self.state.hub_pending:
            project = self.state.cwd or ""
        if not project or not os.path.isdir(project):
            return None, "Choose the project this chat works in."
        return project, ""

    def view(self, project, c=None):
        """A project's conversation as the page sees it: what is kept, and whether it is answering now."""
        c = c or self.read(project)
        run = self.runs.get(c["key"])
        return {"project": c["project"], "messages": c["messages"], "cost": c.get("cost", 0.0),
                "busy": bool(run), "step": run["step"] if run else ""}

    def get(self, given):
        project, err = self.resolve(given)
        if not project:
            return 400, {"error": err}
        return 200, self.view(project)

    def say(self, b):
        """Send a message to the project's compact chat: one headless turn, on a thread
        of its own: (http code, answer)."""
        project, err = self.resolve(b.get("project"))
        if not project:
            return 400, {"error": err}
        text = str(b.get("text", "")).strip()
        if not text or len(text) > MAX_MESSAGE:
            return 400, {"error": f"Say something (at most {MAX_MESSAGE} characters)."}
        claude = self.hooks.claude_path()
        if not claude:
            return 501, {"error": self.hooks.no_claude}
        key = project_key(project)
        with self.state.cond:
            if key in self.runs:
                return 409, {"error": "The chat is still answering."}
            self.runs[key] = {"step": "Starting", "proc": None, "cancelled": False}
        c = self.change(project, lambda c: c["messages"].append({"role": "you", "text": text, "ts": time.time()}))
        argv = self.hooks.argv(c["claudeSession"])
        if not read_only_argv(argv):
            with self.state.cond:
                self.runs.pop(key, None)
            return 500, {"error": "The compact chat only reads, and this command would allow more."}
        argv += ["--append-system-prompt", SYSTEM_NOTE]
        threading.Thread(target=self.turn, args=(project, key, argv, text + "\n"), daemon=True).start()
        self.state.emit("compact-chat", project=c["project"], busy=True, step="Starting")
        return 202, self.view(project, c)

    def stop(self, given):
        """Stop the turn being answered. False when there isn't one."""
        project, _ = self.resolve(given)
        run = self.runs.get(project_key(project)) if project else None
        if not run:
            return False
        run["cancelled"] = True
        if run.get("proc"):
            self.hooks.kill_tree(run["proc"])
        return True

    # -- a turn

    def turn(self, project, key, argv, prompt):
        hooks, state, run = self.hooks, self.state, self.runs[key]
        shown = Path(project).as_posix()
        env = {k: v for k, v in os.environ.items() if k not in ("TATTY_SESSION", "TATTY_JOIN")}
        if os.name == "nt" and not env.get("CLAUDE_CODE_GIT_BASH_PATH") and hooks.git_bash_path():
            env["CLAUDE_CODE_GIT_BASH_PATH"] = hooks.git_bash_path()
        final, texts, steps, error = None, [], [], ""
        try:
            with tempfile.TemporaryFile("w+", encoding="utf-8", errors="replace") as errf:
                p = subprocess.Popen(argv, cwd=project, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errf,
                                     encoding="utf-8", errors="replace", env=env, creationflags=hooks.no_window,
                                     start_new_session=os.name != "nt")
                run["proc"] = p
                if run["cancelled"]:
                    hooks.kill_tree(p)
                timer = threading.Timer(hooks.timeout, lambda: (run.update(timedOut=True), hooks.kill_tree(p)))
                timer.start()
                try:
                    p.stdin.write(prompt)
                    p.stdin.close()
                except OSError:
                    pass
                for line in p.stdout:
                    state.touch()
                    try:
                        msg = json.loads(line)
                    except ValueError:
                        continue
                    if not isinstance(msg, dict):
                        continue
                    if msg.get("type") == "assistant":
                        for block in (msg.get("message") or {}).get("content") or []:
                            if not isinstance(block, dict):
                                continue
                            if block.get("type") == "text" and str(block.get("text", "")).strip():
                                texts.append(str(block["text"]).strip())
                            elif block.get("type") == "tool_use":
                                run["step"] = hooks.step_label(block)
                                steps.append(run["step"])
                                state.emit("compact-chat", project=shown, busy=True, step=run["step"])
                    elif msg.get("type") == "result":
                        final = msg
                p.wait()
                timer.cancel()
                errf.seek(0)
                said = [ln.strip() for ln in errf.read().splitlines() if ln.strip()]
            if run["cancelled"]:
                error = "Stopped."
            elif run.get("timedOut"):
                error = f"The answer took longer than {int(hooks.timeout // 60)} minutes and was stopped."
            elif final is None:
                error = said[-1] if said else f"claude exited {p.returncode} saying nothing"
            elif final.get("is_error") or final.get("subtype") != "success":
                error = str(final.get("result") or final.get("subtype") or "the turn failed")[:400]
        except OSError as e:
            error = f"couldn't run claude: {e}"
        reply = str(final.get("result") or "").strip() if final and not error else ""
        reply = reply or "\n\n".join(texts)
        cost = float(final.get("total_cost_usd") or 0) if final else 0.0

        def keep(c):
            if reply:
                c["messages"].append({"role": "claude", "text": reply, "ts": time.time(), "steps": steps[:40],
                                      "cost": round(cost, 4)})
            if error:
                c["messages"].append({"role": "error", "text": error, "ts": time.time()})
            c["cost"] = round(c.get("cost", 0) + cost, 4)
        self.change(project, keep)
        with state.cond:
            self.runs.pop(key, None)
        state.emit("compact-chat", project=shown, busy=False, done=True, ok=not error, error=error)
