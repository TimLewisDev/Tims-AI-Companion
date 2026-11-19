#!/usr/bin/env python3
"""worktreepool.py: a pool of ready git worktrees ("slots") for one repository.

A slot is an ordinary worktree at <repo parent>/<repo name>.pool/slot-N, parked on the placeholder
branch pool/slot-N. Claiming a slot switches it onto a real branch; releasing it parks it again. Because
a slot is made once and kept current, starting work is a branch switch, not a checkout (and, for a
project whose tools keep a big untracked cache, not a full rebuild of that cache either).

Nothing here knows any one project: what to copy into a new slot comes from the pool's config ("warm"),
seeded on init from what the repository looks like (a Unity project gets its Library folder).

Commands (run inside the repository, or give --repo):
  init [--size N]            make the pool: N slots (config size when omitted)
  status [--json]            every slot: free or claimed, how far behind, which branch
  claim <branch> [--from B]  take a free slot onto a new branch; prints the slot's path
  release <slot|branch>      give a slot back (refused while it has uncommitted or untracked files)
  refresh                    bring every free slot up to date with the base branch
  add [N]                    add slots (asks for nothing: the caller decides), up to the config max
  remove <slot>              delete a free slot
  config [key=value ...]     show the config, or set size / max / base / warm (warm=a,b or warm=)

Exit codes: 0 done, 1 failed, 2 bad usage, 4 no slot is free (add one), 5 no pool here (init first).
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

DEFAULTS = {"size": 3, "max": 6, "base": "", "warm": []}
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
SLOT = re.compile(r"^slot-(\d+)$")


def tree_size(path, skip=()):
    """Bytes of the files under `path` (symlinks not followed; folders named in `skip` at its top left out)."""
    root, total, stack = str(path), 0, [str(path)]
    while stack:
        here = stack.pop()
        try:
            with os.scandir(here) as it:
                for e in it:
                    try:
                        if e.is_symlink():
                            continue
                        if e.is_dir(follow_symlinks=False):
                            if not (here == root and e.name in skip):
                                stack.append(e.path)
                        else:
                            total += e.stat(follow_symlinks=False).st_size
                    except OSError:
                        pass
        except OSError:
            pass
    return total


class PoolError(Exception):
    def __init__(self, msg, code=1):
        super().__init__(msg)
        self.code = code


def git(where, *args, timeout=900, check=True):
    """Output of a git command run in `where`; PoolError on a failure unless check is False (then (code, out))."""
    try:
        p = subprocess.run(["git", "-C", str(where), *args], capture_output=True, stdin=subprocess.DEVNULL,
                           timeout=timeout, creationflags=NO_WINDOW)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise PoolError(f"git {' '.join(args[:2])}: {e}")
    out = (p.stdout + p.stderr).decode("utf-8", "replace").strip()
    if not check:
        return p.returncode, out
    if p.returncode != 0:
        raise PoolError(f"git {' '.join(args[:3])} failed: {out}")
    return out


def repo_top(start):
    """The top folder of the repository `start` is in. Run inside a worktree, it still names the main checkout."""
    code, out = git(start, "rev-parse", "--path-format=absolute", "--git-common-dir", check=False)
    if code != 0:
        raise PoolError(f"{start} isn't in a git repository.")
    common = Path(out)
    top = common.parent if common.name == ".git" else Path(git(start, "rev-parse", "--show-toplevel"))
    return top


class Pool:
    def __init__(self, repo):
        self.repo = Path(repo)
        self.dir = self.repo.parent / f"{self.repo.name}.pool"
        self.config_file = self.dir / "pool.config.json"
        self.state_file = self.dir / "pool.json"

    # ---------------------------------------------------------------- config and state
    def exists(self):
        return self.config_file.is_file()

    def need(self):
        if not self.exists():
            raise PoolError(f"No worktree pool for {self.repo}: run init first.", 5)

    def seed_config(self):
        cfg = dict(DEFAULTS)
        if (self.repo / "ProjectSettings" / "ProjectVersion.txt").is_file():  # a Unity project: its import cache is the slow part
            cfg["warm"] = ["Library"]
        return cfg

    def config(self):
        try:
            cfg = json.loads(self.config_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            cfg = {}
        return {**DEFAULTS, **{k: cfg[k] for k in DEFAULTS if k in cfg}}

    def save_config(self, cfg):
        self.dir.mkdir(parents=True, exist_ok=True)
        self.config_file.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")

    def state(self):
        try:
            data = json.loads(self.state_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        data.setdefault("claims", {})
        return data

    def save_state(self, data):
        tmp = self.state_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, self.state_file)

    # ---------------------------------------------------------------- git facts
    def base_name(self):
        """The branch slots follow: config base, else the remote's default branch, else main or master."""
        want = self.config()["base"]
        if want:
            return want
        code, out = git(self.repo, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD", check=False)
        if code == 0 and "/" in out:
            return out.split("/", 1)[1]
        for b in ("main", "master", "develop"):
            if git(self.repo, "rev-parse", "--verify", "--quiet", b, check=False)[0] == 0:
                return b
        raise PoolError("Can't tell which branch the slots should follow: set base (config base=<branch>).")

    def base_ref(self, base=""):
        """What to branch from: origin/<base> when the remote has it, else the local branch."""
        # a base the caller named is taken as local first (their own branch, maybe not pushed); the pool's own follows the remote
        base, named = base or self.base_name(), bool(base)
        for ref in ((base, f"origin/{base}") if named else (f"origin/{base}", base)):
            if git(self.repo, "rev-parse", "--verify", "--quiet", ref + "^{commit}", check=False)[0] == 0:
                return ref
        raise PoolError(f"{base} isn't a branch or commit of {self.repo}.")

    def fetch(self):
        git(self.repo, "fetch", "--prune", "origin", check=False)  # offline or no remote: carry on with what is local

    def slot_path(self, name):
        return self.dir / name

    def slot_names(self):
        """Slots that exist on disk, in number order."""
        if not self.dir.is_dir():
            return []
        found = [(int(m.group(1)), d.name) for d in self.dir.iterdir() if d.is_dir() and (m := SLOT.match(d.name))]
        return [n for _, n in sorted(found)]

    def is_clean(self, path):
        return git(path, "status", "--porcelain", check=False)[1] == ""

    def slot_info(self, name, base_ref, check_clean=True):
        path = self.slot_path(name)
        claim = self.state()["claims"].get(name)
        branch = git(path, "branch", "--show-current", check=False)[1]
        behind = git(path, "rev-list", "--count", f"HEAD..{base_ref}", check=False)[1] if base_ref else ""
        return {"slot": name, "path": path.as_posix(), "state": "claimed" if claim else "free", "branch": branch,
                "claimedFor": (claim or {}).get("branch", ""), "behind": int(behind) if behind.isdigit() else None,
                "clean": self.is_clean(path) if check_clean else None}

    # ---------------------------------------------------------------- warm copy
    def warm(self, name):
        """Copy the config's `warm` folders from the main checkout into a slot. Returns the folders copied."""
        done = []
        for rel in self.config()["warm"]:
            src, dst = self.repo / rel, self.slot_path(name) / rel
            if not src.is_dir():
                continue
            shutil.copytree(src, dst, symlinks=True, dirs_exist_ok=True)
            done.append(rel)
        return done

    # ---------------------------------------------------------------- commands
    def make_slot(self, number):
        name = f"slot-{number}"
        path = self.slot_path(name)
        git(self.repo, "worktree", "prune")
        git(self.repo, "worktree", "add", "-B", f"pool/{name}", str(path), self.base_ref())
        return name, self.warm(name)

    def init(self, size=None):
        if self.exists():
            raise PoolError(f"{self.dir} is already a pool: use add.")
        cfg = self.seed_config()
        if size is not None:
            cfg["size"] = size
        if cfg["size"] < 1 or cfg["size"] > cfg["max"]:
            raise PoolError(f"size must be from 1 to max ({cfg['max']}).", 2)
        self.base_name()  # fail now, before anything is made, when there is nothing to follow
        self.save_config(cfg)
        self.save_state({"claims": {}})
        self.fetch()
        made = [self.make_slot(n) for n in range(1, cfg["size"] + 1)]
        return {"made": [{"slot": n, "warmed": w} for n, w in made], "dir": self.dir.as_posix()}

    def add(self, count=1):
        self.need()
        cfg, have = self.config(), self.slot_names()
        room = cfg["max"] - len(have)
        if room <= 0:
            raise PoolError(f"The pool has {len(have)} slots, the most the config allows ({cfg['max']}): raise max first.")
        count = min(count, room)
        top = max([int(SLOT.match(n).group(1)) for n in have] + [0])
        self.fetch()
        made = [self.make_slot(top + i + 1) for i in range(count)]
        return {"made": [{"slot": n, "warmed": w} for n, w in made], "total": len(have) + count, "max": cfg["max"]}

    def find(self, what):
        """The slot named `what`, or the one claimed for the branch `what`."""
        if what in self.slot_names():
            return what
        for slot, claim in self.state()["claims"].items():
            if claim.get("branch") == what:
                return slot
        raise PoolError(f"{what} isn't a slot or a claimed branch of this pool.")

    def claim(self, branch, base="", owner=""):
        self.need()
        if not branch or branch.startswith("-") or git(self.repo, "check-ref-format", "--branch", branch, check=False)[0] != 0:
            raise PoolError(f"{branch or '(none)'} isn't a name git allows for a branch.", 2)
        if git(self.repo, "rev-parse", "--verify", "--quiet", f"refs/heads/{branch}", check=False)[0] == 0:
            raise PoolError(f"The branch {branch} exists already: choose another name.")
        claims = self.state()["claims"]
        free = [n for n in self.slot_names() if n not in claims and self.is_clean(self.slot_path(n))]
        if not free:
            raise PoolError("No slot is free: add one (add), or release one.", 4)
        name = free[0]
        self.fetch()
        ref = self.base_ref(base)
        path = self.slot_path(name)
        git(path, "switch", "-c", branch, "--no-track", ref)
        state = self.state()
        state["claims"][name] = {"branch": branch, "owner": owner, "base": ref, "at": time.time()}
        self.save_state(state)
        left = len(free) - 1
        return {"slot": name, "path": path.as_posix(), "branch": branch, "base": ref, "free": left,
                "total": len(self.slot_names()), "needAdd": left == 0}

    def release(self, what):
        self.need()
        name = self.find(what)
        path = self.slot_path(name)
        if not self.is_clean(path):
            raise PoolError(f"{path.as_posix()} has uncommitted or untracked files: left as it is.")
        state = self.state()
        claim = state["claims"].get(name, {})
        self.fetch()
        git(path, "switch", f"pool/{name}")
        git(path, "reset", "--hard", self.base_ref())
        state["claims"].pop(name, None)
        self.save_state(state)
        return {"slot": name, "path": path.as_posix(), "branchKept": claim.get("branch", "")}

    def refresh(self):
        self.need()
        self.fetch()
        ref, claims, out = self.base_ref(), self.state()["claims"], []
        for name in self.slot_names():
            path = self.slot_path(name)
            if name in claims:
                out.append({"slot": name, "result": "claimed: left alone"})
            elif not self.is_clean(path):
                out.append({"slot": name, "result": "has uncommitted or untracked files: left alone"})
            else:
                git(path, "switch", f"pool/{name}")
                git(path, "reset", "--hard", ref)
                out.append({"slot": name, "result": f"at {ref}"})
        return {"slots": out}

    def remove(self, what):
        self.need()
        name = self.find(what)
        if name in self.state()["claims"]:
            raise PoolError(f"{name} is claimed: release it first.")
        path = self.slot_path(name)
        if not self.is_clean(path):
            raise PoolError(f"{path.as_posix()} has uncommitted or untracked files: left as it is.")
        git(self.repo, "worktree", "remove", "--force", str(path), timeout=900)  # clean, so only ignored files (the warm copies) go
        git(self.repo, "branch", "-D", f"pool/{name}", check=False)
        return {"removed": name}

    def read_sizes(self):
        """What measure() last found: {at, main, slots: {name: bytes}}, or {}."""
        try:
            return json.loads((self.dir / "pool.sizes.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def measure(self):
        """Read every file of the main checkout (its .git left out) and of each slot, and keep the sizes. Slow on a
        big project: the caller runs it away from anything waiting."""
        found = {"at": time.time(), "main": tree_size(self.repo, skip=(".git",)),
                 "slots": {n: tree_size(self.slot_path(n)) for n in self.slot_names()}}
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self.dir / "pool.sizes.tmp"
        tmp.write_text(json.dumps(found), encoding="utf-8")
        os.replace(tmp, self.dir / "pool.sizes.json")
        return found

    def counts(self):
        """Free and total slots from the config, the claims and the slot folders: no git, so it is cheap to ask often."""
        cfg, names, claims = self.config(), self.slot_names(), self.state()["claims"]
        return {"free": sum(n not in claims for n in names), "total": len(names), "max": cfg["max"],
                "canAdd": len(names) < cfg["max"], "dir": self.dir.as_posix()}

    def status(self):
        self.need()
        ref = self.base_ref()
        rows = [self.slot_info(n, ref) for n in self.slot_names()]
        cfg = self.config()
        return {"repo": self.repo.as_posix(), "dir": self.dir.as_posix(), "base": ref, "size": cfg["size"], "max": cfg["max"],
                "free": sum(r["state"] == "free" for r in rows), "total": len(rows), "slots": rows}

    def set_config(self, pairs):
        self.need()
        cfg = self.config()
        for pair in pairs:
            key, _, val = pair.partition("=")
            if key not in DEFAULTS:
                raise PoolError(f"{key} isn't a setting: {', '.join(DEFAULTS)}.", 2)
            if key == "warm":
                cfg[key] = [p.strip().strip("/\\") for p in val.split(",") if p.strip()]
            elif key in ("size", "max"):
                if not val.isdigit() or int(val) < 1:
                    raise PoolError(f"{key} must be a whole number of 1 or more.", 2)
                cfg[key] = int(val)
            else:
                cfg[key] = val
        if cfg["size"] > cfg["max"]:
            raise PoolError("size can't be more than max.", 2)
        self.save_config(cfg)
        return cfg


def say(result, as_json, text):
    print(json.dumps(result, indent=2) if as_json else text(result))


def main(argv=None):
    ap = argparse.ArgumentParser(prog="pool", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=".", help="a folder in the repository (default: here)")
    ap.add_argument("--json", action="store_true", help="print the result as JSON")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("init"); p.add_argument("--size", type=int)
    sub.add_parser("status")
    p = sub.add_parser("claim"); p.add_argument("branch"); p.add_argument("--from", dest="base", default=""); p.add_argument("--owner", default="")
    p = sub.add_parser("release"); p.add_argument("slot")
    sub.add_parser("refresh")
    p = sub.add_parser("add"); p.add_argument("count", nargs="?", type=int, default=1)
    p = sub.add_parser("remove"); p.add_argument("slot")
    p = sub.add_parser("config"); p.add_argument("pairs", nargs="*")
    a = ap.parse_args(argv)
    try:
        pool = Pool(repo_top(a.repo))
        j = a.json
        if a.cmd == "init":
            say(pool.init(a.size), j, lambda r: f"Made {len(r['made'])} slot(s) in {r['dir']}: " + ", ".join(
                m["slot"] + (f" (copied {', '.join(m['warmed'])})" if m["warmed"] else "") for m in r["made"]))
        elif a.cmd == "add":
            say(pool.add(a.count), j, lambda r: f"Added {len(r['made'])}: the pool now has {r['total']} of at most {r['max']}.")
        elif a.cmd == "claim":
            say(pool.claim(a.branch, a.base, a.owner), j, lambda r: r["path"] + (f"\nThat was the last free slot: add one (pool add) before the next claim." if r["needAdd"] else ""))
        elif a.cmd == "release":
            say(pool.release(a.slot), j, lambda r: f"{r['slot']} is free again." + (f" The branch {r['branchKept']} is kept." if r["branchKept"] else ""))
        elif a.cmd == "refresh":
            say(pool.refresh(), j, lambda r: "\n".join(f"{s['slot']}: {s['result']}" for s in r["slots"]))
        elif a.cmd == "remove":
            say(pool.remove(a.slot), j, lambda r: f"Removed {r['removed']}.")
        elif a.cmd == "config":
            say(pool.set_config(a.pairs) if a.pairs else (pool.need() or pool.config()), True, None)
        else:
            def show(r):
                head = f"{r['free']} of {r['total']} slots free (max {r['max']}), following {r['base']}"
                rows = [f"  {s['slot']}  {s['state']:7} {s['branch'] or '-':40} behind {s['behind'] if s['behind'] is not None else '?'}"
                        + ("" if s["clean"] else "  (uncommitted files)") for s in r["slots"]]
                return "\n".join([head, *rows])
            say(pool.status(), j, show)
    except PoolError as e:
        print(f"pool: {e}", file=sys.stderr)
        return e.code
    return 0


if __name__ == "__main__":
    sys.exit(main())
