#!/usr/bin/env python3
"""test-tatty-plan.py: run parts of tools/test-tatty.sh, alone or side by side.

  bash tools/test-tatty.sh --list                      the sections, what each needs and about how long it takes
  bash tools/test-tatty.sh --only jira,chats           just those sections (and the ones they need)
  bash tools/test-tatty.sh --changed [REF]             the sections the changes since REF (default: where this branch left
                                                       origin/main; uncommitted work counts) could affect, and why
  bash tools/test-tatty.sh --parallel [N]              everything, in N groups run at once (default 4)
  ... --changed and --only can be combined with --parallel; -n shows the plan without running; -v shows every
  check; --check validates the tables

test-tatty.sh guards each section with `if section <slug>; then ... fi` and runs the ones named in TATTY_SECTIONS (the
exact list; "-" is none), after its base: the server and the checks of tatty.sh, which every run does. This script
chooses the list and starts test-tatty.sh once per group.

Tables, next to this file:
  test-tatty.sections   slug, extra needs, seconds. A section also needs the nearest earlier section that defines a
                        shell variable or function it uses (found here, by reading the script); the "extra" column holds
                        the needs that come from state instead (a feature made, a file written).
  test-tatty.areas      which sections a changed file (or a region of server.py) can affect.
"""
import argparse
import fnmatch
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
SCRIPT = TOOLS / "test-tatty.sh"
SECTIONS = TOOLS / "test-tatty.sections"
AREAS = TOOLS / "test-tatty.areas"
SERVER = "plugins/tatty/app/server.py"
BASE_SECONDS = 50  # the server and the checks of tatty.sh, repeated by every group

GUARD = re.compile(r"^if section (\w+); then\s*$")
NAME = r"[A-Za-z_][A-Za-z0-9_]*"
DEF_VAR = re.compile(r"(?:^|[;&{(]|\|\|)\s*(?:export\s+|local\s+)?(" + NAME + r")=")
DEF_FUNC = re.compile(r"^\s*(" + NAME + r")\(\)\s*\{")
DEF_FOR = re.compile(r"\bfor\s+(" + NAME + r")\s+in\b")
DEF_READ = re.compile(r"\bread\s+(?:-\w+\s+)*(" + NAME + r")\b")
USE_VAR = re.compile(r"\$\{?(" + NAME + r")(:?[-+=?])?")


class Problem(Exception):
    pass


# ---------------------------------------------------------------- the script

def read_script():
    return SCRIPT.read_text(encoding="utf-8").replace("\r\n", "\n").split("\n")


def parse_script(lines=None):
    """(sections, base): sections is an ordered list of dicts (slug, start, end: 1-based lines of the script, text);
    base is the line numbers outside every section."""
    lines = read_script() if lines is None else lines
    sections, cur = [], None
    for i, line in enumerate(lines, 1):
        m = GUARD.match(line)
        ends = cur is not None and (
            m or line.startswith('echo "# close"') or line.startswith('[ "$TOOLBOX" = 1 ] ||'))
        if ends:
            cur["end"] = i - 1
            sections.append(cur)
            cur = None
        if m:
            cur = {"slug": m.group(1), "start": i}
    if cur:
        raise Problem("a section is not closed before the end of test-tatty.sh")
    for s in sections:
        s["text"] = "\n".join(lines[s["start"] - 1:s["end"]])
    covered = set()
    for s in sections:
        covered.update(range(s["start"], s["end"] + 1))
    return sections, [n for n in range(1, len(lines) + 1) if n not in covered]


HEREDOC = re.compile(r"<<-?\s*(?:'(\w+)'|\"(\w+)\")")


def code_lines(text):
    """the lines the shell runs: no comments, and none of the quoted here-documents (stand-in scripts and Python
    snippets written out as they are, whose functions and variables belong to them, not to the test)"""
    out, ends = [], None
    for l in text.split("\n"):
        if ends is not None:
            if l.strip() == ends:
                ends = None
            continue
        if l.lstrip().startswith("#"):
            continue
        out.append(l)
        m = HEREDOC.search(l)
        if m:
            ends = m.group(1) or m.group(2)
    return out


