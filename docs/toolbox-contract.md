# What Tatty takes from the TT toolbox

Tatty is a companion to the [TT toolbox](https://github.com/TimLewisDev/Tims-AI-Toolbox):
a user interface over its workflow, never part of it. The dependency runs one
way:

- **Tatty reads the toolbox.** It reads the toolbox's documents and records and
  runs a few of its scripts, read-only. It writes a document only on a
  person's action: a feature's document when it is saved in Edit mode (see
  below), a ticket's document into a new feature folder made for it on Start
  workflow (see "Jira"), a task's document into a new feature folder made for
  it on Start workflow (see "Tasks"), and a User Stories document, through the toolbox's own
  `stories.sh`, when a person changes a story on the board (see "User
  Stories"). It can also ask Claude Code to install one of the toolbox's
  discipline plugins, on a person's click (see below); that is Claude Code's
  doing, and changes nothing of the toolbox's.
- **The toolbox never knows about Tatty.** Nothing in the toolbox calls Tatty,
  checks for it or waits for it. Every skill works the same with or without
  Tatty installed.

Everything Tatty relies on is listed here. These are the toolbox's public
interfaces: its scripts' command lines and its files on disk. A change to one of
them is a change Tatty has to follow, and the tests in `tools/test-tatty.sh` run
against a real toolbox to catch it.

## Depending on the toolbox

As a plugin, Tatty declares a dependency on the toolbox's `core` plugin, from
the toolbox's own marketplace. It is
`{ "name": "core", "marketplace": "tims-ai-toolbox" }`, in this repo's
`.claude-plugin/marketplace.json` (with `allowCrossMarketplaceDependenciesOn`)
and in `plugins/tatty/.claude-plugin/plugin.json`.
- Installing Tatty installs `core` when it's missing.
- Without the toolbox's marketplace, the install is refused.
- The dependency goes one way only: the toolbox names nothing of Tatty's.

## Finding the toolbox

Tatty looks in this order (`toolbox_core()` in `plugins/tatty/app/server.py`):

1. `TATTY_TOOLBOX`, if set. It names a toolbox checkout (`plugins/core/skills/…`
   under it), or a core plugin folder (`skills/…`), or a core skills folder.
   Use it for development and tests.
2. The toolbox's own pointer folder,
   `${TT_PLUGINS_HOME:-${CLAUDE_CONFIG_DIR:-~/.claude}/tt-plugins}/core/skills`.
   Each toolbox plugin's SessionStart hook (`hooks/register.sh`) keeps it
   pointing at that plugin's install.

When neither has `tt-common/scripts/workflow-state.sh`, Tatty still runs: its
pages say "Tatty can't find the TT toolbox", and nothing else breaks.

## Which disciplines are installed (Tatty's modes)

The toolbox's discipline plugins -- `engineering`, `design`, `production` --
are Tatty's **modes**: its landing page offers the ones installed, its title bar
switches between them, and the mode is the only thing that sets the app's accent
colour. `core` is the base every discipline installs, so it is not one of them.

Tatty reads the same pointer folders the toolbox keeps for itself
(`installed_modes()` in `plugins/tatty/app/server.py`): a discipline is
installed when `${TT_PLUGINS_HOME:-${CLAUDE_CONFIG_DIR:-~/.claude}/tt-plugins}/<plugin>`
is there, or `<TATTY_TOOLBOX>/plugins/<plugin>` in a checkout. Existence only:
nothing inside is read for this. A plugin's pointer appears when a session has
loaded it, so Claude Code's own records
(`${CLAUDE_CONFIG_DIR:-~/.claude}/plugins/installed_plugins.json`, the
toolbox's marketplace only) are read as well, and one just added counts at once.
`TATTY_MODES` names the modes instead, for development and the tests.

With no discipline plugin installed Tatty still shows everything it can drive
from `core` alone: its landing page offers the disciplines to add, and no page
is hidden.

### Adding a discipline

**Add** on the modes page installs that plugin, which is the one thing Tatty
does beyond reading. It is still not a change to the toolbox: Claude Code does
the installing, through the command a person would run themselves --
`claude plugin install <plugin>@<marketplace>`, the marketplace `core` was
installed from (`install_mode` and `toolbox_market()`). Only the three names
above, only on a click, never with `-y`, and the toolbox's own files are
untouched. The plugin's skills and hooks reach Claude Code in sessions started
afterwards, as they would after any install.

## Scripts Tatty runs (read-only)

All of these are under the core plugin's `skills/` folder.

| Script | For | Used in Tatty |
|---|---|---|
| `tt-common/scripts/workflow-state.sh --tsv <folder>` | where each feature in a folder stands, and its next command (columns `prefix kind phase skill verb arg text hint stage`) | Features, a feature's page, the Toolbox page's Status tab, the greeting |
| `tt-common/scripts/tatty.sh banner` | the greeting's robot and quip | a fresh window's first card |
| `tt-guide/scripts/guide.sh about [topic]`, `guide.sh start` | the toolbox's own docs | the Toolbox page's Docs tab |
| `tt-connections/scripts/connections.sh status <folder>` | the project's connections | the Toolbox page's Connections tab |
| `tt-common/scripts/ids.sh index <feature folder>` | every planning ID the feature's documents define, one row each: `ID file line form gloss` (form `heading`, `item` or `row`), from the document that owns its prefix | ID links and their hover cards (below) |

The page can't name any other command. The server runs only these (and the
design plugin's `stories.sh`, below), by argv, with no shell.

## Files Tatty reads

| File | For |
|---|---|
| `<feature>/<Prefix> - <Doc>.md` and `<feature>/.tt/**/*.md` | a feature's documents and working notes: their order, the Stages table of a draft Comprehensive Tech Plan, the Work Unit and Task Boards of a Task Status, `Repo` paths |
| `${TT_EVENTS_HOME:-~/.claude/tt-events}/events.jsonl` | a feature's timeline and its project, and **followed as it is written** for the milestones Tatty celebrates (`folder`, `event`, `ts`, `key`, `prefix`, `qualifier`, `route`, `project`, …; see the toolbox's `tt-common/events.md`, which names a companion app as a reader) |
| `${TT_WORKFLOW_HOME:-~/.claude/tt-workflow}/links.tsv`, `lite-links.tsv` | which project a feature folder is linked to, and the other way: which feature a session's project (its git root) is linked to |
| `${CLAUDE_CONFIG_DIR:-~/.claude}/sessions/*.json` | open sessions' names, so a new one isn't given the same name; a session's `cwd`, by its `sessionId` |

### Planning IDs: links and hover cards

Wherever Tatty shows a feature's words (a question from a session, its options,
a reply, a document in View), an ID the feature defines (`R12`, `CH5`, `P3`,
`CD2`, `§4`, `T07`, ...) is a link to its item: it opens the owning document at
that item, and hovering it shows the item as a card. An ID the feature doesn't
define stays plain text, and so does everything without the toolbox's
`ids.sh index`.

- **Which feature.** A session Start opened is its feature's. Any other joined
  session sends its Claude session id with each post; Tatty finds the session's
  `cwd` in `sessions/*.json`, its git root, and the feature folder under Tatty's
  root that `links.tsv` or `lite-links.tsv` links that project to.
- **Where an ID is.** `ids.sh index` follows the toolbox's Anchors rule
  (`tt-common/planning-protocol.md`): each ID is defined once, in the document
  that owns its prefix, as a heading that starts with it, a bullet that opens
  with it in bold (and ends with its block id, ` ^r12`), or a table row whose
  first cell it is. A card is that heading's section, that bullet, or that row
  under its table's header.
- Tatty finds an item in a rendered document the same three ways, so a
  document written before block ids still opens at the bullet.

The toolbox's skills keep writing IDs as they do in chat (`R12 (what it says)`);
nothing in a question is written for Tatty.

### The ledger as it is written: milestones

Tatty follows the ledger file while it is open (`watch_ledger` in
`plugins/tatty/app/server.py`) and makes a fuss of the rows in `MILESTONES`: the
explore, plan, breakdown, lite, build and debug events of
`tt-common/events.md`'s catalogue, each with a tier (a plan signed off and a
build complete are the big ones). This is still only reading:

- the file is read forwards from wherever the last look ended, and never
  written, locked or rotated;
- a row Tatty doesn't recognise is ignored, as that document asks of every
  reader, so the toolbox can add events without Tatty knowing;
- rows are de-duplicated on the ledger's own `key`, and a window starts from the
  end of the file as it stands, so nothing is celebrated twice and nothing
  historical is celebrated at all;
- the toolbox still knows nothing of any of this: it records what it always
  recorded, whether or not Tatty is installed.

Of a row, Tatty also reads `skill` (named in the window's alert) and `folder`,
which it matches to a feature under its root to know which page a click should
open. A row without them still celebrates; it just opens no page.

### Documents: View and Edit

A document opens in **View**, which lays it out by its kind (the part of the file
name after ` - `): `Challenges` as cards, `Task Breakdown` as a list of
collapsible tickets grouped by work unit, every other kind as plain markdown.
The Task Breakdown's tickets show their status from the same feature's Task
Status (its Task Board and Work Unit Board, which Tatty already reads); with no
Task Status they show none.
Tatty identifies the kind by file name only, and adds nothing to the toolbox's
templates for it. A view reads what the template writes (for Challenges,
`tt-adversarial-plan`'s `templates/challenges.md` and `briefs/challenge.md`:
`### CH<n> — title` blocks with `Severity`, `Target`, `Outcome` and `Resolution`
bullets; for the Task Breakdown, `tt-task-breakdown`'s templates: `## WU<n> — name`
units, `### T<nn> — title` cards and the Task Map table) and falls back to plain
markdown when it can't.

In **Edit** a person changes the document's markdown and saves it
(`POST /api/doc/save`). This is the only place Tatty writes a toolbox document:

- only a `.md` file directly in a feature folder or under its `.tt/`, the same
  files it reads;
- only if the file hasn't changed since the page read it (its modified time is
  checked), because the toolbox's skills edit these files in place too; a
  changed file is refused and the person picks: overwrite, or load the disk
  version;
