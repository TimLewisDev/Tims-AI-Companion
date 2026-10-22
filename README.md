# Tatty: a companion for the TT toolbox

Tatty is a friendlier way to work with the [TT toolbox](https://github.com/TimLewisDev/Tims-AI-Toolbox),
the Claude Code skills for planning and building features with an AI agent while
the engineer stays in control. The toolbox runs in the terminal. Tatty sits
beside it, in your system tray and a window of its own, and shows the same work
visually:

- **Features:** every feature you're working on, where it stands in the
  workflow (exploring, planning, building, done), and its progress.
- **A feature's page:**
  - its documents, readable in place, with `[[wikilinks]]` that open the
    heading or item they name;
  - a tracker of its steps, its work units and a timeline.
- **Start the next step:** opens a new Claude session that runs it, then
  watches that session live: what it's doing, and its questions, which you
  answer right there.
- **Questions from any session** you join pop up in Tatty instead of the
  terminal, and you can chat to that session from Tatty.

Tatty is **optional and separate**. The toolbox never needs it and works the
same without it. Tatty only reads the toolbox's documents and runs a few of its
scripts read-only (see [docs/toolbox-contract.md](docs/toolbox-contract.md)).

## Install

Tatty is a Claude Code plugin, with the TT toolbox as a prerequisite. In Claude
Code (2.1.275 or later):

```
/plugin install tatty --marketplace TimLewisDev/Tims-AI-Companion
```

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
| see your features | Tatty's **Full panel** → **Features** |
| start a new feature | **Features** → **New feature…** |
| run a feature's next step | its page → **Start…** → **Start session** |

Sessions you haven't joined are untouched: Tatty never answers for them, and
they ask their questions in the terminal as usual.

## In this repo

- [`plugins/tatty`](plugins/tatty): the plugin.
  - `hooks/register.tsx`: the Claude Code mod.
  - `app/server.py`: the local server.
  - `app/web`: the page.
  - `app/companion`: the Windows tray app (.NET 9 WPF and WebView2).
  - `scripts/`: `tatty.sh` and `tatty-root.sh`.
- [`tools/`](tools): tests and the browser checks.
- [`docs/`](docs):
  - [design](docs/design.md);
  - [the toolbox contract](docs/toolbox-contract.md);
  - [install](docs/install.md);
  - [history](docs/history.md), how Tatty began as a spike inside the toolbox.

MIT licensed.
