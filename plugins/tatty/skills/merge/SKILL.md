---
name: merge
description: >
  Walk the person through getting a finished workflow's work into a pull / merge
  request: look at what changed on the branch, commit it, push it and open the
  request, asking before every git write. Tatty starts this from a feature's
  Review step, once the review is done (the branch reviewed, its suggestions
  decided and the changes committed), and writes the facts (feature,
  repository, branch, base, host) after the command. Works in any repository
  and on GitHub or GitLab; it uses the project's own commit and request skills
  and rules when it has them. Never force-pushes and never merges the request
  unless asked. Use when a message starts with /tatty:merge.
argument-hint: "Context from Tatty: Feature: … Branch: …"
metadata:
  version: "1.0"
---

# merge

The build of a feature is done and validated, and its branch has been reviewed. The person wants its work in a
pull / merge request, and not lost or half-committed. You guide them there, one
step at a time. They run the workflow; you are the helper at its last step.

## What you are given

After the command, Tatty writes lines under `Context from Tatty:`:

- `Feature`, `Folder`: the feature and its folder of documents (Ticket, Task
  Status, Plan, ...). Read what you need to say what the change is for.
- `Repository`: the git repository the work is in.
- `Branch`: the branch made for this workflow. `Base`: the branch it was made
  from (it may be empty).
- `Host`: `gitlab`, `github`, or empty when unknown.
- `Request`: the link to an existing request from the branch, if there is one.

If there is no context, say this is started from a feature's Review step in
Tatty, then work from the current directory and ask what branch they mean.

## Rules

- **Ask before every git write**: staging, committing, pushing, creating or
  editing the request. Say exactly what you will run, then wait for a yes.
  Reading (status, diff, log, remote) needs no asking.
- Never force-push, never rewrite history, never delete a branch, never merge
  the request, and never change files other than to commit them, unless the
  person asks for it.
- Follow the project: its `AGENTS.md` / `CLAUDE.md`, its commit-message and
  request-title format, and any skills it has for committing or opening a
  request (look at the skills listed to you; if one fits, offer to use it
  rather than do the same steps by hand). The project's rules about
  attribution lines in commits and requests win over any default of yours.
- Keep the project's names out of your own wording: describe the change in the
  words of its documents.

## Steps

1. **Where it stands.** Check you are on `Branch` (`git branch --show-current`);
   if not, say so and ask before switching. Show `git status` and a
   `git diff --stat` against `Base` (or the repo's default branch when `Base`
   is empty). If `Request` is set, say that a request already exists and go to
   step 5.
2. **Look it over.** Summarise the change in a few lines from the feature's
   documents. Name anything that looks unrelated to it (stray files, local
   settings, generated or large binary files, secrets) and ask what to do with
   each. Do not decide for them.
3. **Commit.** Show the files to be staged and propose a commit message in the
   repository's own style (read the last commits). On a yes, stage those files
   and commit. If the work is already committed, say so and move on. (The Review step's
   changes are committed from Tatty's Commit page, so by now there is usually nothing left.)
4. **Push.** Propose `git push -u origin <Branch>`. On a yes, run it and show the
   result. If the push is rejected, explain why and offer options; do not force.
5. **Open the request.** By `Host`: GitLab with `glab mr create`, GitHub with
   `gh pr create`, or the project's connected tool / skill; when the command is
   missing or not signed in, give the person the title and description and the
   web link to open it. Propose the title (the project's format) and a
   description built from the feature's documents: why, what changed, how to
   test. Show it and ask before creating it.
6. **Tell Tatty.** Show the request's link. Tell the person to press **Check now**
   on the feature's page in Tatty (Tatty looks for the request itself with
   `glab` / `gh`), or **I opened the request** with the link if that doesn't
   find it. Tatty then moves the ticket or task to In Review. Moving it on to QA
   or Done once it is reviewed is theirs to do.

If the person stops at any step, say where things stand (what is committed,
pushed, opened) so the next session can pick it up from there.