- written whole and atomically, keeping the file's own line ends.

Tatty never edits a document on its own.

## User Stories (the design mode)

The design mode's board works on the design plugin's `tt-user-stories` skill.
Tatty finds the plugin like core: under a `TATTY_TOOLBOX` checkout
(`plugins/design`, or beside the plugin folder it names), through the pointer
folder `${TT_PLUGINS_HOME:-~/.claude/tt-plugins}/design`, else at the
`installPath` Claude Code recorded for `design@<marketplace>`. Without it the
board says so and offers the modes page.

A board is a folder `<root>/design/<name>/` that Tatty makes: it holds a copy of
the design document the person picked (so the skill reads only inside the
folder) and `<name> - User Stories.md`, which is the skill's document:

| Command | When | Used in Tatty |
|---|---|---|
| `tt-user-stories/scripts/stories.sh init <design doc> <stories doc>` | a new board | starts the document |
| `stories.sh list <doc> --tsv` | every time the board is read | the stories, groups and retired rows, and each story's hash; `problem:` lines on stderr mean a hand edit broke the layout |
| `stories.sh edit <doc> <id> <spec> --if <hash>`, `accept`, `reject <reason>`, `group add\|describe\|rename\|remove` | a person's click: Save, ✓, 🗑, the group panel | the change; exit 3 (the story changed since it was read) is a 409 and the board reloads |
| `stories.sh add <doc> <spec> [--proposed]` | a new story's Save on the board (`--proposed` for Write it for me) | the new story's ID, on stdout |

