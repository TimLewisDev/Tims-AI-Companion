# History: how Tatty began

Tatty grew as a spike inside the TT toolbox repo (`Tims-AI-Toolbox`, branch
`spike/tt-window`) on 2026-10-21 and 22, then moved here as its own plugin so
the toolbox never depends on it. The notes below are the spike's own, as it
wrote them then: names such as `tt-window`, `window.sh`, `TT_WINDOW_*`,
`/tt-window:tt-guide` and `tools/test-window.sh` are the old ones, and the parts
that edited the toolbox (tt-guide's window section, `workflow.sh root`, the
`new-session.sh` variables) were left behind in the move. See
[design.md](design.md) for Tatty as it is now.

---

## Spike: the tt window

- **Date:** 2026-10-21
- **Branch:** `spike/tt-window` (worktree `P:\Claude\Tims-AI-Toolbox-window`)
- **Status:** built and machine-tested; **live trial not done yet** (see "Trying it")

## The question

The terminal is hard going for some developers. Can a local HTML window take
over the awkward parts (answering questions, reading status and docs, typing a
question) while the agent keeps running in the terminal? It has to work for
Claude Code first, then Copilot CLI and Codex CLI.

## What was built

```
 agent (Claude / Copilot / Codex)                browser tab
   │  shell: window.sh show|ask|listen ─HTTP─▶  server.py  ◀─SSE/HTTP─ page (no libraries)
   │                                            127.0.0.1, random port + token
 Claude only: tt-window mod ─ $.http.fetch ───▶ │
   ├─ AskUserQuestion → asked in the window, answer returned as the tool's result
   ├─ text typed in the window → $.prompt.submit (as the user)
   └─ each answer the session gives → shown in the window
```

- **The bridge (any agent).** `tt-common/scripts/window.sh` plus
  `tt-common/window/server.py`. A skill that runs shell commands can open the
  window, show cards in it, ask questions and wait for the answer, and listen for
  typed messages. tt-guide uses it through `guide.sh window ...`.
- **The Claude mod (Claude Code only).** `plugins/tt-window/`. It does the two
  things a script can't:
  - questions from *every* skill go to the window with no skill edits, by taking
    over `AskUserQuestion`;
  - the window can start a turn, by sending typed text in as the user's prompt.
- **The page.** Tabs for Status (`workflow-state.sh --tsv` as a table, with
  Copy and Ask buttons), Connections and Docs (README sections). There is a feed
  of cards and questions, and a chat box. It runs only the read-only views on
  the server's allow-list, never a command the page sends.
- **Fallbacks everywhere.** No Python means exit 3, and everything stays in the
  terminal. No window, or a window that has gone away, means the normal
  terminal dialog. "Answer in terminal instead" sends one question back to the
  terminal.

## What has been checked

- **Bridge and server:** `bash tools/test-window.sh` passes 43 checks. They cover:
  - open, status, show, ask, answer, listen and close;
  - the exit codes (3, 5, 6) and bad input;
  - the token and Host guards, and the static allow-list;
  - the read-only views;
  - `guide.sh window open` pushing the greeting and status cards.
- **Mod:** `claude plugin validate plugins/tt-window` passes, and
  `claude plugin test plugins/tt-window` passes 3 tests. They show that a
  question is answered in the window, that "answer in terminal instead" falls
  back to the dialog, and that with no window the dialog is the engine's.
- **Page, in a real browser engine:** `tools/window-page-check.py` drives
  headless Edge over the DevTools protocol. It found:
  - SSE connects, and the cards, the status table, Tatty's banner and markdown
    render;
  - clicking an option and **Send answer** returns `Update<TAB>No` to the
    waiting `window.sh ask`;
  - a typed message reaches `window.sh listen`;
  - the Docs tab renders README tables.

  Run it as
  `python -I tools/window-page-check.py "<msedge.exe>" "<url from window.sh open>" [--answer <label>] [--say <text>]`.
- **Not checked yet:** a live Claude Code session with the mod loaded. This
  covers `$.prompt.submit` from the window, `turn.complete` mirroring, and the
  real AskUserQuestion takeover. See "Trying it".

## Findings so far

1. **The same window, protocol and server serve both paths.** The mod can't host
   a server: it has no Node and no sockets. So it talks to the same `server.py`
   the bridge starts. Per-agent work is a thin adapter, so supporting more
   agents means adding adapters, not building separate systems.
