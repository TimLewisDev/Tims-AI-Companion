"""Reading a merge / pull request from the host it lives on, for a feature's Merge request page.

This module only reads. `run(args)` is given by the server: it runs the host's CLI (glab or gh) with those
arguments, as argv with no shell, and returns (exit code, stdout, stderr). What comes back is one shape whatever
the host (see `normal`), so the page never knows which host it is looking at:

    {"provider", "id", "url", "title", "description", "state", "draft", "author", "source", "target", "sha",
     "pipeline": {"status", "url"}, "files": [{"path", "status", "add", "del"}],
     "assignees": [name], "reviewers": [{"name", "state": approved|changes|commented|pending, "at"}], "labels": [name],
     "milestone", "created", "updated", "commits", "stats": {"add", "del", "files"},
     "mergeable": {"status": ok|conflicts|blocked|checking|"", "reasons": [text]}, "approvals": {"have", "need"},
     "checks": [{"name", "status": passed|failed|running|skipped, "url", "note"}],
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


def normal(provider, mr_id, url, title, description, state, draft, author, source, target, sha, pipeline, files, threads, **more):
    """The one shape the page reads (see the module's docstring); `more` carries the fields a host could give besides."""
    out = {"provider": provider, "id": str(mr_id), "url": url, "title": title, "description": clip(description),
           "state": state, "draft": bool(draft), "author": author, "source": source, "target": target, "sha": sha,
           "pipeline": pipeline, "files": files, "threads": threads,
           "assignees": [], "reviewers": [], "labels": [], "milestone": "", "created": "", "updated": "", "commits": 0,
           "mergeable": {"status": "", "reasons": []}, "approvals": {"have": 0, "need": 0}, "checks": []}
    out.update(more)
    out["stats"] = more.get("stats") or {"add": sum(f.get("add", 0) for f in files), "del": sum(f.get("del", 0) for f in files), "files": len(files)}
    return out


def optional(run, args, many=False):
    """What a call that may be refused (a plan without it, a permission) answers, or None."""
    try:
        code, out, _ = run(args)
        if code != 0 or not str(out).strip():
            return None
        return loads_many(out) if many else json.loads(out)
    except (HostError, ValueError):
        return None


def names(items, *keys):
    """The names in a list of people or labels (strings, or dicts with one of these keys)."""
    out = []
    for v in items or []:
        n = v if isinstance(v, str) else next((str(v.get(k)) for k in keys if isinstance(v, dict) and v.get(k)), "")
        if n and n not in out:
            out.append(n)
    return out


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
    # who reviews, and who has approved (the approvals call is the paid tiers': tolerated when refused)
    appr = optional(run, ["api", f"{base}/approvals"])
    approved = names([(a or {}).get("user") if isinstance(a, dict) else a for a in (appr or {}).get("approved_by") or []], "username", "name")
    asked = names(mr.get("reviewers"), "username", "name")
    reviewers = [{"name": n, "state": "approved" if n in approved else "pending", "at": ""} for n in asked]
    reviewers += [{"name": n, "state": "approved", "at": ""} for n in approved if n not in asked]
    jobs = optional(run, ["api", "--paginate", f"projects/{urllib.parse.quote(project, safe='')}/pipelines/{pipe['id']}/jobs?per_page=100"], many=True) if pipe.get("id") else None
    checks = []
    for j in jobs or []:
        if isinstance(j, dict) and j.get("name"):
            st = {"success": "passed", "failed": "failed", "canceled": "failed", "running": "running", "pending": "running", "created": "running",
                  "waiting_for_resource": "running", "preparing": "running", "scheduled": "running"}.get(str(j.get("status")), "skipped")
            checks.append({"name": str(j["name"]), "status": st, "url": str(j.get("web_url") or ""),
                           "note": ("allowed to fail" if j.get("allow_failure") and st == "failed" else str(j.get("stage") or ""))})
    checks.sort(key=lambda c: {"failed": 0, "running": 1, "passed": 2}.get(c["status"], 3))
    dms = str(mr.get("detailed_merge_status") or mr.get("merge_status") or "")
    why = {"ci_must_pass": "The pipeline must pass.", "ci_still_running": "The pipeline is still running.", "conflict": "It has merge conflicts.",
           "discussions_not_resolved": "Comments are still unresolved.", "draft_status": "It is a draft.", "not_approved": "It needs approval.",
           "requested_changes": "Changes were requested.", "need_rebase": "The branch needs a rebase.", "blocked_status": "Another request blocks it.",
           "external_status_checks": "An external check is pending.", "not_open": "It is not open.", "approvals_syncing": "Approvals are syncing.",
           "jira_association_missing": "It needs a linked issue.", "commits_status": "Its commits are not allowed yet.",
           "merge_request_blocked": "Another request blocks it.", "title_regex": "Its title doesn't match the required pattern."}
    if mr.get("has_conflicts") or dms == "conflict":
        mergeable = {"status": "conflicts", "reasons": ["It has merge conflicts."]}
    elif dms in ("mergeable", "can_be_merged"):
        mergeable = {"status": "ok", "reasons": []}
    elif dms in ("checking", "unchecked", "preparing", "cannot_be_merged_recheck", ""):
        mergeable = {"status": "checking" if dms else "", "reasons": ["The host is still working it out."] if dms else []}
    else:
        mergeable = {"status": "blocked", "reasons": [why.get(dms, dms.replace("_", " ").capitalize() + ".")]}
    if mr.get("blocking_discussions_resolved") is False and mergeable["status"] == "ok":
        mergeable = {"status": "blocked", "reasons": ["Comments are still unresolved."]}
    need = (appr or {}).get("approvals_required") or 0
    return normal("gitlab", mr.get("iid"), url, str(mr.get("title") or ""), mr.get("description"), state,
                  mr.get("draft") or mr.get("work_in_progress"), person(mr.get("author")), str(mr.get("source_branch") or ""),
                  str(mr.get("target_branch") or ""), str(mr.get("sha") or ""), {"status": status, "url": str(pipe.get("web_url") or "")},
                  files, threads, assignees=names(mr.get("assignees"), "username", "name"), reviewers=reviewers,
                  labels=names(mr.get("labels"), "name"), milestone=str((mr.get("milestone") or {}).get("title") or "") if isinstance(mr.get("milestone"), dict) else "",
                  created=str(mr.get("created_at") or ""), updated=str(mr.get("updated_at") or ""), mergeable=mergeable,
                  approvals={"have": len(approved), "need": int(need or 0)}, checks=checks[:60],
                  diffRefs={k: str((mr.get("diff_refs") or {}).get(k) or "") for k in ("base_sha", "start_sha", "head_sha")}
                  if isinstance(mr.get("diff_refs"), dict) else {}), diffs


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
                             "number,title,body,state,isDraft,author,headRefName,baseRefName,url,headRefOid,statusCheckRollup,assignees,labels,milestone,"
                             "reviewRequests,latestReviews,reviewDecision,mergeable,mergeStateStatus,createdAt,updatedAt,commits"]), "the pull request") or "{}")
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
    checks = []
    for c in marks:
        raw = str(c.get("conclusion") or c.get("state") or c.get("status") or "").upper()
        st = ("failed" if raw in ("FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE") else
              "running" if raw in ("IN_PROGRESS", "QUEUED", "PENDING", "WAITING", "REQUESTED", "EXPECTED", "") else
              "passed" if raw in ("SUCCESS", "NEUTRAL") else "skipped")
        checks.append({"name": str(c.get("name") or c.get("context") or "check"), "status": st,
                       "url": str(c.get("detailsUrl") or c.get("targetUrl") or ""), "note": raw.lower().replace("_", " ")})
    checks.sort(key=lambda c: {"failed": 0, "running": 1, "passed": 2}.get(c["status"], 3))
    bad = any(c["status"] == "failed" for c in checks)
    busy = any(c["status"] == "running" for c in checks)
    pipe = {"status": "failed" if bad else "running" if busy else "passed" if checks else "", "url": ""}
    state = {"OPEN": "opened", "MERGED": "merged", "CLOSED": "closed"}.get(str(pr.get("state")), str(pr.get("state") or "").lower())
    # who reviews: the latest review of each person, then those still asked
    reviewers, seen = [], set()
    for r in pr.get("latestReviews") or []:
        who = person(r.get("author")) if isinstance(r, dict) else ""
        if who and who not in seen:
            seen.add(who)
            reviewers.append({"name": who, "state": {"APPROVED": "approved", "CHANGES_REQUESTED": "changes"}.get(str(r.get("state")), "commented"),
                              "at": str(r.get("submittedAt") or "")})
    for r in pr.get("reviewRequests") or []:
        who = person(r.get("requestedReviewer") if isinstance(r, dict) and r.get("requestedReviewer") else r) or (str(r.get("name") or r.get("slug") or "") if isinstance(r, dict) else "")
        if who and who not in seen:
            seen.add(who)
            reviewers.append({"name": who, "state": "pending", "at": ""})
    merge_state, can = str(pr.get("mergeStateStatus") or "").upper(), str(pr.get("mergeable") or "").upper()
    if can == "CONFLICTING" or merge_state == "DIRTY":
        mergeable = {"status": "conflicts", "reasons": ["It has merge conflicts."]}
    elif merge_state in ("CLEAN", "HAS_HOOKS") or (can == "MERGEABLE" and merge_state in ("", "UNSTABLE") and not bad):
        mergeable = {"status": "ok", "reasons": []}
    elif merge_state == "BEHIND":
        mergeable = {"status": "blocked", "reasons": ["The branch is behind its base."]}
    elif merge_state == "DRAFT":
        mergeable = {"status": "blocked", "reasons": ["It is a draft."]}
    elif merge_state == "UNSTABLE":
        mergeable = {"status": "blocked", "reasons": ["Some checks failed."]}
    elif merge_state == "BLOCKED":
        mergeable = {"status": "blocked", "reasons": ["Required reviews or checks are missing."]}
    else:
        mergeable = {"status": "checking" if (can or merge_state) else "", "reasons": ["The host is still working it out."] if (can or merge_state) else []}
    return normal("github", pr.get("number"), str(pr.get("url") or ""), str(pr.get("title") or ""), pr.get("body"), state,
                  pr.get("isDraft"), person(pr.get("author")), str(pr.get("headRefName") or ""), str(pr.get("baseRefName") or ""),
                  str(pr.get("headRefOid") or ""), pipe, files, threads, assignees=names(pr.get("assignees"), "login", "name"), reviewers=reviewers,
                  labels=names(pr.get("labels"), "name"), milestone=str((pr.get("milestone") or {}).get("title") or "") if isinstance(pr.get("milestone"), dict) else "",
                  created=str(pr.get("createdAt") or ""), updated=str(pr.get("updatedAt") or ""), mergeable=mergeable,
                  approvals={"have": sum(1 for r in reviewers if r["state"] == "approved"), "need": 0}, checks=checks[:60],
                  commits=len(pr.get("commits") or [])), diffs


