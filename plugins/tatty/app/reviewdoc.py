#!/usr/bin/env python3
"""reviewdoc.py: the Review Suggestions document, and the only thing that writes it.

`<Feature> - Review Suggestions.md` sits in a feature's folder. After a branch review each finding is
a suggestion (RS01, RS02, ...) with options for how to resolve it; the person decides each one on
Tatty's Review page, and an implementation session applies the decisions. Both Tatty's server (which
imports this) and the skills (which run `suggestions.sh`, the command line below) go through here, so
the layout never varies and a hand-edit that breaks it is reported by `check` instead of being
written over. Standard library only, Python 3.8+.

Status: Open (some suggestion undecided) -> Decided (all decided) -> Applied (the implementation
finished) -> Done (committed, or nothing to change). IDs are the next unused number and are never reused.

usage: suggestions.sh init <doc> --repo DIR --branch B --base B --head SHA [--report PATH] [--replace]
       suggestions.sh add <doc>                spec on stdin (see parse_spec); several, split by a --- line
       suggestions.sh list <doc> [--tsv]       one line per suggestion
       suggestions.sh status <doc>             key=value lines: status, total, decided, applied, skipped, blocked
       suggestions.sh decide <doc> RS01 <key|other> [--note TEXT]
       suggestions.sh result <doc> RS01 applied|skipped|blocked [TEXT]
       suggestions.sh finish <doc>             the implementation is done: Status Applied
       suggestions.sh done <doc>               the review is done: Status Done
       suggestions.sh check <doc>              exit 0 only if the document is in the layout
Exit: 0 done, 1 refused (bad input, or not allowed in this status), 2 usage error or missing file.
"""

import os
import re
import sys
import time
from pathlib import Path

STATUSES = ("Open", "Decided", "Applied", "Done")
SEVERITIES = ("critical", "major", "minor", "nit")
RESULTS = {"applied": "Applied", "skipped": "Skipped", "blocked": "Blocked"}
NONE = "—"
HEAD_FIELDS = ("Repository", "Branch", "Base", "Reviewed", "Report")


class DocError(Exception):
    """The request can't be carried out (bad input, or not allowed in this status)."""


def clean(text):
    """One line: whitespace collapsed."""
    return " ".join(str(text).split())


def cell(text):
    return clean(text).replace("|", "\\|")


# ---------------------------------------------------------------- reading

