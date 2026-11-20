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
LOCK_AGE = 300  # seconds: a git lock older than this is left over, not a command still running


def long_path(p):
    """A path Windows can open past 260 characters."""
    p = os.path.abspath(str(p))
    return "\\\\?\\" + p if os.name == "nt" and len(p) >= 240 and not p.startswith("\\\\?\\") else p


def sync_tree(src, dst):
    """Copy what `dst` lacks of `src`, or has at another size: a copy that stopped carries on where it was, and a whole one is
    only read. Symlinks are made again, never followed. Returns the number of files copied."""
    copied, stack = 0, [(str(src), str(dst))]
    while stack:
        here, there = stack.pop()
        os.makedirs(long_path(there), exist_ok=True)
        with os.scandir(long_path(here)) as it:
            entries = list(it)
        for e in entries:
            target = os.path.join(there, e.name)
            if e.is_symlink():
                if not os.path.lexists(long_path(target)):
                    os.symlink(os.readlink(e.path), long_path(target), target_is_directory=e.is_dir())
                    copied += 1
            elif e.is_dir(follow_symlinks=False):
                stack.append((e.path, target))
            else:
                try:
                    have = os.stat(long_path(target)).st_size
                except OSError:
                    have = -1
                if have != e.stat(follow_symlinks=False).st_size:
                    shutil.copy2(long_path(e.path), long_path(target))
                    copied += 1
    return copied


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


