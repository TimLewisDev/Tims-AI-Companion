# Tatty: a companion for the TT toolbox

Tatty is a small companion that sits in your system tray beside Claude Code and
the [TT toolbox](https://github.com/TimLewisDev/Tims-AI-Toolbox), so you can see
and steer an AI-built feature without living in a terminal.

## Contents

- [Install](#install)
- [Why use Tatty](#why-use-tatty)
  - [See where everything stands](#see-where-everything-stands)
  - [Stay in control without watching the terminal](#stay-in-control-without-watching-the-terminal)
  - [Think and plan, not just build](#think-and-plan-not-just-build)
  - [Keep your tickets and tasks in one place](#keep-your-tickets-and-tasks-in-one-place)
  - [A companion with some personality](#a-companion-with-some-personality)
  - [Optional, and safe to ignore](#optional-and-safe-to-ignore)
- [Quick reference](#quick-reference)
- [In this repo](#in-this-repo)

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

## Why use Tatty

The toolbox gives you a disciplined way to plan and build features with an AI
agent while you stay in charge. That discipline produces a lot: plans,
challenges, task lists, questions, reviews. In a terminal it scrolls past.
Tatty is for when you'd rather see it laid out, and be told when it needs you.

### See where everything stands

- Every feature you're working on, and whether it is exploring, planning,
  building, reviewing or done, with its progress.
- Each feature's documents readable in one place, with links that jump straight
  to the item they name. Hover a planning ID like `R12` or `CH5` and the item
  appears as a card, so you don't go hunting for it.
- No more asking "where was I?" when you come back to a feature after a day, or
  after a week.

### Stay in control without watching the terminal

- Questions from the agent pop up in Tatty and wait for your answer. Walk away,
  come back, and nothing has been guessed on your behalf.
- Start the next step of a feature with one click, and watch that session live:
  what it is doing, what it has used, and what it is asking.
- Several features can run side by side. Each works on a branch of its own, so
  they don't trample each other.
- After a build, Tatty takes the branch through a review, puts each suggestion
  to you as a question with options, has the changes you chose made, and helps
  you commit, push and open the pull / merge request.
- Want to understand something? Select text in a workflow and ask about it in a
  side chat. The workflow carries on, and the chat can read your project but
  never change it.

### Think and plan, not just build

- Turn a design document into user stories, laid out as sticky notes you can
  rearrange, group, accept, reject or ask to have rewritten.
- Whiteboards for planning on their own, or beside a feature's documents, with
  text, comments and lines that join things and follow them when they move.
- A way to see the shape of an idea before it becomes code.

### Keep your tickets and tasks in one place

- Your Jira sprint as a board. One click turns a ticket into a feature, with the
  ticket written into it and Jira kept up to date as the work moves.
- No Jira? Tatty keeps simple task boards of its own, as plain markdown files you
  can also edit in Obsidian, and shows how far you've come: your week, your best
  week, your streak.
- Modes for each discipline you use (engineering, design, production), so
  Tatty shows what's relevant to the job in hand.

### A companion with some personality

Tatty chimes, hops and throws sparks when he needs you, and celebrates with
confetti when a section is finished: a work unit validated, a plan signed off,
a build complete. Between those moments he fidgets, dances and falls asleep.
Everything about him can be turned off, and if your system is set to show less
motion, he keeps still.

### Optional, and safe to ignore

Tatty is separate from the toolbox. The toolbox never needs it and works the
same without it. Tatty only reads the toolbox's documents. It writes one only
when you save an edit, start a workflow from a ticket or task, or change a
story, and it moves or removes a feature's folder only when you choose Archive or
Delete. See [docs/toolbox-contract.md](docs/toolbox-contract.md) for exactly
what it touches.

## Quick reference

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
| commit what a finished workflow changed | its page → **Choose what to commit…** (or **Commit** in the left rail) → **Commit selected** or **Commit everything** |
| review a feature's branch, even in another repo | its page, once the build is complete → **Review the branch** → **Start…** → **Change…** to pick the repo → **Start session** |
| decide what to do about the review's findings | its page → **Decide on the suggestions…** (or **Review suggestions** in the left rail): one question at a time; the last answer starts the changes |
| put a feature away, or delete it | its page → **Archive** (**▾** → **Delete…** to remove it for good); **Features** → **Archived** to restore |
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
