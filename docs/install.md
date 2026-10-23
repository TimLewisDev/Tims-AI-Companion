# Installing Tatty

## What Tatty needs

- **The TT toolbox,** installed (its `core` and `engineering` plugins). Tatty
  shows the toolbox's workflow, so without it there's nothing to show. See the
  toolbox's own install guide.
- **Claude Code** 2.1.275 or later. Tatty's Claude Code side is a plugin with a
  hooks module (a "mod").
- **Python 3.8 or later** on the PATH. The window's server uses the standard
  library only. On Windows the Store's `python3` alias is skipped.
  `TATTY_PYTHON` names another interpreter.
- **Bash.** Git Bash on Windows, as for the toolbox.
- **On Windows, for the tray app:**
  - the .NET 9 SDK (Tatty builds the tray app with `dotnet build` the first
    time);
  - the WebView2 runtime, which is part of Windows 11.

  Without them, or anywhere other than Windows, Tatty opens in a browser tab
  instead. `TATTY_UI=browser` forces that.

## From the marketplace

Tatty declares a dependency on the toolbox's `core` plugin, from the toolbox's
own marketplace (`tims-ai-toolbox`):
- `{ "name": "core", "marketplace": "tims-ai-toolbox" }` is in the marketplace
  entry and in `plugin.json`;
- `allowCrossMarketplaceDependenciesOn` names that marketplace.

A marketplace can't name another one's source, so add the toolbox's marketplace
first (skip this if you have the toolbox):

```
/plugin marketplace add TimLewisDev/Tims-AI-Toolbox
/plugin install tatty --marketplace TimLewisDev/Tims-AI-Companion
```

Or with both marketplaces added:

```
/plugin marketplace add TimLewisDev/Tims-AI-Companion
/plugin install tatty@tims-ai-companion
```

Installing Tatty installs `core` too when it's missing. Without the toolbox's
marketplace, the install is refused with: *Dependency "core@tims-ai-toolbox"
(required by tatty@tims-ai-companion) not found. Is the "tims-ai-toolbox"
marketplace added?* The dependency has no version range, because the toolbox
doesn't tag releases. Install `engineering@tims-ai-toolbox` as well, for the
workflow skills Tatty starts.

Then `/tatty open` in a session. The first open builds the tray app into
`%LOCALAPPDATA%\Tatty\companion\<version>`, which takes about a minute.

## As a desktop app (Windows)

So that Tatty can be started like any program, with no Claude session open first:

```
/tatty install
```

(or `bash plugins/tatty/scripts/tatty.sh install`). This builds a small launcher
into `%LOCALAPPDATA%\Tatty\launcher` (about a minute, once) and makes a **Tatty**
shortcut, with Tatty's face, on the Desktop and in the Start menu. Right-click
either and choose **Pin to taskbar**.

Starting Tatty from the shortcut (or the pin) brings up, in order:
- the window server;
- the tray app, or brings it forward if it is already running;
- **Tatty's own Claude session**, in a terminal of its own that is minimised as
  soon as it appears. What is typed in Tatty goes to this session, and its
  questions and replies show in Tatty. **Tray → Show Claude's terminal** brings the
  terminal back, and quitting Tatty closes it.

