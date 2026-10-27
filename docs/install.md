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
- the tray app, or brings it forward if it is already running.

To talk to Claude from Tatty, open a chat with the **+** at the end of the
workflow tabs (or of the side panel beside a workflow): each chat is a Claude
conversation of its own, with no terminal, that can read the project but not
change it. The server starts in Tatty's root folder, else your home folder;
`tatty.sh boot --project <dir>` chooses another.

The launcher finds the plugin each time, so updating the plugin doesn't break the
shortcut: it runs the version Claude Code has installed, or, for a checkout you
run on purpose, the folder `%LOCALAPPDATA%\Tatty\boot.json` names (every start
keeps it up to date). A launcher built before this was a rule keeps starting the
version it last ran, so run `/tatty install` once after updating to rebuild it. `/tatty uninstall` removes the
shortcuts, the launcher and `boot.json`.

## Updating

Tatty updates like any Claude Code plugin: Claude Code reads the marketplace's
catalogue and installs a newer `version` of the plugin into its cache. **A release
must raise `version` in `plugins/tatty/.claude-plugin/plugin.json`** (and be
pushed to GitHub): with the same version, nothing counts as new.

Tatty can do the updating itself. Open **Settings** (the gear beside the
*connected* label in the top bar):

- **Keep Tatty and the toolbox up to date automatically** (on by default). The
  window's server looks 30 seconds after it starts and every 6 hours after. For
  Tatty and each toolbox plugin installed (`core`, and the disciplines such as
  `engineering`, from the `tims-ai-toolbox` marketplace) it runs
  `claude plugin marketplace update <marketplace>` and then, for each plugin whose
  marketplace version is newer, `claude plugin update <plugin>@<marketplace>`.
- **Check for updates** looks without installing; **Update now** installs. The
  page lists each plugin with the version installed and the latest.
- The gear shows a dot when a version is waiting or has been installed.

An update is *ready*, not live, once installed. For Tatty, the running server and
tray app are the old version until Tatty is restarted (**tray → Quit Tatty**, then
start it again); the tray app is built again for the new version on that start
(about a minute), and the Desktop shortcut finds the new plugin by itself. For the
toolbox, Claude sessions started afterwards use the new version; ones already open
keep the old (`/reload-plugins` picks it up).

Tatty only has Claude Code install the toolbox's plugins; it doesn't read or change
the toolbox for this. As for Tatty, a toolbox release must raise `version` in each
changed plugin's `plugin.json`, or Claude Code sees nothing new.

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
| `TATTY_JOIN` | `1`: this Claude session works with Tatty from the start, as after `/tatty attach` |
| `TATTY_UI` | `browser` to use a browser tab even on Windows |
| `TATTY_PYTHON` | the Python to run the server with |
| `TATTY_CLAUDE` | the claude command to run for updates and headless runs (Jira, User Stories, chats), instead of the one on the PATH (tests; a `.sh` runs in bash) |
| `TATTY_CHAT_BUDGET` | US dollars a chat's turn may spend at most (default 2) |
| `TATTY_CHAT_TIMEOUT` | seconds a chat's turn may take (default 600) |
| `TATTY_UPDATE_FIRST` | seconds after the server starts before it first looks for an update (default 30) |
| `TATTY_IDLE` | seconds of no use before the server stops (default 7200) |
| `TATTY_DRYRUN` | `1`: Start reports the session it would open and opens nothing (tests) |
| `TATTY_PICKER` | a stand-in for the folder dialog (tests) |