def defined_in(text):
    """name -> first line (0-based, within text) at which a shell variable or function is defined"""
    out = {}
    for i, l in enumerate(code_lines(text)):
        names = [m.group(1) for m in DEF_VAR.finditer(l)]
        for rx in (DEF_FUNC, DEF_FOR, DEF_READ):
            names += [m.group(1) for m in rx.finditer(l)]
        for n in names:
            out.setdefault(n, i)
    return out


def used_in(text, funcs):
    """name -> first line at which it is used (a variable that must be set, or one of the given functions)"""
    out = {}
    for i, l in enumerate(code_lines(text)):
        for m in USE_VAR.finditer(l):
            if not (m.group(2) and "{" in l[max(0, m.start()):m.start() + 2]):
                out.setdefault(m.group(1), i)
        for f in funcs:
            if re.search(r"(?:^|[\s;&|(`$!])" + re.escape(f) + r"(?:\s|$|\))", l):
                out.setdefault(f, i)
    return out


def static_needs(sections, lines):
    """slug -> set of earlier slugs that define something the section uses before it defines it itself"""
    base_text = "\n".join(lines[n - 1] for n in parse_script(lines)[1])
    base_defs = set(defined_in(base_text))
    defs = [defined_in(s["text"]) for s in sections]
    funcs = {n for d in defs for n in d if re.search(r"(?:^|\n)\s*" + re.escape(n) + r"\(\)\s*\{", "\n".join(lines))}
    funcs -= base_defs
    needs = {}
    for k, s in enumerate(sections):
        need = set()
        for name, first_use in used_in(s["text"], funcs).items():
            if name in base_defs:
                continue
            if name in defs[k] and defs[k][name] <= first_use:
                continue
            for j in range(k - 1, -1, -1):
                if name in defs[j]:
                    need.add(sections[j]["slug"])
                    break
        needs[s["slug"]] = need
    return needs


# ---------------------------------------------------------------- the tables

def read_table(path):
    rows = []
    for n, line in enumerate(path.read_text(encoding="utf-8").replace("\r\n", "\n").split("\n"), 1):
        if line.strip() and not line.startswith("#"):
            rows.append((n, line.split("\t")))
    return rows


def load():
    """sections in script order: dicts of slug, needs (all, as a set), seconds, plus the script's own facts"""
    lines = read_script()
    found, base = parse_script(lines)
    auto = static_needs(found, lines)
    table = {}
    for n, c in read_table(SECTIONS):
        if len(c) < 3:
            raise Problem(f"{SECTIONS.name}:{n}: slug, extra needs and seconds, separated by tabs")
        table[c[0]] = c
    slugs = [s["slug"] for s in found]
    if list(table) != slugs:
        missing = [s for s in slugs if s not in table]
        extra = [s for s in table if s not in slugs]
        raise Problem(f"{SECTIONS.name} and test-tatty.sh disagree on the sections (missing: {missing or 'none'}; "
                      f"unknown: {extra or 'none'}), or on their order. Edit the table.")
    for k, s in enumerate(found):
        c = table[s["slug"]]
        manual = set() if c[1] in ("", "-") else set(c[1].split(","))
        for m in manual:
            if m not in slugs[:k]:
                raise Problem(f"{SECTIONS.name}: {s['slug']} needs {m}, which is not an earlier section")
        s["needs"] = auto[s["slug"]] | manual
        s["extra"] = manual
        s["seconds"] = int(c[2])
    return found, base, lines


def closure(found, want):
    byslug = {s["slug"]: s for s in found}
    for w in want:
        if w not in byslug:
            raise Problem(f"no section '{w}' (bash tools/test-tatty.sh --list)")
    keep, todo = set(), list(want)
    while todo:
        s = todo.pop()
        if s not in keep:
            keep.add(s)
            todo += byslug[s]["needs"]
    return [s["slug"] for s in found if s["slug"] in keep]


# ---------------------------------------------------------------- what a change can affect

def git(*args):
    p = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return p.returncode, p.stdout


def default_ref():
    for upstream in ("origin/main", "origin/master"):
        rc, out = git("merge-base", "HEAD", upstream)
        if rc == 0 and out.strip():
            return out.strip()
    return "HEAD"


