---
name: review
description: >
  Review a feature's branch and turn the findings into Review Suggestions, each
  with options for how to resolve it, for the person to decide on one at a time in
  Tatty. Runs the toolbox's tt-branch-review, reads its report, and writes a
  suggestions document only through Tatty's suggestions.sh. Reads the repository
  and changes nothing in it. Tatty starts this from a feature's Review step, after
  the build is complete, and writes the facts (feature, repository, branch, the
  document and the script) after the command. Use when a message starts with
  /tatty:review.
argument-hint: "Context from Tatty: Feature: … Repository: … Branch: … Document: … Script: …"
metadata:
  version: "1.0"
---

# review

A feature's build is done. Before its work goes into a request, its branch is
reviewed, the person decides what to do about each finding, and the changes they
choose are made. You do the first part: review the branch and prepare the
decisions. The person decides; another session makes the changes.

## What you are given

After the command, Tatty writes lines under `Context from Tatty:`:

- `Feature`, `Folder`: the feature and its folder of documents. Read what you
  need to say what the change is for.
- `Repository`: the git repository to review, which is where this session runs.
- `Branch`: the branch to review, or "(the branch that is checked out)".
- `Against`: the branch to compare with, when the person chose one.
- `Document`: the path of the Review Suggestions document to write.
- `Script`: the path of `suggestions.sh`, the only thing that writes it.

If there is no context, say this is started from a feature's Review step in
Tatty and stop.

## Rules

- **Read-only.** Change nothing in the repository, and stage and commit nothing.
- **Never write the document by hand.** Every change to it goes through `Script`
  (`bash "<Script>" ...`), so its layout never varies. Do not edit it with the
  file tools.
- **Never decide for the person.** Options are proposals; the person chooses on
  Tatty's Review page. Do not drop, merge or soften a finding: every finding in
  the report gets a suggestion.
- **Options are real alternatives**, not boilerplate: what would be done, and
  what it costs or risks. Each must make sense on its own, because the person
  reads only that.
- One bounded task per response: write at most five suggestions per `add` call.
- Keep the project's names out of your own wording: describe things in the
  words of the findings.

## Steps

1. **Check where you are.** `git rev-parse --show-toplevel` should be
   `Repository`. If not, say so and stop.
2. **Uncommitted changes.** Run `git status --porcelain`. A review reads commits
   only, so uncommitted changes are not part of it. If there are any, say so and
   ask: continue anyway, or stop so they can be committed first (Tatty's Commit
   page does that). Stop if they say stop.
3. **An earlier review.** If `Document` already exists, run
   `bash "<Script>" status "<Document>"`. If its status is not Done, ask whether
   to start the suggestions again (the old document is kept in the feature's
   `.tt` folder) or stop. If it is Done, say that it was reviewed and ask the same.
4. **Run the review.** Use the Skill tool to run `tt-branch-review` with the
   arguments `<Branch>` (leave it out when it is "(the branch that is checked
   out)") and `against <Against>` when given. Let it run as it normally does,
   including the questions it asks about the base. If the skill is not
   available, say the toolbox's engineering plugin is needed and stop.
5. **Find the report.** The skill's closing message names the `Review.md` it
   wrote. If it does not, run its `scripts/resolve-branch.sh` (under
   `~/.claude/tt-plugins/engineering/skills/tt-branch-review/`) with the same
   arguments and `--repo "<Repository>"`; the report is
   `${TMPDIR:-/tmp}/tt-branch-review/<slug>/Review.md`. If it is not there, ask
   the person where it is. Note the branch, the base and the head commit the
   review used (`branch`, `base`, `head` from that script, or `git rev-parse`).
   Read the whole report.
6. **No findings.** If the report has no findings, create the document and mark
   it done, tell the person the branch has nothing to change, and stop:
   ```
   bash "<Script>" init "<Document>" --repo "<Repository>" --branch "<branch>" --base "<base>" --head "<head>" --report "<report>"
   bash "<Script>" done "<Document>"
   ```
7. **Create the document**, with `--replace` if the person chose to start again:
   ```
   bash "<Script>" init "<Document>" --repo "<Repository>" --branch "<branch>" --base "<base>" --head "<head>" --report "<report>"
   ```
8. **Write the suggestions**, in the report's order, one per finding. A quoted
   heredoc keeps the text as written; `---` separates suggestions:
   ```
   bash "<Script>" add "<Document>" <<'EOF'
   summary: <the finding in one sentence>
   severity: critical | major | minor | nit
   dimension: <correctness, security, ...>
   where: <path:line>
   finding: <the report's detail, in a few lines>
     <more lines are indented by two spaces>
   option: A | <short title> | <what is done, and what it costs> | recommended
   option: B | <another way> | <what is done, and what it costs>
   ---
   summary: ...
   EOF
   ```
   - `A` is the fix the report suggests, said in words (a short snippet is fine
     in the detail; do not paste whole files), and is marked `recommended`
     unless leaving it as it is is the better answer for a minor finding.
   - Give a second option when there is a different reasonable way, with its
     trade-off. Two to four options in all.
   - "Leave as is" is added as the last option for you; write it yourself
     (a title beginning "Leave", with the reason it can be acceptable) when
     there is a real reason.
   - Say in `finding` when the review was unsure of a finding, and never
     make it sound surer than the report did.
9. **Check and tell.** Run `bash "<Script>" check "<Document>"` and `status`.
   Tell the person how many suggestions there are, by severity, and that they
   now decide on them one at a time on the feature's Review page in Tatty;
   then the changes they choose are made, and they commit them. Nothing in the
   repository has been changed. Stop there.

If the person stops partway, say how many suggestions were written so far. Start
again from Tatty's Review step to continue: it writes the rest.
