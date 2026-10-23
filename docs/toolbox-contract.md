# What Tatty takes from the TT toolbox

Tatty is a companion to the [TT toolbox](https://github.com/TimLewisDev/Tims-AI-Toolbox):
a user interface over its workflow, never part of it. The dependency runs one
way:

- **Tatty reads the toolbox.** It reads the toolbox's documents and records and
  runs a few of its scripts, read-only. The one thing it writes is a feature's
  own document, and only when a person saves it in Edit mode (see below), or a
  ticket's document into a new feature folder made for it on Start workflow
  (see "Jira"). It can also ask Claude Code to install one of the toolbox's
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

The page can't name any other command. The server runs only these, by argv,
with no shell.

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

## Commands Tatty starts

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

## What Tatty keeps of its own

- `${TATTY_HOME:-${CLAUDE_CONFIG_DIR:-~/.claude}/tatty}/`:
  - `root`: Tatty's root folder, whose `features` folder Tatty lists;
  - `projects.tsv`: the projects chosen per feature;
  - `settings.json`: what the Settings page sets;
  - `jira/`: the Jira board as last fetched (`board.json`), the tickets loaded
    (`issues/<KEY>.json`), and which feature was started from which ticket
    (`started.tsv`);
  - `server.json` and `server.log`.
- `%LOCALAPPDATA%\Tatty\`, on Windows:
  - the tray app's build;
  - its WebView2 data;
  - the full panel's last size and position.

None of these are the toolbox's. The toolbox's settings and records (the event
ledger, the workflow links) are never written, and its documents only on a
person's Save in Edit mode, or the ticket's on Start workflow.
