"""Reading a merge / pull request from the host it lives on, for a feature's Merge request page.

This module only reads. `run(args)` is given by the server: it runs the host's CLI (glab or gh) with those
arguments, as argv with no shell, and returns (exit code, stdout, stderr). What comes back is one shape whatever
the host (see `normal`), so the page never knows which host it is looking at:

    {"provider", "id", "url", "title", "description", "state", "draft", "author", "source", "target", "sha",
     "pipeline": {"status", "url"}, "files": [{"path", "status", "add", "del"}],
     "threads": [{"id", "url", "path", "line", "resolved", "outdated", "hunk", "notes": [{"id", "author", "body", "created", "url"}]}]}

and `diffs`, {path: the file's unified diff text}. A thread with no path is a general comment. Nothing here
posts, replies to or resolves anything.
"""
import json
import re
import urllib.parse

HUNK_HEAD = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")
ID = re.compile(r"^[A-Za-z0-9_=:./+-]{1,200}$")  # a thread's or a note's id, as hosts write them
MAX_THREADS = 200
MAX_FILES = 300
MAX_NOTES = 50
MAX_DIFF_CHARS = 400000  # a file's diff text kept, at most


class HostError(Exception):
    """The host or its CLI said no (the message is for the person)."""


def parse_unified(text):
    """The hunks of a unified diff, in the shape the Code Diff page draws ({oldStart, oldLines, newStart,
    newLines, lines: [" x", "-x", "+x"]}), and whether git said the file is binary."""
    hunks, cur = [], None
    for raw in text.split("\n"):
        line = raw.rstrip("\r")
        m = HUNK_HEAD.match(line)
        if m:
            cur = {"oldStart": int(m.group(1)), "oldLines": int(m.group(2) or 1) if m.group(2) != "0" else 0,
                   "newStart": int(m.group(3)), "newLines": int(m.group(4) or 1) if m.group(4) != "0" else 0, "lines": []}
            hunks.append(cur)
        elif cur is not None and line[:1] in (" ", "-", "+"):
            cur["lines"].append(line)
        elif cur is None and line.startswith("Binary files "):
            return [], True
    return hunks, False


# ---------------------------------------------------------------- which host

def parse_remote(url):
    """(host name, project path) from a git remote: https://host/group/sub/repo.git, git@host:group/repo.git or
    ssh://git@host:22/group/repo.git. ("", "") when it isn't one."""
    u = str(url or "").strip()
    m = re.match(r"^[A-Za-z][A-Za-z0-9+.-]*://(?:[^@/]*@)?([^/:]+)(?::\d+)?/(.+?)(?:\.git)?/?$", u)
    if not m:
        m = re.match(r"^(?:[^@/\s]+@)?([^:/\s]+):(?!//)(.+?)(?:\.git)?/?$", u)
    return (m.group(1).lower(), m.group(2).strip("/")) if m else ("", "")


def detect(url, override=""):
    """{kind: gitlab|github|bitbucket|other, host, path} for a repo's origin. override (gitlab, github, bitbucket
    or other) is the person's say for a host whose name doesn't give it away."""
    host, path = parse_remote(url)
    kind = override if override in ("gitlab", "github", "bitbucket", "other") else ""
    if not kind:
        kind = ("gitlab" if "gitlab" in host else "github" if "github" in host else
                "bitbucket" if "bitbucket" in host else "other") if host else "other"
    return {"kind": kind, "host": host, "path": path}


# ---------------------------------------------------------------- diffs

def count_lines(hunks):
    add = sum(1 for h in hunks for ln in h["lines"] if ln.startswith("+"))
    return add, sum(1 for h in hunks for ln in h["lines"] if ln.startswith("-"))


def file_entry(path, status, diff_text):
    """(the file's entry for the list, its diff text kept)."""
    hunks, binary = parse_unified(diff_text or "")
    add, rem = count_lines(hunks)
    return {"path": path, "status": status, "add": add, "del": rem, "binary": binary}, (diff_text or "")[:MAX_DIFF_CHARS]


def split_git_diff(text):
    """[(path, status, diff text from its first @@)] from the whole output of `git diff` / `gh pr diff`."""
    out, cur = [], None
    for line in str(text or "").replace("\r\n", "\n").split("\n"):
        if line.startswith("diff --git "):
            m = re.match(r"^diff --git a/(.+?) b/(.+)$", line)
            cur = {"path": m.group(2) if m else line[11:], "status": "modified", "body": [], "started": False}
            out.append(cur)
        elif cur is not None:
            if not cur["started"]:
                if line.startswith("new file mode"):
                    cur["status"] = "added"
                elif line.startswith("deleted file mode"):
                    cur["status"] = "deleted"
                elif line.startswith("rename from"):
                    cur["status"] = "renamed"
                elif line.startswith("+++ b/"):
                    cur["path"] = line[6:]
                elif line.startswith("@@") or line.startswith("Binary files "):
                    cur["started"] = True
                    cur["body"].append(line)
            else:
                cur["body"].append(line)
    return [(f["path"], f["status"], "\n".join(f["body"])) for f in out]


