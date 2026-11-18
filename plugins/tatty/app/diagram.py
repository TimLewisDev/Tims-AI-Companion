"""Generated diagrams: the C# types in a git repository and the links between them, read with git
alone (nothing is built or run). Standard library only.

parse_cs(text) reads one file: its usings, and every class, struct, interface, enum and record in it,
with the namespace, the base list, the members and the type names the body refers to.

Index keeps those per git blob in one JSON file per repository, so a file is only read again when
its content changes; Index.tree(rev) gives {path: parsed} for every C# file at a commit, reading the
blobs it hasn't seen yet through one `git cat-file --batch`.

Model(files) merges partial types and resolves the names the files use into links:
  inherits / implements  the base list
  has                    a field's or property's type
  creates                `new T(`
  uses                   any other mention in a member or a body
Groups are the assembly (the nearest .asmdef, else the .csproj, else Unity's default assemblies) and
the namespace inside it; with many assemblies they sit in areas (Packages/x, Assets/Scripts/y).

project_graph / review_graph / plan_merge turn a Model into the one JSON shape the page draws:
  {version, kind, groups:[{id,label,parent,level}], nodes:[...], edges:[...], gedges:[...], units:[...]}
gedges are the links counted between the lowest groups, for drawing groups whose classes aren't shown.
"""
import bisect
import hashlib
import json
import os
import re
import subprocess
import threading
import time
from pathlib import Path

PARSER_VERSION = 4  # raise when parse_cs changes what it returns: every cached blob is read again
NO_WINDOW = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
MAX_MEMBERS = 40  # members kept per type (the card shows a few; the hover more)
MAX_REFS = 400  # names kept per type
KEEP_DAYS = 21  # a cached blob no tree has used for this long is dropped
EDGE_RANK = {"inherits": 0, "implements": 0, "has": 1, "creates": 2, "uses": 3, "dataflow": 4}
UNITY_STEREO = {"MonoBehaviour": "MonoBehaviour", "ScriptableObject": "ScriptableObject",
                "Editor": "Editor", "EditorWindow": "EditorWindow", "PropertyDrawer": "Editor",
                "NetworkBehaviour": "MonoBehaviour", "StateMachineBehaviour": "MonoBehaviour"}
DEFAULT_EXCLUDE = ("Packages/com.unity.", "Library/", "Temp/", "obj/", "bin/")
AREA_FROM = 40  # assemblies above this get an area level above them

# ---------------------------------------------------------------- reading one C# file

_STRINGS = re.compile(
    r'"""[\s\S]*?"""'
    r'|//[^\n]*'
    r'|/\*[\s\S]*?\*/'
    r'|(?:\$@|@\$|@)"(?:[^"]|"")*"'        # verbatim (and interpolated verbatim) strings
    r'|\$?"(?:\\.|[^"\\\n])*"'             # regular and interpolated strings
    r"|'(?:\\.|[^'\\\n])+'"                # char literals ('{' must not count as a brace)
    r'|^[ \t]*#[^\n]*',                    # preprocessor lines
    re.M)
_ATTRS = re.compile(r"^\s*(?:\[(?:[^\[\]]|\[[^\]]*\])*\]\s*)+")
_MODS = r"(?:public|private|protected|internal|static|abstract|sealed|partial|readonly|ref|unsafe|new|file|virtual|override|extern|async|volatile|const|required|fixed)"
_TYPE_HEAD = re.compile(
    r"^((?:" + _MODS + r"\s+)*)"
    r"(class|struct|interface|enum|record(?:\s+(?:class|struct))?)\s+"
    r"@?([A-Za-z_]\w*)\s*"
    r"(<[^{;:]*?>)?\s*"
    r"(\((?:[^()]|\([^()]*\))*\))?\s*"
    r"(?::\s*(.*?))?\s*"
    r"(?:\bwhere\b.*)?$", re.S)
_NAMESPACE = re.compile(r"^namespace\s+([\w.]+)\s*$")
_USING = re.compile(r"^(?:global\s+)?using\s+(?:static\s+)?([\w.]+)\s*$")
_ALIAS = re.compile(r"^(?:global\s+)?using\s+(\w+)\s*=\s*([\w.]+)")
_NEW = re.compile(r"\bnew\s+(?:global::)?(?:[\w]+\.)*([A-Z]\w*)")
_NAME = re.compile(r"\b([A-Z]\w*)\b")
_ASSIGN = re.compile(r"(?<![=!<>+\-*/%&|^?])=(?![=>])")
_VIS = ("public", "protected", "internal", "private")
_SPACE = re.compile(r"\s+")
_MOD_WORDS = re.compile(r"^(?:" + _MODS + r"|event)\s+")