class Doc:
    """The document as data: header, status and suggestions. render() is the only way back to text."""

    def __init__(self, name, head=None, status="Open", items=None):
        self.name = name  # the feature, as in "<name> - Review Suggestions"
        self.head = {k: "" for k in HEAD_FIELDS}
        self.head.update(head or {})
        self.status = status
        self.items = items or []
        self.crlf = False
        self.bom = False

    # -- derived
    def item(self, rid):
        want = rid.strip().upper()
        found = next((i for i in self.items if i["id"] == want), None)
        if not found:
            raise DocError(f"no suggestion {rid}")
        return found

    def decided(self):
        return sum(1 for i in self.items if i["decision"] != NONE)

    def counts(self):
        out = {"total": len(self.items), "decided": self.decided(), "applied": 0, "skipped": 0, "blocked": 0}
        for i in self.items:
            word = i["result"].split(":", 1)[0].lower()
            if word in ("applied", "skipped", "blocked"):
                out[word] += 1
        return out

    def phase(self):
        """review (no suggestions yet), decide, apply, commit, merge: what the feature does next."""
        if self.status == "Done":
            return "merge"
        if self.status == "Applied":
            return "commit"
        if not self.items:
            return "review"
        return "apply" if self.decided() == len(self.items) else "decide"

    def chosen(self, item):
        """The option a decision points at, else None ('Other: ...' and undecided have none)."""
        return next((o for o in item["options"] if o["key"] == item["decision"]), None)

    def next_id(self):
        top = max([int(i["id"][2:]) for i in self.items] or [0])
        return "RS%02d" % (top + 1)

    # -- changes
    def refresh(self):
        if self.status in ("Open", "Decided"):
            self.status = "Decided" if self.items and self.decided() == len(self.items) else "Open"

    def add(self, spec):
        if self.status not in ("Open", "Decided"):
            raise DocError(f"the review is {self.status}: suggestions can't be added now")
        item = dict(spec, id=self.next_id(), decision=NONE, note=NONE, result=NONE)
        self.items.append(item)
        self.refresh()
        return item["id"]

    def decide(self, rid, choice, note=""):
        if self.status not in ("Open", "Decided"):
            raise DocError(f"the review is {self.status}: a decision can't be changed now")
        item = self.item(rid)
        choice, note = clean(choice), clean(note)
        if choice.lower() == "other":
            if not note:
                raise DocError("'other' needs the person's own words: --note TEXT")
            item["decision"], item["note"] = "Other: " + note, NONE
        else:
            key = choice.upper()
            if not any(o["key"] == key for o in item["options"]):
                raise DocError(f"{item['id']} has no option {choice}: " + ", ".join(o["key"] for o in item["options"]) + " or other")
            item["decision"], item["note"] = key, note or NONE
        item["result"] = NONE
        self.refresh()
        return item

    def result(self, rid, what, why=""):
        if self.status != "Decided":
            raise DocError(f"results are recorded once every suggestion is decided and before it is finished (this review is {self.status})")
        word = RESULTS.get(what.strip().lower())
        if not word:
            raise DocError("result: applied, skipped or blocked")
        item = self.item(rid)
        item["result"] = word + (": " + clean(why) if clean(why) else "")
        return item

    def finish(self):
        if self.status != "Decided":
            raise DocError(f"can't finish: the review is {self.status}" + (" (decide every suggestion first)" if self.status == "Open" else ""))
        self.status = "Applied"

    def done(self):
        if self.status == "Applied" or (self.status in ("Open", "Decided") and not self.items):
            self.status = "Done"
        elif self.status != "Done":
            raise DocError(f"can't be done: the review is {self.status}" + (" (decide, apply and commit first)" if self.items else ""))

    # -- text
    def render(self):
        out = [f"# {self.name} - Review Suggestions", "",
               *[f"- **{k}:** {self.head[k] or NONE}" for k in HEAD_FIELDS],
               f"- **Status:** {self.status}", f"- **Decided:** {self.decided()} of {len(self.items)}", ""]
        if self.items:
            out += ["## At a glance", "", "| ID | Severity | Where | Summary | Decision | Result |", "|----|----------|-------|---------|----------|--------|"]
            for i in self.items:
                out.append("| " + " | ".join([i["id"], i["severity"], "`" + cell(i["where"]) + "`" if i["where"] else NONE, cell(i["summary"]),
                                              cell(i["decision"]), cell(i["result"])]) + " |")
            out.append("")
        for i in self.items:
            out += [f"## {i['id']} — {clean(i['summary'])}", "",
                    f"- **Severity:** {i['severity']}", f"- **Dimension:** {clean(i['dimension']) or NONE}", f"- **Where:** {clean(i['where']) or NONE}",
                    "- **Finding:**", *["  " + ln if ln.strip() else "" for ln in (i["finding"] or NONE).split("\n")],
                    "- **Options:**"]
            for o in i["options"]:
                out.append(f"  - **{o['key']}** — {clean(o['title'])}" + (f": {clean(o['detail'])}" if clean(o["detail"]) else "") + (" *(recommended)*" if o["recommended"] else ""))
            out += [f"- **Decision:** {i['decision']}", f"- **Note:** {i['note']}", f"- **Result:** {i['result']}", ""]
        return "\n".join(out).rstrip("\n") + "\n"