def files_from_git(text):
    files, diffs = [], {}
    for path, status, body in split_git_diff(text)[:MAX_FILES]:
        entry, kept = file_entry(path, status, body)
        files.append(entry)
        diffs[path] = kept
    return files, diffs


# ---------------------------------------------------------------- helpers

def loads_many(out):
    """Every JSON value in the output (a paginated CLI may print one array per page), arrays flattened."""
    dec, i, text, got = json.JSONDecoder(), 0, str(out or ""), []
    while True:
        while i < len(text) and text[i].isspace():
            i += 1
        if i >= len(text):
            return got
        try:
            val, i = dec.raw_decode(text, i)
        except ValueError:
            raise HostError("the host's answer wasn't JSON: " + text[i:i + 120].strip())
        got.extend(val) if isinstance(val, list) else got.append(val)


def must(result, what):
    code, out, err = result
    if code != 0:
        said = [ln.strip() for ln in (err or out or "").splitlines() if ln.strip()]
        raise HostError(f"{what}: {said[-1][:300] if said else 'the command failed'}")
    return out


def person(v):
    if isinstance(v, dict):
        return str(v.get("username") or v.get("login") or v.get("name") or "")
    return str(v or "")


def clip(s, n=20000):
    s = str(s or "")
    return s if len(s) <= n else s[:n] + "\n\n[cut: the rest is on the host]"


def normal(provider, mr_id, url, title, description, state, draft, author, source, target, sha, pipeline, files, threads):
    return {"provider": provider, "id": str(mr_id), "url": url, "title": title, "description": clip(description),
            "state": state, "draft": bool(draft), "author": author, "source": source, "target": target, "sha": sha,
            "pipeline": pipeline, "files": files, "threads": threads}


def good_id(v):
    return bool(ID.match(str(v or "")))


# ---------------------------------------------------------------- GitLab (glab)

def gitlab(run, project, iid):
    """(normalised MR, diffs) through `glab api`."""
    if not str(iid).isdigit():
        raise HostError("no merge request number")
    base = f"projects/{urllib.parse.quote(project, safe='')}/merge_requests/{iid}"
    mr = json.loads(must(run(["api", base]), "the merge request") or "{}")
    if not isinstance(mr, dict) or not mr.get("iid"):
        raise HostError("the host didn't describe that merge request")
    url = str(mr.get("web_url") or "")
    discussions = loads_many(must(run(["api", "--paginate", f"{base}/discussions?per_page=100"]), "the discussions"))
    threads = []
    for d in discussions:
        if not isinstance(d, dict) or not good_id(d.get("id")):
            continue
        notes = [n for n in d.get("notes") or [] if isinstance(n, dict) and not n.get("system")]
        if not notes:
            continue
        pos = next((n.get("position") for n in notes if isinstance(n.get("position"), dict)), None) or {}
        resolvable = [n for n in notes if n.get("resolvable")]
        threads.append({
            "id": d["id"], "url": f"{url}#note_{notes[0].get('id')}" if url and notes[0].get("id") else url,
            "path": str(pos.get("new_path") or pos.get("old_path") or ""),
            "line": pos.get("new_line") or pos.get("old_line") or 0,
            "resolved": bool(resolvable) and all(n.get("resolved") for n in resolvable),
            "resolvable": bool(resolvable), "outdated": False, "hunk": "",
            "notes": [{"id": str(n.get("id")), "author": person(n.get("author")), "body": clip(n.get("body")),
                       "created": str(n.get("created_at") or ""), "url": f"{url}#note_{n.get('id')}" if url else ""}
                      for n in notes[:MAX_NOTES]]})
        if len(threads) >= MAX_THREADS:
            break
    changes = json.loads(must(run(["api", f"{base}/changes"]), "the changes") or "{}")
    files, diffs = [], {}
    for c in (changes.get("changes") or [])[:MAX_FILES] if isinstance(changes, dict) else []:
        status = "added" if c.get("new_file") else "deleted" if c.get("deleted_file") else "renamed" if c.get("renamed_file") else "modified"
        path = str(c.get("new_path") or c.get("old_path") or "")
        entry, kept = file_entry(path, status, c.get("diff"))
        files.append(entry)
        diffs[path] = kept
    pipe = mr.get("head_pipeline") or mr.get("pipeline") or {}
    status = {"success": "passed", "failed": "failed", "running": "running", "pending": "running", "canceled": "failed"}.get(str(pipe.get("status", "")), "")
    state = {"opened": "opened", "locked": "opened", "merged": "merged", "closed": "closed"}.get(str(mr.get("state")), str(mr.get("state") or ""))
    return normal("gitlab", mr.get("iid"), url, str(mr.get("title") or ""), mr.get("description"), state,
                  mr.get("draft") or mr.get("work_in_progress"), person(mr.get("author")), str(mr.get("source_branch") or ""),
                  str(mr.get("target_branch") or ""), str(mr.get("sha") or ""), {"status": status, "url": str(pipe.get("web_url") or "")},
                  files, threads), diffs