def strip_cs(text):
    """The file with comments, strings, char literals and preprocessor lines blanked out; line
    breaks are kept, so offsets still give the right line."""
    return _STRINGS.sub(lambda m: "\n" * m.group().count("\n") or " ", text)


def split_top(s, sep=","):
    """s split at sep where it isn't inside <...>, (...) or [...]."""
    out, depth, cur = [], 0, []
    for ch in s:
        if ch in "<([":
            depth += 1
        elif ch in ">)]":
            depth = max(0, depth - 1)
        if ch == sep and depth == 0:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    out.append("".join(cur))
    return [x.strip() for x in out if x.strip()]


def base_name(t):
    """`Foo.Bar<Baz>` -> ("Bar", "Foo", ["Baz"]): the simple name, its qualifier, the names in its arguments."""
    t = t.strip().removeprefix("global::")
    args = []
    i = t.find("<")
    if i >= 0:
        args = _NAME.findall(t[i:])
        t = t[:i]
    qual, _, name = t.rpartition(".")
    return name.strip(), qual.strip(), args


def member_of(seg, ends, type_name, type_kind):
    """A member's {sig, vis, kind} from its declaration (the text before its `{` or `;`), plus the
    type names a field's or property's type names (for `has` links); None when it isn't one."""
    s = _SPACE.sub(" ", _ATTRS.sub("", seg)).strip()
    if not s or s.startswith(("get", "set", "init", "add", "remove", "return ", "using ", "namespace ")):
        return None, []
    arrow = s.find("=>")
    bodied = arrow >= 0
    if bodied:
        s = s[:arrow].strip()
    eq = _ASSIGN.search(s)
    paren = s.find("(")
    if eq and (paren < 0 or eq.start() < paren):  # a field's initialiser, which may call things
        s = s[:eq.start()].strip()
        bodied = False
    paren = s.find("(")
    if not s or not re.match(r"^[\w@<\[~(]", s):
        return None, []
    words = s.split(" ")
    vis = next((w for w in words if w in _VIS), "public" if type_kind == "interface" else "private")
    if "protected" in words and "internal" in words:
        vis = "protected"
    if paren >= 0:
        head = s[:paren].strip()
        name = head.rsplit(" ", 1)[-1] if head else ""
        if name in ("if", "for", "foreach", "while", "switch", "catch", "using", "lock", "fixed", "nameof", "typeof"):
            return None, []
        kind = "ctor" if name in (type_name, "~" + type_name) else "method"
        if " event " in f" {s} ":
            kind = "event"
        if s.startswith("delegate ") or " delegate " in s:
            kind = "delegate"
        return {"sig": s[:160], "vis": vis, "kind": kind}, []
    if "this[" in s:
        return {"sig": s[:160], "vis": vis, "kind": "indexer"}, []
    if s.startswith("operator") or " operator " in s:
        return {"sig": s[:160], "vis": vis, "kind": "method"}, []
    rest = s
    while True:  # drop the modifiers, then the type is everything before the last name
        m = _MOD_WORDS.match(rest)
        if not m:
            break
        rest = rest[m.end():]
    parts = split_top(rest, " ")
    if len(parts) < 2:
        return None, []
    kind = "property" if ends == "{" or bodied else ("event" if " event " in f" {s} " else ("const" if "const " in s else "field"))
    type_part = " ".join(parts[:-1])
    names = [n for n in _NAME.findall(type_part)]
    return {"sig": s[:160], "vis": vis, "kind": kind}, names