The spec Tatty writes for an edit is the script's own format (`stories.sh
--help`), from the fields the person filled in. Tatty never writes the
document's markdown itself.

**Write it for me** (a new story said in a line) is `stories.sh add --proposed`
of a placeholder, then the `alter` run below on it, with the line in its note.

**Export to Tasks** only reads the document (`stories.sh list --tsv`): the
tasks it makes are Tatty's own files on a Tasks board (see "Tasks"), and which
task each story became is kept in `<home>/boards/`, not in the document. It
runs no skill.

To **write** stories, Tatty runs the skill headless, on a person's click
(**Write stories**, **Look for more**, a new board, or **Ask for changes** on a
Proposed card):

```
claude -p --output-format stream-json --verbose
  --tools Bash,Read,Glob,Grep,Skill
  --allowedTools Read Glob Grep Skill "Bash(bash *stories.sh*)"
  --permission-mode dontAsk --setting-sources user --no-session-persistence
  --strict-mcp-config --max-budget-usd <TATTY_STORIES_BUDGET, default 5>
  [--plugin-dir <design> --plugin-dir <core>]   (only for a checkout)
```

with the prompt on stdin: `/design:tt-user-stories draft "<design doc>"
"<stories doc>"`, or `/design:tt-user-stories alter "<stories doc>" <id>
"<note file>"`. It runs in the board's folder, with the alteration note in a
folder of Tatty's own (`<home>/runs/`, given with `--add-dir`, removed after).
The run can read, and write only through `stories.sh` (the skill passes its
specs on stdin): it has no Write or Edit tool, and anything else asked for is
refused, never prompted. `TATTY_SESSION` is taken out of its environment, so the
Tatty mod stays out of it; on Windows `CLAUDE_CODE_GIT_BASH_PATH` is set to the
Git Bash the server uses, so the run has a Bash tool (without it a child claude
may get PowerShell, where `bash stories.sh` can't run). One run at a time; Stop
kills it. The page sees each tool call as a step, then which stories are new or
rewritten and what the run cost.

## Commands Tatty starts

(Besides the User Stories runs above.)

**Start session** opens a new Claude session that runs one of the feature's
next commands. That is the command `workflow-state.sh` names, or
`/tt-workflow "<folder>"`, so a new feature is linked and started by the
workflow itself. Those are the toolbox's own skills, run as a person would run
them. Tatty's launcher (`launch()` in `server.py`) only opens the terminal: it
names the session, sets `TATTY_SESSION`, and starts `claude` in the project.

**Start workflow** on a Jira ticket (below) starts the toolbox's own first step
for a new folder, the command `workflow-state.sh` names for it
(`/tt-adversarial-plan <idea, spec or ticket>`), with its placeholder filled the
way `tt-workflow` hands a new folder to planning: `the Jira ticket <KEY> in
"<ticket document>". Folder: <folder>. Prefix: <name>`.

**Start workflow** on a task (see "Tasks") does the same, with the task as the
ticket: `the task <ID> in "<ticket document>". Folder: <folder>. Prefix:
<name>`.

## Jira

The production mode's **Jira** page shows the person's tickets in the open
sprints as a board, and starts a workflow from one. This is Tatty's own: the
toolbox has no part in it. What it does, and the limits it keeps:

- **Through Claude Code, never directly.** Tatty can't call an MCP server, so it
  runs `claude -p` headless (`jira_claude` in `server.py`) over the Atlassian MCP
  server the person signed in to with `/mcp` (`jiraServer` in Settings,
  `atlassian` by default). The sign-in stays Claude Code's; Tatty never sees,
  stores or refreshes a token.
- **Only the tools the job needs.** Each run allows named tools of that one
  server and no built-in tools (`--tools ""`): the board
  `getAccessibleAtlassianResources` and `searchJiraIssuesUsingJql`, a ticket
  `getJiraIssue` and `getTransitionsForJiraIssue`, the move
  `transitionJiraIssue` alone. The run loads only that server
  (`--strict-mcp-config`, its entry copied from Claude Code's
  `~/.claude.json`), with a short system prompt and no slash commands, on a
  small model (`jiraModel`, `haiku`). That keeps each turn's context to about
  16k tokens, most of them cached: a board refresh comes to about 60k over its
  turns, about $0.04. Without that entry the run loads the person's servers as
  any session would.
- **Only on a click.** Each run spends tokens, so nothing is fetched on a timer:
  **Refresh** reads the board (the JQL in Settings, `jiraJql`), **Load ticket**
  reads one ticket and its transitions, and the page otherwise shows what was
  kept. The answer is checked against a schema and cleaned again by the server
  (a ticket without a proper key is dropped; a picture becomes a note, since
  its link opens only in a signed-in browser).
- **One change in Jira.** On **Start workflow** Tatty moves the ticket to
  **In Progress**, and only after the session has opened: by the transition
  whose target (or name) is In Progress, found in the ticket's transitions,
  never a fixed id, with no other fields. A ticket already under way is left
  alone. If no terminal could be opened, the page offers **Move to In
  Progress** by hand.
- **One document written.** Start workflow makes `<root>/features/<KEY> -
  <summary>` (refused if it exists and isn't empty) and writes `<name> -
  Ticket.md` in it: the ticket's fields, its description, sub-tasks and links.
  The workflow plans from it; Tatty never touches it again.

## Tasks

The production mode's **Tasks** page keeps task boards for a project that uses
no tracker of its own. Like the Jira board it is Tatty's own, and the toolbox
has no part in it:

- **Boards live in Tatty's root,** `<root>/tasks/<board>/`: a `board.json` and
  an `items` folder of markdown files, one per task. Unlike `features/`, this is
  Tatty's own content, written whenever a person changes a task. It is never the
  toolbox's: no skill reads or writes it.
- **The files are a person's too.** They can be edited by hand (in Obsidian,
  say) and Tatty keeps up. A change Tatty makes rewrites only the field or the
  section it is changing.
- **One document written for the toolbox.** **Start workflow** makes
  `<root>/features/<ID> - <title>` (refused if it exists and isn't empty) and
  writes `<name> - Ticket.md` in it: the task's fields, its description and its
  other sections. The workflow plans from it; Tatty never touches it again.
  The task's own file then names the feature (`- **Feature:**`).

## What Tatty keeps of its own

- `${TATTY_HOME:-${CLAUDE_CONFIG_DIR:-~/.claude}/tatty}/`:
  - `root`: Tatty's root folder, whose `features` folder Tatty lists;
  - `projects.tsv`: the projects chosen per feature;
  - `settings.json`: what the Settings page sets;
  - `jira/`: the Jira board as last fetched (`board.json`), the tickets loaded
    (`issues/<KEY>.json`), and which feature was started from which ticket
    (`started.tsv`);
  - `boards/<key>.json`: a User Stories board's or a feature's whiteboard:
    where each card sits, the view, the text fields, comments and lines on it,
    each group's colour, and which task each exported story became (never in
    the stories document);
  - `whiteboards/<name>.json`: a blank whiteboard (`.deleted/` holds the
    deleted ones);
  - `tasks-index/<key>.json`: each task board's index (each task file's size,
    time and summary), so a big board opens without reading every file;
  - `server.json` and `server.log`.
- `%LOCALAPPDATA%\Tatty\`, on Windows:
  - the tray app's build;
  - its WebView2 data;
  - the full panel's last size and position.
- `<root>/tasks/`: the task boards (see "Tasks").

None of these are the toolbox's. The toolbox's settings and records (the event
ledger, the workflow links) are never written, and its documents only on a
person's Save in Edit mode, the ticket's on Start workflow (from a Jira ticket
or a task), or a User Stories
document through `stories.sh` on a person's click.
