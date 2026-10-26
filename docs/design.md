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
                                          ├── follows: the ledger as it is written → milestone events
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
  - **The full panel** has the modes, mode home, Features, feature and Toolbox
    pages, with the chat as a right-hand column.
  - It has its own small markdown renderer, which handles Obsidian links and
    block ids.
- **`app/companion`:** the Windows tray app (.NET 9 WPF and WebView2).
  - Tatty himself is a transparent, topmost, non-activating window drawn in
    XAML. He moves, celebrates and makes a noise: see
    [Tatty's own life](#tattys-own-life) below.
  - The bubble is an opaque WebView2 window with Windows 11's rounded corners,
    because WebView2 can't draw in a transparent window.
  - The full panel moves, resizes, maximises, minimises and remembers its place.
    Only Tatty and the compact bubble stay on top, and they say so again whenever
    another window comes to the front -- though never over the shell, over a
    window with a whole monitor to itself, or while the full panel is out. The
    full and maximised panel are ordinary windows that other windows can cover. A
    click on Tatty raises a covered full panel, and tucks it away when it is
    already in front -- unless something is calling for you, when it opens the
    full panel on the page that is about.
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
- **`app/launcher` and `assets/`:** Tatty as a desktop program (Windows).
  - `Tatty.exe` is a thin WinExe, built by `/tatty install` into
    `%LOCALAPPDATA%\Tatty\launcher`, that the Desktop and Start menu shortcuts run. It
    finds the plugin (`boot.json`, else Claude Code's `installed_plugins.json`) and
    runs `tatty.sh boot` hidden, so a plugin update never breaks the shortcut. The
    shortcuts carry the AppUserModelID the tray app names itself with
    (`TimsAICompanion.Tatty`), so a taskbar pin and the running window are one button.
  - `server.py boot` starts the server, shows the tray app (or rings the running
    one's `Local\tatty-companion-show` event, which brings it forward) and starts
    **Tatty's own Claude session**: a titled terminal window (`Tatty (Claude)`;
    `wt -w new --suppressApplicationTitle`, so Claude can't rename it) running
    `claude --resume <id>`, or `--session-id <id>` before the conversation has a
    message. The id and the folder are `claude-link.json` in Tatty's home. The window
    is found by its title (`find_window`) and minimised the moment it exists
    (`minimise_window`); if the session's mod hasn't joined within `MOD_WAIT` it is
    brought up instead, since it is most likely asking something (trust this
    folder). The tray's "Show Claude's terminal" and quitting go through the
    server's `/api/claude/show|close`.
  - The icon is `assets/tatty.ico`, drawn natively at each size by
    `tools/make-icon` (which also writes the plugin's `icon.png`) from the same
    geometry as `TattyWindow.xaml`'s head. It is built into both exes as their file
    icon and as the resource the tray and windows load.
- **`hooks/register.tsx`:** the mod. It acts only in **joined** sessions: one
  Tatty started (it carries `TATTY_SESSION`), Tatty's own (it carries
  `TATTY_JOIN=1`, and works on the main feed), or one where `/tatty open` or
  `/tatty attach` was run. In a joined session it:
  - routes AskUserQuestion to Tatty, falling back to the terminal dialog (the
    page lays a challenge question out for reading: tag chips, the description,
    the evidence as a list, "My take" in italics at the bottom and the closing
    ask in bold above the options; text it does not recognise shows as written,
    and the answer is still keyed by the raw question — `parseQuestion` in
    `app/web/app.js`);
  - submits text typed in Tatty;
  - mirrors replies.

  A session Tatty started also reports each tool call, prompt and reply for its
  feature page. Every other session is untouched.
- **`scripts/tatty.sh`:** the command line (open, close, boot, install, uninstall,
  status, show, ask, answer, listen). Any agent that can run a shell command can use it.
  **`scripts/tatty-root.sh`:** the root setting. It never accepts a root
  inside the Claude folder, whichever way the path is spelled.

## Tatty's own life

Tatty is meant to be noticed when it matters and good company when it doesn't.
Three files do that, and the drawing stays out of all of them:
`TattyWindow.xaml` is a drawing with every moving part named, `Avatar.cs`
animates those parts, `Effects.cs` throws things about him and `Sounds.cs` makes
the noise.

- **The rig.** He is 104x120 of drawing in a 104x156 window: a window clips
  whatever leaves it, so there are strips above and below him to jump and to sit
  down into (`TattyWindow.TopInset` and `BottomInset`). Anything placed against
  him measures from those, not from the window's edges, or the bubble would float
  over an empty strip. The root transforms move all of him, `Body`'s move
  everything above the knees, and each leg has a lift and a fold of its own, so
  he can shift his weight from foot to foot and fold them under to sit. The mouth
  is three shapes with one shown at a time, which is steadier than animating a
  shape, and the eyes' one blink transform doubles as his eyelids: half closed
  dozing, nearly shut asleep.
- **The ladder** (`Avatar.cs`). Left alone 45 seconds he starts to fidget -- a
  look about, a dance from foot to foot, a stretch, a sit down for a minute --
  after five minutes he dozes and yawns, and after ten he is asleep, sat down
  with Z's drifting off him. `Poke()` is the only thing the rest of the app has
  to remember: every server event, and every hover, click and drag, is one, and
  it stands him up with a start. `TATTY_ANIM_FAST=1` divides every one of those
  waits by nine, because nobody wants to wait ten minutes to see whether he
  snores. Two properties are owned outright so the clocks can't fight over them:
  the bob owns `BodyShift.Y` and the blink owns `Blink.ScaleY`, which is why a
  performance uses the root transforms, the legs and the pupils instead. One
  performance runs at a time; a fidget that misses its turn is dropped, and the
  two that are the whole point -- a question, a milestone -- cut in.
- **The stage** (`Effects.cs`) is a window of its own, nearly three times his
  size, holding the confetti, the rings and sparks that pulse while a question
  waits, and the Z's. It is **click-through** (`Native.MakeClickThrough`), which
  is both why it can be that big -- Tatty's own window is clickable all over,
  since that is how he is dragged, so a stage that size would take the corner of
  the desktop out of use -- and how the shell tells the two apart, which
  `tools/window-check.py` relies on. It shows itself for the first particle and
  hides after the last, and everything on it is drawn in Tatty's own coordinates
  plus the offset to the middle of the stage, so its numbers line up with the
  XAML's.
- **The noise** (`Sounds.cs`) is worked out rather than shipped, for the same
  reason the icon is drawn in code: a cue is a handful of bell-ish notes mixed
  into a few kilobytes of PCM and played from memory. There is a chime for a
  question and a flourish for a milestone, one at a time and never two on top of
  each other.
- **Milestones.** The toolbox writes a feature's progress into its ledger as it
  happens; `watch_ledger` in `server.py` follows that file and emits a
  `milestone` event for each row in `MILESTONES`, with a tier: *big* for a plan
  signed off or a build complete, *mid* for a piece of work done, *small* for a
  step taken. It starts from the end of the ledger as it stands, so a window that
  has just opened doesn't celebrate last week's work, and it remembers the keys
  it has announced, so a re-read can't celebrate twice. The companion jumps,
  throws confetti and plays the flourish; the page adds a card and confetti of
  its own (`milestoneCard` and `confetti` in `app.js`). `tatty.sh cheer [<event>]`
  does the lot on demand, which is how it is tried out and tested.
- **What is calling, and where it goes.** A question, a finished milestone and a
  Claude reply each carry a `link`: the page route they are about (`#feature/<name>`,
  or `#tasks/<board>` for a task board's milestone), empty when nothing links
  them to a page. The server works it out (`feature_link`; `folder_feature` for a
  milestone, whose ledger row names a folder, not a feature), and a milestone also
  carries the ledger row's `skill` and the `feature`. The compact bubble shows the
  newest of these in a banner above the feed (`#alert`, `alerts` in `app.js`):
  the question's text, or what finished and by which skill, with "+N more" when
  others wait. A question stays until it is answered; a milestone or a reply
  goes when opened or dismissed. Clicking the banner, or Tatty himself while
  something is calling (`alertWaiting`, `OpenAlert` in `App.xaml.cs`), opens the
  full panel on that page: the host expands the window and posts `open-alert`,
  and the page sets the route. A question with no page of its own is answered in
  the feed, which is brought to it. Replies from started (tagged) sessions are
  not alerts: they stay in their feature page's session panel.
- **His menu** (`MakeMenu`) is one `ContextMenuStrip` shown in both the places a
  person reaches for it: the tray icon, and a right-click on Tatty himself. Its
  **Preview** submenu (`PreviewMenu`) is the catalogue of his whole repertoire --
  every performance, every pose he holds, the stage's confetti and pulses, each
  sound on its own, and the two whole reactions exactly as they arrive -- so any
  of it can be watched on purpose rather than waited for. A preview cuts in and
  winds the fidget clock back, so what was picked is what is seen
  (`Avatar.Preview`); a pose stays until something really happens. Items whose
  toggle is off are shown disabled, which says more than doing nothing would.
  Bringing the menu up must not be mistaken for choosing something in it, so the
  `telling` flag is up while the items are brought up to date (setting `Checked`
  raises the same event a click does).
- **What the person chooses** (`Settings.cs`, `%LOCALAPPDATA%\Tatty\avatar.json`,
  beside the panel's bounds but in a file of its own, and nothing to do with the
  server's settings): **Animations**, **Sound**, **Effects** and **Keep Tatty on
  the desktop**. The last one is what makes the fidgeting worth having: without
  it Tatty tucks himself away ten seconds after nothing is pending, and his own
  day is never seen. The x, the tray's "hide" and the taskbar's close are a
  person saying "away with all of it", and outrank it.
- **Less motion.** Whether Tatty moves at all is `Motion.On`, in one place
  because the avatar and the stage have to agree. The OS's own answer
  (`SystemParameters.ClientAreaAnimation`, Settings ▸ Accessibility ▸ Visual
  effects) is the **default and not a veto**: with it off he bobs and blinks and
  nothing else, until the person ticks **Animations** in his menu, which is
  theirs for good either way. `TATTY_ANIMATE=1` overrides both, for the tests,
  which have to be able to see the confetti on a machine that has animation
  turned off. The page does the same thing for `prefers-reduced-motion`, where
  the card says it just as well.

## Modes and colour

A **mode** is one of the toolbox's discipline plugins: engineering, design or
production (`installed_modes()` in `server.py`, from the toolbox's pointer
folders and Claude Code's own install records; see
[toolbox-contract.md](toolbox-contract.md)).

- **The landing page** (`#modes`) has a card for every discipline the toolbox
  has, whether or not it is installed. The ones installed are the modes to work
  in; the rest are greyed, with **Add**, which has Claude Code install that
  plugin from the toolbox's marketplace (`POST /api/mode/install` →
  `install_mode`, the same `claude plugin install` a person would run). The card
  comes to life with the answer, and the page says the plugin's skills reach
  Claude Code in new sessions. A window opens on the mode's home page when there
  is one to open on (`parseRoute`), but the modes page stays reachable with a
  single discipline installed, because it is also where another is added.
- **The mode** is the page's own choice, remembered in `localStorage`; the
  server only says which plugins are installed (`/api/status`'s `modes`).
- **The radio** is one box of segments, the mode on screen pressed into it and
  in that mode's colour (one segment, pressed, when only one is installed). It
  lives in the panel's title bar, beside Tatty's name; the header holds the same
  radio for a browser tab, which has no title bar, and the compact bubble shows
  neither. `renderSwitcher` fills every `.mode-switch` slot, and style.css
  decides which is on screen.
- **Mode-scoped pages:** a nav item with a `data-mode` belongs to that mode and
  is shown only in it (today Features, engineering's). Going to such a page
  switches to its mode (`PAGE_MODE` and `switchMode` in `features.js`), so a
  link never shows one mode's pages in another's colours. With no discipline
  plugin installed, nothing is hidden.
- **The colour** is all a mode changes: `theme.css` has the palette (every
  mode's accent), the theme (the neutrals and states, with the dark override)
  and the mode layer, which is only ever
  `--accent: var(--accent-<mode>)` under `body[data-mode="…"]`. `style.css`
  names `--accent`, `--accent-soft` and `--on-accent` and no colour of its own,
  so a new mode is one block in the mode layer and a new theme (a light/dark
  toggle of our own, say) one block in the theme layer. The tray app follows:
  the page sends `mode`, and `App.xaml.cs` swaps the `TtAccent` brush Tatty is
  drawn with.

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
- **Planning IDs** (`ids.js`): `linkIds(node, feature)` turns the IDs the
  feature defines into links, in questions (`askCard`), replies and documents in
  View. It runs over the rendered text, so plain text, markdown and the custom
  viewers all get it; definitions, headings, code and existing links are left
  alone. The feature's IDs come from `/api/items` (the toolbox's `ids.sh index`,
  cached on the documents' modified times), an item's card from `/api/item`
  (`item_of` in `server.py`). A question's feature is `session_feature`'s: the
  started session's, else the one its project is linked to. Hovering any link
  that names an ID (an ID link, or a wikilink to `^r12` or `CH3 — …`) shows the
  card, positioned from JS because the CSP refuses inline styles; `findId`
  focuses the item when the link is followed.
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
- **Tokens used:** `usageWidget(usage, { compact })` in `usage.js` draws what a
  session has used (input, output, cache read and write, the context window's
  fill, the cost) as a card, or as one line with `compact`; it returns
  `{ node, update }` so any page can hold one. The feature page puts one above
  the Timeline card, for the live session or else the last one's final total.
  The numbers come from the mod: after each turn of a started session it posts
  `kind: "usage"` to `/api/activity` with its running totals (the engine reports
  tokens per turn, so the mod sums them) and `$.session.usage()`'s context and
  cost. The server keeps them as `usage` on the session and sends a `session`
  event, so they reach the page with the session; they are not a row in the
  activity feed. Nothing is read from the transcript files, and a session
  Tatty didn't start reports nothing.

## The Jira board

The production mode's page (`#jira`, `jira.js`). The rules it keeps are in the
toolbox contract's "Jira" section; how it is built:

- **Reading Jira costs tokens.** Tatty can only reach the Atlassian MCP server
  through Claude, so the server runs `claude -p` (`jira_claude`) with a JSON
  schema for the answer, and keeps what comes back under `<home>/jira`. The
  page reads that (`GET /api/jira`, free) and asks for a run only on a click:
  `POST /api/jira/refresh`, `/api/jira/issue`, `/api/jira/move`, each a job on
  a thread of its own (`jira_job`), one of a kind at a time (409 otherwise),
  announced as `jira` events when it starts and ends.
- **Keeping the runs small.** Measured on a real board: loading every MCP
  server and the default system prompt put about 80k tokens in each turn's
  context; the one Jira server (`--strict-mcp-config` with its entry from
  `~/.claude.json`), a one-line system prompt and `--tools ""` put about 16k,
  most of it cached between runs. A board of six tickets took about 20 s and
  60k tokens over its turns ($0.04); a ticket about 20 s and 40k ($0.035).
  `--bare` would be smaller still, but it drops the MCP servers.
- **The board** is a column per status, ordered by the status's category (to
  do, under way, done) and then by Jira's rank. The MCP server can't read a
  board's own column setup, so statuses are the columns.
- **A ticket** opens in a panel at the right. Its detail is loaded on its own
  (description in markdown, sub-tasks, links, and the transitions it offers),
  and kept.
- **Start workflow** (`POST /api/jira/start`, `jira_start`):
  1. makes `<KEY> - <summary>` with `new_feature`;
  2. writes the ticket into it as `<name> - Ticket.md`;
  3. starts the folder's first step with `start_session`, its placeholder
     naming the ticket document;
  4. once the session is open, moves the ticket by the transition to In
     Progress named in its detail.

  The page then goes to the feature's page, which shows the session live.
  `started.tsv` remembers the feature, so the card says so and the panel links
  to it.

## Tasks (the production mode)

The production mode's **Tasks** page (`#tasks`, `tasks.js` and `tasks.css`,
server.py's "tasks" section) is a tracker of Tatty's own, for a project that
doesn't use Jira, Trello or the like. The toolbox has no part in it.

- **On disk:** `<root>/tasks/<board>/`, a folder per board:
  - `board.json`: the columns (an id and a name each, left to right), the order
    of the cards in the backlog and each column, the next ID, the options
    (`autoCompleteDays`, `startColumn`, `project`, `celebrate`, `priorities`) and
    the feature each started task became. Unknown keys are kept.
  - `items/<ID> - <title>.md`: a markdown file per task, in the bullet style of
    the toolbox's documents: the H1 (`# T-0042: Title`), a header of
    `- **Status:**`, `Priority`, `Labels`, `Created` and `Done` (and `Feature`,
    once a workflow is started), then `## Description` and any other sections.
    A task exported from a User Stories board also has `- **Story:**` (which
    story, on which design board) and an `## Acceptance criteria` section.
  - `.deleted/`: where Delete moves a task's file.

  A file per task keeps each change to one small file, merges in git, and reads
  and edits in Obsidian; the workflow plans straight from one.
- **Which list a task is in is its file's say.** Its Status names a column by
  name (in any case). `Backlog` (or none) is the backlog, `Completed` the
  Completed page, and a status that names no column puts it under "Not on a
  column", shown apart and never rewritten. The last column is the done one:
  moving a task into it stamps `Done:`, moving it out clears it, and **Clear
  done** sends its tasks to Completed. board.json's order only says where a task
  sits in its list: the ids it orders that really are there, then the rest by
  when they were made. So a move between columns writes the task's file and
  board.json, a reorder board.json alone, and Completed is never in the order
  (it is sorted by Done), which keeps board.json small however long the history.
- **Hand edits are kept.** A file is read tolerantly (YAML front matter,
  `* **status**:` in any case, unknown bullets and sections), and a change
  rewrites only the value on its own line, or the Description's body, keeping
  the file's line ends and BOM. A file is renamed only when its title is changed
  in Tatty, never after a hand edit. A task's ID is the one in its file's name
  (else its H1's). A file with none, or another file's, or whose name and title
  disagree, is listed as a problem, and **Give it an ID of its own** fixes it.
- **IDs** are `<prefix>-<4 digits>` (`T` unless board.json says otherwise).
  Each is made under the board's lock with an exclusive create, past both
  board.json's `nextId` and every ID in use, so neither a file copied in nor an
  old board.json can make two tasks share one. (Two machines sharing a synced
  folder still could: it shows as a problem.)
- **Conflicts:** a save names the `rev` it was made from, a hash of the file's
  bytes rather than its mtime (a junction to a FAT or network drive keeps
  coarse times). A file changed since is a 409 that carries the task as it is
  now, and the panel keeps what was typed. A board.json that won't parse
  refuses every change rather than be written over.
- **Thousands of tasks:** each board's index (`<home>/tasks-index/`) keeps every
  file's size, mtime and summary, so a look at the board reads only the files
  that changed, and only their headers; a cold start costs a directory listing.
  The board sends its columns in full, the backlog's first 100 and Completed's
  counts; the Backlog and Completed pages come a page at a time
  (`/api/tasks/list`), the next as the end of the list comes into view.
- **Outside edits:** `watch_tasks` looks every 2 s (longer on a slow drive) and
  sends one `tasks` event per board whose files changed outside Tatty. Tatty's
  own writes are in the index already, and the page ignores the events that
  carry its own `client` id. The page reads the board again 250 ms later,
  keeping its scroll, its focus and a half-typed quick add; during a drag it
  waits for the drop, and an open task with changes typed in it asks before
  taking the new one. Once an hour the watcher also applies each board's
  `autoCompleteDays` (off by default).
- **The board:** a column per column, the backlog as a rail at the left (hidden
  with a click, remembered), "+ Add a task" at each foot, each column's ⋯ menu
  (rename, move, and delete with where its tasks go), and "+ Add column", which
  goes in before the done column. A card is dragged with pointer events, as the
  User Stories notes are, with a 4 px threshold so that a click opens it. A
  ghost follows the pointer, a placeholder shows where it will land, a list
  scrolls when the pointer nears its edge, and Esc cancels. The drop tells the
  server the list and the card it goes before (`/api/tasks/move`), so a second
  window's stale list still lands right. Alt+←/→ moves a focused card a list
  along and Alt+↑/↓ up or down its list, said in an `aria-live` region; `n` is
  a new task and `/` the filter.
- **The task panel** (`#tasks/<board>/task/<id>`, `/task/new`): the title,
  status, priority, labels, and the description with Write and Preview; the
  other fields and sections as they are; **Edit whole file** for the raw
  markdown; Save (Ctrl+Enter) and Delete. Its classes are its own: jira.js takes
  `.jticket` away on every change of page.
- **Completed:** the total, this week, this month, the best week and the streak
  of weeks; a bar for each of the last 12 weeks; a line that says how it's
  going, whatever the motion setting; and the tasks by week, then by month, each
  with **Reopen**. Finishing is celebrated with a `milestone` event
  (`tasks.done`), as the toolbox's milestones are: small for a task into the
  done column, mid for Clear done, big on crossing 10, 50 and each hundred
  completed (none with the board's `celebrate` off). The tray app's Tatty
  reacts by his own Animations setting. The page throws confetti only for one
  that happens while it is open, since the event stream replays old events on
  every load.
- **Start workflow** (`/api/tasks/start`), as from a Jira ticket: the feature
  `<ID> - <title>`, the task written into it as `<name> - Ticket.md`, the
  workflow's own first step started on it, and the task moved on to the
  board's start column (the option, else the first column that sounds under
  way). The task's file and board.json name the feature before the session
  starts, so a second Start is refused rather than making a second feature.

## User Stories (the design mode)

- **Boards:** `<root>/design/<name>/`, each a copy of a design document and its
  `<name> - User Stories.md`, which only the toolbox's `tt-user-stories` skill
  and its `stories.sh` write (see the contract, "User Stories"). The nav's
  **User Stories** (design mode) lists them (`#designs`); a board is
  `#design/<name>`, an opened card `#design/<name>/card/<id>` (`stories.js`).
- **New from a design document…** picks the file in Windows' own file dialog
  (`pickFile`; the companion's `pick-file` message, or `TtCompanion.exe
  --pick-file` from the server), makes the board (`/api/new-design`: the copy,
  then `stories.sh init`) and starts a draft run.
- **Runs:** `start_stories_run` runs the skill headless (`claude -p`, the prompt
  on stdin, stream-json out) on a thread of its own, one at a time. Each tool
  call becomes a `stories` event with a step for the page's strip; the last one
  says which stories are new or rewritten, the cost, or the error. Stop
  (`/api/stories/cancel`) kills the process tree. `state.touch()` on every line
  keeps the idle watchdog off a long run.
- **Adding a story:** the board's **＋** tool (S) opens a blank story where it
  was clicked. Save posts `action: add` with the fields and `at` (the card's
  place): `stories.sh add`, Accepted, no tokens. **Write it for me** posts the
  person's line instead: `stories.sh add --proposed` of a placeholder (the line
  as its title and want, "(to be written)" for the rest), then the skill's own
  `alter` run on it, with the note "Write this story properly from the
  designer's note: …". The story waits as Proposed; nothing in the toolbox is
  new for it.
- **Changes:** Save, ✓, 🗑 and the group panel post to `/api/stories`, which
  writes a spec and calls `stories.sh` with the story's hash (`--if`), so a
  story changed elsewhere is a 409 and the board reloads. No change is taken
  while a run is writing the same board. `watch_designs` sends a `stories`
  event whenever a board's document changes on disk (the skill's writes, a hand
  edit in Obsidian), and the page reloads.
- **The board** is the whiteboard (see "Whiteboards"), the notes its cards.
  Notes with no place yet go in a column per group. Each group's colour
  (`.g0`–`.g7`, kept once given so removing a group recolours nothing) is kept
  with the board's whiteboard in `<home>/boards/`.
- **The group panel** is pinned top right, over the board. A click puts the
  group in focus: its notes outlined, the rest dimmed, a labelled frame round
  them, and the view framed on them. The framing eases with motion on and jumps
  with reduced motion; either way it happens.
- **Export to Tasks** (the board's top bar) puts accepted stories on a Tasks
  board's backlog (see "Tasks"), a task each, for the production mode to
  schedule. The panel lists the Accepted stories not yet on a board, all ticked,
  grouped, and the board to put them on (one of the same name, else a new one
  of that name). `/api/stories/export` (`stories_export`) reads the stories with
  `stories.sh list`, refuses (409) a story that is no longer Accepted or whose
  hash changed since the page read it, and writes the task files itself, under
  the board's lock, in the stories' order: no headless run, so no tokens. A
  task gets the story's title, its group as its label, the story sentence and
  its details as the Description (details under `### Details`), a `## Acceptance
  criteria` section, and `- **Story:** US-NN on the design board "<name>"`. Which
  task each story became, and the story's hash then, are kept with the board's
  layout in `<home>/boards/` (`exported`), never in the stories document. A
  story whose task is still on that board shows its task's ID on its note (a
  click opens the task; ✎ when the story changed after it went) and isn't
  offered again; delete the task and it is.

## Whiteboards

`whiteboard.js` (and `whiteboard.css`) is the board the User Stories page draws
its notes on, and the board of a blank whiteboard and of a feature. A host page
makes one with `makeWhiteboard(o)`: where it saves (`key: {kind, ref}`), what
the server gave it, its own cards (`setCards([{id, node, w, h}])`: nodes it
built, which the board places and drags), what a click on a card does
(`onOpen`), its own placing tools (`tools`, e.g. the Story tool), and a panel
to pin top right (`corner`). The board does the rest: pan (a drag with the
middle button, wherever it starts, or a finger on the background; the left and
right buttons are kept for the things on the board, so a left drag on the
background moves nothing and the browser's right-click menu is off, but in a
text being written), wheel zoom about
the pointer, Fit, `frame(ids)`, `outline(ids, label)` (a group's frame).

- **What a person adds:** text fields (markdown, edited on double-click, a
  width handle, a colour), comments (a marker on a card's or a text's corner
  that follows it, or on a spot; Resolve, and a toggle that hides resolved
  ones), and lines (between any two things, edge to edge, an arrowhead and a
  label, redrawn as either end moves; an end that is gone hides the line,
  never deletes it). Tools: Select `V`, Text `T` (or double-click the
  background), Comment `C`, Line `L`, then the host's; Esc goes back to Select,
  Delete removes what is selected. A host card is never removed from here.
- **Saving:** each change shows at once and goes to `POST /api/whiteboard` as
  a small batch (cards' places, the view, items and lines upserted or
  removed), applied under the board's lock and refused whole if any of it is
  bad. Removing an item takes its lines and lets go of the comments on it. A
  `whiteboard` event tells other windows, which read the board again (not
  while a text or a comment is being written there).
- **Where:** Tatty's own, never in a document: `<home>/boards/<key>.json` for a
  folder's (a User Stories board, keyed as before; a feature), with any other
  keys kept as they are (a stories board's colours and exports), and
  `<home>/whiteboards/<name>.json` for a blank one. The ids of items and lines
  are the page's (`n` + base 36); a card's is the host's (`US-01`, a
  document's file name).
- **Blank whiteboards** (`whiteboards.js`): design mode → **Whiteboards**
  (`#whiteboards`; one is `#whiteboard/<name>`), New and Delete (into
  `<home>/whiteboards/.deleted/`).
- **A feature's whiteboard** (`#feature/<name>/whiteboard`, the **Whiteboard**
  item in its left rail): its documents are the cards, and a click opens one.

## Tests

- `tools/test-tatty.sh` covers the server, the scripts and the pages' data:
  530 checks against a real toolbox (the User Stories board's with a stand-in
  `claude` that writes through the real `stories.sh`), with a toolbox-free part when there's no
  toolbox. The milestones are among them: a row appended to the ledger is
  announced with its label and tier, once per key, unknown events are ignored,
  and a window that opens on a full ledger says nothing about it, and each
  alert's `link` (a question's, a reply's, a milestone's with its skill and
  feature). So are the
  task boards: a hand-made file kept byte for byte but for the line changed,
  IDs made at once, moves and the order they keep, conflicts, the columns,
  Clear done and its milestones, a hand edit reaching the page, problems and
  adoption, Delete, Start workflow, a board.json that won't read, and a board
  through a junction. And Export to Tasks: Proposed and changed stories
  refused, the task files it writes, a story skipped once exported and offered
  again once its task is deleted, and a workflow started from one.
- `claude plugin test plugins/tatty` covers the mod, including the joining
  rule.
- `tools/page-check.py` and `tools/features-check.py` drive the page in
  headless Edge or Chrome, or the tray app's WebView2 with `attach <port>`.
  Given a page opened as the companion (`?mode=companion`), `page-check.py` also
  checks the alert banner: a question's text, its going when answered, a
  milestone's, and that opening one expands to its page. The avatar's click
  itself (`OpenAlert`) is only checked by hand. It also posts a challenge-style
  question and reports how it was laid out (`ask_format`).
  `features-check.py` ends with the Jira board, drawn from a sample board in
  the page (columns, a ticket's panel, Esc, the nav item per mode), and the
  task boards. `features-check.py ... --tasks` walks only those, on the
  fixture's `Sample` board, with real mouse input: a card dragged to another
  column and back, a reorder and back, one dragged in from the backlog rail and
  back, Alt+arrows, the task panel (Write and Preview, Cancel, Esc), the backlog
  and Completed with and without reduced motion. It leaves every task's file as
  it was (it never uses the done column).
  `features-check.py ... --stories` walks only a User Stories board with real
  mouse input (pan, wheel zoom, a group in focus with and without reduced
  motion, a note dragged and back, a card opened and its edit form); it changes
  nothing in the stories document.
  `features-check.py ... --export` clicks through Export to Tasks on the first
  User Stories board (the panel, two stories exported, their IDs on the notes,
  the backlog, a task's panel, the panel again). It writes task files, so run
  it only on a throwaway root.
  `features-check.py ... --whiteboard` makes a blank whiteboard and writes on it
  with real mouse and keys (a text by the Text tool, one by double-click, a
  comment pinned to the first, a labelled line between them (its layer only as
  big as the line, and still taking a click), a drag the comment
  and the line follow, a reload, Delete), adds a story with the Story tool where
  it was clicked, and opens a document from the Demo feature's whiteboard. It
  writes too: a throwaway root and home only.
  `page-check.py` also covers the modes: the top bar, the landing page, what
  switching mode does to the colour and the nav, and the mode being remembered
  across a reload. Start the server with `TATTY_MODES` to drive more than the
  one discipline installed. It asks for a milestone through the page's own
  `api()` as well, and reports the card, the confetti, and that the pieces take
  themselves away again.
- `tools/window-check.py` reports what the shell makes of the companion's
  windows -- the styles that decide the taskbar and Alt-Tab, who holds the
  button, what is on top -- and asserts the lot for one view with
  `--expect <view>`. With `--switch <view>` it changes view through the page's
  own buttons and checks that the window, its WebView2 and the loaded page all
  came through unchanged, which is the promise that a view switch never rebuilds
  the runtime. `--right-click` right-clicks Tatty and asks whether his menu came
  up and whether Escape took it away. That one borrows the **real** pointer for a
  moment and puts it back: WPF takes its mouse input from the system cursor and
  ignores a posted click that didn't happen there, so a synthetic one reaches no
  handler at all and looks exactly like a menu that doesn't work.
- `tools/test-companion.sh` walks every view with it (compact, full, maximised,
  minimised, restored, tucked away and back), right-clicks Tatty for his menu,
  and finishes a section with `tatty.sh cheer` to see the confetti's window come
  up and go away again. It is the only test that builds and runs the exe, shows
  real windows and uses the pointer, so it is opt-in rather than part of
  `test-tatty.sh`.