Tatty remembers that session in `claude-link.json` in its home (the folder it runs
in, and the conversation's id), and resumes the conversation with `claude --resume`
at the next start. It runs in Tatty's root folder, else your home folder; `tatty.sh
boot --project <dir>` chooses another, which is a new conversation.

The first time Claude Code runs in a folder it asks whether to trust it, which no
one can answer in a minimised window. So if the session hasn't joined Tatty within
45 seconds, its terminal is brought up and left there for you to answer. Starting
Tatty again does the same if it is still stuck.

The launcher finds the plugin each time (`%LOCALAPPDATA%\Tatty\boot.json`, kept up
to date by every start, else Claude Code's record of what is installed), so
updating the plugin doesn't break the shortcut. `/tatty uninstall` removes the
shortcuts, the launcher and `boot.json`.

## Updating

Tatty updates like any Claude Code plugin: Claude Code reads the marketplace's
catalogue and installs a newer `version` of the plugin into its cache. **A release
must raise `version` in `plugins/tatty/.claude-plugin/plugin.json`** (and be
pushed to GitHub): with the same version, nothing counts as new.

Tatty can do the updating itself. Open **Settings** (the gear beside the
*connected* label in the top bar):

- **Keep Tatty up to date automatically** (on by default). The window's server
  looks 30 seconds after it starts and every 6 hours after, with
  `claude plugin marketplace update <marketplace>` then, when the marketplace
  offers a newer version, `claude plugin update tatty@<marketplace> --scope user`.
- **Check for updates** looks without installing; **Update now** installs.
- The gear shows a dot when a version is waiting or has been installed.

An update is *ready*, not live, once installed: the running server and tray app
are the old version until Tatty is restarted (**tray → Quit Tatty**, then start it
again). The tray app is built again for the new version on that start (about a
minute); the Desktop shortcut finds the new plugin by itself. The toolbox's own
updates are Claude Code's: turn on auto-update for its marketplace in `/plugin`,
or run `claude plugin update`.

A copy run from a checkout or with `--plugin-dir` has nothing to update; Settings
says so. Use `git pull`.

## From a local checkout

To use your own copy of this repo, so edits take effect without a release:

```
claude plugin marketplace add TimLewisDev/Tims-AI-Toolbox      # if not added already
claude plugin marketplace add P:\Tatty-Companion\Tims-AI-Companion
claude plugin install tatty@tims-ai-companion
```

A marketplace that is a folder is read from that folder. After an edit,
`/reload-plugins` picks it up, and a server or tray-app change needs
`/tatty close` then `/tatty open`.

## Working on Tatty without installing it

Start a session with the plugin loaded from the checkout:

```
claude --plugin-dir P:\Tatty-Companion\Tims-AI-Companion\plugins\tatty
```

From a checkout, a session that **Start** opens is given the same
`--plugin-dir`, so its mod reports back to Tatty too.

To test against a toolbox checkout instead of the installed toolbox:

```
TATTY_TOOLBOX=P:/Claude/Tims-AI-Toolbox bash tools/test-tatty.sh
claude plugin validate plugins/tatty
claude plugin test plugins/tatty
```

The page can be driven in headless Edge or Chrome with `tools/page-check.py` and
`tools/features-check.py`. Use `attach <port>` for the tray app's own page,
started with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>`.

The tray app's windows have tests of their own, which build and run the exe and
show real windows on the desktop, so they are run on purpose rather than with the
rest:

```bash
bash tools/test-companion.sh                       # every view, in turn
python tools/window-check.py --expect compact      # what the shell makes of it now
python tools/window-check.py --all                 # with the plumbing windows too
```

`window-check.py` computes whether a window *should* be in Alt-Tab by the shell's
rule; the switcher's own list can't be read, so Alt-Tab itself, the taskbar
button's icon and restoring from that button are still checked by eye.

A rebuild needs the running companion to stop first, because it won't build over
its own locked exe: **tray → Quit Tatty**, or `tatty.sh close` and a few seconds
for it to notice.

## Settings

| Variable | What |
|---|---|
| `TATTY_HOME` | Tatty's state (default `~/.claude/tatty`): the root setting, projects, server.json, settings.json (what Settings saves) |
| `TATTY_ROOT` | use this root folder instead of the setting |
| `TATTY_TOOLBOX` | a toolbox checkout to use instead of the installed toolbox |
| `TATTY_MODES` | the modes (discipline plugins) to offer, e.g. `engineering,design`, instead of the ones installed |
| `TATTY_JOIN` | `1`: this Claude session works with Tatty from the start, on the main feed (Tatty's own session, started by the desktop app) |
| `TATTY_UI` | `browser` to use a browser tab even on Windows |
| `TATTY_PYTHON` | the Python to run the server with |
| `TATTY_CLAUDE` | the claude command to run for updates, instead of the one on the PATH (tests; a `.sh` runs in bash) |
| `TATTY_UPDATE_FIRST` | seconds after the server starts before it first looks for an update (default 30) |
| `TATTY_IDLE` | seconds of no use before the server stops (default 7200) |
| `TATTY_DRYRUN` | `1`: Start reports the session it would open and opens nothing (tests) |
| `TATTY_PICKER` | a stand-in for the folder dialog (tests) |
