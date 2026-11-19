---
name: apply-review
description: >
  Make the changes a person chose for a branch's review suggestions. Reads their
  decisions from the Review Suggestions document, makes only those changes on the
  branch with the smallest coherent diff, records what happened to each
  suggestion, and never stages or commits. Tatty starts this from a feature's
  Review step once every suggestion is decided, and writes the facts (feature,
  repository, branch, the document and the script) after the command. Use when a
  message starts with /tatty:apply-review.
argument-hint: "Context from Tatty: Feature: … Repository: … Branch: … Document: … Script: …"
metadata:
  version: "1.0"
---

# apply-review

A branch was reviewed and the person has decided what to do about each finding.
You make those changes, and only those. The person commits them afterwards.

## What you are given

After the command, Tatty writes lines under `Context from Tatty:`:

- `Feature`, `Folder`: the feature and its folder of documents.
- `Repository`: the git repository, which is where this session runs.
- `Branch`: the branch that was reviewed, which the changes go on.
- `Document`: the Review Suggestions document, with the findings, the options
  and the decisions.
- `Script`: the path of `suggestions.sh`, the only thing that writes the document.
- `Reviewed head`: the commit the review looked at.

If there is no context, say this is started from a feature's Review step in
Tatty and stop.

## Rules

- **Only what was chosen.** No scope expansion, no opportunistic refactors, no
  new dependencies, no placeholders. A decision to leave something as it is means
  you leave it.
- **Never stage, commit, push, branch or switch branches.** The person commits
  from Tatty's Commit page.
- **Follow the repository:** its `AGENTS.md` / `CLAUDE.md`, its style and its
  checks. Make the smallest coherent diff.
- **No review or planning IDs in code, comments or tests.** `RS01` and the like
  belong to the document only. When
  `~/.claude/tt-plugins/core/skills/tt-common/scripts/check-planning-ids.sh`
  exists, run it on the files you changed before finishing.
- **Do not guess.** If a decision is unclear, conflicts with the code as it is,
  or would need a choice that is the person's, ask them in this session (a
  question with the options and your recommendation) and wait. Do not resolve it
  yourself. If it still cannot be done, record it as blocked with the reason.
- **Never write the document by hand.** Only `bash "<Script>" ...`.
- One bounded task per response; write one file at a time.

## Steps

1. **Check where you are.** `git rev-parse --show-toplevel` should be
   `Repository` and `git branch --show-current` should be `Branch`. If not, say so
   and stop: do not switch branches.
2. **Read the decisions.** `bash "<Script>" list "<Document>" --tsv`. Its columns are
   id, severity, where, dimension, summary, decision, the chosen option's title,
   its detail, the person's note, and the result so far. Read the document for
   each finding's full text. A decision `Other: ...` is the person's own words:
   treat them as the instruction.
3. **Sort them.**
   - Result already `Applied`, `Skipped` or `Blocked`: done, leave it (this
     session may be a restart).
   - The chosen option is one of leaving it as it is (its title begins "Leave"),
     or the person's own words say to leave it: record it and go on:
     `bash "<Script>" result "<Document>" RS03 skipped "left as it is, by choice"`.
   - Everything else is a change to make.
4. **Say the plan** in a few lines (each id and the change to make). The
   decisions are made, so you need not wait for a yes.
5. **Make the changes.** For each, read the code first, then make the change the
   chosen option describes, and record it as soon as it is done:
   `bash "<Script>" result "<Document>" RS01 applied "<what changed, in which file>"`.
   When it cannot be done: `... blocked "<why>"`, and go on to the next.
   With more than about three changes, group them by file and run one subagent
   per group, in the foreground, at most two changing code at once, using the
   model and effort from
   `bash ~/.claude/tt-plugins/core/skills/tt-common/scripts/model-config.sh get coder`
   (a `-` means leave it out). Give each subagent short instructions: the
   document's path, its ids, these rules, and the script to record results.
6. **Check the work.** Run the repository's own checks the way its `AGENTS.md` /
   `CLAUDE.md` say (at least a compile or lint check). Fix what your changes broke;
   report what was already failing.
7. **Finish.** `bash "<Script>" finish "<Document>"` (it needs every suggestion decided). Then
   tell the person: how many were applied, skipped and blocked (with the reason
   for each blocked one), and the files changed (`git status --short`). Say that
   nothing is committed, and that the feature's page in Tatty now offers the
   Commit page.

If the person stops partway, what is recorded stays. Start this again from the
Review step in Tatty and it carries on with the suggestions that have no result yet.