# ---------------------------------------------------------------- the open requests that involve me (the inbox)
# Slim records, one per request, for the Merge requests page's list (no threads, no diff):
#
#     {"id", "url", "title", "author", "draft", "source", "target", "updated", "sha", "notes": <comment count>,
#      "roles": [author|reviewer|assignee|mentioned], "asked": <a review is asked of me / a to-do waits for me>,
#      "reviewers": [name], "conflicts": bool}
#
# Only list calls: a poll costs a handful of CLI calls and no model at all.

ROLES = ("author", "reviewer", "assignee", "mentioned")
MAX_LIST = 100


def me_gitlab(run):
    got = json.loads(must(run(["api", "user"]), "who you are on GitLab") or "{}")
    who = str((got or {}).get("username") or "") if isinstance(got, dict) else ""
    if not who:
        raise HostError("GitLab didn't say who you are: sign in with glab auth login")
    return who


def me_github(run):
    who = must(run(["api", "user", "--jq", ".login"]), "who you are on GitHub").strip()
    if not who:
        raise HostError("GitHub didn't say who you are: sign in with gh auth login")
    return who


def slim(mr_id, url, title, author, draft, source, target, updated, sha, notes, reviewers, conflicts=False):
    return {"id": str(mr_id), "url": str(url or ""), "title": str(title or "")[:300], "author": author, "draft": bool(draft),
            "source": str(source or ""), "target": str(target or ""), "updated": str(updated or ""), "sha": str(sha or ""),
            "notes": int(notes or 0), "roles": [], "asked": False, "reviewers": reviewers, "conflicts": bool(conflicts)}