# ---------------------------------------------------------------- GitHub (gh)

GRAPHQL = ("query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){"
           "reviewThreads(first:100){nodes{id isResolved isOutdated path line originalLine "
           "comments(first:50){nodes{id author{login} body createdAt url diffHunk}}}} "
           "comments(first:100){nodes{id author{login} body createdAt url}}}}}")


def github(run, owner, name, number):
    """(normalised MR, diffs) through `gh pr view`, `gh api graphql` and `gh pr diff`."""
    if not str(number).isdigit():
        raise HostError("no pull request number")
    repo = f"{owner}/{name}"
    pr = json.loads(must(run(["pr", "view", str(number), "-R", repo, "--json",
                             "number,title,body,state,isDraft,author,headRefName,baseRefName,url,headRefOid,statusCheckRollup"]), "the pull request") or "{}")
    if not isinstance(pr, dict) or not pr.get("number"):
        raise HostError("the host didn't describe that pull request")
    got = json.loads(must(run(["api", "graphql", "-f", "query=" + GRAPHQL, "-F", f"owner={owner}", "-F", f"name={name}",
                               "-F", f"number={number}"]), "the comments") or "{}")
    node = (((got.get("data") or {}).get("repository") or {}).get("pullRequest") or {}) if isinstance(got, dict) else {}
    threads = []
    for t in ((node.get("reviewThreads") or {}).get("nodes") or []):
        notes = [n for n in ((t.get("comments") or {}).get("nodes") or []) if isinstance(n, dict)]
        if not notes or not good_id(t.get("id")):
            continue
        threads.append({
            "id": t["id"], "url": str(notes[0].get("url") or ""), "path": str(t.get("path") or ""),
            "line": t.get("line") or t.get("originalLine") or 0, "resolved": bool(t.get("isResolved")), "resolvable": True,
            "outdated": bool(t.get("isOutdated")), "hunk": clip(notes[0].get("diffHunk"), 4000),
            "notes": [{"id": str(n.get("id")), "author": person(n.get("author")), "body": clip(n.get("body")),
                       "created": str(n.get("createdAt") or ""), "url": str(n.get("url") or "")} for n in notes[:MAX_NOTES]]})
        if len(threads) >= MAX_THREADS:
            break
    for n in ((node.get("comments") or {}).get("nodes") or []):
        if isinstance(n, dict) and good_id(n.get("id")) and len(threads) < MAX_THREADS:
            threads.append({"id": n["id"], "url": str(n.get("url") or ""), "path": "", "line": 0, "resolved": False,
                            "resolvable": False, "outdated": False, "hunk": "",
                            "notes": [{"id": str(n.get("id")), "author": person(n.get("author")), "body": clip(n.get("body")),
                                       "created": str(n.get("createdAt") or ""), "url": str(n.get("url") or "")}]})
    files, diffs = files_from_git(must(run(["pr", "diff", str(number), "-R", repo]), "the diff"))
    marks = [c for c in pr.get("statusCheckRollup") or [] if isinstance(c, dict)]
    bad = any(str(c.get("conclusion") or c.get("state") or "").upper() in ("FAILURE", "ERROR", "TIMED_OUT", "CANCELLED") for c in marks)
    busy = any(str(c.get("status") or c.get("state") or "").upper() in ("IN_PROGRESS", "QUEUED", "PENDING") for c in marks)
    pipe = {"status": "failed" if bad else "running" if busy else "passed" if marks else "", "url": ""}
    state = {"OPEN": "opened", "MERGED": "merged", "CLOSED": "closed"}.get(str(pr.get("state")), str(pr.get("state") or "").lower())
    return normal("github", pr.get("number"), str(pr.get("url") or ""), str(pr.get("title") or ""), pr.get("body"), state,
                  pr.get("isDraft"), person(pr.get("author")), str(pr.get("headRefName") or ""), str(pr.get("baseRefName") or ""),
                  str(pr.get("headRefOid") or ""), pipe, files, threads), diffs