def parse_cs(text):
    """{usings:[ns...], aliases:{name: target}, types:[...]} of one C# file. A type is
    {name, path (Outer.Inner), ns, kind, mods, generic, line, bases:[{name, qual, args}],
     members:[{sig, vis, kind}], has:[names], creates:[names], uses:[names]}."""
    src = strip_cs(text)
    lines = [i for i, c in enumerate(src) if c == "\n"] if len(src) < 4_000_000 else []

    def line_at(off):
        return bisect.bisect_right(lines, off) + 1

    usings, aliases, types = [], {}, []
    file_ns = ""
    stack = []  # ("ns", name) | ("type", record) | ("body", record or None)
    prev = 0
    for m in re.finditer(r"[{};]", src):
        ch = m.group()
        raw = src[prev:m.start()]
        seg_start = prev
        prev = m.end()
        seg = raw.strip()
        owner = next((s[1] for s in reversed(stack) if s[0] in ("type", "body") and s[1] is not None), None)
        top = stack[-1] if stack else None
        in_type = top is not None and top[0] == "type"
        if ch == "}":
            if in_type and top[1]["kind"] == "enum" and seg:
                for v in split_top(_ATTRS.sub("", seg)):
                    name = v.split("=")[0].strip()
                    if re.match(r"^\w+$", name) and len(top[1]["members"]) < MAX_MEMBERS:
                        top[1]["members"].append({"sig": name, "vis": "public", "kind": "value"})
            elif seg and owner is not None:
                _refs(owner, seg)
            if stack:
                stack.pop()
            continue
        clean = _SPACE.sub(" ", _ATTRS.sub("", seg)).strip()
        ns_now = file_ns or ".".join(s[1] for s in stack if s[0] == "ns")
        if ch == ";" and not stack or (ch == ";" and all(s[0] == "ns" for s in stack)):
            nm = _NAMESPACE.match(clean)
            if nm:
                file_ns = nm.group(1)
                continue
            um = _USING.match(clean)
            if um:
                usings.append(um.group(1))
                continue
            am = _ALIAS.match(clean)
            if am:
                aliases[am.group(1)] = am.group(2)
                continue
        if ch == "{" and (not stack or all(s[0] == "ns" for s in stack)):
            nm = _NAMESPACE.match(clean)
            if nm:
                stack.append(("ns", nm.group(1)))
                continue
        tm = _TYPE_HEAD.match(clean) if (not stack or top[0] in ("ns", "type")) and clean else None
        if tm and "(" not in (tm.group(1) or ""):
            mods = (tm.group(1) or "").split()
            kind = tm.group(2).split()[0]
            outer = [s[1]["name"] for s in stack if s[0] == "type"]
            bases = []
            for b in split_top(tm.group(6) or ""):
                name, qual, args = base_name(b)
                if re.match(r"^[A-Za-z_]\w*$", name):
                    bases.append({"name": name, "qual": qual, "args": args})
            off = seg_start + (len(raw) - len(raw.lstrip())) + max(0, raw.lstrip().find(tm.group(3)))
            rec = {"name": tm.group(3), "path": ".".join(outer + [tm.group(3)]), "ns": ns_now, "kind": kind,
                   "mods": [x for x in mods if x in ("static", "abstract", "sealed", "partial", "readonly")],
                   "generic": bool(tm.group(4)), "line": line_at(off), "bases": bases, "members": [],
                   "has": [], "creates": [], "uses": []}
            if tm.group(5):  # a record's primary constructor: its parameters are properties
                for p in split_top(tm.group(5)[1:-1]):
                    pts = split_top(_ATTRS.sub("", p), " ")
                    if len(pts) >= 2:
                        rec["members"].append({"sig": f"{' '.join(pts[:-1])} {pts[-1]}", "vis": "public", "kind": "property"})
                        rec["has"].extend(_NAME.findall(" ".join(pts[:-1])))
            types.append(rec)
            if ch == "{":
                stack.append(("type", rec))
            continue
        if in_type:
            rec = top[1]
            if rec["kind"] == "enum":
                if ch == "{":
                    stack.append(("body", rec))
                continue
            mem, has = member_of(seg, ch, rec["name"], rec["kind"])
            if mem and len(rec["members"]) < MAX_MEMBERS:
                rec["members"].append(mem)
            if has:
                rec["has"].extend(has)
            _refs(rec, seg)
            if ch == "{":
                stack.append(("body", rec))
            continue
        if owner is not None:
            _refs(owner, seg)
        if ch == "{":
            stack.append(("body", owner))
    for t in types:
        t["has"] = _dedupe(t["has"], t["name"])
        t["creates"] = _dedupe(t["creates"], t["name"])
        known = set(t["has"]) | set(t["creates"]) | {b["name"] for b in t["bases"]}
        t["uses"] = [u for u in _dedupe(t["uses"], t["name"]) if u not in known]
    return {"v": PARSER_VERSION, "usings": usings, "aliases": aliases, "types": types}


def _refs(rec, seg):
    if len(rec["uses"]) > MAX_REFS * 4:
        return
    rec["creates"].extend(_NEW.findall(seg))
    rec["uses"].extend(_NAME.findall(seg))


def _dedupe(names, own):
    seen, out = set(), []
    for n in names:
        if n != own and n not in seen:
            seen.add(n)
            out.append(n)
    return out[:MAX_REFS]


# ---------------------------------------------------------------- the per-blob cache

def run_git(repo, *args, stdin=None, timeout=300):
    """(exit code, stdout bytes) of a git command; (-1, b"") when it can't run."""
    try:
        p = subprocess.run(["git", "-C", str(repo), *args], input=stdin, capture_output=True,
                           timeout=timeout, creationflags=NO_WINDOW)
    except (OSError, subprocess.TimeoutExpired):
        return -1, b""
    return p.returncode, p.stdout


