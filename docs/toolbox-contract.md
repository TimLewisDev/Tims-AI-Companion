# What Tatty takes from the TT toolbox

Tatty is a companion to the [TT toolbox](https://github.com/TimLewisDev/Tims-AI-Toolbox):
a user interface over its workflow, never part of it. The dependency runs one
way:

- **Tatty reads the toolbox.** It reads the toolbox's documents and records and
  runs a few of its scripts, read-only. The one thing it writes is a feature's
  own document, and only when a person saves it in Edit mode (see below).
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
are Tatty's **modes**: its landing page offers the ones installed, its top bar
switches between them, and the mode is the only thing that sets the app's accent
colour. `core` is the base every discipline installs, so it is not one of them.

Tatty reads the same pointer folders the toolbox keeps for itself
(`installed_modes()` in `plugins/tatty/app/server.py`): a discipline is
installed when `${TT_PLUGINS_HOME:-${CLAUDE_CONFIG_DIR:-~/.claude}/tt-plugins}/<plugin>`
is there, or `<TATTY_TOOLBOX>/plugins/<plugin>` in a checkout. Existence only:
nothing inside is read for this. `TATTY_MODES` names the modes instead, for
development and the tests.

With no discipline plugin installed Tatty still shows everything it can drive
from `core` alone: its landing page says which plugin to install, and no page is
hidden.

## Scripts Tatty runs (read-only)

All of these are under the core plugin's `skills/` folder.

| Script | For | Used in Tatty |
|---|---|---|
| `tt-common/scripts/workflow-state.sh --tsv <folder>` | where each feature in a folder stands, and its next command (columns `prefix kind phase skill verb arg text hint stage`) | Features, a feature's page, the Toolbox page's Status tab, the greeting |
| `tt-common/scripts/tatty.sh banner` | the greeting's robot and quip | a fresh window's first card |
| `tt-guide/scripts/guide.sh about [topic]`, `guide.sh start` | the toolbox's own docs | the Toolbox page's Docs tab |
| `tt-connections/scripts/connections.sh status <folder>` | the project's connections | the Toolbox page's Connections tab |

The page can't name any other command. The server runs only these, by argv,
with no shell.

## Files Tatty reads

| File | For |
|---|---|
| `<feature>/<Prefix> - <Doc>.md` and `<feature>/.tt/**/*.md` | a feature's documents and working notes: their order, the Stages table of a draft Comprehensive Tech Plan, the Work Unit and Task Boards of a Task Status, `Repo` paths |
| `${TT_EVENTS_HOME:-~/.claude/tt-events}/events.jsonl` | a feature's timeline and its project (`folder`, `event`, `ts`, `project`, …; see the toolbox's `tt-common/events.md`, which names a companion app as a reader) |
| `${TT_WORKFLOW_HOME:-~/.claude/tt-workflow}/links.tsv`, `lite-links.tsv` | which project a feature folder is linked to |
| `${CLAUDE_CONFIG_DIR:-~/.claude}/sessions/*.json` | open sessions' names, so a new one isn't given the same name |

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

## What Tatty keeps of its own

- `${TATTY_HOME:-${CLAUDE_CONFIG_DIR:-~/.claude}/tatty}/`:
  - `root`: Tatty's root folder, whose `features` folder Tatty lists;
  - `projects.tsv`: the projects chosen per feature;
  - `server.json` and `server.log`.
- `%LOCALAPPDATA%\Tatty\`, on Windows:
  - the tray app's build;
  - its WebView2 data;
  - the full panel's last size and position.

None of these are the toolbox's. The toolbox's settings and records (the event
ledger, the workflow links) are never written, and its documents only on a
person's Save in Edit mode.