def list_gitlab(run, project, me=""):
    """(me, [slim record]) of the open merge requests in the project that involve me: mine, the ones I review
    or am assigned, and the ones a pending to-do of mine points at (a mention, a review asked)."""
    me = me or me_gitlab(run)
    base = f"projects/{urllib.parse.quote(project, safe='')}/merge_requests?state=opened&scope=all&per_page={MAX_LIST}"
    who = urllib.parse.quote(me, safe="")
    found = {}

    def take(items, role):
        for m in items:
            if not isinstance(m, dict) or not str(m.get("iid") or "").isdigit():
                continue
            if str(m.get("state") or "opened") not in ("opened", "locked"):
                continue
            iid = str(m["iid"])
            if iid not in found:
                found[iid] = slim(iid, m.get("web_url"), m.get("title"), person(m.get("author")), m.get("draft") or m.get("work_in_progress"),
                                  m.get("source_branch"), m.get("target_branch"), m.get("updated_at"), m.get("sha"), m.get("user_notes_count"),
                                  names(m.get("reviewers"), "username", "name"), m.get("has_conflicts"))
            if role and role not in found[iid]["roles"]:
                found[iid]["roles"].append(role)
            if role == "reviewer":
                found[iid]["asked"] = True

    take(loads_many(must(run(["api", f"{base}&author_username={who}"]), "your merge requests")), "author")
    take(loads_many(must(run(["api", f"{base}&reviewer_username={who}"]), "the merge requests you review")), "reviewer")
    take(loads_many(must(run(["api", f"{base}&assignee_username={who}"]), "the merge requests assigned to you")), "assignee")
    todos = optional(run, ["api", "todos?state=pending&type=MergeRequest&per_page=100"], many=True) or []
    for t in todos:
        if not isinstance(t, dict) or str((t.get("project") or {}).get("path_with_namespace") or "").lower() != project.lower():
            continue
        target = t.get("target") if isinstance(t.get("target"), dict) else {}
        take([target], "mentioned" if t.get("action_name") in ("mentioned", "directly_addressed") else "")
        iid = str(target.get("iid") or "")
        if iid in found:
            found[iid]["asked"] = True
    out = sorted(found.values(), key=lambda r: r["updated"], reverse=True)[:MAX_LIST]
    for r in out:
        if r["author"] == me and "author" not in r["roles"]:
            r["roles"].insert(0, "author")
    return me, out