def read_blobs(repo, shas):
    """{sha: text} of the blobs, read through one `git cat-file --batch`."""
    if not shas:
        return {}
    code, out = run_git(repo, "cat-file", "--batch", stdin=("\n".join(shas) + "\n").encode())
    got, i = {}, 0
    while code == 0 and i < len(out):
        j = out.find(b"\n", i)
        if j < 0:
            break
        head = out[i:j].split()
        if len(head) < 3 or head[1] == b"missing":
            i = j + 1
            continue
        size = int(head[2])
        body = out[j + 1:j + 1 + size]
        got[head[0].decode()] = body.decode("utf-8", errors="replace").lstrip("﻿")
        i = j + 1 + size + 1
    return got


def ls_tree(repo, rev):
    """[(sha, path)] of every file at rev; None when rev can't be read."""
    code, out = run_git(repo, "ls-tree", "-r", "-z", "--full-tree", rev)
    if code != 0:
        return None
    rows = []
    for rec in out.split(b"\0"):
        if not rec:
            continue
        meta, _, path = rec.partition(b"\t")
        parts = meta.split()
        if len(parts) == 3 and parts[1] == b"blob":
            rows.append((parts[2].decode(), path.decode("utf-8", errors="replace")))
    return rows


def rev_sha(repo, rev):
    code, out = run_git(repo, "rev-parse", "--verify", "--quiet", rev + "^{commit}")
    return out.decode().strip() if code == 0 else ""


def excluded(path, exclude):
    p = path.replace("\\", "/")
    return any(p.startswith(x) or ("/" + x) in ("/" + p) for x in exclude if x)


class Index:
    """The parsed C# files of one repository, cached by blob in `file` (JSON)."""

    def __init__(self, repo, file):
        self.repo, self.file = str(repo), Path(file)
        self.lock = threading.Lock()
        self.blobs, self.asm = {}, {}
        self.dirty = False
        try:
            d = json.loads(self.file.read_text(encoding="utf-8"))
            if d.get("v") == PARSER_VERSION:
                self.blobs = d.get("blobs", {})
                self.asm = d.get("asm", {})
        except (OSError, ValueError):
            pass

    def tree(self, rev, exclude=DEFAULT_EXCLUDE, include=(), step=None):
        """({path: parsed}, {dir: assembly}, the commit) of the C# files at rev, or (None, None, "") if
        rev can't be read. step(text) hears progress."""
        sha = rev_sha(self.repo, rev)
        rows = ls_tree(self.repo, sha) if sha else None
        if rows is None:
            return None, None, ""
        files, defs = [], []
        for blob, path in rows:
            if excluded(path, exclude) or (include and not any(path.startswith(i) for i in include)):
                continue
            if path.endswith(".cs"):
                files.append((blob, path))
            elif path.endswith((".asmdef", ".csproj")):
                defs.append((blob, path))
        now = int(time.time())
        def_blobs = {b for b, _ in defs}
        with self.lock:
            need = sorted({b for b, _ in files if b not in self.blobs} | {b for b, _ in defs if b not in self.asm})
        if need and step:
            step(f"Reading {len(need)} C# file(s) git hasn't shown me before")
        done = 0
        for i in range(0, len(need), 800):
            chunk = need[i:i + 800]
            texts = read_blobs(self.repo, chunk)
            parsed = {}
            for b in chunk:
                t = texts.get(b)
                if t is None or b in def_blobs:
                    continue
                try:
                    parsed[b] = [parse_cs(t), now]
                except (RecursionError, ValueError):
                    parsed[b] = [{"v": PARSER_VERSION, "usings": [], "aliases": {}, "types": []}, now]
            asm_names = {}
            for b, path in defs:
                if b in chunk and b in texts:
                    asm_names[b] = asm_name(path, texts[b])
            with self.lock:
                self.blobs.update(parsed)
                self.asm.update(asm_names)
                self.dirty = True
            done += len(chunk)
            if step and len(need) > 800:
                step(f"Read {done} of {len(need)} C# files")
        out = {}
        with self.lock:
            for b, path in files:
                rec = self.blobs.get(b)
                if rec:
                    if rec[1] != now:
                        rec[1] = now
                        self.dirty = True
                    out[path] = rec[0]
            dirs = {}
            for b, path in defs:
                name = self.asm.get(b)
                if name:
                    dirs.setdefault(path.rsplit("/", 1)[0] if "/" in path else "", (name, path.endswith(".asmdef")))
        return out, dirs, sha

    def save(self):
        with self.lock:
            if not self.dirty:
                return
            cut = int(time.time()) - KEEP_DAYS * 86400
            self.blobs = {b: r for b, r in self.blobs.items() if r[1] >= cut}
            data = json.dumps({"v": PARSER_VERSION, "blobs": self.blobs, "asm": self.asm}, separators=(",", ":"))
            self.dirty = False
        self.file.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.file.with_suffix(".tmp")
        tmp.write_text(data, encoding="utf-8")
        os.replace(tmp, self.file)


