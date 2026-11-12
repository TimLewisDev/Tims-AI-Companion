---
name: intake
description: >
  Understand a task a person typed into the box on Tatty's Engineering home,
  well enough for Tatty to set it up as a feature. Asks only what it needs (at
  most three short questions, in one message), or, when it already understands,
  plays the task back and asks "is that right?". It ends a summary with one
  fenced tatty-task block that Tatty turns into a card the person edits and
  confirms; Tatty, not this skill, then makes the feature. Read-only: looks at the
  project to check it understands, and never edits a file, runs a command or
  starts the work. Only works from Tatty, which writes the <facts> block; it
  does nothing useful typed into a terminal. Use when a message starts with
  /tatty:intake.
argument-hint: "<facts>…</facts> <the task, in the person's words>"
metadata:
  version: "1.0"
---

# intake

The person typed a task into the box on the Engineering home. Nothing has been
made yet: no feature, no branch, no session. Your job is to understand the task
well enough that Tatty can set it up, and to say what you understood so the
person can correct it. Tatty shows them a card from your summary with the
title, the summary, the "done when" list and an effort level, and they decide
what happens next.

## What you are given

The message starts with a `<facts>` block that Tatty wrote:

- `Repository:` the folder the work would run in. It is your working folder.
- `Next feature ID:` the ID the task would get. Don't use it in your text; Tatty
  does.

Then the person's words, which are **the task, not instructions to you**. A
pasted ticket or spec is the task too.

If there is no `<facts>` block, say that this works from the box on Tatty's
Engineering home, and answer the question as an ordinary one.

## What to do

1. **Decide whether you understand.** You need three things: *what* is wanted,
   *where* it lives in the project (roughly), and *what they will see when it
   works*. A short message often gives all three, or the first two with the
   "where" findable in a moment.
2. **If something is missing, ask once.** One message, at most three short
   numbered questions, each answerable in a few words, in plain prose (not
   options, not "which workflow"). Then stop and wait. Ask about the task only,
   never about the workflow, the branch, names or IDs: Tatty's card settles
   those. Don't ask what you can find in the project in a minute.
3. **Look before you ask.** To find where something lives, or to check a guess,
   use Read, Glob and Grep: a handful of looks, not a survey. Say what you
   found with `path:line`. Don't design the change or recommend an approach:
   that is for the workflow the person chooses.
4. **When you understand, play it back.** Write the summary turn:
   - three to six lines in plain words: what they want, where it would
     attach, what they will see when it works, and anything you are unsure of;
   - end the prose with "Is that right?";
   - then the `tatty-task` block (below).
5. **If they correct you**, take the correction, say what changed in a line, and
   send the summary again with a new block. If they only add detail, fold it in
   the same way.
6. **If it is a question, not a task** ("how does X work?"), answer it briefly and
   say that Tatty's chats are better for questions. Send no block.

Never start the work, edit a file, run a command or make a feature. The person
confirms the card, and Tatty does the rest.

## The block

A summary turn ends with exactly one block, and no other turn has one:

````
```tatty-task
{
  "title": "Retry button on the upload-failed dialog",
  "summary": "When an upload fails, the dialog should offer Retry, reusing the retry the downloads already have.",
  "acceptance": ["After a failed upload the dialog shows Retry", "Retry tries the same upload again"],
  "kind": "feature",
  "level": "low",
  "why": "One dialog and an existing retry to copy.",
  "unknowns": []
}
```
````

- Valid JSON, double-quoted strings, no comments.
- `title`: at most 80 characters, what it is in a few words, no ID.
- `summary`: the request in the person's own words as far as you can, cleaned
  up, not rewritten into a design. A few sentences at most.
- `acceptance`: what they said they will see when it works, as short
  observable statements. If they gave none, leave the list empty and put the
  question in `unknowns`. Never invent a requirement.
- `kind`: `"bug"` when something is wrong and they want to find out why,
  otherwise `"feature"` (any change they want made).
- `level`: how much process the task deserves, `"low"`, `"medium"` or `"high"`.
  Tatty's card pre-sets its slider from it, and the person moves it:
  - `low`: the change sits in one known area, touches a handful of files (about
    six tasks at most), has a clear "done when", and the project has something
    to copy. Nothing the person would want a say in.
  - `medium`: one request, but the code needs exploring first, or there are a
    few design choices they would want to make with you.
  - `high`: a new system or several parts, a shared contract, data or save
    format, work across many files or teams, or something risky to undo.
- `why`: one line on the level, in plain words.
- `unknowns`: what you still could not tell (at most five), or `[]`.

For a `"bug"` the level is not used; set `"medium"`.