def changed_files(ref):
    """{path: [(first line, last line, text of the changed lines)]} of what differs from ref in the working tree,
    new files and files with no line detail as [(1, 99999, '')]"""
    rc, out = git("diff", "--name-only", ref)
    files = {f: [] for f in out.split("\n") if f.strip()} if rc == 0 else {}
    rc, out = git("ls-files", "--others", "--exclude-standard")
    for f in out.split("\n"):
        if f.strip():
            files[f] = [(1, 99999, "")]
    for f in list(files):
        if files[f]:
            continue
        rc, d = git("diff", "-U0", "--no-ext-diff", "--no-color", ref, "--", f)  # (not the user's own diff tool)
        hunks, cur = [], None
        for line in d.split("\n"):
            m = re.match(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", line)
            if m:
                if cur:
                    hunks.append(tuple(cur))
                start, count = int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1)
                cur = [start, start + max(count, 1) - 1, ""]
            elif cur is not None and line[:1] in "+-" and not line.startswith(("+++", "---")):
                cur[2] += line[1:] + "\n"
        if cur:
            hunks.append(tuple(cur))
        files[f] = hunks or [(1, 99999, "")]
    return files


def banners():
    out = []
    path = ROOT / SERVER
    if path.exists():
        for n, line in enumerate(path.read_text(encoding="utf-8").replace("\r\n", "\n").split("\n"), 1):
            m = re.match(r"# -{10,} (.+)$", line)
            if m:
                out.append((n, m.group(1).strip()))
    return out


def area_rules():
    rules = []
    for n, c in read_table(AREAS):
        if len(c) < 3:
            raise Problem(f"{AREAS.name}:{n}: kind, pattern and targets, separated by tabs")
        if c[0] not in ("ignore", "file", "banner"):
            raise Problem(f"{AREAS.name}:{n}: the kind is ignore, file or banner")
        rules.append((c[0], c[1], c[2], n))
    return rules


def affected(found, ref, say):
    """(set of slugs, True when everything) for the changes since ref; say(line) explains each file"""
    byslug = {s["slug"]: s for s in found}
    rules = area_rules()
    for kind, pat, targets, n in rules:
        for t in targets.split(","):
            if t not in ("*", "-", "route", "static") and t not in byslug:
                raise Problem(f"{AREAS.name}:{n}: no section '{t}'")
    out, everything = set(), False
    bans = banners()

    def routes(text):
        return {m for m in re.findall(r"/api/([a-z][a-z0-9-]*)", text)}

    def sections_with(rx):
        return {s["slug"] for s in found if re.search(rx, s["text"])}

    for path, hunks in sorted(changed_files(ref).items()):
        todo = None
        for kind, pat, targets, n in rules:
            if kind in ("ignore", "file") and fnmatch.fnmatch(path, pat):
                todo = (kind, targets)
                break
        if todo and todo[0] == "ignore":
            say(f"  {path}: no tests (ignored)")
            continue
        if path == "tools/test-tatty.sh":  # the sections whose lines changed
            lines = read_script()
            sec, base = parse_script(lines)
            hit, wide = set(), False
            for a, b, _ in hunks:
                inside = [s["slug"] for s in sec if s["start"] <= b and a <= s["end"]]
                hit.update(inside)
                if not inside:
                    wide = True
            if wide:
                everything = True
                say(f"  {path}: changed outside any section: everything")
            else:
                out |= hit
                say(f"  {path}: {', '.join(sorted(hit)) or 'nothing'}")
            continue
        if path == SERVER:
            for a, b, text in hunks:
                region = next((name for line, name in reversed(bans) if line <= a), None)
                for kind, pat, targets, n in rules:
                    if kind == "banner" and region and re.search(pat, region, re.I):
                        break
                else:
                    everything = True
                    say(f"  {path}: lines {a}-{b} in '{region or 'the top'}': everything (no rule)")
                    continue
                if targets == "*":
                    everything = True
                    say(f"  {path}: lines {a}-{b} in '{region}': everything")
                elif targets == "route":  # the request handler: the routes the changed lines name
                    names = routes(text)
                    got = set()
                    for r in names:
                        got |= sections_with(r"/api/" + re.escape(r) + r"(?![a-z0-9-])")
                    if not names:
                        everything = True
                        say(f"  {path}: lines {a}-{b} in '{region}': everything (no route named)")
                    else:
                        out |= got
                        say(f"  {path}: lines {a}-{b} in '{region}': routes {', '.join(sorted(names))}")
                elif targets != "-":
                    out |= set(targets.split(","))
                    say(f"  {path}: lines {a}-{b} in '{region}': {targets}")
            continue
        if todo is None and path.startswith("plugins/tatty/app/web/"):  # the sections that fetch it
            name = path.rsplit("/", 1)[1]
            got = sections_with(r"static/" + re.escape(name) + r"(?![A-Za-z0-9._-])")
            if got:
                out |= got
                say(f"  {path}: {', '.join(sorted(got))} (they fetch it)")
            else:
                say(f"  {path}: not exercised by this suite (see tools/page-check.py and features-check.py)")
            continue
        if todo is None and path.startswith("tools/fixtures/"):
            part = "/".join(path.split("/")[:3])
            got = sections_with(re.escape(part))
            if got:
                out |= got
                say(f"  {path}: {', '.join(sorted(got))} (they use the fixture)")
                continue
        if todo is None:
            everything = True
            say(f"  {path}: everything (no rule for it in {AREAS.name})")
            continue
        _, targets = todo
        if targets == "*":
            everything = True
            say(f"  {path}: everything")
        elif targets == "-":
            say(f"  {path}: no tests")
        else:
            out |= set(targets.split(","))
            say(f"  {path}: {targets}")
    return out, everything


