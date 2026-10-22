# How Tatty is built

Tatty is a user interface over the TT toolbox's workflow, kept separate from the
toolbox. See [toolbox-contract.md](toolbox-contract.md) for what Tatty takes
from the toolbox, and [history.md](history.md) for how it was worked out.

```
 Claude Code session (joined)                        Tatty's window
   tatty mod ──── HTTP, token ────▶  app/server.py  ◀──── SSE / HTTP ────  app/web (the page)
     · AskUserQuestion → Tatty       127.0.0.1 only       shown in the tray app (app/companion,
     · typed text → the prompt       state in              Windows: WPF + WebView2) or a browser tab
     · replies, activity → Tatty     ~/.claude/tatty
                                          │
                                          ├── reads: feature folders, the toolbox's ledger and links
                                          ├── runs (read-only): the toolbox's workflow-state.sh, …
                                          └── opens: new Claude sessions (Start), with TATTY_SESSION
```

## The pieces

- **`app/server.py`:** the hub, standard-library Python.
  - It listens only on 127.0.0.1, behind a random token and a Host check.
  - It keeps the conversation, questions, sessions and inboxes in memory.
  - It streams events to the page over SSE.
  - It serves the read-only views: features, documents, link resolution,
    toolbox status.
  - It owns Tatty's root folder and launches sessions.
- **`app/web`:** the page, with no libraries and no network beyond the server.
  - **Companion mode** is a compact speech bubble: the feed, questions and chat.
  - **The full panel** has the Features, feature and Toolbox pages, with the
    chat as a right-hand column.
  - It has its own small markdown renderer, which handles Obsidian links and
    block ids.
- **`app/companion`:** the Windows tray app (.NET 9 WPF and WebView2).
  - Tatty himself is a transparent, topmost, non-activating window drawn in
    XAML.
  - The bubble is an opaque WebView2 window with Windows 11's rounded corners,
    because WebView2 can't draw in a transparent window.
  - The full panel moves, resizes, maximises, minimises and remembers its place.
    Only Tatty and the compact bubble stay on top, and they say so again whenever
    another window comes to the front -- though never over the shell, over a
    window with a whole monitor to itself, or while the full panel is out. The
    full and maximised panel are ordinary windows that other windows can cover. A
    click on Tatty raises a covered full panel, and tucks it away when it is
    already in front.
  - **Tatty is an application on the taskbar**, and only the full and maximised
    panel is in Alt-Tab. Those are the same style bit, so they are kept apart by
    two windows: the panel asks for `WS_EX_APPWINDOW` while it is out, which puts
    it in both; and `TaskbarProxy` -- one pixel, off every screen, minimised for
    good, never able to come forward -- holds the button the rest of the time, so
    there is always exactly one and it works even while nothing is on screen.
    `BubbleWindow.Apply()` decides all of this in one place, and the window is
    never recreated, because the page and its WebView2 would go down with it.
  - There is a tray icon and menu.
  - It watches the server's events to pop up and tuck away, and follows a
    reopened server.
  - It is built from a copy of its sources into `%LOCALAPPDATA%\Tatty`, never
    inside the plugin's folder.
- **`hooks/register.tsx`:** the mod. It acts only in **joined** sessions: one
  Tatty started (it carries `TATTY_SESSION`), or one where `/tatty open` or
  `/tatty attach` was run. In a joined session it:
  - routes AskUserQuestion to Tatty, falling back to the terminal dialog;
  - submits text typed in Tatty;
  - mirrors replies.

  A session Tatty started also reports each tool call, prompt and reply for its
  feature page. Every other session is untouched.
- **`scripts/tatty.sh`:** the command line (open, close, status, show, ask,
  answer, listen). Any agent that can run a shell command can use it.
  **`scripts/tatty-root.sh`:** the root setting. It never accepts a root
  inside the Claude folder, whichever way the path is spelled.

## Features and the workflow

- **The root folder:** Tatty's root (default `~/Tatty`, chosen in Windows' own
  folder dialog) holds `features/<feature>/`. A feature folder may be a junction
  to a folder elsewhere, a vault say.
- **The Features page** lists the features, using the toolbox's
  `workflow-state.sh` for where each stands.
- **A feature's page** reads its documents, the toolbox ledger's events for it,
  and the tables in its Task Status and draft plan.
- **A document** has a View | Edit toggle above it (`showDoc` in `features.js`),
  remembered for the session. View picks a viewer by the document's kind from
  the `VIEWS` registry in `views.js` (today `Challenges`, as cards, and
  `Task Breakdown`, as work-unit groups of foldable tickets with status read from
  the Task Status through `ctx.sibling`; other kinds, or a file the viewer can't
  read, show the plain markdown). A link to a ticket opens the folds around it
  (`goToTarget`). Edit is a
  textarea whose Save posts to `/api/doc/save`: the path guard `doc_path`, a
  modified-time check against the version the page read (409 if it moved on),
  and an atomic write. To add a viewer, add a parser and a function to `VIEWS`.
- **New feature…** makes the folder. **Start** then runs the workflow's own
  `/tt-workflow "<folder>"`, so the toolbox links and starts the feature.
  Tatty never changes the workflow's records.
- **Start session:**
  - It opens a terminal with `claude -n "<Feature> : <Stage>" "<command>"` in
    the feature's project. The project comes from a choice on the page, a
    tt-workflow link, the ledger, or a `Repo` path in the documents.
  - It sets `TATTY_SESSION=<tag>` in the launcher script, because a new
    Windows Terminal tab doesn't inherit environment variables.
  - From a checkout it also passes `--plugin-dir`, so the new session loads the
    mod.
  - The feature page then swaps "Where it stands" for that session's live
    panel.

## Tests

- `tools/test-tatty.sh` covers the server, the scripts and the pages' data:
  155 checks against a real toolbox, with a toolbox-free part when there's no
  toolbox.
- `claude plugin test plugins/tatty` covers the mod, including the joining
  rule.
- `tools/page-check.py` and `tools/features-check.py` drive the page in
  headless Edge or Chrome, or the tray app's WebView2 with `attach <port>`.
- `tools/window-check.py` reports what the shell makes of the companion's
  windows -- the styles that decide the taskbar and Alt-Tab, who holds the
  button, what is on top -- and asserts the lot for one view with
  `--expect <view>`. With `--switch <view>` it changes view through the page's
  own buttons and checks that the window, its WebView2 and the loaded page all
  came through unchanged, which is the promise that a view switch never rebuilds
  the runtime.
- `tools/test-companion.sh` walks every view with it (compact, full, maximised,
  minimised, restored, tucked away and back). It is the only test that builds
  and runs the exe and shows real windows, so it is opt-in rather than part of
  `test-tatty.sh`.