GH_LIST = "number,title,author,isDraft,headRefName,baseRefName,updatedAt,headRefOid,url,reviewRequests,assignees,comments,mergeable"


def list_github(run, owner, name, me=""):
    """(me, [slim record]) of the open pull requests in the repository that involve me."""
    me = me or me_github(run)
    repo = f"{owner}/{name}"
    found = {}

    def take(items, role):
        for p in items:
            if not isinstance(p, dict) or not str(p.get("number") or "").isdigit():
                continue
            n = str(p["number"])
            if n not in found:
                asked = [person(r.get("requestedReviewer") if isinstance(r, dict) and r.get("requestedReviewer") else r) for r in p.get("reviewRequests") or []]
                found[n] = slim(n, p.get("url"), p.get("title"), person(p.get("author")), p.get("isDraft"), p.get("headRefName"),
                                p.get("baseRefName"), p.get("updatedAt"), p.get("headRefOid"), len(p.get("comments") or []),
                                [a for a in asked if a], str(p.get("mergeable") or "").upper() == "CONFLICTING")
                if found[n]["author"] == me:
                    found[n]["roles"].append("author")
                if me in names(p.get("assignees"), "login", "name"):
                    found[n]["roles"].append("assignee")
            if role and role not in found[n]["roles"]:
                found[n]["roles"].append(role)
            if role == "reviewer":
                found[n]["asked"] = True

    args = ["pr", "list", "-R", repo, "--state", "open", "--limit", str(MAX_LIST), "--json", GH_LIST, "--search"]
    take(loads_many(must(run(args + ["involves:@me"]), "the pull requests that involve you")), "")
    take(loads_many(must(run(args + ["review-requested:@me"]), "the pull requests waiting for your review")), "reviewer")
    for r in found.values():
        if not r["roles"]:
            r["roles"].append("mentioned")
    return me, sorted(found.values(), key=lambda r: r["updated"], reverse=True)[:MAX_LIST]
