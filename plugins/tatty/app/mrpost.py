"""Writing to a merge / pull request's host, for the Merge requests page: the only module that does.

Nothing here runs on its own. The server builds a list of actions from what the person queued on the page
(`plan`), shows them exactly as they will be sent, and only after the person confirms that same list (its hash)
runs them (`send`). `run(args, data)` is the server's: the host's CLI (glab or gh) as argv with no shell, with
`data` (a JSON body) on its standard input.

The actions, one shape whatever the host:

    {"type": "comment", "cid", "path", "line", "oldLine", "side": new|old|both, "body"}   a new comment on a line
    {"type": "note", "cid", "body"}                                                   a new general comment
    {"type": "reply", "tid", "body"}                                                  a reply on a thread
    {"type": "resolve", "tid", "on": true|false}                                      resolve or reopen a thread

New comments are sent together as one review (GitLab: draft notes then one bulk publish; GitHub: one review with
the comments in it), so the author gets one notification, not one per comment. Nothing here approves or merges.
"""
import hashlib
import json
import urllib.parse

from mrhost import HostError, must

TYPES = ("comment", "note", "reply", "resolve")
MAX_BODY = 20000


def digest(actions):
    """The hash the page confirms: of exactly what will be sent, in order."""
    return hashlib.sha256(json.dumps(actions, sort_keys=True, ensure_ascii=True).encode("ascii")).hexdigest()[:24]


def in_diff(hunks, line, side):
    """True when the line is one the diff shows (so a host takes a comment on it)."""
    if not line:
        return False
    for h in hunks:
        o, n = h["oldStart"], h["newStart"]
        for ln in h["lines"]:
            k = ln[:1]
            if k == " ":
                if (side == "old" and o == line) or (side != "old" and n == line):
                    return True
                o, n = o + 1, n + 1
            elif k == "-":
                if side == "old" and o == line:
                    return True
                o += 1
            elif k == "+":
                if side != "old" and n == line:
                    return True
                n += 1
    return False


def where(a):
    return f"`{a['path']}:{a.get('line') or a.get('oldLine') or ''}`"


# ---------------------------------------------------------------- GitLab

def gitlab_send(run, project, iid, actions, refs):
    """Send the actions to a GitLab merge request. [(action, ok, what happened)]."""
    base = f"projects/{urllib.parse.quote(project, safe='')}/merge_requests/{iid}"
    done = []
    news = [a for a in actions if a["type"] in ("comment", "note")]
    drafted = []
    for a in news:
        body = {"note": a["body"]}
        if a["type"] == "comment" and refs.get("head_sha"):
            pos = {"position_type": "text", "base_sha": refs.get("base_sha", ""), "start_sha": refs.get("start_sha", ""),
                   "head_sha": refs["head_sha"], "new_path": a["path"], "old_path": a.get("oldPath") or a["path"]}
            if a.get("side") in ("new", "both") and a.get("line"):
                pos["new_line"] = int(a["line"])
            if a.get("side") in ("old", "both") and a.get("oldLine"):
                pos["old_line"] = int(a["oldLine"])
            body["position"] = pos
        try:
            got = json.loads(must(run(["api", "--method", "POST", f"{base}/draft_notes", "-H", "Content-Type: application/json", "--input", "-"],
                                      json.dumps(body)), "a draft comment") or "{}")
            drafted.append((a, str((got or {}).get("id") or "")))
        except (HostError, ValueError) as e:
            done.append((a, False, str(e)))
    if drafted:
        try:
            must(run(["api", "--method", "POST", f"{base}/draft_notes/bulk_publish"], None), "publishing the review")
            done += [(a, True, hid) for a, hid in drafted]
        except HostError as e:
            done += [(a, False, f"{e} (left as your drafts on GitLab)") for a, _ in drafted]
    for a in actions:
        try:
            if a["type"] == "reply":
                got = json.loads(must(run(["api", "--method", "POST", f"{base}/discussions/{urllib.parse.quote(a['tid'], safe='')}/notes",
                                           "-H", "Content-Type: application/json", "--input", "-"], json.dumps({"body": a["body"]})), "the reply") or "{}")
                done.append((a, True, str((got or {}).get("id") or "")))
            elif a["type"] == "resolve":
                must(run(["api", "--method", "PUT", f"{base}/discussions/{urllib.parse.quote(a['tid'], safe='')}",
                          "-H", "Content-Type: application/json", "--input", "-"], json.dumps({"resolved": bool(a["on"])})), "resolving the thread")
                done.append((a, True, ""))
        except (HostError, ValueError) as e:
            done.append((a, False, str(e)))
    return done


# ---------------------------------------------------------------- GitHub

REPLY_GQL = ("mutation($thread:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$thread,body:$body})"
             "{comment{id}}}")
RESOLVE_GQL = "mutation($thread:ID!){%s(input:{threadId:$thread}){thread{id isResolved}}}"


def github_send(run, owner, name, number, actions, sha, review_threads):
    """Send the actions to a GitHub pull request. review_threads: the ids of the threads that are review threads
    (a reply to any other is a new comment on the conversation). [(action, ok, what happened)]."""
    repo = f"{owner}/{name}"
    done = []
    news = [a for a in actions if a["type"] in ("comment", "note")]
    if news:
        comments = [{"path": a["path"], "line": int(a["line"] if a.get("side") != "old" else a["oldLine"]),
                     "side": "LEFT" if a.get("side") == "old" else "RIGHT", "body": a["body"]} for a in news if a["type"] == "comment"]
        general = "\n\n---\n\n".join(a["body"] for a in news if a["type"] == "note")
        body = {"event": "COMMENT", "body": general, "comments": comments}
        if sha:
            body["commit_id"] = sha
        try:
            got = json.loads(must(run(["api", "--method", "POST", f"repos/{repo}/pulls/{number}/reviews", "--input", "-"], json.dumps(body)),
                                  "the review") or "{}")
            done += [(a, True, str((got or {}).get("id") or "")) for a in news]
        except (HostError, ValueError) as e:
            done += [(a, False, str(e)) for a in news]
    for a in actions:
        try:
            if a["type"] == "reply" and a["tid"] in review_threads:
                must(run(["api", "graphql", "-f", "query=" + REPLY_GQL, "-f", f"thread={a['tid']}", "-f", f"body={a['body']}"], None), "the reply")
                done.append((a, True, ""))
            elif a["type"] == "reply":
                must(run(["api", "--method", "POST", f"repos/{repo}/issues/{number}/comments", "--input", "-"], json.dumps({"body": a["body"]})), "the comment")
                done.append((a, True, ""))
            elif a["type"] == "resolve":
                op = "resolveReviewThread" if a["on"] else "unresolveReviewThread"
                must(run(["api", "graphql", "-f", "query=" + RESOLVE_GQL % op, "-f", f"thread={a['tid']}"], None), "resolving the thread")
                done.append((a, True, ""))
        except HostError as e:
            done.append((a, False, str(e)))
    return done