HEAD_LINE = re.compile(r"^- \*\*([A-Za-z ]+):\*\*\s*(.*)$")
ITEM_HEAD = re.compile(r"^## (RS\d+) — (.*)$")
OPTION = re.compile(r"^\s+- \*\*([A-Za-z0-9])\*\* — (.*?)(?: \*\(recommended\)\*)?$")


def parse(text, name=""):
    """The text as a Doc; DocError naming the first thing that isn't in the layout."""
    crlf = "\r\n" in text
    bom = text.startswith("\ufeff")
    lines = text.lstrip("\ufeff").replace("\r\n", "\n").split("\n")
    if not lines or not lines[0].startswith("# ") or not lines[0].endswith(" - Review Suggestions"):
        raise DocError("line 1 should be '# <Feature> - Review Suggestions'")
    doc = Doc(lines[0][2:-len(" - Review Suggestions")] or name)
    doc.crlf, doc.bom = crlf, bom
    n = 1
    while n < len(lines) and not ITEM_HEAD.match(lines[n]) and not lines[n].startswith("## At a glance"):
        m = HEAD_LINE.match(lines[n])
        if m:
            key, val = m.group(1), m.group(2).strip().strip("`")
            val = "" if val == NONE else val
            if key in HEAD_FIELDS:
                doc.head[key] = val
            elif key == "Status":
                if val not in STATUSES:
                    raise DocError(f"line {n + 1}: Status should be one of {', '.join(STATUSES)}")
                doc.status = val
        n += 1
    cur, field = None, None
    for n in range(n, len(lines)):
        line = lines[n]
        m = ITEM_HEAD.match(line)
        if m:
            cur = {"id": m.group(1), "summary": m.group(2).strip(), "severity": "minor", "dimension": "", "where": "", "finding": "", "options": [],
                   "decision": NONE, "note": NONE, "result": NONE}
            doc.items.append(cur)
            field = None
            continue
        if cur is None:
            continue
        h = HEAD_LINE.match(line)
        if h:
            key, val = h.group(1), h.group(2).strip()
            field = key
            if key == "Severity":
                if val not in SEVERITIES:
                    raise DocError(f"{cur['id']}: Severity should be one of {', '.join(SEVERITIES)}")
                cur["severity"] = val
            elif key in ("Dimension", "Where"):
                cur[key.lower()] = "" if val == NONE else val.strip("`")
            elif key in ("Decision", "Note", "Result"):
                cur[key.lower()] = val or NONE
            elif key in ("Finding", "Options"):
                pass
            else:
                raise DocError(f"{cur['id']}: unknown field '{key}'")
        elif field == "Finding" and (line.startswith("  ") or not line.strip()):
            cur["finding"] += (("\n" if cur["finding"] else "") + line[2:]) if line.strip() or cur["finding"] else ""
        elif field == "Options" and line.strip():
            o = OPTION.match(line)
            if not o:
                raise DocError(f"{cur['id']}: an option should read '  - **A** — title: detail'")
            title, _, detail = o.group(2).partition(": ")
            cur["options"].append({"key": o.group(1).upper(), "title": title, "detail": detail, "recommended": line.rstrip().endswith("*(recommended)*")})
    for i in doc.items:
        i["finding"] = i["finding"].strip("\n")
        if i["finding"] == NONE:
            i["finding"] = ""
        if not i["options"]:
            raise DocError(f"{i['id']}: has no options")
        if i["decision"] != NONE and not i["decision"].startswith("Other: ") and not any(o["key"] == i["decision"] for o in i["options"]):
            raise DocError(f"{i['id']}: the decision {i['decision']} is not one of its options")
    return doc


def load(path):
    """The document at path, or None when there is none. DocError when it is not in the layout."""
    p = Path(path)
    if not p.is_file():
        return None
    try:
        return parse(p.read_bytes().decode("utf-8", "replace"), p.stem.rsplit(" - ", 1)[0])
    except DocError as e:
        raise DocError(f"{p.name}: {e}")


# ---------------------------------------------------------------- writing

