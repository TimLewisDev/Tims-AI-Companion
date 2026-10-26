# Tatty: a companion for the TT toolbox

Tatty is a friendlier way to work with the [TT toolbox](https://github.com/TimLewisDev/Tims-AI-Toolbox),
the Claude Code skills for planning and building features with an AI agent while
the engineer stays in control. The toolbox runs in the terminal. Tatty sits
beside it, in your system tray and a window of its own, and shows the same work
visually:

- **Your modes:** the toolbox's discipline plugins you have installed
  (engineering, design, production), each with a home page of its own and its
  own colour, switched from the radio in the title bar. With one installed,
  Tatty opens straight into it. The ones you haven't got are greyed on the modes
  page with **Add**, which installs them for you.
- **Features:** every feature you're working on, where it stands in the
  workflow (exploring, planning, building, done), and its progress.
- **A feature's page:**
  - its documents, readable in place, with `[[wikilinks]]` that open the
    heading or item they name; View lays each kind out for reading (the
    Challenges as cards), Edit changes and saves the markdown;
  - a tracker of its steps, its work units and a timeline.
- **User Stories (design mode):** pick a design document and Tatty has the
  toolbox's `tt-user-stories` skill write its user stories in the background,
  then lays them out as sticky notes on a board you can pan, zoom and rearrange.
  Click a note to read it in full and edit it (the markdown document changes);
  accept a proposed story with ✓, bin it with 🗑, or ask for changes and have it
  rewritten. The pinned group panel colours each group, adds and removes groups,
  and frames a group's notes when you click it. Add a story where you click
  (written by hand, or said in a line for the skill to write), and put text,
  comments and lines between things on the same board.
- **Whiteboards:** the same board on its own, for any planning (design mode →
  **Whiteboards**), and one for each feature beside its documents (the
  feature's **Whiteboard**): text fields, comments pinned to a card or a spot,
  and lines that join any two things and follow them when they move.
- **Start the next step:** opens a new Claude session that runs it, then
  watches that session live: what it's doing, how many tokens it has used,
  and its questions, which you answer right there.
- **Questions from any session** you join pop up in Tatty instead of the
  terminal, and you can chat to that session from Tatty.
- **Tatty tells you when he needs you:** a chime, a hop and a ring of sparks
  while a question waits for an answer, and confetti and a flourish each time a
  section is finished -- a work unit validated, a plan signed off, a build
  complete. The bubble says what is calling -- the question itself, or what
  finished -- and a click on him (or on that banner) opens the full panel on the
  page it is about. Between the two he gets on with his own day: he fidgets, dances from
  foot to foot, sits down, and eventually falls asleep until something happens.
  **Right-click Tatty** (or his tray icon) for his menu: **Preview** plays any
  one of his animations on the spot -- every performance, every pose, the
  confetti, the pulses, each sound, and the whole reaction to a finished work
  unit or a question arriving -- so you can see the lot without waiting for it.
  **Animations**, **Sound**, **Effects** and **Keep Tatty on the desktop** are
  there too. If your system is set to show less motion he keeps still until you
  tick **Animations** yourself.
- **Your Jira sprint, in the production mode:** your tickets in the open sprints
  on a board, a column per status. Open one to read it, and **Start workflow**
  makes it a feature: a folder with the ticket written into it, a Claude session
  that starts planning from it, and the ticket moved to In Progress in Jira.
  Tatty reads Jira through the Atlassian MCP server you signed in to in Claude
  Code (`/mcp`). That spends tokens, so it keeps what it fetched and only
  fetches again when you press **Refresh**.
- **Your tasks, kept on disk, in the production mode:** for a project with no
  Jira (or Trello, or Asana), **Tasks** keeps boards of its own: a backlog, a
  board whose columns you choose, and a Completed page of everything you've
  finished, with this week's count, your best week and your streak, to see how
  far you've come. Drag a card between columns to change its status (or use
  Alt+arrows), and open one to write or edit it. Each task is a markdown file
  in your root's `tasks` folder, so you can edit it in Obsidian too, and the
  board keeps up. **Start workflow** makes a task a feature, as a Jira ticket
  does, and Tatty celebrates each one you finish.
- **Planning IDs as links:** an `R12`, `CH5` or `P3` in a question, a reply or a
  document opens the item it names, and hovering it shows the item as a card,
  so you don't have to go and find it.

Tatty is **optional and separate**. The toolbox never needs it and works the
same without it. Tatty only reads the toolbox's documents (writing one only when you save it in
Edit mode, a ticket's when you start a workflow from a Jira ticket or a task, or a User Stories
document through the toolbox's own script when you change a story) and runs a few of its scripts read-only (see [docs/toolbox-contract.md](docs/toolbox-contract.md)).

## Install

Tatty is a Claude Code plugin that depends on the TT toolbox's `core` plugin,
from the toolbox's own marketplace. In Claude Code (2.1.292 or later), add the
toolbox's marketplace first (skip this if you already have the toolbox), then
install Tatty:

```
/plugin marketplace add TimLewisDev/Tims-AI-Toolbox
/plugin install tatty --marketplace TimLewisDev/Tims-AI-Companion
```

Installing Tatty installs `core` too, if you don't have it yet. You also want at
least one discipline plugin, for the workflow Tatty shows and starts: either
`/plugin install engineering@tims-ai-toolbox`, or **Add** on Tatty's modes page,
which does the same thing.

Then, in any session, run `/tatty open`. The first time, it builds the tray app,
which takes about a minute. See [docs/install.md](docs/install.md) for what
Tatty needs (Python 3.8+, and on Windows the .NET SDK and WebView2), how to
install from a local checkout, and how to work on Tatty itself.

## Use

| You want to | Do this |
|---|---|
| open Tatty, and have this session work with it | `/tatty open` |
| have another session work with an open Tatty | `/tatty attach` (and `/tatty detach` to stop) |
| close Tatty's window | `/tatty close`, or Tatty's tray menu |
| switch between your modes | the radio in Tatty's title bar (or **Tatty** → the modes) |
| add another discipline | **Tatty** → the modes → **Add** under the one you want |
| see your features | Tatty's **Full panel** → **Features** |
| start a new feature | **Features** → **New feature…** |
| run a feature's next step | its page → **Start…** → **Start session** |
| see your Jira sprint | the production mode → **Jira** → **Refresh** |
| start a workflow from a Jira ticket | **Jira** → the ticket → **Load ticket** → **Start workflow** |
| turn a design document into user stories | design mode → **User Stories** → **New from a design document…** |
| add a story on the board | the **＋** tool (S), then click where it goes |
| plan on a blank board | design mode → **Whiteboards** → **New whiteboard** |
| sketch next to a feature's plan | the feature's page → **Whiteboard** |
| write, comment or join things on a board | the **T** (text), **💬** (comment) and **↗** (line) tools, or double-click for text |
| keep tasks without Jira | the production mode → **Tasks** → **New board…** |
| add a task | **+ New task**, or type in **+ Add a task** under a column and press Enter |
| move a task | drag its card to another column (or focus it and press Alt+→ / Alt+←) |
| send finished tasks to Completed | **Clear done** on the board |
| see how far you've come | the board's **Completed** tab |
| start a workflow from a task | open the task → **Start workflow** |
| see one of his animations now | right-click Tatty → **Preview** → pick one |
| keep Tatty out where you can see him | right-click Tatty → **Keep Tatty on the desktop** |
| have him move, or keep still | right-click Tatty → **Animations** |
| turn his noise or his confetti off | right-click Tatty → **Sound**, **Effects** |

Sessions you haven't joined are untouched: Tatty never answers for them, and
they ask their questions in the terminal as usual.

## In this repo

- [`plugins/tatty`](plugins/tatty): the plugin.
  - `hooks/register.tsx`: the Claude Code mod.
  - `app/server.py`: the local server.
  - `app/web`: the page.
  - `app/companion`: the Windows tray app (.NET 9 WPF and WebView2).
  - `scripts/`: `tatty.sh` and `tatty-root.sh`.
- [`tools/`](tools): tests, the browser checks and the window checks.
- [`docs/`](docs):
  - [design](docs/design.md);
  - [the toolbox contract](docs/toolbox-contract.md);
  - [install](docs/install.md);
  - [history](docs/history.md), how Tatty began as a spike inside the toolbox.

MIT licensed.