def asm_name(path, text):
    """The assembly an .asmdef (its "name") or a .csproj (its file name) makes."""
    if path.endswith(".asmdef"):
        try:
            got = json.loads(text.lstrip("﻿"))
            if isinstance(got, dict) and str(got.get("name", "")).strip():
                return str(got["name"]).strip()
        except ValueError:
            pass
    return Path(path).stem


def assembly_of(path, dirs):
    """(assembly, the folder that defines it) of a C# file: the nearest folder above it with an
    .asmdef (or a .csproj); else Unity's defaults for Assets/ (Editor folders apart); else its top folder."""
    d = path.rsplit("/", 1)[0] if "/" in path else ""
    while True:
        hit = dirs.get(d)
        if hit:
            return hit[0], d
        if not d:
            break
        d = d.rsplit("/", 1)[0] if "/" in d else ""
    if path.startswith("Assets/"):
        if "/Editor/" in path:
            return "Assembly-CSharp-Editor", "Assets"
        return "Assembly-CSharp", "Assets"
    top = path.split("/", 1)[0] if "/" in path else "(root)"
    return top, top


def area_of(folder):
    """The area an assembly's folder is in: Packages/<pkg>, Assets/Scripts/<x>, or its first folder."""
    parts = [p for p in folder.split("/") if p]
    if not parts:
        return "(root)"
    if parts[0] in ("Packages", "ExternalPackages") and len(parts) >= 2:
        return "/".join(parts[:2])
    if parts[0] == "Assets" and len(parts) >= 3 and parts[1] == "Scripts":
        return "/".join(parts[:3])
    if parts[0] == "Assets" and len(parts) >= 2:
        return "/".join(parts[:2])
    return parts[0]


# ---------------------------------------------------------------- the model: types and their links