class Lock:
    """One writer at a time, across processes: a directory beside the document."""

    def __init__(self, path):
        self.dir = Path(path).parent / ("." + Path(path).name + ".lock")

    def __enter__(self):
        for _ in range(200):
            try:
                self.dir.mkdir()
                return self
            except FileExistsError:
                try:
                    if time.time() - self.dir.stat().st_mtime > 60:  # left behind by a crash
                        self.dir.rmdir()
                except OSError:
                    pass
                time.sleep(0.05)
        raise DocError("another writer has the document locked")

    def __exit__(self, *exc):
        try:
            self.dir.rmdir()
        except OSError:
            pass


def save(path, doc):
    """Write the document whole, as a temp file and a rename, keeping its CRLF and BOM."""
    text = doc.render()
    if doc.crlf:
        text = text.replace("\n", "\r\n")
    data = ("\ufeff" if doc.bom else "") + text
    p = Path(path)
    tmp = p.with_name("." + p.name + ".tmp")
    tmp.write_bytes(data.encode("utf-8"))
    os.replace(tmp, p)


def change(path, how):
    """Read, apply how(doc), write, under the lock: what how returned. The document must exist and be in the layout."""
    with Lock(path):
        doc = load(path)
        if doc is None:
            raise DocError(f"no such document: {path}")
        got = how(doc)
        save(path, doc)
        return got


def create(path, name, head, replace=False):
    """A new, empty document. An existing one is refused, or with replace moved to <folder>/.tt/Review Suggestions history/."""
    p = Path(path)
    with Lock(path):
        if p.exists():
            if not replace:
                raise DocError(f"{p.name} exists: --replace keeps the old one in .tt/ and starts again")
            hist = p.parent / ".tt" / "Review Suggestions history"
            hist.mkdir(parents=True, exist_ok=True)
            os.replace(p, hist / (time.strftime("%Y%m%d-%H%M%S") + " " + p.name))
        save(p, Doc(name, head))


# ---------------------------------------------------------------- the spec `add` reads

def parse_spec(text):
    """Suggestions from stdin: `key: value` lines, a line of --- between suggestions. Keys: summary, severity,
    dimension, where, finding (more lines indented by two spaces carry on), and `option: A | title | detail`,
    with a final `| recommended` on the one to try first. 'Leave as is' is added as the last option if none is."""
    out = []
    for block in re.split(r"(?m)^---\s*$", text.replace("\r\n", "\n")):
        if not block.strip():
            continue
        spec, key = {"options": []}, None
        for line in block.split("\n"):
            if line.startswith("  ") and key in ("finding", "summary", "where", "dimension"):
                spec[key] += "\n" + line[2:]
                continue
            m = re.match(r"^([a-z]+):\s*(.*)$", line)
            if not m:
                if line.strip():
                    raise DocError(f"not a 'key: value' line: {line[:60]}")
                continue
            key, val = m.group(1), m.group(2)
            if key == "option":
                parts = [p.strip() for p in val.split(" | ")]
                if len(parts) < 2 or not re.fullmatch(r"[A-Za-z0-9]", parts[0]):
                    raise DocError("option: should read 'option: A | title | detail'")
                rec = len(parts) >= 3 and parts[-1].lower() == "recommended"
                detail = " | ".join(parts[2:-1] if rec else parts[2:])
                spec["options"].append({"key": parts[0].upper(), "title": clean(parts[1].replace(": ", " - ")), "detail": clean(detail), "recommended": rec})
            elif key in ("summary", "severity", "dimension", "where", "finding"):
                spec[key] = val
            else:
                raise DocError(f"unknown key '{key}'")
        if not clean(spec.get("summary", "")):
            raise DocError("a suggestion needs a summary:")
        sev = clean(spec.get("severity", "minor")).lower()
        if sev not in SEVERITIES:
            raise DocError(f"severity: one of {', '.join(SEVERITIES)}")
        keys = [o["key"] for o in spec["options"]]
        if len(set(keys)) != len(keys):
            raise DocError("an option key is used twice")
        if not spec["options"]:
            raise DocError("a suggestion needs options: (option: A | title | detail)")
        if not any(o["title"].lower().startswith("leave") for o in spec["options"]):
            free = next(k for k in "ABCDEFGHIJKLMNOPQRSTUVWXYZ" if k not in keys)
            spec["options"].append({"key": free, "title": "Leave as is", "detail": "", "recommended": False})
        out.append({"summary": clean(spec["summary"]), "severity": sev, "dimension": clean(spec.get("dimension", "")), "where": clean(spec.get("where", "")),
                    "finding": "\n".join(ln.rstrip() for ln in spec.get("finding", "").split("\n")).strip("\n"), "options": spec["options"]})
    if not out:
        raise DocError("nothing on stdin")
    return out