2. **Windows Python detection needs care.** `python3` on this machine is the
   Store's `AppInstallerPythonRedirector.exe`, and calling it hung the shell.
   `window.sh` now skips anything under `WindowsApps` and time-boxes the check.
   Expect the same on other Windows machines.
3. **The console code page mangles UTF-8.** Tatty's box-drawing art arrived
   garbled until the client read stdin as bytes and decoded UTF-8.
4. **Detaching the server from a shell tool works on Windows, with a hidden
   console.** `window.sh open` returns at once and the server outlives the
   command, using breakaway from the job and stdout to a log.
   - The first version used `DETACHED_PROCESS`, which leaves no console at all.
     Then every script a view ran got a visible console of its own, so each
     button press in the window opened a terminal; Connections opened one for
     `claude mcp list`.
   - `CREATE_NO_WINDOW` gives the server a hidden console that its children
     share. Views also pass it themselves.
   - Checked by snapshotting visible windows during the views: the old server
     opened a Windows Terminal window for `bash.exe`, and the fixed one opened
     nothing.
5. **The mod API was usable, but strict.**
   - The validator requires helpers that take `$` to be top-level functions.
   - A gating `tool.call` hook needs a `.catch`. Here it falls back to the
     terminal dialog.
   - `claude plugin test` ran with no Node installed.
   - `tsc` was not run (no Node), so type checking rests on `claude plugin
     validate` and the tests.
   - The API is early access and "moves between releases", which is a real
     maintenance cost for the mod path.
6. **Limits of the bridge on its own.** These are known from the design and
   still to be felt in a live trial:
   - The window can't start a turn. Without the mod, typed questions are read
     only while the skill sits in `window.sh listen`, which is capped at five
     100-second listens in a row.
   - Every `ask` or `listen` is a shell command. Each may raise a permission
     prompt unless it's allow-listed, and each needs a 120 s timeout or a
     retry (exit 5 then `answer <id>`).
   - Skills have to opt in, as tt-guide does in its "The window" section. Other
     skills ask in the terminal unless the Claude mod is loaded.
7. **Testing a live page needs the DevTools protocol.**
   - `--dump-dom` snapshots at the load event, before the fetches and SSE land.
     With `--virtual-time-budget` it never ends, because the SSE stream keeps
     the network busy.
   - Headless Chrome hung on this machine even on a trivial page. Edge works.
8. **One window per user for now.** `server.json` sits in one place, so two
   sessions share one window, and both mods would take typed messages. This is
   fine for a spike. A rollout would key the window by session or project.

## Tatty in the tray (the companion)

On Windows, `window.sh open` no longer opens a browser tab. It starts
**Tatty**, a tray companion in `tt-common/window/companion`, built with .NET 9
WPF and WebView2.
- Tatty pops up in the corner, above every window, with a speech bubble when a
  question or a reply arrives.
- He tucks away about 10 s after nothing is left to answer. He stays while you
  are in the bubble, while the pointer is over him, or while the full panel is
  open.
- The bubble's **Full panel** button expands it into the whole page (Status,
  Connections, Docs).
- The tray icon toggles the bubble, and its menu has Show, Full panel, Hide,
  Close the tt window, and Quit.
- `TT_WINDOW_UI=browser`, or any non-Windows machine, keeps the browser tab.

**Why this shell.** It needs no installs here, because the .NET 9 SDK and the
WebView2 runtime are already present, and it reuses the page as-is. The shell
is about 450 lines of C#. Choosing a shell was about the frame, not the UI:

| | .NET WPF + WebView2 | pywebview | Tauri | Electron | tkinter |
|---|---|---|---|---|---|
| Reuses the page | yes | yes | yes | yes | no (second UI) |
| New installs here | none | 2 pip packages | Rust | Node | none |
| Platforms | Windows | all three | all three | all three | all three (per-OS hacks) |
| Ships as | source + `dotnet build` | scripts | signed binary per OS | ~150 MB app | scripts |

A cross-platform rollout would replace only this shell, most likely with Tauri,
or with pywebview if its Python 3.14 support holds.

**Companion findings**
1. **It is two windows**, because WebView2 can't draw inside a transparent WPF
   window (the "airspace" limit).
   - Tatty is native XAML, truly transparent, and never takes focus
     (`WS_EX_NOACTIVATE`).
   - The bubble is opaque, with Windows 11's own rounded corners and accent
     border (DWM attributes), so it needs no transparency.