# ---------------------------------------------------------------- running

def groups_of(found, chosen, n):
    """split the chosen sections (already closed over their needs) into at most n groups to run at once. A group is
    closed over its needs, so a section several others need is run again in each group that has one of them: each section
    goes where it adds the least time (counting what the group already holds), the dearest first"""
    byslug = {s["slug"]: s for s in found}
    order = {s["slug"]: i for i, s in enumerate(found)}
    chosen = set(chosen)

    def need_all(slug, seen=None):
        seen = set() if seen is None else seen
        for m in byslug[slug]["needs"]:
            if m in chosen and m not in seen:
                seen.add(m)
                need_all(m, seen)
        return seen | {slug}

    closed = {s: need_all(s) for s in chosen}
    cost = lambda ss: sum(byslug[x]["seconds"] for x in ss)
    bins = [set() for _ in range(max(1, min(n, len(chosen))))]
    covered = set()
    for s in sorted(chosen, key=lambda x: (-cost(closed[x]), order[x])):
        if s in covered:
            continue
        k = min(range(len(bins)), key=lambda i: (cost(bins[i] | closed[s]), len(bins[i])))
        bins[k] |= closed[s]
        covered |= closed[s]
    return [(sorted(b, key=order.get), cost(b)) for b in bins if b]


def child_env(slugs, group=None):
    env = dict(os.environ)
    env.pop("TATTY_ONLY", None)
    env["TATTY_SECTIONS"] = " ".join(slugs) if slugs else "-"
    if group is not None and env.get("TATTY_TIMES"):  # one timing file a group
        env["TATTY_TIMES"] = f"{env['TATTY_TIMES']}.{group + 1}"
    return env


def bash():
    return shutil.which("bash") or "bash"