# ---------------------------------------------------------------- the command line

def esc(text):
    return str(text).replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n")


def usage(code=2):
    print("usage:" + __doc__.split("usage:", 1)[1].strip(), file=sys.stderr)
    return code


def opt(args, name, default=None):
    if name in args:
        i = args.index(name)
        if i + 1 >= len(args):
            raise DocError(f"{name} needs a value")
        v = args[i + 1]
        del args[i:i + 2]
        return v
    return default


def main(argv):
    if len(argv) < 2 or argv[0] in ("-h", "--help"):
        return usage()
    cmd, path, args = argv[0], argv[1], list(argv[2:])
    try:
        if cmd == "init":
            head = {"Repository": opt(args, "--repo", ""), "Branch": opt(args, "--branch", ""), "Base": opt(args, "--base", ""), "Reviewed": opt(args, "--head", ""), "Report": opt(args, "--report", "")}
            replace = "--replace" in args
            name = Path(path).name
            if not name.endswith(" - Review Suggestions.md"):
                raise DocError("the document is named '<Feature> - Review Suggestions.md'")
            create(path, name[:-len(" - Review Suggestions.md")], head, replace)
            print(f"created {Path(path).name}")
        elif cmd == "add":
            specs = parse_spec(sys.stdin.read())
            ids = change(path, lambda d: [d.add(s) for s in specs])
            print("added " + " ".join(ids))
        elif cmd in ("list", "status", "check"):
            doc = load(path)
            if doc is None:
                raise DocError(f"no such document: {path}")
            if cmd == "check":
                print("ok")
            elif cmd == "status":
                c = doc.counts()
                print("\n".join([f"status={doc.status}", f"phase={doc.phase()}"] + [f"{k}={v}" for k, v in c.items()]))
            else:
                for i in doc.items:
                    o = doc.chosen(i)
                    cols = [i["id"], i["severity"], i["where"], i["dimension"], i["summary"], i["decision"], o["title"] if o else "", o["detail"] if o else "", i["note"], i["result"]]
                    print("\t".join(esc(c) for c in cols) if "--tsv" in args else f"{i['id']}  {i['severity']:<8} {i['decision']:<12} {i['result']:<10} {i['summary']}")
        elif cmd == "decide":
            if len(args) < 2:
                return usage()
            note = opt(args, "--note", "")
            item = change(path, lambda d: d.decide(args[0], args[1], note))
            print(f"{item['id']} decided {item['decision']}")
        elif cmd == "result":
            if len(args) < 2:
                return usage()
            item = change(path, lambda d: d.result(args[0], args[1], " ".join(args[2:])))
            print(f"{item['id']} {item['result']}")
        elif cmd in ("finish", "done"):
            change(path, lambda d: d.finish() if cmd == "finish" else d.done())
            print("Applied" if cmd == "finish" else "Done")
        else:
            return usage()
    except DocError as e:
        print(f"suggestions: {e}", file=sys.stderr)
        return 1 if "no such document" not in str(e) else 2
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