class Model:
    """Every type of a set of files, partial types merged, with name lookup for resolving links."""

    def __init__(self, files, dirs):
        self.files, self.dirs = files, dirs or {}
        self.types = {}  # id -> merged type
        self.by_name = {}  # simple name -> [ids]
        self.file_ctx = {}  # path -> (usings, aliases)
        for path, parsed in files.items():
            self.file_ctx[path] = (parsed.get("usings", []), parsed.get("aliases", {}))
            asm, folder = assembly_of(path, self.dirs)
            for t in parsed.get("types", []):
                tid = (t["ns"] + "." if t["ns"] else "") + t["path"]
                cur = self.types.get(tid)
                if cur is None:
                    cur = self.types[tid] = {
                        "id": tid, "name": t["name"], "path": t["path"], "ns": t["ns"], "kind": t["kind"],
                        "mods": list(t["mods"]), "generic": t["generic"], "files": [], "line": t["line"],
                        "file": path, "asm": asm, "folder": folder, "bases": [], "members": [],
                        "refs": {}}  # name -> {kind: set(paths)}
                    self.by_name.setdefault(t["name"], []).append(tid)
                if Path(path).stem == t["name"] and Path(cur["file"]).stem != t["name"]:
                    cur["file"], cur["line"], cur["asm"], cur["folder"] = path, t["line"], asm, folder
                cur["files"].append(path)
                for m in t["mods"]:
                    if m not in cur["mods"]:
                        cur["mods"].append(m)
                seen_b = {b["name"] for b in cur["bases"]}
                for b in t["bases"]:
                    if b["name"] not in seen_b:
                        cur["bases"].append(dict(b, file=path))
                        seen_b.add(b["name"])
                    for a in b["args"]:
                        cur["refs"].setdefault(a, {}).setdefault("uses", set()).add(path)
                sigs = {m["sig"] for m in cur["members"]}
                for m in t["members"]:
                    if m["sig"] not in sigs and len(cur["members"]) < MAX_MEMBERS * 2:
                        cur["members"].append(m)
                        sigs.add(m["sig"])
                for kind in ("has", "creates", "uses"):
                    for n in t[kind]:
                        cur["refs"].setdefault(n, {}).setdefault(kind, set()).add(path)

    def resolve(self, name, t, path, qual=""):
        """The id of the type `name` means when type t's file `path` mentions it, or None."""
        cands = self.by_name.get(name)
        if not cands:
            return None
        if qual:
            exact = [c for c in cands if c.endswith("." + qual + "." + name) or c == qual + "." + name]
            if len(exact) == 1:
                return exact[0]
        usings, aliases = self.file_ctx.get(path, ([], {}))
        scopes = []
        ns = t["ns"]
        outer = (ns + "." if ns else "") + t["path"]
        scopes.append(outer)  # its own nested types, then those of the types round it
        while "." in outer:
            outer = outer.rsplit(".", 1)[0]
            scopes.append(outer)
        while ns:
            scopes.append(ns)
            ns = ns.rsplit(".", 1)[0] if "." in ns else ""
        scopes.extend(usings)
        scopes.append("")
        cset = set(cands)
        for s in scopes:
            hit = (s + "." + name) if s else name
            if hit in cset:
                return hit
        return None

    def links(self, tid):
        """[(to id, kind, {files})] of the type's resolved links, the strongest kind per target."""
        t = self.types[tid]
        best = {}

        def add(to, kind, files):
            if not to or to == tid:
                return
            cur = best.get(to)
            if cur is None or EDGE_RANK[kind] < EDGE_RANK[cur[0]]:
                best[to] = (kind, set(files) | (cur[1] if cur else set()))
            else:
                cur[1].update(files)

        for b in t["bases"]:
            to = self.resolve(b["name"], t, b.get("file", t["file"]), b.get("qual", ""))
            if to:
                tk = self.types[to]["kind"]
                add(to, "implements" if tk == "interface" and t["kind"] != "interface" else "inherits", [b.get("file", t["file"])])
        for name, kinds in t["refs"].items():
            for kind in ("has", "creates", "uses"):
                files = kinds.get(kind)
                if not files:
                    continue
                to = None
                for f in sorted(files):  # (a partial type: each file has its own usings)
                    to = self.resolve(name, t, f)
                    if to:
                        break
                add(to, kind, files)
        return [(to, k, f) for to, (k, f) in best.items()]

    def stereo(self, t):
        names = {b["name"] for b in t["bases"]}
        for n in names:
            if n in UNITY_STEREO:
                return UNITY_STEREO[n]
        # a base that is itself a MonoBehaviour (one level up is enough for a hint)
        for b in t["bases"]:
            to = self.resolve(b["name"], t, b.get("file", t["file"]))
            if to:
                up = {x["name"] for x in self.types[to]["bases"]}
                for n in up:
                    if n in UNITY_STEREO:
                        return UNITY_STEREO[n]
        if t["kind"] == "class" and "static" in t["mods"]:
            return "static"
        if t["kind"] == "class" and "abstract" in t["mods"]:
            return "abstract"
        return t["kind"]

    def signature(self, tid):
        """What the hover summary depends on: a change here means the summary is written again."""
        t = self.types[tid]
        text = json.dumps([t["kind"], sorted(b["name"] for b in t["bases"]), sorted(m["sig"] for m in t["members"])])
        return hashlib.sha1(text.encode()).hexdigest()[:16]


# ---------------------------------------------------------------- the graph the page draws

def group_ids(t, use_area):
    """(lowest group id, [(id, label, parent, level)...]) for a type: area > assembly > namespace."""
    rows = []
    parent = ""
    if use_area:
        area = area_of(t["folder"])
        aid = "r:" + area
        rows.append((aid, area, "", 0))
        parent = aid
    asm_id = "a:" + t["asm"]
    rows.append((asm_id, t["asm"], parent, 1 if use_area else 0))
    ns = t["ns"] or "(global)"
    nid = "n:" + t["asm"] + "/" + ns
    rows.append((nid, ns, asm_id, rows[-1][3] + 1))
    return nid, rows


def node_of(model, tid, state="unchanged"):
    t = model.types[tid]
    return {"id": tid, "label": t["name"] + ("<>" if t["generic"] else ""), "kind": t["kind"],
            "stereo": model.stereo(t), "file": t["file"], "line": t["line"], "files": sorted(set(t["files"])),
            "members": t["members"][:MAX_MEMBERS], "sig": model.signature(tid), "state": state, "units": []}


def finish(kind, model, node_ids, edges, use_area=None):
    """The graph JSON: nodes, the groups they are in, the edges between shown nodes and the
    edges counted between lowest groups (gedges)."""
    if use_area is None:
        use_area = len({model.types[t]["asm"] for t in node_ids if t in model.types}) > AREA_FROM
    groups, nodes = {}, []
    for tid, n in node_ids.items():
        t = model.types.get(tid)
        if t is None:  # a removed type: model is the base side's
            gid = n.pop("_group")
            rows = n.pop("_groups")
        else:
            gid, rows = group_ids(t, use_area)
        for (i, label, parent, level) in rows:
            groups.setdefault(i, {"id": i, "label": label, "parent": parent, "level": level})
        n["group"] = gid
        nodes.append(n)
    where = {n["id"]: n["group"] for n in nodes}
    shown = [e for e in edges if e["from"] in where and e["to"] in where]
    gedges = {}
    for e in shown:
        a, b = where[e["from"]], where[e["to"]]
        if a == b:
            continue
        g = gedges.setdefault((a, b), {"from": a, "to": b, "kinds": {}})
        g["kinds"][e["kind"]] = g["kinds"].get(e["kind"], 0) + 1
    return {"version": 1, "kind": kind, "groups": sorted(groups.values(), key=lambda g: (g["level"], g["label"].lower())),
            "nodes": nodes, "edges": shown, "gedges": list(gedges.values()), "units": []}


