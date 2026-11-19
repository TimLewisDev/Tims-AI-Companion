---
name: mr-change
description: >
  Make the code changes a person chose from the review comments on their merge
  request. Reads the chosen comments and what was recommended for each from the
  changes file Tatty wrote, makes only those changes on the branch with the
  smallest coherent diff, records what happened to each comment, and never
  stages, commits, pushes, replies to a comment or resolves a thread. Tatty
  starts this from a feature's Merge request page and writes the facts
  (feature, repository, branch, the changes file, the state file and the script)
  after the command. Use when a message starts with /tatty:mr-change.
argument-hint: "Context from Tatty: Feature: … Repository: … Branch: … Changes: … State: … Script: …"
metadata:
  version: "1.0"
---

# mr-change

A reviewer commented on the person's merge request. They looked at each comment
(an agent read the code and recommended what to do) and ticked the ones to
change. You make those changes, and only those. The person commits them
afterwards from Tatty's Commit page, and replies to the reviewer themselves.

## What you are given

After the command, Tatty writes lines under `Context from Tatty:`:

- `Feature`, `Folder`: the feature and its folder of documents.
- `Repository`: the git repository, which is where this session runs.
- `Branch`: the branch the merge request is from, which the changes go on.
- `Changes`: a Markdown file with one section per comment to change: where it
  is, what the reviewer wrote, and what was recommended (the action, why, and
  the change planned, with the files it touches).
- `State`: the state file the outcomes are recorded in.
- `Script`: the path of `mrstate.sh`, the only thing that writes the state file.

If there is no context, say this is started from a feature's Merge request page
in Tatty and stop.

## Rules

- **Only what was chosen.** No scope expansion, no opportunistic refactors, no
  new dependencies, no placeholders. The recommendation is where to start, not
  an order: read the code yourself, and if the reviewer's point turns out to be
  wrong, or the change would do harm, do not make it: record `blocked` with why.
- **The smallest coherent diff.** Follow the repository's own style, its
  `AGENTS.md` / `CLAUDE.md` and its tests.
- **Never stage, commit, push or switch branches.** Never reply to, resolve or
  otherwise touch the review thread on the host: replies are the person's.
- **No thread or comment IDs, no reviewer names and no "per review" notes** in
  code, comments, tests or commit-style text.
- **Ask, don't guess**, when a comment can be read two ways and the code can't
  say which.
- Never edit the state file by hand.

## Steps

1. **Check the place.** `git branch --show-current` should be `Branch`. If not,
   say so and ask before doing anything.
2. **Read the changes file.** For each comment there is an ID in its heading.
3. **Make each change**, one comment at a time. After each:
   - done: `bash "<Script>" result "<State>" <id> applied "<what changed, in a line>"`
   - not done on purpose (the comment is mistaken, or already handled):
     `... skipped "<why>"`
   - could not be done (needs a decision, conflicts, a test fails for a reason
     you can't fix here): `... blocked "<why>"`
   With more than about three comments, use subagents for the independent ones.
4. **Run the repository's own checks** that apply (its build or tests for what
   you touched). Say what you ran and what it said; do not hide a failure.
5. **Report**: per comment, the outcome and the files touched, then that the
   changes are in the working tree, uncommitted, and the next step is the Commit
   page in Tatty, after which the replies can be sent.
