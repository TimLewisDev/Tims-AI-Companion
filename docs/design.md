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
  - The full panel moves, resizes, maximises and remembers its place.
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
  132 checks against a real toolbox, with a toolbox-free part when there's no
  toolbox.
- `claude plugin test plugins/tatty` covers the mod, including the joining
  rule.
- `tools/page-check.py` and `tools/features-check.py` drive the page in
  headless Edge or Chrome, or the tray app's WebView2 with `attach <port>`.