def git_try(where, *args, timeout=60):
    """(code, output) of a git command; (-1, "") when git can't run or takes too long, so a check goes on to the next."""
    try:
        return git(where, *args, timeout=timeout, check=False)
    except PoolError:
        return -1, ""


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
    def warm_done(self):
        """{slot: {folder: when its copy finished}}: written only after a copy ends, so a folder with no entry may have stopped."""
        try:
            return json.loads((self.dir / "pool.warm.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def warm_mark(self, name, rel=None):
        """Note that a slot's folder `rel` was copied whole (or, with no rel, forget the slot: it is being made again)."""
        data = self.warm_done()
        if rel is None:
            data.pop(name, None)
        else:
            data.setdefault(name, {})[rel] = time.time()
        tmp = self.dir / "pool.warm.tmp"
        tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, self.dir / "pool.warm.json")

    def warm(self, name, resume=False):
        """Copy the config's `warm` folders from the main checkout into a slot. With resume, a folder the slot has already is
        carried on rather than copied again (only what is missing or another size is copied). A folder is marked done only
        when its copy ends, so one that stopped is found by validate. Returns the folders copied."""
        done = []
        for rel in self.config()["warm"]:
            src, dst = self.repo / rel, self.slot_path(name) / rel
            if not src.is_dir():
                continue
            if resume and dst.is_dir():
                sync_tree(src, dst)
            else:
                shutil.copytree(src, dst, symlinks=True, dirs_exist_ok=True)
            self.warm_mark(name, rel)
            done.append(rel)
        return done

    # ---------------------------------------------------------------- commands
    def make_slot(self, number):
        name = f"slot-{number}"
        path = self.slot_path(name)
        git(self.repo, "worktree", "prune")
        git(self.repo, "worktree", "add", "-B", f"pool/{name}", str(path), self.base_ref())
        self.warm_mark(name)  # a slot made again starts with no copy on record
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
        self.warm_mark(name)
        return {"removed": name}

    # ---------------------------------------------------------------- validate and repair
    def _listing(self):
        """git's own view of the repo's worktrees: {folder (lower-cased, forward slashes): {prunable, locked, detached}}."""
        code, out = git_try(self.repo, "worktree", "list", "--porcelain", timeout=120)
        found, cur = {}, None
        for line in out.splitlines() if code == 0 else []:
            key, _, val = line.partition(" ")
            if key == "worktree":
                cur = found.setdefault(Path(val).as_posix().lower(), {"prunable": "", "locked": False, "detached": False})
            elif cur is not None and key in ("prunable", "locked", "detached"):
                cur[key] = (val or True) if key == "prunable" else True
        return found

    def _admin_dir(self, path):
        """The folder git keeps this worktree's private files in (named by the slot's .git file), or None."""
        try:
            first = (Path(path) / ".git").read_text(encoding="utf-8", errors="replace").splitlines()[0]
        except (OSError, IndexError):
            return None
        if not first.startswith("gitdir:"):
            return None
        return Path(first[7:].strip())

    def _lock_files(self, name, admin):
        out = [Path(str(self.repo / ".git" / "refs" / "heads" / "pool" / name) + ".lock")]
        if admin:
            out += [admin / "index.lock", admin / "HEAD.lock"]
        return out

    def validate_slot(self, name, listing=None, now=None):
        """Is a slot a whole, usable checkout? {slot, level: ok|warn|broken, problems: [{code, text, fix, level}]}. Reads
        files first (no process), then git. A lock younger than LOCK_AGE is a git command still running, so it is no fault."""
        now = now or time.time()
        path = self.slot_path(name)
        claim = self.state()["claims"].get(name)
        probs = []

        def bad(code, text, fix="", level="broken"):
            probs.append({"code": code, "text": text, "fix": fix, "level": level})

        listing = self._listing() if listing is None else listing
        info = listing.get(path.as_posix().lower())
        admin = self._admin_dir(path)
        if not (path / ".git").exists():
            bad("no-git", "The folder has no .git file: the checkout never started or was cut off.", "rebuild")
        elif admin is None or not admin.is_dir():
            bad("no-admin", "git has no record of this worktree (its private folder is missing).", "rebuild")
        else:
            if not (admin / "HEAD").is_file():
                bad("no-head", "git's HEAD file for this worktree is missing.", "rebuild")
            if not (admin / "index").is_file():
                bad("no-index", "The checkout never finished: git writes the index last and it isn't there.", "rebuild")
        for lk in self._lock_files(name, admin):
            try:
                age = now - lk.stat().st_mtime
            except OSError:
                continue
            if age > LOCK_AGE:
                bad("stale-lock", f"{lk.name} was left behind {int(age // 60)} minutes ago by a git command that stopped.", "clear-lock")
        if info is None and not any(p["code"] in ("no-git", "no-admin") for p in probs):
            bad("not-listed", "git doesn't list this folder as a worktree.", "rebuild")
        elif info and info["prunable"]:
            why = "its folder is gone" if info["prunable"] is True else info["prunable"]
            bad("prunable", f"git says this worktree can be pruned: {why}.", "prune")
        if any(p["code"] in ("no-git", "no-admin", "no-head", "not-listed") for p in probs):
            return self._level(name, claim, probs)
        want = (claim or {}).get("branch") or f"pool/{name}"
        if git_try(path, "rev-parse", "--verify", "--quiet", "HEAD")[0] != 0:
            bad("no-commit", "HEAD doesn't point at a commit.", "rebuild")
        else:
            on = git_try(path, "branch", "--show-current")[1]
            if on != want:
                bad("wrong-branch", f"It is on {on or 'a detached HEAD'}, not {want}.", "", "warn")
            if not any(p["code"] == "no-index" for p in probs):
                code, out = git_try(path, "ls-files", "-d", "-z", timeout=300)
                if code != 0:
                    bad("slow", "Checking its files took too long or failed: check it again.", "", "warn")
                elif out:
                    gone = [f for f in out.split("\0") if f]
                    bad("missing-files", f"{len(gone)} tracked file{'s' if len(gone) != 1 else ''} missing from the folder (first: {gone[0]}).",
                        "rebuild" if claim else "restore-files")
        marks = self.warm_done().get(name, {})
        for rel in self.config()["warm"]:
            if not (self.repo / rel).is_dir():
                continue
            if not (path / rel).is_dir():
                bad("warm-missing", f"{rel} was not copied into the slot.", "warm", "warn")
            elif rel not in marks:
                bad("warm-unfinished", f"{rel} has no record that its copy finished: it may have stopped part way (or was copied before Tatty kept a record).", "warm", "warn")
        return self._level(name, claim, probs)

    def _level(self, name, claim, probs):
        level = "broken" if any(p["level"] == "broken" for p in probs) else "warn" if probs else "ok"
        return {"slot": name, "level": level, "problems": probs, "claimed": bool(claim)}

    def validate(self):
        """Check every slot: {at, slots: {name: result}}."""
        self.need()
        listing = self._listing()
        return {"at": time.time(), "slots": {n: self.validate_slot(n, listing) for n in self.slot_names()}}

    def repair(self, what, action):
        """Mend one slot. `action` must be one the slot's own problems offer: a fresh check decides, never the caller."""
        self.need()
        name = self.find(what)
        found = self.validate_slot(name)
        if action not in {p["fix"] for p in found["problems"] if p["fix"]}:
            raise PoolError(f"{name} doesn't need {action} now: check it again.")
        path = self.slot_path(name)
        claim = self.state()["claims"].get(name)
        if action == "clear-lock":
            for lk in self._lock_files(name, self._admin_dir(path)):
                if lk.is_file() and time.time() - lk.stat().st_mtime > LOCK_AGE:
                    lk.unlink()
            return {"slot": name, "did": "removed the stale lock"}
        if action == "prune":
            git(self.repo, "worktree", "prune")
            return {"slot": name, "did": "pruned git's list"}
        if action == "warm":
            return {"slot": name, "did": "copied " + ", ".join(self.warm(name, resume=True))}
        if action == "restore-files":
            if claim:
                raise PoolError(f"{name} is claimed: its files are the feature's to restore.")
            git(path, "checkout", "--", ".")
            return {"slot": name, "did": "restored the missing files"}
        if action == "rebuild":
            return self._rebuild(name, claim)
        raise PoolError(f"{action} isn't a repair.", 2)

    def _rebuild(self, name, claim):
        """Remove the slot's folder and make it again. A claimed slot is made again on its claimed branch, whose commits
        are kept; whatever was uncommitted in the folder is lost."""
        path = self.slot_path(name)
        git(self.repo, "worktree", "remove", "--force", str(path), timeout=900, check=False)
        if path.exists():
            def chmod_then(fn, p, _):
                os.chmod(p, 0o700)
                fn(p)
            shutil.rmtree(long_path(path), onerror=chmod_then)
        git(self.repo, "worktree", "prune")
        if not claim:
            self.make_slot(int(SLOT.match(name).group(1)))
            return {"slot": name, "did": "made the slot again"}
        branch = claim["branch"]
        if git(self.repo, "rev-parse", "--verify", "--quiet", f"refs/heads/{branch}", check=False)[0] == 0:
            git(self.repo, "worktree", "add", str(path), branch)
        else:  # the branch is gone: made again from where it began
            git(self.repo, "worktree", "add", "-b", branch, str(path), claim.get("base") or self.base_ref())
        self.warm_mark(name)
        self.warm(name)
        return {"slot": name, "did": f"made the slot again on {branch}"}

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
    sub.add_parser("validate")
    p = sub.add_parser("repair"); p.add_argument("slot"); p.add_argument("action", choices=["clear-lock", "prune", "warm", "restore-files", "rebuild"])
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
        elif a.cmd == "validate":
            def shown(r):
                rows = [f"{n}: {x['level']}" + "".join("\n    " + p["text"] + (f" [{p['fix']}]" if p["fix"] else "") for p in x["problems"])
                        for n, x in r["slots"].items()]
                return "\n".join(rows)
            res = pool.validate()
            say(res, j, shown)
            return 0 if all(x["level"] == "ok" for x in res["slots"].values()) else 3
        elif a.cmd == "repair":
            say(pool.repair(a.slot, a.action), j, lambda r: f"{r['slot']}: {r['did']}.")
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