2. **Focus behaves.**
   - Pop-ups use `ShowActivated=False` and `SWP_NOACTIVATE`. Checked: the
     foreground window stayed on the terminal when he popped up.
   - Clicking into the bubble activates it, so you can type.
3. **Every behaviour was checked from a script.** Win32 window listings
   (`EnumWindows`) give each window's visibility, `WS_EX_TOPMOST`,
   `WS_EX_TOOLWINDOW`, `WS_EX_NOACTIVATE`, position and size. The page inside
   the companion is driven through WebView2's DevTools port
   (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<p>`, then
   `window-page-check.py attach <p>`). The results:
   - compact layout;
   - a question answered in the bubble reaching `window.sh ask`;
   - expand to 1040×720, centred, and back;
   - tuck after about 10 s;
   - popping back up on a reply or a question;
   - exiting about 7 s after the server stops.
4. **The page used to drop its own `?mode=companion`.** Stripping the token from
   the address bar with `replaceState(…, pathname)` also stripped the query, so
   the companion showed the full browser layout until the call kept
   `location.search`.
5. **Builds are cheap.** The first build took about 6 s (WebView2 1.0.2903.40
   restored from nuget.org), and a rebuild after an edit about 2 s. `open`
   rebuilds by itself when a source file is newer than the exe.
6. **The full panel behaves like a window.**
   - **Resize:** drag any edge or corner. WPF's `WindowChrome` gives the
     borderless window real resize edges, and WebView2 sits 6 px inside them,
     because as a child window it would otherwise take the mouse at the very
     edge. Checked with `WM_NCHITTEST`: the edges answer left, right, top,
     bottom and corner, and the compact bubble answers "client" everywhere.
   - **Move:** drag the bar. The page posts `drag` on mouse-down, and the host
     hands the mouse to Windows' own move loop (`WM_NCLBUTTONDOWN`/`HTCAPTION`),
     so snapping works as for any title bar.
   - **Full screen:** **Maximise**, or a double-click on the bar, fills the
     monitor's work area with the taskbar still showing. **Restore**, or
     dragging, returns it. Checked: it fills the work area exactly and restores
     to the previous rect.
   - **Remembers:** the last size and position go to
     `%LOCALAPPDATA%\tt-window\companion.json`. The panel reopens there if that
     spot is still on a screen, and centred otherwise. Checked by editing the
     file.
   - **Not checked by script:** dragging the bar, since that needs a real mouse.
7. **Reopening the window just works.** When its server goes, the companion
   reads `server.json` again and follows a new server instead of exiting.
   `open` sees a running companion (its named mutex) and doesn't rebuild over
   its locked exe; it prints `ui=companion (already running)`. Checked: after a
   close and an open, the same process connected to the new port.
8. **Two traps for testing.**
   - A PowerShell probe isn't DPI-aware, so on a 200% display it sees halved
     coordinates. The companion's own numbers are real pixels.
   - A WPF tray app ignores `taskkill`'s polite close and needs `/F`, which
     skips saving the panel's bounds.
9. **Not yet tried:**
   - several monitors and mixed DPI, which is coded (the work area under the
     pointer, placing twice) but untested;
   - dark mode, where the bubble frame stays light;
   - a full-screen Unity Editor;
   - the companion and the mod together in a live Claude session.

## An application on the taskbar, and Alt-Tab for the panel only

Tatty was a tray tool: no taskbar button, no Alt-Tab entry, no window icon, and
the tray the only way back. The wanted end was a button always, Alt-Tab for the
full and maximised panel only, the compact bubble still over everything, and no
rebuilding of the runtime when the view changes -- that last one ruling out
anything that recreates the window, since the panel's WebView2 and everything
unsaved in the page would go with it.

What the shell actually does, measured on Windows 11 rather than taken from the
documentation. `tools/window-check.py` was written first, so each answer is a
reading rather than an impression:

1. **`ShowInTaskbar="False"` does not use `WS_EX_TOOLWINDOW`.** WPF gives the
   window a hidden owner window instead and clears `WS_EX_APPWINDOW`; an owned
   window is left out of the taskbar and Alt-Tab. The probe sees it: both windows
   report a non-zero owner, each a separate `"Hidden Window"` of WPF's making.
   `WS_EX_APPWINDOW` is the way back in, because a window that has it is treated
   as if it had no owner. Nothing needs to touch `GWLP_HWNDPARENT`.
2. **The style flip is live.** Clearing `WS_EX_TOOLWINDOW` and setting
   `WS_EX_APPWINDOW` on the window we already have puts the panel in Alt-Tab and
   on the taskbar at once, with no hide and show to make the shell read it again.
   A `Reregister` helper was written for that and deleted when it proved
   unnecessary. The panel's icon-less, caption-less chrome is no obstacle either:
   it appears with its title and Tatty's face.
3. **`ITaskbarList::AddTab` does nothing here.** It is the documented way to give
   a window a taskbar button it would not otherwise get, which would have let the
   compact bubble have a button without an Alt-Tab entry. Tried on a tool window
   with a caption and a system menu, both before and after the window was shown:
   no button either way. The COM declaration was deleted with it.
4. **So taskbar presence and Alt-Tab presence are the same bit** -- except for
   `WS_EX_NOACTIVATE`, which is the seam the design turns on. Its documentation
   says such a window "does not appear on the taskbar by default. To force the
   window to appear on the taskbar, use the `WS_EX_APPWINDOW` style", so the two
   are read separately; and a window that will never come forward is no use to
   the switcher, which leaves it out. Both halves hold:
   `WS_EX_APPWINDOW | WS_EX_NOACTIVATE` gives a button and no Alt-Tab entry.
   This is not in the documented Alt-Tab rule, so `window-check.py` says where it
   came from.
5. **A hidden window cannot be woken from a taskbar button.** The shell cannot
   activate a window without `WS_VISIBLE` and `ITaskbarList` has no callback, so
   the always-there button cannot belong to the bubble, which is hidden whenever
   Tatty is tucked away. Hence `TaskbarProxy`: one pixel, off every screen,
   minimised for good, `WS_EX_APPWINDOW | WS_EX_NOACTIVATE`, styles that never
   change. Being minimised is what makes it work -- a click on its button arrives
   as `WM_SYSCOMMAND`/`SC_RESTORE`, which it refuses, popping Tatty up instead.
   Checked by hand: button there with nothing on screen, no Alt-Tab entry,
   clicking it brings Tatty back.
6. **Exactly one button.** While the panel is out it has one of its own, so the
   proxy stands down (hidden) and comes back when the panel goes. `Apply()`
   decides it, driven by every change of shape *and* of visibility, so the two
   cannot both have one.
7. **Minimise is a real minimise**, and it composes with the panel's own
   maximise, which is still an ordinary window moved to the work area rather than
   `WindowState.Maximized`: the restore comes back to that rectangle with the
   bookkeeping intact. WPF's `StateChanged` and `Activated` carry all of it, so
   no window message hook was needed. Two things fell out of having it:
   - `SaveBounds` would have written the icon's rectangle -- a minimised window's
     is `(-32000, -32000)`. It now saves the last real one, and refuses anything
     under 100 pixels.
   - Windows' own maximise (Win+Up, dragged to the top) arrives as
     `WindowState.Maximized`, which the panel's bookkeeping knew nothing about,
     so the page's button still said "Maximise". It is taken over on arrival and
     turned into the panel's own kind of maximised.
8. **The taskbar button's menu offers Close.** Left alone, `WM_CLOSE` would
   destroy the bubble and its WebView2 and leave a tray app with nothing behind
   it, since the app's shutdown mode is explicit. Both the panel and the proxy
   refuse it and tuck Tatty away instead -- but refusing it *unconditionally*
   cancels `Application.Shutdown` as well, which left the companion running with
   its windows already destroyed and WebView2's browser window re-parented onto
   some other window of the process. That is what `BubbleWindow.Quitting` is for,
   set by `App.Quit` before every shutdown, and `test-companion.sh` ends by
   checking the process really does leave when its server does.
9. **Staying on top needed saying twice.** Topmost is only a promise about the
   windows that were there first; the next window to declare itself topmost sits
   over Tatty. A foreground `SetWinEventHook` says it again, with no timer asking
   the desktop every second -- and not over the shell (`WorkerW`, `Progman`,
   `Shell_TrayWnd`), not over a window with a whole monitor to itself, and not
   while the full panel is out. `Native.MoveTo` also used to re-assert
   `HWND_TOPMOST` on every placement, which would have dragged the expanded panel
   back on top; z-order is now decided in one place.
10. **An explicit AppUserModelID**, because the exe lives in a folder named after
    the plugin's version. Without one the shell works identity out from the path
    and calls Tatty a different application after every update, losing the
    button's place and history. Pinning is still not worth it, as a pinned
    shortcut records the versioned path.
11. **Still not checked by script:** that the switcher's own list matches the
    documented rule (it cannot be enumerated, so `window-check.py` computes the
    rule and the real thing is eyeballed); the taskbar button's icon and label;
    restoring from the button; several monitors at mixed DPI; virtual desktops,
    where Tatty stays on the desktop he was put on (pinning to all of them needs
    an undocumented interface and was left alone).

## Features: seeing the workflow

The full panel (and the browser page) now opens on **Features**: the features
being worked on, one card per subfolder of `<root>/features`. A card shows:
- the route (Feature, Small change, Bug, New) and the phase;
- one line of where it stands;
- a progress bar while building;
- the next command, with Copy;
- when it last changed.

It re-scans every 30 s. Clicking a card opens the **feature page**:
- **Documents on the left**, in workflow order (Familiarisation, then
  Comprehensive Tech Plan … Task Status, Lite Brief, Debug Report). The
  `.tt/` working notes are folded underneath. Each document opens in place, and
  `[[wikilinks]]` and `Doc.md` links between documents open in place too.
- **Overview:**
  - a tracker of the route's steps (Explore, Plan, Breakdown, Build, Done; lite
    and bug routes have their own). Under Plan, the planning stages come from a
    draft plan's Stages table, or are all closed and dated from the ledger
    once it is signed off;
  - "Where it stands", with the next command and any alternatives or warnings;
  - the work units with their status;
  - a timeline from the events ledger.

The old Status, Connections and Docs tabs moved to a **Toolbox** page. The chat
is a right-hand column you can hide.

**The root folder.** It is set from the Features page the first time: **Create
~/Tatty**, or **Choose a folder…**. Later, **Change…** beside the root on the
Features page, or **Change root folder…** in Tatty's tray menu, sets it again.
- The folder is always chosen in **Windows' own folder dialog**, never typed. A
  browser page can't learn a real folder path, so the dialog comes from the
  native side:
  - In the companion, the page asks the host, which opens WPF's
    `OpenFolderDialog` in front of the bubble and answers `picked:<folder>`.
  - In a browser tab, `POST /api/pick-folder` has the server run
    `TtCompanion.exe --pick-folder`, a one-off mode with an invisible topmost
    owner window so the dialog comes to the front.
  - A typed path is offered only where there is no dialog (not Windows).
  - Picking a folder that is itself called `features` makes its parent the root.
  - Checked: in `--pick-folder` mode the dialog is the foreground window,
    Cancel writes nothing (exit 1), and Select writes the folder (exit 0). The
    tests swap the dialog for a script (`TT_WINDOW_PICKER`), and the Edge walk
    covers the first-run buttons and **Change…**.
- `tt-common/scripts/tatty-root.sh` keeps the setting, one line in
  `~/.claude/tatty/root`. The root itself is refused inside `.claude`.
- `server.py` reads the same file.
- `tt-workflow new` and `tt-workflow-lite` now offer `<root>/features` first
  when choosing where a new feature goes, through `workflow.sh root`, so new
  features appear on the page by themselves.

**Starting the next step.** Every command on a feature page has a **Start…**
button: the next step, and any alternatives or warnings that name a command.
- It opens a panel showing:
  - the project (repo) the new session will run in, with **Change…** through
    the folder dialog;
  - the exact command;
  - the session's name (`<Feature> : <Stage>`);
  - a box for any `<placeholder>`, such as `<idea, spec or ticket>`.
- **Start session** has the server open a new Claude session in a new
  terminal, started with that command. It goes through `session-handoff.sh
  --stage … --run …`, which handles naming, de-duplication and Windows
  Terminal; an empty feature uses `new-session.sh`.
- The server always sets `TT_SESSION_TERMINAL=wt`, so a background process
  never types into a Rider terminal.
- In the companion, Tatty first calls `AllowSetForegroundWindow`, so the new
  terminal can open in front.
- **The project is found in this order:**
  1. one chosen on the feature page, kept in `~/.claude/tatty/projects.tsv`;
  2. a tt-workflow or tt-workflow-lite link to the folder;
  3. the events ledger's `project`;
  4. a `Repo` path in the feature's documents.
  
  With none of these, Start asks you to choose one.
- **Checked:** the server builds the command itself from the step (the page
  sends only which step and the placeholder values). The tests run in dry run
  (`TT_WINDOW_DRYRUN=1`): the name and command, placeholders required, the
  project's source, and a remembered choice. In Edge: choose a project, then
  Start session, then the result. A real terminal launch from the server was
  left for the live trial.

**Watching a started session.** While a session Start opened is running, its
feature page shows an **active session panel** in place of "Where it stands"
(which a button brings back, to start something else). The panel shows:
- its status: opening, working on a tool, waiting for your answer, idle,
  not heard from, or ended;
- a live list of what it does: each tool call as it starts, then ✓ or ✗, your
  prompts, and its replies (long ones folded);
- its questions, answered in place;
- a box to message that session alone.

When the session ends, "Where it stands" comes back (refreshed), and the
session is kept below it as "Last session". Home cards show **● Live** while a
feature has a session going.
- **How:**
  - Start launches the new session with the tt-window mod loaded
    (`--plugin-dir`) and a tag in its launcher, `TT_WINDOW_SESSION=s-…`.
    `new-session.sh` gained `TT_SESSION_EXPORTS` and `TT_SESSION_CLAUDE_ARGS`,
    because a new Windows Terminal tab doesn't inherit the server's
    environment.
  - The tagged mod posts `/api/activity` for every tool call (before and
    after), prompt and reply. It never waits on the window, and it is wrapped in
    `.catch`, so it can't hold up a tool.
  - Its asks, messages and hello/bye carry the tag. The server keeps a registry
    of started sessions, with their status derived from when the mod was last
    heard from, and an inbox per tag.
  - The feed keeps the main session's conversation and every question, so the
    bubble still pops up for a started session's question. Tagged activity and
    replies go only to the feature page.
- **Checked:**
  - The mod reports tagged tool calls, and the main session reports nothing.
  - Server tests cover the registry, status, activity, tagged questions,
    per-session inboxes and ending.
  - The full loop in Edge: Start, then the panel replaces "Where it stands",
    then hello, Read …, ✓, Edit ✗, a question answered in the panel (with the
    feed's copy closed too), a markdown reply, a message reaching only that
    session, then ended, "Where it stands" back, and "Last session". A reload
    rebuilds the panel from the replayed history.
- **Not yet tried:** a real session opened by Start reporting in live, which
  needs `--plugin-dir` to load the mod in a fresh terminal.

**Links between documents.** Obsidian links open in place, at the part they
name:
- the forms handled: `[[Doc]]`, `[[Doc|label]]`, `[[Doc#Heading]]`,
  `[[Doc#H1#H2]]`, `[[Doc#^r12|R12]]` (the block ids `ids.sh` writes),
  `[[#Heading]]`, `![[Doc]]` (shown as a link), and in tables `[[Doc\|label]]`.
  Markdown links `[x](Doc.md#heading)` and `[x](#heading)` work the same way.
- **Blocks:** a trailing ` ^r12`, or a `^r12` line under a block, becomes an
  anchor on its item, paragraph or table row, and is no longer shown.
- **Finding the document:** by file name, any case, in this feature first,
  then in the other features under the root (`/api/resolve`). A link to
  nothing is marked broken and says why when hovered.
- **Landing:** the address gains `/at/<heading or ^block>`. The page scrolls
  there and briefly highlights it. Headings are matched on their letters and
  digits only (so `§`, punctuation and `code` don't matter), and Back works. A
  link within the open document only scrolls. A part that isn't there says so,
  and the document opens at the top.
- **Feature folders can be links,** for example a junction from
  `~/Tatty/features/<name>` to a feature folder in a vault. Documents are
  checked against where the folder really is, and the ledger, links and
  project are matched under either path.
- **Checked:**
  - In Edge on the fixtures: every form above, plus a cross-feature link,
    Back, a broken link, a code-span heading and an escaped-pipe link in a
    table.
  - Read-only on the real Fleet Steering and Combat Shape folders, through a
    junctioned root: the phases, 14 ledger events, and **all 23 distinct
    heading links in the Fleet Steering Tech Plan landed**. One had missed
    until code spans in targets were read as plain text.

**Findings**
1. **Nothing new had to be recorded.** `workflow-state.sh --tsv` already gives
   phase, stage and next command for each feature. The Stages table, the Work
   Unit Board and the ledger (with `folder` on every row) supply the rest.
   - The table parser maps columns by header name, as `units_done()` does.
   - The route comes from the documents as well as the phase, because a lite
     feature that is building has the same phase as a full one.
2. **A signed-off plan has no Stages table**, since it is removed at sign-off.
   So its stages are shown as closed and dated from `plan.*_closed` events,
   when the ledger has them.
3. **Path safety.** A feature must be a direct subfolder of `features`. A
   document must be a `.md` file in that folder or under its `.tt/`, checked
   after resolving links. Tests cover traversal, a non-`.md` file and an
   absolute path.
4. **The page's CSP blocks inline `style=` attributes,** so the progress bars
   set their width from script.
5. **Checked in headless Edge** with `tools/window-features-check.py`: the home
   cards and bar width, the Demo tracker (Build current, the plan's stages
   closed), its documents, units and timeline, the Draft tracker (Plan current,
   Scope in progress, Familiarisation skipped), opening a document, and
   following a `[[wikilink]]` in place. Companion mode was checked too: compact
   hides the pages, Full panel opens Features, and Compact goes back.
6. **Live, it needs a restart of the window server** (`/tt-window close`, then
   `open`), because the old server has none of the new endpoints. The running
   companion follows the new server by itself.

## Open questions for Copilot CLI and Codex CLI

- **Sandbox networking.** Codex's default sandbox may block network access,
  127.0.0.1 included. If it does, `window.sh` calls fail until the sandbox
  allows it. Check before promising Codex support.
- **Allow-listing.** How each agent pre-approves `bash …/window.sh *`, so that
  waiting for a click doesn't raise a terminal prompt first.
- **Hooks or plugins.** Whether either agent has something like the mod, to take
  over its own question tool or to inject a prompt. Without one, they get the
  bridge path only: questions and showing, with chat only while listening.

## Trying it

The live `/tt-guide` and every junction in `~/.claude/skills` still point at the
main clone. Nothing below changes them. **Don't run `guide.sh update apply` from
the worktree**, because it would relink every skill to the worktree.

1. `bash plugins/tt-window/dev-link.sh` (once). This links the spike's tt-guide
   into the plugin.
2. Start a session in the worktree with the mod:
   `claude --plugin-dir P:\Claude\Tims-AI-Toolbox-window\plugins\tt-window`
3. Run these, noting what happens:
   - [ ] `/tt-window:tt-guide window`: the browser opens with the greeting and a
         status table, and the Status, Connections and Docs tabs load.
   - [ ] Type "which skill do I use for a bug?" in the window. It arrives as
         your prompt, and Tatty's answer appears in the window.
   - [ ] `/tt-window:tt-guide update`: the go-ahead question is in the window.
         Click **No**, and nothing is pulled.
   - [ ] `/tt-connections`, an unchanged skill: its Yes / Skip question appears
         in the window through the mod.
   - [ ] "Answer in terminal instead": the terminal dialog appears.
   - [ ] `/tt-window close`: questions come back to the terminal.
4. **Without the mod.** In a plain `claude` session in the worktree, ask Claude
   to follow `tt-guide/SKILL.md`'s "The window" section by hand. Note the
   permission prompts, the timeouts, and how `listen` feels.
5. **Afterwards.** In a normal session, `/tt-guide` should be the main version.

## Recommendation

Hold until the live trial in "Trying it" is done. If it goes well, the shape to
keep is **bridge first, mod as an extra**: one server and page, the bridge as
the contract every agent uses, and the Claude mod for automatic questions and
typed prompts.

---

## tt window (spike): a local HTML window for questions, status and docs

- **Date:** 2026-10-21
- **Branch:** `spike/tt-window`. A spike: kept apart from `main` until it is judged.

## Added
- `tt-common/window/server.py`: a Python standard-library server on 127.0.0.1 with a random port and token (`server.json` under `TT_WINDOW_HOME`, by default `~/.claude/tt-window`). It holds cards, questions and typed messages in memory, streams them to the page over SSE, and runs a fixed allow-list of read-only scripts (`workflow-state.sh --tsv`, `connections.sh status`, `guide.sh about|start`, `tatty.sh banner`) for the page's Status, Connections and Docs tabs.
- `tt-common/window/web/`: the page. No CDN or libraries. It has a conversation feed, question cards (single or multi choice, Other, "Answer in terminal instead") and a chat box.
- `tt-common/scripts/window.sh`: the bridge any agent can call (`open`, `status`, `show`, `ask`, `answer`, `listen`, `close`). Exit 3 means no Python, 5 means no answer yet, 6 means declined.
- `plugins/tt-window/`: a Claude Code mod, loaded with `claude --plugin-dir`. It asks every `AskUserQuestion` in the window while it is open, submits typed messages as the user's prompt, mirrors each answer into the window, and adds `/tt-window [open|close|status]`. `dev-link.sh` links this checkout's tt-guide into it as `/tt-window:tt-guide`.
- `tools/test-window.sh`: 43 checks for the bridge, the server and `guide.sh window`. `plugins/tt-window/hooks/register.test.tsx`: 3 tests for the mod's question routing and its fallbacks.
- `tools/window-page-check.py`: drives the page in headless Edge or Chrome over the DevTools protocol. It reports what rendered and can answer a question or send a message the way a person would.
- `docs/spikes/2026-10-21-tt-window.md`: what the spike set out to learn, and what it found.

- `tt-common/window/companion/`: **Tatty, the tray companion** (Windows, .NET 9 WPF + WebView2). It is a tray icon, plus a transparent always-on-top Tatty and a speech bubble that shows the page in a compact layout. It pops up for questions and replies, tucks away when nothing waits, and expands into the full panel. `window.sh open` builds it the first time and starts it in place of the browser tab; `TT_WINDOW_UI=browser` keeps the tab.
- The companion's full panel moves (drag its bar), resizes from any edge, maximises to fill the monitor (button or double-click) and reopens where it was left. When the window is closed and opened again, the running companion follows the new server.
- **Features pages** in the window and the companion's full panel. The home page lists the features under Tatty's root folder (`<root>/features/*`); a feature page shows where the feature stands (route tracker, planning stages, next command, work units, timeline), with all its documents on the left, readable in place. The old tabs moved to a Toolbox page, and the chat became a right-hand column you can hide.
- `tt-common/scripts/tatty-root.sh`: Tatty's root folder (default `~/Tatty`, never inside `.claude`), set from the Features page or with `tatty-root.sh set <path> [--create]`. Server endpoints: `/api/root`, `/api/features`, `/api/feature`, `/api/doc`.
- The root folder is chosen in Windows' own folder dialog: **Choose a folder…** on first run, **Change…** on the Features page, **Change root folder…** in Tatty's tray menu. The companion opens the dialog itself; for a browser tab the server runs `TtCompanion.exe --pick-folder` (`POST /api/pick-folder`). A typed path remains only where there is no dialog.
- **Start…** on a feature page: opens a new Claude session in the feature's project (repo), started with that step's command, named `<Feature> : <Stage>` (through `session-handoff.sh`). The project comes from a choice on the page, a tt-workflow link, the events ledger or the documents; `POST /api/start`, `POST /api/project`. Placeholders such as `<idea, spec or ticket>` are filled in the panel first.
- **Active session panel** on a feature page. A session Start opened loads the tt-window mod and a tag, then reports each tool call, prompt and reply. The page shows them live in place of "Where it stands", with the session's questions to answer in place and a box to message it; home cards show **● Live**. New endpoints: `POST /api/activity`, `GET /api/sessions`, and per-session (`tag`) asks, messages, inboxes and hello/bye.
- `new-session.sh`: `TT_SESSION_EXPORTS` (variables for the new session) and `TT_SESSION_CLAUDE_ARGS` (extra `claude` arguments).
- **Document links** open in place at the heading or block they name: `[[Doc#Heading]]`, `[[Doc#H1#H2]]`, `[[Doc#^block|label]]`, `[[#Heading]]`, `![[Doc]]`, `[[Doc\|label]]` in tables, and Markdown `Doc.md#heading` links. They are found by name in the feature, then under the whole root (`GET /api/resolve`). Obsidian block ids (` ^r12`) become anchors, and a broken link is marked.
- Feature folders under the root may be links (junctions), e.g. to features kept in a vault.
- `workflow.sh root` (and `lite.sh root`): Tatty's features folder. `tt-workflow new` and `tt-workflow-lite` offer it first as the parent for a new feature.
- `tools/window-features-check.py`: walks the Features pages in headless Edge (or the companion), like a person would. `tools/fixtures/tatty-root/`: four fixture features (building, planning, a bug, empty).
- `tools/window-page-check.py attach <port>`: drives a page already open in the companion's WebView2.

## Changed
- `tt-guide`: a `window` argument and a "The window" section. While the window is open, gates are asked there, things worth reading are shown there, and typed questions are listened for (unless the Claude mod delivers them). `allowed-tools` gains `AskUserQuestion`.
- `guide.sh window ...`: a passthrough to `window.sh`. `window open` also shows the greeting and where the documents stand.
- `server.py`: views and the server run with a hidden console (`CREATE_NO_WINDOW`), so pressing a button in the window no longer opens a terminal. `open` prints `ui=companion|browser`.
- The page keeps its `?mode=` query when it strips the token from the address bar.