def edge(a, b, kind, state="unchanged", units=()):
    return {"id": f"{a}>{b}:{kind}", "from": a, "to": b, "kind": kind, "state": state, "units": list(units)}


def project_graph(model, step=None):
    """Every type and every resolved link."""
    nodes = {tid: node_of(model, tid) for tid in model.types}
    edges = []
    for i, tid in enumerate(model.types):
        for to, kind, _ in model.links(tid):
            edges.append(edge(tid, to, kind))
        if step and i and i % 4000 == 0:
            step(f"Linked {i} of {len(model.types)} types")
    return finish("project", model, nodes, edges)


def member_diff(old, new):
    """new's members with state added; old's that are gone, state removed."""
    a = {m["sig"] for m in old}
    b = {m["sig"] for m in new}
    out = [dict(m, state="added") if m["sig"] not in a else dict(m) for m in new]
    out += [dict(m, state="removed") for m in old if m["sig"] not in b]
    return out


def review_graph(head, base, changed, unit_files, neighbours=True):
    """The types declared in the changed files, at head (added, changed) and at base (removed),
    with the unchanged types they link to. changed: {path: status letter}; unit_files: {unit: set(paths)}."""
    units_of = {}
    for u, files in unit_files.items():
        for f in files:
            units_of.setdefault(f, set()).add(u)

    def units_for(paths):
        got = set()
        for p in paths:
            got |= units_of.get(p, set())
        return sorted(got)

    in_changed = lambda t: any(f in changed for f in t["files"])  # noqa: E731
    head_ids = {tid for tid, t in head.types.items() if in_changed(t)}
    base_ids = {tid for tid, t in base.types.items() if in_changed(t)}
    nodes, edges = {}, []
    for tid in sorted(head_ids | base_ids):
        h, b = head.types.get(tid), base.types.get(tid)
        if h and not b:
            n = node_of(head, tid, "added")
            n["members"] = [dict(m, state="added") for m in n["members"]]
        elif b and not h:
            n = node_of(base, tid, "removed")
            gid, rows = group_ids(b, False)
            n["_group"], n["_groups"] = gid, rows
        else:
            n = node_of(head, tid)
            n["members"] = member_diff(b["members"], h["members"])
            same = (head.signature(tid) == base.signature(tid))
            n["state"] = "unchanged" if same else "changed"
            if not same or any(f in changed for f in h["files"]):
                n["state"] = "changed" if not same else "touched"
        n["units"] = units_for([f for f in (h or b)["files"] if f in changed])
        nodes[tid] = n
    for tid in sorted(head_ids | base_ids):
        new = {(to, k): f for to, k, f in head.links(tid)} if tid in head.types else {}
        old = {(to, k): f for to, k, f in base.links(tid)} if tid in base.types else {}
        for (to, k), files in new.items():
            st = "unchanged" if (to, k) in old else ("added" if tid in base.types or tid in head_ids else "unchanged")
            if tid not in base.types:
                st = "added"
            edges.append(edge(tid, to, k, st, units_for([f for f in files if f in changed]) if st != "unchanged" else ()))
            if to not in nodes and neighbours and to in head.types:
                nodes[to] = node_of(head, to, "unchanged")
        for (to, k), files in old.items():
            if (to, k) in new:
                continue
            edges.append(edge(tid, to, k, "removed", units_for([f for f in files if f in changed])))
            if to not in nodes and neighbours:
                if to in head.types:
                    nodes[to] = node_of(head, to, "unchanged")
                elif to in base.types:
                    n = node_of(base, to, "unchanged")
                    gid, rows = group_ids(base.types[to], False)
                    n["_group"], n["_groups"] = gid, rows
                    nodes[to] = n
    # the model for groups is head; removed types carry their own
    for tid, n in nodes.items():
        if tid not in head.types and "_group" not in n:
            gid, rows = group_ids(base.types[tid], False)
            n["_group"], n["_groups"] = gid, rows
    g = finish("review", head, nodes, edges, use_area=False)
    g["units"] = [{"id": u, "label": u} for u in sorted(unit_files, key=unit_order)]
    return g


