#!/usr/bin/env python3
"""The state Tatty keeps about a feature's merge request, and the only writer of it.

One JSON file per feature (<project home>/mr/<feature>.state.json):

    {"threads": {"<thread id>": {
        "recommendation": {"action": "act|rebut|ask", "summary", "reasoning", "change": {"description", "files"},
                           "draftReply", "ts", "model", "cost", "seen": <notes when it was made>} | null,
        "selected": true|false,                 # Make this change was pressed
        "draft": {"text": "...", "edited": true|false, "commit": "<short sha>"},
        "result": {"status": "applied|skipped|blocked", "text": "...", "ts": ...} | null}}}

The server writes it through `change`; the mr-change skill records what it did through the command line
(`mrstate.sh result <state file> <thread> applied|skipped|blocked [text]`), so the model never edits the JSON.
Nothing here talks to the host: a draft reply is only text kept for the person to copy.
"""
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import reviewdoc  # noqa: E402  (its Lock: one writer at a time, across processes)

RESULTS = ("applied", "skipped", "blocked")
DEFAULT = {"threads": {}}


def load(path):
    try:
        data = json.loads(reviewdoc.lp(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    if not isinstance(data, dict) or not isinstance(data.get("threads"), dict):
        data = {"threads": {}}
    return data


def save(path, data):
    p = reviewdoc.lp(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = reviewdoc.lp(p.with_name("." + p.name + ".tmp"))
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(tmp, p)


def thread(data, tid):
    return data["threads"].setdefault(tid, {"recommendation": None, "selected": False,
                                            "draft": {"text": "", "edited": False, "commit": ""}, "result": None})


def change(path, how):
    """Read, apply how(data), write, under the lock; what how returned."""
    with reviewdoc.Lock(path):
        data = load(path)
        got = how(data)
        save(path, data)
        return got


def main(argv):
    if len(argv) < 2 or argv[0] not in ("show", "result", "list"):
        print("usage: mrstate.sh show <state file>   (the comments chosen to change: id, action, result, text)\n"
              "       mrstate.sh result <state file> <thread id> applied|skipped|blocked [text]", file=sys.stderr)
        return 2
    cmd, path = argv[0], argv[1]
    if cmd in ("show", "list"):
        data = load(path)
        for tid, t in data["threads"].items():
            if t.get("selected"):
                r = t.get("result") or {}
                print("\t".join([tid, str((t.get("recommendation") or {}).get("action", "")),
                                 r.get("status", ""), (r.get("text", "") or "").replace("\t", " ").replace("\n", " ")]))
        return 0
    if len(argv) < 4 or argv[3] not in RESULTS:
        print("result: applied, skipped or blocked", file=sys.stderr)
        return 2
    tid, status, text = argv[2], argv[3], " ".join(argv[4:]).strip()

    def how(data):
        t = data["threads"].get(tid)
        if not t or not t.get("selected"):
            raise ValueError(f"{tid} isn't one of the comments to change")
        t["result"] = {"status": status, "text": text[:600], "ts": int(time.time())}

    try:
        change(path, how)
    except (ValueError, reviewdoc.DocError) as e:
        print(f"mrstate: {e}", file=sys.stderr)
        return 1
    print(f"{tid}: {status}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