def run_groups(plan, verbose):
    """run each group of sections in its own test-tatty.sh at once: the exit code"""
    logs = Path(tempfile.mkdtemp(prefix="tatty-tests-"))
    results, lock = {}, threading.Lock()
    started = time.time()

    def work(k, slugs):
        log = logs / f"group-{k + 1}.log"
        t0 = time.time()
        with open(log, "wb") as f:
            p = subprocess.run([bash(), SCRIPT.as_posix()], cwd=ROOT, env=child_env(slugs, k), stdout=f,
                               stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
        text = log.read_text(encoding="utf-8", errors="replace")
        m = re.findall(r"(\d+) passed, (\d+) failed", text)
        passed, failed = (int(m[-1][0]), int(m[-1][1])) if m else (0, 0)
        with lock:
            results[k] = (slugs, passed, failed, p.returncode, time.time() - t0, text, log)
            note = "" if m else "  (no summary: it stopped early)"
            print(f"group {k + 1} ({' '.join(slugs) or 'base only'}): {passed} passed, {failed} failed, "
                  f"{results[k][4]:.0f}s{note}", flush=True)

    threads = [threading.Thread(target=work, args=(k, s)) for k, (s, _) in enumerate(plan)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    bad = 0
    for k in sorted(results):
        slugs, passed, failed, rc, secs, text, log = results[k]
        if failed or rc != 0 or not re.search(r"\d+ passed, \d+ failed", text):
            bad += 1
            print(f"\n--- group {k + 1}: {' '.join(slugs) or 'base only'}   (full output: {log})")
            lines = text.split("\n")
            shown = 0
            for i, l in enumerate(lines):
                if l.startswith("FAIL"):
                    print("\n".join(lines[i:i + 3]).rstrip())
                    shown += 1
            if not shown:
                print("\n".join(lines[-12:]))
        elif verbose:
            print(f"\n--- group {k + 1}\n{text}")
    passed = sum(r[1] for r in results.values())
    failed = sum(r[2] for r in results.values())
    print(f"\n{passed} passed, {failed} failed in {time.time() - started:.0f}s "
          f"(each of the {len(results)} groups also runs the same {BASE_SECONDS}s base)")
    if not bad:
        shutil.rmtree(logs, ignore_errors=True)
    return 1 if bad else 0


def run_one(slugs, verbose):
    """a single group, with its output as it happens"""
    return subprocess.run([bash(), SCRIPT.as_posix()], cwd=ROOT, env=child_env(slugs), stdin=subprocess.DEVNULL).returncode


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(prog="test-tatty.sh", description="Run Tatty's tests, all or part.",
                                 epilog="With none of these, every section runs one after the other.")
    ap.add_argument("--only", metavar="A,B", help="these sections, and the ones they need")
    ap.add_argument("--changed", nargs="?", const="auto", metavar="REF",
                    help="the sections the changes since REF could affect (default: where this branch left origin/main)")
    ap.add_argument("--parallel", nargs="?", const=4, type=int, metavar="N", help="run in N groups at once (default 4)")
    ap.add_argument("--list", action="store_true", help="list the sections")
    ap.add_argument("--check", action="store_true", help="check the tables against the script")
    ap.add_argument("-n", "--dry-run", action="store_true", help="show what would run, and run nothing")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args()
    only = a.only or os.environ.get("TATTY_ONLY")
    try:
        found, base, lines = load()
        if a.check:
            area_rules()
            affected(found, "HEAD", lambda s: None)
            print(f"ok: {len(found)} sections; the tables agree with test-tatty.sh")
            return 0
        if a.list:
            print(f"{'section':13} {'sec':>4}  needs")
            for s in found:
                print(f"{s['slug']:13} {s['seconds']:4}  {', '.join(sorted(s['needs'], key=lambda x: [t['slug'] for t in found].index(x))) or '-'}")
            print(f"\nevery run first does the base (about {BASE_SECONDS}s): the server and the checks of tatty.sh")
            return 0
        chosen = None
        if only:
            chosen = set(only.replace(" ", "").split(","))
            chosen.discard("")
        if a.changed:
            ref = default_ref() if a.changed == "auto" else a.changed
            print(f"Changes since {ref[:12]}:")
            got, everything = affected(found, ref, print)
            if everything:
                chosen = {s["slug"] for s in found}
                print("-> everything")
            else:
                chosen = (chosen or set()) | got
                if not chosen:
                    print("-> nothing here needs the suite")
                    return 0
        if chosen is None:
            chosen = {s["slug"] for s in found}
        slugs = closure(found, chosen)
        extra = [s for s in slugs if s not in chosen]
        everything = len(slugs) == len(found)
        print(("All" if everything else f"{len(slugs)} of {len(found)}") + " sections: " + (", ".join(slugs) or "none")
              + (f"  (needed by the others: {', '.join(extra)})" if extra and not everything else ""))
        if a.parallel and a.parallel > 1:
            plan = groups_of(found, slugs, a.parallel)
            print(f"{len(plan)} groups at once; about {BASE_SECONDS + max(l for _, l in plan)}s")
            if a.dry_run:
                for k, (g, est) in enumerate(plan, 1):
                    print(f"  group {k} (~{est}s): {' '.join(g)}")
                return 0
            return run_groups(plan, a.verbose)
        if a.dry_run:
            return 0
        return run_one([] if not slugs else slugs, a.verbose) if not everything else run_one(["all"], a.verbose)
    except Problem as e:
        print(f"test-tatty: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