def unit_order(u):
    m = re.search(r"\d+", str(u))
    return (int(m.group()) if m else 10 ** 6, str(u))


def plan_merge(head, drawn, steps):
    """The model's plan diagram (drawn: {nodes, edges}) joined to the code: a node naming a type that
    exists takes its real kind, members, file and group (state changed when the plan changes it, else
    unchanged); a new one keeps what the model gave (state planned). steps: [{id, label}]."""
    nodes, edges, ids = {}, [], {}
    for n in (drawn.get("nodes") or [])[:400]:
        if not isinstance(n, dict) or not str(n.get("name") or n.get("label") or "").strip():
            continue
        name = re.sub(r"[^\w.]", "", str(n.get("name") or n.get("label")))[:120]
        simple = name.rsplit(".", 1)[-1]
        ns = str(n.get("namespace") or "").strip()[:160]
        hit = None
        cands = head.by_name.get(simple, []) if head else []
        if cands:
            exact = [c for c in cands if c == name or (ns and c == ns + "." + simple)]
            hit = exact[0] if exact else (cands[0] if len(cands) == 1 else None)
        units = [str(u)[:20] for u in (n.get("steps") or n.get("units") or []) if str(u).strip()][:12]
        change = str(n.get("change") or n.get("state") or "new").lower()
        if hit:  # (a type the plan adds can be there already: the branch may have built it)
            node = node_of(head, hit, "planned" if change.startswith("new") else "changed" if change.startswith("chang") else "unchanged")
            planned = [m for m in _model_members(n) if m["sig"] not in {x["sig"] for x in node["members"]}]
            node["members"] = node["members"] + [dict(m, state="added") for m in planned]
        else:
            asm = str(n.get("assembly") or "").strip()[:120] or "(new)"
            hit = (ns + "." if ns else "") + simple
            nid = "n:" + asm + "/" + (ns or "(global)")
            node = {"id": hit, "label": simple, "kind": _kind(n.get("kind")), "stereo": str(n.get("stereo") or _kind(n.get("kind")))[:30],
                    "file": str(n.get("file") or "")[:300], "line": 0, "files": [], "members": [dict(m, state="added") for m in _model_members(n)],
                    "sig": "", "state": "planned", "units": [],
                    "_group": nid, "_groups": [("a:" + asm, asm, "", 0), (nid, ns or "(global)", "a:" + asm, 1)]}
        node["units"] = units
        if str(n.get("summary") or "").strip():
            node["summary"] = str(n["summary"]).strip()[:600]
        ids[name] = ids[simple] = hit
        nodes[hit] = node
    for e in (drawn.get("edges") or [])[:1200]:
        if not isinstance(e, dict):
            continue
        a = ids.get(str(e.get("from", "")).strip()) or ids.get(str(e.get("from", "")).rsplit(".", 1)[-1])
        b = ids.get(str(e.get("to", "")).strip()) or ids.get(str(e.get("to", "")).rsplit(".", 1)[-1])
        kind = str(e.get("kind") or "uses").lower()
        if not a or not b or a == b or kind not in EDGE_RANK:
            continue
        ed = edge(a, b, kind, "added" if nodes[a]["state"] in ("planned", "changed") else "unchanged",
                  [str(u)[:20] for u in (e.get("steps") or e.get("units") or [])][:12])
        if str(e.get("label") or "").strip():
            ed["label"] = str(e["label"]).strip()[:60]
        edges.append(ed)
    # existing types the plan changes: also show what they already depend on, greyed
    if head:
        for tid, n in list(nodes.items()):
            if n["state"] != "changed" or tid not in head.types:
                continue
            for to, k, _ in head.links(tid)[:40]:
                if to not in nodes:
                    nodes[to] = node_of(head, to, "unchanged")
                if not any(x["from"] == tid and x["to"] == to for x in edges):
                    edges.append(edge(tid, to, k))
    g = finish("plan", head or Model({}, {}), nodes, edges, use_area=False)
    g["units"] = [{"id": str(s.get("id"))[:20], "label": str(s.get("label") or s.get("id"))[:120]}
                  for s in steps if isinstance(s, dict) and s.get("id")]
    return g


def _kind(k):
    k = str(k or "class").lower()
    return k if k in ("class", "struct", "interface", "enum", "record") else "class"


def _model_members(n):
    out = []
    for m in (n.get("members") or [])[:30]:
        sig = str(m.get("sig") if isinstance(m, dict) else m).strip()[:160]
        if sig:
            vis = next((w for w in _VIS if sig.startswith(w + " ")), "public")
            out.append({"sig": sig, "vis": vis, "kind": "method" if "(" in sig else "property"})
    return out
