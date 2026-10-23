# Tatty: a companion for the TT toolbox

Tatty is a friendlier way to work with the [TT toolbox](https://github.com/TimLewisDev/Tims-AI-Toolbox),
the Claude Code skills for planning and building features with an AI agent while
the engineer stays in control. The toolbox runs in the terminal. Tatty sits
beside it, in your system tray and a window of its own, and shows the same work
visually:

- **Your modes:** the toolbox's discipline plugins you have installed
  (engineering, design, production), each with a home page of its own and its
  own colour, switched from the radio in the title bar. With one installed,
  Tatty opens straight into it.
- **Features:** every feature you're working on, where it stands in the
  workflow (exploring, planning, building, done), and its progress.
- **A feature's page:**
  - its documents, readable in place, with `[[wikilinks]]` that open the
    heading or item they name; View lays each kind out for reading (the
    Challenges as cards), Edit changes and saves the markdown;
  - a tracker of its steps, its work units and a timeline.
- **Start the next step:** opens a new Claude session that runs it, then
  watches that session live: what it's doing, how many tokens it has used,
  and its questions, which you answer right there.
- **Questions from any session** you join pop up in Tatty instead of the
  terminal, and you can chat to that session from Tatty.
- **Tatty tells you when he needs you:** a chime, a hop and a ring of sparks
  while a question waits for an answer, and confetti and a flourish each time a
  section is finished -- a work unit validated, a plan signed off, a build
  complete. Between the two he gets on with his own day: he fidgets, dances from
  foot to foot, sits down, and eventually falls asleep until something happens.
  **Animations**, **Sound**, **Effects** and **Keep Tatty on the desktop** are
  all in his tray menu. If your system is set to show less motion he keeps still
  until you tick **Animations** yourself.
- **Planning IDs as links:** an `R12`, `CH5` or `P3` in a question, a reply or a
  document opens the item it names, and hovering it shows the item as a card,
  so you don't have to go and find it.

Tatty is **optional and separate**. The toolbox never needs it and works the
same without it. Tatty only reads the toolbox's documents (writing one only when you save it in
Edit mode) and runs a few of its scripts read-only (see [docs/toolbox-contract.md](docs/toolbox-contract.md)).

## Install

Tatty is a Claude Code plugin that depends on the TT toolbox's `core` plugin,
from the toolbox's own marketplace. In Claude Code (2.1.292 or later), add the
toolbox's marketplace first (skip this if you already have the toolbox), then
install Tatty:

```
/plugin marketplace add TimLewisDev/Tims-AI-Toolbox
/plugin install tatty --marketplace TimLewisDev/Tims-AI-Companion
```

Installing Tatty installs `core` too, if you don't have it yet. Install the
toolbox's `engineering` plugin as well (`/plugin install engineering@tims-ai-toolbox`)
for the workflow Tatty shows and starts.

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
| see your features | Tatty's **Full panel** → **Features** |
| start a new feature | **Features** → **New feature…** |
| run a feature's next step | its page → **Start…** → **Start session** |
| keep Tatty out where you can see him | Tatty's tray menu → **Keep Tatty on the desktop** |
| have him move, or keep still | Tatty's tray menu → **Animations** |
| turn his noise or his confetti off | Tatty's tray menu → **Sound**, **Effects** |

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
